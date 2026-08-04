/**
 * RecentFileImages - turns a file listed by the recent-files picker into
 * something a browser can paint or attach.
 *
 * Two jobs, both cached on disk under the server's cache directory and keyed by
 * path + mtime + size, so the cost is paid once ever rather than once per
 * panel opening; editing a photo in place changes its mtime and therefore its
 * key.
 *
 * 1. Thumbnails. The roll is full-resolution phone captures: a 1290×2796
 *    screenshot is ~14 MB of RGBA once decoded, so handing ten of them to the
 *    browser to paint 90px tiles would cost hundreds of megabytes of bitmaps.
 * 2. HEIC. No browser decodes it and no browser canvas can compress it, so the
 *    composer would refuse the attachment; ImageMagick turns it into a JPEG
 *    first.
 *
 * ImageMagick is the only image tool involved, and it is optional: without it
 * thumbnails degrade to the original bytes for formats the browser can decode,
 * and HEIC simply cannot be attached.
 *
 * @module RecentFileImages
 */
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";

import type { RecentFilesSource } from "@t3tools/contracts";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";

import { isRecentPhotoName, resolveRecentFilesDirectory } from "./RecentFiles.ts";

const execFileAsync = NodeUtil.promisify(NodeChildProcess.execFile);

/** Distinguishes the temp files of two renders racing on the same cache entry. */
let renderSequence = 0;

/** Longest edge of a thumbnail — 2× the tile, so it stays crisp on HiDPI. */
const THUMBNAIL_EDGE = 256;
/** At this size the difference above 80 is invisible. */
const THUMBNAIL_QUALITY = 80;
/** Full-size conversions keep more of the original than a thumbnail does. */
const CONVERSION_QUALITY = 88;
/** A stuck ImageMagick must not hold an RPC open. */
const MAGICK_TIMEOUT_MS = 20_000;

/** The formats `image/*` covers that no browser can decode. */
const BROWSER_UNDECODABLE_EXTENSIONS: ReadonlySet<string> = new Set([".heic", ".heif"]);

const RECENT_FILE_SOURCES = [
  "photos",
  "downloads",
] as const satisfies ReadonlyArray<RecentFilesSource>;

export function needsBrowserConversion(filePath: string): boolean {
  return BROWSER_UNDECODABLE_EXTENSIONS.has(NodePath.extname(filePath).toLowerCase());
}

export interface RecentFileImageStat {
  readonly modifiedAt: number;
  readonly sizeBytes: number;
}

/**
 * Confirms the path is a still image sitting directly in one of the two watched
 * folders. The signed asset token is minted from whatever path the client sends,
 * so without this check the picker's resources would be a read-any-file URL.
 */
export const resolveListedRecentFile = Effect.fn("RecentFileImages.resolveListedFile")(function* (
  filePath: string,
): Effect.fn.Return<RecentFileImageStat | null> {
  if (!isRecentPhotoName(filePath)) return null;

  const parent = NodePath.resolve(NodePath.dirname(filePath));
  const roots = yield* Effect.forEach(RECENT_FILE_SOURCES, resolveRecentFilesDirectory);
  // Windows paths are case-insensitive, and the roll's own casing varies with
  // how iCloud created the folder.
  const caseInsensitive = (yield* HostProcessPlatform) === "win32";
  const samePath = (left: string, right: string) =>
    caseInsensitive ? left.toLowerCase() === right.toLowerCase() : left === right;
  if (!roots.some((root) => samePath(NodePath.resolve(root), parent))) return null;

  const info = yield* Effect.tryPromise(() => NodeFSP.stat(filePath)).pipe(
    Effect.orElseSucceed(() => null),
  );
  return info === null || !info.isFile()
    ? null
    : { modifiedAt: info.mtimeMs, sizeBytes: info.size };
});

function cacheFileName(input: {
  readonly filePath: string;
  readonly stat: RecentFileImageStat;
  readonly variant: string;
}): string {
  const digest = NodeCrypto.createHash("sha256")
    .update(input.variant)
    .update(input.filePath)
    .update(String(input.stat.modifiedAt))
    .update(String(input.stat.sizeBytes))
    .digest("hex");
  // Half the digest keeps a few thousand cached renders distinct.
  return `${digest.slice(0, 32)}.jpg`;
}

const fileExists = (path: string) =>
  Effect.tryPromise(() => NodeFSP.stat(path).then((info) => info.isFile())).pipe(
    Effect.orElseSucceed(() => false),
  );

const removeQuietly = (path: string) =>
  Effect.tryPromise(() => NodeFSP.rm(path, { force: true })).pipe(Effect.ignore);

/**
 * Runs ImageMagick into a temp file and moves it into place, so two panels
 * asking for the same photo at once can never read a half-written JPEG.
 * `-auto-orient` applies the EXIF rotation phone cameras rely on.
 */
const runMagick = Effect.fn("RecentFileImages.runMagick")(function* (input: {
  readonly sourcePath: string;
  readonly cachePath: string;
  readonly args: ReadonlyArray<string>;
}) {
  renderSequence += 1;
  const temporaryPath = `${input.cachePath}.${process.pid}-${renderSequence}.tmp`;
  yield* Effect.tryPromise(() =>
    NodeFSP.mkdir(NodePath.dirname(input.cachePath), { recursive: true }),
  );
  yield* Effect.tryPromise(() =>
    execFileAsync("magick", [input.sourcePath, ...input.args, `jpg:${temporaryPath}`], {
      timeout: MAGICK_TIMEOUT_MS,
      windowsHide: true,
    }),
  ).pipe(Effect.tapError(() => removeQuietly(temporaryPath)));
  yield* Effect.tryPromise(() => NodeFSP.rename(temporaryPath, input.cachePath)).pipe(
    Effect.tapError(() => removeQuietly(temporaryPath)),
  );
  return input.cachePath;
});

const renderToCache = Effect.fn("RecentFileImages.renderToCache")(function* (input: {
  readonly cacheDir: string;
  readonly filePath: string;
  readonly stat: RecentFileImageStat;
  readonly variant: string;
  readonly args: ReadonlyArray<string>;
}) {
  const cachePath = NodePath.join(
    input.cacheDir,
    cacheFileName({ filePath: input.filePath, stat: input.stat, variant: input.variant }),
  );
  if (yield* fileExists(cachePath)) return cachePath;
  return yield* runMagick({ sourcePath: input.filePath, cachePath, args: input.args });
});

/**
 * A square-ish JPEG preview. When ImageMagick is missing, a format the browser
 * decodes on its own falls back to the original file: a heavy tile beats no
 * tile, and only HEIC is left with nothing to show.
 */
export const renderRecentFileThumbnail = Effect.fn("RecentFileImages.renderThumbnail")(
  function* (input: {
    readonly cacheDir: string;
    readonly filePath: string;
    readonly stat: RecentFileImageStat;
  }) {
    return yield* renderToCache({
      ...input,
      variant: `thumbnail:${THUMBNAIL_EDGE}`,
      args: [
        "-auto-orient",
        "-thumbnail",
        `${THUMBNAIL_EDGE}x${THUMBNAIL_EDGE}`,
        "-quality",
        String(THUMBNAIL_QUALITY),
      ],
    }).pipe(
      Effect.catch((cause) =>
        needsBrowserConversion(input.filePath)
          ? Effect.fail(cause)
          : Effect.logDebug("Serving a recent file unscaled: ImageMagick is unavailable.", {
              cause,
            }).pipe(Effect.as(input.filePath)),
      ),
    );
  },
);

/**
 * The bytes the composer turns into an attachment: the file itself, unless the
 * browser cannot decode it, in which case a JPEG rendition of it.
 */
export const renderRecentFileImage = Effect.fn("RecentFileImages.renderImage")(function* (input: {
  readonly cacheDir: string;
  readonly filePath: string;
  readonly stat: RecentFileImageStat;
}) {
  if (!needsBrowserConversion(input.filePath)) return input.filePath;
  return yield* renderToCache({
    ...input,
    variant: "image",
    args: ["-auto-orient", "-quality", String(CONVERSION_QUALITY)],
  });
});

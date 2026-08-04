/**
 * RecentFiles - the two folders the composer's paperclip panel offers.
 *
 * The camera roll is filtered to stills and gets thumbnails; downloads are
 * listed whole, because what lands there is arbitrary — an installer, a CSV, an
 * extracted folder — and a preview would mean nothing for most of it.
 *
 * HEIC is listed among the stills even though no browser can decode it: it is
 * the camera roll's native format, so filtering it out would hide most of what
 * the user actually wants to send. Both the thumbnail and the bytes handed to
 * the composer go through ImageMagick for those (see `RecentFileImages.ts`).
 *
 * The folders belong to the machine the environment runs on, not the machine
 * the browser runs on — which is also what makes the inserted paths correct.
 *
 * @module RecentFiles
 */
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import {
  type RecentFileEntry,
  RecentFilesError,
  type RecentFilesSnapshot,
  type RecentFilesSource,
  type RecentFilesSubscribeInput,
} from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Stream from "effect/Stream";

/** The camera roll, relative to the home directory. */
const PHOTOS_ROLL_SEGMENTS = ["Pictures", "iCloud Photos", "Photos"] as const;

/** Where downloads land on this machine, preferred over the OS default below. */
const CONFIGURED_DOWNLOADS_DIR = "D:\\Downloads";

/** Still-image extensions, matched case-insensitively. */
export const RECENT_PHOTO_EXTENSIONS: ReadonlySet<string> = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".heic",
  ".heif",
]);

/** How many entries each tab shows. There is no paging. */
export const RECENT_FILES_LIMIT = 10;

/**
 * How long to wait for a folder to settle before re-listing it. iCloud writes a
 * temp file and renames it, and a browser writes a `.part` before the real
 * name, so one arrival lands as a burst of events — and `fs.watch` fires before
 * the bytes are flushed, so listing straight away would report a 0-byte file.
 */
const WATCH_DEBOUNCE = Duration.millis(700);

/**
 * Stats run one syscall per candidate: unlike a Win32 directory entry, Node's
 * `Dirent` carries no timestamp. Filtering by name first is what keeps the roll
 * (thousands of files) bounded, and the pool keeps the burst off the event loop.
 */
const STAT_CONCURRENCY = 24;

export function isRecentPhotoName(name: string): boolean {
  return RECENT_PHOTO_EXTENSIONS.has(NodePath.extname(name).toLowerCase());
}

/**
 * Whether an entry belongs in this tab. Downloads take everything — including
 * folders, since an extracted archive is a perfectly good thing to hand over.
 */
export function acceptsRecentFileName(source: RecentFilesSource, name: string): boolean {
  return source === "photos" ? isRecentPhotoName(name) : true;
}

/**
 * Newest first, ties broken by path so the order never flickers between two
 * entries written in the same millisecond, then truncated to what the tab shows.
 */
export function sortAndLimitRecentFileEntries(
  entries: ReadonlyArray<RecentFileEntry>,
  limit: number,
): ReadonlyArray<RecentFileEntry> {
  return entries
    .toSorted((left, right) =>
      right.modifiedAt === left.modifiedAt
        ? left.path.localeCompare(right.path)
        : right.modifiedAt - left.modifiedAt,
    )
    .slice(0, limit);
}

const isDirectory = (path: string) =>
  Effect.tryPromise(() => NodeFSP.stat(path).then((info) => info.isDirectory())).pipe(
    Effect.orElseSucceed(() => false),
  );

export const resolveRecentFilesDirectory = Effect.fn("RecentFiles.resolveDirectory")(function* (
  source: RecentFilesSource,
): Effect.fn.Return<string> {
  if (source === "photos") {
    return NodePath.join(NodeOS.homedir(), ...PHOTOS_ROLL_SEGMENTS);
  }
  // The user's downloads live off the system drive; fall back to the OS folder
  // so this still resolves to something sane on another machine.
  if (yield* isDirectory(CONFIGURED_DOWNLOADS_DIR)) {
    return CONFIGURED_DOWNLOADS_DIR;
  }
  return NodePath.join(NodeOS.homedir(), "Downloads");
});

const readRecentFileEntry = (input: { readonly directoryPath: string; readonly name: string }) =>
  Effect.tryPromise(() => NodeFSP.stat(NodePath.join(input.directoryPath, input.name))).pipe(
    Effect.map((info): RecentFileEntry => {
      const directory = info.isDirectory();
      return {
        path: NodePath.join(input.directoryPath, input.name),
        name: input.name,
        modifiedAt: info.mtimeMs,
        // A directory's real size would need a full walk; the panel shows none.
        sizeBytes: directory ? 0 : info.size,
        isDirectory: directory,
        isImage: !directory && isRecentPhotoName(input.name),
      };
    }),
    // A file that vanished between the listing and its stat (iCloud churn, a
    // browser renaming a partial download) simply isn't in this snapshot.
    Effect.orElseSucceed(() => null),
  );

export const listRecentFiles = Effect.fn("RecentFiles.list")(function* (
  source: RecentFilesSource,
): Effect.fn.Return<RecentFilesSnapshot, RecentFilesError> {
  const directoryPath = yield* resolveRecentFilesDirectory(source);
  if (!(yield* isDirectory(directoryPath))) {
    return yield* new RecentFilesError({ source, failure: "folder_not_found", directoryPath });
  }

  const dirents = yield* Effect.tryPromise({
    try: () => NodeFSP.readdir(directoryPath, { withFileTypes: true }),
    catch: (cause) =>
      new RecentFilesError({ source, failure: "read_directory_failed", directoryPath, cause }),
  });

  const candidates = dirents.filter(
    (dirent) =>
      (dirent.isFile() || dirent.isDirectory()) && acceptsRecentFileName(source, dirent.name),
  );
  const entries = yield* Effect.forEach(
    candidates,
    (dirent) => readRecentFileEntry({ directoryPath, name: dirent.name }),
    { concurrency: STAT_CONCURRENCY },
  );

  return {
    source,
    directoryPath,
    entries: sortAndLimitRecentFileEntries(
      entries.filter((entry): entry is RecentFileEntry => entry !== null),
      RECENT_FILES_LIMIT,
    ),
  };
});

const watchRecentFilesDirectory = (source: RecentFilesSource, directoryPath: string) =>
  Stream.unwrap(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      return fileSystem.watch(directoryPath).pipe(
        Stream.filter((event) => acceptsRecentFileName(source, NodePath.basename(event.path))),
        Stream.debounce(WATCH_DEBOUNCE),
        // Losing the watcher must not take the panel down with it: the listing
        // already on screen stays, it just stops refreshing itself.
        Stream.catchCause((cause) =>
          Stream.fromEffect(
            Effect.logWarning("Stopped watching a recent-files folder.", {
              source,
              directoryPath,
              cause,
            }),
          ).pipe(Stream.drain),
        ),
      );
    }),
  );

/**
 * Emits the folder's listing at subscription time, then a fresh one every time
 * the folder settles after a change.
 */
export function streamRecentFiles(
  input: RecentFilesSubscribeInput,
): Stream.Stream<RecentFilesSnapshot, RecentFilesError, FileSystem.FileSystem> {
  return Stream.unwrap(
    listRecentFiles(input.source).pipe(
      Effect.map((snapshot) =>
        Stream.concat(
          Stream.make(snapshot),
          watchRecentFilesDirectory(input.source, snapshot.directoryPath).pipe(
            Stream.mapEffect(() => listRecentFiles(input.source)),
          ),
        ),
      ),
    ),
  );
}

import type { RecentFileEntry, RecentFilesSource } from "@t3tools/contracts";

/** Tiles per row in the photo grid; the downloads list is a single column. */
export const RECENT_PHOTO_COLUMNS = 5;

export const RECENT_FILES_TABS: ReadonlyArray<{
  readonly source: RecentFilesSource;
  readonly label: string;
}> = [
  { source: "photos", label: "Photos" },
  { source: "downloads", label: "Téléchargements" },
];

/**
 * The picked paths, in the order they were picked — which is the order the
 * badges show and the order they land in the prompt.
 */
export type RecentFilesSelection = ReadonlyArray<string>;

export function toggleRecentFileSelection(
  selection: RecentFilesSelection,
  path: string,
): RecentFilesSelection {
  return selection.includes(path)
    ? selection.filter((selected) => selected !== path)
    : [...selection, path];
}

/**
 * Drops paths the last refresh no longer lists. Returns the same array when
 * there is nothing to prune, so a caller storing this in state cannot loop on
 * its own output.
 */
export function pruneRecentFileSelection(
  selection: RecentFilesSelection,
  knownPaths: ReadonlySet<string>,
): RecentFilesSelection {
  if (knownPaths.size === 0) return selection;
  return selection.every((path) => knownPaths.has(path))
    ? selection
    : selection.filter((path) => knownPaths.has(path));
}

/**
 * Where an arrow key moves the cursor, or `null` when it would leave the grid —
 * in a one-column list, left and right have nowhere to go.
 */
export function moveRecentFilesCursor(input: {
  readonly cursor: number;
  readonly key: string;
  readonly count: number;
  readonly columns: number;
}): number | null {
  if (input.count === 0) return null;
  const step =
    input.key === "ArrowLeft"
      ? -1
      : input.key === "ArrowRight"
        ? 1
        : input.key === "ArrowUp"
          ? -input.columns
          : input.key === "ArrowDown"
            ? input.columns
            : null;
  if (step === null) return null;
  if (input.columns === 1 && (input.key === "ArrowLeft" || input.key === "ArrowRight")) return null;
  const next = input.cursor + step;
  return next >= 0 && next < input.count ? next : null;
}

/**
 * Renders picked paths as the text typed into the prompt.
 *
 * Every path is double-quoted: the camera roll lives under `iCloud Photos`, so
 * an unquoted path would read as two arguments and the model would go looking
 * for a file that doesn't exist. Windows forbids `"` in file names, so wrapping
 * needs no escaping. The trailing space lets the user keep typing their request
 * straight after.
 */
export function quoteRecentFilePathsForPrompt(paths: ReadonlyArray<string>): string {
  if (paths.length === 0) return "";
  return `${paths.map((path) => `"${path}"`).join(" ")} `;
}

export interface RecentFilesInsertion {
  /** Images to hand to the composer as real attachments. */
  readonly images: ReadonlyArray<RecentFileEntry>;
  /** Everything else — folders, archives, logs — goes in as a quoted path. */
  readonly paths: ReadonlyArray<string>;
}

/**
 * Splits a selection the way the composer consumes it. The selection spans both
 * tabs, so a screenshot and a log file can go into the same prompt: entries are
 * looked up across every listing the panel has loaded, and the picking order is
 * preserved.
 */
export function planRecentFilesInsertion(
  selection: RecentFilesSelection,
  entriesByPath: ReadonlyMap<string, RecentFileEntry>,
): RecentFilesInsertion {
  const images: Array<RecentFileEntry> = [];
  const paths: Array<string> = [];
  for (const path of selection) {
    const entry = entriesByPath.get(path);
    if (entry !== undefined && entry.isImage && !entry.isDirectory) {
      images.push(entry);
    } else {
      paths.push(path);
    }
  }
  return { images, paths };
}

/**
 * The text to append to the prompt: the non-image picks, plus any image whose
 * bytes could not be fetched. A photo the server cannot render must not vanish
 * from the insertion — handing over its path still lets the agent go and read
 * it, which is what the user asked for by picking it.
 */
export function recentFilesInsertionText(
  selection: RecentFilesSelection,
  insertion: RecentFilesInsertion,
  unavailableImagePaths: ReadonlySet<string>,
): string {
  const quotable = new Set([...insertion.paths, ...unavailableImagePaths]);
  return quoteRecentFilePathsForPrompt(selection.filter((path) => quotable.has(path)));
}

/**
 * The name the attachment carries. A HEIC photo reaches the browser as the
 * JPEG the server rendered from it, so keeping the original extension would
 * label the attachment with a format it no longer is.
 */
export function recentFileAttachmentName(name: string, mimeType: string): string {
  if (mimeType !== "image/jpeg" || /\.jpe?g$/i.test(name)) return name;
  return `${name.replace(/\.[^.]+$/, "")}.jpg`;
}

/**
 * Compact modified-at for a downloads row: `12/01/26 14:32`. Absolute date and
 * time both matter here — two installers downloaded the same day are told apart
 * by the minute, and a numeric layout keeps the column narrow and aligned under
 * `tabular-nums`.
 */
const RECENT_FILE_DATE_FORMAT = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "2-digit",
  year: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function formatRecentFileDate(modifiedAt: number): string {
  // fr-FR yields `12/01/26, 14:32`; drop the comma for a tighter cell.
  return RECENT_FILE_DATE_FORMAT.format(new Date(modifiedAt)).replace(",", "");
}

const SIZE_UNITS = ["o", "Ko", "Mo", "Go"] as const;

/** Compact size for a downloads row; a folder has none worth showing. */
export function formatRecentFileSize(entry: RecentFileEntry): string {
  if (entry.isDirectory) return "dossier";
  let size = entry.sizeBytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < SIZE_UNITS.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size < 10 && unitIndex > 0 ? size.toFixed(1) : Math.round(size)} ${SIZE_UNITS[unitIndex]}`;
}

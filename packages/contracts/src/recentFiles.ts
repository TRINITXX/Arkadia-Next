import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

const RECENT_FILE_PATH_MAX_LENGTH = 1024;

/** Which of the two fixed folders the composer's picker is listing. */
export const RecentFilesSource = Schema.Literals(["photos", "downloads"]);
export type RecentFilesSource = typeof RecentFilesSource.Type;

export const RecentFilesSubscribeInput = Schema.Struct({
  source: RecentFilesSource,
});
export type RecentFilesSubscribeInput = typeof RecentFilesSubscribeInput.Type;

/** One tile or row of the picker. */
export const RecentFileEntry = Schema.Struct({
  /** Absolute path on the environment host — what gets quoted into the prompt. */
  path: TrimmedNonEmptyString.check(Schema.isMaxLength(RECENT_FILE_PATH_MAX_LENGTH)),
  name: TrimmedNonEmptyString,
  /** Last write, ms since the epoch: the list's sort key and the thumbnail cache key. */
  modifiedAt: Schema.Number,
  /** Bytes; 0 for a directory, whose real size would need a full walk. */
  sizeBytes: Schema.Number,
  isDirectory: Schema.Boolean,
  /**
   * Whether the server can hand this entry over as image bytes. The picker
   * turns those into real composer attachments and every other entry into a
   * quoted path, so the decision has to be made where the file lives.
   */
  isImage: Schema.Boolean,
});
export type RecentFileEntry = typeof RecentFileEntry.Type;

export const RecentFilesSnapshot = Schema.Struct({
  source: RecentFilesSource,
  directoryPath: TrimmedNonEmptyString.check(Schema.isMaxLength(RECENT_FILE_PATH_MAX_LENGTH)),
  entries: Schema.Array(RecentFileEntry),
});
export type RecentFilesSnapshot = typeof RecentFilesSnapshot.Type;

export const RecentFilesFailure = Schema.Literals(["folder_not_found", "read_directory_failed"]);
export type RecentFilesFailure = typeof RecentFilesFailure.Type;

export class RecentFilesError extends Schema.TaggedErrorClass<RecentFilesError>()(
  "RecentFilesError",
  {
    source: RecentFilesSource,
    failure: RecentFilesFailure,
    directoryPath: Schema.optional(TrimmedNonEmptyString),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    const directory = this.directoryPath === undefined ? "" : ` at '${this.directoryPath}'`;
    return this.failure === "folder_not_found"
      ? `No '${this.source}' folder${directory} on this machine.`
      : `Failed to read the '${this.source}' folder${directory}.`;
  }
}

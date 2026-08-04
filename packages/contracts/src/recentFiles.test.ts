import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { RecentFileEntry, RecentFilesError, RecentFilesSnapshot } from "./recentFiles.ts";

const encodeSnapshot = Schema.encodeSync(RecentFilesSnapshot);
const decodeSnapshot = Schema.decodeUnknownSync(RecentFilesSnapshot);
const decodeEntry = Schema.decodeUnknownSync(RecentFileEntry);

describe("RecentFilesError", () => {
  it("keeps the cause out of the message the picker renders", () => {
    const cause = new Error("EPERM: operation not permitted, scandir");
    const error = new RecentFilesError({
      source: "downloads",
      failure: "read_directory_failed",
      directoryPath: "D:\\Downloads",
      cause,
    });

    expect(error.message).toBe("Failed to read the 'downloads' folder at 'D:\\Downloads'.");
    expect(error.message).not.toContain(cause.message);
    expect(error.cause).toBe(cause);
  });

  it("says the folder is missing when there is nothing to read", () => {
    const error = new RecentFilesError({ source: "photos", failure: "folder_not_found" });

    expect(error.message).toBe("No 'photos' folder on this machine.");
  });
});

describe("RecentFilesSnapshot", () => {
  it("round-trips a listing over the wire", () => {
    const snapshot: RecentFilesSnapshot = {
      source: "photos",
      directoryPath: "C:\\Users\\a\\Pictures\\iCloud Photos\\Photos",
      entries: [
        {
          path: "C:\\Users\\a\\Pictures\\iCloud Photos\\Photos\\IMG_1.HEIC",
          name: "IMG_1.HEIC",
          modifiedAt: 1_700_000_000_000,
          sizeBytes: 2_400_000,
          isDirectory: false,
          isImage: true,
        },
      ],
    };

    expect(decodeSnapshot(encodeSnapshot(snapshot))).toEqual(snapshot);
  });

  it("rejects an entry without a path", () => {
    expect(() =>
      decodeEntry({
        path: "   ",
        name: "IMG_1.HEIC",
        modifiedAt: 0,
        sizeBytes: 0,
        isDirectory: false,
        isImage: true,
      }),
    ).toThrow();
  });
});

import type { RecentFileEntry } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  formatRecentFileDate,
  formatRecentFileSize,
  moveRecentFilesCursor,
  planRecentFilesInsertion,
  pruneRecentFileSelection,
  quoteRecentFilePathsForPrompt,
  RECENT_PHOTO_COLUMNS,
  recentFileAttachmentName,
  recentFilesInsertionText,
  toggleRecentFileSelection,
} from "./RecentFilesPicker.logic";

function entry(overrides: Partial<RecentFileEntry> & { path: string }): RecentFileEntry {
  return {
    name: overrides.path.split(/[\\/]/).at(-1) ?? overrides.path,
    modifiedAt: 0,
    sizeBytes: 0,
    isDirectory: false,
    isImage: false,
    ...overrides,
  };
}

describe("toggleRecentFileSelection", () => {
  it("appends in picking order and removes on a second pick", () => {
    let selection = toggleRecentFileSelection([], "a.png");
    selection = toggleRecentFileSelection(selection, "b.png");
    expect(selection).toEqual(["a.png", "b.png"]);

    expect(toggleRecentFileSelection(selection, "a.png")).toEqual(["b.png"]);
  });
});

describe("pruneRecentFileSelection", () => {
  it("keeps the very same array when nothing disappeared", () => {
    const selection = ["a.png", "b.png"];

    expect(pruneRecentFileSelection(selection, new Set(["a.png", "b.png", "c.png"]))).toBe(
      selection,
    );
  });

  it("drops what the refresh no longer lists", () => {
    expect(pruneRecentFileSelection(["a.png", "b.png"], new Set(["b.png"]))).toEqual(["b.png"]);
  });

  it("keeps the selection while no listing has arrived yet", () => {
    const selection = ["a.png"];

    expect(pruneRecentFileSelection(selection, new Set())).toBe(selection);
  });
});

describe("moveRecentFilesCursor", () => {
  const grid = { count: 12, columns: RECENT_PHOTO_COLUMNS };

  it("walks the grid one tile and one row at a time", () => {
    expect(moveRecentFilesCursor({ ...grid, cursor: 0, key: "ArrowRight" })).toBe(1);
    expect(moveRecentFilesCursor({ ...grid, cursor: 6, key: "ArrowUp" })).toBe(1);
    expect(moveRecentFilesCursor({ ...grid, cursor: 1, key: "ArrowDown" })).toBe(6);
  });

  it("refuses to leave the grid", () => {
    expect(moveRecentFilesCursor({ ...grid, cursor: 0, key: "ArrowLeft" })).toBeNull();
    expect(moveRecentFilesCursor({ ...grid, cursor: 11, key: "ArrowDown" })).toBeNull();
    expect(moveRecentFilesCursor({ ...grid, cursor: 0, key: "Enter" })).toBeNull();
    expect(moveRecentFilesCursor({ count: 0, columns: 1, cursor: 0, key: "ArrowDown" })).toBeNull();
  });

  it("ignores sideways moves in the one-column list", () => {
    expect(
      moveRecentFilesCursor({ count: 4, columns: 1, cursor: 1, key: "ArrowRight" }),
    ).toBeNull();
    expect(moveRecentFilesCursor({ count: 4, columns: 1, cursor: 1, key: "ArrowDown" })).toBe(2);
  });
});

describe("quoteRecentFilePathsForPrompt", () => {
  it("quotes every path and leaves room for what the user types next", () => {
    expect(
      quoteRecentFilePathsForPrompt([
        "C:\\Users\\a\\Pictures\\iCloud Photos\\Photos\\IMG_1.HEIC",
        "D:\\Downloads\\report.csv",
      ]),
    ).toBe(
      '"C:\\Users\\a\\Pictures\\iCloud Photos\\Photos\\IMG_1.HEIC" "D:\\Downloads\\report.csv" ',
    );
  });

  it("inserts nothing for an empty selection", () => {
    expect(quoteRecentFilePathsForPrompt([])).toBe("");
  });
});

describe("planRecentFilesInsertion", () => {
  const entries = new Map<string, RecentFileEntry>([
    ["shot.png", entry({ path: "shot.png", isImage: true })],
    ["report.csv", entry({ path: "report.csv" })],
    ["extracted", entry({ path: "extracted", isDirectory: true })],
    // A folder whose name ends in an image extension must never be attached.
    ["album.png", entry({ path: "album.png", isImage: true, isDirectory: true })],
  ]);

  it("attaches images and quotes everything else, in picking order", () => {
    const plan = planRecentFilesInsertion(
      ["report.csv", "shot.png", "extracted", "album.png"],
      entries,
    );

    expect(plan.images.map((image) => image.path)).toEqual(["shot.png"]);
    expect(plan.paths).toEqual(["report.csv", "extracted", "album.png"]);
  });

  it("falls back to a quoted path for an entry no listing knows", () => {
    const plan = planRecentFilesInsertion(["vanished.png"], entries);

    expect(plan.images).toEqual([]);
    expect(plan.paths).toEqual(["vanished.png"]);
  });
});

describe("recentFilesInsertionText", () => {
  const entries = new Map<string, RecentFileEntry>([
    ["shot.png", entry({ path: "shot.png", isImage: true })],
    ["photo.heic", entry({ path: "photo.heic", isImage: true })],
    ["report.csv", entry({ path: "report.csv" })],
  ]);
  const selection = ["shot.png", "report.csv", "photo.heic"];
  const insertion = planRecentFilesInsertion(selection, entries);

  it("quotes only the non-image picks when every image was fetched", () => {
    expect(recentFilesInsertionText(selection, insertion, new Set())).toBe('"report.csv" ');
  });

  it("falls back to the path of an image whose bytes never arrived", () => {
    expect(recentFilesInsertionText(selection, insertion, new Set(["photo.heic"]))).toBe(
      '"report.csv" "photo.heic" ',
    );
  });
});

describe("recentFileAttachmentName", () => {
  it("renames a photo the server had to convert", () => {
    expect(recentFileAttachmentName("IMG_1.HEIC", "image/jpeg")).toBe("IMG_1.jpg");
  });

  it("leaves a name that already matches its bytes alone", () => {
    expect(recentFileAttachmentName("shot.png", "image/png")).toBe("shot.png");
    expect(recentFileAttachmentName("shot.JPEG", "image/jpeg")).toBe("shot.JPEG");
  });
});

describe("formatRecentFileDate", () => {
  it("renders a comma-free numeric date and time", () => {
    // A fixed local wall-clock timestamp; only the format shape is asserted so
    // the test stays stable across the runner's timezone.
    const label = formatRecentFileDate(new Date(2026, 0, 12, 14, 32).getTime());

    expect(label).toMatch(/^\d{2}\/\d{2}\/\d{2} \d{2}:\d{2}$/);
    expect(label).not.toContain(",");
  });
});

describe("formatRecentFileSize", () => {
  it("labels folders and scales file sizes", () => {
    expect(formatRecentFileSize(entry({ path: "d", isDirectory: true }))).toBe("dossier");
    expect(formatRecentFileSize(entry({ path: "a", sizeBytes: 512 }))).toBe("512 o");
    expect(formatRecentFileSize(entry({ path: "b", sizeBytes: 2048 }))).toBe("2.0 Ko");
    expect(formatRecentFileSize(entry({ path: "c", sizeBytes: 20 * 1024 * 1024 }))).toBe("20 Mo");
  });
});

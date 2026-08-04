import type { RecentFileEntry } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  acceptsRecentFileName,
  isRecentPhotoName,
  RECENT_FILES_LIMIT,
  sortAndLimitRecentFileEntries,
} from "./RecentFiles.ts";

function entry(name: string, modifiedAt: number, path = `D:\\Downloads\\${name}`): RecentFileEntry {
  return {
    path,
    name,
    modifiedAt,
    sizeBytes: 0,
    isDirectory: false,
    isImage: isRecentPhotoName(name),
  };
}

describe("isRecentPhotoName", () => {
  it("takes every still the picker can show, whatever the casing", () => {
    for (const name of ["a.png", "b.JPG", "c.jpeg", "d.gif", "e.webp", "f.HEIC", "g.heif"]) {
      expect(isRecentPhotoName(name)).toBe(true);
    }
  });

  it("drops raw, video and extension-less files", () => {
    // Nothing downstream can read these, so they would only ever be dead tiles.
    for (const name of ["h.dng", "i.mov", "j.mp4", "desktop.ini", "noext", "IMG_1.icloud"]) {
      expect(isRecentPhotoName(name)).toBe(false);
    }
  });
});

describe("acceptsRecentFileName", () => {
  it("filters the roll to stills and takes downloads whole", () => {
    expect(acceptsRecentFileName("photos", "IMG_1.HEIC")).toBe(true);
    expect(acceptsRecentFileName("photos", "clip.mov")).toBe(false);
    expect(acceptsRecentFileName("downloads", "setup.exe")).toBe(true);
    expect(acceptsRecentFileName("downloads", "x.crdownload")).toBe(true);
    expect(acceptsRecentFileName("downloads", "extracted")).toBe(true);
  });
});

describe("sortAndLimitRecentFileEntries", () => {
  it("puts the newest first", () => {
    const sorted = sortAndLimitRecentFileEntries(
      [entry("old.png", 1_000), entry("new.png", 3_000), entry("mid.png", 2_000)],
      RECENT_FILES_LIMIT,
    );

    expect(sorted.map((item) => item.name)).toEqual(["new.png", "mid.png", "old.png"]);
  });

  it("breaks ties by path so the order never flickers", () => {
    const sorted = sortAndLimitRecentFileEntries(
      [entry("b.png", 1_000), entry("a.png", 1_000)],
      RECENT_FILES_LIMIT,
    );

    expect(sorted.map((item) => item.name)).toEqual(["a.png", "b.png"]);
  });

  it("truncates to the tab's limit, keeping the newest", () => {
    const entries = Array.from({ length: 25 }, (_, index) =>
      entry(`img${String(index).padStart(2, "0")}.png`, index),
    );

    const sorted = sortAndLimitRecentFileEntries(entries, RECENT_FILES_LIMIT);

    expect(sorted).toHaveLength(RECENT_FILES_LIMIT);
    expect(sorted[0]?.name).toBe("img24.png");
  });

  it("leaves the input array untouched", () => {
    const entries = [entry("old.png", 1_000), entry("new.png", 2_000)];

    sortAndLimitRecentFileEntries(entries, RECENT_FILES_LIMIT);

    expect(entries.map((item) => item.name)).toEqual(["old.png", "new.png"]);
  });
});

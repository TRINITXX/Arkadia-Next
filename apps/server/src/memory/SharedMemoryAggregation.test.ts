import { describe, it, expect } from "@effect/vitest";
import { aggregateSharedMemory, contentKey } from "./SharedMemoryAggregation.js";

const rec = (provider: string, text: string, updatedAtMs: number, path = `${provider}/${updatedAtMs}.md`) =>
  ({ provider, path, text, updatedAtMs });

describe("aggregateSharedMemory", () => {
  it("dedups records with the same normalized content, keeping the newest", () => {
    const out = aggregateSharedMemory(
      [rec("claude", "Deploy runs on push to master.", 1000),
       rec("codex", "Deploy   runs on push to master.\n", 2000)],
      { maxBytes: 10_000 },
    );
    expect(out.entries).toHaveLength(1);
    expect(out.entries[0]).toMatchObject({ provider: "codex", text: "Deploy   runs on push to master." });
    expect(contentKey("Deploy runs on push to master.")).toEqual(contentKey("Deploy   runs on push to master.\n"));
  });

  it("keeps distinct facts and orders them newest-first", () => {
    const out = aggregateSharedMemory(
      [rec("claude", "Fact A", 1000), rec("codex", "Fact B", 3000), rec("claude", "Fact C", 2000)],
      { maxBytes: 10_000 },
    );
    expect(out.entries.map((e) => e.text)).toEqual(["Fact B", "Fact C", "Fact A"]);
  });

  it("evicts the coldest (oldest) entries when over the byte budget", () => {
    const big = "x".repeat(100);
    const out = aggregateSharedMemory(
      [rec("claude", `${big} old`, 1000), rec("codex", `${big} new`, 2000)],
      { maxBytes: 140 },
    );
    expect(out.entries.map((e) => e.text)).toEqual([`${big} new`]);
    expect(out.droppedForSize).toEqual(1);
  });

  it("stops at the first entry that doesn't fit instead of bin-packing a colder smaller entry past it", () => {
    const out = aggregateSharedMemory(
      [
        rec("codex", "small new", 3000),
        rec("claude", "X".repeat(300), 2000),
        rec("grok", "tiny old", 1000),
      ],
      { maxBytes: 50 },
    );
    expect(out.entries.map((e) => e.text)).toEqual(["small new"]);
    expect(out.droppedForSize).toEqual(2);
  });

  it("renders markdown with a stable heading and one bullet per entry", () => {
    const out = aggregateSharedMemory([rec("codex", "Fact B", 3000)], { maxBytes: 10_000 });
    expect(out.markdown).toContain("# Shared project memory");
    expect(out.markdown).toContain("- Fact B");
  });

  it("returns empty (no heading noise) for no records", () => {
    const out = aggregateSharedMemory([], { maxBytes: 10_000 });
    expect(out.entries).toHaveLength(0);
    expect(out.markdown).toEqual("");
  });

  it("drops an entry whose key is tombstoned, even though a source still has it", () => {
    const droppedKey = contentKey("Fact A");
    const out = aggregateSharedMemory(
      [rec("claude", "Fact A", 1000), rec("codex", "Fact B", 2000)],
      { maxBytes: 10_000, tombstonedKeys: new Set([droppedKey]) },
    );
    expect(out.entries.map((e) => e.text)).toEqual(["Fact B"]);
  });

  it("keeps a pinned entry over the byte budget, while the same unpinned entry would be evicted", () => {
    const big = "x".repeat(200);
    const oldText = "small old fact";
    const oldKey = contentKey(oldText);
    const records = [rec("claude", oldText, 1000), rec("codex", big, 2000)];
    // big alone (204 bytes) fits in 210; big + old (204 + 18 = 222) does not.
    const maxBytes = 210;

    const withoutPin = aggregateSharedMemory(records, { maxBytes });
    expect(withoutPin.entries.map((e) => e.text)).toEqual([big]);
    expect(withoutPin.droppedForSize).toEqual(1);

    const withPin = aggregateSharedMemory(records, { maxBytes, pinnedKeys: new Set([oldKey]) });
    expect(withPin.entries.map((e) => e.text)).toEqual([big, oldText]);
    expect(withPin.droppedForSize).toEqual(0);
  });

  it("drops an entry that is both pinned and tombstoned -- tombstone wins", () => {
    const key = contentKey("Fact A");
    const out = aggregateSharedMemory(
      [rec("claude", "Fact A", 1000), rec("codex", "Fact B", 2000)],
      { maxBytes: 10_000, pinnedKeys: new Set([key]), tombstonedKeys: new Set([key]) },
    );
    expect(out.entries.map((e) => e.text)).toEqual(["Fact B"]);
  });
});

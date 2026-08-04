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
});

// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import type { SharedMemoryEntry } from "@t3tools/contracts";

export interface RawMemoryRecord {
  readonly provider: string;
  readonly path: string;
  readonly text: string;
  readonly updatedAtMs: number;
}
export interface AggregateOptions {
  readonly maxBytes: number;
  /** contentKey values exempt from size-eviction -- always kept, even over maxBytes. */
  readonly pinnedKeys?: ReadonlySet<string>;
  /** contentKey values dropped even if a source still contains them. */
  readonly tombstonedKeys?: ReadonlySet<string>;
}

const normalize = (text: string): string => text.replace(/\s+/g, " ").trim();

export const contentKey = (text: string): string =>
  NodeCrypto.createHash("sha256").update(normalize(text)).digest("hex");

const byteLength = (text: string): number => Buffer.byteLength(text, "utf8");

export function aggregateSharedMemory(
  records: ReadonlyArray<RawMemoryRecord>,
  options: AggregateOptions,
): { entries: ReadonlyArray<SharedMemoryEntry>; markdown: string; droppedForSize: number } {
  const pinnedKeys = options.pinnedKeys ?? new Set<string>();
  const tombstonedKeys = options.tombstonedKeys ?? new Set<string>();

  // 1. dedup by content key, last-writer-wins on updatedAtMs. Tombstoned keys
  // are dropped here, before ordering/eviction even see them, so a
  // tombstoned fact never resurfaces even if a source still contains it.
  const byKey = new Map<string, SharedMemoryEntry & { updatedAtMs: number }>();
  for (const r of records) {
    const trimmed = r.text.trim();
    if (trimmed.length === 0) continue;
    const key = contentKey(trimmed);
    if (tombstonedKeys.has(key)) continue;
    const existing = byKey.get(key);
    if (!existing || r.updatedAtMs > existing.updatedAtMs) {
      byKey.set(key, {
        key,
        text: trimmed,
        provider: r.provider,
        updatedAt: new Date(r.updatedAtMs).toISOString(),
        updatedAtMs: r.updatedAtMs,
      });
    }
  }

  // 2. newest-first
  const ordered = [...byKey.values()].sort((a, b) => b.updatedAtMs - a.updatedAtMs);

  // 3. size cap — keep newest until the byte budget is exhausted, evict the rest (coldest).
  // Strict newest-first cutoff: the first NON-PINNED entry that doesn't fit flips
  // `budgetExhausted`, and every remaining (older) non-pinned entry is dropped too — no
  // bin-packing a smaller, colder entry past a bigger one that was already rejected. Pinned
  // entries are always kept regardless of `budgetExhausted` (never counted in `dropped`), but
  // their bytes still count against `used` — they consume budget without being evictable.
  // Iterating `ordered` in place (never reordering) means `kept` stays newest-first for free.
  const kept: SharedMemoryEntry[] = [];
  let used = 0;
  let dropped = 0;
  let budgetExhausted = false;
  for (const e of ordered) {
    const cost = byteLength(e.text) + 4; // "- " + "\n"
    const isPinned = pinnedKeys.has(e.key);
    if (isPinned) {
      kept.push({ key: e.key, text: e.text, provider: e.provider, updatedAt: e.updatedAt });
      used += cost;
      continue;
    }
    if (!budgetExhausted && used + cost <= options.maxBytes) {
      kept.push({ key: e.key, text: e.text, provider: e.provider, updatedAt: e.updatedAt });
      used += cost;
    } else {
      budgetExhausted = true;
      dropped += 1;
    }
  }

  const markdown =
    kept.length === 0 ? "" : `# Shared project memory\n\n${kept.map((e) => `- ${e.text}`).join("\n")}\n`;

  return { entries: kept, markdown, droppedForSize: dropped };
}

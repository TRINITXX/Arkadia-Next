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
}

const normalize = (text: string): string => text.replace(/\s+/g, " ").trim();

export const contentKey = (text: string): string =>
  NodeCrypto.createHash("sha256").update(normalize(text)).digest("hex");

const byteLength = (text: string): number => Buffer.byteLength(text, "utf8");

export function aggregateSharedMemory(
  records: ReadonlyArray<RawMemoryRecord>,
  options: AggregateOptions,
): { entries: ReadonlyArray<SharedMemoryEntry>; markdown: string; droppedForSize: number } {
  // 1. dedup by content key, last-writer-wins on updatedAtMs
  const byKey = new Map<string, SharedMemoryEntry & { updatedAtMs: number }>();
  for (const r of records) {
    const trimmed = r.text.trim();
    if (trimmed.length === 0) continue;
    const key = contentKey(trimmed);
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
  // Strict newest-first cutoff: the first entry that doesn't fit stops the scan, and it plus
  // every remaining (older) entry counts as dropped — no bin-packing a smaller, colder entry
  // past a bigger one that was already rejected.
  const kept: SharedMemoryEntry[] = [];
  let used = 0;
  let dropped = 0;
  for (let i = 0; i < ordered.length; i++) {
    const e = ordered[i];
    const cost = byteLength(e.text) + 4; // "- " + "\n"
    if (used + cost <= options.maxBytes) {
      kept.push({ key: e.key, text: e.text, provider: e.provider, updatedAt: e.updatedAt });
      used += cost;
    } else {
      dropped += ordered.length - i;
      break;
    }
  }

  const markdown =
    kept.length === 0 ? "" : `# Shared project memory\n\n${kept.map((e) => `- ${e.text}`).join("\n")}\n`;

  return { entries: kept, markdown, droppedForSize: dropped };
}

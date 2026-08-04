# Shared Project Memory — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Intended final location** (plan-mode wrote it here; move on execution): `docs/superpowers/plans/2026-08-04-shared-project-memory.md`

**Goal:** Give every wrapped provider (Codex, Claude, Cursor, Grok, OpenCode) access to one shared, per-project memory — fed automatically from what each agent already records in its own native memory — so no model is ever missing what another learned, in or out of T3 Code.

**Architecture:** A server-side canonical memory store, one directory per *project* (keyed by git remote, falling back to the git common dir so all worktrees of a repo share one store). The server reads each provider's native memory directory, folds everything into the canonical store through a **pure aggregator** (dedup by content key, last-writer-wins on conflict, size-capped with coldest-eviction), and delivers it two ways: (1) **injected** into every provider at the turn-send chokepoint via each provider's proper instruction channel — the guaranteed path *inside* T3 Code; (2) **surfaced as a real file** at the `AGENTS.md`-convention path in every workspace via a filesystem junction to the canonical dir — so a raw CLI launched *outside* T3 Code reads it too.

**Tech Stack:** TypeScript (ESM), Effect (`effect`, `@effect/platform`, `@effect/vitest`), Effect Schema for contracts, `vp test` runner, `tsgo` typecheck, oxlint. Node builtins only where Effect FS can't reach (junction creation).

## Global Constraints

- **Language:** code, identifiers, comments in English. Conventional Commits.
- **Effect idioms only:** services are `Context.Service` tags + `make = Effect.gen(...)` + `export const layer = Layer.effect(Tag, make)`. Compose into the runtime in `apps/server/src/server.ts` (pattern at `server.ts:216-323`).
- **Filesystem via `effect/FileSystem` + `effect/Path`**; tagged errors via `Schema.TaggedErrorClass`. Node builtins only with top-of-file `// @effect-diagnostics nodeBuiltinImport:off` and the mandated namespace alias (`NodeFSP` for `node:fs/promises`, `NodeOS` for `node:os`, `NodeCrypto` for `node:crypto`) — lint rule `t3code/namespace-node-imports` (error).
- **Contracts** in `packages/contracts/src/server.ts` use `Schema.Struct` + branded scalars from `./baseSchemas.ts`; export the schema `const` and `export type X = typeof X.Type`; arrays added over time get `.pipe(Schema.withDecodingDefault(Effect.succeed([])))`; new optional fields use `Schema.optionalKey`.
- **Tests** are `*.test.ts` with `@effect/vitest` (`it.layer` / `it.effect`); provide `NodeServices.layer` + `ServerConfig.ServerConfig.layerTest(process.cwd(), { prefix })`; use `fileSystem.makeTempDirectoryScoped(...)` for real-FS tests; keep aggregation in a pure function tested with `Effect.sync`. **Never** call `Effect.runPromise/runSync/...` in tests — lint rule `t3code/no-manual-effect-runtime-in-tests` (error).
- **Gates before merge:** `pnpm tc` (typecheck) and `pnpm lint` — the commit hook only formats (`vp fmt`), so run these manually.
- **Scope of THIS plan:** the full feature, built in one pass. Tasks 1-7 are the functional core (aggregation, per-project store, junction, injection into all five providers, on-turn refresh). Tasks 8-13 complete it (live watcher + PubSub, client memory panel, user-scope + all-provider write-back sources, `AGENTS.md` reference). Build tasks in order — later tasks depend on earlier ones. The only thing explicitly deferred is **semantic dedup** (needs an embeddings dependency + a cost decision): Task 13 keeps whitespace-normalized dedup and flags semantic as a separate decision, not built blindly.

---

## File Structure

**New files (all under `apps/server/src/memory/`):**
- `SharedMemoryAggregation.ts` — pure aggregator + rendering. No I/O. One responsibility: turn a list of raw fact records into a deduped, capped, ordered canonical memory + its markdown rendering.
- `SharedMemoryAggregation.test.ts` — unit tests for the pure aggregator.
- `ProjectMemoryPaths.ts` — resolve the stable project key (remote canonicalKey ?? git-common-dir) and map it to the canonical store directory under `ServerConfig`.
- `SharedMemorySources.ts` — given a workspace root (+ optional Codex home), return the list of native memory directories to read for MVP (Claude project scope, Codex home scope).
- `SharedProjectMemory.ts` — the Effect service: `refresh` (read sources → aggregate → write canonical dir) and `read` (return the rendered digest string), plus `ensureLink`.
- `SharedProjectMemory.test.ts` — service test over a temp dir.
- `linkSharedMemory.ts` — junction/symlink helper (the only Node-builtin file).

**Modified files:**
- `packages/contracts/src/server.ts` — add `SharedMemoryEntry`, `SharedMemorySnapshot`; add optional `sharedContext` to `ProviderSendTurnInput`.
- `apps/server/src/config.ts` — add `projectMemoryDir` to `deriveServerPaths` + create it in `ensureServerDirectories`.
- `apps/server/src/server.ts` — wire `SharedProjectMemoryLayerLive`.
- `apps/server/src/provider/Layers/ProviderService.ts` (~671-688) — resolve shared context once at the `sendTurn` chokepoint, attach to `input`.
- `apps/server/src/provider/Layers/CodexSessionRuntime.ts:353` — append shared context to `developer_instructions`.
- `apps/server/src/provider/Layers/ClaudeAdapter.ts:3528` — add `append` to the `claude_code` system-prompt preset.
- `apps/server/src/provider/Layers/CursorAdapter.ts:963` (and the twin builder in `GrokAdapter.ts`) — prepend a text `ContentBlock`.
- `apps/server/src/provider/Layers/OpenCodeAdapter.ts:1440` — prepend to the turn text.

---

## Task 1: Contract types for shared memory

**Files:**
- Modify: `packages/contracts/src/server.ts` (add near `ServerProviderSkill`, ~line 97)
- Test: none (schema-only; exercised via Task 2/5 tests)

**Interfaces:**
- Produces: `SharedMemoryEntry` = `{ key: string; text: string; provider: string; updatedAt: string /* ISO */ }`; `SharedMemorySnapshot` = `{ readAt: DateTimeUtc; markdown: string; entries: ReadonlyArray<SharedMemoryEntry> }`.

- [ ] **Step 1: Add the schemas**

```ts
// packages/contracts/src/server.ts  (after ServerProviderSkill)
export const SharedMemoryEntry = Schema.Struct({
  key: TrimmedNonEmptyString,          // stable content-hash key used for dedup
  text: TrimmedNonEmptyString,
  provider: TrimmedNonEmptyString,     // which native source it came from, e.g. "claude" | "codex"
  updatedAt: IsoDateTime,
});
export type SharedMemoryEntry = typeof SharedMemoryEntry.Type;

export const SharedMemorySnapshot = Schema.Struct({
  readAt: Schema.DateTimeUtc,
  markdown: Schema.String,
  entries: Schema.Array(SharedMemoryEntry).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
});
export type SharedMemorySnapshot = typeof SharedMemorySnapshot.Type;
```

- [ ] **Step 2: Add the optional turn-send field**

Find `ProviderSendTurnInput` in `packages/contracts/src/server.ts` and add one optional field (does not break existing decoders):

```ts
  // inside ProviderSendTurnInput Schema.Struct({ ... })
  sharedContext: Schema.optionalKey(Schema.String),
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @t3tools/contracts typecheck` (or `pnpm tc`)
Expected: PASS. Confirm `IsoDateTime`, `TrimmedNonEmptyString` are already imported at `server.ts:5-13` (they are).

- [ ] **Step 4: Commit**

```bash
git add packages/contracts/src/server.ts
git commit -m "feat(contracts): add shared project memory schemas + turn sharedContext field"
```

---

## Task 2: Pure aggregator (`aggregateSharedMemory`)

This is the quality garde-fou for the "fully autonomous writes" decision: dedup + last-writer-wins + size cap live here, fully unit-tested, no I/O. Mirrors the pure `aggregateTraceDiagnostics` pattern (`apps/server/src/diagnostics/TraceDiagnostics.ts:66-74`).

**Files:**
- Create: `apps/server/src/memory/SharedMemoryAggregation.ts`
- Test: `apps/server/src/memory/SharedMemoryAggregation.test.ts`

**Interfaces:**
- Consumes: `SharedMemoryEntry` type from `@t3tools/contracts`.
- Produces:
  - `RawMemoryRecord = { provider: string; path: string; text: string; updatedAtMs: number }`
  - `AggregateOptions = { maxBytes: number }`
  - `aggregateSharedMemory(records: ReadonlyArray<RawMemoryRecord>, options: AggregateOptions): { entries: ReadonlyArray<SharedMemoryEntry>; markdown: string; droppedForSize: number }`
  - `contentKey(text: string): string` (normalized-whitespace hash key, exported for reuse/testing)

- [ ] **Step 1: Write the failing tests**

```ts
// apps/server/src/memory/SharedMemoryAggregation.test.ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter t3 test run apps/server/src/memory/SharedMemoryAggregation.test.ts`
Expected: FAIL — module not found / functions undefined.

- [ ] **Step 3: Implement the pure aggregator**

```ts
// apps/server/src/memory/SharedMemoryAggregation.ts
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

  // 3. size cap — keep newest until the byte budget is exhausted, evict the rest (coldest)
  const kept: SharedMemoryEntry[] = [];
  let used = 0;
  let dropped = 0;
  for (const e of ordered) {
    const cost = byteLength(e.text) + 4; // "- " + "\n"
    if (used + cost <= options.maxBytes) {
      kept.push({ key: e.key, text: e.text, provider: e.provider, updatedAt: e.updatedAt });
      used += cost;
    } else {
      dropped += 1;
    }
  }

  const markdown =
    kept.length === 0 ? "" : `# Shared project memory\n\n${kept.map((e) => `- ${e.text}`).join("\n")}\n`;

  return { entries: kept, markdown, droppedForSize: dropped };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter t3 test run apps/server/src/memory/SharedMemoryAggregation.test.ts`
Expected: PASS (all 5).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/memory/SharedMemoryAggregation.ts apps/server/src/memory/SharedMemoryAggregation.test.ts
git commit -m "feat(server): pure shared-memory aggregator with dedup, last-writer-wins, size cap"
```

---

## Task 3: Project memory paths (stable key + store dir)

Give every worktree of one repo the **same** store. `RepositoryIdentityResolver` already normalizes the remote into a `canonicalKey` and detects the git toplevel (`apps/server/src/project/RepositoryIdentityResolver.ts:48-113`). Fallback when there is no remote: the git **common** dir (`git rev-parse --git-common-dir`), which is identical across a repo's worktrees.

**Files:**
- Modify: `apps/server/src/config.ts:100-158` (add `projectMemoryDir`)
- Create: `apps/server/src/memory/ProjectMemoryPaths.ts`
- Test: covered by Task 5 service test (path logic is thin; the hash is deterministic)

**Interfaces:**
- Consumes: `ServerConfig` (for `projectMemoryDir`), `RepositoryIdentityResolver`, `ProcessRunner` (git fallback), `effect/Path`.
- Produces: service `ProjectMemoryPaths` with `resolveStoreDir(cwd: string): Effect<string, ProjectMemoryPathError>` returning `<projectMemoryDir>/<sha256(projectKey).slice(0,16)>`.

- [ ] **Step 1: Add `projectMemoryDir` to server paths**

In `apps/server/src/config.ts`, inside `deriveServerPaths` (~100-135) add alongside `worktreesDir` (line 122):

```ts
    projectMemoryDir: path.join(baseDir, "project-memory"),
```

Add `projectMemoryDir` to the `ServerConfig` service shape (`config.ts:56-98`) and create it in `ensureServerDirectories` (`config.ts:137-158`) next to the other `makeDirectory(..., { recursive: true })` calls.

- [ ] **Step 2: Implement the path resolver**

```ts
// apps/server/src/memory/ProjectMemoryPaths.ts
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { ServerConfig } from "../config.js";
import { RepositoryIdentityResolver } from "../project/RepositoryIdentityResolver.js";

export class ProjectMemoryPaths extends Context.Service<ProjectMemoryPaths, {
  readonly resolveStoreDir: (cwd: string) => Effect.Effect<string>;
}>()("t3/memory/ProjectMemoryPaths") {}

export const make = Effect.gen(function* () {
  const config = yield* ServerConfig;
  const identity = yield* RepositoryIdentityResolver;
  const path = yield* Path.Path;

  const resolveStoreDir = (cwd: string) =>
    Effect.gen(function* () {
      // Prefer the stable remote key; fall back to the git common dir (shared across worktrees).
      const key = yield* identity.resolveCanonicalKey(cwd).pipe(
        Effect.orElseSucceed(() => cwd), // last-resort: cwd (still deterministic, just not worktree-shared)
      );
      const hash = NodeCrypto.createHash("sha256").update(key).digest("hex").slice(0, 16);
      return path.join(config.projectMemoryDir, hash);
    });

  return ProjectMemoryPaths.of({ resolveStoreDir });
});

export const layer = Layer.effect(ProjectMemoryPaths, make).pipe(
  Layer.provide(RepositoryIdentityResolver.layer),
);
```

> Implementation note: confirm the exact accessor name on `RepositoryIdentityResolver` (the resolver exposes the canonical/remote key — see `RepositoryIdentityResolver.ts:48-88`). If it only returns a richer identity object, read `.canonicalKey` off it. For the no-remote fallback that still shares across worktrees, prefer resolving `git rev-parse --git-common-dir` via `ProcessRunner` and using its absolute path as the key instead of `cwd`.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter t3 typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/config.ts apps/server/src/memory/ProjectMemoryPaths.ts
git commit -m "feat(server): per-project shared-memory store directory keyed by repo identity"
```

---

## Task 4: Junction/symlink helper (`ensureSharedMemoryLink`)

The only file that touches Node builtins for a *write* the Effect FS can't do: a directory junction (Windows, no admin needed with type `"junction"`) or symlink (posix), from `<workspaceRoot>/.agents/memory` to the canonical store dir. This is what makes the memory readable by a CLI launched outside T3 Code.

**Files:**
- Create: `apps/server/src/memory/linkSharedMemory.ts`
- Test: `apps/server/src/memory/SharedProjectMemory.test.ts` covers it via the service (real temp dirs)

**Interfaces:**
- Produces: `ensureSharedMemoryLink(linkPath: string, targetDir: string): Effect<void, SharedMemoryLinkError>` — idempotent: if `linkPath` already points at `targetDir`, no-op; if it exists wrong, replace it; creates parent `.agents/` as needed. If the workspace already has a **real** (non-link) `memory` dir there, do NOT overwrite — fail soft (log + skip) so we never clobber user files.

- [ ] **Step 1: Implement**

```ts
// apps/server/src/memory/linkSharedMemory.ts
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export class SharedMemoryLinkError extends Schema.TaggedError<SharedMemoryLinkError>()(
  "SharedMemoryLinkError",
  { linkPath: Schema.String, reason: Schema.String },
) {}

const linkType = NodeOS.platform() === "win32" ? "junction" : "dir";

export const ensureSharedMemoryLink = (linkPath: string, targetDir: string) =>
  Effect.tryPromise({
    try: async () => {
      const current = await NodeFSP.readlink(linkPath).catch(() => null);
      if (current !== null) {
        const resolved = await NodeFSP.realpath(linkPath).catch(() => null);
        const wanted = await NodeFSP.realpath(targetDir).catch(() => targetDir);
        if (resolved === wanted) return; // already correct
        await NodeFSP.rm(linkPath, { recursive: false, force: true });
      } else {
        // If a REAL directory/file sits there, never clobber it.
        const stat = await NodeFSP.lstat(linkPath).catch(() => null);
        if (stat) throw new Error("path exists and is not our link");
      }
      await NodeFSP.mkdir(targetDir, { recursive: true });
      await NodeFSP.symlink(targetDir, linkPath, linkType);
    },
    catch: (cause) => new SharedMemoryLinkError({ linkPath, reason: String(cause) }),
  });
```

- [ ] **Step 2: Typecheck + lint (verify namespace-import rule)**

Run: `pnpm --filter t3 typecheck && pnpm lint`
Expected: PASS — `NodeFSP` / `NodeOS` aliases satisfy `t3code/namespace-node-imports`.

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/memory/linkSharedMemory.ts
git commit -m "feat(server): idempotent junction/symlink helper for shared memory (never clobbers real files)"
```

---

## Task 5: `SharedProjectMemory` service (read sources → aggregate → write + link)

The heart: reads MVP native sources, runs the pure aggregator, writes the canonical dir, ensures the workspace junction, and exposes the rendered digest for injection.

**Files:**
- Create: `apps/server/src/memory/SharedMemorySources.ts`
- Create: `apps/server/src/memory/SharedProjectMemory.ts`
- Test: `apps/server/src/memory/SharedProjectMemory.test.ts`

**Interfaces:**
- Consumes: `FileSystem`, `Path`, `ProjectMemoryPaths` (Task 3), `aggregateSharedMemory` + `RawMemoryRecord` (Task 2), `ensureSharedMemoryLink` (Task 4).
- Produces:
  - `SharedMemorySources.collectSourceDirs(workspaceRoot: string): ReadonlyArray<{ provider: string; dir: string }>` — MVP: `{ provider: "claude", dir: <workspaceRoot>/.claude/memory }`, `{ provider: "codex", dir: <codexHome>/memories }` (codexHome default `~/.codex`; see `Drivers/CodexHomeLayout.ts:36-42`).
  - service `SharedProjectMemory` with:
    - `refresh(cwd: string): Effect<SharedMemorySnapshot>` — read sources, aggregate (cap = `MAX_SHARED_MEMORY_BYTES = 16_384`), write `<storeDir>/MEMORY.md` and one file per entry under `<storeDir>/entries/`, ensure link `<cwd>/.agents/memory` → `<storeDir>`, return snapshot.
    - `read(cwd: string): Effect<string>` — `refresh` then return `snapshot.markdown` (MVP refreshes on read; Phase 2 caches + watches).

- [ ] **Step 1: Write the failing service test**

```ts
// apps/server/src/memory/SharedProjectMemory.test.ts
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { NodeServices } from "@effect/platform-node/NodeServices";
import { it, expect } from "@effect/vitest";
import { ServerConfig } from "../config.js";
import { SharedProjectMemory } from "./SharedProjectMemory.js";

// TestLayer: SharedProjectMemory over real FS + a temp base dir (see WorkspaceFileSystem.test.ts for the pattern).
const TestLayer = /* compose SharedProjectMemory.layer with ProjectMemoryPaths.layer,
                     ServerConfig.layerTest(process.cwd(), { prefix: "t3-shared-memory-test-" }),
                     and NodeServices.layer — mirror WorkspaceFileSystem.test.ts:15-31 */ Layer.empty;

it.layer(TestLayer, { excludeTestServices: true })("SharedProjectMemory", (it) => {
  it.effect("aggregates a Claude native memory file into the canonical digest", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const ws = yield* fs.makeTempDirectoryScoped({ prefix: "ws-" });
      const claudeMem = path.join(ws, ".claude", "memory");
      yield* fs.makeDirectory(claudeMem, { recursive: true });
      yield* fs.writeFileString(path.join(claudeMem, "fact.md"), "VTC projects deploy on push to master.");

      const memory = yield* SharedProjectMemory.SharedProjectMemory;
      const digest = yield* memory.read(ws);

      expect(digest).toContain("VTC projects deploy on push to master.");
      // and the junction/file exists at the convention path:
      const linked = yield* fs.readFileString(path.join(ws, ".agents", "memory", "MEMORY.md"));
      expect(linked).toContain("VTC projects deploy on push to master.");
    }),
  );
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter t3 test run apps/server/src/memory/SharedProjectMemory.test.ts`
Expected: FAIL — service/module missing.

- [ ] **Step 3: Implement sources + service**

```ts
// apps/server/src/memory/SharedMemorySources.ts
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
export const collectSourceDirs = (workspaceRoot: string): ReadonlyArray<{ provider: string; dir: string }> => [
  { provider: "claude", dir: NodePath.join(workspaceRoot, ".claude", "memory") },
  { provider: "codex", dir: NodePath.join(NodeOS.homedir(), ".codex", "memories") },
];
```

```ts
// apps/server/src/memory/SharedProjectMemory.ts
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as DateTime from "effect/DateTime";
import type { SharedMemorySnapshot } from "@t3tools/contracts";
import { aggregateSharedMemory, type RawMemoryRecord } from "./SharedMemoryAggregation.js";
import { collectSourceDirs } from "./SharedMemorySources.js";
import { ProjectMemoryPaths } from "./ProjectMemoryPaths.js";
import { ensureSharedMemoryLink } from "./linkSharedMemory.js";

const MAX_SHARED_MEMORY_BYTES = 16_384;

export class SharedProjectMemory extends Context.Service<SharedProjectMemory, {
  readonly refresh: (cwd: string) => Effect.Effect<SharedMemorySnapshot>;
  readonly read: (cwd: string) => Effect.Effect<string>;
}>()("t3/memory/SharedProjectMemory") {}

export const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const paths = yield* ProjectMemoryPaths;

  // Read every *.md file under a source dir into RawMemoryRecord[] (missing dir -> []).
  const readSource = (provider: string, dir: string) =>
    Effect.gen(function* () {
      const exists = yield* fs.exists(dir).pipe(Effect.orElseSucceed(() => false));
      if (!exists) return [] as RawMemoryRecord[];
      const names = yield* fs.readDirectory(dir).pipe(Effect.orElseSucceed(() => [] as string[]));
      const records = yield* Effect.all(
        names.filter((n) => n.endsWith(".md")).map((n) => {
          const p = path.join(dir, n);
          return Effect.gen(function* () {
            const text = yield* fs.readFileString(p).pipe(Effect.orElseSucceed(() => ""));
            const info = yield* fs.stat(p).pipe(Effect.orElseSucceed(() => null));
            const mtimeMs = info?.mtime?.pipe
              ? 0 // guard; use the real mtime accessor from FileSystem.File.Info
              : 0;
            return { provider, path: p, text, updatedAtMs: mtimeMs } satisfies RawMemoryRecord;
          });
        }),
        { concurrency: 4 },
      );
      return records;
    });

  const refresh = (cwd: string) =>
    Effect.gen(function* () {
      const storeDir = yield* paths.resolveStoreDir(cwd);
      const sources = collectSourceDirs(cwd);
      const nested = yield* Effect.all(sources.map((s) => readSource(s.provider, s.dir)), { concurrency: 4 });
      const records = nested.flat();
      const { markdown, entries } = aggregateSharedMemory(records, { maxBytes: MAX_SHARED_MEMORY_BYTES });

      yield* fs.makeDirectory(storeDir, { recursive: true });
      yield* fs.writeFileString(path.join(storeDir, "MEMORY.md"), markdown);
      yield* ensureSharedMemoryLink(path.join(cwd, ".agents", "memory"), storeDir).pipe(
        Effect.catchAll((e) => Effect.logWarning(`shared memory link skipped: ${e.reason}`)),
      );

      const readAt = yield* DateTime.now;
      return { readAt, markdown, entries } satisfies SharedMemorySnapshot;
    });

  const read = (cwd: string) => refresh(cwd).pipe(Effect.map((s) => s.markdown));

  return SharedProjectMemory.of({ refresh, read });
});

export const layer = Layer.effect(SharedProjectMemory, make).pipe(
  Layer.provide(ProjectMemoryPaths.layer),
);
```

> Implementation notes: (1) use the real mtime accessor from Effect FS `File.Info` (the `mtimeMs` placeholder above must read the actual modified time — check the `File.Info` shape; fall back to `Date.now()` only if unavailable). (2) `fs.exists` / `fs.stat` availability: confirm against `effect/FileSystem` (both exist); otherwise `readDirectory` on a missing dir already fails and is caught. (3) Writing one file per entry under `entries/` is optional for MVP — `MEMORY.md` is what gets read/injected; add per-entry files only if a later UI needs them.

- [ ] **Step 4: Fill in `TestLayer` and run to verify it passes**

Compose `TestLayer` exactly like `WorkspaceFileSystem.test.ts:15-31` (provide `SharedProjectMemory.layer`, `ServerConfig.layerTest`, `NodeServices.layer`). Then:

Run: `pnpm --filter t3 test run apps/server/src/memory/SharedProjectMemory.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/memory/SharedMemorySources.ts apps/server/src/memory/SharedProjectMemory.ts apps/server/src/memory/SharedProjectMemory.test.ts
git commit -m "feat(server): SharedProjectMemory service — aggregate native memory, write canonical digest, link into workspace"
```

---

## Task 6: Wire the service into the runtime + resolve context at the turn-send chokepoint

**Files:**
- Modify: `apps/server/src/server.ts` (~216-323) — add `SharedProjectMemoryLayerLive` and merge it.
- Modify: `apps/server/src/provider/Layers/ProviderService.ts` (~645-688) — resolve the digest once, attach to `input.sharedContext`.

**Interfaces:**
- Consumes: `SharedProjectMemory` (Task 5), the `sharedContext` field (Task 1).
- Produces: `input.sharedContext` is populated (or absent) on the `ProviderSendTurnInput` handed to `routed.adapter.sendTurn(input)`.

- [ ] **Step 1: Compose the layer**

In `apps/server/src/server.ts`, near the other `...LayerLive` (e.g. `WorkspaceFileSystemLayerLive` at :310-313):

```ts
const SharedProjectMemoryLayerLive = SharedProjectMemory.layer.pipe(
  Layer.provide(ServerConfigLayerLive), // whatever provides ServerConfig + git deps in this file
);
```
Merge `SharedProjectMemoryLayerLive` into the aggregate layer alongside the others, and ensure `ProviderService`'s layer can see `SharedProjectMemory` (add it to `ProviderService`'s provided deps).

- [ ] **Step 2: Resolve at the chokepoint**

In `apps/server/src/provider/Layers/ProviderService.ts`, inside `sendTurn` (the `resolveRoutableSession` result is `routed` at ~671-675; dispatch is `routed.adapter.sendTurn(input)` at ~688):

```ts
const sharedContext = yield* sharedProjectMemory.read(input.cwd ?? routed.cwd).pipe(
  Effect.catchAll(() => Effect.succeed("")), // memory must never block a turn
);
const enrichedInput = sharedContext.length > 0 ? { ...input, sharedContext } : input;
return yield* routed.adapter.sendTurn(enrichedInput);
```

Add `SharedProjectMemory` to this layer's requirements (yield it in the service `make`). Use whichever cwd the turn carries — confirm the field name on `ProviderSendTurnInput`/`routed`.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter t3 typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/server.ts apps/server/src/provider/Layers/ProviderService.ts
git commit -m "feat(server): resolve shared project memory once at the sendTurn chokepoint"
```

---

## Task 7: Inject `sharedContext` into each provider's proper channel

Five one-line seams. `sharedContext` is optional; when absent, behavior is unchanged. Guard each with `if (input.sharedContext)`.

**Files & exact seams:**
- `Layers/CodexSessionRuntime.ts:353` — append to `developer_instructions`.
- `Layers/ClaudeAdapter.ts:3528` — add `append` to the preset.
- `Layers/CursorAdapter.ts:963` and the twin builder in `Layers/GrokAdapter.ts` — unshift a text `ContentBlock`.
- `Layers/OpenCodeAdapter.ts:1440` — prepend to the turn text.

**Interfaces:**
- Consumes: `input.sharedContext?: string` (available on `ProviderSendTurnInput`; for Codex, thread it from `CodexAdapter.sendTurn` at `Layers/CodexAdapter.ts:1531-1563` into `runtime.sendTurn` → `buildTurnStartParams` input, since the runtime currently synthesizes instructions without it).

- [ ] **Step 1: Codex** — at `CodexSessionRuntime.ts:353-356`, wrap the developer instructions:

```ts
developer_instructions: [
  buildCodexDeveloperInstructions(input.interactionMode, { model, reasoningEffort }),
  input.sharedContext ? `<shared_project_memory>\n${input.sharedContext}\n</shared_project_memory>` : "",
].filter(Boolean).join("\n\n"),
```
(Thread `sharedContext` onto the runtime `sendTurn` input first — extend the object passed at `CodexAdapter.ts:1531-1563`.)

- [ ] **Step 2: Claude** — at `ClaudeAdapter.ts:3528`:

```ts
systemPrompt: input.sharedContext
  ? { type: "preset", preset: "claude_code", append: `<shared_project_memory>\n${input.sharedContext}\n</shared_project_memory>` }
  : { type: "preset", preset: "claude_code" },
```
Confirm the installed Claude Agent SDK's preset type accepts `append` (it does in current SDKs; if not, fall back to prepending in `buildPromptText` at `:903`).

- [ ] **Step 3: Cursor + Grok** — at `CursorAdapter.ts:963` (before pushing the user text block at 964-965), and the equivalent builder in `GrokAdapter.ts`:

```ts
if (input.sharedContext) {
  promptParts.push({ type: "text", text: `<shared_project_memory>\n${input.sharedContext}\n</shared_project_memory>` });
}
```

- [ ] **Step 4: OpenCode** — at `OpenCodeAdapter.ts:1440`, prepend before the text becomes a prompt part:

```ts
const text = [
  input.sharedContext ? `<shared_project_memory>\n${input.sharedContext}\n</shared_project_memory>` : "",
  input.input?.trim() ?? "",
].filter(Boolean).join("\n\n");
```

- [ ] **Step 5: Typecheck + lint**

Run: `pnpm tc && pnpm lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/provider/Layers/CodexSessionRuntime.ts apps/server/src/provider/Layers/CodexAdapter.ts apps/server/src/provider/Layers/ClaudeAdapter.ts apps/server/src/provider/Layers/CursorAdapter.ts apps/server/src/provider/Layers/GrokAdapter.ts apps/server/src/provider/Layers/OpenCodeAdapter.ts
git commit -m "feat(server): inject shared project memory into all five providers at turn-send"
```

---

## Verification (end-to-end)

- [ ] **Unit:** `pnpm --filter t3 test run apps/server/src/memory/` — aggregator + service pass.
- [ ] **Typecheck/lint:** `pnpm tc && pnpm lint` clean.
- [ ] **Manual loop (the real proof):**
  1. In a test git repo, launch a **Claude** thread via T3 Code, tell it a durable fact (e.g. "this repo deploys on push to master"); let it write its native memory (`<repo>/.claude/memory/…`).
  2. Confirm `<repo>/.agents/memory/MEMORY.md` now exists and contains the fact (junction + aggregation worked).
  3. Start a **Codex** thread in the same repo and ask "how does this repo deploy?" — it should answer from the injected memory without being told.
  4. From a **worktree** of the same repo, repeat step 3 — same memory is visible (shared store, not per-path).
  5. **Outside T3 Code:** open the repo with a raw CLI and confirm it can read `.agents/memory/MEMORY.md`.
- [ ] **Dedup/size:** write the same fact from two providers → one bullet in `MEMORY.md`; write >16 KB of facts → oldest evicted, newest retained.

---

## Task 8: Live watcher + cached snapshot (drop refresh-on-turn)

Replace the on-turn refresh with a debounced `FileSystem.watch` over each project's source dirs, caching the latest snapshot. `read` then returns the cache (cheap, no re-scan every turn); the watcher keeps it current between turns.

**Files:**
- Modify: `apps/server/src/memory/SharedProjectMemory.ts`
- Test: `apps/server/src/memory/SharedProjectMemory.test.ts` (add a watcher case)

**Interfaces:**
- Consumes: `Scope`, `effect/Ref`, the existing `refresh`.
- Produces: internal `cacheRef: Ref<Map<string /*storeDir*/, SharedMemorySnapshot>>` and `watchersRef: Ref<Map<string /*storeDir*/, Scope.CloseableScope>>`. `read(cwd)` now: resolve storeDir → if no watcher for it, `startWatcher(cwd, storeDir)` (which does an initial `refresh` and forks the watch loop) → return cached `markdown`.

- [ ] **Step 1: Write the failing test** — after seeding a Claude fact and calling `read`, write a *second* fact directly to the source dir, wait for the debounce, and assert the cached snapshot now contains both (mirror the debounce-wait style used where the codebase tests watchers; if watch timing is flaky in CI, assert via a direct `refresh` call instead and keep the watcher covered by the manual verification section).

- [ ] **Step 2: Implement the watcher** — model on `apps/server/src/serverSettings.ts:511-557` (scoped `fs.watch(dir)` with a debounce because events fire before content flushes, `Effect.forkIn(watcherScope)`) and the per-key scope registry of `vcs/VcsStatusBroadcaster.ts:195` (`pollersRef`). On each debounced event: `refresh(cwd)` → write result into `cacheRef`. Guard: watch only dirs that exist; re-arm if a source dir is created later.

- [ ] **Step 3: Run tests** — `pnpm --filter t3 test run apps/server/src/memory/SharedProjectMemory.test.ts` → PASS.

- [ ] **Step 4: Point the chokepoint at the cache** — no code change needed if `read` already returns the cache; confirm `ProviderService.sendTurn` (Task 6) still calls `read` and now gets the cached value.

- [ ] **Step 5: Commit** — `git commit -m "feat(server): watch native memory dirs, cache the shared snapshot"`

---

## Task 9: PubSub broadcaster + `streamMemory`

Let anything (the UI in Task 13, other services) subscribe to live memory updates instead of polling.

**Files:**
- Modify: `apps/server/src/memory/SharedProjectMemory.ts`
- Test: `apps/server/src/memory/SharedProjectMemory.test.ts`

**Interfaces:**
- Consumes: `effect/PubSub`, `effect/Stream`.
- Produces: `streamMemory(cwd: string): Effect<Stream<SharedMemorySnapshot>>` — emits the current cached snapshot immediately, then every update. Backed by a `PubSub<{ storeDir: string; snapshot: SharedMemorySnapshot }>` published from the watcher (Task 8, Step 2).

- [ ] **Step 1: Failing test** — subscribe via `streamMemory`, take the first element, assert it equals the current snapshot; then mutate a source file and assert a second element arrives with the new content (pattern: `vcs/VcsStatusBroadcaster.ts:556-586` `streamStatus` + `:187-190` PubSub).

- [ ] **Step 2: Implement** — add the `PubSub` (bounded, drop-oldest), publish in the watcher's post-refresh step, and `streamMemory` = `Stream.concat(Stream.fromEffect(currentSnapshot), Stream.filter(PubSub.subscribe by storeDir))`.

- [ ] **Step 3: Run tests → PASS. Step 4: Commit** — `git commit -m "feat(server): PubSub + streamMemory for live shared-memory updates"`

---

## Task 10: Expand native sources (user-scope + guardrails)

**Files:**
- Modify: `apps/server/src/memory/SharedMemorySources.ts`
- Test: `apps/server/src/memory/SharedMemoryAggregation.test.ts` is unaffected; add a `SharedMemorySources.test.ts` (pure, no I/O) asserting the returned dir list.

**Interfaces:**
- Produces: `collectSourceDirs(workspaceRoot: string, opts?: { claudeConfigDir?: string; codexHome?: string }): ReadonlyArray<{ provider: string; dir: string }>`.

- [ ] **Step 1** — add sources: Claude user-scope memory under `claudeConfigDir ?? ~/.claude` (resolve via the same precedence as `Drivers/ClaudeSkills.ts:64-84`), and confirm Codex home-scope (`codexHome ?? ~/.codex`/`memories`, per `Drivers/CodexHomeLayout.ts:36-42`).
- [ ] **Step 2 — GUARDRAIL (critical):** never include the junctioned store itself (`<workspaceRoot>/.agents/memory`) or the write-back file's own store as a source — that would re-ingest the digest and double-count. Add an explicit exclusion + a unit test proving `.agents/memory` is never returned.
- [ ] **Step 3 — scoping note:** Claude user-scope memory in a per-project layout (`~/.claude/projects/<slug>/memory`) is per-project and safe; a *global* `~/.claude/CLAUDE.md` is cross-project — only ingest per-project subtrees, not global files, to avoid leaking one project's facts into another. Encode this as: only read dirs that resolve under a per-project path, and unit-test the exclusion.
- [ ] **Step 4: Run tests → PASS. Step 5: Commit** — `git commit -m "feat(server): add user-scope memory sources with cross-project guardrails"`

---

## Task 11: All-provider write-back via a shared notes file

Give the providers with **no** native memory (Cursor, Grok, OpenCode) a way to *contribute*, uniformly and using only their normal file-editing tools (the Q4 insight: every provider can edit a file). A plain `<workspaceRoot>/.agents/notes.md` (NOT the junctioned store) is the shared write target; the aggregator reads it as source `provider: "shared"`.

**Files:**
- Modify: `apps/server/src/memory/SharedMemorySources.ts` (add `.agents/notes.md` as a source — a single file, not a dir)
- Modify: the injected-context builder used at the chokepoint (Task 6) / `SharedProjectMemory.read` output
- Modify: `apps/server/src/memory/SharedProjectMemory.ts` (`readSource` must also accept a single-file source)

**Interfaces:**
- Consumes: existing `RawMemoryRecord`.
- Produces: the injected `sharedContext` string gains a trailer instruction: `To record a durable fact visible to every tool, append one bullet to .agents/notes.md`.

- [ ] **Step 1** — extend `readSource` to handle a file path (not just a directory): if the source is a file, read it and split into records per bullet/paragraph (use the file mtime for `updatedAtMs`).
- [ ] **Step 2** — append the write-back instruction to the rendered digest (so it rides the injection to every provider). Keep it one sentence to stay within the byte budget.
- [ ] **Step 3 — failing test** — seed `.agents/notes.md` with two bullets, assert both appear as entries with `provider: "shared"`, and assert `.agents/notes.md` is watched (Task 8) so a Cursor-written note shows up live.
- [ ] **Step 4: Run tests → PASS. Step 5: Commit** — `git commit -m "feat(server): shared notes.md write-back so ACP providers contribute to memory"`

---

## Task 12: `AGENTS.md` reference (verify-then-wire)

Make the memory readable out-of-T3-Code natively — not only via the junction — by referencing it from `AGENTS.md`. **This task is gated on a verification** and must not fabricate behavior.

**Files:**
- Modify (conditionally): the repo's `AGENTS.md` handling — but note the SERVER never writes `AGENTS.md` today; this is a one-time content convention, not server code.

- [ ] **Step 1 — VERIFY FIRST:** confirm whether Codex CLI and OpenCode actually load a file referenced/`@import`-ed from `AGENTS.md`. Use context7 for Codex CLI and OpenCode docs; if unclear, run a tiny local probe (a repo whose `AGENTS.md` references a file with a canary fact, then check whether the CLI surfaces it). Record the finding in the plan/PR.
- [ ] **Step 2 — if supported:** add a stable one-line reference in `AGENTS.md` pointing at `.agents/memory/MEMORY.md` (the junctioned digest). Claude already picks it up via the `CLAUDE.md → AGENTS.md` pointer.
- [ ] **Step 3 — if NOT supported:** do nothing to `AGENTS.md`; document in the PR that injection is the sole in-session path and the junctioned file is the out-of-band path for tools that read `.agents/` directly. Do **not** invent an import mechanism.
- [ ] **Step 4: Commit** — `git commit -m "docs/feat: reference shared memory from AGENTS.md (or document why not)"`

---

## Task 13: Client "Project Memory" panel (web + shared)

A panel that subscribes to `streamMemory` (Task 9) and shows the live entry list (text + provider + age), with **pin** and **delete** controls. The server-side of pin/delete is added here too (a pinned entry is exempt from size-eviction; a deleted entry is tombstoned so it doesn't re-aggregate).

**This task MUST begin with a client exploration** — the patterns were not captured during planning (session limit). Do not fabricate UI code.

- [ ] **Step 1 — Explore the clients FIRST.** Dispatch an Explore agent (or explore directly) over `apps/web` (primary), `apps/desktop`, `apps/mobile` and answer, with file:line: (a) client↔server transport and how a client subscribes to a server-pushed **stream** (find one existing live subscription end-to-end, e.g. git status or provider status); (b) how a **panel/tab** is registered and rendered, and where a new "Project Memory" panel slots; (c) the **mutation** pattern (client call site + server handler registration) to model pin/delete on; (d) the state lib (React Query / Zustand / Effect / custom); (e) whether panels are **shared** across web/desktop/mobile (a `packages/` UI lib or `client-runtime`) or per-client. Write the findings into this task before coding.

- [ ] **Step 2 — Server: expose `streamMemory` over the transport.** Register a subscription/RPC method that wraps `SharedProjectMemory.streamMemory(cwd)`, following the exact stream-RPC pattern found in Step 1 (the same one git-status/provider-status uses). Add the contract types in `packages/contracts` next to the existing snapshot schema.

- [ ] **Step 3 — Server: pin/delete.** Add `pinEntry(cwd, key)` / `deleteEntry(cwd, key)` to `SharedProjectMemory`: persist pins + tombstones (a small JSON beside the store dir, `<storeDir>/overrides.json`), have the aggregator (Task 2) accept `pinnedKeys`/`tombstonedKeys` — pinned entries skip size-eviction, tombstoned keys are dropped even if a source still contains them. Add unit tests to `SharedMemoryAggregation.test.ts` for both. Register the two mutations over the transport (pattern from Step 1c).

- [ ] **Step 4 — Client: the panel.** Build the panel matching Step 1's patterns: subscribe to the memory stream, render entries (text, provider badge, relative age), wire pin/delete buttons to the mutations. Put it in the shared location if one exists (Step 1e), else in `apps/web` first.

- [ ] **Step 5 — Verify + commit.** `pnpm tc && pnpm lint`; manually open the panel, confirm live updates when an agent writes memory, and that pin survives eviction / delete removes an entry. `git commit -m "feat: live Project Memory panel with pin/delete"`

---

## Open items to confirm during implementation (facts, not decisions)

1. `RepositoryIdentityResolver` accessor name for the canonical/remote key, and the no-remote fallback via `git rev-parse --git-common-dir` (Task 3).
2. Effect `FileSystem.File.Info` mtime accessor for last-writer-wins ordering (Task 5).
3. Claude Agent SDK preset `append` support (Task 7 Step 2) — else prepend in `buildPromptText`.
4. Whether Codex/opencode natively load a file referenced from `AGENTS.md` (Task 12; injection already covers in-session regardless).

## Explicitly deferred (needs its own decision, not built here)

- **Semantic dedup:** Tasks 2/10 dedup by whitespace-normalized content hash — cheap and exact-match only. True semantic dedup ("two paraphrases of the same fact") needs an embeddings model (dependency + latency + cost choice). Decide the approach before building; keep hash dedup until then.

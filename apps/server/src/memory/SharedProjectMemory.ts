import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import type { SharedMemorySnapshot } from "@t3tools/contracts";

import { ensureSharedMemoryLink } from "./linkSharedMemory.ts";
import * as ProjectMemoryPaths from "./ProjectMemoryPaths.ts";
import { aggregateSharedMemory, type RawMemoryRecord } from "./SharedMemoryAggregation.ts";
import { collectSourceDirs, type SharedMemorySource } from "./SharedMemorySources.ts";

const MAX_SHARED_MEMORY_BYTES = 16_384;

// One sentence, appended (never counted against MAX_SHARED_MEMORY_BYTES,
// which budgets aggregated *entries* only) to every digest so it rides the
// injection to every provider, including a brand-new project with zero
// entries yet -- that is the case where a provider most needs to learn how
// to contribute. Providers with no native memory of their own (Cursor, Grok,
// OpenCode, ...) can still edit a file, so `.agents/notes.md` is a uniform
// write-back target any of them can append a bullet to.
const NOTES_TRAILER =
  "To record a durable fact visible to every AI tool in this project, append one bullet to .agents/notes.md.";

/**
 * Splits the contents of the shared `.agents/notes.md` write-back file into
 * one record per non-empty line, stripping a leading `- `/`* ` bullet
 * marker if present. Line-based (not paragraph-based): matches how the
 * file is documented and seeded elsewhere (one bullet per line), and keeps
 * a provider's raw, unmarked line ("Fact one") equally valid to a markdown
 * bullet ("- Fact one") -- either just becomes one record's `text`.
 * Pure and exported so it can be exercised without the Effect FileSystem
 * service (see the task report for a standalone `node` check).
 */
export function splitNotesFileText(text: string): ReadonlyArray<string> {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^[-*]\s+/, ""))
    .filter((line) => line.length > 0);
}

// Watch events fire before the writer has finished flushing content to disk
// (same reasoning as serverSettings.ts's settings-file watcher), so debounce
// before re-aggregating.
const WATCH_DEBOUNCE = Duration.millis(300);

/**
 * SharedProjectMemory - Aggregates native per-provider memory (Claude, Codex,
 * ...) into a single canonical digest per project, and links it into the
 * workspace at `.agents/memory` so any provider can read it uniformly.
 *
 * `read` is a cache hit: the first `read` for a given project (storeDir)
 * performs an initial `refresh` and starts a debounced `FileSystem.watch`
 * loop over that project's source dirs (Task 8); every later `read` (in this
 * turn or a later one) just returns the cached snapshot, and the watcher
 * keeps that cache current in the background.
 */
export class SharedProjectMemory extends Context.Service<
  SharedProjectMemory,
  {
    readonly refresh: (cwd: string) => Effect.Effect<SharedMemorySnapshot>;
    readonly read: (cwd: string) => Effect.Effect<string>;
    readonly streamMemory: (cwd: string) => Effect.Effect<Stream.Stream<SharedMemorySnapshot>>;
    readonly pinEntry: (cwd: string, key: string) => Effect.Effect<void>;
    readonly deleteEntry: (cwd: string, key: string) => Effect.Effect<void>;
  }
>()("t3/memory/SharedProjectMemory") {}

interface SharedMemoryUpdate {
  readonly storeDir: string;
  readonly snapshot: SharedMemorySnapshot;
}

/**
 * User overrides persisted at `<storeDir>/overrides.json` -- entries the user
 * explicitly pinned (exempt from size-eviction) or deleted (tombstoned, so a
 * source that still contains them never resurfaces the entry). Keyed by the
 * aggregator's `contentKey`, same as `SharedMemoryEntry["key"]`.
 */
interface MemoryOverrides {
  readonly pinnedKeys: ReadonlyArray<string>;
  readonly tombstonedKeys: ReadonlyArray<string>;
}

const EMPTY_OVERRIDES: MemoryOverrides = { pinnedKeys: [], tombstonedKeys: [] };

const isStringArray = (value: unknown): value is ReadonlyArray<string> =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

// Defensive shape guard for the parsed JSON -- anything that isn't exactly
// `{ pinnedKeys: string[]; tombstonedKeys: string[] }` is treated as absent
// rather than partially trusted, so a hand-edited or half-written file can't
// smuggle in a non-string key.
const parseOverrides = (text: string): MemoryOverrides => {
  const parsed: unknown = JSON.parse(text);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !isStringArray((parsed as Record<string, unknown>).pinnedKeys) ||
    !isStringArray((parsed as Record<string, unknown>).tombstonedKeys)
  ) {
    return EMPTY_OVERRIDES;
  }
  const record = parsed as { pinnedKeys: ReadonlyArray<string>; tombstonedKeys: ReadonlyArray<string> };
  return { pinnedKeys: record.pinnedKeys, tombstonedKeys: record.tombstonedKeys };
};

export const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const paths = yield* ProjectMemoryPaths.ProjectMemoryPaths;

  // Owns every per-storeDir watcher's child scope; closed (interrupting all
  // watcher fibers) when the service layer's own scope closes. Mirrors
  // VcsStatusBroadcaster's `broadcasterScope` (vcs/VcsStatusBroadcaster.ts) --
  // `Layer.effect` already runs `make` inside the layer's own scope, so
  // `Effect.acquireRelease` here registers its finalizer there without the
  // layer having to become `Layer.scoped`.
  const watcherLifetimeScope = yield* Effect.acquireRelease(Scope.make(), (scope) =>
    Scope.close(scope, Exit.void),
  );

  const cacheRef = yield* Ref.make(new Map<string, SharedMemorySnapshot>());
  const watchersRef = yield* Ref.make(new Map<string, Scope.Closeable>());

  // Broadcasts every cache update (initial refresh and every watcher-triggered
  // refresh) so `streamMemory` subscribers see live updates instead of
  // polling. Bounded + sliding (drop-oldest): mirrors VcsStatusBroadcaster's
  // `changesPubSub` (vcs/VcsStatusBroadcaster.ts:187-190) -- a slow
  // subscriber should lose stale snapshots, not block `refresh`, and a
  // subscriber that misses an update still catches up via the cache read
  // `streamMemory` does before subscribing. Capacity 8 matches this repo's
  // other single-snapshot-per-key broadcast PubSubs (e.g.
  // resourceTelemetry/ResourceTelemetry.ts:150).
  const updatesPubSub = yield* Effect.acquireRelease(
    PubSub.sliding<SharedMemoryUpdate>(8),
    (pubsub) => PubSub.shutdown(pubsub),
  );

  const readEntry = (provider: string, dir: string, name: string) =>
    Effect.gen(function* () {
      const filePath = path.join(dir, name);
      const text = yield* fs.readFileString(filePath).pipe(Effect.orElseSucceed(() => ""));
      const info = yield* fs.stat(filePath).pipe(Effect.option);
      const mtimeMs = info.pipe(
        Option.flatMap((fileInfo) => fileInfo.mtime),
        Option.map((mtime) => mtime.getTime()),
        Option.getOrElse(() => 0),
      );
      return { provider, path: filePath, text, updatedAtMs: mtimeMs } satisfies RawMemoryRecord;
    });

  // Read every *.md file under a source dir into RawMemoryRecord[] (missing dir -> []).
  const readDirSource = (provider: string, dir: string) =>
    Effect.gen(function* () {
      const exists = yield* fs.exists(dir).pipe(Effect.orElseSucceed(() => false));
      if (!exists) return [] as ReadonlyArray<RawMemoryRecord>;

      const names = yield* fs.readDirectory(dir).pipe(Effect.orElseSucceed(() => [] as string[]));

      return yield* Effect.all(
        names.filter((name) => name.endsWith(".md")).map((name) => readEntry(provider, dir, name)),
        { concurrency: 4 },
      );
    });

  // Read a single-file source (currently only the shared `.agents/notes.md`
  // write-back target) into RawMemoryRecord[] (missing file -> []): one
  // record per non-empty line via `splitNotesFileText`, all sharing the
  // file's own mtime as `updatedAtMs` (there is no per-line timestamp).
  const readFileSource = (provider: string, filePath: string) =>
    Effect.gen(function* () {
      const exists = yield* fs.exists(filePath).pipe(Effect.orElseSucceed(() => false));
      if (!exists) return [] as ReadonlyArray<RawMemoryRecord>;

      const text = yield* fs.readFileString(filePath).pipe(Effect.orElseSucceed(() => ""));
      const info = yield* fs.stat(filePath).pipe(Effect.option);
      const updatedAtMs = info.pipe(
        Option.flatMap((fileInfo) => fileInfo.mtime),
        Option.map((mtime) => mtime.getTime()),
        Option.getOrElse(() => 0),
      );

      return splitNotesFileText(text).map(
        (line): RawMemoryRecord => ({ provider, path: filePath, text: line, updatedAtMs }),
      );
    });

  // Dispatches a source to the dir- or file-shaped reader per its `kind`
  // (Task 11 generalizes the original dir-only `readSource`).
  const readSource = (source: SharedMemorySource) =>
    source.kind === "file"
      ? readFileSource(source.provider, source.dir)
      : readDirSource(source.provider, source.dir);

  const overridesFilePath = (storeDir: string) => path.join(storeDir, "overrides.json");

  // Reads `<storeDir>/overrides.json` defensively: a missing file, an
  // unreadable file, or malformed/mis-shaped JSON all degrade to
  // `EMPTY_OVERRIDES` rather than crashing a turn -- same "memory
  // augmentation must never block or crash a turn" reasoning as every other
  // best-effort fs operation in this file. `fs.readFileString` failing
  // (missing file being the common case) and `parseOverrides` throwing
  // (corrupt JSON or wrong shape, caught by `Effect.try`) both land in the
  // error channel here, so a single `Effect.orElseSucceed` covers both.
  const readOverrides = (storeDir: string) =>
    Effect.gen(function* () {
      const text = yield* fs.readFileString(overridesFilePath(storeDir));
      return yield* Effect.try(() => parseOverrides(text));
    }).pipe(Effect.orElseSucceed(() => EMPTY_OVERRIDES));

  // Persists overrides best-effort, mirroring the MEMORY.md store-write
  // pattern below: `Effect.catch` recovers the error channel (a write
  // failure just logs and degrades) without risking a defect via `orDie`.
  const writeOverrides = (storeDir: string, overrides: MemoryOverrides) =>
    Effect.gen(function* () {
      yield* fs.makeDirectory(storeDir, { recursive: true });
      yield* fs.writeFileString(overridesFilePath(storeDir), JSON.stringify(overrides));
    }).pipe(
      Effect.catch((cause) => Effect.logWarning(`shared memory overrides write skipped: ${cause}`)),
    );

  const refresh = (cwd: string) =>
    Effect.gen(function* () {
      const storeDir = yield* paths.resolveStoreDir(cwd);
      const sources = collectSourceDirs(cwd);
      const nested = yield* Effect.all(
        sources.map((source) => readSource(source)),
        { concurrency: 4 },
      );
      const records = nested.flat();
      const overrides = yield* readOverrides(storeDir);
      const { markdown: aggregatedMarkdown, entries } = aggregateSharedMemory(records, {
        maxBytes: MAX_SHARED_MEMORY_BYTES,
        pinnedKeys: new Set(overrides.pinnedKeys),
        tombstonedKeys: new Set(overrides.tombstonedKeys),
      });

      // Append the write-back trailer to every digest, even an empty one --
      // see `NOTES_TRAILER`'s comment for why "always" was chosen over
      // "only when there's at least one entry". `entries` (the structured
      // list persisted in the snapshot) stays clean; the trailer lives only
      // in the rendered `markdown` string, which is what actually gets
      // injected into every provider's context and persisted to
      // `<storeDir>/MEMORY.md` below. That store path is excluded from
      // `collectSourceDirs` by guardrail A, so the trailer (and the facts
      // around it) can never be re-ingested as a source on the next
      // `refresh` -- no feedback loop.
      const markdown =
        aggregatedMarkdown.length === 0
          ? NOTES_TRAILER
          : `${aggregatedMarkdown}\n${NOTES_TRAILER}`;

      // Persisting the canonical digest is best-effort: memory augmentation must
      // never block or crash a turn, so a write failure (full/read-only disk,
      // permissions) degrades to a logged warning while `refresh` still returns
      // the freshly aggregated snapshot. `Effect.catch` recovers the error
      // channel here (it would NOT catch a defect, so we must not `orDie`).
      yield* Effect.gen(function* () {
        yield* fs.makeDirectory(storeDir, { recursive: true });
        yield* fs.writeFileString(path.join(storeDir, "MEMORY.md"), markdown);
      }).pipe(
        Effect.catch((cause) => Effect.logWarning(`shared memory store write skipped: ${cause}`)),
      );

      // The workspace junction is a convenience for providers that only read
      // local files; losing it must never fail the refresh itself.
      yield* ensureSharedMemoryLink(path.join(cwd, ".agents", "memory"), storeDir).pipe(
        Effect.catch((error) => Effect.logWarning(`shared memory link skipped: ${error.reason}`)),
      );

      const readAt = yield* DateTime.now;
      const snapshot = { readAt, markdown, entries } satisfies SharedMemorySnapshot;

      // `refresh` is the single place that writes the cache: the initial,
      // watcher-triggered refresh below, the fallback direct refresh in
      // `read`, and any other future caller of `refresh` all keep the cache
      // for this storeDir in lockstep with the latest aggregation.
      yield* Ref.update(cacheRef, (cache) => new Map(cache).set(storeDir, snapshot));

      // Fire-and-forget broadcast for `streamMemory` subscribers. `PubSub.publish`
      // returns `Effect<boolean, never>` (whether the value was accepted) --
      // it cannot fail, and `PubSub.sliding` never suspends waiting for room,
      // so this can never make `refresh` fail or block. The boolean is
      // discarded: a `false` (all subscribers currently backlogged and shut
      // down) is not actionable here.
      yield* PubSub.publish(updatesPubSub, { storeDir, snapshot }).pipe(Effect.asVoid);

      return snapshot;
    });

  // Debounced fs.watch loop for one existing source path -- a dir (native
  // per-provider memory) or a single file (the shared `.agents/notes.md`
  // write-back target, Task 11) -- forked into the storeDir's own child
  // scope. `fs.watch` accepts either a directory or a file path, so this is
  // shared by both kinds without any branching. Mirrors
  // serverSettings.ts:511-548's settings watcher: `fs.watch` events fire
  // before the writer has flushed content, so debounce before
  // re-aggregating, and consume the stream with `Stream.runForEach` forked
  // via `Effect.forkIn`.
  //
  // Deliberately watches `notes.md` itself, never the parent `.agents/`
  // dir: `.agents/` also contains the `memory` junction that `refresh`
  // below writes through, so watching the directory would fire on our own
  // writes and create a refresh -> write -> refresh feedback loop. Watching
  // the file directly only reacts to edits to `notes.md` itself.
  const watchSourcePath = (cwd: string, sourcePath: string, scope: Scope.Closeable) =>
    Stream.runForEach(fs.watch(sourcePath).pipe(Stream.debounce(WATCH_DEBOUNCE)), () =>
      refresh(cwd).pipe(Effect.asVoid),
    ).pipe(
      // A watch loop dying should never take the process (or `read`) down
      // with it -- log and let this one source path simply stop being watched.
      Effect.ignoreCause({ log: true }),
      Effect.forkIn(scope),
    );

  // First read for a storeDir: do a synchronous initial refresh (so `read`
  // is correct even before any filesystem event fires) then fork a debounced
  // watch loop per existing source dir into a child of `watcherLifetimeScope`,
  // registered in `watchersRef` under `storeDir` so later `read`s skip this.
  const startWatcher = (cwd: string, storeDir: string) =>
    Effect.gen(function* () {
      const scope = yield* Scope.fork(watcherLifetimeScope);
      yield* Ref.update(watchersRef, (watchers) => new Map(watchers).set(storeDir, scope));

      // Populates cacheRef for this storeDir; see the comment in `refresh`.
      yield* refresh(cwd);

      // Only watch source paths that exist right now -- dirs and the
      // single-file `notes.md` source alike, `fs.exists` works on both. A
      // source created later (a native memory dir, or a `notes.md` a
      // provider hasn't written yet) is picked up on the next process
      // restart, not live -- re-arming would need its own watch on the
      // parent dir to notice the child's creation, which is more machinery
      // than this MVP needs (documented limitation, not implemented).
      const sources = collectSourceDirs(cwd);
      const existingSources = yield* Effect.filter(sources, (source) =>
        fs.exists(source.dir).pipe(Effect.orElseSucceed(() => false)),
      );

      yield* Effect.forEach(existingSources, (source) => watchSourcePath(cwd, source.dir, scope), {
        discard: true,
      });
    });

  // Shared by `read` and `streamMemory`: starts the per-storeDir watcher
  // (initial refresh + debounced fs.watch loop) the first time either is
  // called for a given project, so updates actually flow into both the
  // polled `read` cache hit and any live `streamMemory` subscriber. A no-op
  // once `watchersRef` already has an entry for `storeDir`.
  const ensureWatcherStarted = (cwd: string, storeDir: string) =>
    Effect.gen(function* () {
      const watchers = yield* Ref.get(watchersRef);
      if (watchers.has(storeDir)) return;

      // Memory augmentation must never block or crash a turn: if starting
      // the watcher fails for any reason, degrade to a logged warning and
      // fall through to the (not yet populated) cache -- callers each have
      // their own direct-refresh fallback for that case. `Effect.catch`
      // recovers the error channel -- `startWatcher` does not defect, so
      // this is defensive.
      yield* startWatcher(cwd, storeDir).pipe(
        Effect.catch((cause) => Effect.logWarning(`shared memory watcher start skipped: ${cause}`)),
      );
    });

  const read = (cwd: string) =>
    Effect.gen(function* () {
      const storeDir = yield* paths.resolveStoreDir(cwd);
      yield* ensureWatcherStarted(cwd, storeDir);

      const cache = yield* Ref.get(cacheRef);
      const cached = cache.get(storeDir);
      if (cached) {
        return cached.markdown;
      }

      // Cache miss (the watcher failed to start before its initial refresh
      // could populate the cache): fall back to a direct, uncached refresh so
      // `read` is still correct this turn.
      return yield* refresh(cwd).pipe(Effect.map((snapshot) => snapshot.markdown));
    });

  // Emits the current cached snapshot for `cwd`'s storeDir immediately, then
  // every later update published from `refresh` (watcher-triggered or
  // direct), filtered to this storeDir. Mirrors VcsStatusBroadcaster's
  // `streamStatus` (vcs/VcsStatusBroadcaster.ts:556-586): subscribe to the
  // PubSub *before* reading the "current" value (and before ensuring the
  // watcher is running, which may itself publish) so an update landing in
  // that window is never lost -- at worst it is briefly duplicated (the same
  // snapshot as both the "current" value and the first live update), which
  // is harmless for a live-state subscriber. The setup itself (resolving
  // storeDir, subscribing, reading the cache) is deferred via `Stream.unwrap`
  // to when the stream is actually pulled, exactly like `streamStatus` --
  // `streamMemory` itself just returns that lazy stream, so it cannot fail
  // and needs no requirements of its own.
  const streamMemory: SharedProjectMemory["Service"]["streamMemory"] = (cwd) =>
    Effect.succeed(
      Stream.unwrap(
        Effect.gen(function* () {
          const storeDir = yield* paths.resolveStoreDir(cwd);
          const subscription = yield* PubSub.subscribe(updatesPubSub);

          yield* ensureWatcherStarted(cwd, storeDir);

          const cache = yield* Ref.get(cacheRef);
          const cached = cache.get(storeDir);
          // Cache miss (watcher failed to start before its initial refresh
          // could populate the cache, same as `read`'s fallback): refresh
          // directly so the stream's first element is still correct.
          const currentSnapshot = cached ? Effect.succeed(cached) : refresh(cwd);

          return Stream.concat(
            Stream.fromEffect(currentSnapshot),
            Stream.fromSubscription(subscription).pipe(
              Stream.filter((update) => update.storeDir === storeDir),
              Stream.map((update) => update.snapshot),
            ),
          );
        }),
      ),
    );

  const withKey = (keys: ReadonlyArray<string>, key: string) =>
    keys.includes(key) ? keys : [...keys, key];

  // Pins a `contentKey` so `aggregateSharedMemory` keeps it even over
  // `MAX_SHARED_MEMORY_BYTES` (see `AggregateOptions.pinnedKeys`), then
  // `refresh`es so the cache and every `streamMemory` subscriber pick up the
  // pin immediately -- same "read overrides, mutate, persist, refresh"
  // shape as `deleteEntry` below.
  const pinEntry = (cwd: string, key: string) =>
    Effect.gen(function* () {
      const storeDir = yield* paths.resolveStoreDir(cwd);
      const overrides = yield* readOverrides(storeDir);
      yield* writeOverrides(storeDir, {
        ...overrides,
        pinnedKeys: withKey(overrides.pinnedKeys, key),
      });
      yield* refresh(cwd);
    });

  // Tombstones a `contentKey` so `aggregateSharedMemory` drops it even if a
  // source still contains it (see `AggregateOptions.tombstonedKeys`), then
  // `refresh`es so the deletion is reflected immediately, live.
  const deleteEntry = (cwd: string, key: string) =>
    Effect.gen(function* () {
      const storeDir = yield* paths.resolveStoreDir(cwd);
      const overrides = yield* readOverrides(storeDir);
      yield* writeOverrides(storeDir, {
        ...overrides,
        tombstonedKeys: withKey(overrides.tombstonedKeys, key),
      });
      yield* refresh(cwd);
    });

  return SharedProjectMemory.of({ refresh, read, streamMemory, pinEntry, deleteEntry });
});

export const layer = Layer.effect(SharedProjectMemory, make).pipe(
  Layer.provide(ProjectMemoryPaths.layer),
);

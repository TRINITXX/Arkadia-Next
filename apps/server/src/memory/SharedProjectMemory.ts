import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import type { SharedMemorySnapshot } from "@t3tools/contracts";

import { ensureSharedMemoryLink } from "./linkSharedMemory.ts";
import * as ProjectMemoryPaths from "./ProjectMemoryPaths.ts";
import { aggregateSharedMemory, type RawMemoryRecord } from "./SharedMemoryAggregation.ts";
import { collectSourceDirs } from "./SharedMemorySources.ts";

const MAX_SHARED_MEMORY_BYTES = 16_384;

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
  }
>()("t3/memory/SharedProjectMemory") {}

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
  const readSource = (provider: string, dir: string) =>
    Effect.gen(function* () {
      const exists = yield* fs.exists(dir).pipe(Effect.orElseSucceed(() => false));
      if (!exists) return [] as ReadonlyArray<RawMemoryRecord>;

      const names = yield* fs.readDirectory(dir).pipe(Effect.orElseSucceed(() => [] as string[]));

      return yield* Effect.all(
        names.filter((name) => name.endsWith(".md")).map((name) => readEntry(provider, dir, name)),
        { concurrency: 4 },
      );
    });

  const refresh = (cwd: string) =>
    Effect.gen(function* () {
      const storeDir = yield* paths.resolveStoreDir(cwd);
      const sources = collectSourceDirs(cwd);
      const nested = yield* Effect.all(
        sources.map((source) => readSource(source.provider, source.dir)),
        { concurrency: 4 },
      );
      const records = nested.flat();
      const { markdown, entries } = aggregateSharedMemory(records, {
        maxBytes: MAX_SHARED_MEMORY_BYTES,
      });

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

      return snapshot;
    });

  // Debounced fs.watch loop for one existing source dir, forked into the
  // storeDir's own child scope. Mirrors serverSettings.ts:511-548's settings
  // watcher: `fs.watch` events fire before the writer has flushed content, so
  // debounce before re-aggregating, and consume the stream with
  // `Stream.runForEach` forked via `Effect.forkIn`.
  const watchSourceDir = (cwd: string, dir: string, scope: Scope.Closeable) =>
    Stream.runForEach(fs.watch(dir).pipe(Stream.debounce(WATCH_DEBOUNCE)), () =>
      refresh(cwd).pipe(Effect.asVoid),
    ).pipe(
      // A watch loop dying should never take the process (or `read`) down
      // with it -- log and let this one source dir simply stop being watched.
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

      // Only watch source dirs that exist right now. A source dir created
      // later is picked up on the next process restart, not live -- re-arming
      // would need its own watch on the parent dir to notice the child dir's
      // creation, which is more machinery than this MVP needs (documented
      // limitation, not implemented).
      const sources = collectSourceDirs(cwd);
      const existingSources = yield* Effect.filter(sources, (source) =>
        fs.exists(source.dir).pipe(Effect.orElseSucceed(() => false)),
      );

      yield* Effect.forEach(existingSources, (source) => watchSourceDir(cwd, source.dir, scope), {
        discard: true,
      });
    });

  const read = (cwd: string) =>
    Effect.gen(function* () {
      const storeDir = yield* paths.resolveStoreDir(cwd);
      const watchers = yield* Ref.get(watchersRef);

      if (!watchers.has(storeDir)) {
        // Memory augmentation must never block or crash a turn: if starting
        // the watcher fails for any reason, degrade to a logged warning and
        // fall through to the direct-refresh path below instead of the
        // (not yet populated) cache. `Effect.catch` recovers the error
        // channel -- `startWatcher` does not defect, so this is defensive.
        yield* startWatcher(cwd, storeDir).pipe(
          Effect.catch((cause) =>
            Effect.logWarning(`shared memory watcher start skipped: ${cause}`),
          ),
        );
      }

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

  return SharedProjectMemory.of({ refresh, read });
});

export const layer = Layer.effect(SharedProjectMemory, make).pipe(
  Layer.provide(ProjectMemoryPaths.layer),
);

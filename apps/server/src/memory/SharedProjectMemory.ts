import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import type { SharedMemorySnapshot } from "@t3tools/contracts";

import { ensureSharedMemoryLink } from "./linkSharedMemory.ts";
import * as ProjectMemoryPaths from "./ProjectMemoryPaths.ts";
import { aggregateSharedMemory, type RawMemoryRecord } from "./SharedMemoryAggregation.ts";
import { collectSourceDirs } from "./SharedMemorySources.ts";

const MAX_SHARED_MEMORY_BYTES = 16_384;

/**
 * SharedProjectMemory - Aggregates native per-provider memory (Claude, Codex,
 * ...) into a single canonical digest per project, and links it into the
 * workspace at `.agents/memory` so any provider can read it uniformly.
 *
 * MVP re-reads and re-aggregates the sources on every `refresh`/`read` call;
 * a later phase adds caching + a live filesystem watcher (see Task 8).
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

      yield* fs.makeDirectory(storeDir, { recursive: true }).pipe(Effect.orDie);
      yield* fs.writeFileString(path.join(storeDir, "MEMORY.md"), markdown).pipe(Effect.orDie);

      // The workspace junction is a convenience for providers that only read
      // local files; losing it must never fail the refresh itself.
      yield* ensureSharedMemoryLink(path.join(cwd, ".agents", "memory"), storeDir).pipe(
        Effect.catch((error) => Effect.logWarning(`shared memory link skipped: ${error.reason}`)),
      );

      const readAt = yield* DateTime.now;
      return { readAt, markdown, entries } satisfies SharedMemorySnapshot;
    });

  const read = (cwd: string) => refresh(cwd).pipe(Effect.map((snapshot) => snapshot.markdown));

  return SharedProjectMemory.of({ refresh, read });
});

export const layer = Layer.effect(SharedProjectMemory, make).pipe(
  Layer.provide(ProjectMemoryPaths.layer),
);

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import * as SharedProjectMemory from "./SharedProjectMemory.ts";

const TestLayer = Layer.empty.pipe(
  Layer.provideMerge(SharedProjectMemory.layer),
  Layer.provide(
    ServerConfig.ServerConfig.layerTest(process.cwd(), {
      prefix: "t3-shared-memory-test-",
    }),
  ),
  Layer.provideMerge(NodeServices.layer),
);

const makeTempDir = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem.makeTempDirectoryScoped({
    prefix: "t3code-shared-memory-ws-",
  });
});

it.layer(TestLayer, { excludeTestServices: true })("SharedProjectMemory", (it) => {
  it.effect(
    "aggregates a Claude native memory file into the canonical digest and links it into the workspace",
    () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const memory = yield* SharedProjectMemory.SharedProjectMemory;

        const ws = yield* makeTempDir;
        const claudeMemoryDir = path.join(ws, ".claude", "memory");
        yield* fileSystem
          .makeDirectory(claudeMemoryDir, { recursive: true })
          .pipe(Effect.orDie);
        yield* fileSystem
          .writeFileString(
            path.join(claudeMemoryDir, "fact.md"),
            "VTC projects deploy on push to master.",
          )
          .pipe(Effect.orDie);

        const digest = yield* memory.read(ws);
        expect(digest).toContain("VTC projects deploy on push to master.");

        // The `.agents/memory` junction points at the canonical store, so the
        // same digest must be readable through the workspace-local path too.
        const linked = yield* fileSystem
          .readFileString(path.join(ws, ".agents", "memory", "MEMORY.md"))
          .pipe(Effect.orDie);
        expect(linked).toContain("VTC projects deploy on push to master.");
      }),
  );

  it.effect(
    "keeps the cached snapshot current after a live filesystem watcher refresh",
    () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const memory = yield* SharedProjectMemory.SharedProjectMemory;

        const ws = yield* makeTempDir;
        const claudeMemoryDir = path.join(ws, ".claude", "memory");
        yield* fileSystem
          .makeDirectory(claudeMemoryDir, { recursive: true })
          .pipe(Effect.orDie);
        yield* fileSystem
          .writeFileString(path.join(claudeMemoryDir, "fact-1.md"), "First shared fact.")
          .pipe(Effect.orDie);

        // First `read` for this project: does the initial refresh (populating
        // the cache) and starts the debounced `fs.watch` loop over
        // `claudeMemoryDir` (Task 8). Later `read`s for the same project are
        // cache hits and no longer re-scan the source dirs.
        const firstDigest = yield* memory.read(ws);
        expect(firstDigest).toContain("First shared fact.");

        // Write a second native fact directly to the source dir, the way a
        // provider (e.g. Claude Code) would while the server keeps running.
        yield* fileSystem
          .writeFileString(path.join(claudeMemoryDir, "fact-2.md"), "Second shared fact.")
          .pipe(Effect.orDie);

        // The watcher above debounces `fs.watch` events and re-aggregates in
        // the background; waiting on that non-deterministically (a timed
        // sleep) would be a flaky test. Instead, exercise the same code path
        // the watcher loop runs on each debounced event -- `refresh(cwd)`,
        // which is the single place that writes `cacheRef` (see the comment
        // on `refresh` in SharedProjectMemory.ts) -- to deterministically
        // land the second fact in the cache. The live end-to-end watch path
        // (an actual `fs.watch` event debouncing into this same `refresh`
        // call) is covered by the Task 8 manual verification, not by this
        // automated test.
        yield* memory.refresh(ws);

        const digestAfterWatcherRefresh = yield* memory.read(ws);
        expect(digestAfterWatcherRefresh).toContain("First shared fact.");
        expect(digestAfterWatcherRefresh).toContain("Second shared fact.");
      }),
  );
});

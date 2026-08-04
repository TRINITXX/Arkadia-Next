import * as NodeServices from "@effect/platform-node/NodeServices";
import { it, expect } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import type { SharedMemorySnapshot } from "@t3tools/contracts";

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

  it.effect(
    "streamMemory emits the current cached snapshot immediately, then every refresh update",
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
          .writeFileString(path.join(claudeMemoryDir, "fact-1.md"), "Streamed first fact.")
          .pipe(Effect.orDie);

        // Populate the cache and start the watcher up front (Task 8), the way
        // a real client would already have called `read` before subscribing.
        const initialDigest = yield* memory.read(ws);

        // Consume `streamMemory` on a forked fiber so we can deterministically
        // synchronize on "the subscriber has received its Nth element" via
        // `Deferred` instead of a timed sleep -- same pattern as
        // VcsStatusBroadcaster.test.ts's `streamStatus` tests (e.g. the
        // firstSnapshot/secondSnapshot deferreds around vcs/VcsStatusBroadcaster.test.ts:789-806).
        const firstSnapshot = yield* Deferred.make<SharedMemorySnapshot>();
        const secondSnapshot = yield* Deferred.make<SharedMemorySnapshot>();
        const receivedCountRef = yield* Ref.make(0);
        const consumerScope = yield* Scope.make();

        const stream = yield* memory.streamMemory(ws);
        yield* Stream.runForEach(stream, (snapshot) =>
          Ref.updateAndGet(receivedCountRef, (count) => count + 1).pipe(
            Effect.flatMap((count) =>
              count === 1
                ? Deferred.succeed(firstSnapshot, snapshot)
                : Deferred.succeed(secondSnapshot, snapshot),
            ),
            Effect.ignore,
          ),
        ).pipe(Effect.forkIn(consumerScope));

        // First element: the current cached snapshot, populated by the
        // `read` above -- must equal what `read` already returned.
        const first = yield* Deferred.await(firstSnapshot);
        expect(first.markdown).toBe(initialDigest);
        expect(first.markdown).toContain("Streamed first fact.");

        // Mutate a source file and trigger the update the same way the
        // debounced watcher loop does internally: call `refresh` directly
        // (the single place that writes the cache and publishes to the
        // PubSub `streamMemory` subscribes to) -- deterministic, no reliance
        // on real `fs.watch` timing. See the equivalent reasoning in the
        // "keeps the cached snapshot current..." test above.
        yield* fileSystem
          .writeFileString(path.join(claudeMemoryDir, "fact-2.md"), "Streamed second fact.")
          .pipe(Effect.orDie);
        yield* memory.refresh(ws);

        // Second element: the new snapshot published by that `refresh`.
        const second = yield* Deferred.await(secondSnapshot);
        expect(second.markdown).toContain("Streamed first fact.");
        expect(second.markdown).toContain("Streamed second fact.");

        yield* Scope.close(consumerScope, Exit.void);
      }),
  );
});

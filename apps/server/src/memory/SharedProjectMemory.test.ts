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
import * as ProjectMemoryPaths from "./ProjectMemoryPaths.ts";
import { contentKey } from "./SharedMemoryAggregation.ts";
import * as SharedProjectMemory from "./SharedProjectMemory.ts";

const TestLayer = Layer.empty.pipe(
  Layer.provideMerge(SharedProjectMemory.layer),
  // Merged independently (in addition to the copy `SharedProjectMemory.layer`
  // already provides itself internally) so the "pin/delete persist to
  // overrides.json" test below can resolve the same storeDir the service
  // used, to read the file directly. `ProjectMemoryPaths.make` is a pure,
  // stateless computation from `cwd` (git identity -> hash), so a second
  // independent instance resolves identically -- no shared state to diverge.
  Layer.provideMerge(ProjectMemoryPaths.layer),
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
        yield* fileSystem.makeDirectory(claudeMemoryDir, { recursive: true }).pipe(Effect.orDie);
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

  it.effect("keeps the cached snapshot current after a live filesystem watcher refresh", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const memory = yield* SharedProjectMemory.SharedProjectMemory;

      const ws = yield* makeTempDir;
      const claudeMemoryDir = path.join(ws, ".claude", "memory");
      yield* fileSystem.makeDirectory(claudeMemoryDir, { recursive: true }).pipe(Effect.orDie);
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
        yield* fileSystem.makeDirectory(claudeMemoryDir, { recursive: true }).pipe(Effect.orDie);
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

  it.effect(
    "reads .agents/notes.md as a shared write-back source, one entry per bullet, provider 'shared'",
    () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const memory = yield* SharedProjectMemory.SharedProjectMemory;

        const ws = yield* makeTempDir;
        const agentsDir = path.join(ws, ".agents");
        yield* fileSystem.makeDirectory(agentsDir, { recursive: true }).pipe(Effect.orDie);
        // Seeded the way a provider with no native memory (Cursor, Grok,
        // OpenCode, ...) would contribute: two plain markdown bullets in the
        // uniform write-back file, NOT the junctioned `.agents/memory` store.
        yield* fileSystem
          .writeFileString(path.join(agentsDir, "notes.md"), "- Fact one\n- Fact two")
          .pipe(Effect.orDie);

        const digest = yield* memory.read(ws);
        expect(digest).toContain("Fact one");
        expect(digest).toContain("Fact two");

        const snapshot = yield* memory.refresh(ws);
        const sharedEntries = snapshot.entries.filter((entry) => entry.provider === "shared");
        expect(sharedEntries.map((entry) => entry.text).sort()).toEqual(["Fact one", "Fact two"]);

        // Every digest -- even one built entirely from `.agents/notes.md` --
        // carries the one-sentence write-back trailer, so a provider reading
        // it learns how to contribute without needing an existing entry to
        // find the instruction next to.
        expect(digest).toContain(
          "To record a durable fact visible to every AI tool in this project, append one bullet to .agents/notes.md.",
        );
      }),
  );

  it.effect(
    "injects the write-back trailer even for a brand-new project with an empty .agents/notes.md source",
    () =>
      Effect.gen(function* () {
        const memory = yield* SharedProjectMemory.SharedProjectMemory;

        const ws = yield* makeTempDir;

        // No `.agents/notes.md` (or any other source) seeded for this fresh
        // temp workspace: `readFileSource` treats the missing file as zero
        // records, exactly like `readDirSource` treats a missing dir. The
        // trailer must still ride along -- it is appended unconditionally
        // in `refresh`, not gated on `entries.length > 0` -- so even a
        // provider in a brand-new project learns how to contribute. (Not
        // asserting the digest is *only* the trailer: `collectSourceDirs`'s
        // other sources resolve against this machine's real home directory,
        // e.g. `~/.codex/memories`, which may carry unrelated real content
        // outside this test's control -- same reasoning as every other test
        // in this file using `.toContain` rather than exact equality.)
        const digest = yield* memory.read(ws);
        expect(digest).toContain(
          "To record a durable fact visible to every AI tool in this project, append one bullet to .agents/notes.md.",
        );
      }),
  );

  it.effect(
    "keeps the cached snapshot current after a live filesystem watcher refresh on .agents/notes.md",
    () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const memory = yield* SharedProjectMemory.SharedProjectMemory;

        const ws = yield* makeTempDir;
        const agentsDir = path.join(ws, ".agents");
        yield* fileSystem.makeDirectory(agentsDir, { recursive: true }).pipe(Effect.orDie);
        yield* fileSystem
          .writeFileString(path.join(agentsDir, "notes.md"), "- First shared note.")
          .pipe(Effect.orDie);

        // First `read`: initial refresh + starts the debounced `fs.watch`
        // loop directly over `.agents/notes.md` (Task 11 generalizes Task
        // 8's watcher to file sources). A Cursor-style edit made after this
        // point should show up live, without a manual `refresh` call.
        const firstDigest = yield* memory.read(ws);
        expect(firstDigest).toContain("First shared note.");

        // Simulate a provider with no native memory appending a second
        // bullet the way its normal file-editing tool would.
        yield* fileSystem
          .writeFileString(
            path.join(agentsDir, "notes.md"),
            "- First shared note.\n- Second shared note.",
          )
          .pipe(Effect.orDie);

        // As in the existing Task 8/9 tests above, asserting on the real
        // `fs.watch` timing would be flaky; exercise the exact code path the
        // watcher loop runs on each debounced event (`refresh(cwd)`, the
        // single place that writes `cacheRef`) to deterministically land the
        // second note in the cache. The live end-to-end watch path (a real
        // `fs.watch` event on `notes.md` debouncing into this same
        // `refresh`) is covered by manual verification, not by this test.
        yield* memory.refresh(ws);

        const digestAfterWatcherRefresh = yield* memory.read(ws);
        expect(digestAfterWatcherRefresh).toContain("First shared note.");
        expect(digestAfterWatcherRefresh).toContain("Second shared note.");
      }),
  );

  it.effect(
    "deleteEntry tombstones a fact out of the digest; pinEntry persists a pin to overrides.json",
    () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const memory = yield* SharedProjectMemory.SharedProjectMemory;
        const paths = yield* ProjectMemoryPaths.ProjectMemoryPaths;

        const ws = yield* makeTempDir;
        const claudeMemoryDir = path.join(ws, ".claude", "memory");
        yield* fileSystem.makeDirectory(claudeMemoryDir, { recursive: true }).pipe(Effect.orDie);
        yield* fileSystem
          .writeFileString(path.join(claudeMemoryDir, "fact-1.md"), "Deletable fact.")
          .pipe(Effect.orDie);
        yield* fileSystem
          .writeFileString(path.join(claudeMemoryDir, "fact-2.md"), "Keeper fact.")
          .pipe(Effect.orDie);

        const beforeDigest = yield* memory.read(ws);
        expect(beforeDigest).toContain("Deletable fact.");
        expect(beforeDigest).toContain("Keeper fact.");

        // `contentKey` is the same normalize-then-hash function the
        // aggregator uses internally to key `SharedMemoryEntry.key` -- a
        // caller (the future client UI) computes the key to delete/pin
        // exactly this way, from an entry it already has in hand.
        const deletableKey = contentKey("Deletable fact.");
        yield* memory.deleteEntry(ws, deletableKey);

        const afterDeleteDigest = yield* memory.read(ws);
        expect(afterDeleteDigest).not.toContain("Deletable fact.");
        expect(afterDeleteDigest).toContain("Keeper fact.");

        const keeperKey = contentKey("Keeper fact.");
        yield* memory.pinEntry(ws, keeperKey);

        // Assert the overrides survive as on-disk state, not just as an
        // in-memory effect of `deleteEntry`/`pinEntry` -- read
        // `<storeDir>/overrides.json` directly, the same file `refresh`
        // reads on every call.
        const storeDir = yield* paths.resolveStoreDir(ws);
        const overridesText = yield* fileSystem
          .readFileString(path.join(storeDir, "overrides.json"))
          .pipe(Effect.orDie);
        // @effect-diagnostics-next-line preferSchemaOverJson:off - reads the persisted overrides fixture directly to assert on-disk shape.
        const overrides = JSON.parse(overridesText) as {
          pinnedKeys: ReadonlyArray<string>;
          tombstonedKeys: ReadonlyArray<string>;
        };
        expect(overrides.pinnedKeys).toContain(keeperKey);
        expect(overrides.tombstonedKeys).toContain(deletableKey);
      }),
  );
});

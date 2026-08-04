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
});

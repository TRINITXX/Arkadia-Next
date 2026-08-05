import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { HermesSettings, HERMES_OPENAI_CODEX_MODEL } from "@t3tools/contracts";

import {
  buildHermesDiscoveredModelsFromSessionModelState,
  buildInitialHermesProviderSnapshot,
  checkHermesProviderStatus,
} from "./HermesProvider.ts";

const decodeHermesSettings = Schema.decodeSync(HermesSettings);

describe("buildInitialHermesProviderSnapshot", () => {
  it.effect("returns a disabled snapshot when settings.enabled is false", () =>
    Effect.gen(function* () {
      const snapshot = yield* buildInitialHermesProviderSnapshot(
        decodeHermesSettings({ enabled: false }),
      );
      expect(snapshot.enabled).toBe(false);
      expect(snapshot.status).toBe("disabled");
      expect(snapshot.installed).toBe(false);
      expect(snapshot.message).toContain("disabled");
    }),
  );

  it.effect("returns a pending snapshot by default", () =>
    Effect.gen(function* () {
      const snapshot = yield* buildInitialHermesProviderSnapshot(decodeHermesSettings({}));
      expect(snapshot.enabled).toBe(true);
      expect(snapshot.installed).toBe(true);
      expect(snapshot.status).toBe("warning");
      expect(snapshot.version).toBeNull();
      expect(snapshot.message).toContain("Checking Hermes");
      expect(snapshot.requiresNewThreadForModelChange).toBe(true);
    }),
  );

  it.effect("keeps the OpenAI Codex route first in the fallback model list", () =>
    Effect.gen(function* () {
      const snapshot = yield* buildInitialHermesProviderSnapshot(decodeHermesSettings({}));
      expect(snapshot.models.map(({ slug }) => slug)).toEqual([
        HERMES_OPENAI_CODEX_MODEL,
        "nous:deepseek/deepseek-v4-flash-0731",
      ]);
      expect(snapshot.models[0]?.isDefault).toBe(true);
    }),
  );
});

describe("buildHermesDiscoveredModelsFromSessionModelState", () => {
  it("marks the ACP current model as default while preserving every discovered model", () => {
    const models = buildHermesDiscoveredModelsFromSessionModelState({
      currentModelId: "nous:deepseek/deepseek-v4-pro",
      availableModels: [
        {
          modelId: "nous:deepseek/deepseek-v4-flash-0731",
          name: "DeepSeek V4 Flash",
        },
        {
          modelId: "nous:deepseek/deepseek-v4-pro",
          name: "DeepSeek V4 Pro",
        },
      ],
    });

    expect(models.map(({ slug, isDefault }) => ({ slug, isDefault }))).toEqual([
      {
        slug: "nous:deepseek/deepseek-v4-flash-0731",
        isDefault: undefined,
      },
      {
        slug: "nous:deepseek/deepseek-v4-pro",
        isDefault: true,
      },
    ]);
  });

  it("prefers the OpenAI Codex route when ACP exposes it", () => {
    const models = buildHermesDiscoveredModelsFromSessionModelState({
      currentModelId: "nous:deepseek/deepseek-v4-flash-0731",
      availableModels: [
        {
          modelId: "nous:deepseek/deepseek-v4-flash-0731",
          name: "DeepSeek V4 Flash",
        },
        {
          modelId: HERMES_OPENAI_CODEX_MODEL,
          name: "OpenAI Codex · gpt-5.6-luna",
        },
      ],
    });

    expect(
      models.map(({ slug, subProvider, isDefault }) => ({ slug, subProvider, isDefault })),
    ).toEqual([
      {
        slug: "nous:deepseek/deepseek-v4-flash-0731",
        subProvider: "Nous",
        isDefault: undefined,
      },
      {
        slug: HERMES_OPENAI_CODEX_MODEL,
        subProvider: "OpenAI Codex",
        isDefault: true,
      },
    ]);
  });
});

it.layer(NodeServices.layer)("checkHermesProviderStatus", (it) => {
  it.effect("reports the ssh client as missing when the binary path does not resolve", () =>
    Effect.gen(function* () {
      const snapshot = yield* checkHermesProviderStatus(
        decodeHermesSettings({
          enabled: true,
          binaryPath: "/definitely/not/installed/ssh-binary",
        }),
      );
      expect(snapshot.enabled).toBe(true);
      expect(snapshot.installed).toBe(false);
      expect(snapshot.status).toBe("error");
      expect(snapshot.message).toMatch(/not installed|not on PATH|Failed to reach/);
    }),
  );

  it.effect("reports an error when the version probe exits non-zero", () =>
    Effect.gen(function* () {
      const secretStderr = "broken ssh tunnel: secret-token-value";
      const snapshot = yield* Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const dir = yield* fs.makeTempDirectoryScoped({ prefix: "t3code-hermes-version-" });
          const sshPath = path.join(dir, "ssh");
          yield* fs.writeFileString(
            sshPath,
            ["#!/bin/sh", `printf "%s\\n" "${secretStderr}" >&2`, "exit 2", ""].join("\n"),
          );
          yield* fs.chmod(sshPath, 0o755);

          return yield* checkHermesProviderStatus(
            decodeHermesSettings({ enabled: true, binaryPath: sshPath }),
          );
        }),
      );

      expect(snapshot.enabled).toBe(true);
      expect(snapshot.installed).toBe(true);
      expect(snapshot.status).toBe("error");
      expect(snapshot.message).toBe("Hermes is reachable but `hermes --version` failed.");
      expect(snapshot.message).not.toContain(secretStderr);
    }),
  );

  it.effect("reports an error when ACP model discovery is unavailable", () =>
    Effect.gen(function* () {
      const snapshot = yield* Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const dir = yield* fs.makeTempDirectoryScoped({ prefix: "t3code-hermes-success-" });
          const sshPath = path.join(dir, "ssh");
          yield* fs.writeFileString(
            sshPath,
            ["#!/bin/sh", 'printf "Hermes Agent v0.0.99\\n"', "exit 0", ""].join("\n"),
          );
          yield* fs.chmod(sshPath, 0o755);

          return yield* checkHermesProviderStatus(
            decodeHermesSettings({ enabled: true, binaryPath: sshPath }),
          );
        }),
      );

      expect(snapshot.status).toBe("error");
      expect(snapshot.installed).toBe(true);
      expect(snapshot.models.map((model) => model.slug)).toEqual([
        HERMES_OPENAI_CODEX_MODEL,
        "nous:deepseek/deepseek-v4-flash-0731",
      ]);
      expect(snapshot.message).toContain("ACP startup failed");
    }),
  );
});

import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as EffectAcpErrors from "effect-acp/errors";

import {
  applyHermesAcpModelSelection,
  buildHermesAcpSpawnInput,
  resolveHermesAcpBaseModelId,
} from "./HermesAcpSupport.ts";

describe("resolveHermesAcpBaseModelId", () => {
  it("normalizes empty and custom Hermes model ids", () => {
    expect(resolveHermesAcpBaseModelId(undefined)).toBe("nous:deepseek/deepseek-v4-flash-0731");
    expect(resolveHermesAcpBaseModelId("   ")).toBe("nous:deepseek/deepseek-v4-flash-0731");
    expect(resolveHermesAcpBaseModelId("  nous:deepseek/deepseek-v4-pro  ")).toBe(
      "nous:deepseek/deepseek-v4-pro",
    );
  });
});

describe("buildHermesAcpSpawnInput", () => {
  it("tunnels `hermes acp` over ssh to the configured target", () => {
    const spawn = buildHermesAcpSpawnInput(
      { binaryPath: "ssh", sshTarget: "root@vps.example", remoteBinaryPath: "hermes" },
      "/tmp/project",
    );

    expect(spawn.command).toBe("ssh");
    expect(spawn.cwd).toBe("/tmp/project");
    // No `-t` (raw stdio for ACP), BatchMode + keepalive, and the MCP skip flag
    // injected in the *remote* command string (ssh does not forward local env).
    // The whole `sudo … bash -lc <script>` is a single, self-quoted ssh argument:
    // ssh space-joins its command args, so separate tokens would make the remote
    // shell run bare `hermes` and never launch `hermes acp`.
    expect(spawn.args).toEqual([
      "-o",
      "BatchMode=yes",
      "-o",
      "ServerAliveInterval=15",
      "-o",
      "ServerAliveCountMax=3",
      "root@vps.example",
      "sudo -u hermes -H bash -lc 'HERMES_ACP_SKIP_CONFIGURED_MCP=1 hermes acp'",
    ]);
    expect(spawn.args).not.toContain("-t");
    // Regression guard: after ssh space-joins the command args, the remote shell
    // must still see the script as one quoted word.
    expect(spawn.args.join(" ")).toContain(
      "bash -lc 'HERMES_ACP_SKIP_CONFIGURED_MCP=1 hermes acp'",
    );
  });

  it("falls back to the default ssh binary, target and remote binary", () => {
    const spawn = buildHermesAcpSpawnInput(null, "/tmp/project");
    expect(spawn.command).toBe("ssh");
    expect(spawn.args).toContain("root@37.27.176.67");
    expect(spawn.args.at(-1)).toBe(
      "sudo -u hermes -H bash -lc 'HERMES_ACP_SKIP_CONFIGURED_MCP=1 hermes acp'",
    );
  });

  it("honors a custom remote binary path", () => {
    const spawn = buildHermesAcpSpawnInput(
      {
        binaryPath: "ssh",
        sshTarget: "root@vps",
        remoteBinaryPath: "/home/hermes/.local/bin/hermes",
      },
      "/tmp/project",
    );
    expect(spawn.args.at(-1)).toBe(
      "sudo -u hermes -H bash -lc 'HERMES_ACP_SKIP_CONFIGURED_MCP=1 /home/hermes/.local/bin/hermes acp'",
    );
  });
});

describe("applyHermesAcpModelSelection", () => {
  const makeRecordingRuntime = (failure?: EffectAcpErrors.AcpError) => {
    const modelCalls: Array<string> = [];
    const runtime = {
      setSessionModel: (modelId: string) =>
        Effect.gen(function* () {
          modelCalls.push(modelId);
          if (failure) return yield* failure;
          return {};
        }),
    };
    return { runtime, modelCalls };
  };

  it.effect("calls session/set_model when the requested model differs from current", () =>
    Effect.gen(function* () {
      const { runtime, modelCalls } = makeRecordingRuntime();
      const result = yield* applyHermesAcpModelSelection({
        runtime,
        currentModelId: "nous:deepseek/deepseek-v4-flash-0731",
        requestedModelId: "nous:deepseek/deepseek-v4-pro",
        mapError: (cause) => cause.message,
      });
      expect(modelCalls).toEqual(["nous:deepseek/deepseek-v4-pro"]);
      expect(result).toBe("nous:deepseek/deepseek-v4-pro");
    }),
  );

  it.effect("skips set_model when requested matches current", () =>
    Effect.gen(function* () {
      const { runtime, modelCalls } = makeRecordingRuntime();
      const result = yield* applyHermesAcpModelSelection({
        runtime,
        currentModelId: "nous:deepseek/deepseek-v4-flash-0731",
        requestedModelId: "nous:deepseek/deepseek-v4-flash-0731",
        mapError: (cause) => cause.message,
      });
      expect(modelCalls).toEqual([]);
      expect(result).toBe("nous:deepseek/deepseek-v4-flash-0731");
    }),
  );

  it.effect("skips set_model when no model is requested", () =>
    Effect.gen(function* () {
      const { runtime, modelCalls } = makeRecordingRuntime();
      const result = yield* applyHermesAcpModelSelection({
        runtime,
        currentModelId: "nous:deepseek/deepseek-v4-flash-0731",
        requestedModelId: undefined,
        mapError: (cause) => cause.message,
      });
      expect(modelCalls).toEqual([]);
      expect(result).toBe("nous:deepseek/deepseek-v4-flash-0731");
    }),
  );

  it.effect("propagates session/set_model failures via mapError", () =>
    Effect.gen(function* () {
      const failure = EffectAcpErrors.AcpRequestError.invalidParams("session id not known");
      const { runtime } = makeRecordingRuntime(failure);
      const error = yield* Effect.flip(
        applyHermesAcpModelSelection({
          runtime,
          currentModelId: "nous:deepseek/deepseek-v4-flash-0731",
          requestedModelId: "nous:deepseek/deepseek-v4-pro",
          mapError: (cause) => cause.message,
        }),
      );
      expect(error).toBe(failure.message);
    }),
  );
});

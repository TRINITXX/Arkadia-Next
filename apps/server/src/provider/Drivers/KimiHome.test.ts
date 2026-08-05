import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { makeKimiEnvironment } from "./KimiHome.ts";

it.layer(NodeServices.layer)("makeKimiEnvironment", (it) => {
  it.effect("isolates Claude state and replaces personal Anthropic routing", () =>
    Effect.gen(function* () {
      const environment = yield* makeKimiEnvironment(
        { homePath: "C:/arkadia/kimi" },
        "rotated-test-key",
        "k3[1m]",
        {
          PATH: "C:/tools",
          ANTHROPIC_API_KEY: "personal-claude-key",
          ANTHROPIC_AUTH_TOKEN: "personal-token",
          ANTHROPIC_MODEL: "claude-opus-5",
          CLAUDE_CODE_EFFORT_LEVEL: "low",
          CLAUDE_CONFIG_DIR: "C:/personal/claude",
        },
      );

      expect(environment).toMatchObject({
        PATH: "C:/tools",
        CLAUDE_CONFIG_DIR: "C:\\arkadia\\kimi",
        ANTHROPIC_BASE_URL: "https://api.kimi.com/coding/",
        ANTHROPIC_API_KEY: "rotated-test-key",
        ANTHROPIC_MODEL: "k3[1m]",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "k3[1m]",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "k3[1m]",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "k3[1m]",
        CLAUDE_CODE_SUBAGENT_MODEL: "k3[1m]",
        CLAUDE_CODE_MAX_CONTEXT_TOKENS: "1048576",
      });
      expect(environment.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
      expect(environment.CLAUDE_CODE_EFFORT_LEVEL).toBeUndefined();
    }),
  );

  it.effect("uses the 256K context limit for the compact K3 variant", () =>
    Effect.gen(function* () {
      const environment = yield* makeKimiEnvironment(
        { homePath: "C:/arkadia/kimi" },
        "test-key",
        "k3",
        {},
      );

      expect(environment.CLAUDE_CODE_MAX_CONTEXT_TOKENS).toBe("262144");
    }),
  );
});

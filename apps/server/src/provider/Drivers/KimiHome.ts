import type { KimiSettings } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";

import { resolveClaudeHomePath } from "./ClaudeHome.ts";

const KIMI_API_BASE_URL = "https://api.kimi.com/coding/";

const CLAUDE_ENVIRONMENT_KEYS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "CLAUDE_CODE_SUBAGENT_MODEL",
  "CLAUDE_CODE_MAX_CONTEXT_TOKENS",
  "CLAUDE_CODE_EFFORT_LEVEL",
  "CLAUDE_CONFIG_DIR",
] as const;

export const makeKimiEnvironment = Effect.fn("makeKimiEnvironment")(function* (
  config: Pick<KimiSettings, "homePath">,
  apiKey: string,
  model: string,
  baseEnv: NodeJS.ProcessEnv = process.env,
): Effect.fn.Return<NodeJS.ProcessEnv, never, Path.Path> {
  const environment = { ...baseEnv };
  for (const key of CLAUDE_ENVIRONMENT_KEYS) {
    delete environment[key];
  }

  const homePath = yield* resolveClaudeHomePath(config);
  return withKimiModelEnvironment(
    {
      ...environment,
      CLAUDE_CONFIG_DIR: homePath,
      ANTHROPIC_BASE_URL: KIMI_API_BASE_URL,
      ANTHROPIC_API_KEY: apiKey,
    },
    model,
  );
});

export function withKimiModelEnvironment(
  environment: NodeJS.ProcessEnv,
  model: string,
): NodeJS.ProcessEnv {
  const contextTokens = model === "k3[1m]" ? "1048576" : "262144";
  return {
    ...environment,
    ANTHROPIC_MODEL: model,
    ANTHROPIC_DEFAULT_OPUS_MODEL: model,
    ANTHROPIC_DEFAULT_SONNET_MODEL: model,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: model,
    CLAUDE_CODE_SUBAGENT_MODEL: model,
    CLAUDE_CODE_MAX_CONTEXT_TOKENS: contextTokens,
  };
}

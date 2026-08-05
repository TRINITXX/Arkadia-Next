import { describe, expect, it } from "vite-plus/test";

import { ProviderDriverKind } from "./providerInstance.ts";
import {
  DEFAULT_MODEL_BY_PROVIDER,
  HERMES_OPENAI_CODEX_MODEL,
  PROVIDER_DISPLAY_NAMES,
} from "./model.ts";

describe("Kimi model metadata", () => {
  const kimi = ProviderDriverKind.make("kimi");

  it("defaults new Kimi threads to the 1M K3 variant", () => {
    expect(DEFAULT_MODEL_BY_PROVIDER[kimi]).toBe("k3[1m]");
  });

  it("presents Kimi as a distinct provider", () => {
    expect(PROVIDER_DISPLAY_NAMES[kimi]).toBe("Kimi");
  });
});

describe("Hermes model metadata", () => {
  const hermes = ProviderDriverKind.make("hermes");

  it("defaults Hermes to the OpenAI Codex OAuth route", () => {
    expect(HERMES_OPENAI_CODEX_MODEL).toBe("openai-codex:gpt-5.6-luna");
    expect(DEFAULT_MODEL_BY_PROVIDER[hermes]).toBe(HERMES_OPENAI_CODEX_MODEL);
  });
});

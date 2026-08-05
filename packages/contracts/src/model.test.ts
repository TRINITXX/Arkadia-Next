import { describe, expect, it } from "vite-plus/test";

import { ProviderDriverKind } from "./providerInstance.ts";
import { DEFAULT_MODEL_BY_PROVIDER, PROVIDER_DISPLAY_NAMES } from "./model.ts";

describe("Kimi model metadata", () => {
  const kimi = ProviderDriverKind.make("kimi");

  it("defaults new Kimi threads to the 1M K3 variant", () => {
    expect(DEFAULT_MODEL_BY_PROVIDER[kimi]).toBe("k3[1m]");
  });

  it("presents Kimi as a distinct provider", () => {
    expect(PROVIDER_DISPLAY_NAMES[kimi]).toBe("Kimi");
  });
});

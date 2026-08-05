import { describe, expect, it } from "vite-plus/test";

import { buildCredentialEnvironment } from "./providerCredentials";

describe("buildCredentialEnvironment", () => {
  const credential = {
    label: "Kimi API key",
    environmentVariable: "ANTHROPIC_API_KEY",
    placeholder: "sk-kimi-…",
  } as const;

  it("stores a provided key as a sensitive environment variable", () => {
    expect(buildCredentialEnvironment(credential, "  rotated-key  ")).toEqual([
      { name: "ANTHROPIC_API_KEY", value: "rotated-key", sensitive: true },
    ]);
  });

  it("does not create an empty secret", () => {
    expect(buildCredentialEnvironment(credential, "   ")).toEqual([]);
  });
});

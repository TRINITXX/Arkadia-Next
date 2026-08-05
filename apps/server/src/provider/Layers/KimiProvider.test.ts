import { describe, expect, it } from "@effect/vitest";

import { ModelSelection, ProviderInstanceId } from "@t3tools/contracts";
import { getProviderOptionDescriptors } from "@t3tools/shared/model";

import {
  getKimiModelCapabilities,
  KIMI_MODEL_CATALOG,
  resolveKimiApiModelId,
  makePendingKimiProvider,
} from "./KimiProvider.ts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { KimiSettings } from "@t3tools/contracts";

const decodeKimiSettings = Schema.decodeSync(KimiSettings);

describe("Kimi K3 model policy", () => {
  it("exposes only K3 1M and K3 256K with 1M first", () => {
    expect(KIMI_MODEL_CATALOG.map(({ slug, name }) => ({ slug, name }))).toEqual([
      { slug: "k3[1m]", name: "K3 1M" },
      { slug: "k3", name: "K3 256K" },
    ]);
  });

  it("offers low, high, and max thinking with max selected", () => {
    const descriptors = getProviderOptionDescriptors({
      caps: getKimiModelCapabilities("k3[1m]"),
    });
    const effort = descriptors.find((descriptor) => descriptor.id === "effort");

    expect(effort).toMatchObject({
      type: "select",
      currentValue: "max",
      options: [
        { id: "low", label: "Low" },
        { id: "high", label: "High" },
        { id: "max", label: "Max", isDefault: true },
      ],
    });
  });

  it("passes the selected Kimi model id directly to Claude Code", () => {
    const selection = ModelSelection.make({
      instanceId: ProviderInstanceId.make("kimi"),
      model: "k3[1m]",
    });
    expect(resolveKimiApiModelId(selection)).toBe("k3[1m]");
  });

  it.effect("requires a Kimi API key without hiding the model choices", () =>
    Effect.gen(function* () {
      const config = decodeKimiSettings({});
      const snapshot = yield* makePendingKimiProvider(config, "");

      expect(snapshot).toMatchObject({
        displayName: "Kimi",
        status: "error",
        auth: { status: "unauthenticated" },
        requiresNewThreadForModelChange: true,
      });
      expect(snapshot.models.map((model) => model.slug)).toEqual(["k3[1m]", "k3"]);
    }),
  );
});

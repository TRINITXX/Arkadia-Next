import type {
  KimiSettings,
  ModelCapabilities,
  ModelSelection,
  ServerProviderModel,
} from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import * as Effect from "effect/Effect";

import { buildSelectOptionDescriptor } from "../providerSnapshot.ts";
import type { ServerProviderDraft } from "../providerSnapshot.ts";
import { checkClaudeProviderStatus, makePendingClaudeProvider } from "./ClaudeProvider.ts";

const KIMI_MODEL_CAPABILITIES: ModelCapabilities = createModelCapabilities({
  optionDescriptors: [
    buildSelectOptionDescriptor({
      id: "effort",
      label: "Thinking",
      options: [
        { value: "low", label: "Low" },
        { value: "high", label: "High" },
        { value: "max", label: "Max", isDefault: true },
      ],
    }),
  ],
});

export const KIMI_MODEL_CATALOG: ReadonlyArray<ServerProviderModel> = [
  {
    slug: "k3[1m]",
    name: "K3 1M",
    isCustom: false,
    capabilities: KIMI_MODEL_CAPABILITIES,
  },
  {
    slug: "k3",
    name: "K3 256K",
    isCustom: false,
    capabilities: KIMI_MODEL_CAPABILITIES,
  },
];

export function getKimiModelCapabilities(model: string | null | undefined): ModelCapabilities {
  return (
    KIMI_MODEL_CATALOG.find((candidate) => candidate.slug === model?.trim())?.capabilities ??
    KIMI_MODEL_CAPABILITIES
  );
}

export function resolveKimiApiModelId(modelSelection: ModelSelection): string {
  return modelSelection.model;
}

function asClaudeSettings(config: KimiSettings) {
  return { ...config, customModels: [] };
}

function presentKimiSnapshot(snapshot: ServerProviderDraft, apiKey: string) {
  const hasApiKey = apiKey.trim().length > 0;
  return {
    ...snapshot,
    displayName: "Kimi",
    showInteractionModeToggle: true,
    requiresNewThreadForModelChange: true,
    models: KIMI_MODEL_CATALOG,
    auth: hasApiKey ? { status: "authenticated" as const } : { status: "unauthenticated" as const },
    status: !snapshot.enabled
      ? snapshot.status
      : !hasApiKey
        ? ("error" as const)
        : !snapshot.installed || snapshot.status === "error"
          ? snapshot.status
          : ("ready" as const),
    ...(!hasApiKey
      ? { message: "Add a Kimi API key to enable this provider." }
      : snapshot.message
        ? { message: snapshot.message }
        : {}),
  };
}

export const makePendingKimiProvider = (config: KimiSettings, apiKey: string) =>
  makePendingClaudeProvider(asClaudeSettings(config)).pipe(
    Effect.map((snapshot) => presentKimiSnapshot(snapshot, apiKey)),
  );

export const checkKimiProviderStatus = (
  config: KimiSettings,
  apiKey: string,
  environment: NodeJS.ProcessEnv,
) =>
  checkClaudeProviderStatus(asClaudeSettings(config), undefined, environment).pipe(
    Effect.map((snapshot) => presentKimiSnapshot(snapshot, apiKey)),
  );

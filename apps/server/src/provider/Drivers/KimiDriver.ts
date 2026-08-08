import { KimiSettings, ProviderDriverKind, type ServerProvider } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { HttpClient } from "effect/unstable/http";
import { ChildProcessSpawner } from "effect/unstable/process";

import * as BackgroundPolicy from "../../background/BackgroundPolicy.ts";
import { ServerConfig } from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { makeClaudeTextGeneration } from "../../textGeneration/ClaudeTextGeneration.ts";
import { ProviderDriverError } from "../Errors.ts";
import { makeClaudeAdapter } from "../Layers/ClaudeAdapter.ts";
import { makeKimiAdapter } from "../Layers/KimiAdapter.ts";
import {
  checkKimiProviderStatus,
  getKimiModelCapabilities,
  makePendingKimiProvider,
  resolveKimiApiModelId,
} from "../Layers/KimiProvider.ts";
import { fetchKimiUsage } from "../Layers/KimiUsage.ts";
import { ProviderEventLoggers } from "../Layers/ProviderEventLoggers.ts";
import { makeManagedServerProvider } from "../makeManagedServerProvider.ts";
import {
  defaultProviderContinuationIdentity,
  type ProviderDriver,
  type ProviderInstance,
} from "../ProviderDriver.ts";
import type { ServerProviderDraft } from "../providerSnapshot.ts";
import { mergeProviderInstanceEnvironment } from "../ProviderInstanceEnvironment.ts";
import {
  makeManualOnlyProviderMaintenanceCapabilities,
  makeStaticProviderMaintenanceResolver,
  resolveProviderMaintenanceCapabilitiesEffect,
} from "../providerMaintenance.ts";
import {
  haveProviderSnapshotSettingsChanged,
  makeProviderSnapshotSettingsSource,
  type ProviderSnapshotSettings,
} from "../providerUpdateSettings.ts";
import { makeKimiEnvironment, withKimiModelEnvironment } from "./KimiHome.ts";

const decodeKimiSettings = Schema.decodeSync(KimiSettings);
const DRIVER_KIND = ProviderDriverKind.make("kimi");
const UPDATE = makeStaticProviderMaintenanceResolver(
  makeManualOnlyProviderMaintenanceCapabilities({
    provider: DRIVER_KIND,
    packageName: "@anthropic-ai/claude-code",
  }),
);

export type KimiDriverEnv =
  | BackgroundPolicy.BackgroundPolicy
  | ChildProcessSpawner.ChildProcessSpawner
  | Crypto.Crypto
  | FileSystem.FileSystem
  | HttpClient.HttpClient
  | Path.Path
  | ProviderEventLoggers
  | ServerConfig
  | ServerSettingsService;

function readApiKey(environment: ReadonlyArray<{ readonly name: string; readonly value: string }>) {
  return environment.find((variable) => variable.name === "ANTHROPIC_API_KEY")?.value.trim() ?? "";
}

const withInstanceIdentity =
  (input: {
    readonly instanceId: ProviderInstance["instanceId"];
    readonly displayName: string | undefined;
    readonly accentColor: string | undefined;
    readonly continuationGroupKey: string;
  }) =>
  (snapshot: ServerProviderDraft): ServerProvider => ({
    ...snapshot,
    instanceId: input.instanceId,
    driver: DRIVER_KIND,
    ...(input.displayName ? { displayName: input.displayName } : {}),
    ...(input.accentColor ? { accentColor: input.accentColor } : {}),
    continuation: { groupKey: input.continuationGroupKey },
  });

export const KimiDriver: ProviderDriver<KimiSettings, KimiDriverEnv> = {
  driverKind: DRIVER_KIND,
  metadata: { displayName: "Kimi", supportsMultipleInstances: true },
  configSchema: KimiSettings,
  defaultConfig: () => decodeKimiSettings({}),
  create: ({ instanceId, displayName, accentColor, environment, enabled, config }) =>
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const httpClient = yield* HttpClient.HttpClient;
      const serverSettings = yield* ServerSettingsService;
      const eventLoggers = yield* ProviderEventLoggers;
      const processEnv = mergeProviderInstanceEnvironment(environment);
      const apiKey = readApiKey(environment);
      const effectiveConfig = { ...config, enabled } satisfies KimiSettings;
      const defaultEnvironment = yield* makeKimiEnvironment(
        effectiveConfig,
        apiKey,
        "k3[1m]",
        processEnv,
      );
      const continuationIdentity = defaultProviderContinuationIdentity({
        driverKind: DRIVER_KIND,
        instanceId,
      });
      const stampIdentity = withInstanceIdentity({
        instanceId,
        displayName,
        accentColor,
        continuationGroupKey: continuationIdentity.continuationKey,
      });
      const maintenanceCapabilities = yield* resolveProviderMaintenanceCapabilitiesEffect(UPDATE, {
        binaryPath: effectiveConfig.binaryPath,
        env: defaultEnvironment,
      });

      // See `asClaudeSettings` in KimiProvider: Claude's prompt suggestions are
      // not offered on a Kimi-backed session.
      const claudeSettings = { ...effectiveConfig, customModels: [], promptSuggestions: false };
      const claudeAdapter = yield* makeClaudeAdapter(claudeSettings, {
        instanceId,
        environment: defaultEnvironment,
        getModelCapabilities: getKimiModelCapabilities,
        resolveApiModelId: resolveKimiApiModelId,
        resolveSessionEnvironment: ({ modelSelection, environment: sessionEnvironment }) =>
          withKimiModelEnvironment(sessionEnvironment, modelSelection?.model ?? "k3[1m]"),
        sessionModelSwitch: "unsupported",
        ...(eventLoggers.native ? { nativeEventLogger: eventLoggers.native } : {}),
      });
      const adapter = yield* makeKimiAdapter({
        claudeAdapter,
        instanceId,
        fetchUsage: () =>
          fetchKimiUsage(apiKey).pipe(Effect.provideService(HttpClient.HttpClient, httpClient)),
      });
      const textGeneration = yield* makeClaudeTextGeneration(claudeSettings, defaultEnvironment);

      const checkProvider = checkKimiProviderStatus(
        effectiveConfig,
        apiKey,
        defaultEnvironment,
      ).pipe(
        Effect.map(stampIdentity),
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.provideService(FileSystem.FileSystem, fileSystem),
        Effect.provideService(Path.Path, path),
      );
      const snapshotSettings = makeProviderSnapshotSettingsSource(effectiveConfig, serverSettings);
      const snapshot = yield* makeManagedServerProvider<ProviderSnapshotSettings<KimiSettings>>({
        maintenanceCapabilities,
        getSettings: snapshotSettings.getSettings,
        streamSettings: snapshotSettings.streamSettings,
        haveSettingsChanged: haveProviderSnapshotSettingsChanged,
        initialSnapshot: (settings) =>
          makePendingKimiProvider(settings.provider, apiKey).pipe(Effect.map(stampIdentity)),
        checkProvider,
      }).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderDriverError({
              driver: DRIVER_KIND,
              instanceId,
              detail: `Failed to build Kimi snapshot: ${cause.message ?? String(cause)}`,
              cause,
            }),
        ),
      );

      return {
        instanceId,
        driverKind: DRIVER_KIND,
        continuationIdentity,
        displayName,
        accentColor,
        enabled,
        snapshot,
        adapter,
        textGeneration,
      } satisfies ProviderInstance;
    }),
};

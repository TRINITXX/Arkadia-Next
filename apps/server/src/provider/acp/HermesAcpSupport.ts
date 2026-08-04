import { type HermesSettings, ProviderDriverKind } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import type * as EffectAcpErrors from "effect-acp/errors";
import type * as EffectAcpSchema from "effect-acp/schema";
import { normalizeModelSlug } from "@t3tools/shared/model";

import * as AcpSessionRuntime from "./AcpSessionRuntime.ts";

/**
 * Hermes advertises a single non-interactive auth method (`nous`) that reuses
 * the credentials already configured in `~/.hermes` on the VPS. The handshake
 * captured on 2026-08-04 returns `{}` for `authenticate` — i.e. it is a no-op —
 * so we always request `nous` and never surface an auth prompt.
 */
const HERMES_AUTH_METHOD_ID = "nous";
const HERMES_DRIVER_KIND = ProviderDriverKind.make("hermes");

/** Fallback model when nothing is discovered; the Hermes session already
 * defaults to this DeepSeek build server-side (provider `nous`). */
const HERMES_DEFAULT_BASE_MODEL = "nous:deepseek/deepseek-v4-flash-0731";

/** Defaults, kept in sync with {@link HermesSettings}. */
const DEFAULT_SSH_BINARY = "ssh";
const DEFAULT_SSH_TARGET = "root@37.27.176.67";
const DEFAULT_REMOTE_BINARY = "hermes";
/** Remote user the Hermes agent is installed under (not `root`). */
const HERMES_REMOTE_USER = "hermes";
/**
 * Remote working directory for the ACP session. The tools run on the VPS, so
 * the local project path is meaningless here — Hermes operates in its own home
 * (shared with the always-on gateway). The local ssh process cwd is separate.
 */
const HERMES_REMOTE_WORKDIR = "/home/hermes";

type HermesAcpRuntimeHermesSettings = Pick<
  HermesSettings,
  "binaryPath" | "sshTarget" | "remoteBinaryPath"
>;

interface HermesAcpRuntimeInput extends Omit<
  AcpSessionRuntime.AcpSessionRuntimeOptions,
  "authMethodId" | "clientCapabilities" | "spawn"
> {
  readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly hermesSettings: HermesAcpRuntimeHermesSettings | null | undefined;
  readonly environment?: NodeJS.ProcessEnv;
}

/**
 * Build the local spawn input: run the SSH client, tunnel a raw stdio pipe to
 * `hermes acp` under the `hermes` user on the VPS.
 *
 * - `bash -lc` recovers `~/.local/bin` from the login shell PATH.
 * - `HERMES_ACP_SKIP_CONFIGURED_MCP=1` is injected in the *remote* command
 *   string (ssh does not forward local env) so the ACP process does not restart
 *   the MCP servers the gateway already holds.
 * - No `-t`: ACP needs a clean stdio (stdout = JSON-RPC, stderr = logs).
 * - `ServerAliveInterval` keeps a dropped link from hanging the subprocess.
 */
export function buildHermesAcpSpawnInput(
  hermesSettings: HermesAcpRuntimeHermesSettings | null | undefined,
  cwd: string,
  environment?: NodeJS.ProcessEnv,
): AcpSessionRuntime.AcpSpawnInput {
  const sshBinary = hermesSettings?.binaryPath?.trim() || DEFAULT_SSH_BINARY;
  const sshTarget = hermesSettings?.sshTarget?.trim() || DEFAULT_SSH_TARGET;
  const remoteBinary = hermesSettings?.remoteBinaryPath?.trim() || DEFAULT_REMOTE_BINARY;
  const remoteCommand = `HERMES_ACP_SKIP_CONFIGURED_MCP=1 ${remoteBinary} acp`;
  return {
    command: sshBinary,
    args: [
      "-o",
      "BatchMode=yes",
      "-o",
      "ServerAliveInterval=15",
      "-o",
      "ServerAliveCountMax=3",
      sshTarget,
      "sudo",
      "-u",
      HERMES_REMOTE_USER,
      "-H",
      "bash",
      "-lc",
      remoteCommand,
    ],
    cwd,
    ...(environment ? { env: environment } : {}),
  };
}

export const makeHermesAcpRuntime = (
  input: HermesAcpRuntimeInput,
): Effect.Effect<
  AcpSessionRuntime.AcpSessionRuntime["Service"],
  EffectAcpErrors.AcpError,
  Crypto.Crypto | Scope.Scope
> =>
  Effect.gen(function* () {
    const acpContext = yield* Layer.build(
      AcpSessionRuntime.layer({
        ...input,
        // The ACP session runs on the VPS: `session/new` must receive a remote
        // path, never the local (Windows) project cwd. The local cwd is only
        // used as the ssh process working directory below.
        cwd: HERMES_REMOTE_WORKDIR,
        spawn: buildHermesAcpSpawnInput(input.hermesSettings, input.cwd, input.environment),
        authMethodId: HERMES_AUTH_METHOD_ID,
      }).pipe(
        Layer.provide(
          Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, input.childProcessSpawner),
        ),
      ),
    );
    return yield* Effect.service(AcpSessionRuntime.AcpSessionRuntime).pipe(
      Effect.provide(acpContext),
    );
  });

export function resolveHermesAcpBaseModelId(model: string | null | undefined): string {
  const trimmed = model?.trim();
  const base = trimmed && trimmed.length > 0 ? trimmed : HERMES_DEFAULT_BASE_MODEL;
  return normalizeModelSlug(base, HERMES_DRIVER_KIND) ?? HERMES_DEFAULT_BASE_MODEL;
}

export function currentHermesModelIdFromSessionSetup(
  sessionSetupResult:
    | EffectAcpSchema.LoadSessionResponse
    | EffectAcpSchema.NewSessionResponse
    | EffectAcpSchema.ResumeSessionResponse,
): string | undefined {
  return sessionSetupResult.models?.currentModelId?.trim() || undefined;
}

export function applyHermesAcpModelSelection<E>(input: {
  readonly runtime: Pick<AcpSessionRuntime.AcpSessionRuntime["Service"], "setSessionModel">;
  readonly currentModelId: string | undefined;
  readonly requestedModelId: string | undefined;
  readonly mapError: (cause: EffectAcpErrors.AcpError) => E;
}): Effect.Effect<string | undefined, E> {
  const shouldSwitchModel =
    input.requestedModelId !== undefined && input.requestedModelId !== input.currentModelId;
  if (!shouldSwitchModel) {
    return Effect.succeed(input.currentModelId);
  }
  return input.runtime
    .setSessionModel(input.requestedModelId)
    .pipe(Effect.mapError(input.mapError), Effect.as(input.requestedModelId));
}

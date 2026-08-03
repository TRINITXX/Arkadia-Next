import { WS_METHODS } from "@t3tools/contracts";
import * as Stream from "effect/Stream";
import { Atom } from "effect/unstable/reactivity";

import { createEnvironmentRpcCommand, createEnvironmentSubscriptionAtomFamily } from "./runtime.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import { runStream, type EnvironmentRpcInput } from "../rpc/client.ts";
import { applyVoiceTranscriptEvent, EMPTY_VOICE_SESSION_STATE } from "./voiceSession.ts";

export function createVoiceEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    /**
     * S'abonner ouvre la session de dictée ; se désabonner la ferme. Le cycle de
     * vie du micro suit donc celui du composant qui écoute.
     */
    session: createEnvironmentSubscriptionAtomFamily(runtime, {
      label: "environment-data:voice:session",
      subscribe: (input: EnvironmentRpcInput<typeof WS_METHODS.voiceStart>) =>
        runStream(WS_METHODS.voiceStart, input).pipe(
          Stream.scan(EMPTY_VOICE_SESSION_STATE, applyVoiceTranscriptEvent),
        ),
    }),
    appendAudio: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:voice:appendAudio",
      tag: WS_METHODS.voiceAppendAudio,
    }),
    stop: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:voice:stop",
      tag: WS_METHODS.voiceStop,
    }),
  };
}

export * from "./voiceSession.ts";

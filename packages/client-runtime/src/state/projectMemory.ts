import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import { createEnvironmentRpcCommand, createEnvironmentSubscriptionAtomFamily } from "./runtime.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import { subscribe, type EnvironmentRpcInput } from "../rpc/client.ts";

export function createProjectMemoryEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    // Each `subscribeProjectMemory` emission is already a full
    // `SharedMemorySnapshot` (unlike `subscribeVcsStatus`, which streams
    // incremental events that need `Stream.mapAccum` to fold into a
    // snapshot) — so this is a plain pass-through subscription.
    stream: createEnvironmentSubscriptionAtomFamily(runtime, {
      label: "environment-data:project-memory:stream",
      subscribe: (input: EnvironmentRpcInput<typeof WS_METHODS.subscribeProjectMemory>) =>
        subscribe(WS_METHODS.subscribeProjectMemory, input),
    }),
    pin: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:project-memory:pin",
      tag: WS_METHODS.projectMemoryPin,
    }),
    remove: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:project-memory:delete",
      tag: WS_METHODS.projectMemoryDelete,
    }),
  };
}

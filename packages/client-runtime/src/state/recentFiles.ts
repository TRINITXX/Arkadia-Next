import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcSubscriptionAtomFamily } from "./runtime.ts";

/**
 * The composer's paperclip panel keeps its subscription warm for a while after
 * it closes: reopening it a few seconds later is the common case, and a fresh
 * subscription would repaint the panel from an empty state.
 */
const RECENT_FILES_IDLE_TTL_MS = 60_000;

export function createRecentFilesEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    snapshot: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:recent-files:snapshot",
      tag: WS_METHODS.subscribeRecentFiles,
      idleTtlMs: RECENT_FILES_IDLE_TTL_MS,
    }),
  };
}

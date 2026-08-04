// @effect-diagnostics nodeBuiltinImport:off
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

/**
 * SharedMemorySources - MVP list of native, per-provider memory directories to
 * aggregate into the shared project memory digest.
 *
 * Pure and synchronous: callers resolve the directories, then read them
 * through the Effect FileSystem service (a missing directory just yields no
 * records for that provider).
 */
export interface SharedMemorySource {
  readonly provider: string;
  readonly dir: string;
}

export const collectSourceDirs = (workspaceRoot: string): ReadonlyArray<SharedMemorySource> => [
  { provider: "claude", dir: NodePath.join(workspaceRoot, ".claude", "memory") },
  { provider: "codex", dir: NodePath.join(NodeOS.homedir(), ".codex", "memories") },
];

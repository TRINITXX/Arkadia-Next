// @effect-diagnostics nodeBuiltinImport:off
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

/**
 * SharedMemorySources - list of native, per-provider memory directories to
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

export interface SharedMemorySourcesOptions {
  /** Overrides `~/.claude` (mirrors the `CLAUDE_CONFIG_DIR` precedence resolved by `ClaudeSkills.ts`'s `resolveClaudeConfigDirPath`). */
  readonly claudeConfigDir?: string;
  /** Overrides `~/.codex` (mirrors `CodexHomeLayout.ts`'s `resolveHomePath`). */
  readonly codexHome?: string;
}

/**
 * Encode an absolute workspace path the way Claude Code names its
 * per-project directory under `<claudeConfigDir>/projects/<slug>`: every
 * character that is not `[A-Za-z0-9]` becomes `-`, one-for-one (runs are
 * NOT collapsed, and an existing `-` in the path just passes through
 * unchanged since it already maps to itself).
 *
 * This was not found documented anywhere in this repo (searched for
 * `slug`, `encodeProject`, `projectDirName`, and path-sanitizing
 * `replace(...)` calls under `apps/server/src` - see the task report for
 * the exact greps run). It was instead verified directly against this
 * machine's real `~/.claude/projects` listing, e.g. the workspace
 * `C:\Users\TRINITX\Desktop\Claude Desktop\Arkadia-Next-shared-memory`
 * has an on-disk directory named exactly
 * `C--Users-TRINITX-Desktop-Claude-Desktop-Arkadia-Next-shared-memory`
 * (colon, backslashes, and the space each become their own `-`; the
 * existing `-` in `Arkadia-Next-shared-memory` is untouched).
 *
 * If this encoding is ever wrong for a given Claude Code version, the
 * failure mode is safe: the resulting directory simply won't exist on
 * disk, and `SharedProjectMemory.ts`'s `readSource` already treats a
 * missing source dir as zero records rather than an error.
 */
function encodeClaudeProjectSlug(absoluteWorkspacePath: string): string {
  return absoluteWorkspacePath.replace(/[^a-zA-Z0-9]/g, "-");
}

/**
 * GUARDRAIL A (critical): the canonical aggregated store that
 * `SharedProjectMemory.ts`'s `refresh` writes the digest into and junctions
 * at `<workspaceRoot>/.agents/memory` (see `ensureSharedMemoryLink`). This
 * must never be treated as a *source* - reading it back in would re-ingest
 * our own aggregated digest and double-count every record on the next
 * refresh. This resolves the exclusion path once per call and is filtered
 * against every candidate below, so a future source added to this file
 * cannot silently reintroduce the loop.
 */
function isCanonicalStoreDir(workspaceRoot: string, dir: string): boolean {
  const storeDir = NodePath.resolve(workspaceRoot, ".agents", "memory");
  return NodePath.resolve(dir) === storeDir;
}

export const collectSourceDirs = (
  workspaceRoot: string,
  opts?: SharedMemorySourcesOptions,
): ReadonlyArray<SharedMemorySource> => {
  const claudeConfigDir = opts?.claudeConfigDir ?? NodePath.join(NodeOS.homedir(), ".claude");
  const codexHome = opts?.codexHome ?? NodePath.join(NodeOS.homedir(), ".codex");
  const projectSlug = encodeClaudeProjectSlug(NodePath.resolve(workspaceRoot));

  const candidates: ReadonlyArray<SharedMemorySource> = [
    { provider: "claude", dir: NodePath.join(workspaceRoot, ".claude", "memory") },
    // GUARDRAIL B (critical): only this per-project subtree is included for
    // Claude's user (home) scope. A global, cross-project path such as
    // `<claudeConfigDir>/CLAUDE.md` or `<claudeConfigDir>/memory` must NEVER
    // be added here - it would leak one project's facts into every other
    // project's digest.
    {
      provider: "claude",
      dir: NodePath.join(claudeConfigDir, "projects", projectSlug, "memory"),
    },
    { provider: "codex", dir: NodePath.join(codexHome, "memories") },
  ];

  return candidates.filter((source) => !isCanonicalStoreDir(workspaceRoot, source.dir));
};

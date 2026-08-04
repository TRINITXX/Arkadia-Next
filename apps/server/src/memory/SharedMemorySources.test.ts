import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, it, expect } from "@effect/vitest";

import { collectSourceDirs } from "./SharedMemorySources.ts";

const WORKSPACE_ROOT = NodePath.join("C:", "Users", "trinity", "Desktop", "sample-project");
const CLAUDE_CONFIG_DIR = NodePath.join("C:", "Users", "trinity", ".claude");
const CODEX_HOME = NodePath.join("C:", "Users", "trinity", ".codex");

describe("collectSourceDirs", () => {
  it("returns the workspace-local claude dir, the codex memories dir, and the claude user per-project memory dir", () => {
    const sources = collectSourceDirs(WORKSPACE_ROOT, {
      claudeConfigDir: CLAUDE_CONFIG_DIR,
      codexHome: CODEX_HOME,
    });

    expect(sources).toContainEqual({
      provider: "claude",
      dir: NodePath.join(WORKSPACE_ROOT, ".claude", "memory"),
    });
    expect(sources).toContainEqual({
      provider: "codex",
      dir: NodePath.join(CODEX_HOME, "memories"),
    });
    expect(sources.some((source) => source.provider === "claude" && source.dir.includes(NodePath.join("projects")))).toBe(
      true,
    );
  });

  it("GUARDRAIL A: never returns the canonical junctioned store (<workspaceRoot>/.agents/memory)", () => {
    const sources = collectSourceDirs(WORKSPACE_ROOT, {
      claudeConfigDir: CLAUDE_CONFIG_DIR,
      codexHome: CODEX_HOME,
    });

    const storeDir = NodePath.resolve(WORKSPACE_ROOT, ".agents", "memory");
    for (const source of sources) {
      expect(NodePath.resolve(source.dir)).not.toEqual(storeDir);
    }
  });

  it("GUARDRAIL B: never returns a global/cross-project claude path, only per-project subtrees", () => {
    const sources = collectSourceDirs(WORKSPACE_ROOT, {
      claudeConfigDir: CLAUDE_CONFIG_DIR,
      codexHome: CODEX_HOME,
    });

    const globalClaudeMd = NodePath.join(CLAUDE_CONFIG_DIR, "CLAUDE.md");
    const globalClaudeMemory = NodePath.join(CLAUDE_CONFIG_DIR, "memory");
    for (const source of sources) {
      expect(source.dir).not.toEqual(globalClaudeMd);
      expect(source.dir).not.toEqual(globalClaudeMemory);
    }

    const claudeUserScopeSources = sources.filter(
      (source) => source.provider === "claude" && source.dir.startsWith(CLAUDE_CONFIG_DIR),
    );
    expect(claudeUserScopeSources.length).toBeGreaterThan(0);
    for (const source of claudeUserScopeSources) {
      expect(source.dir).toContain(NodePath.join(CLAUDE_CONFIG_DIR, "projects"));
    }
  });

  it("opts.claudeConfigDir and opts.codexHome override the home defaults", () => {
    const customClaudeConfigDir = NodePath.join("D:", "elsewhere", "claude-config");
    const customCodexHome = NodePath.join("D:", "elsewhere", "codex-home");

    const sources = collectSourceDirs(WORKSPACE_ROOT, {
      claudeConfigDir: customClaudeConfigDir,
      codexHome: customCodexHome,
    });

    const claudeUserScopeSource = sources.find(
      (source) => source.provider === "claude" && source.dir.startsWith(customClaudeConfigDir),
    );
    const codexSource = sources.find((source) => source.provider === "codex");

    expect(claudeUserScopeSource?.dir.startsWith(customClaudeConfigDir)).toBe(true);
    expect(codexSource?.dir.startsWith(customCodexHome)).toBe(true);

    // Neither override should fall back to the real home directory once
    // opts are provided.
    const homeDir = NodeOS.homedir();
    expect(sources.some((source) => source.dir.startsWith(homeDir))).toBe(false);
  });

  it("encodes the absolute workspace path into the per-project slug", () => {
    const sources = collectSourceDirs(WORKSPACE_ROOT, {
      claudeConfigDir: CLAUDE_CONFIG_DIR,
      codexHome: CODEX_HOME,
    });

    const expectedSlug = NodePath.resolve(WORKSPACE_ROOT).replace(/[^a-zA-Z0-9]/g, "-");
    const userScopeSource = sources.find(
      (source) => source.provider === "claude" && source.dir.startsWith(CLAUDE_CONFIG_DIR),
    );
    expect(userScopeSource?.dir).toEqual(
      NodePath.join(CLAUDE_CONFIG_DIR, "projects", expectedSlug, "memory"),
    );
  });
});

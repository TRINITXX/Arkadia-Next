import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/models";
import { describe, expect, it } from "vite-plus/test";

import {
  arkadiaProjectColor,
  buildArkadiaSidebarGroups,
  resolveArkadiaActiveProjectLayout,
  resolveArkadiaThreadIndicator,
  shortenArkadiaProjectPath,
} from "./arkadiaSidebarModel";

const NOW = "2026-08-03T10:00:00.000Z";

function project(id: string, title = id): EnvironmentProject {
  return {
    environmentId: "local",
    id,
    title,
    workspaceRoot: `C:\\Code\\${title}`,
    repositoryIdentity: null,
    defaultModelSelection: null,
    scripts: [],
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-01T10:00:00.000Z",
  } as unknown as EnvironmentProject;
}

function thread(
  id: string,
  projectId: string,
  options: {
    updatedAt?: string;
    archivedAt?: string | null;
    settledOverride?: "active" | "settled" | null;
    instanceId?: string;
    sessionStatus?: "starting" | "running" | "ready" | "error";
    pendingUserInput?: boolean;
  } = {},
): EnvironmentThreadShell {
  return {
    environmentId: "local",
    id,
    projectId,
    title: id,
    modelSelection: {
      instanceId: options.instanceId ?? "claudeAgent",
      model: "claude-opus-4-6",
    },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: options.updatedAt ?? "2026-08-02T10:00:00.000Z",
    archivedAt: options.archivedAt ?? null,
    settledOverride: options.settledOverride ?? null,
    settledAt: options.settledOverride === "settled" ? "2026-08-02T11:00:00.000Z" : null,
    snoozedUntil: null,
    snoozedAt: null,
    titleRegeneration: null,
    session: options.sessionStatus
      ? {
          status: options.sessionStatus,
          updatedAt: options.updatedAt ?? "2026-08-02T10:00:00.000Z",
        }
      : null,
    latestUserMessageAt: "2026-08-02T10:00:00.000Z",
    hasPendingApprovals: false,
    hasPendingUserInput: options.pendingUserInput ?? false,
    hasActionableProposedPlan: false,
  } as unknown as EnvironmentThreadShell;
}

describe("buildArkadiaSidebarGroups", () => {
  it("places projects with live threads in Active and the others in Inactive", () => {
    const groups = buildArkadiaSidebarGroups({
      projects: [project("alpha", "Alpha"), project("beta", "Beta")],
      threads: [thread("active-thread", "alpha")],
      now: NOW,
      autoSettleAfterDays: 3,
    });

    expect(groups.active.map((group) => group.project.id)).toEqual(["alpha"]);
    expect(groups.active[0]?.threads.map((item) => item.id)).toEqual(["active-thread"]);
    expect(groups.inactive.map((group) => group.project.id)).toEqual(["beta"]);
  });

  it("treats settled-only projects as inactive and excludes archived threads", () => {
    const groups = buildArkadiaSidebarGroups({
      projects: [project("alpha", "Alpha")],
      threads: [
        thread("settled", "alpha", { settledOverride: "settled" }),
        thread("archived", "alpha", { archivedAt: "2026-08-02T12:00:00.000Z" }),
      ],
      now: NOW,
      autoSettleAfterDays: 3,
    });

    expect(groups.active).toEqual([]);
    expect(groups.inactive[0]?.threads.map((item) => item.id)).toEqual(["settled"]);
  });

  it("sorts child conversations by most recent update", () => {
    const groups = buildArkadiaSidebarGroups({
      projects: [project("alpha", "Alpha")],
      threads: [
        thread("older", "alpha", { updatedAt: "2026-08-02T10:00:00.000Z" }),
        thread("newer", "alpha", { updatedAt: "2026-08-03T09:00:00.000Z" }),
      ],
      now: NOW,
      autoSettleAfterDays: 3,
    });

    expect(groups.active[0]?.threads.map((item) => item.id)).toEqual(["newer", "older"]);
  });
});

describe("Arkadia project presentation", () => {
  it("uses Arcadia green for waiting and amber for working across agents", () => {
    expect(
      resolveArkadiaThreadIndicator(thread("waiting", "alpha", { pendingUserInput: true })),
    ).toMatchObject({ tone: "waiting", color: "#10b981", label: "Claude attend une réponse" });
    expect(
      resolveArkadiaThreadIndicator(thread("working", "alpha", { sessionStatus: "running" })),
    ).toMatchObject({ tone: "working", color: "#f59e0b", label: "Claude travaille" });
    expect(
      resolveArkadiaThreadIndicator(
        thread("codex-working", "alpha", {
          instanceId: "codex",
          sessionStatus: "running",
        }),
      ),
    ).toMatchObject({ tone: "working", color: "#f59e0b", label: "Codex travaille" });
  });

  it("merges a solo conversation and separates multiple conversations into tab rows", () => {
    expect(resolveArkadiaActiveProjectLayout(1)).toBe("solo");
    expect(resolveArkadiaActiveProjectLayout(2)).toBe("tabs");
  });

  it("uses the exact compact path convention from Arkadia", () => {
    expect(shortenArkadiaProjectPath("C:\\Users\\TRINITX\\Desktop\\Arkadia")).toBe(
      "Desktop\\Arkadia",
    );
    expect(shortenArkadiaProjectPath("Code/Arkadia")).toBe("Code\\Arkadia");
  });

  it("assigns a stable color from Arkadia's project palette", () => {
    expect(arkadiaProjectColor("C:\\Code\\Arkadia")).toBe(arkadiaProjectColor("C:\\Code\\Arkadia"));
    expect(arkadiaProjectColor("C:\\Code\\Arkadia")).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

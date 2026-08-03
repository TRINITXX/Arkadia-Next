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
import * as arkadiaSidebarModel from "./arkadiaSidebarModel";

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
    createdAt?: string;
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
    createdAt: options.createdAt ?? "2026-08-01T10:00:00.000Z",
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

  it("appends newer conversations below the existing ones, like the tab bar", () => {
    const groups = buildArkadiaSidebarGroups({
      projects: [project("alpha", "Alpha")],
      threads: [
        thread("newer", "alpha", {
          createdAt: "2026-08-02T09:00:00.000Z",
          updatedAt: "2026-08-03T09:00:00.000Z",
        }),
        thread("older", "alpha", {
          createdAt: "2026-08-01T09:00:00.000Z",
          updatedAt: "2026-08-02T10:00:00.000Z",
        }),
      ],
      now: NOW,
      autoSettleAfterDays: 3,
    });

    expect(groups.active[0]?.threads.map((item) => item.id)).toEqual(["older", "newer"]);
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

describe("Arkadia workspace tabs", () => {
  it("selects a primitive draft id instead of rebuilding a store snapshot", () => {
    const resolveArkadiaDraftTabId = (
      arkadiaSidebarModel as typeof arkadiaSidebarModel & {
        resolveArkadiaDraftTabId: (
          drafts: Readonly<
            Record<
              string,
              { environmentId: string; projectId: string; promotedTo?: unknown | null }
            >
          >,
          environmentId: string,
          projectId: string,
        ) => string | null;
      }
    ).resolveArkadiaDraftTabId;
    expect(typeof resolveArkadiaDraftTabId).toBe("function");

    const drafts = {
      current: { environmentId: "local", projectId: "alpha", promotedTo: null },
      other: { environmentId: "local", projectId: "beta", promotedTo: null },
      promoted: {
        environmentId: "local",
        projectId: "alpha",
        promotedTo: { environmentId: "local", threadId: "server-thread" },
      },
    };

    expect(resolveArkadiaDraftTabId(drafts, "local", "alpha")).toBe("current");
    expect(resolveArkadiaDraftTabId(drafts, "remote", "alpha")).toBeNull();
  });

  it("shows only active conversations from the current project in creation order", () => {
    const buildArkadiaWorkspaceTabs = (
      arkadiaSidebarModel as typeof arkadiaSidebarModel & {
        buildArkadiaWorkspaceTabs: (input: {
          threads: ReadonlyArray<EnvironmentThreadShell>;
          environmentId: string;
          projectId: string;
          currentThreadId: string | null;
          closedTabKeys: ReadonlySet<string>;
          now: string;
          autoSettleAfterDays: number | null;
        }) => ReadonlyArray<EnvironmentThreadShell>;
      }
    ).buildArkadiaWorkspaceTabs;
    expect(typeof buildArkadiaWorkspaceTabs).toBe("function");

    const tabs = buildArkadiaWorkspaceTabs({
      closedTabKeys: new Set<string>(),
      threads: [
        thread("second", "alpha", {
          createdAt: "2026-08-02T09:00:00.000Z",
          updatedAt: "2026-08-03T09:00:00.000Z",
        }),
        thread("other-project", "beta"),
        thread("settled", "alpha", { settledOverride: "settled" }),
        thread("archived", "alpha", { archivedAt: "2026-08-02T12:00:00.000Z" }),
        thread("first", "alpha", {
          createdAt: "2026-08-01T09:00:00.000Z",
          updatedAt: "2026-08-02T09:00:00.000Z",
        }),
      ],
      environmentId: "local",
      projectId: "alpha",
      currentThreadId: "first",
      now: NOW,
      autoSettleAfterDays: 3,
    });

    expect(tabs.map((item) => item.id)).toEqual(["first", "second"]);
  });

  it("keeps the selected conversation visible while it is being settled", () => {
    const buildArkadiaWorkspaceTabs = (
      arkadiaSidebarModel as typeof arkadiaSidebarModel & {
        buildArkadiaWorkspaceTabs: (input: {
          threads: ReadonlyArray<EnvironmentThreadShell>;
          environmentId: string;
          projectId: string;
          currentThreadId: string | null;
          closedTabKeys: ReadonlySet<string>;
          now: string;
          autoSettleAfterDays: number | null;
        }) => ReadonlyArray<EnvironmentThreadShell>;
      }
    ).buildArkadiaWorkspaceTabs;

    const tabs = buildArkadiaWorkspaceTabs({
      threads: [thread("selected", "alpha", { settledOverride: "settled" })],
      environmentId: "local",
      projectId: "alpha",
      currentThreadId: "selected",
      closedTabKeys: new Set<string>(),
      now: NOW,
      autoSettleAfterDays: 3,
    });

    expect(tabs.map((item) => item.id)).toEqual(["selected"]);
  });

  it("hides conversations the user closed, unless one is the open conversation", () => {
    const buildArkadiaWorkspaceTabs = (
      arkadiaSidebarModel as typeof arkadiaSidebarModel & {
        buildArkadiaWorkspaceTabs: (input: {
          threads: ReadonlyArray<EnvironmentThreadShell>;
          environmentId: string;
          projectId: string;
          currentThreadId: string | null;
          closedTabKeys: ReadonlySet<string>;
          now: string;
          autoSettleAfterDays: number | null;
        }) => ReadonlyArray<EnvironmentThreadShell>;
      }
    ).buildArkadiaWorkspaceTabs;
    const arkadiaWorkspaceTabKey = (
      arkadiaSidebarModel as typeof arkadiaSidebarModel & {
        arkadiaWorkspaceTabKey: (environmentId: string, threadId: string) => string;
      }
    ).arkadiaWorkspaceTabKey;
    expect(typeof arkadiaWorkspaceTabKey).toBe("function");

    const tabs = buildArkadiaWorkspaceTabs({
      threads: [
        thread("kept", "alpha", { createdAt: "2026-08-01T09:00:00.000Z" }),
        thread("closed", "alpha", { createdAt: "2026-08-02T09:00:00.000Z" }),
        thread("closed-but-open", "alpha", { createdAt: "2026-08-03T09:00:00.000Z" }),
      ],
      environmentId: "local",
      projectId: "alpha",
      currentThreadId: "closed-but-open",
      closedTabKeys: new Set([
        arkadiaWorkspaceTabKey("local", "closed"),
        arkadiaWorkspaceTabKey("local", "closed-but-open"),
      ]),
      now: NOW,
      autoSettleAfterDays: 3,
    });

    expect(tabs.map((item) => item.id)).toEqual(["kept", "closed-but-open"]);
  });

  it("selects the adjacent tab after the current tab closes", () => {
    const resolveArkadiaTabAfterClose = (
      arkadiaSidebarModel as typeof arkadiaSidebarModel & {
        resolveArkadiaTabAfterClose: (
          ids: ReadonlyArray<string>,
          closingId: string,
        ) => string | null;
      }
    ).resolveArkadiaTabAfterClose;
    expect(typeof resolveArkadiaTabAfterClose).toBe("function");
    expect(resolveArkadiaTabAfterClose(["first", "current", "last"], "current")).toBe("last");
    expect(resolveArkadiaTabAfterClose(["first", "last"], "last")).toBe("first");
    expect(resolveArkadiaTabAfterClose(["only"], "only")).toBeNull();
  });
});

describe("resolveArkadiaReturnThreadId", () => {
  const threads = [
    thread("older-visit", "alpha", { updatedAt: "2026-08-03T09:00:00.000Z" }),
    thread("recent-visit", "alpha", { updatedAt: "2026-08-01T09:00:00.000Z" }),
    thread("other-project", "beta"),
    thread("archived", "alpha", { archivedAt: "2026-08-02T09:00:00.000Z" }),
  ];

  it("prefers the conversation the user last read over the one an agent touched last", () => {
    // `older-visit` has the newer update time, but the user was reading
    // `recent-visit` — that is where closing a terminal must land them.
    expect(
      arkadiaSidebarModel.resolveArkadiaReturnThreadId({
        threads,
        environmentId: "local",
        projectId: "alpha",
        lastVisitedAtByThreadKey: {
          "local:older-visit": "2026-08-03T08:00:00.000Z",
          "local:recent-visit": "2026-08-03T12:00:00.000Z",
        },
      }),
    ).toBe("recent-visit");
  });

  it("falls back to update time for conversations never opened in this window", () => {
    expect(
      arkadiaSidebarModel.resolveArkadiaReturnThreadId({
        threads,
        environmentId: "local",
        projectId: "alpha",
        lastVisitedAtByThreadKey: {},
      }),
    ).toBe("older-visit");
  });

  it("never returns an archived conversation or one from another project", () => {
    expect(
      arkadiaSidebarModel.resolveArkadiaReturnThreadId({
        threads,
        environmentId: "local",
        projectId: "gamma",
        lastVisitedAtByThreadKey: {},
      }),
    ).toBeNull();
    expect(
      arkadiaSidebarModel.resolveArkadiaReturnThreadId({
        threads: [thread("archived", "alpha", { archivedAt: "2026-08-02T09:00:00.000Z" })],
        environmentId: "local",
        projectId: "alpha",
        lastVisitedAtByThreadKey: {},
      }),
    ).toBeNull();
  });
});

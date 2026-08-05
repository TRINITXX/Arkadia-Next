import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/models";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  arkadiaProjectColor,
  arkadiaWorkspaceTabKey,
  handleArkadiaWorkspaceTabMouseDown,
  closeArkadiaDraftTab,
  buildArkadiaSidebarGroups,
  canCloseArkadiaDraftTab,
  isArkadiaProjectActive,
  resolveArkadiaDraftTabIds,
  resolveArkadiaNextActiveProject,
  resolveArkadiaInactiveProjectOpenTarget,
  resolveArkadiaProjectOpenTab,
  requestArkadiaInactiveProjectDeletion,
  resolveArkadiaThreadIndicator,
  shortenArkadiaProjectPath,
} from "./arkadiaSidebarModel";
import * as arkadiaSidebarModel from "./arkadiaSidebarModel";

describe("Arkadia draft closeability", () => {
  const draft = {
    kind: "draft",
    key: "draft:draft-1",
    draftId: "draft-1",
    createdAt: "2026-08-05T10:00:00.000Z",
  } as const;
  const secondDraft = { ...draft, key: "draft:draft-2", draftId: "draft-2" } as const;
  const terminal = {
    kind: "terminal",
    key: "terminal:terminal-1",
    terminalId: "terminal-1",
  } as const;
  const conversation = {
    kind: "thread",
    key: "local:thread-1",
    thread: thread("thread-1", "alpha"),
  } as const;

  it("requires another mixed workspace tab", () => {
    expect(canCloseArkadiaDraftTab([draft], draft.key)).toBe(false);
    expect(canCloseArkadiaDraftTab([draft, conversation], draft.key)).toBe(true);
    expect(canCloseArkadiaDraftTab([draft, secondDraft], draft.key)).toBe(true);
    expect(canCloseArkadiaDraftTab([draft, terminal], draft.key)).toBe(true);
    expect(canCloseArkadiaDraftTab([conversation, terminal], draft.key)).toBe(false);
  });
});

describe("Arkadia project activity", () => {
  const draft = {
    kind: "draft",
    key: "draft:draft-1",
    draftId: "draft-1",
    createdAt: "2026-08-05T10:00:00.000Z",
  } as const;
  const secondDraft = { ...draft, key: "draft:draft-2", draftId: "draft-2" } as const;
  const terminal = {
    kind: "terminal",
    key: "terminal:terminal-1",
    terminalId: "terminal-1",
  } as const;

  it("does not activate a project for its sole draft", () => {
    expect(isArkadiaProjectActive([])).toBe(false);
    expect(isArkadiaProjectActive([draft])).toBe(false);
    expect(isArkadiaProjectActive([draft, secondDraft])).toBe(true);
    expect(isArkadiaProjectActive([terminal])).toBe(true);
  });
});

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

function sidebarGroups(input: {
  projects: ReadonlyArray<EnvironmentProject>;
  threads: ReadonlyArray<EnvironmentThreadShell>;
  openThreadIds?: readonly string[];
  drafts?: Parameters<typeof buildArkadiaSidebarGroups>[0]["drafts"];
  terminalsByProjectKey?: Parameters<typeof buildArkadiaSidebarGroups>[0]["terminalsByProjectKey"];
  tabOrderByProjectKey?: Readonly<Record<string, readonly string[]>>;
}) {
  return buildArkadiaSidebarGroups({
    projects: input.projects,
    threads: input.threads,
    openThreadTabKeys: new Set(
      (input.openThreadIds ?? input.threads.map((item) => item.id)).map((threadId) =>
        arkadiaWorkspaceTabKey("local", threadId),
      ),
    ),
    drafts: input.drafts ?? {},
    terminalsByProjectKey: input.terminalsByProjectKey ?? {},
    ...(input.tabOrderByProjectKey ? { tabOrderByProjectKey: input.tabOrderByProjectKey } : {}),
  });
}

describe("buildArkadiaSidebarGroups", () => {
  it("builds one ordered mixed-tab collection for the bar and sidebar", () => {
    const groups = buildArkadiaSidebarGroups({
      projects: [project("alpha", "Alpha"), project("beta", "Beta")],
      threads: [thread("thread-1", "alpha"), thread("remote-active", "alpha")],
      openThreadTabKeys: new Set([arkadiaWorkspaceTabKey("local", "thread-1")]),
      drafts: {
        "draft-1": {
          environmentId: "local",
          projectId: "alpha",
          createdAt: "2026-08-05T10:00:00.000Z",
          promotedTo: null,
        },
      },
      terminalsByProjectKey: {
        "local:alpha": [{ terminalId: "term-1" }],
      },
      tabOrderByProjectKey: {
        "local:alpha": ["terminal:term-1", "draft:draft-1", "local:thread-1"],
      },
    });

    expect(groups.active[0]?.tabs.map((tab) => `${tab.kind}:${tab.key}`)).toEqual([
      "terminal:terminal:term-1",
      "draft:draft:draft-1",
      "thread:local:thread-1",
    ]);
    expect(groups.inactive.map((group) => group.project.id)).toEqual(["beta"]);
  });

  it("places projects with live threads in Active and the others in Inactive", () => {
    const groups = sidebarGroups({
      projects: [project("alpha", "Alpha"), project("beta", "Beta")],
      threads: [thread("active-thread", "alpha")],
    });

    expect(groups.active.map((group) => group.project.id)).toEqual(["alpha"]);
    expect(
      groups.active[0]?.tabs.flatMap((item) => (item.kind === "thread" ? [item.thread.id] : [])),
    ).toEqual(["active-thread"]);
    expect(groups.inactive.map((group) => group.project.id)).toEqual(["beta"]);
  });

  it("keeps a project with a terminal tab in Active exactly once", () => {
    const groups = sidebarGroups({
      projects: [project("alpha", "Alpha"), project("beta", "Beta")],
      threads: [thread("historical", "alpha", { settledOverride: "settled" })],
      openThreadIds: [],
      terminalsByProjectKey: { "local:alpha": [{ terminalId: "term-1" }] },
    });

    expect(groups.active.map((group) => group.project.id)).toEqual(["alpha"]);
    expect(groups.inactive.map((group) => group.project.id)).toEqual(["beta"]);
    expect(
      [...groups.active, ...groups.inactive].filter((group) => group.project.id === "alpha"),
    ).toHaveLength(1);
  });

  it("leaves a project without open tabs Inactive", () => {
    const closed = thread("closed", "alpha");
    const groups = sidebarGroups({
      projects: [project("alpha", "Alpha"), project("beta", "Beta")],
      threads: [closed],
      openThreadIds: [],
    });

    expect(groups.active).toEqual([]);
    expect(groups.inactive.map((group) => group.project.id)).toEqual(["alpha", "beta"]);
  });

  it("puts a project with only one new-conversation draft in Inactive", () => {
    const groups = sidebarGroups({
      projects: [project("alpha", "Alpha")],
      threads: [],
      drafts: {
        "draft-1": {
          environmentId: "local",
          projectId: "alpha",
          createdAt: "2026-08-05T10:00:00.000Z",
          promotedTo: null,
        },
      },
    });

    expect(groups.active).toEqual([]);
    expect(groups.inactive[0]?.tabs.map((tab) => tab.key)).toEqual(["draft:draft-1"]);
  });

  it("keeps a project with two new-conversation drafts in Active", () => {
    const groups = sidebarGroups({
      projects: [project("alpha", "Alpha")],
      threads: [],
      drafts: {
        "draft-1": {
          environmentId: "local",
          projectId: "alpha",
          createdAt: "2026-08-05T10:00:00.000Z",
          promotedTo: null,
        },
        "draft-2": {
          environmentId: "local",
          projectId: "alpha",
          createdAt: "2026-08-05T11:00:00.000Z",
          promotedTo: null,
        },
      },
    });

    expect(groups.active[0]?.tabs.map((tab) => tab.key)).toEqual([
      "draft:draft-1",
      "draft:draft-2",
    ]);
    expect(groups.inactive).toEqual([]);
  });

  it("keeps closed and archived conversations out of the tab collection", () => {
    const groups = sidebarGroups({
      projects: [project("alpha", "Alpha")],
      threads: [
        thread("settled", "alpha", { settledOverride: "settled" }),
        thread("archived", "alpha", { archivedAt: "2026-08-02T12:00:00.000Z" }),
      ],
      openThreadIds: [],
    });

    expect(groups.active).toEqual([]);
    expect(groups.inactive[0]?.tabs).toEqual([]);
  });

  it("appends newer conversations below the existing ones, like the tab bar", () => {
    const groups = sidebarGroups({
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
    });

    expect(
      groups.active[0]?.tabs.flatMap((item) => (item.kind === "thread" ? [item.thread.id] : [])),
    ).toEqual(["older", "newer"]);
  });

  it("mirrors the workspace tab order, ignoring non-thread keys", () => {
    const groups = sidebarGroups({
      projects: [project("alpha", "Alpha")],
      threads: [
        thread("first", "alpha", { createdAt: "2026-08-01T09:00:00.000Z" }),
        thread("second", "alpha", { createdAt: "2026-08-02T09:00:00.000Z" }),
      ],
      // The bar dragged "second" ahead of "first"; the draft key in between is
      // not a thread and must not disturb the result.
      tabOrderByProjectKey: {
        "local:alpha": ["local:second", "draft:whatever", "local:first"],
      },
    });

    expect(
      groups.active[0]?.tabs.flatMap((item) => (item.kind === "thread" ? [item.thread.id] : [])),
    ).toEqual(["second", "first"]);
  });
});

describe("resolveArkadiaNextActiveProject", () => {
  const activeGroups = (
    projects: ReadonlyArray<EnvironmentProject>,
    threads: ReadonlyArray<EnvironmentThreadShell>,
    openThreadIds?: readonly string[],
  ) =>
    sidebarGroups({
      projects,
      threads,
      ...(openThreadIds ? { openThreadIds } : {}),
    }).active;

  it("returns the first active project other than the one being emptied", () => {
    const groups = activeGroups(
      [project("alpha", "Alpha"), project("beta", "Beta")],
      [thread("a", "alpha"), thread("b", "beta")],
    );

    expect(resolveArkadiaNextActiveProject(groups, "local:alpha")?.project.id).toBe("beta");
  });

  it("returns null when only the excluded project is active", () => {
    const groups = activeGroups([project("alpha", "Alpha")], [thread("a", "alpha")]);

    expect(resolveArkadiaNextActiveProject(groups, "local:alpha")).toBeNull();
  });

  it("returns null when there is no active project at all", () => {
    const groups = activeGroups(
      [project("alpha", "Alpha")],
      [thread("settled", "alpha", { settledOverride: "settled" })],
      [],
    );

    expect(resolveArkadiaNextActiveProject(groups, "local:beta")).toBeNull();
  });

  it("can fall back to a project whose only open tab is a terminal", () => {
    const groups = sidebarGroups({
      projects: [project("alpha"), project("beta")],
      threads: [thread("a", "alpha")],
      terminalsByProjectKey: { "local:beta": [{ terminalId: "term-1" }] },
    }).active;

    expect(resolveArkadiaNextActiveProject(groups, "local:alpha")?.project.id).toBe("beta");
  });
});

describe("resolveArkadiaProjectOpenTab", () => {
  it("opens the last active remaining tab and falls back to the first ordered tab", () => {
    const tabs = buildArkadiaSidebarGroups({
      projects: [project("alpha")],
      threads: [thread("first", "alpha")],
      openThreadTabKeys: new Set(["local:first"]),
      drafts: {
        second: {
          environmentId: "local",
          projectId: "alpha",
          createdAt: "2026-08-05T10:00:00.000Z",
        },
      },
      terminalsByProjectKey: {},
    }).active[0]!.tabs;

    expect(resolveArkadiaProjectOpenTab(tabs, "draft:second")?.key).toBe("draft:second");
    expect(resolveArkadiaProjectOpenTab(tabs, "missing")?.key).toBe("local:first");
  });
});

describe("resolveArkadiaInactiveProjectOpenTarget", () => {
  it("opens the project's existing empty composer instead of a prior conversation", () => {
    const drafts = {
      matching: {
        environmentId: "local",
        projectId: "alpha",
        createdAt: "2026-08-05T10:00:00.000Z",
        promotedTo: null,
      },
      other: {
        environmentId: "local",
        projectId: "beta",
        createdAt: "2026-08-05T11:00:00.000Z",
        promotedTo: null,
      },
    };

    expect(resolveArkadiaInactiveProjectOpenTarget(drafts, "local", "alpha")).toEqual({
      kind: "draft",
      draftId: "matching",
    });
    expect(resolveArkadiaInactiveProjectOpenTarget({}, "local", "alpha")).toEqual({
      kind: "new-draft",
    });
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
  it("closes every tab type on middle-button mouse down", () => {
    const preventDefault = vi.fn();
    const closeTab = vi.fn();

    expect(
      handleArkadiaWorkspaceTabMouseDown({
        button: 1,
        preventDefault,
        closeTab,
      }),
    ).toBe(true);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(closeTab).toHaveBeenCalledOnce();
  });

  it("closes an unstarted tab immediately without waiting for fallback navigation", () => {
    const clearDraft = vi.fn();
    const navigationThatNeverSettles = new Promise<void>(() => undefined);

    void closeArkadiaDraftTab({
      navigateAway: () => navigationThatNeverSettles,
      clearDraft,
    });

    expect(clearDraft).toHaveBeenCalledOnce();
  });

  it("keeps every unstarted conversation as its own tab in creation order", () => {
    const drafts = {
      newest: {
        environmentId: "local",
        projectId: "alpha",
        createdAt: "2026-08-03T10:00:00.000Z",
        promotedTo: null,
      },
      oldest: {
        environmentId: "local",
        projectId: "alpha",
        createdAt: "2026-08-01T10:00:00.000Z",
        promotedTo: null,
      },
      promoted: {
        environmentId: "local",
        projectId: "alpha",
        createdAt: "2026-08-02T10:00:00.000Z",
        promotedTo: { environmentId: "local", threadId: "server-thread" },
      },
      otherProject: {
        environmentId: "local",
        projectId: "beta",
        createdAt: "2026-07-31T10:00:00.000Z",
        promotedTo: null,
      },
    };

    expect(resolveArkadiaDraftTabIds(drafts, "local", "alpha")).toEqual(["oldest", "newest"]);
  });

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
          openTabKeys: ReadonlySet<string>;
        }) => ReadonlyArray<EnvironmentThreadShell>;
      }
    ).buildArkadiaWorkspaceTabs;
    expect(typeof buildArkadiaWorkspaceTabs).toBe("function");

    const tabs = buildArkadiaWorkspaceTabs({
      openTabKeys: new Set(["local:first", "local:second"]),
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
    });

    expect(tabs.map((item) => item.id)).toEqual(["first", "second"]);
  });

  it("does not open a local tab merely because a server conversation is active", () => {
    const tabs = arkadiaSidebarModel.buildArkadiaWorkspaceTabs({
      threads: [thread("local-open", "alpha"), thread("remote-active", "alpha")],
      environmentId: "local",
      projectId: "alpha",
      currentThreadId: null,
      openTabKeys: new Set([arkadiaSidebarModel.arkadiaWorkspaceTabKey("local", "local-open")]),
    });

    expect(tabs.map((item) => item.id)).toEqual(["local-open"]);
  });

  it("keeps the selected conversation visible while it is being settled", () => {
    const buildArkadiaWorkspaceTabs = (
      arkadiaSidebarModel as typeof arkadiaSidebarModel & {
        buildArkadiaWorkspaceTabs: (input: {
          threads: ReadonlyArray<EnvironmentThreadShell>;
          environmentId: string;
          projectId: string;
          currentThreadId: string | null;
          openTabKeys: ReadonlySet<string>;
        }) => ReadonlyArray<EnvironmentThreadShell>;
      }
    ).buildArkadiaWorkspaceTabs;

    const tabs = buildArkadiaWorkspaceTabs({
      threads: [thread("selected", "alpha", { settledOverride: "settled" })],
      environmentId: "local",
      projectId: "alpha",
      currentThreadId: "selected",
      openTabKeys: new Set<string>(),
    });

    expect(tabs.map((item) => item.id)).toEqual(["selected"]);
  });

  it("keeps a resumed settled conversation after switching projects and returning", () => {
    const tabs = arkadiaSidebarModel.buildArkadiaWorkspaceTabs({
      threads: [thread("resumed", "alpha", { settledOverride: "settled" })],
      environmentId: "local",
      projectId: "alpha",
      currentThreadId: null,
      openTabKeys: new Set([arkadiaSidebarModel.arkadiaWorkspaceTabKey("local", "resumed")]),
    });

    expect(tabs.map((item) => item.id)).toEqual(["resumed"]);
  });

  it("hides conversations the user closed, unless one is the open conversation", () => {
    const buildArkadiaWorkspaceTabs = (
      arkadiaSidebarModel as typeof arkadiaSidebarModel & {
        buildArkadiaWorkspaceTabs: (input: {
          threads: ReadonlyArray<EnvironmentThreadShell>;
          environmentId: string;
          projectId: string;
          currentThreadId: string | null;
          openTabKeys: ReadonlySet<string>;
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
      openTabKeys: new Set([arkadiaWorkspaceTabKey("local", "kept")]),
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

describe("Arkadia inactive projects", () => {
  it("promotes a resumed settled conversation and its project back to Active", () => {
    const result = sidebarGroups({
      projects: [project("alpha", "Alpha")],
      threads: [thread("resumed", "alpha", { settledOverride: "settled" })],
      openThreadIds: ["resumed"],
    });

    expect(result.active.map((group) => group.project.id)).toEqual(["alpha"]);
    expect(result.inactive).toEqual([]);
  });

  it("requires the explicit context-menu delete action", async () => {
    const showContextMenu = vi.fn(async () => "delete" as const);
    const deleteProject = vi.fn(async () => undefined);

    await expect(
      requestArkadiaInactiveProjectDeletion({
        position: { x: 12, y: 34 },
        showContextMenu,
        deleteProject,
      }),
    ).resolves.toBe(true);
    expect(showContextMenu).toHaveBeenCalledWith([{ id: "delete", label: "Supprimer" }], {
      x: 12,
      y: 34,
    });
    expect(deleteProject).toHaveBeenCalledOnce();
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

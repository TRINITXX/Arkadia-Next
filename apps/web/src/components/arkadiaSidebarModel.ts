import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/models";
import { effectiveSettled } from "@t3tools/client-runtime/state/thread-settled";

const ARKADIA_PROJECT_COLORS = [
  "#ff6b6b",
  "#ee9b00",
  "#84c452",
  "#4ecdc4",
  "#4f9dff",
  "#c671ff",
  "#ff61a6",
  "#a8a8a8",
] as const;

export interface ArkadiaSidebarProjectGroup {
  readonly project: EnvironmentProject;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly color: string;
}

export interface ArkadiaSidebarGroups {
  readonly active: ReadonlyArray<ArkadiaSidebarProjectGroup>;
  readonly inactive: ReadonlyArray<ArkadiaSidebarProjectGroup>;
}

export function resolveArkadiaDraftTabId(
  drafts: Readonly<
    Record<
      string,
      {
        readonly environmentId: string;
        readonly projectId: string;
        readonly promotedTo?: unknown | null;
      }
    >
  >,
  environmentId: string,
  projectId: string,
): string | null {
  for (const [draftId, draft] of Object.entries(drafts)) {
    if (
      draft.environmentId === environmentId &&
      draft.projectId === projectId &&
      draft.promotedTo == null
    ) {
      return draftId;
    }
  }
  return null;
}

/** Stable identity of a tab across environments, used by the closed-tab store. */
export function arkadiaWorkspaceTabKey(environmentId: string, threadId: string): string {
  return `${environmentId}:${threadId}`;
}

export function buildArkadiaWorkspaceTabs(input: {
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly environmentId: string;
  readonly projectId: string;
  readonly currentThreadId: string | null;
  /**
   * Tabs the user closed with the cross. Closing is a window-local gesture, so
   * it hides the tab even when the conversation stays active server-side —
   * except for the conversation currently on screen, which must stay reachable.
   */
  readonly closedTabKeys: ReadonlySet<string>;
  readonly now: string;
  readonly autoSettleAfterDays: number | null;
}): ReadonlyArray<EnvironmentThreadShell> {
  return input.threads
    .filter((thread) => {
      if (thread.environmentId !== input.environmentId) return false;
      if (thread.projectId !== input.projectId) return false;
      if (thread.archivedAt !== null) return false;
      if (thread.id === input.currentThreadId) return true;
      if (input.closedTabKeys.has(arkadiaWorkspaceTabKey(thread.environmentId, thread.id))) {
        return false;
      }
      return !effectiveSettled(thread, {
        now: input.now,
        autoSettleAfterDays: input.autoSettleAfterDays,
      });
    })
    .toSorted((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
}

/**
 * The conversation to fall back on when a non-conversation tab (a project
 * terminal) is on screen: the one the user was last actually reading, not
 * merely the one an agent touched most recently. Also keeps that tab in the
 * bar while the terminal is open, so leaving a settled conversation for a
 * terminal does not make its tab disappear behind the user.
 */
export function resolveArkadiaReturnThreadId(input: {
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly environmentId: string;
  readonly projectId: string;
  /** `scopedThreadKey` → ISO timestamp, from the UI state store. */
  readonly lastVisitedAtByThreadKey: Readonly<Record<string, string>>;
}): string | null {
  const ranked = input.threads
    .filter(
      (thread) =>
        thread.environmentId === input.environmentId &&
        thread.projectId === input.projectId &&
        thread.archivedAt === null,
    )
    .map((thread) => ({
      id: thread.id,
      // A conversation never opened in this window has no visit timestamp;
      // its own update time is the closest stand-in.
      at:
        input.lastVisitedAtByThreadKey[`${thread.environmentId}:${thread.id}`] ?? thread.updatedAt,
    }))
    .toSorted((left, right) => right.at.localeCompare(left.at));
  return ranked[0]?.id ?? null;
}

export function resolveArkadiaTabAfterClose(
  tabIds: ReadonlyArray<string>,
  closingId: string,
): string | null {
  const closingIndex = tabIds.indexOf(closingId);
  if (closingIndex < 0) return null;
  return tabIds[closingIndex + 1] ?? tabIds[closingIndex - 1] ?? null;
}

export type ArkadiaActiveProjectLayout = "empty" | "solo" | "tabs";

export function resolveArkadiaActiveProjectLayout(threadCount: number): ArkadiaActiveProjectLayout {
  if (threadCount <= 0) return "empty";
  return threadCount === 1 ? "solo" : "tabs";
}

export interface ArkadiaThreadIndicator {
  readonly tone: "waiting" | "working" | "error";
  readonly color: string;
  readonly label: string;
}

function agentDisplayName(instanceId: string): string {
  const knownNames: Readonly<Record<string, string>> = {
    claudeagent: "Claude",
    codex: "Codex",
    cursor: "Cursor",
    grok: "Grok",
    opencode: "OpenCode",
  };
  const normalized = instanceId.trim();
  return (knownNames[normalized.toLowerCase()] ?? normalized) || "Agent";
}

export function resolveArkadiaThreadIndicator(
  thread: EnvironmentThreadShell,
): ArkadiaThreadIndicator {
  const agentName = agentDisplayName(String(thread.modelSelection.instanceId));

  if (thread.hasPendingApprovals || thread.hasPendingUserInput) {
    return {
      tone: "waiting",
      color: "#10b981",
      label: `${agentName} attend une réponse`,
    };
  }
  if (thread.session?.status === "starting" || thread.session?.status === "running") {
    return {
      tone: "working",
      color: "#f59e0b",
      label: `${agentName} travaille`,
    };
  }
  if (thread.session?.status === "error") {
    return {
      tone: "error",
      color: "#ef4444",
      label: `${agentName} a rencontré une erreur`,
    };
  }
  return {
    tone: "waiting",
    color: "#10b981",
    label: `${agentName} attend votre message`,
  };
}

function projectKey(project: EnvironmentProject): string {
  return `${project.environmentId}:${project.id}`;
}

function threadProjectKey(thread: EnvironmentThreadShell): string {
  return `${thread.environmentId}:${thread.projectId}`;
}

function compareProjects(
  left: ArkadiaSidebarProjectGroup,
  right: ArkadiaSidebarProjectGroup,
): number {
  return left.project.title.localeCompare(right.project.title, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

// Creation order, oldest first: the sidebar mirrors the tab bar, so a new
// conversation lands at the bottom of its project instead of jumping to the top
// every time the agent touches an older one.
function compareThreads(left: EnvironmentThreadShell, right: EnvironmentThreadShell): number {
  return Date.parse(left.createdAt) - Date.parse(right.createdAt);
}

export function buildArkadiaSidebarGroups(input: {
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly now: string;
  readonly autoSettleAfterDays: number | null;
}): ArkadiaSidebarGroups {
  const visibleThreads = input.threads.filter((thread) => thread.archivedAt === null);
  const activeThreadsByProject = new Map<string, EnvironmentThreadShell[]>();
  const inactiveThreadsByProject = new Map<string, EnvironmentThreadShell[]>();

  for (const thread of visibleThreads) {
    const target = effectiveSettled(thread, {
      now: input.now,
      autoSettleAfterDays: input.autoSettleAfterDays,
    })
      ? inactiveThreadsByProject
      : activeThreadsByProject;
    const key = threadProjectKey(thread);
    const existing = target.get(key);
    if (existing) {
      existing.push(thread);
    } else {
      target.set(key, [thread]);
    }
  }

  const active: ArkadiaSidebarProjectGroup[] = [];
  const inactive: ArkadiaSidebarProjectGroup[] = [];
  for (const project of input.projects) {
    const key = projectKey(project);
    const projectActiveThreads = activeThreadsByProject.get(key) ?? [];
    const projectInactiveThreads = inactiveThreadsByProject.get(key) ?? [];
    const group = {
      project,
      threads: (projectActiveThreads.length > 0 ? projectActiveThreads : projectInactiveThreads)
        .slice()
        .sort(compareThreads),
      color: arkadiaProjectColor(project.workspaceRoot),
    } satisfies ArkadiaSidebarProjectGroup;

    if (projectActiveThreads.length > 0) {
      active.push(group);
    } else {
      inactive.push(group);
    }
  }

  return {
    active: active.sort(compareProjects),
    inactive: inactive.sort(compareProjects),
  };
}

export function shortenArkadiaProjectPath(path: string): string {
  const parts = path.replaceAll("/", "\\").split("\\").filter(Boolean);
  if (parts.length <= 2) return parts.join("\\");
  return parts.slice(-2).join("\\");
}

export function arkadiaProjectColor(value: string): string {
  let hash = 0;
  for (const character of value.toLowerCase()) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return ARKADIA_PROJECT_COLORS[hash % ARKADIA_PROJECT_COLORS.length]!;
}

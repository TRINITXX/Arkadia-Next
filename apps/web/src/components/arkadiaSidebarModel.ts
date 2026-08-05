import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/models";
import { getProjectOrderKey } from "../logicalProject";
import { orderItemsByPreferredIds } from "./Sidebar.logic";

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

export interface ArkadiaDraftTabSource {
  readonly environmentId: string;
  readonly projectId: string;
  readonly createdAt: string;
  readonly promotedTo?: unknown | null;
}

export type ArkadiaWorkspaceTabItem =
  | {
      readonly kind: "thread";
      readonly key: string;
      readonly thread: EnvironmentThreadShell;
    }
  | {
      readonly kind: "draft";
      readonly key: string;
      readonly draftId: string;
      readonly createdAt: string;
    }
  | {
      readonly kind: "terminal";
      readonly key: string;
      readonly terminalId: string;
    };

export interface ArkadiaSidebarProjectGroup {
  readonly project: EnvironmentProject;
  readonly tabs: ReadonlyArray<ArkadiaWorkspaceTabItem>;
  readonly color: string;
}

export interface ArkadiaSidebarGroups {
  readonly active: ReadonlyArray<ArkadiaSidebarProjectGroup>;
  readonly inactive: ReadonlyArray<ArkadiaSidebarProjectGroup>;
}

export function handleArkadiaWorkspaceTabMouseDown(input: {
  readonly button: number;
  readonly preventDefault: () => void;
  readonly closeTab: () => void;
}): boolean {
  if (input.button !== 1) return false;
  input.preventDefault();
  input.closeTab();
  return true;
}

export async function requestArkadiaInactiveProjectDeletion(input: {
  readonly position: { readonly x: number; readonly y: number };
  readonly showContextMenu: (
    items: readonly [{ readonly id: "delete"; readonly label: "Supprimer" }],
    position: { readonly x: number; readonly y: number },
  ) => Promise<"delete" | null>;
  readonly deleteProject: () => Promise<void>;
}): Promise<boolean> {
  const action = await input.showContextMenu(
    [{ id: "delete", label: "Supprimer" }],
    input.position,
  );
  if (action !== "delete") return false;
  await input.deleteProject();
  return true;
}

/**
 * Starts the fallback navigation, then removes the draft synchronously. The
 * router promise can remain pending while loaders settle; tab closure must not
 * depend on that promise resolving.
 */
export function closeArkadiaDraftTab(input: {
  readonly navigateAway: () => Promise<void>;
  readonly clearDraft: () => void;
}): Promise<void> {
  try {
    return input.navigateAway();
  } finally {
    input.clearDraft();
  }
}

export function resolveArkadiaDraftTabIds(
  drafts: Readonly<
    Record<
      string,
      {
        readonly environmentId: string;
        readonly projectId: string;
        readonly createdAt: string;
        readonly promotedTo?: unknown | null;
      }
    >
  >,
  environmentId: string,
  projectId: string,
): string[] {
  return Object.entries(drafts)
    .filter(
      ([, draft]) =>
        draft.environmentId === environmentId &&
        draft.projectId === projectId &&
        draft.promotedTo == null,
    )
    .sort(([, left], [, right]) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
    .map(([draftId]) => draftId);
}

export function resolveArkadiaDraftTabId(
  drafts: Parameters<typeof resolveArkadiaDraftTabIds>[0],
  environmentId: string,
  projectId: string,
): string | null {
  return resolveArkadiaDraftTabIds(drafts, environmentId, projectId)[0] ?? null;
}

export function resolveArkadiaInactiveProjectOpenTarget(
  drafts: Parameters<typeof resolveArkadiaDraftTabIds>[0],
  environmentId: string,
  projectId: string,
): { readonly kind: "draft"; readonly draftId: string } | { readonly kind: "new-draft" } {
  const draftId = resolveArkadiaDraftTabId(drafts, environmentId, projectId);
  return draftId === null ? { kind: "new-draft" } : { kind: "draft", draftId };
}

export function prependArkadiaWorkspaceTabKey(
  existingKeys: ReadonlyArray<string>,
  newKey: string,
): string[] {
  return [newKey, ...existingKeys.filter((key) => key !== newKey)];
}

/** Stable identity of a conversation tab across environments. */
export function arkadiaWorkspaceTabKey(environmentId: string, threadId: string): string {
  return `${environmentId}:${threadId}`;
}

export function resolveArkadiaProjectOpenTab(
  tabs: ReadonlyArray<ArkadiaWorkspaceTabItem>,
  lastActiveKey: string | null | undefined,
): ArkadiaWorkspaceTabItem | null {
  return tabs.find((tab) => tab.key === lastActiveKey) ?? tabs[0] ?? null;
}

export function buildArkadiaWorkspaceTabs(input: {
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly environmentId: string;
  readonly projectId: string;
  readonly currentThreadId: string | null;
  readonly openTabKeys: ReadonlySet<string>;
}): ReadonlyArray<EnvironmentThreadShell> {
  return input.threads
    .filter((thread) => {
      if (thread.environmentId !== input.environmentId) return false;
      if (thread.projectId !== input.projectId) return false;
      if (thread.archivedAt !== null) return false;
      if (thread.id === input.currentThreadId) return true;
      const tabKey = arkadiaWorkspaceTabKey(thread.environmentId, thread.id);
      return input.openTabKeys.has(tabKey);
    })
    .toSorted((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
}

export function buildArkadiaWorkspaceTabItems(input: {
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly environmentId: string;
  readonly projectId: string;
  readonly currentThreadId?: string | null;
  readonly openThreadTabKeys: ReadonlySet<string>;
  readonly drafts: Readonly<Record<string, ArkadiaDraftTabSource>>;
  readonly terminals: ReadonlyArray<{ readonly terminalId: string }>;
  readonly preferredIds?: readonly string[];
}): ReadonlyArray<ArkadiaWorkspaceTabItem> {
  const items: ArkadiaWorkspaceTabItem[] = buildArkadiaWorkspaceTabs({
    threads: input.threads,
    environmentId: input.environmentId,
    projectId: input.projectId,
    currentThreadId: input.currentThreadId ?? null,
    openTabKeys: input.openThreadTabKeys,
  }).map((thread) => ({
    kind: "thread",
    key: arkadiaWorkspaceTabKey(thread.environmentId, thread.id),
    thread,
  }));

  for (const [draftId, draft] of Object.entries(input.drafts)
    .filter(
      ([, draft]) =>
        draft.environmentId === input.environmentId &&
        draft.projectId === input.projectId &&
        draft.promotedTo == null,
    )
    .toSorted(([, left], [, right]) => Date.parse(left.createdAt) - Date.parse(right.createdAt))) {
    items.push({ kind: "draft", key: `draft:${draftId}`, draftId, createdAt: draft.createdAt });
  }

  for (const terminal of input.terminals) {
    items.push({
      kind: "terminal",
      key: `terminal:${terminal.terminalId}`,
      terminalId: terminal.terminalId,
    });
  }

  return input.preferredIds && input.preferredIds.length > 0
    ? orderItemsByPreferredIds({
        items,
        preferredIds: input.preferredIds,
        getId: (item) => item.key,
      })
    : items;
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

export function canCloseArkadiaDraftTab(
  tabs: ReadonlyArray<ArkadiaWorkspaceTabItem>,
  draftKey: string,
): boolean {
  return tabs.length > 1 && tabs.some((tab) => tab.kind === "draft" && tab.key === draftKey);
}

export function isArkadiaProjectActive(tabs: ReadonlyArray<ArkadiaWorkspaceTabItem>): boolean {
  return tabs.length > 1 || tabs.some((tab) => tab.kind !== "draft");
}

/**
 * The project to fall back on once the last tab of the current project is
 * closed: the first still-active project other than the one being emptied.
 * The emptied project is excluded explicitly because the thread that was just
 * closed is still classified active in the snapshot (settling is async), so it
 * would otherwise pick itself right back.
 */
export function resolveArkadiaNextActiveProject(
  activeGroups: ReadonlyArray<ArkadiaSidebarProjectGroup>,
  excludeProjectKey: string,
): ArkadiaSidebarProjectGroup | null {
  return (
    activeGroups.find(
      (group) => projectKey(group.project) !== excludeProjectKey && group.tabs.length > 0,
    ) ?? null
  );
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

function compareProjects(
  left: ArkadiaSidebarProjectGroup,
  right: ArkadiaSidebarProjectGroup,
): number {
  return left.project.title.localeCompare(right.project.title, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export function buildArkadiaSidebarGroups(input: {
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly openThreadTabKeys: ReadonlySet<string>;
  readonly drafts: Readonly<Record<string, ArkadiaDraftTabSource>>;
  readonly terminalsByProjectKey: Readonly<
    Record<string, ReadonlyArray<{ readonly terminalId: string }>>
  >;
  /**
   * Manual project order, as physical project keys (see `getProjectOrderKey`).
   * Shared with the legacy sidebar's persisted `projectOrder`. Projects listed
   * here lead, in that order; the rest fall back to alphabetical. Applied
   * independently within each tab so reordering stays inside Active / Inactive.
   */
  readonly projectOrder?: readonly string[];
  /**
   * Manual mixed-tab order per project (`scopedProjectKey` → ordered tab keys),
   * shared with the workspace tab bar so the sidebar mirrors conversations,
   * drafts, and terminals in exactly the same order.
   */
  readonly tabOrderByProjectKey?: Readonly<Record<string, readonly string[]>>;
}): ArkadiaSidebarGroups {
  const threadsByProjectKey = new Map<string, EnvironmentThreadShell[]>();
  for (const thread of input.threads) {
    const key = `${thread.environmentId}:${thread.projectId}`;
    const existing = threadsByProjectKey.get(key);
    if (existing) existing.push(thread);
    else threadsByProjectKey.set(key, [thread]);
  }

  const draftsByProjectKey = new Map<string, Record<string, ArkadiaDraftTabSource>>();
  for (const [draftId, draft] of Object.entries(input.drafts)) {
    const key = `${draft.environmentId}:${draft.projectId}`;
    const existing = draftsByProjectKey.get(key);
    if (existing) existing[draftId] = draft;
    else draftsByProjectKey.set(key, { [draftId]: draft });
  }

  const active: ArkadiaSidebarProjectGroup[] = [];
  const inactive: ArkadiaSidebarProjectGroup[] = [];
  for (const project of input.projects) {
    const key = projectKey(project);
    const tabs = buildArkadiaWorkspaceTabItems({
      threads: threadsByProjectKey.get(key) ?? [],
      environmentId: project.environmentId,
      projectId: project.id,
      openThreadTabKeys: input.openThreadTabKeys,
      drafts: draftsByProjectKey.get(key) ?? {},
      terminals: input.terminalsByProjectKey[key] ?? [],
      ...(input.tabOrderByProjectKey?.[key]
        ? { preferredIds: input.tabOrderByProjectKey[key] }
        : {}),
    });
    const group = {
      project,
      tabs,
      color: arkadiaProjectColor(project.workspaceRoot),
    } satisfies ArkadiaSidebarProjectGroup;

    if (isArkadiaProjectActive(tabs)) {
      active.push(group);
    } else {
      inactive.push(group);
    }
  }

  const applyManualOrder = (groups: ArkadiaSidebarProjectGroup[]): ArkadiaSidebarProjectGroup[] => {
    const alphabetical = groups.sort(compareProjects);
    if (!input.projectOrder || input.projectOrder.length === 0) {
      return alphabetical;
    }
    return orderItemsByPreferredIds({
      items: alphabetical,
      preferredIds: input.projectOrder,
      getId: (group) => getProjectOrderKey(group.project),
    });
  };

  return {
    active: applyManualOrder(active),
    inactive: applyManualOrder(inactive),
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

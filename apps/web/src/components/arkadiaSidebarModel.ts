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

function compareThreads(left: EnvironmentThreadShell, right: EnvironmentThreadShell): number {
  return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
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

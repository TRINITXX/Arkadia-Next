import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/models";
import type { EnvironmentThreadSearchMatch } from "@t3tools/client-runtime/state/thread-search";
import type { ScopedThreadRef } from "@t3tools/contracts";

export type RecentSessionGroupingMode = "date" | "project";

export interface RecentSessionRow {
  readonly key: string;
  readonly ref: ScopedThreadRef;
  readonly project: EnvironmentProject | null;
  readonly projectTitle: string;
  readonly projectWorkspaceRoot: string | null;
  readonly title: string;
  readonly providerLabel: string;
  readonly modelLabel: string;
  readonly updatedAt: string;
  readonly excerpt?: string;
  readonly excerptSource?: EnvironmentThreadSearchMatch["source"];
}

export interface RecentSessionGroup {
  readonly key: string;
  readonly label: string;
  readonly rows: ReadonlyArray<RecentSessionRow>;
}

interface BuildRecentSessionRowsInput {
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly query: string;
  readonly contentMatches?: ReadonlyArray<EnvironmentThreadSearchMatch>;
}

function scopedKey(environmentId: string, entityId: string): string {
  return JSON.stringify([environmentId, entityId]);
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replaceAll(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase();
}

function providerLabel(instanceId: string): string {
  const builtInLabels: Readonly<Record<string, string>> = {
    claudeagent: "Claude",
    codex: "Codex",
    cursor: "Cursor",
    grok: "Grok",
    opencode: "OpenCode",
  };
  return builtInLabels[instanceId.toLocaleLowerCase()] ?? instanceId;
}

export function buildRecentSessionRows(input: BuildRecentSessionRowsInput): RecentSessionRow[] {
  const projectsByKey = new Map(
    input.projects.map((project) => [scopedKey(project.environmentId, project.id), project]),
  );
  const contentMatchesByThread = new Map<string, EnvironmentThreadSearchMatch>();
  for (const match of input.contentMatches ?? []) {
    const key = scopedKey(match.environmentId, match.threadId);
    if (!contentMatchesByThread.has(key)) {
      contentMatchesByThread.set(key, match);
    }
  }

  const queryWords = normalizeSearchText(input.query).trim().split(/\s+/u).filter(Boolean);

  return input.threads
    .flatMap((thread): RecentSessionRow[] => {
      const key = scopedKey(thread.environmentId, thread.id);
      const project = projectsByKey.get(scopedKey(thread.environmentId, thread.projectId)) ?? null;
      const match = contentMatchesByThread.get(key);
      const metadata = normalizeSearchText(
        [
          thread.title,
          project?.title ?? thread.projectId,
          project?.workspaceRoot ?? "",
          thread.modelSelection.instanceId,
          thread.modelSelection.model,
        ].join(" "),
      );
      const metadataMatches = queryWords.every((word) => metadata.includes(word));
      if (queryWords.length > 0 && !metadataMatches && match === undefined) {
        return [];
      }

      return [
        {
          key,
          ref: { environmentId: thread.environmentId, threadId: thread.id },
          project,
          projectTitle: project?.title ?? thread.projectId,
          projectWorkspaceRoot: project?.workspaceRoot ?? null,
          title: thread.title,
          providerLabel: providerLabel(thread.modelSelection.instanceId),
          modelLabel: thread.modelSelection.model,
          updatedAt: thread.updatedAt,
          ...(match === undefined ? {} : { excerpt: match.snippet, excerptSource: match.source }),
        },
      ];
    })
    .toSorted((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

function calendarDayNumber(value: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((candidate) => candidate.type === type)?.value ?? 0);
  return Math.floor(Date.UTC(part("year"), part("month") - 1, part("day")) / 86_400_000);
}

export function formatRecentSessionTime(
  updatedAt: string,
  locale = "fr-FR",
  timeZone?: string,
): string {
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    ...(timeZone ? { timeZone } : {}),
  }).format(new Date(updatedAt));
}

export function formatRecentSessionDateLabel(
  updatedAt: string,
  now: Date,
  locale = "fr-FR",
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
): string {
  const differenceInDays =
    calendarDayNumber(now, timeZone) - calendarDayNumber(new Date(updatedAt), timeZone);
  if (differenceInDays <= 0) return "Aujourd’hui";
  if (differenceInDays === 1) return "Hier";
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone,
  }).format(new Date(updatedAt));
}

function dateBucket(
  updatedAt: string,
  now: Date,
): { readonly key: string; readonly label: string } {
  const date = new Date(updatedAt);
  return {
    key: `date:${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`,
    label: formatRecentSessionDateLabel(updatedAt, now),
  };
}

export function groupRecentSessionRows(
  rows: ReadonlyArray<RecentSessionRow>,
  mode: RecentSessionGroupingMode,
  now = new Date(),
): RecentSessionGroup[] {
  const groups = new Map<string, RecentSessionGroup>();
  for (const row of rows) {
    const group =
      mode === "date"
        ? dateBucket(row.updatedAt, now)
        : {
            key: `project:${scopedKey(row.project?.environmentId ?? row.ref.environmentId, row.project?.id ?? row.projectTitle)}`,
            label: row.projectTitle,
          };
    const existing = groups.get(group.key);
    groups.set(group.key, {
      key: group.key,
      label: group.label,
      rows: existing === undefined ? [row] : [...existing.rows, row],
    });
  }
  return [...groups.values()];
}

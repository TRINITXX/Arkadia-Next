import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/models";
import type { EnvironmentThreadSearchMatch } from "@t3tools/client-runtime/state/thread-search";
import { describe, expect, it } from "vite-plus/test";

import {
  buildRecentSessionRows,
  formatRecentSessionDateLabel,
  formatRecentSessionTime,
  groupRecentSessionRows,
} from "./recentSessionsNavigator.logic";

const NOW = new Date("2026-08-05T12:00:00.000Z");

function project(
  environmentId: string,
  id: string,
  title: string,
  workspaceRoot: string,
): EnvironmentProject {
  return {
    environmentId,
    id,
    title,
    workspaceRoot,
    repositoryIdentity: null,
    defaultModelSelection: null,
    scripts: [],
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-01T10:00:00.000Z",
  } as unknown as EnvironmentProject;
}

function thread(input: {
  environmentId: string;
  id: string;
  projectId: string;
  title: string;
  updatedAt: string;
  instanceId?: string;
  model?: string;
}): EnvironmentThreadShell {
  return {
    ...input,
    modelSelection: {
      instanceId: input.instanceId ?? "claudeAgent",
      model: input.model ?? "claude-opus-4-6",
    },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: input.updatedAt,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    snoozedUntil: null,
    snoozedAt: null,
    titleRegeneration: null,
    session: null,
    latestUserMessageAt: input.updatedAt,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
  } as unknown as EnvironmentThreadShell;
}

function contentMatch(input: {
  environmentId: string;
  threadId: string;
  projectId: string;
  snippet: string;
  source?: "user" | "assistant";
}): EnvironmentThreadSearchMatch {
  return {
    ...input,
    source: input.source ?? "assistant",
    messageCreatedAt: "2026-08-05T10:00:00.000Z",
  } as unknown as EnvironmentThreadSearchMatch;
}

const projects = [
  project("local", "arkadia", "Arkadia Next", "C:\\Code\\Arkadia-Next"),
  project("remote", "planner", "VTC Planner", "/srv/vtc-planner"),
];

const threads = [
  thread({
    environmentId: "local",
    id: "latest",
    projectId: "arkadia",
    title: "Recent sessions navigator",
    updatedAt: "2026-08-05T11:00:00.000Z",
    instanceId: "codex",
    model: "gpt-5.6",
  }),
  thread({
    environmentId: "remote",
    id: "yesterday",
    projectId: "planner",
    title: "Dispatch polish",
    updatedAt: "2026-08-04T09:00:00.000Z",
  }),
  thread({
    environmentId: "local",
    id: "older",
    projectId: "arkadia",
    title: "Provider registry",
    updatedAt: "2026-07-20T09:00:00.000Z",
  }),
];

describe("buildRecentSessionRows", () => {
  it("matches every metadata word across title and project fields", () => {
    const rows = buildRecentSessionRows({
      threads,
      projects,
      query: "sessions arkadia code",
      contentMatches: [],
    });

    expect(rows.map((row) => row.ref.threadId)).toEqual(["latest"]);
    expect(rows[0]).toMatchObject({
      providerLabel: "Codex",
      modelLabel: "gpt-5.6",
      projectTitle: "Arkadia Next",
      projectWorkspaceRoot: "C:\\Code\\Arkadia-Next",
    });
  });

  it("merges content matches once per scoped thread and keeps the first excerpt", () => {
    const rows = buildRecentSessionRows({
      threads,
      projects,
      query: "authentication failure",
      contentMatches: [
        contentMatch({
          environmentId: "remote",
          threadId: "yesterday",
          projectId: "planner",
          snippet: "Fixed the authentication failure in dispatch.",
        }),
        contentMatch({
          environmentId: "remote",
          threadId: "yesterday",
          projectId: "planner",
          snippet: "Duplicate match from a second message.",
          source: "user",
        }),
      ],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      ref: { environmentId: "remote", threadId: "yesterday" },
      excerpt: "Fixed the authentication failure in dispatch.",
      excerptSource: "assistant",
    });
  });

  it("orders every unfiltered conversation newest first across environments", () => {
    const rows = buildRecentSessionRows({ threads, projects, query: "", contentMatches: [] });

    expect(rows.map((row) => row.ref.threadId)).toEqual(["latest", "yesterday", "older"]);
  });
});

describe("groupRecentSessionRows", () => {
  it("formats today, yesterday, explicit calendar dates and row times", () => {
    expect(formatRecentSessionDateLabel("2026-08-05T11:00:00.000Z", NOW, "fr-FR", "UTC")).toBe(
      "Aujourd’hui",
    );
    expect(formatRecentSessionDateLabel("2026-08-04T09:00:00.000Z", NOW, "fr-FR", "UTC")).toBe(
      "Hier",
    );
    expect(formatRecentSessionDateLabel("2026-07-20T09:00:00.000Z", NOW, "fr-FR", "UTC")).toBe(
      "20 juillet 2026",
    );
    expect(formatRecentSessionTime("2026-08-05T11:07:00.000Z", "fr-FR", "UTC")).toBe("11:07");
  });

  it("builds relative date buckets without changing the complete result set", () => {
    const rows = buildRecentSessionRows({ threads, projects, query: "", contentMatches: [] });
    const groups = groupRecentSessionRows(rows, "date", NOW);

    expect(groups.map((group) => [group.label, group.rows.map((row) => row.ref.threadId)])).toEqual(
      [
        ["Aujourd’hui", ["latest"]],
        ["Hier", ["yesterday"]],
        ["20 juillet 2026", ["older"]],
      ],
    );
    expect(groups.flatMap((group) => group.rows)).toHaveLength(rows.length);
  });

  it("groups by scoped project while keeping groups and rows newest first", () => {
    const rows = buildRecentSessionRows({ threads, projects, query: "", contentMatches: [] });
    const groups = groupRecentSessionRows(rows, "project", NOW);

    expect(groups.map((group) => [group.label, group.rows.map((row) => row.ref.threadId)])).toEqual(
      [
        ["Arkadia Next", ["latest", "older"]],
        ["VTC Planner", ["yesterday"]],
      ],
    );
    expect(new Set(groups.flatMap((group) => group.rows.map((row) => row.key)))).toEqual(
      new Set(rows.map((row) => row.key)),
    );
  });
});

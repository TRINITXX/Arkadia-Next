import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/models";
import type { EnvironmentThreadSearchMatch } from "@t3tools/client-runtime/state/thread-search";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  createInitialRecentSessionsNavigatorState,
  deriveRecentSessionsNavigatorViewModel,
  RecentSessionRowButton,
  RecentSessionsNavigatorView,
  reduceRecentSessionsNavigatorState,
} from "./RecentSessionsNavigator";

function project(id: string, title: string): EnvironmentProject {
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
  title: string,
  updatedAt: string,
): EnvironmentThreadShell {
  return {
    environmentId: "local",
    id,
    projectId,
    title,
    modelSelection: { instanceId: "codex", model: "gpt-5.6" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: updatedAt,
    updatedAt,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    snoozedUntil: null,
    snoozedAt: null,
    titleRegeneration: null,
    session: null,
    latestUserMessageAt: updatedAt,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
  } as unknown as EnvironmentThreadShell;
}

const projects = [project("arkadia", "Arkadia Next"), project("planner", "VTC Planner")];
const threads = [
  thread("newest", "arkadia", "Recent sessions", "2026-08-05T12:00:00.000Z"),
  thread("older", "planner", "Dispatch cleanup", "2026-08-04T12:00:00.000Z"),
];

describe("RecentSessionsNavigator", () => {
  it("opens with the newest session selected", () => {
    const viewModel = deriveRecentSessionsNavigatorViewModel({
      threads,
      projects,
      contentMatches: [],
      state: createInitialRecentSessionsNavigatorState(),
      now: new Date("2026-08-05T13:00:00.000Z"),
    });

    expect(viewModel.selectedRow?.ref.threadId).toBe("newest");
  });

  it("filters after a multi-word query and preserves a content-only match", () => {
    const queried = reduceRecentSessionsNavigatorState(
      createInitialRecentSessionsNavigatorState(),
      { type: "query-changed", query: "authentication failure" },
    );
    const contentMatches = [
      {
        environmentId: "local",
        threadId: "older",
        projectId: "planner",
        source: "user",
        snippet: "The authentication failure happens after reconnect.",
        messageCreatedAt: "2026-08-04T11:00:00.000Z",
      } as unknown as EnvironmentThreadSearchMatch,
    ];

    const viewModel = deriveRecentSessionsNavigatorViewModel({
      threads,
      projects,
      contentMatches,
      state: queried,
      now: new Date("2026-08-05T13:00:00.000Z"),
    });

    expect(viewModel.rows.map((row) => row.ref.threadId)).toEqual(["older"]);
    expect(viewModel.selectedRow?.excerpt).toContain("authentication failure");
  });

  it("switches between Date and Project grouping", () => {
    const initial = createInitialRecentSessionsNavigatorState();
    const projectState = reduceRecentSessionsNavigatorState(initial, {
      type: "grouping-changed",
      grouping: "project",
    });
    const dateView = deriveRecentSessionsNavigatorViewModel({
      threads,
      projects,
      contentMatches: [],
      state: initial,
      now: new Date("2026-08-05T13:00:00.000Z"),
    });
    const projectView = deriveRecentSessionsNavigatorViewModel({
      threads,
      projects,
      contentMatches: [],
      state: projectState,
      now: new Date("2026-08-05T13:00:00.000Z"),
    });

    expect(dateView.groups.map((group) => group.label)).toEqual(["Aujourd’hui", "Hier"]);
    expect(projectView.groups.map((group) => group.label)).toEqual(["Arkadia Next", "VTC Planner"]);
  });

  it("selecting a row requests only a preview", () => {
    const onSelect = vi.fn();
    const onResume = vi.fn();
    const onFocusOpenThread = vi.fn();
    const viewModel = deriveRecentSessionsNavigatorViewModel({
      threads,
      projects,
      contentMatches: [],
      state: createInitialRecentSessionsNavigatorState(),
      now: new Date("2026-08-05T13:00:00.000Z"),
    });
    const row = viewModel.rows[1]!;
    const button = RecentSessionRowButton({ row, selected: false, onSelect });

    button.props.onClick();

    expect(onSelect).toHaveBeenCalledWith(row.key);
    expect(onResume).not.toHaveBeenCalled();
    expect(onFocusOpenThread).not.toHaveBeenCalled();
  });

  it("renders provider, model, and project metadata in the two-pane view", () => {
    const viewModel = deriveRecentSessionsNavigatorViewModel({
      threads,
      projects,
      contentMatches: [],
      state: createInitialRecentSessionsNavigatorState(),
      now: new Date("2026-08-05T13:00:00.000Z"),
    });
    const markup = renderToStaticMarkup(
      <RecentSessionsNavigatorView
        open
        query=""
        grouping="date"
        viewModel={viewModel}
        threadDetail={{ data: null, error: null, isPending: true, isDeleted: false }}
        onClose={() => {}}
        onQueryChange={() => {}}
        onGroupingChange={() => {}}
        onSelect={() => {}}
      />,
    );

    expect(markup).toContain("Sessions récentes");
    expect(markup).toContain("Codex");
    expect(markup).toContain("gpt-5.6");
    expect(markup).toContain("Arkadia Next");
    expect(markup).toContain("Chargement de la conversation");
  });
});

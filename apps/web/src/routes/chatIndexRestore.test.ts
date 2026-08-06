import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { describe, expect, it } from "vite-plus/test";

import { resolveChatIndexRestoreTarget } from "./chatIndexRestore";

function thread(id: string, archivedAt: string | null = null): EnvironmentThreadShell {
  return {
    environmentId: "local",
    id,
    projectId: "arkadia",
    archivedAt,
  } as EnvironmentThreadShell;
}

describe("resolveChatIndexRestoreTarget", () => {
  it("restores the last active open conversation instead of creating a project draft", () => {
    expect(
      resolveChatIndexRestoreTarget({
        lastActiveWorkspaceTabKey: "local:thread-2",
        openWorkspaceThreadTabKeys: ["local:thread-1", "local:thread-2"],
        threads: [thread("thread-1"), thread("thread-2")],
        drafts: {},
      }),
    ).toEqual({ kind: "thread", environmentId: "local", threadId: "thread-2" });
  });

  it("falls back to another persisted conversation when the last active tab is stale", () => {
    expect(
      resolveChatIndexRestoreTarget({
        lastActiveWorkspaceTabKey: "local:missing",
        openWorkspaceThreadTabKeys: ["local:thread-1"],
        threads: [thread("thread-1")],
        drafts: {},
      }),
    ).toEqual({ kind: "thread", environmentId: "local", threadId: "thread-1" });
  });

  it("restores a persisted conversation when upgrading from state without an active-tab key", () => {
    expect(
      resolveChatIndexRestoreTarget({
        lastActiveWorkspaceTabKey: null,
        openWorkspaceThreadTabKeys: ["local:thread-1"],
        threads: [thread("thread-1")],
        drafts: {},
      }),
    ).toEqual({ kind: "thread", environmentId: "local", threadId: "thread-1" });
  });

  it("restores an existing new-conversation draft without creating another one", () => {
    expect(
      resolveChatIndexRestoreTarget({
        lastActiveWorkspaceTabKey: "draft:draft-1",
        openWorkspaceThreadTabKeys: [],
        threads: [],
        drafts: {
          "draft-1": { environmentId: "local", projectId: "arkadia", promotedTo: null },
        },
      }),
    ).toEqual({ kind: "draft", draftId: "draft-1" });
  });
});

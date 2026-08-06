import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";

export interface ChatIndexDraftSource {
  readonly environmentId: string;
  readonly projectId: string;
  readonly promotedTo?: unknown | null;
}

export type ChatIndexRestoreTarget =
  | {
      readonly kind: "thread";
      readonly environmentId: EnvironmentThreadShell["environmentId"];
      readonly threadId: EnvironmentThreadShell["id"];
    }
  | { readonly kind: "draft"; readonly draftId: string }
  | null;

export function resolveChatIndexRestoreTarget(input: {
  readonly lastActiveWorkspaceTabKey: string | null;
  readonly openWorkspaceThreadTabKeys: ReadonlyArray<string>;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly drafts: Readonly<Record<string, ChatIndexDraftSource>>;
}): ChatIndexRestoreTarget {
  const activeKey = input.lastActiveWorkspaceTabKey;
  const activeThread =
    activeKey === null
      ? undefined
      : input.threads.find(
          (thread) =>
            thread.archivedAt === null &&
            `${thread.environmentId}:${thread.id}` === activeKey &&
            input.openWorkspaceThreadTabKeys.includes(activeKey),
        );
  if (activeThread) {
    return {
      kind: "thread",
      environmentId: activeThread.environmentId,
      threadId: activeThread.id,
    };
  }

  if (activeKey?.startsWith("draft:")) {
    const draftId = activeKey.slice("draft:".length);
    const draft = input.drafts[draftId];
    if (draft && draft.promotedTo == null) {
      return { kind: "draft", draftId };
    }
  }

  const fallbackThread = [...input.openWorkspaceThreadTabKeys]
    .reverse()
    .flatMap((tabKey) =>
      input.threads.filter(
        (thread) => thread.archivedAt === null && `${thread.environmentId}:${thread.id}` === tabKey,
      ),
    )[0];
  if (fallbackThread) {
    return {
      kind: "thread",
      environmentId: fallbackThread.environmentId,
      threadId: fallbackThread.id,
    };
  }

  return null;
}

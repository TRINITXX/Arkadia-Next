import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { canSettle, effectiveSettled } from "@t3tools/client-runtime/state/thread-settled";
import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { useRouter } from "@tanstack/react-router";
import { Plus, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef } from "react";

import { DraftId, useComposerDraftStore } from "../composerDraftStore";
import { useClientSettings } from "../hooks/useSettings";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { useNowMinute } from "../hooks/useNowMinute";
import { useThreadActions } from "../hooks/useThreadActions";
import { useThreadShells } from "../state/entities";
import { threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { buildThreadRouteParams } from "../threadRoutes";
import { useUiStateStore } from "../uiStateStore";
import {
  arkadiaWorkspaceTabKey,
  buildArkadiaWorkspaceTabs,
  resolveArkadiaDraftTabId,
  resolveArkadiaTabAfterClose,
  resolveArkadiaThreadIndicator,
} from "./arkadiaSidebarModel";

interface ArkadiaWorkspaceTabsProps {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly activeThreadId: ThreadId | null;
  readonly activeDraftId?: DraftId | null;
}

function StatusDot({ thread }: { readonly thread: EnvironmentThreadShell }) {
  const status = resolveArkadiaThreadIndicator(thread);
  return (
    <span className="relative size-2 shrink-0" role="img" aria-label={status.label}>
      {status.tone === "working" ? (
        <span
          className="absolute inset-0 animate-status-ping rounded-full opacity-45 motion-reduce:animate-none"
          style={{ backgroundColor: status.color }}
        />
      ) : null}
      <span
        className="absolute inset-0 rounded-full ring-1 ring-zinc-950/60"
        style={{ backgroundColor: status.color }}
      />
    </span>
  );
}

export default function ArkadiaWorkspaceTabs({
  environmentId,
  projectId,
  activeThreadId,
  activeDraftId = null,
}: ArkadiaWorkspaceTabsProps) {
  const threads = useThreadShells();
  const nowMinute = useNowMinute();
  const autoSettleAfterDays = useClientSettings((settings) => settings.sidebarAutoSettleAfterDays);
  const router = useRouter();
  const handleNewThread = useNewThreadHandler();
  const { settleThread } = useThreadActions();
  const stopThreadSession = useAtomCommand(threadEnvironment.stopSession, {
    reportFailure: false,
  });
  const closedTabKeyList = useUiStateStore((store) => store.closedWorkspaceTabKeys);
  const closeWorkspaceTab = useUiStateStore((store) => store.closeWorkspaceTab);
  const reopenWorkspaceTab = useUiStateStore((store) => store.reopenWorkspaceTab);
  const closedTabKeys = useMemo(() => new Set(closedTabKeyList), [closedTabKeyList]);
  const projectRef = useMemo(
    () => scopeProjectRef(environmentId, projectId),
    [environmentId, projectId],
  );
  const visibleDraftId = useComposerDraftStore((store) =>
    resolveArkadiaDraftTabId(
      store.draftThreadsByThreadKey,
      projectRef.environmentId,
      projectRef.projectId,
    ),
  );
  const draftSession = useComposerDraftStore((store) =>
    visibleDraftId ? store.getDraftSession(DraftId.make(visibleDraftId)) : null,
  );
  const visibleDraft = useMemo(
    () =>
      visibleDraftId && draftSession
        ? { draftId: DraftId.make(visibleDraftId), ...draftSession }
        : null,
    [draftSession, visibleDraftId],
  );
  const tabs = useMemo(
    () =>
      buildArkadiaWorkspaceTabs({
        threads,
        environmentId,
        projectId,
        currentThreadId: activeThreadId,
        closedTabKeys,
        now: `${nowMinute}:00.000Z`,
        autoSettleAfterDays,
      }),
    [
      activeThreadId,
      autoSettleAfterDays,
      closedTabKeys,
      environmentId,
      nowMinute,
      projectId,
      threads,
    ],
  );

  // Opening a closed conversation again (from the sidebar, a link, anywhere)
  // brings its tab back for good. Keyed on the active conversation alone so
  // closing the tab you are on does not immediately undo itself.
  useEffect(() => {
    if (activeThreadId === null) return;
    reopenWorkspaceTab(arkadiaWorkspaceTabKey(environmentId, activeThreadId));
  }, [activeThreadId, environmentId, reopenWorkspaceTab]);

  const openThread = useCallback(
    (thread: EnvironmentThreadShell) => {
      void router.navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(scopeThreadRef(thread.environmentId, thread.id)),
      });
    },
    [router],
  );

  const openDraft = useCallback(() => {
    if (!visibleDraft) return;
    void router.navigate({
      to: "/draft/$draftId",
      params: { draftId: visibleDraft.draftId },
    });
  }, [router, visibleDraft]);

  const clearDraftThread = useComposerDraftStore((store) => store.clearDraftThread);

  // Closing the draft tab discards the draft outright: nothing exists
  // server-side yet, so there is no session to stop and nothing to settle.
  // When the draft is on screen, navigate away first — clearing while its
  // route is mounted would trigger that route's own "draft is gone" redirect
  // to the home page and race the navigation to the fallback tab.
  const closeDraft = useCallback(() => {
    if (!visibleDraft) return;
    if (activeDraftId !== visibleDraft.draftId) {
      clearDraftThread(visibleDraft.draftId);
      return;
    }
    const fallback = tabs[tabs.length - 1];
    void (
      fallback
        ? router.navigate({
            to: "/$environmentId/$threadId",
            params: buildThreadRouteParams(scopeThreadRef(fallback.environmentId, fallback.id)),
          })
        : router.navigate({ to: "/" })
    ).then(() => clearDraftThread(visibleDraft.draftId));
  }, [activeDraftId, clearDraftThread, router, tabs, visibleDraft]);

  // Closing a tab always closes it, whatever the agent is doing: the tab
  // disappears from this window immediately, the running agent is stopped, and
  // the conversation itself is only settled (never archived or deleted), so it
  // stays one click away in the sidebar.
  const closeThread = useCallback(
    async (thread: EnvironmentThreadShell) => {
      const threadRef = scopeThreadRef(thread.environmentId, thread.id);
      closeWorkspaceTab(arkadiaWorkspaceTabKey(thread.environmentId, thread.id));

      // Stopping and settling run alongside the navigation: the tab is already
      // gone from the bar, and neither command needs this component alive.
      void (async () => {
        if (thread.session !== null && thread.session.status !== "stopped") {
          await stopThreadSession({
            environmentId: threadRef.environmentId,
            input: { threadId: threadRef.threadId },
          });
        }
        // Best effort: the server refuses to settle a thread that is still live
        // or blocked on an answer. The pending-settle effect picks it up again
        // once the shell reports the thread as quiet.
        await settleThread(threadRef);
      })();

      if (thread.id !== activeThreadId) return;

      const fallbackId = resolveArkadiaTabAfterClose(
        tabs.map((item) => item.id),
        thread.id,
      );
      const fallback = fallbackId ? tabs.find((item) => item.id === fallbackId) : null;
      if (fallback) {
        openThread(fallback);
        return;
      }
      if (visibleDraft) {
        openDraft();
        return;
      }
      await handleNewThread(projectRef, { replace: true });
    },
    [
      activeThreadId,
      closeWorkspaceTab,
      handleNewThread,
      openDraft,
      openThread,
      projectRef,
      settleThread,
      stopThreadSession,
      tabs,
      visibleDraft,
    ],
  );

  // A closed tab whose conversation is still classified active would resurface
  // in the sidebar's Active list. Settle it as soon as the shell says it is
  // quiet — driven by shell updates, never by a timer.
  const settlingTabKeysRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const now = `${nowMinute}:00.000Z`;
    for (const thread of threads) {
      if (thread.environmentId !== environmentId || thread.archivedAt !== null) continue;
      if (thread.id === activeThreadId) continue;
      const tabKey = arkadiaWorkspaceTabKey(thread.environmentId, thread.id);
      if (!closedTabKeys.has(tabKey)) continue;
      if (settlingTabKeysRef.current.has(tabKey)) continue;
      if (effectiveSettled(thread, { now, autoSettleAfterDays })) continue;
      if (!canSettle(thread, { now })) continue;

      settlingTabKeysRef.current.add(tabKey);
      void settleThread(scopeThreadRef(thread.environmentId, thread.id)).finally(() => {
        settlingTabKeysRef.current.delete(tabKey);
      });
    }
  }, [
    activeThreadId,
    autoSettleAfterDays,
    closedTabKeys,
    environmentId,
    nowMinute,
    settleThread,
    threads,
  ]);

  return (
    <div
      className="drag-region flex h-9 shrink-0 items-stretch border-b border-zinc-800 bg-zinc-950 pr-[var(--workspace-native-controls-inset)] text-zinc-300 select-none"
      data-arkadia-workspace-tabs=""
    >
      <div className="scrollbar-none flex min-w-0 flex-1 items-stretch overflow-x-auto overflow-y-hidden">
        {tabs.map((thread) => {
          const active = thread.id === activeThreadId && activeDraftId === null;
          return (
            <div
              key={`${thread.environmentId}:${thread.id}`}
              className={`group flex min-w-[120px] max-w-[220px] cursor-pointer items-center gap-2 border-r border-zinc-800 px-3 text-xs [-webkit-app-region:no-drag] ${
                active
                  ? "bg-zinc-900 text-zinc-100"
                  : "bg-zinc-950 text-zinc-400 hover:bg-zinc-900/60 hover:text-zinc-200"
              }`}
              onAuxClick={(event) => {
                if (event.button !== 1) return;
                event.preventDefault();
                void closeThread(thread);
              }}
              onClick={() => openThread(thread)}
              title={thread.title}
            >
              <StatusDot thread={thread} />
              <span className="min-w-0 flex-1 truncate font-medium">{thread.title}</span>
              <button
                type="button"
                aria-label={`Fermer ${thread.title}`}
                className={`flex size-4 shrink-0 items-center justify-center rounded text-zinc-500 hover:bg-zinc-700 hover:text-zinc-100 ${
                  active
                    ? "opacity-100"
                    : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                }`}
                onClick={(event) => {
                  event.stopPropagation();
                  void closeThread(thread);
                }}
              >
                <X size={12} strokeWidth={2} />
              </button>
            </div>
          );
        })}

        {visibleDraft ? (
          <div
            className={`group flex min-w-[120px] max-w-[220px] cursor-pointer items-center gap-2 border-r border-zinc-800 px-3 text-xs [-webkit-app-region:no-drag] ${
              activeDraftId === visibleDraft.draftId
                ? "bg-zinc-900 text-zinc-100"
                : "bg-zinc-950 text-zinc-400 hover:bg-zinc-900/60 hover:text-zinc-200"
            }`}
            onAuxClick={(event) => {
              if (event.button !== 1) return;
              event.preventDefault();
              closeDraft();
            }}
            onClick={openDraft}
            title="Nouvelle conversation"
          >
            <span className="size-2 shrink-0 rounded-full bg-emerald-500" />
            <span className="min-w-0 flex-1 truncate font-medium">Nouvelle conversation</span>
            <button
              type="button"
              aria-label="Fermer la nouvelle conversation"
              className={`flex size-4 shrink-0 items-center justify-center rounded text-zinc-500 hover:bg-zinc-700 hover:text-zinc-100 ${
                activeDraftId === visibleDraft.draftId
                  ? "opacity-100"
                  : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
              }`}
              onClick={(event) => {
                event.stopPropagation();
                closeDraft();
              }}
            >
              <X size={12} strokeWidth={2} />
            </button>
          </div>
        ) : null}

        {/* Never disabled: a project keeps a single pending draft, so the plus
            either opens a brand new conversation or jumps to the one already
            waiting — it always lands the user on an agent view. */}
        <button
          type="button"
          className="flex w-9 shrink-0 items-center justify-center text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
          onClick={() => {
            if (visibleDraft) {
              openDraft();
              return;
            }
            void handleNewThread(projectRef);
          }}
          title="Nouvel onglet"
          aria-label="Nouvel onglet"
        >
          <Plus size={14} strokeWidth={1.75} />
        </button>
        <div className="min-w-6 flex-1" />
      </div>
    </div>
  );
}

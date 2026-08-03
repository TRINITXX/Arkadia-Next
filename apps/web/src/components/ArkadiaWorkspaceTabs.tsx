import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { useRouter } from "@tanstack/react-router";
import { Plus, X } from "lucide-react";
import { useCallback, useMemo } from "react";

import { DraftId, useComposerDraftStore } from "../composerDraftStore";
import { useClientSettings } from "../hooks/useSettings";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { useNowMinute } from "../hooks/useNowMinute";
import { useThreadActions } from "../hooks/useThreadActions";
import { useThreadShells } from "../state/entities";
import { buildThreadRouteParams } from "../threadRoutes";
import {
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
        now: `${nowMinute}:00.000Z`,
        autoSettleAfterDays,
      }),
    [activeThreadId, autoSettleAfterDays, environmentId, nowMinute, projectId, threads],
  );

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

  const closeThread = useCallback(
    async (thread: EnvironmentThreadShell) => {
      const result = await settleThread(scopeThreadRef(thread.environmentId, thread.id));
      if (result._tag !== "Success" || thread.id !== activeThreadId) return;

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
      handleNewThread,
      openDraft,
      openThread,
      projectRef,
      settleThread,
      tabs,
      visibleDraft,
    ],
  );

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
          <button
            type="button"
            className={`flex min-w-[120px] max-w-[220px] items-center gap-2 border-r border-zinc-800 px-3 text-left text-xs ${
              activeDraftId === visibleDraft.draftId
                ? "bg-zinc-900 text-zinc-100"
                : "bg-zinc-950 text-zinc-400 hover:bg-zinc-900/60 hover:text-zinc-200"
            }`}
            onClick={openDraft}
            title="Nouvelle conversation"
          >
            <span className="size-2 shrink-0 rounded-full bg-emerald-500" />
            <span className="truncate font-medium">Nouvelle conversation</span>
          </button>
        ) : null}

        <button
          type="button"
          className="flex w-9 shrink-0 items-center justify-center text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200 disabled:cursor-default disabled:opacity-35"
          disabled={visibleDraft !== null}
          onClick={() => void handleNewThread(projectRef)}
          title={visibleDraft ? "Une nouvelle conversation est déjà ouverte" : "Nouvel onglet"}
          aria-label="Nouvel onglet"
        >
          <Plus size={14} strokeWidth={1.75} />
        </button>
        <div className="min-w-6 flex-1" />
      </div>
    </div>
  );
}

import {
  scopeProjectRef,
  scopedProjectKey,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { canSettle, effectiveSettled } from "@t3tools/client-runtime/state/thread-settled";
import { getTerminalLabel } from "@t3tools/shared/terminalLabels";
import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { useRouter } from "@tanstack/react-router";
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Plus, SquareTerminalIcon, X } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef } from "react";

import { DraftId, useComposerDraftStore } from "../composerDraftStore";
import { useClientSettings } from "../hooks/useSettings";
import { useLeaveToNextActiveProject } from "../hooks/useLeaveToNextActiveProject";
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
  prependArkadiaWorkspaceTabKey,
  resolveArkadiaDraftTabId,
  resolveArkadiaTabAfterClose,
  resolveArkadiaThreadIndicator,
} from "./arkadiaSidebarModel";
import { orderItemsByPreferredIds } from "./Sidebar.logic";
import { selectProjectTerminals, useProjectTerminalsStore } from "./terminal/projectTerminalsStore";
import { useCloseProjectTerminal } from "./terminal/useCloseProjectTerminal";
import { useWorkspaceTabOrderStore } from "./workspaceTabOrderStore";

interface ArkadiaWorkspaceTabsProps {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly activeThreadId: ThreadId | null;
  readonly activeDraftId?: DraftId | null;
  /** Set when a project terminal tab — not a conversation — is on screen. */
  readonly activeTerminalId?: string | null;
  /**
   * Conversation to keep in the bar even if it is settled or was closed —
   * the one the user left behind to open a terminal. Without it, opening a
   * terminal from a settled conversation would make its tab vanish.
   */
  readonly keepVisibleThreadId?: ThreadId | null;
}

/** One look for every tab in the bar, whatever it holds. */
function workspaceTabClassName(active: boolean): string {
  return `group flex min-w-[120px] max-w-[220px] cursor-pointer items-center gap-2 border-r border-zinc-800 px-3 text-xs [-webkit-app-region:no-drag] ${
    active
      ? "bg-zinc-900 text-zinc-100"
      : "bg-zinc-950 text-zinc-400 hover:bg-zinc-900/60 hover:text-zinc-200"
  }`;
}

function workspaceTabCloseClassName(active: boolean): string {
  return `flex size-4 shrink-0 items-center justify-center rounded text-zinc-500 hover:bg-zinc-700 hover:text-zinc-100 ${
    active ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
  }`;
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

/**
 * A single position in the bar, whatever it holds. The three families share one
 * ordered list so any tab can be dragged in front of any other; the key is
 * prefixed per family so a terminal id can never collide with a thread key.
 */
type WorkspaceTabItem =
  | { readonly kind: "thread"; readonly key: string; readonly thread: EnvironmentThreadShell }
  | { readonly kind: "draft"; readonly key: string }
  | { readonly kind: "terminal"; readonly key: string; readonly terminalId: string };

/** Wraps a tab so it can be picked up and dropped elsewhere in the bar. */
function SortableWorkspaceTab({
  id,
  active,
  title,
  onOpen,
  onMiddleClick,
  children,
}: {
  readonly id: string;
  readonly active: boolean;
  readonly title: string;
  readonly onOpen: () => void;
  readonly onMiddleClick: () => void;
  readonly children: ReactNode;
}) {
  const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      data-workspace-tab=""
      data-active={active ? "true" : "false"}
      className={`${workspaceTabClassName(active)} touch-none ${
        isDragging ? "relative z-10 opacity-70" : ""
      }`}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      title={title}
      onClick={onOpen}
      onAuxClick={(event) => {
        if (event.button !== 1) return;
        event.preventDefault();
        onMiddleClick();
      }}
      {...listeners}
    >
      {children}
    </div>
  );
}

export default function ArkadiaWorkspaceTabs({
  environmentId,
  projectId,
  activeThreadId,
  activeDraftId = null,
  activeTerminalId = null,
  keepVisibleThreadId = null,
}: ArkadiaWorkspaceTabsProps) {
  const threads = useThreadShells();
  const nowMinute = useNowMinute();
  const autoSettleAfterDays = useClientSettings((settings) => settings.sidebarAutoSettleAfterDays);
  const router = useRouter();
  const handleNewThread = useNewThreadHandler();
  const leaveToNextActiveProject = useLeaveToNextActiveProject();
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
        currentThreadId: activeThreadId ?? keepVisibleThreadId,
        closedTabKeys,
        now: `${nowMinute}:00.000Z`,
        autoSettleAfterDays,
      }),
    [
      activeThreadId,
      autoSettleAfterDays,
      keepVisibleThreadId,
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
        : leaveToNextActiveProject(scopedProjectKey(projectRef))
    ).then(() => clearDraftThread(visibleDraft.draftId));
  }, [
    activeDraftId,
    clearDraftThread,
    leaveToNextActiveProject,
    projectRef,
    router,
    tabs,
    visibleDraft,
  ]);

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
      // Nothing left in this project: let it fall to Inactive and move on to
      // the next active project (or the empty home page), instead of spawning
      // a fresh conversation here.
      await leaveToNextActiveProject(scopedProjectKey(projectRef));
    },
    [
      activeThreadId,
      closeWorkspaceTab,
      leaveToNextActiveProject,
      openDraft,
      openThread,
      projectRef,
      settleThread,
      stopThreadSession,
      tabs,
      visibleDraft,
    ],
  );

  const projectTerminals = useProjectTerminalsStore((store) =>
    selectProjectTerminals(store.terminalsByProjectKey, scopedProjectKey(projectRef)),
  );
  const openProjectTerminal = useProjectTerminalsStore((store) => store.openTerminal);
  const closeProjectTerminal = useCloseProjectTerminal(projectRef);

  const openTerminalTab = useCallback(
    (terminalId: string) => {
      void router.navigate({
        to: "/$environmentId/project/$projectId/terminal/$terminalId",
        params: { environmentId, projectId, terminalId },
      });
    },
    [environmentId, projectId, router],
  );

  // Unlike a conversation, a closed terminal is gone for good — so leaving the
  // user on its now-empty tab is not an option. Fall back to the next
  // terminal, then to the conversations, and only then to a fresh draft.
  const closeTerminalTab = useCallback(
    (terminalId: string) => {
      const remaining = projectTerminals.filter((tab) => tab.terminalId !== terminalId);
      closeProjectTerminal(terminalId);
      if (activeTerminalId !== terminalId) return;

      const nextTerminal = remaining[remaining.length - 1];
      if (nextTerminal) {
        openTerminalTab(nextTerminal.terminalId);
        return;
      }
      const fallbackThread = tabs[tabs.length - 1];
      if (fallbackThread) {
        openThread(fallbackThread);
        return;
      }
      if (visibleDraft) {
        openDraft();
        return;
      }
      void leaveToNextActiveProject(scopedProjectKey(projectRef));
    },
    [
      activeTerminalId,
      closeProjectTerminal,
      leaveToNextActiveProject,
      openDraft,
      openTerminalTab,
      openThread,
      projectRef,
      projectTerminals,
      tabs,
      visibleDraft,
    ],
  );

  // The bar's natural order: conversations by creation date, then the draft,
  // then the project terminals. This is what the user reorders on top of.
  const naturalTabItems = useMemo<ReadonlyArray<WorkspaceTabItem>>(() => {
    const items: WorkspaceTabItem[] = tabs.map((thread) => ({
      kind: "thread",
      key: arkadiaWorkspaceTabKey(thread.environmentId, thread.id),
      thread,
    }));
    if (visibleDraft) {
      items.push({ kind: "draft", key: `draft:${visibleDraft.draftId}` });
    }
    for (const terminal of projectTerminals) {
      items.push({
        kind: "terminal",
        key: `terminal:${terminal.terminalId}`,
        terminalId: terminal.terminalId,
      });
    }
    return items;
  }, [projectTerminals, tabs, visibleDraft]);

  // Manual drag order, session-local and per project. New tabs the user has not
  // touched fall in at their natural position; closed ones drop out silently.
  const projectKey = scopedProjectKey(projectRef);
  const tabOrder = useWorkspaceTabOrderStore((store) => store.orderByProjectKey[projectKey]);
  const setTabOrder = useWorkspaceTabOrderStore((store) => store.setOrder);
  const orderedTabItems = useMemo(
    () =>
      orderItemsByPreferredIds({
        items: naturalTabItems,
        preferredIds: tabOrder ?? [],
        getId: (item) => item.key,
      }),
    [naturalTabItems, tabOrder],
  );

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const openNewTerminal = useCallback(() => {
    const terminalId = openProjectTerminal(projectRef);
    const terminalKey = `terminal:${terminalId}`;
    setTabOrder(
      projectKey,
      prependArkadiaWorkspaceTabKey(
        orderedTabItems.map((item) => item.key),
        terminalKey,
      ),
    );
    openTerminalTab(terminalId);
  }, [openProjectTerminal, openTerminalTab, orderedTabItems, projectKey, projectRef, setTabOrder]);

  const handleTabDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const keys = orderedTabItems.map((item) => item.key);
      const from = keys.indexOf(String(active.id));
      const to = keys.indexOf(String(over.id));
      if (from < 0 || to < 0) return;
      setTabOrder(projectKey, arrayMove(keys, from, to));
    },
    [orderedTabItems, projectKey, setTabOrder],
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
        <button
          type="button"
          aria-label="Nouveau terminal"
          title="Nouveau terminal"
          className="flex w-9 shrink-0 items-center justify-center border-r border-zinc-800 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200 [-webkit-app-region:no-drag]"
          onClick={openNewTerminal}
        >
          <SquareTerminalIcon size={14} strokeWidth={1.75} />
        </button>
        <DndContext
          collisionDetection={closestCenter}
          onDragEnd={handleTabDragEnd}
          sensors={sensors}
        >
          <SortableContext
            items={orderedTabItems.map((item) => item.key)}
            strategy={horizontalListSortingStrategy}
          >
            {orderedTabItems.map((item) => {
              if (item.kind === "thread") {
                const { thread } = item;
                const active =
                  thread.id === activeThreadId &&
                  activeDraftId === null &&
                  activeTerminalId === null;
                return (
                  <SortableWorkspaceTab
                    key={item.key}
                    id={item.key}
                    active={active}
                    title={thread.title}
                    onOpen={() => openThread(thread)}
                    onMiddleClick={() => void closeThread(thread)}
                  >
                    <StatusDot thread={thread} />
                    <span className="min-w-0 flex-1 truncate font-medium">{thread.title}</span>
                    <button
                      type="button"
                      aria-label={`Fermer ${thread.title}`}
                      className={workspaceTabCloseClassName(active)}
                      onClick={(event) => {
                        event.stopPropagation();
                        void closeThread(thread);
                      }}
                    >
                      <X size={12} strokeWidth={2} />
                    </button>
                  </SortableWorkspaceTab>
                );
              }

              if (item.kind === "draft") {
                if (!visibleDraft) return null;
                const active = activeDraftId === visibleDraft.draftId;
                return (
                  <SortableWorkspaceTab
                    key={item.key}
                    id={item.key}
                    active={active}
                    title="Nouvelle conversation"
                    onOpen={openDraft}
                    onMiddleClick={closeDraft}
                  >
                    <span className="size-2 shrink-0 rounded-full bg-emerald-500" />
                    <span className="min-w-0 flex-1 truncate font-medium">
                      Nouvelle conversation
                    </span>
                    <button
                      type="button"
                      aria-label="Fermer la nouvelle conversation"
                      className={workspaceTabCloseClassName(active)}
                      onClick={(event) => {
                        event.stopPropagation();
                        closeDraft();
                      }}
                    >
                      <X size={12} strokeWidth={2} />
                    </button>
                  </SortableWorkspaceTab>
                );
              }

              const active = activeTerminalId === item.terminalId;
              const label = getTerminalLabel(item.terminalId);
              return (
                <SortableWorkspaceTab
                  key={item.key}
                  id={item.key}
                  active={active}
                  title={label}
                  onOpen={() => openTerminalTab(item.terminalId)}
                  onMiddleClick={() => closeTerminalTab(item.terminalId)}
                >
                  <SquareTerminalIcon size={12} className="shrink-0 text-zinc-500" />
                  <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
                  <button
                    type="button"
                    aria-label={`Fermer ${label}`}
                    className={workspaceTabCloseClassName(active)}
                    onClick={(event) => {
                      event.stopPropagation();
                      closeTerminalTab(item.terminalId);
                    }}
                  >
                    <X size={12} strokeWidth={2} />
                  </button>
                </SortableWorkspaceTab>
              );
            })}
          </SortableContext>
        </DndContext>

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

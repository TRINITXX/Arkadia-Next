import {
  scopeProjectRef,
  scopedProjectKey,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
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
import { type ReactNode, useCallback, useEffect, useMemo } from "react";

import { DraftId, useComposerDraftStore } from "../composerDraftStore";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { useThreadActions } from "../hooks/useThreadActions";
import { useThreadShells } from "../state/entities";
import { threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { buildThreadRouteParams } from "../threadRoutes";
import { useUiStateStore } from "../uiStateStore";
import {
  arkadiaWorkspaceTabKey,
  buildArkadiaWorkspaceTabItems,
  canCloseArkadiaDraftTab,
  closeArkadiaDraftTab,
  handleArkadiaWorkspaceTabMouseDown,
  prependArkadiaWorkspaceTabKey,
  resolveArkadiaTabAfterClose,
  resolveArkadiaThreadIndicator,
  type ArkadiaWorkspaceTabItem,
} from "./arkadiaSidebarModel";
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
   * Conversation to keep in the bar while a terminal route replaces it on
   * screen. The route itself cannot provide an active conversation id.
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
interface VisibleDraft {
  readonly draftId: DraftId;
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
}

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
      onMouseDown={(event) =>
        handleArkadiaWorkspaceTabMouseDown({
          button: event.button,
          preventDefault: () => event.preventDefault(),
          closeTab: onMiddleClick,
        })
      }
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
  const router = useRouter();
  const handleNewThread = useNewThreadHandler();
  const { settleThread } = useThreadActions();
  const stopThreadSession = useAtomCommand(threadEnvironment.stopSession, {
    reportFailure: false,
  });
  const openWorkspaceThreadTabKeys = useUiStateStore((store) => store.openWorkspaceThreadTabKeys);
  const closeWorkspaceThreadTab = useUiStateStore((store) => store.closeWorkspaceThreadTab);
  const openWorkspaceThreadTab = useUiStateStore((store) => store.openWorkspaceThreadTab);
  const setLastActiveWorkspaceTabKey = useUiStateStore(
    (store) => store.setLastActiveWorkspaceTabKey,
  );
  const openThreadTabKeys = useMemo(
    () => new Set(openWorkspaceThreadTabKeys),
    [openWorkspaceThreadTabKeys],
  );
  const projectRef = useMemo(
    () => scopeProjectRef(environmentId, projectId),
    [environmentId, projectId],
  );
  const openEmptyProject = useCallback(
    (replace = false) =>
      router.navigate({
        to: "/$environmentId/project/$projectId",
        params: { environmentId, projectId },
        replace,
      }),
    [environmentId, projectId, router],
  );
  const draftThreadsByThreadKey = useComposerDraftStore((store) => store.draftThreadsByThreadKey);
  const visibleDrafts = useMemo(
    () =>
      Object.entries(draftThreadsByThreadKey).flatMap(([draftId, draftSession]) =>
        draftSession.environmentId === environmentId &&
        draftSession.projectId === projectId &&
        draftSession.promotedTo == null
          ? [{ draftId: DraftId.make(draftId), ...draftSession }]
          : [],
      ),
    [draftThreadsByThreadKey, environmentId, projectId],
  );
  const projectTerminals = useProjectTerminalsStore((store) =>
    selectProjectTerminals(store.terminalsByProjectKey, scopedProjectKey(projectRef)),
  );
  const openProjectTerminal = useProjectTerminalsStore((store) => store.openTerminal);
  const closeProjectTerminal = useCloseProjectTerminal(projectRef);
  const projectKey = scopedProjectKey(projectRef);
  const tabOrder = useWorkspaceTabOrderStore((store) => store.orderByProjectKey[projectKey]);
  const setTabOrder = useWorkspaceTabOrderStore((store) => store.setOrder);
  const markTabActive = useWorkspaceTabOrderStore((store) => store.markTabActive);
  const orderedTabItems = useMemo<ReadonlyArray<ArkadiaWorkspaceTabItem>>(
    () =>
      buildArkadiaWorkspaceTabItems({
        threads,
        environmentId,
        projectId,
        currentThreadId: activeThreadId ?? keepVisibleThreadId,
        openThreadTabKeys,
        drafts: draftThreadsByThreadKey,
        terminals: projectTerminals,
        ...(tabOrder ? { preferredIds: tabOrder } : {}),
      }),
    [
      activeThreadId,
      draftThreadsByThreadKey,
      environmentId,
      keepVisibleThreadId,
      openThreadTabKeys,
      projectId,
      projectTerminals,
      tabOrder,
      threads,
    ],
  );
  const tabs = useMemo(
    () => orderedTabItems.flatMap((item) => (item.kind === "thread" ? [item.thread] : [])),
    [orderedTabItems],
  );

  useEffect(() => {
    const activeKey = activeThreadId
      ? arkadiaWorkspaceTabKey(environmentId, activeThreadId)
      : activeDraftId
        ? `draft:${activeDraftId}`
        : activeTerminalId
          ? `terminal:${activeTerminalId}`
          : null;
    if (!activeKey) return;
    markTabActive(projectKey, activeKey);
    setLastActiveWorkspaceTabKey(activeKey);
  }, [
    activeDraftId,
    activeTerminalId,
    activeThreadId,
    environmentId,
    markTabActive,
    projectKey,
    setLastActiveWorkspaceTabKey,
  ]);

  // Any conversation reached through routing becomes an explicit local tab.
  // Keyed on the active conversation alone so closing the current tab does not
  // immediately undo itself before fallback navigation starts.
  useEffect(() => {
    if (activeThreadId === null) return;
    openWorkspaceThreadTab(arkadiaWorkspaceTabKey(environmentId, activeThreadId));
  }, [activeThreadId, environmentId, openWorkspaceThreadTab]);

  const openThread = useCallback(
    (thread: EnvironmentThreadShell) => {
      openWorkspaceThreadTab(arkadiaWorkspaceTabKey(thread.environmentId, thread.id));
      void router.navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(scopeThreadRef(thread.environmentId, thread.id)),
      });
    },
    [openWorkspaceThreadTab, router],
  );

  const openDraft = useCallback(
    (draft: VisibleDraft) => {
      void router.navigate({
        to: "/draft/$draftId",
        params: { draftId: draft.draftId },
      });
    },
    [router],
  );

  const clearDraftThread = useComposerDraftStore((store) => store.clearDraftThread);

  // Closing a tab always closes it, whatever the agent is doing: the tab
  // disappears from this window immediately, the running agent is stopped, and
  // the conversation itself is only settled (never archived or deleted), so it
  // remains available from Sessions récentes.
  const closeThread = useCallback(
    async (thread: EnvironmentThreadShell) => {
      const threadRef = scopeThreadRef(thread.environmentId, thread.id);
      closeWorkspaceThreadTab(arkadiaWorkspaceTabKey(thread.environmentId, thread.id));

      // Stopping and settling run alongside the navigation: the tab is already
      // gone from the bar, and neither command needs this component alive.
      void (async () => {
        if (thread.session !== null && thread.session.status !== "stopped") {
          await stopThreadSession({
            environmentId: threadRef.environmentId,
            input: { threadId: threadRef.threadId },
          });
        }
        // Best effort: the server may refuse to settle a thread that remains
        // live or blocked on an answer after the stop request.
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
      const fallbackDraft = visibleDrafts[visibleDrafts.length - 1];
      if (fallbackDraft) {
        openDraft(fallbackDraft);
        return;
      }
      await openEmptyProject(true);
    },
    [
      activeThreadId,
      closeWorkspaceThreadTab,
      openEmptyProject,
      openDraft,
      openThread,
      projectRef,
      settleThread,
      stopThreadSession,
      tabs,
      visibleDrafts,
    ],
  );

  const openTerminalTab = useCallback(
    (terminalId: string) => {
      void router.navigate({
        to: "/$environmentId/project/$projectId/terminal/$terminalId",
        params: { environmentId, projectId, terminalId },
      });
    },
    [environmentId, projectId, router],
  );

  const openWorkspaceTab = useCallback(
    (item: ArkadiaWorkspaceTabItem) => {
      if (item.kind === "thread") {
        openThread(item.thread);
        return;
      }
      if (item.kind === "draft") {
        const draft = visibleDrafts.find((candidate) => String(candidate.draftId) === item.draftId);
        if (draft) openDraft(draft);
        return;
      }
      openTerminalTab(item.terminalId);
    },
    [openDraft, openTerminalTab, openThread, visibleDrafts],
  );

  // Closing the draft tab discards the draft outright: nothing exists
  // server-side yet, so there is no session to stop and nothing to settle.
  // When the draft is on screen, navigate away first — clearing while its
  // route is mounted would trigger that route's own "draft is gone" redirect
  // to the home page and race the navigation to the fallback tab.
  const closeDraft = useCallback(
    (draft: VisibleDraft) => {
      const draftKey = `draft:${draft.draftId}`;
      if (!canCloseArkadiaDraftTab(orderedTabItems, draftKey)) return;
      if (activeDraftId !== draft.draftId) {
        clearDraftThread(draft.draftId);
        return;
      }

      const fallbackId = resolveArkadiaTabAfterClose(
        orderedTabItems.map((item) => item.key),
        draftKey,
      );
      const fallback = fallbackId
        ? (orderedTabItems.find((item) => item.key === fallbackId) ?? null)
        : null;
      void closeArkadiaDraftTab({
        navigateAway: async () => {
          if (fallback) {
            openWorkspaceTab(fallback);
            return;
          }
          await openEmptyProject(true);
        },
        clearDraft: () => clearDraftThread(draft.draftId),
      });
    },
    [activeDraftId, clearDraftThread, openEmptyProject, openWorkspaceTab, orderedTabItems],
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
      const fallbackDraft = visibleDrafts[visibleDrafts.length - 1];
      if (fallbackDraft) {
        openDraft(fallbackDraft);
        return;
      }
      void openEmptyProject(true);
    },
    [
      activeTerminalId,
      closeProjectTerminal,
      openEmptyProject,
      openDraft,
      openTerminalTab,
      openThread,
      projectRef,
      projectTerminals,
      tabs,
      visibleDrafts,
    ],
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
                const draft = visibleDrafts.find(
                  (candidate) => String(candidate.draftId) === item.draftId,
                );
                if (!draft) return null;
                const active = activeDraftId === draft.draftId;
                const canClose = canCloseArkadiaDraftTab(orderedTabItems, item.key);
                return (
                  <SortableWorkspaceTab
                    key={item.key}
                    id={item.key}
                    active={active}
                    title="Nouvelle conversation"
                    onOpen={() => openDraft(draft)}
                    onMiddleClick={() => {
                      if (canClose) closeDraft(draft);
                    }}
                  >
                    <span className="size-2 shrink-0 rounded-full bg-emerald-500" />
                    <span className="min-w-0 flex-1 truncate font-medium">
                      Nouvelle conversation
                    </span>
                    {canClose ? (
                      <button
                        type="button"
                        aria-label="Fermer la nouvelle conversation"
                        className={workspaceTabCloseClassName(active)}
                        onClick={(event) => {
                          event.stopPropagation();
                          closeDraft(draft);
                        }}
                      >
                        <X size={12} strokeWidth={2} />
                      </button>
                    ) : null}
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

        {/* Never disabled: each click opens a separate pending conversation tab. */}
        <button
          type="button"
          className="flex w-9 shrink-0 items-center justify-center text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
          onClick={() => {
            void handleNewThread(projectRef, { forceNew: true });
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

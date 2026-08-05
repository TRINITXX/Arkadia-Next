import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { getTerminalLabel } from "@t3tools/shared/terminalLabels";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useParams, useRouter } from "@tanstack/react-router";
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { History, SquareTerminalIcon, X } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getProjectOrderKey } from "../logicalProject";
import { useUiStateStore } from "../uiStateStore";
import { useLeaveToNextActiveProject } from "../hooks/useLeaveToNextActiveProject";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { useThreadActions } from "../hooks/useThreadActions";
import { useProjects, useThreadShells } from "../state/entities";
import { useEnvironments, usePrimaryEnvironmentId } from "../state/environments";
import { terminalEnvironment } from "../state/terminal";
import { useAtomCommand } from "../state/use-atom-command";
import { projectTerminalThreadId } from "../terminal/projectTerminals";
import {
  buildThreadRouteParams,
  resolveActiveThreadRouteRef,
  resolveThreadRouteTarget,
} from "../threadRoutes";
import { DraftId, useComposerDraftStore } from "../composerDraftStore";
import { readLocalApi } from "../localApi";
import { projectEnvironment } from "../state/projects";
import { threadEnvironment } from "../state/threads";
import { findProjectByPath, inferProjectTitleFromPath } from "../lib/projectPaths";
import { newProjectId } from "../lib/utils";
import { resolveDefaultProviderModelSelection } from "../providerInstances";
import { stackedThreadToast, toastManager } from "./ui/toast";
import {
  arkadiaWorkspaceTabKey,
  buildArkadiaSidebarGroups,
  closeArkadiaDraftTab,
  resolveArkadiaInactiveProjectOpenTarget,
  resolveArkadiaProjectOpenTab,
  resolveArkadiaTabAfterClose,
  requestArkadiaInactiveProjectDeletion,
  resolveArkadiaThreadIndicator,
  shortenArkadiaProjectPath,
  type ArkadiaSidebarProjectGroup,
  type ArkadiaWorkspaceTabItem,
} from "./arkadiaSidebarModel";
import { selectProjectTerminals, useProjectTerminalsStore } from "./terminal/projectTerminalsStore";
import { useWorkspaceTabOrderStore } from "./workspaceTabOrderStore";
import { RecentSessionsNavigator } from "./RecentSessionsNavigator";

type SidebarView = "active" | "inactive";

function scopedProjectKey(environmentId: string, projectId: string): string {
  return `${environmentId}:${projectId}`;
}

function ThreadStatusDot({ thread }: { readonly thread: EnvironmentThreadShell }) {
  const status = resolveArkadiaThreadIndicator(thread);
  return (
    <span
      aria-label={status.label}
      className="relative size-2 shrink-0"
      role="img"
      title={status.label}
    >
      {status.tone === "working" ? (
        <span
          className="absolute inset-0 animate-status-ping rounded-full opacity-45 motion-reduce:animate-none"
          style={{ backgroundColor: status.color }}
        />
      ) : null}
      <span
        className="absolute inset-0 rounded-full ring-1 ring-zinc-950/50"
        style={{ backgroundColor: status.color }}
      />
    </span>
  );
}

/**
 * The close cross shared by every sidebar row. It sits over the row's right
 * edge and only appears on hover of its own wrapper (`group/close`), so hovering
 * a thread never reveals the project's cross and vice versa. `stopPropagation`
 * on pointer-down keeps a click from starting a drag on the sortable wrapper.
 */
function SidebarCloseButton({
  label,
  onClose,
}: {
  readonly label: string;
  readonly onClose: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="absolute right-1 top-1 flex size-4 items-center justify-center rounded bg-zinc-900/90 text-zinc-500 opacity-0 hover:bg-zinc-700 hover:text-zinc-100 group-hover/close:opacity-100 focus-visible:opacity-100"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        onClose();
      }}
    >
      <X size={12} strokeWidth={2} />
    </button>
  );
}

function ActiveProjectGroup(props: {
  readonly group: ArkadiaSidebarProjectGroup;
  readonly activeTabKey: string | null;
  readonly projectIsCurrent: boolean;
  readonly onOpenProject: (group: ArkadiaSidebarProjectGroup) => void;
  readonly onOpenTab: (tab: ArkadiaWorkspaceTabItem, group: ArkadiaSidebarProjectGroup) => void;
  readonly onCloseProject: (group: ArkadiaSidebarProjectGroup) => void;
  readonly onCloseTab: (tab: ArkadiaWorkspaceTabItem, group: ArkadiaSidebarProjectGroup) => void;
}) {
  const {
    group,
    activeTabKey,
    projectIsCurrent,
    onOpenProject,
    onOpenTab,
    onCloseProject,
    onCloseTab,
  } = props;

  return (
    <div
      className="mx-1.5 mb-2 rounded-r border-l-[3px] pl-1.5 pr-1"
      style={{ borderLeftColor: group.color }}
    >
      <div className="group/close relative">
        <button
          className={`flex w-full cursor-pointer items-center rounded px-1.5 py-1 text-left text-[13px] ${
            projectIsCurrent
              ? "bg-zinc-800 text-zinc-100"
              : "text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100"
          }`}
          onClick={() => onOpenProject(group)}
          onMouseDown={(event) => {
            if (event.button !== 1) return;
            event.preventDefault();
            onCloseProject(group);
          }}
          title={group.project.workspaceRoot}
          type="button"
        >
          <span className="min-w-0 flex-1 truncate">{group.project.title}</span>
        </button>
        <SidebarCloseButton
          label={`Fermer ${group.project.title}`}
          onClose={() => onCloseProject(group)}
        />
      </div>

      <div className="flex flex-col pb-0.5">
        {group.tabs.map((tab) => {
          const label =
            tab.kind === "thread"
              ? tab.thread.title
              : tab.kind === "draft"
                ? "Nouvelle conversation"
                : getTerminalLabel(tab.terminalId);
          return (
            <div key={tab.key} className="group/close relative">
              <button
                className={`flex w-full items-center gap-2 rounded px-1.5 py-[3px] text-left text-xs ${
                  tab.key === activeTabKey
                    ? "bg-zinc-800 text-zinc-100"
                    : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
                }`}
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenTab(tab, group);
                }}
                onMouseDown={(event) => {
                  if (event.button !== 1) return;
                  event.preventDefault();
                  event.stopPropagation();
                  onCloseTab(tab, group);
                }}
                title={label}
                type="button"
              >
                {tab.kind === "thread" ? (
                  <ThreadStatusDot thread={tab.thread} />
                ) : tab.kind === "draft" ? (
                  <span className="size-2 shrink-0 rounded-full bg-emerald-500" />
                ) : (
                  <SquareTerminalIcon size={12} className="shrink-0 text-zinc-500" />
                )}
                <span className="min-w-0 flex-1 truncate">{label}</span>
              </button>
              <SidebarCloseButton
                label={`Fermer ${label}`}
                onClose={() => onCloseTab(tab, group)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function InactiveProjectRow(props: {
  readonly group: ArkadiaSidebarProjectGroup;
  readonly active: boolean;
  readonly onOpen: (group: ArkadiaSidebarProjectGroup) => void;
  readonly onDeleteRequest: (
    group: ArkadiaSidebarProjectGroup,
    position: { x: number; y: number },
  ) => void;
}) {
  const { group, active, onOpen, onDeleteRequest } = props;
  return (
    <div className="mx-1.5 mb-0.5">
      <button
        className={`flex w-full cursor-pointer items-start gap-2 rounded border-l-[3px] py-1.5 pl-2 pr-2 text-left ${
          active ? "bg-zinc-800 text-zinc-100" : "text-zinc-300 hover:bg-zinc-900"
        }`}
        onClick={() => onOpen(group)}
        onContextMenu={(event) => {
          event.preventDefault();
          onDeleteRequest(group, { x: event.clientX, y: event.clientY });
        }}
        style={{ borderLeftColor: group.color }}
        title={group.project.workspaceRoot}
        type="button"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm">{group.project.title}</span>
          <span className="block truncate font-mono text-[10px] text-zinc-500">
            {shortenArkadiaProjectPath(group.project.workspaceRoot)}
          </span>
        </span>
      </button>
    </div>
  );
}

function SortableProjectRow(props: { readonly id: string; readonly children: ReactNode }) {
  const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({
    id: props.id,
  });
  return (
    <div
      ref={setNodeRef}
      className={`cursor-grab touch-none active:cursor-grabbing ${
        isDragging ? "relative z-10 opacity-70" : ""
      }`}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...listeners}
    >
      {props.children}
    </div>
  );
}

export default function ArkadiaSidebar() {
  const projects = useProjects();
  const threads = useThreadShells();
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const router = useRouter();
  const handleNewThread = useNewThreadHandler();
  const leaveToNextActiveProject = useLeaveToNextActiveProject();
  const { settleThread } = useThreadActions();
  const closeWorkspaceThreadTab = useUiStateStore((store) => store.closeWorkspaceThreadTab);
  const openWorkspaceThreadTab = useUiStateStore((store) => store.openWorkspaceThreadTab);
  const openWorkspaceThreadTabKeyList = useUiStateStore(
    (store) => store.openWorkspaceThreadTabKeys,
  );
  const draftThreadsByThreadKey = useComposerDraftStore((store) => store.draftThreadsByThreadKey);
  const terminalsByProjectKey = useProjectTerminalsStore((store) => store.terminalsByProjectKey);
  const closeProjectTerminalTab = useProjectTerminalsStore((store) => store.closeTerminal);
  const deleteProject = useAtomCommand(projectEnvironment.delete);
  const createProject = useAtomCommand(projectEnvironment.create);
  const closeTerminalSession = useAtomCommand(terminalEnvironment.close, { reportFailure: false });
  const stopThreadSession = useAtomCommand(threadEnvironment.stopSession, { reportFailure: false });
  const projectOrder = useUiStateStore((store) => store.projectOrder);
  const reorderProjects = useUiStateStore((store) => store.reorderProjects);
  const tabOrderByProjectKey = useWorkspaceTabOrderStore((store) => store.orderByProjectKey);
  const activeTabKeyByProjectKey = useWorkspaceTabOrderStore(
    (store) => store.activeTabKeyByProjectKey,
  );
  const [view, setView] = useState<SidebarView>("inactive");
  const [recentSessionsOpen, setRecentSessionsOpen] = useState(false);
  const routeTarget = useParams({
    strict: false,
    select: (params) => resolveThreadRouteTarget(params),
  });
  // The project a full-screen terminal belongs to: that route carries no
  // thread, so the current project must come from its own params instead.
  const routeProjectKey = useParams({
    strict: false,
    select: (params) =>
      params.environmentId && params.projectId
        ? scopedProjectKey(params.environmentId, params.projectId)
        : null,
  });
  const routeTerminalId = useParams({
    strict: false,
    select: (params) => params.terminalId ?? null,
  });
  const routeDraftThread = useComposerDraftStore((store) =>
    routeTarget?.kind === "draft" ? store.getDraftSession(routeTarget.draftId) : null,
  );
  const routeThreadRef = useMemo(
    () => resolveActiveThreadRouteRef(routeTarget, routeDraftThread),
    [routeDraftThread, routeTarget],
  );
  const selectedProjectKey = useMemo(() => {
    if (routeDraftThread) {
      return scopedProjectKey(routeDraftThread.environmentId, routeDraftThread.projectId);
    }
    if (routeThreadRef) {
      const thread = threads.find(
        (candidate) =>
          candidate.environmentId === routeThreadRef.environmentId &&
          candidate.id === routeThreadRef.threadId,
      );
      if (thread) return scopedProjectKey(thread.environmentId, thread.projectId);
    }
    return routeProjectKey;
  }, [routeDraftThread, routeProjectKey, routeThreadRef, threads]);
  const openWorkspaceThreadTabKeys = useMemo(
    () => new Set(openWorkspaceThreadTabKeyList),
    [openWorkspaceThreadTabKeyList],
  );
  const activeTabKey = routeTarget
    ? routeTarget.kind === "server"
      ? arkadiaWorkspaceTabKey(routeTarget.threadRef.environmentId, routeTarget.threadRef.threadId)
      : `draft:${routeTarget.draftId}`
    : routeTerminalId
      ? `terminal:${routeTerminalId}`
      : null;
  const groups = useMemo(
    () =>
      buildArkadiaSidebarGroups({
        projects,
        threads,
        openThreadTabKeys: openWorkspaceThreadTabKeys,
        drafts: draftThreadsByThreadKey,
        terminalsByProjectKey,
        projectOrder,
        tabOrderByProjectKey,
      }),
    [
      draftThreadsByThreadKey,
      openWorkspaceThreadTabKeys,
      projectOrder,
      projects,
      tabOrderByProjectKey,
      terminalsByProjectKey,
      threads,
    ],
  );

  const previousActiveProjectKeysRef = useRef<ReadonlySet<string> | null>(null);
  useEffect(() => {
    const nextKeys = new Set(
      groups.active.map((group) => scopedProjectKey(group.project.environmentId, group.project.id)),
    );
    const previousKeys = previousActiveProjectKeysRef.current;
    previousActiveProjectKeysRef.current = nextKeys;
    if (previousKeys === null) return;
    if ([...nextKeys].some((key) => !previousKeys.has(key))) {
      setView("active");
    }
  }, [groups.active]);

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

  const connectedEnvironmentIds = useMemo(
    () =>
      environments
        .filter((environment) => environment.connection.phase === "connected")
        .map((environment) => environment.environmentId),
    [environments],
  );
  const navigateToThreadRef = useCallback(
    (ref: ReturnType<typeof scopeThreadRef>) => {
      void router.navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(ref),
      });
    },
    [router],
  );
  const resumeThread = useCallback(
    (ref: ReturnType<typeof scopeThreadRef>) => {
      const tabKey = arkadiaWorkspaceTabKey(ref.environmentId, ref.threadId);
      openWorkspaceThreadTab(tabKey);
      navigateToThreadRef(ref);
    },
    [navigateToThreadRef, openWorkspaceThreadTab],
  );
  const focusOpenThread = useCallback(
    (ref: ReturnType<typeof scopeThreadRef>): boolean => {
      const thread = threads.find(
        (candidate) =>
          candidate.environmentId === ref.environmentId && candidate.id === ref.threadId,
      );
      if (!thread || thread.archivedAt !== null) return false;
      const isCurrent =
        routeThreadRef?.environmentId === ref.environmentId &&
        routeThreadRef.threadId === ref.threadId;
      const isVisibleWorkspaceTab = openWorkspaceThreadTabKeys.has(
        arkadiaWorkspaceTabKey(ref.environmentId, ref.threadId),
      );
      if (!isCurrent && !isVisibleWorkspaceTab) return false;
      navigateToThreadRef(ref);
      return true;
    },
    [navigateToThreadRef, openWorkspaceThreadTabKeys, routeThreadRef, threads],
  );

  const openTab = useCallback(
    (tab: ArkadiaWorkspaceTabItem, group: ArkadiaSidebarProjectGroup) => {
      if (tab.kind === "thread") {
        openThread(tab.thread);
        return;
      }
      if (tab.kind === "draft") {
        void router.navigate({
          to: "/draft/$draftId",
          params: { draftId: DraftId.make(tab.draftId) },
        });
        return;
      }
      void router.navigate({
        to: "/$environmentId/project/$projectId/terminal/$terminalId",
        params: {
          environmentId: group.project.environmentId,
          projectId: group.project.id,
          terminalId: tab.terminalId,
        },
      });
    },
    [openThread, router],
  );

  const openProject = useCallback(
    (group: ArkadiaSidebarProjectGroup) => {
      const projectKey = scopedProjectKey(group.project.environmentId, group.project.id);
      const target = resolveArkadiaProjectOpenTab(group.tabs, activeTabKeyByProjectKey[projectKey]);
      if (target) openTab(target, group);
    },
    [activeTabKeyByProjectKey, openTab],
  );

  const openInactiveProject = useCallback(
    (group: ArkadiaSidebarProjectGroup) => {
      const target = resolveArkadiaInactiveProjectOpenTarget(
        useComposerDraftStore.getState().draftThreadsByThreadKey,
        group.project.environmentId,
        group.project.id,
      );
      if (target.kind === "draft") {
        void router.navigate({
          to: "/draft/$draftId",
          params: { draftId: DraftId.make(target.draftId) },
        });
        return;
      }
      void handleNewThread(scopeProjectRef(group.project.environmentId, group.project.id));
    },
    [handleNewThread, router],
  );

  const addProject = useCallback(async () => {
    const environment =
      environments.find(
        (candidate) =>
          candidate.environmentId === primaryEnvironmentId &&
          candidate.connection.phase === "connected",
      ) ?? environments.find((candidate) => candidate.connection.phase === "connected");
    if (!environment) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Impossible d’ajouter le projet",
          description: "Aucun environnement connecté n’est disponible.",
        }),
      );
      return;
    }

    const api = readLocalApi();
    if (!api) return;
    const selectedPath = await api.dialogs.pickFolder({ initialPath: "~/Desktop" });
    if (!selectedPath) return;

    const existing = findProjectByPath(
      projects.filter((project) => project.environmentId === environment.environmentId),
      selectedPath,
    );
    const projectId = existing?.id ?? newProjectId();
    if (!existing) {
      const createResult = await createProject({
        environmentId: environment.environmentId,
        input: {
          projectId,
          title: inferProjectTitleFromPath(selectedPath),
          workspaceRoot: selectedPath,
          createWorkspaceRootIfMissing: true,
          defaultModelSelection: resolveDefaultProviderModelSelection(
            environment.serverConfig?.providers ?? [],
            null,
          ),
        },
      });
      if (createResult._tag === "Failure") {
        if (!isAtomCommandInterrupted(createResult)) {
          const error = squashAtomCommandFailure(createResult);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Impossible d’ajouter le projet",
              description: error instanceof Error ? error.message : "Une erreur est survenue.",
            }),
          );
        }
        return;
      }
    }

    void router.navigate({
      to: "/$environmentId/project/$projectId",
      params: { environmentId: environment.environmentId, projectId },
    });
  }, [createProject, environments, primaryEnvironmentId, projects, router]);

  // Closing a project terminates its shells for good, the same way the tab bar
  // does — terminals have no other home in the UI, so settling would strand a
  // running PTY. Read the store imperatively to avoid subscribing the whole
  // sidebar to every terminal change.
  const closeProjectTerminals = useCallback(
    (group: ArkadiaSidebarProjectGroup) => {
      const projectRef = scopeProjectRef(group.project.environmentId, group.project.id);
      const projectKey = scopedProjectKey(group.project.environmentId, group.project.id);
      const terminals = selectProjectTerminals(
        useProjectTerminalsStore.getState().terminalsByProjectKey,
        projectKey,
      );
      if (terminals.length === 0) return;
      const terminalThreadId = projectTerminalThreadId(group.project.id);
      for (const terminal of terminals) {
        closeProjectTerminalTab(projectRef, terminal.terminalId);
        void closeTerminalSession({
          environmentId: group.project.environmentId,
          input: {
            threadId: terminalThreadId,
            terminalId: terminal.terminalId,
            deleteHistory: true,
          },
        });
      }
    },
    [closeProjectTerminalTab, closeTerminalSession],
  );

  const closeTabResources = useCallback(
    (tab: ArkadiaWorkspaceTabItem, group: ArkadiaSidebarProjectGroup) => {
      if (tab.kind === "thread") {
        const threadRef = scopeThreadRef(tab.thread.environmentId, tab.thread.id);
        closeWorkspaceThreadTab(tab.key);
        void (async () => {
          if (tab.thread.session !== null && tab.thread.session.status !== "stopped") {
            await stopThreadSession({
              environmentId: threadRef.environmentId,
              input: { threadId: threadRef.threadId },
            });
          }
          await settleThread(threadRef);
        })();
        return;
      }
      if (tab.kind === "draft") {
        useComposerDraftStore.getState().clearDraftThread(DraftId.make(tab.draftId));
        return;
      }
      const projectRef = scopeProjectRef(group.project.environmentId, group.project.id);
      closeProjectTerminalTab(projectRef, tab.terminalId);
      void closeTerminalSession({
        environmentId: group.project.environmentId,
        input: {
          threadId: projectTerminalThreadId(group.project.id),
          terminalId: tab.terminalId,
          deleteHistory: true,
        },
      });
    },
    [
      closeProjectTerminalTab,
      closeTerminalSession,
      closeWorkspaceThreadTab,
      settleThread,
      stopThreadSession,
    ],
  );

  const closeOneTab = useCallback(
    (tab: ArkadiaWorkspaceTabItem, group: ArkadiaSidebarProjectGroup) => {
      const isActive = tab.key === activeTabKey;
      const remaining = group.tabs.filter((candidate) => candidate.key !== tab.key);
      const nextKey = resolveArkadiaTabAfterClose(
        group.tabs.map((candidate) => candidate.key),
        tab.key,
      );
      const next = remaining.find((candidate) => candidate.key === nextKey) ?? remaining[0] ?? null;

      if (tab.kind === "draft" && isActive) {
        void closeArkadiaDraftTab({
          navigateAway: () => {
            if (next) {
              openTab(next, group);
              return Promise.resolve();
            }
            return leaveToNextActiveProject(
              scopedProjectKey(group.project.environmentId, group.project.id),
            );
          },
          clearDraft: () =>
            useComposerDraftStore.getState().clearDraftThread(DraftId.make(tab.draftId)),
        });
        return;
      }

      closeTabResources(tab, group);
      if (!isActive) return;
      if (next) {
        openTab(next, group);
        return;
      }
      void leaveToNextActiveProject(
        scopedProjectKey(group.project.environmentId, group.project.id),
      );
    },
    [activeTabKey, closeTabResources, leaveToNextActiveProject, openTab],
  );

  const handleInactiveProjectContextMenu = useCallback(
    (group: ArkadiaSidebarProjectGroup, position: { x: number; y: number }) => {
      const api = readLocalApi();
      if (!api) return;
      void requestArkadiaInactiveProjectDeletion({
        position,
        showContextMenu: (items, menuPosition) => api.contextMenu.show(items, menuPosition),
        deleteProject: async () => {
          const projectThreads = threads.filter(
            (thread) =>
              thread.environmentId === group.project.environmentId &&
              thread.projectId === group.project.id,
          );
          const confirmed = await api.dialogs.confirm(
            projectThreads.length > 0
              ? `Supprimer le projet « ${group.project.title} » et ses ${projectThreads.length} conversation(s) ?\n\nLes fichiers sur le disque ne seront pas supprimés. Cette action est irréversible.`
              : `Supprimer le projet « ${group.project.title} » ?\n\nLes fichiers sur le disque ne seront pas supprimés.`,
          );
          if (!confirmed) return;

          const result = await deleteProject({
            environmentId: group.project.environmentId,
            input: {
              projectId: group.project.id,
              ...(projectThreads.length > 0 ? { force: true } : {}),
            },
          });
          if (result._tag === "Failure") return;

          const draftStore = useComposerDraftStore.getState();
          for (const [draftId, draft] of Object.entries(draftStore.draftThreadsByThreadKey)) {
            if (
              draft.environmentId === group.project.environmentId &&
              draft.projectId === group.project.id
            ) {
              draftStore.clearDraftThread(DraftId.make(draftId));
            }
          }
          closeProjectTerminals(group);
          const projectKey = scopedProjectKey(group.project.environmentId, group.project.id);
          if (selectedProjectKey === projectKey) {
            await leaveToNextActiveProject(projectKey);
          }
        },
      });
    },
    [selectedProjectKey, closeProjectTerminals, deleteProject, leaveToNextActiveProject, threads],
  );

  // Closing a project closes all its conversations and terminals for real; if we
  // were looking at it, move on to the next active project (or the empty page).
  const closeProject = useCallback(
    (group: ArkadiaSidebarProjectGroup) => {
      const projectKey = scopedProjectKey(group.project.environmentId, group.project.id);
      if (selectedProjectKey === projectKey) {
        void leaveToNextActiveProject(projectKey);
      }
      for (const tab of group.tabs) closeTabResources(tab, group);
    },
    [selectedProjectKey, closeTabResources, leaveToNextActiveProject],
  );

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const handleReorder = useCallback(
    (event: DragEndEvent, list: ReadonlyArray<ArkadiaSidebarProjectGroup>) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const findByKey = (id: string | number) =>
        list.find(
          (group) => scopedProjectKey(group.project.environmentId, group.project.id) === id,
        );
      const draggedGroup = findByKey(active.id);
      const targetGroup = findByKey(over.id);
      if (!draggedGroup || !targetGroup) return;
      // Reordering stays within a tab, but the persisted order is a single flat
      // list across every project, so seed it with the full displayed order to
      // avoid dropping the projects in the other tab.
      const fullOrder = [...groups.active, ...groups.inactive].map((group) =>
        getProjectOrderKey(group.project),
      );
      reorderProjects(
        fullOrder,
        [getProjectOrderKey(draggedGroup.project)],
        [getProjectOrderKey(targetGroup.project)],
      );
    },
    [groups.active, groups.inactive, reorderProjects],
  );

  return (
    <>
      <div
        data-arkadia-sidebar=""
        className="flex h-full min-h-0 w-full flex-col bg-zinc-950 text-zinc-300"
      >
        <div className="flex shrink-0 border-b border-zinc-800">
          <button
            className={`flex-1 px-2 py-2 text-xs ${
              view === "active" ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:bg-zinc-900"
            }`}
            onClick={() => setView("active")}
            type="button"
          >
            Active{groups.active.length > 0 ? ` · ${groups.active.length}` : ""}
          </button>
          <button
            className={`flex-1 border-l border-zinc-800 px-2 py-2 text-xs ${
              view === "inactive" ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:bg-zinc-900"
            }`}
            onClick={() => setView("inactive")}
            type="button"
          >
            Inactive
          </button>
        </div>

        <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto py-2">
          {view === "active" ? (
            groups.active.length === 0 ? (
              <div className="px-3 py-2 text-xs text-zinc-500">
                aucun projet actif — envoyez un message pour commencer
              </div>
            ) : (
              <DndContext
                collisionDetection={closestCenter}
                onDragEnd={(event) => handleReorder(event, groups.active)}
                sensors={sensors}
              >
                <SortableContext
                  items={groups.active.map((group) =>
                    scopedProjectKey(group.project.environmentId, group.project.id),
                  )}
                  strategy={verticalListSortingStrategy}
                >
                  {groups.active.map((group) => {
                    const key = scopedProjectKey(group.project.environmentId, group.project.id);
                    return (
                      <SortableProjectRow key={key} id={key}>
                        <ActiveProjectGroup
                          activeTabKey={activeTabKey}
                          group={group}
                          projectIsCurrent={key === selectedProjectKey}
                          onOpenProject={openProject}
                          onOpenTab={openTab}
                          onCloseProject={closeProject}
                          onCloseTab={closeOneTab}
                        />
                      </SortableProjectRow>
                    );
                  })}
                </SortableContext>
              </DndContext>
            )
          ) : groups.inactive.length === 0 ? (
            <div className="px-3 py-2 text-xs text-zinc-500">aucun projet inactif</div>
          ) : (
            <DndContext
              collisionDetection={closestCenter}
              onDragEnd={(event) => handleReorder(event, groups.inactive)}
              sensors={sensors}
            >
              <SortableContext
                items={groups.inactive.map((group) =>
                  scopedProjectKey(group.project.environmentId, group.project.id),
                )}
                strategy={verticalListSortingStrategy}
              >
                {groups.inactive.map((group) => {
                  const key = scopedProjectKey(group.project.environmentId, group.project.id);
                  return (
                    <SortableProjectRow key={key} id={key}>
                      <InactiveProjectRow
                        active={key === selectedProjectKey}
                        group={group}
                        onOpen={openInactiveProject}
                        onDeleteRequest={handleInactiveProjectContextMenu}
                      />
                    </SortableProjectRow>
                  );
                })}
              </SortableContext>
            </DndContext>
          )}
        </div>

        <div className="flex shrink-0 flex-col gap-1 border-t border-zinc-900 p-2">
          <button
            className="flex items-center justify-center gap-1.5 rounded border border-zinc-800/60 bg-transparent px-2 py-1.5 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
            onClick={() => setRecentSessionsOpen(true)}
            title="Retrouver une conversation dans tous les projets"
            type="button"
          >
            <History className="shrink-0" size={13} />
            Sessions récentes
          </button>
          <button
            className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
            onClick={() => void addProject()}
            type="button"
          >
            Nouveau projet
          </button>
        </div>
      </div>
      <RecentSessionsNavigator
        open={recentSessionsOpen}
        onClose={() => setRecentSessionsOpen(false)}
        threads={threads}
        projects={projects}
        environmentIds={connectedEnvironmentIds}
        onResume={resumeThread}
        onFocusOpenThread={focusOpenThread}
      />
    </>
  );
}

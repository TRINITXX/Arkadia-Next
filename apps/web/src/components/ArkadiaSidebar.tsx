import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
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
import { History, X } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getProjectOrderKey } from "../logicalProject";
import { useUiStateStore } from "../uiStateStore";
import { openCommandPalette } from "../commandPaletteBus";
import { useClientSettings } from "../hooks/useSettings";
import { useLeaveToNextActiveProject } from "../hooks/useLeaveToNextActiveProject";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { useNowMinute } from "../hooks/useNowMinute";
import { useThreadActions } from "../hooks/useThreadActions";
import { useProjects, useThreadShells } from "../state/entities";
import { terminalEnvironment } from "../state/terminal";
import { useAtomCommand } from "../state/use-atom-command";
import { projectTerminalThreadId } from "../terminal/projectTerminals";
import {
  buildThreadRouteParams,
  resolveActiveThreadRouteRef,
  resolveThreadRouteTarget,
} from "../threadRoutes";
import { useComposerDraftStore } from "../composerDraftStore";
import {
  arkadiaWorkspaceTabKey,
  buildArkadiaSidebarGroups,
  resolveArkadiaActiveProjectLayout,
  resolveArkadiaThreadIndicator,
  shortenArkadiaProjectPath,
  type ArkadiaSidebarProjectGroup,
} from "./arkadiaSidebarModel";
import { selectProjectTerminals, useProjectTerminalsStore } from "./terminal/projectTerminalsStore";
import { useWorkspaceTabOrderStore } from "./workspaceTabOrderStore";

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
  readonly activeThreadId: string | null;
  readonly projectIsCurrent: boolean;
  readonly onOpenProject: (group: ArkadiaSidebarProjectGroup) => void;
  readonly onOpenThread: (thread: EnvironmentThreadShell) => void;
  readonly onCloseProject: (group: ArkadiaSidebarProjectGroup) => void;
  readonly onCloseThread: (
    thread: EnvironmentThreadShell,
    group: ArkadiaSidebarProjectGroup,
  ) => void;
}) {
  const {
    group,
    activeThreadId,
    projectIsCurrent,
    onOpenProject,
    onOpenThread,
    onCloseProject,
    onCloseThread,
  } = props;
  const layout = resolveArkadiaActiveProjectLayout(group.threads.length);

  if (layout === "solo") {
    const thread = group.threads[0]!;
    const threadIsActive = thread.id === activeThreadId;

    return (
      <div
        className="group/close relative mx-1.5 mb-2 rounded-r border-l-[3px] pl-1.5 pr-1"
        style={{ borderLeftColor: group.color }}
      >
        <button
          className={`w-full cursor-pointer rounded px-1.5 py-1 text-left ${
            threadIsActive || projectIsCurrent
              ? "bg-zinc-800 text-zinc-100"
              : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
          }`}
          onClick={() => onOpenThread(thread)}
          onMouseDown={(event) => {
            if (event.button !== 1) return;
            event.preventDefault();
            onCloseProject(group);
          }}
          title={`${thread.title}\n${group.project.workspaceRoot}`}
          type="button"
        >
          <span className="block truncate text-[13px]">{group.project.title}</span>
          <span className="mt-px flex items-center gap-2 text-xs">
            <ThreadStatusDot thread={thread} />
            <span className="min-w-0 flex-1 truncate">{thread.title}</span>
          </span>
        </button>
        <SidebarCloseButton
          label={`Fermer ${group.project.title}`}
          onClose={() => onCloseProject(group)}
        />
      </div>
    );
  }

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
        {group.threads.map((thread) => (
          <div key={`${thread.environmentId}:${thread.id}`} className="group/close relative">
            <button
              className={`flex w-full items-center gap-2 rounded px-1.5 py-[3px] text-left text-xs ${
                thread.id === activeThreadId
                  ? "bg-zinc-800 text-zinc-100"
                  : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
              }`}
              onClick={(event) => {
                event.stopPropagation();
                onOpenThread(thread);
              }}
              onMouseDown={(event) => {
                if (event.button !== 1) return;
                event.preventDefault();
                event.stopPropagation();
                onCloseThread(thread, group);
              }}
              title={thread.title}
              type="button"
            >
              <ThreadStatusDot thread={thread} />
              <span className="min-w-0 flex-1 truncate">{thread.title}</span>
            </button>
            <SidebarCloseButton
              label={`Fermer ${thread.title}`}
              onClose={() => onCloseThread(thread, group)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function InactiveProjectRow(props: {
  readonly group: ArkadiaSidebarProjectGroup;
  readonly active: boolean;
  readonly onOpen: (group: ArkadiaSidebarProjectGroup) => void;
  readonly onClose: (group: ArkadiaSidebarProjectGroup) => void;
}) {
  const { group, active, onOpen, onClose } = props;
  return (
    <div className="group/close relative mx-1.5 mb-0.5">
      <button
        className={`flex w-full cursor-pointer items-start gap-2 rounded border-l-[3px] py-1.5 pl-2 pr-2 text-left ${
          active ? "bg-zinc-800 text-zinc-100" : "text-zinc-300 hover:bg-zinc-900"
        }`}
        onClick={() => onOpen(group)}
        onMouseDown={(event) => {
          if (event.button !== 1) return;
          event.preventDefault();
          onClose(group);
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
      <SidebarCloseButton label={`Fermer ${group.project.title}`} onClose={() => onClose(group)} />
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
  const router = useRouter();
  const nowMinute = useNowMinute();
  const autoSettleAfterDays = useClientSettings((settings) => settings.sidebarAutoSettleAfterDays);
  const handleNewThread = useNewThreadHandler();
  const leaveToNextActiveProject = useLeaveToNextActiveProject();
  const { settleThread } = useThreadActions();
  const closeWorkspaceTab = useUiStateStore((store) => store.closeWorkspaceTab);
  const closeProjectTerminalTab = useProjectTerminalsStore((store) => store.closeTerminal);
  const closeTerminalSession = useAtomCommand(terminalEnvironment.close, { reportFailure: false });
  const projectOrder = useUiStateStore((store) => store.projectOrder);
  const reorderProjects = useUiStateStore((store) => store.reorderProjects);
  const tabOrderByProjectKey = useWorkspaceTabOrderStore((store) => store.orderByProjectKey);
  const [view, setView] = useState<SidebarView>("inactive");
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
  const routeDraftThread = useComposerDraftStore((store) =>
    routeTarget?.kind === "draft" ? store.getDraftSession(routeTarget.draftId) : null,
  );
  const routeThreadRef = useMemo(
    () => resolveActiveThreadRouteRef(routeTarget, routeDraftThread),
    [routeDraftThread, routeTarget],
  );
  const activeThreadId = routeThreadRef?.threadId ?? null;
  const groups = useMemo(
    () =>
      buildArkadiaSidebarGroups({
        projects,
        threads,
        now: `${nowMinute}:00.000Z`,
        autoSettleAfterDays,
        projectOrder,
        tabOrderByProjectKey,
      }),
    [autoSettleAfterDays, nowMinute, projectOrder, projects, tabOrderByProjectKey, threads],
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
      void router.navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(scopeThreadRef(thread.environmentId, thread.id)),
      });
    },
    [router],
  );

  const openProject = useCallback(
    (group: ArkadiaSidebarProjectGroup) => {
      const currentThread = group.threads.find((thread) => thread.id === activeThreadId);
      const targetThread = currentThread ?? group.threads[0];
      if (targetThread) {
        openThread(targetThread);
        return;
      }
      void handleNewThread(scopeProjectRef(group.project.environmentId, group.project.id));
    },
    [activeThreadId, handleNewThread, openThread],
  );

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

  // Closing a conversation from the sidebar is the same gesture as closing its
  // tab: settle it AND drop it from the tab bar. If it was the one on screen,
  // fall back to a sibling in the same project, then to the next active project.
  const closeOneThread = useCallback(
    (thread: EnvironmentThreadShell, group: ArkadiaSidebarProjectGroup) => {
      void settleThread(scopeThreadRef(thread.environmentId, thread.id));
      closeWorkspaceTab(arkadiaWorkspaceTabKey(thread.environmentId, thread.id));
      if (thread.id !== activeThreadId) return;
      const sibling = group.threads.find((candidate) => candidate.id !== thread.id);
      if (sibling) {
        openThread(sibling);
        return;
      }
      void leaveToNextActiveProject(scopedProjectKey(thread.environmentId, thread.projectId));
    },
    [activeThreadId, closeWorkspaceTab, leaveToNextActiveProject, openThread, settleThread],
  );

  const activeProjectKey = useMemo(() => {
    if (routeThreadRef) {
      const thread = threads.find(
        (candidate) =>
          candidate.environmentId === routeThreadRef.environmentId &&
          candidate.id === routeThreadRef.threadId,
      );
      if (thread) return scopedProjectKey(thread.environmentId, thread.projectId);
    }
    return routeProjectKey;
  }, [routeProjectKey, routeThreadRef, threads]);

  // Closing a project closes all its conversations and terminals for real; if we
  // were looking at it, move on to the next active project (or the empty page).
  const closeProject = useCallback(
    (group: ArkadiaSidebarProjectGroup) => {
      const projectKey = scopedProjectKey(group.project.environmentId, group.project.id);
      for (const thread of group.threads) {
        void settleThread(scopeThreadRef(thread.environmentId, thread.id));
        closeWorkspaceTab(arkadiaWorkspaceTabKey(thread.environmentId, thread.id));
      }
      closeProjectTerminals(group);
      if (activeProjectKey === projectKey) {
        void leaveToNextActiveProject(projectKey);
      }
    },
    [
      activeProjectKey,
      closeProjectTerminals,
      closeWorkspaceTab,
      leaveToNextActiveProject,
      settleThread,
    ],
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
                        activeThreadId={activeThreadId}
                        group={group}
                        projectIsCurrent={key === activeProjectKey}
                        onOpenProject={openProject}
                        onOpenThread={openThread}
                        onCloseProject={closeProject}
                        onCloseThread={closeOneThread}
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
                      active={key === activeProjectKey}
                      group={group}
                      onOpen={openProject}
                      onClose={closeProject}
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
          onClick={() => openCommandPalette()}
          title="Retrouver une conversation dans tous les projets"
          type="button"
        >
          <History className="shrink-0" size={13} />
          Sessions récentes
        </button>
        <button
          className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
          onClick={() => openCommandPalette({ open: "add-project" })}
          type="button"
        >
          + New project
        </button>
      </div>
    </div>
  );
}

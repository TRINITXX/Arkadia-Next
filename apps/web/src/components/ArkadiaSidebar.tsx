import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { useParams, useRouter } from "@tanstack/react-router";
import { History } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { openCommandPalette } from "../commandPaletteBus";
import { useClientSettings } from "../hooks/useSettings";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { useNowMinute } from "../hooks/useNowMinute";
import { useThreadActions } from "../hooks/useThreadActions";
import { useProjects, useThreadShells } from "../state/entities";
import {
  buildThreadRouteParams,
  resolveActiveThreadRouteRef,
  resolveThreadRouteTarget,
} from "../threadRoutes";
import { useComposerDraftStore } from "../composerDraftStore";
import {
  buildArkadiaSidebarGroups,
  resolveArkadiaActiveProjectLayout,
  resolveArkadiaThreadIndicator,
  shortenArkadiaProjectPath,
  type ArkadiaSidebarProjectGroup,
} from "./arkadiaSidebarModel";

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

function ActiveProjectGroup(props: {
  readonly group: ArkadiaSidebarProjectGroup;
  readonly activeThreadId: string | null;
  readonly onOpenProject: (group: ArkadiaSidebarProjectGroup) => void;
  readonly onOpenThread: (thread: EnvironmentThreadShell) => void;
  readonly onSettleProject: (group: ArkadiaSidebarProjectGroup) => void;
  readonly onSettleThread: (thread: EnvironmentThreadShell) => void;
}) {
  const { group, activeThreadId, onOpenProject, onOpenThread, onSettleProject, onSettleThread } =
    props;
  const projectIsActive = group.threads.some((thread) => thread.id === activeThreadId);
  const layout = resolveArkadiaActiveProjectLayout(group.threads.length);

  if (layout === "solo") {
    const thread = group.threads[0]!;
    const threadIsActive = thread.id === activeThreadId;

    return (
      <div
        className="mx-1.5 mb-2 rounded-r border-l-[3px] pl-1.5 pr-1"
        style={{ borderLeftColor: group.color }}
      >
        <button
          className={`w-full cursor-pointer rounded px-1.5 py-1 text-left ${
            threadIsActive
              ? "bg-zinc-800 text-zinc-100"
              : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
          }`}
          onClick={() => onOpenThread(thread)}
          onMouseDown={(event) => {
            if (event.button !== 1) return;
            event.preventDefault();
            onSettleProject(group);
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
      </div>
    );
  }

  return (
    <div
      className="group mx-1.5 mb-2 rounded-r border-l-[3px] pl-1.5 pr-1"
      style={{ borderLeftColor: group.color }}
    >
      <button
        className={`flex w-full cursor-pointer items-center rounded px-1.5 py-1 text-left text-[13px] ${
          projectIsActive ? "text-zinc-100" : "text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100"
        }`}
        onClick={() => onOpenProject(group)}
        onMouseDown={(event) => {
          if (event.button !== 1) return;
          event.preventDefault();
          onSettleProject(group);
        }}
        title={group.project.workspaceRoot}
        type="button"
      >
        <span className="min-w-0 flex-1 truncate">{group.project.title}</span>
      </button>

      <div className="flex flex-col pb-0.5">
        {group.threads.map((thread) => (
          <button
            key={`${thread.environmentId}:${thread.id}`}
            className={`flex items-center gap-2 rounded px-1.5 py-[3px] text-left text-xs ${
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
              onSettleThread(thread);
            }}
            title={thread.title}
            type="button"
          >
            <ThreadStatusDot thread={thread} />
            <span className="min-w-0 flex-1 truncate">{thread.title}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function InactiveProjectRow(props: {
  readonly group: ArkadiaSidebarProjectGroup;
  readonly active: boolean;
  readonly onOpen: (group: ArkadiaSidebarProjectGroup) => void;
}) {
  const { group, active, onOpen } = props;
  return (
    <button
      className={`group mx-1.5 mb-0.5 flex cursor-pointer items-start gap-2 self-stretch rounded border-l-[3px] py-1.5 pl-2 pr-2 text-left ${
        active ? "bg-zinc-800 text-zinc-100" : "text-zinc-300 hover:bg-zinc-900"
      }`}
      onClick={() => onOpen(group)}
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
  );
}

export default function ArkadiaSidebar() {
  const projects = useProjects();
  const threads = useThreadShells();
  const router = useRouter();
  const nowMinute = useNowMinute();
  const autoSettleAfterDays = useClientSettings((settings) => settings.sidebarAutoSettleAfterDays);
  const handleNewThread = useNewThreadHandler();
  const { settleThread } = useThreadActions();
  const [view, setView] = useState<SidebarView>("inactive");
  const routeTarget = useParams({
    strict: false,
    select: (params) => resolveThreadRouteTarget(params),
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
      }),
    [autoSettleAfterDays, nowMinute, projects, threads],
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

  const settleOneThread = useCallback(
    (thread: EnvironmentThreadShell) => {
      void settleThread(scopeThreadRef(thread.environmentId, thread.id));
    },
    [settleThread],
  );

  const settleProject = useCallback(
    (group: ArkadiaSidebarProjectGroup) => {
      void Promise.all(
        group.threads.map((thread) =>
          settleThread(scopeThreadRef(thread.environmentId, thread.id)),
        ),
      );
    },
    [settleThread],
  );

  const activeProjectKey = useMemo(() => {
    if (!routeThreadRef) return null;
    const thread = threads.find(
      (candidate) =>
        candidate.environmentId === routeThreadRef.environmentId &&
        candidate.id === routeThreadRef.threadId,
    );
    return thread ? scopedProjectKey(thread.environmentId, thread.projectId) : null;
  }, [routeThreadRef, threads]);

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-zinc-950 text-zinc-300">
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
            groups.active.map((group) => (
              <ActiveProjectGroup
                key={scopedProjectKey(group.project.environmentId, group.project.id)}
                activeThreadId={activeThreadId}
                group={group}
                onOpenProject={openProject}
                onOpenThread={openThread}
                onSettleProject={settleProject}
                onSettleThread={settleOneThread}
              />
            ))
          )
        ) : groups.inactive.length === 0 ? (
          <div className="px-3 py-2 text-xs text-zinc-500">aucun projet inactif</div>
        ) : (
          groups.inactive.map((group) => {
            const key = scopedProjectKey(group.project.environmentId, group.project.id);
            return (
              <InactiveProjectRow
                key={key}
                active={key === activeProjectKey}
                group={group}
                onOpen={openProject}
              />
            );
          })
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

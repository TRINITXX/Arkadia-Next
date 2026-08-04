import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { ThreadId } from "@t3tools/contracts";
import { useRouter } from "@tanstack/react-router";
import { useCallback } from "react";

import {
  buildArkadiaSidebarGroups,
  resolveArkadiaNextActiveProject,
  resolveArkadiaReturnThreadId,
} from "../components/arkadiaSidebarModel";
import { useWorkspaceTabOrderStore } from "../components/workspaceTabOrderStore";
import { useClientSettings } from "./useSettings";
import { useNowMinute } from "./useNowMinute";
import { useProjects, useThreadShells } from "../state/entities";
import { buildThreadRouteParams } from "../threadRoutes";
import { useUiStateStore } from "../uiStateStore";

/**
 * Where to land once the last tab of the current project is closed: the next
 * still-active project (the conversation the user last read there), or the
 * empty home page when nothing else is active. Never spawns a fresh
 * conversation — closing the last tab is meant to let the project go inactive,
 * not to reset it.
 */
export function useLeaveToNextActiveProject(): (excludeProjectKey: string) => Promise<void> {
  const router = useRouter();
  const projects = useProjects();
  const threads = useThreadShells();
  const nowMinute = useNowMinute();
  const autoSettleAfterDays = useClientSettings((settings) => settings.sidebarAutoSettleAfterDays);
  const projectOrder = useUiStateStore((store) => store.projectOrder);
  const tabOrderByProjectKey = useWorkspaceTabOrderStore((store) => store.orderByProjectKey);
  const lastVisitedAtByThreadKey = useUiStateStore((store) => store.threadLastVisitedAtById);

  return useCallback(
    (excludeProjectKey: string) => {
      const groups = buildArkadiaSidebarGroups({
        projects,
        threads,
        now: `${nowMinute}:00.000Z`,
        autoSettleAfterDays,
        projectOrder,
        tabOrderByProjectKey,
      });
      const target = resolveArkadiaNextActiveProject(groups.active, excludeProjectKey);
      if (target) {
        const returnThreadId = resolveArkadiaReturnThreadId({
          threads,
          environmentId: target.project.environmentId,
          projectId: target.project.id,
          lastVisitedAtByThreadKey,
        });
        const threadId = returnThreadId ?? target.threads[0]?.id ?? null;
        if (threadId) {
          return router.navigate({
            to: "/$environmentId/$threadId",
            params: buildThreadRouteParams(
              scopeThreadRef(target.project.environmentId, ThreadId.make(threadId)),
            ),
            replace: true,
          });
        }
      }
      return router.navigate({ to: "/", replace: true });
    },
    [
      autoSettleAfterDays,
      lastVisitedAtByThreadKey,
      nowMinute,
      projectOrder,
      projects,
      router,
      tabOrderByProjectKey,
      threads,
    ],
  );
}

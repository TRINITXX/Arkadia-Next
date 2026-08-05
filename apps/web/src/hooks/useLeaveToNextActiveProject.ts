import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useRouter } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";

import {
  buildArkadiaSidebarGroups,
  resolveArkadiaNextActiveProject,
  resolveArkadiaProjectOpenTab,
} from "../components/arkadiaSidebarModel";
import { useWorkspaceTabOrderStore } from "../components/workspaceTabOrderStore";
import { useProjects, useThreadShells } from "../state/entities";
import { buildThreadRouteParams } from "../threadRoutes";
import { useUiStateStore } from "../uiStateStore";
import { DraftId, useComposerDraftStore } from "../composerDraftStore";
import { useProjectTerminalsStore } from "../components/terminal/projectTerminalsStore";

/**
 * Where to land once the last tab of the current project is closed: the next
 * still-active project (the tab the user last used there), or the empty home
 * page when nothing else is active. Never spawns a fresh
 * conversation — closing the last tab is meant to let the project go inactive,
 * not to reset it.
 */
export function useLeaveToNextActiveProject(): (excludeProjectKey: string) => Promise<void> {
  const router = useRouter();
  const projects = useProjects();
  const threads = useThreadShells();
  const projectOrder = useUiStateStore((store) => store.projectOrder);
  const openWorkspaceThreadTabKeyList = useUiStateStore(
    (store) => store.openWorkspaceThreadTabKeys,
  );
  const openWorkspaceThreadTabKeys = useMemo(
    () => new Set(openWorkspaceThreadTabKeyList),
    [openWorkspaceThreadTabKeyList],
  );
  const drafts = useComposerDraftStore((store) => store.draftThreadsByThreadKey);
  const terminalsByProjectKey = useProjectTerminalsStore((store) => store.terminalsByProjectKey);
  const tabOrderByProjectKey = useWorkspaceTabOrderStore((store) => store.orderByProjectKey);
  const activeTabKeyByProjectKey = useWorkspaceTabOrderStore(
    (store) => store.activeTabKeyByProjectKey,
  );

  return useCallback(
    (excludeProjectKey: string) => {
      const groups = buildArkadiaSidebarGroups({
        projects,
        threads,
        openThreadTabKeys: openWorkspaceThreadTabKeys,
        drafts,
        terminalsByProjectKey,
        projectOrder,
        tabOrderByProjectKey,
      });
      const target = resolveArkadiaNextActiveProject(groups.active, excludeProjectKey);
      if (target) {
        const projectKey = `${target.project.environmentId}:${target.project.id}`;
        const tab = resolveArkadiaProjectOpenTab(target.tabs, activeTabKeyByProjectKey[projectKey]);
        if (tab?.kind === "thread") {
          return router.navigate({
            to: "/$environmentId/$threadId",
            params: buildThreadRouteParams(scopeThreadRef(tab.thread.environmentId, tab.thread.id)),
            replace: true,
          });
        }
        if (tab?.kind === "draft") {
          return router.navigate({
            to: "/draft/$draftId",
            params: { draftId: DraftId.make(tab.draftId) },
            replace: true,
          });
        }
        if (tab?.kind === "terminal") {
          return router.navigate({
            to: "/$environmentId/project/$projectId/terminal/$terminalId",
            params: {
              environmentId: target.project.environmentId,
              projectId: target.project.id,
              terminalId: tab.terminalId,
            },
            replace: true,
          });
        }
      }
      return router.navigate({ to: "/", replace: true });
    },
    [
      activeTabKeyByProjectKey,
      drafts,
      openWorkspaceThreadTabKeys,
      projectOrder,
      projects,
      router,
      tabOrderByProjectKey,
      terminalsByProjectKey,
      threads,
    ],
  );
}

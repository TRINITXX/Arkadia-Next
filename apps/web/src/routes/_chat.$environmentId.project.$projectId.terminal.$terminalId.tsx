import {
  scopeProjectRef,
  scopedProjectKey,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo } from "react";

import ArkadiaWorkspaceTabs from "../components/ArkadiaWorkspaceTabs";
import { resolveArkadiaReturnThreadId } from "../components/arkadiaSidebarModel";
import { ProjectTerminalView } from "../components/terminal/ProjectTerminalView";
import {
  selectProjectTerminals,
  useProjectTerminalsStore,
} from "../components/terminal/projectTerminalsStore";
import { useCloseProjectTerminal } from "../components/terminal/useCloseProjectTerminal";
import { SidebarInset } from "~/components/ui/sidebar";
import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import { useThreadShells } from "~/state/entities";
import { buildThreadRouteParams } from "~/threadRoutes";
import { useUiStateStore } from "~/uiStateStore";

/**
 * A project terminal, full screen, as its own workspace tab. Terminals belong
 * to the project rather than to a conversation, so this route carries a
 * project ref and no thread at all.
 */
function ProjectTerminalRouteView() {
  const params = Route.useParams();
  const environmentId = EnvironmentId.make(params.environmentId);
  const projectId = ProjectId.make(params.projectId);
  const terminalId = params.terminalId;
  const router = useRouter();
  const handleNewThread = useNewThreadHandler();
  const threads = useThreadShells();
  const lastVisitedAtByThreadKey = useUiStateStore((store) => store.threadLastVisitedAtById);

  const projectRef = useMemo(
    () => scopeProjectRef(environmentId, projectId),
    [environmentId, projectId],
  );
  const terminals = useProjectTerminalsStore((store) =>
    selectProjectTerminals(store.terminalsByProjectKey, scopedProjectKey(projectRef)),
  );
  const closeProjectTerminal = useCloseProjectTerminal(projectRef);
  const isKnownTerminal = terminals.some((terminal) => terminal.terminalId === terminalId);

  const returnThreadId = useMemo(() => {
    const id = resolveArkadiaReturnThreadId({
      threads,
      environmentId,
      projectId,
      lastVisitedAtByThreadKey,
    });
    return id === null ? null : ThreadId.make(id);
  }, [environmentId, lastVisitedAtByThreadKey, projectId, threads]);

  /** Where to go once this terminal is gone — closed, exited, or never existed. */
  const leaveTerminal = useCallback(() => {
    if (returnThreadId !== null) {
      void router.navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(scopeThreadRef(environmentId, returnThreadId)),
        replace: true,
      });
      return;
    }
    void handleNewThread(projectRef, { replace: true });
  }, [environmentId, handleNewThread, projectRef, returnThreadId, router]);

  // Covers a stale link and a tab closed from elsewhere: either way this route
  // has nothing left to render.
  useEffect(() => {
    if (isKnownTerminal) return;
    leaveTerminal();
  }, [isKnownTerminal, leaveTerminal]);

  const handleExited = useCallback(() => {
    closeProjectTerminal(terminalId);
    leaveTerminal();
  }, [closeProjectTerminal, leaveTerminal, terminalId]);

  return (
    <SidebarInset className="h-svh min-h-0 flex-col overflow-hidden overscroll-y-none bg-background text-foreground md:h-dvh">
      <ArkadiaWorkspaceTabs
        environmentId={environmentId}
        projectId={projectId}
        activeThreadId={null}
        activeTerminalId={terminalId}
        keepVisibleThreadId={returnThreadId}
      />
      {isKnownTerminal ? (
        <ProjectTerminalView
          environmentId={environmentId}
          projectId={projectId}
          terminalId={terminalId}
          onExited={handleExited}
        />
      ) : null}
    </SidebarInset>
  );
}

export const Route = createFileRoute(
  "/_chat/$environmentId/project/$projectId/terminal/$terminalId",
)({
  component: ProjectTerminalRouteView,
});

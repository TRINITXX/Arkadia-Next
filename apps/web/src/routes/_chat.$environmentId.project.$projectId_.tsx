import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { createFileRoute } from "@tanstack/react-router";

import ArkadiaWorkspaceTabs from "../components/ArkadiaWorkspaceTabs";
import { SidebarInset } from "../components/ui/sidebar";

function EmptyProjectRouteView() {
  const params = Route.useParams();
  const environmentId = EnvironmentId.make(params.environmentId);
  const projectId = ProjectId.make(params.projectId);

  return (
    <SidebarInset className="h-svh min-h-0 flex-col overflow-hidden overscroll-y-none bg-background text-foreground md:h-dvh">
      <ArkadiaWorkspaceTabs
        environmentId={environmentId}
        projectId={projectId}
        activeThreadId={null}
      />
      <div className="min-h-0 flex-1 bg-background" data-empty-project-view="" />
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/$environmentId/project/$projectId_")({
  component: EmptyProjectRouteView,
});

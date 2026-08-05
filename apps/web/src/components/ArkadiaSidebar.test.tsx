import { describe, expect, it } from "vite-plus/test";

import rootRouteSource from "../routes/__root.tsx?raw";
import arkadiaSidebarSource from "./ArkadiaSidebar.tsx?raw";

describe("Arkadia recent sessions entry point", () => {
  it("guards sidebar draft close controls with the mixed project tab list", () => {
    expect(arkadiaSidebarSource).toContain("canCloseArkadiaDraftTab");
    expect(arkadiaSidebarSource).toContain("canCloseArkadiaDraftTab(group.tabs, tab.key)");
    expect(arkadiaSidebarSource).toContain("group.tabs.map");
  });

  it("renders every canonical workspace tab beneath its project, including a single tab", () => {
    expect(arkadiaSidebarSource).toContain("group.tabs.map");
    expect(arkadiaSidebarSource).not.toContain("group.threads.map");
    expect(arkadiaSidebarSource).not.toContain('layout === "solo"');
    expect(arkadiaSidebarSource).toContain('tab.kind === "draft"');
    expect(arkadiaSidebarSource).toContain("getTerminalLabel(tab.terminalId)");
    expect(arkadiaSidebarSource).toContain("<SquareTerminalIcon");
  });

  it("opens and mounts the dedicated navigator from Sessions récentes", () => {
    expect(arkadiaSidebarSource).toContain("<RecentSessionsNavigator");
    expect(arkadiaSidebarSource).toMatch(
      /onClick=\{\(\) => setRecentSessionsOpen\(true\)\}[\s\S]*Sessions récentes/,
    );
  });

  it("does not mount or publish to the legacy command palette", () => {
    expect(arkadiaSidebarSource).not.toContain("openCommandPalette");
    expect(rootRouteSource).not.toContain("<CommandPalette");
    expect(rootRouteSource).not.toContain('from "../components/CommandPalette"');
  });

  it("keeps Nouveau projet directly below Sessions récentes and opens the picker on Desktop", () => {
    const sessionsIndex = arkadiaSidebarSource.indexOf("Sessions récentes");
    const newProjectIndex = arkadiaSidebarSource.indexOf("Nouveau projet");

    expect(sessionsIndex).toBeGreaterThan(-1);
    expect(newProjectIndex).toBeGreaterThan(sessionsIndex);
    expect(arkadiaSidebarSource).not.toContain('open: "add-project"');
    expect(arkadiaSidebarSource).toContain('pickFolder({ initialPath: "~/Desktop" })');
    expect(arkadiaSidebarSource).not.toContain("addProjectBaseDirectory");
  });

  it("opens a resumed historical conversation before navigating to it", () => {
    expect(arkadiaSidebarSource).toMatch(
      /const tabKey = arkadiaWorkspaceTabKey[\s\S]*openWorkspaceThreadTab\(tabKey\);[\s\S]*navigateToThreadRef\(ref\);/,
    );
  });

  it("classifies projects from the same mixed tab inputs as the top bar", () => {
    expect(arkadiaSidebarSource).toMatch(
      /routeDraftThread[\s\S]*scopedProjectKey\(routeDraftThread\.environmentId, routeDraftThread\.projectId\)/,
    );
    expect(arkadiaSidebarSource).toContain("selectedProjectKey");
    expect(arkadiaSidebarSource).toContain("openThreadTabKeys: openWorkspaceThreadTabKeys");
    expect(arkadiaSidebarSource).toContain("drafts: draftThreadsByThreadKey");
    expect(arkadiaSidebarSource).toContain("terminalsByProjectKey");
  });

  it("starts fallback navigation before clearing the active draft", () => {
    expect(arkadiaSidebarSource).toContain("closeArkadiaDraftTab");
    expect(arkadiaSidebarSource).toMatch(
      /tab\.kind === "draft"[\s\S]*closeArkadiaDraftTab\(\{[\s\S]*navigateAway:[\s\S]*clearDraft:/,
    );
  });

  it("opens an inactive project directly on its persistent new-conversation tab", () => {
    expect(arkadiaSidebarSource).toContain("resolveArkadiaInactiveProjectOpenTarget");
    expect(arkadiaSidebarSource).toMatch(
      /const openInactiveProject = useCallback[\s\S]*target\.kind === "draft"[\s\S]*to: "\/draft\/\$draftId"[\s\S]*handleNewThread\(scopeProjectRef/,
    );
    expect(arkadiaSidebarSource).toContain("onOpen={openInactiveProject}");
  });
});

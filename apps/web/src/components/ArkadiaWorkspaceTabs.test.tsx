import { describe, expect, it } from "vite-plus/test";

import workspaceTabsSource from "./ArkadiaWorkspaceTabs.tsx?raw";
import toolbarSource from "./toolbar/ArkadiaToolbar.tsx?raw";
import routeTreeSource from "../routeTree.gen.ts?raw";
import projectTerminalViewSource from "./terminal/ProjectTerminalView.tsx?raw";
import projectTerminalRouteSource from "../routes/_chat.$environmentId.project.$projectId.terminal.$terminalId.tsx?raw";
import appStylesSource from "../index.css?raw";
import { prependArkadiaWorkspaceTabKey } from "./arkadiaSidebarModel";

describe("Arkadia workspace tab controls", () => {
  it("renders the canonical mixed-tab collection shared with the sidebar", () => {
    expect(workspaceTabsSource).toContain("buildArkadiaWorkspaceTabItems");
    expect(workspaceTabsSource).toContain("openWorkspaceThreadTabKeys");
    expect(workspaceTabsSource).not.toContain("closedWorkspaceTabKeys");
    expect(workspaceTabsSource).not.toContain("retainedWorkspaceTabKeys");
  });

  it("places Nouveau terminal immediately before the ordered tabs", () => {
    const terminalControlIndex = workspaceTabsSource.indexOf('aria-label="Nouveau terminal"');
    const firstOrderedTabIndex = workspaceTabsSource.indexOf("{orderedTabItems.map");

    expect(terminalControlIndex).toBeGreaterThan(-1);
    expect(firstOrderedTabIndex).toBeGreaterThan(terminalControlIndex);
    expect(toolbarSource).not.toContain('label="Nouveau terminal"');
  });

  it("inserts every newly created terminal tab at index zero", () => {
    expect(
      prependArkadiaWorkspaceTabKey(
        ["local:thread-a", "draft:new", "terminal:older"],
        "terminal:newest",
      ),
    ).toEqual(["terminal:newest", "local:thread-a", "draft:new", "terminal:older"]);
    expect(workspaceTabsSource).toContain("prependArkadiaWorkspaceTabKey");
  });

  it("renders the terminal route outside the empty-project leaf route", () => {
    expect(routeTreeSource).toMatch(
      /ChatEnvironmentIdProjectProjectIdTerminalTerminalIdRouteImport\.update\(\{[\s\S]*?getParentRoute: \(\) => ChatRoute,/,
    );
  });

  it("uses the Agent content background token for the project terminal surface", () => {
    expect(projectTerminalViewSource).toContain(
      'className="thread-terminal-drawer flex min-h-0 min-w-0 flex-1 flex-col bg-background"',
    );
  });

  it("keeps the workspace toolbar visible above a project terminal", () => {
    expect(projectTerminalViewSource).toContain("<ArkadiaToolbar");
    expect(projectTerminalViewSource).toContain('data-project-terminal-toolbar=""');
    expect(projectTerminalViewSource).toContain("shrink-0");
  });

  it("keeps the conversation shown beside a terminal explicitly open", () => {
    expect(projectTerminalRouteSource).toMatch(
      /visibleReturnThread[\s\S]*openWorkspaceThreadTab\([\s\S]*arkadiaWorkspaceTabKey/,
    );
  });

  it("uses the same chrome surface selector for terminal and conversation toolbars", () => {
    expect(projectTerminalViewSource).toContain('data-chat-header=""');
    expect(projectTerminalViewSource).toMatch(
      /data-project-terminal-toolbar=""[\s\S]*?className="[^"]*bg-zinc-950/,
    );
  });

  it("does not reserve a painted black strip at the Windows right resize edge", () => {
    expect(appStylesSource).not.toMatch(
      /\.electron-windows\s*\{[\s\S]*?--desktop-window-right-resize-inset:\s*6px/,
    );
  });
});

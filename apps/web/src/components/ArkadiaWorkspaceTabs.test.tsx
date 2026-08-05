import { describe, expect, it } from "vite-plus/test";

import workspaceTabsSource from "./ArkadiaWorkspaceTabs.tsx?raw";
import toolbarSource from "./toolbar/ArkadiaToolbar.tsx?raw";
import { prependArkadiaWorkspaceTabKey } from "./arkadiaSidebarModel";

describe("Arkadia workspace tab controls", () => {
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
});

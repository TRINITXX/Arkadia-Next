import { describe, expect, it } from "vite-plus/test";

import appSidebarLayoutSource from "./AppSidebarLayout.tsx?raw";

describe("Arkadia chat sidebar layout", () => {
  it("does not render the sidebar toggle on agent routes", () => {
    expect(appSidebarLayoutSource).toMatch(
      /\{isOnSettings\s*\?\s*<SidebarControl\s*\/>\s*:\s*null\}/,
    );
    expect(appSidebarLayoutSource).toContain('collapsible={isOnSettings ? "offcanvas" : "none"}');
  });
});

import { describe, expect, it } from "vite-plus/test";

import appSidebarLayoutSource from "./AppSidebarLayout.tsx?raw";

describe("Arkadia chat sidebar layout", () => {
  it("renders the sidebar toggle only on settings routes, and makes the chat sidebar collapsible", () => {
    expect(appSidebarLayoutSource).toMatch(
      /\{isOnSettings\s*\?\s*<SidebarControl\s*\/>\s*:\s*null\}/,
    );
    expect(appSidebarLayoutSource).toContain('collapsible="offcanvas"');
  });
});

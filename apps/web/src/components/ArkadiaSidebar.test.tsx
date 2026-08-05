import { describe, expect, it } from "vite-plus/test";

import rootRouteSource from "../routes/__root.tsx?raw";
import arkadiaSidebarSource from "./ArkadiaSidebar.tsx?raw";

describe("Arkadia recent sessions entry point", () => {
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
});

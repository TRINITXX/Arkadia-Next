import { describe, expect, it } from "vite-plus/test";

import { markWorkspaceTabActive } from "./workspaceTabOrderStore";

describe("markWorkspaceTabActive", () => {
  it("records the project's last active tab without changing manual order", () => {
    const state = {
      orderByProjectKey: {
        "local:alpha": ["local:first", "draft:second"],
      },
      activeTabKeyByProjectKey: {},
    };

    const next = markWorkspaceTabActive(state, "local:alpha", "draft:second");

    expect(next.activeTabKeyByProjectKey).toEqual({ "local:alpha": "draft:second" });
    expect(next.orderByProjectKey).toBe(state.orderByProjectKey);
    expect(markWorkspaceTabActive(next, "local:alpha", "draft:second")).toBe(next);
  });
});

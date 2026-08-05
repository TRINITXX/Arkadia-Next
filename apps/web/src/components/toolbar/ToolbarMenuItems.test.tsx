import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import type { ToolbarButton as ToolbarButtonModel } from "@t3tools/contracts";

vi.mock("~/components/ui/menu", () => ({
  MenuItem: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) => (
    <button type="button" data-slot="menu-item" {...props}>
      {children}
    </button>
  ),
  MenuSub: ({ children }: { children: ReactNode }) => <div data-slot="menu-sub">{children}</div>,
  MenuSubPopup: ({ children }: { children: ReactNode }) => (
    <div data-slot="menu-sub-popup">{children}</div>
  ),
  MenuSubTrigger: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) => (
    <button type="button" data-slot="menu-sub-trigger" {...props}>
      {children}
    </button>
  ),
}));

import { ToolbarMenuItems } from "./ToolbarMenuItems";

describe("ToolbarMenuItems", () => {
  it("renders configured actions and folders as menu entries", () => {
    const buttons: ToolbarButtonModel[] = [
      {
        id: "custom-review",
        kind: "action",
        label: "Review",
        icon: "check",
        command: "/review",
        order: 0,
      },
      {
        id: "custom-folder",
        kind: "folder",
        label: "Custom commands",
        icon: "folder",
        order: 1,
        children: [
          {
            id: "custom-deploy",
            kind: "action",
            label: "Deploy",
            icon: "play",
            command: "npm run deploy",
            order: 0,
          },
        ],
      },
    ];

    const markup = renderToStaticMarkup(
      <ToolbarMenuItems items={buttons} onRunAction={() => {}} />,
    );

    expect(markup).toContain("Review");
    expect(markup).toContain("Custom commands");
    expect(markup).toContain('data-slot="menu-sub-trigger"');
  });
});

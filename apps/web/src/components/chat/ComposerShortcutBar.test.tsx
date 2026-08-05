import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("../ui/menu", () => ({
  Menu: ({ children }: { children: ReactNode }) => <>{children}</>,
  MenuPopup: () => null,
  MenuTrigger: ({
    render,
    children,
  }: {
    render: {
      props: {
        "aria-label"?: string;
        "data-composer-shortcut-menu-trigger"?: string;
        disabled?: boolean;
        onPointerDown?: unknown;
      };
    };
    children: ReactNode;
  }) => (
    <button
      type="button"
      aria-label={render.props["aria-label"]}
      data-composer-shortcut-menu-trigger={render.props["data-composer-shortcut-menu-trigger"]}
      data-menu-trigger-pointer-handler={render.props.onPointerDown ? "present" : "absent"}
      disabled={render.props.disabled}
    >
      {children}
    </button>
  ),
}));

import { ComposerShortcutBar } from "./ComposerShortcutBar";

/**
 * `useClientSettings` reads from a plain `useSyncExternalStore` module store
 * (no provider needed) and falls back to `DEFAULT_CLIENT_SETTINGS` for
 * `getServerSnapshot`, so this renders the default command menu without any
 * test setup.
 */
describe("ComposerShortcutBar", () => {
  it("renders the command menu trigger instead of an inline shortcut row", () => {
    const markup = renderToStaticMarkup(<ComposerShortcutBar onRunAction={() => {}} disabled />);

    expect(markup).toContain('data-composer-shortcut-menu-trigger="true"');
    expect(markup).toContain('aria-label="Commandes"');
    expect(markup).toContain('disabled=""');
    expect(markup).not.toContain('data-composer-shortcut-bar="true"');
  });

  it("keeps the command menu trigger enabled when the composer accepts input", () => {
    const markup = renderToStaticMarkup(<ComposerShortcutBar onRunAction={() => {}} />);

    expect(markup).toContain('data-composer-shortcut-menu-trigger="true"');
    expect(markup).not.toContain('disabled=""');
  });

  it("does not cancel pointerdown before Base UI can open the menu", () => {
    const markup = renderToStaticMarkup(<ComposerShortcutBar onRunAction={() => {}} />);

    expect(markup).toContain('data-menu-trigger-pointer-handler="absent"');
  });
});

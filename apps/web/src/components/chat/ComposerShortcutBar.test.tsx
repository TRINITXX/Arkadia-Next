import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ComposerShortcutBar } from "./ComposerShortcutBar";

/**
 * `useClientSettings` reads from a plain `useSyncExternalStore` module store
 * (no provider needed) and falls back to `DEFAULT_CLIENT_SETTINGS` for
 * `getServerSnapshot`, so this renders the default prompt buttons
 * (`/commit`, `/clear`, `/compact`, `/resume`) without any test setup.
 */
describe("ComposerShortcutBar", () => {
  it("passes disabled through to every rendered shortcut button", () => {
    const markup = renderToStaticMarkup(<ComposerShortcutBar onRunAction={() => {}} disabled />);

    expect(markup).toContain('data-composer-shortcut-bar="true"');
    // Every button in the row must carry the disabled attribute — none of
    // them should stay clickable while the composer itself can't take input.
    const buttonCount = (markup.match(/<button\b/g) ?? []).length;
    const disabledButtonCount = (markup.match(/<button\b[^>]*\bdisabled=""/g) ?? []).length;
    expect(buttonCount).toBeGreaterThan(0);
    expect(disabledButtonCount).toBe(buttonCount);
  });

  it("leaves every rendered shortcut button enabled when not disabled", () => {
    const markup = renderToStaticMarkup(<ComposerShortcutBar onRunAction={() => {}} />);

    const buttonCount = (markup.match(/<button\b/g) ?? []).length;
    const disabledButtonCount = (markup.match(/<button\b[^>]*\bdisabled=""/g) ?? []).length;
    expect(buttonCount).toBeGreaterThan(0);
    expect(disabledButtonCount).toBe(0);
  });
});

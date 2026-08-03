import type { PointerEventHandler } from "react";

/**
 * Cancels the pointerdown's default focus shift so clicking a toolbar
 * button never steals focus away from whatever the user was already
 * interacting with — most importantly the composer text field the shortcut
 * row (`ComposerShortcutBar`) sits right above. Shared by
 * `ToolbarActionButton` and `ToolbarFolderButton`, which both need it.
 */
export const preventPointerFocus: PointerEventHandler<HTMLElement> = (event) => {
  event.preventDefault();
};

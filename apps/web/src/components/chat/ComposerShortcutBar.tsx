import type { ToolbarActionButton as ToolbarActionButtonModel } from "@t3tools/contracts";

import { useClientSettings } from "~/hooks/useSettings";
import { ToolbarActionButton } from "../toolbar/ToolbarActionButton";
import { ToolbarFolderButton } from "../toolbar/ToolbarFolderButton";
import { sortedToolbarChildren } from "../toolbar/toolbarFolderNav";

interface ComposerShortcutBarProps {
  /** Inserts the button's command into the composer, sending it too when `submit` is set. */
  onRunAction: (button: ToolbarActionButtonModel) => void;
  /**
   * Greys every button out while the composer itself can't take input
   * (reconnecting, no project chosen yet) — the same condition
   * `ChatComposer` already uses to disable its text field and send button.
   * The row stays visible (not hidden) so it doesn't flicker in and out on
   * every reconnect, it just visibly matches its disabled neighbours instead
   * of looking clickable while silently doing nothing.
   */
  disabled?: boolean;
}

/**
 * Row of user-configurable shortcut buttons under the message field, twin of
 * `ArkadiaToolbar` reusing the same button components (Task 3) against
 * `promptButtons` instead of `toolbarButtons`. Ported from Arkadia's
 * `PromptBar` (`src/components/PromptBar.tsx`): folder popovers open upward
 * since the row sits at the bottom of the screen, and every button preserves
 * focus on pointerdown so clicking a shortcut never steals the caret away
 * from the composer the user is typing in.
 */
export function ComposerShortcutBar({ onRunAction, disabled = false }: ComposerShortcutBarProps) {
  const promptButtons = useClientSettings((settings) => settings.promptButtons);
  const sortedButtons = sortedToolbarChildren(promptButtons);

  if (sortedButtons.length === 0) return null;

  return (
    <div
      className="-mx-1 flex min-w-0 items-center gap-1 overflow-x-auto px-1 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      data-composer-shortcut-bar="true"
    >
      {sortedButtons.map((button) =>
        button.kind === "folder" ? (
          <ToolbarFolderButton
            key={button.id}
            button={button}
            onRunAction={onRunAction}
            side="top"
            preserveFocusOnPointerDown
            disabled={disabled}
          />
        ) : (
          <ToolbarActionButton
            key={button.id}
            button={button}
            onRun={onRunAction}
            preserveFocusOnPointerDown
            disabled={disabled}
          />
        ),
      )}
    </div>
  );
}

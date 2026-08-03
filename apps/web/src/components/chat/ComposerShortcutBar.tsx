import type { ToolbarActionButton as ToolbarActionButtonModel } from "@t3tools/contracts";

import { useClientSettings } from "~/hooks/useSettings";
import { ToolbarActionButton } from "../toolbar/ToolbarActionButton";
import { ToolbarFolderButton } from "../toolbar/ToolbarFolderButton";
import { sortedToolbarChildren } from "../toolbar/toolbarFolderNav";

interface ComposerShortcutBarProps {
  /** Inserts the button's command into the composer, sending it too when `submit` is set. */
  onRunAction: (button: ToolbarActionButtonModel) => void;
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
export function ComposerShortcutBar({ onRunAction }: ComposerShortcutBarProps) {
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
          />
        ) : (
          <ToolbarActionButton
            key={button.id}
            button={button}
            onRun={onRunAction}
            preserveFocusOnPointerDown
          />
        ),
      )}
    </div>
  );
}

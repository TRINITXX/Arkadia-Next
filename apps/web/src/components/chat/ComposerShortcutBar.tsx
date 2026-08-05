import type { ToolbarActionButton as ToolbarActionButtonModel } from "@t3tools/contracts";

import { TerminalIcon } from "lucide-react";
import { useClientSettings } from "~/hooks/useSettings";
import { Menu, MenuPopup, MenuTrigger } from "../ui/menu";
import { ComposerControl, ComposerControlIcon } from "./ComposerControl";
import { ToolbarMenuItems } from "../toolbar/ToolbarMenuItems";
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
 * Compact command menu for the user-configurable `promptButtons`. Actions
 * stay in the composer footer so the prompt field keeps its vertical space;
 * folders become nested menu levels and every item preserves the editor's
 * focus while the menu is used.
 */
export function ComposerShortcutBar({ onRunAction, disabled = false }: ComposerShortcutBarProps) {
  const promptButtons = useClientSettings((settings) => settings.promptButtons);
  const sortedButtons = sortedToolbarChildren(promptButtons);

  if (sortedButtons.length === 0) return null;

  return (
    <Menu>
      <MenuTrigger
        render={
          <ComposerControl
            type="button"
            className="shrink-0 text-muted-foreground/70 hover:text-foreground/80"
            disabled={disabled}
            aria-label="Commandes"
            title="Commandes"
            data-composer-shortcut-menu-trigger="true"
          />
        }
      >
        <ComposerControlIcon icon={TerminalIcon} />
      </MenuTrigger>
      <MenuPopup side="top" align="start" className="max-w-90">
        <ToolbarMenuItems
          items={sortedButtons}
          onRunAction={onRunAction}
          preserveFocusOnPointerDown
        />
      </MenuPopup>
    </Menu>
  );
}

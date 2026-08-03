import type { ToolbarActionButton as ToolbarActionButtonModel } from "@t3tools/contracts";

import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { getToolbarIcon } from "./toolbarIcons";
import { preventPointerFocus } from "./toolbarDom";

/**
 * A single root-level (or in-folder) action chip. Built on the app's own
 * `Button` (`size="xs"`, `variant="outline"`) rather than hand-rolled classes,
 * so it carries the same height, radius, border, focus ring and disabled
 * treatment as every other control in the chrome. Keeps Arkadia's fallback
 * ladder: an icon slot that silently disappears for an unknown slug
 * ({@link getToolbarIcon} returns `null` instead of throwing), and a label that
 * falls back to the raw command — or a placeholder — so the button is never a
 * blank, dead control.
 */
interface ToolbarActionButtonProps {
  button: ToolbarActionButtonModel;
  onRun: (button: ToolbarActionButtonModel) => void;
  /**
   * The composer shortcut row (Task 6) sits right above a text field the
   * user is actively typing in — clicking a button must not steal its
   * focus/caret. Unused by the top toolbar, which has no field to protect.
   */
  preserveFocusOnPointerDown?: boolean;
  /**
   * Greys the button out and blocks clicks — the composer shortcut row
   * (Task 6) uses this while the composer itself is disabled (reconnecting,
   * no project chosen yet) so it never sits there looking clickable while
   * silently doing nothing. Unused by the top toolbar, which has no such
   * disabled state.
   */
  disabled?: boolean;
  className?: string;
}

export function ToolbarActionButton({
  button,
  onRun,
  preserveFocusOnPointerDown = false,
  disabled = false,
  className,
}: ToolbarActionButtonProps) {
  const Icon = getToolbarIcon(button.icon);
  const showLabel = button.label.length > 0;
  const fallbackText = button.command.length > 0 ? button.command : "sans nom";

  return (
    <Button
      size="xs"
      variant="outline"
      onClick={() => onRun(button)}
      onPointerDown={preserveFocusOnPointerDown ? preventPointerFocus : undefined}
      disabled={disabled}
      className={cn("max-w-56 [-webkit-app-region:no-drag]", className)}
      title={button.command || button.label}
    >
      {Icon && <Icon />}
      {showLabel && <span className="truncate">{button.label}</span>}
      {!Icon && !showLabel && (
        <span className="truncate text-muted-foreground">{fallbackText}</span>
      )}
    </Button>
  );
}

import type { PointerEventHandler } from "react";
import type { ToolbarActionButton as ToolbarActionButtonModel } from "@t3tools/contracts";

import { getToolbarIcon } from "./toolbarIcons";

/**
 * A single root-level (or in-folder) action chip. Ported visually from
 * Arkadia's `ActionToolbarButton` (`src/components/Toolbar.tsx:146-178`): an
 * icon slot that silently disappears for an unknown slug
 * ({@link getToolbarIcon} returns `null` instead of throwing), and a label
 * that falls back to the raw command — or a placeholder — so the button is
 * never a blank, dead control.
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
}

export function ToolbarActionButton({
  button,
  onRun,
  preserveFocusOnPointerDown = false,
  disabled = false,
}: ToolbarActionButtonProps) {
  const Icon = getToolbarIcon(button.icon);
  const showLabel = button.label.length > 0;
  const fallbackText = button.command.length > 0 ? button.command : "sans nom";

  return (
    <button
      onClick={() => onRun(button)}
      onPointerDown={preserveFocusOnPointerDown ? preventPointerFocus : undefined}
      disabled={disabled}
      className="flex h-7 shrink-0 items-center gap-1.5 rounded border border-zinc-800 bg-zinc-900 px-2 text-xs text-zinc-200 hover:border-zinc-700 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-zinc-800 disabled:hover:bg-zinc-900 [-webkit-app-region:no-drag]"
      title={button.command || button.label}
      type="button"
    >
      {Icon && <Icon size={14} />}
      {showLabel && <span>{button.label}</span>}
      {!Icon && !showLabel && <span className="text-zinc-500">{fallbackText}</span>}
    </button>
  );
}

const preventPointerFocus: PointerEventHandler<HTMLElement> = (event) => {
  event.preventDefault();
};

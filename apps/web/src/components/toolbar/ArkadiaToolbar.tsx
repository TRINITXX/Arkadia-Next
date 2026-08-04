import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import {
  Globe2Icon,
  NotebookPenIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  SettingsIcon,
  SquareTerminalIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import type { ToolbarActionButton as ToolbarActionButtonModel } from "@t3tools/contracts";

import { Button } from "~/components/ui/button";
import { Separator } from "~/components/ui/separator";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useSidebar } from "~/components/ui/sidebar";
import { useClientSettings } from "~/hooks/useSettings";
import { shortcutLabelForCommand } from "~/keybindings";
import { primaryServerKeybindingsAtom } from "~/state/server";
import { ToolbarButtonStrip } from "./ToolbarButtonStrip";
import { sortedToolbarChildren } from "./toolbarFolderNav";

/**
 * The Arkadia toolbar shell that replaced the old chat header: the sidebar
 * toggle, the user's customisable button tree, then the fixed surfaces
 * (notepad, settings, terminal). Built out of the app's own `Button`,
 * `Separator` and `Tooltip` so it reads as one chrome strip with the tab bar
 * above it rather than a bolted-on row.
 */

interface ArkadiaToolbarProps {
  terminalAvailable: boolean;
  /** Whether the browser preview surface can be opened (desktop-only). */
  browserAvailable: boolean;
  onOpenNewTerminal: () => void;
  /** Runs an action button's command — always in a brand-new terminal. */
  onRunAction: (command: string) => void;
  /** Opens the notepad right-panel surface and focuses it. */
  onOpenNotepad: () => void;
  /** Opens the browser right-panel surface. */
  onOpenBrowser: () => void;
}

export function ArkadiaToolbar({
  terminalAvailable,
  browserAvailable,
  onOpenNewTerminal,
  onRunAction,
  onOpenNotepad,
  onOpenBrowser,
}: ArkadiaToolbarProps) {
  const navigate = useNavigate();
  const { state, toggleSidebar } = useSidebar();
  const sidebarOpen = state === "expanded";
  const toolbarButtons = useClientSettings((s) => s.toolbarButtons);
  const sortedButtons = sortedToolbarChildren(toolbarButtons);
  const runAction = (button: ToolbarActionButtonModel) => onRunAction(button.command);
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const sidebarShortcut = shortcutLabelForCommand(keybindings, "sidebar.toggle");
  const sidebarLabel = sidebarOpen ? "Fermer la barre latérale" : "Ouvrir la barre latérale";

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <ToolbarIconButton
        label={sidebarLabel}
        tooltip={sidebarShortcut ? `${sidebarLabel} (${sidebarShortcut})` : sidebarLabel}
        onClick={toggleSidebar}
        aria-pressed={sidebarOpen}
      >
        {sidebarOpen ? <PanelLeftCloseIcon /> : <PanelLeftOpenIcon />}
      </ToolbarIconButton>

      <Separator orientation="vertical" className="mx-1 h-4" />

      <ToolbarButtonStrip buttons={sortedButtons} onRunAction={runAction} />

      <Separator orientation="vertical" className="mx-1 h-4" />

      <div className="flex shrink-0 items-center gap-0.5">
        <ToolbarIconButton label="Bloc-notes" onClick={onOpenNotepad}>
          <NotebookPenIcon />
        </ToolbarIconButton>
        <ToolbarIconButton
          label={
            browserAvailable
              ? "Navigateur"
              : "Le navigateur n'est disponible que dans l'application desktop"
          }
          onClick={onOpenBrowser}
          disabled={!browserAvailable}
        >
          <Globe2Icon />
        </ToolbarIconButton>
        <ToolbarIconButton label="Réglages" onClick={() => void navigate({ to: "/settings" })}>
          <SettingsIcon />
        </ToolbarIconButton>
        <ToolbarIconButton
          label={
            terminalAvailable
              ? "Nouveau terminal"
              : "Sélectionnez un projet pour ouvrir un terminal"
          }
          onClick={onOpenNewTerminal}
          disabled={!terminalAvailable}
        >
          <SquareTerminalIcon />
        </ToolbarIconButton>
      </div>
    </div>
  );
}

interface ToolbarIconButtonProps {
  /** The accessible name, and the tooltip text unless `tooltip` overrides it. */
  label: string;
  /** Richer tooltip text (e.g. label plus keyboard shortcut). */
  tooltip?: string;
  onClick: () => void;
  disabled?: boolean;
  "aria-pressed"?: boolean;
  children: ReactNode;
}

function ToolbarIconButton({
  label,
  tooltip,
  onClick,
  disabled = false,
  children,
  ...ariaProps
}: ToolbarIconButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-xs"
            variant="ghost"
            className="shrink-0 [-webkit-app-region:no-drag]"
            onClick={onClick}
            disabled={disabled}
            aria-label={label}
            {...ariaProps}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipPopup side="bottom">{tooltip ?? label}</TooltipPopup>
    </Tooltip>
  );
}

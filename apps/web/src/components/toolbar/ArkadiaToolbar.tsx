import { useNavigate } from "@tanstack/react-router";
import {
  NotebookPen,
  PanelBottomIcon,
  PanelLeftClose,
  PanelLeftOpen,
  Settings as SettingsIcon,
} from "lucide-react";
import type { ToolbarActionButton as ToolbarActionButtonModel } from "@t3tools/contracts";

import { useSidebar } from "~/components/ui/sidebar";
import { useClientSettings } from "~/hooks/useSettings";
import { ToolbarActionButton } from "./ToolbarActionButton";
import { ToolbarFolderButton } from "./ToolbarFolderButton";
import { sortedToolbarChildren } from "./toolbarFolderNav";

/**
 * The Arkadia toolbar shell that replaces the old chat header. Ported from
 * Arkadia's `src/components/Toolbar.tsx:55-142`, stripped to what this task
 * needs: the sidebar toggle, a flexible middle region rendering the user's
 * customisable button tree, the notepad button, the settings entry point,
 * and the terminal button.
 */

interface ArkadiaToolbarProps {
  terminalAvailable: boolean;
  onOpenNewTerminal: () => void;
  /** Runs an action button's command — always in a brand-new terminal. */
  onRunAction: (command: string) => void;
  /** Opens the notepad right-panel surface and focuses it. */
  onOpenNotepad: () => void;
}

export function ArkadiaToolbar({
  terminalAvailable,
  onOpenNewTerminal,
  onRunAction,
  onOpenNotepad,
}: ArkadiaToolbarProps) {
  const navigate = useNavigate();
  const { state, toggleSidebar } = useSidebar();
  const sidebarOpen = state === "expanded";
  const toolbarButtons = useClientSettings((s) => s.toolbarButtons);
  const sortedButtons = sortedToolbarChildren(toolbarButtons);
  const runAction = (button: ToolbarActionButtonModel) => onRunAction(button.command);

  return (
    <div className="flex h-9 min-w-0 flex-1 items-center gap-1 border-b border-zinc-800 bg-zinc-950 px-2 text-zinc-300">
      <button
        onClick={toggleSidebar}
        className="flex size-7 shrink-0 items-center justify-center rounded text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100 [-webkit-app-region:no-drag]"
        title={sidebarOpen ? "Fermer la barre latérale" : "Ouvrir la barre latérale"}
        aria-label={sidebarOpen ? "Fermer la barre latérale" : "Ouvrir la barre latérale"}
        aria-pressed={sidebarOpen}
        type="button"
      >
        {sidebarOpen ? <PanelLeftClose size={14} /> : <PanelLeftOpen size={14} />}
      </button>

      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto" data-toolbar-buttons>
        {sortedButtons.length === 0 && (
          <span className="text-xs text-zinc-600">Aucun bouton configuré</span>
        )}
        {sortedButtons.map((button) =>
          button.kind === "folder" ? (
            <ToolbarFolderButton key={button.id} button={button} onRunAction={runAction} />
          ) : (
            <ToolbarActionButton key={button.id} button={button} onRun={runAction} />
          ),
        )}
      </div>

      <button
        onClick={onOpenNotepad}
        className="flex size-7 shrink-0 items-center justify-center rounded text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100 [-webkit-app-region:no-drag]"
        title="Bloc-notes"
        aria-label="Bloc-notes"
        type="button"
      >
        <NotebookPen size={14} />
      </button>
      <button
        onClick={() => void navigate({ to: "/settings" })}
        className="flex size-7 shrink-0 items-center justify-center rounded text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100 [-webkit-app-region:no-drag]"
        title="Réglages"
        aria-label="Réglages"
        type="button"
      >
        <SettingsIcon size={14} />
      </button>
      <button
        onClick={onOpenNewTerminal}
        disabled={!terminalAvailable}
        className="flex size-7 shrink-0 items-center justify-center rounded text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 [-webkit-app-region:no-drag]"
        title={
          terminalAvailable ? "Nouveau terminal" : "Sélectionnez un projet pour ouvrir un terminal"
        }
        aria-label="Nouveau terminal"
        type="button"
      >
        <PanelBottomIcon size={14} />
      </button>
    </div>
  );
}

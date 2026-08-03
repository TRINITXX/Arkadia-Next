import { useNavigate } from "@tanstack/react-router";
import {
  PanelBottomIcon,
  PanelLeftClose,
  PanelLeftOpen,
  Settings as SettingsIcon,
} from "lucide-react";

import { useSidebar } from "~/components/ui/sidebar";

/**
 * The Arkadia toolbar shell that replaces the old chat header. Ported from
 * Arkadia's `src/components/Toolbar.tsx:55-142`, stripped to what this task
 * needs: the sidebar toggle, a flexible middle region (Task 3 fills it with
 * the user's toolbar buttons), the settings entry point, and the terminal
 * button. The notepad button is Task 5's job and is intentionally absent —
 * an inert placeholder would ship a dead control.
 */

interface ArkadiaToolbarProps {
  terminalAvailable: boolean;
  onOpenNewTerminal: () => void;
}

export function ArkadiaToolbar({ terminalAvailable, onOpenNewTerminal }: ArkadiaToolbarProps) {
  const navigate = useNavigate();
  const { state, toggleSidebar } = useSidebar();
  const sidebarOpen = state === "expanded";

  return (
    <div className="flex h-9 min-w-0 flex-1 items-center gap-1 border-b border-zinc-800 bg-zinc-950 px-2 text-zinc-300">
      <button
        onClick={toggleSidebar}
        className="flex size-7 shrink-0 items-center justify-center rounded text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
        title={sidebarOpen ? "Fermer la barre latérale" : "Ouvrir la barre latérale"}
        aria-label={sidebarOpen ? "Fermer la barre latérale" : "Ouvrir la barre latérale"}
        aria-pressed={sidebarOpen}
        type="button"
      >
        {sidebarOpen ? <PanelLeftClose size={14} /> : <PanelLeftOpen size={14} />}
      </button>

      {/* Flexible middle region — Task 3 renders the user's toolbar buttons here. */}
      <div
        className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
        data-toolbar-buttons
      />

      <button
        onClick={() => void navigate({ to: "/settings" })}
        className="flex size-7 shrink-0 items-center justify-center rounded text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
        title="Réglages"
        aria-label="Réglages"
        type="button"
      >
        <SettingsIcon size={14} />
      </button>
      <button
        onClick={onOpenNewTerminal}
        disabled={!terminalAvailable}
        className="flex size-7 shrink-0 items-center justify-center rounded text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-40"
        title="Nouveau terminal"
        aria-label="Nouveau terminal"
        type="button"
      >
        <PanelBottomIcon size={14} />
      </button>
    </div>
  );
}

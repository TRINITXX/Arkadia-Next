import { useState } from "react";
import { ArrowLeft, ChevronDown, ChevronRight } from "lucide-react";
import type {
  ToolbarActionButton as ToolbarActionButtonModel,
  ToolbarButton as ToolbarButtonModel,
  ToolbarFolderButton as ToolbarFolderButtonModel,
} from "@t3tools/contracts";

import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import { getToolbarIcon } from "./toolbarIcons";
import { preventPointerFocus } from "./toolbarDom";
import {
  popToolbarFolderPath,
  pushToolbarFolderPath,
  resolveToolbarFolderEscape,
  resolveToolbarFolderView,
} from "./toolbarFolderNav";

/**
 * A folder chip that opens ONE popover drilling down in place — a `path` of
 * the folders navigated into, with a back arrow and the current folder's
 * name in the header — rather than nested submenus. Ported from Arkadia's
 * `FolderToolbarButton` (`src/components/Toolbar.tsx:180-373`), rebuilt on
 * this repo's Base UI `~/components/ui/popover` instead of its manual
 * `getBoundingClientRect` positioning.
 */
interface ToolbarFolderButtonProps {
  button: ToolbarFolderButtonModel;
  onRunAction: (button: ToolbarActionButtonModel) => void;
  /**
   * Which side of the trigger the popover opens on. The top toolbar opens
   * downward (the default); the composer shortcut row (Task 6) sits at the
   * bottom of the screen and opens upward instead.
   */
  side?: "top" | "bottom";
  /**
   * The composer shortcut row (Task 6) sits right above a text field the
   * user is actively typing in — clicking a button (including a row inside
   * the open folder) must not steal its focus/caret. Unused by the top
   * toolbar, which has no field to protect.
   */
  preserveFocusOnPointerDown?: boolean;
  /**
   * Greys the trigger out and blocks it from opening — the composer
   * shortcut row (Task 6) uses this while the composer itself is disabled
   * (reconnecting, no project chosen yet) so the folder never sits there
   * looking clickable while silently doing nothing. Unused by the top
   * toolbar, which has no such disabled state.
   */
  disabled?: boolean;
}

export function ToolbarFolderButton({
  button,
  onRunAction,
  side = "bottom",
  preserveFocusOnPointerDown = false,
  disabled = false,
}: ToolbarFolderButtonProps) {
  const [open, setOpen] = useState(false);
  const [path, setPath] = useState<ToolbarFolderButtonModel[]>([]);
  const Icon = getToolbarIcon(button.icon);
  const showLabel = button.label.length > 0;
  const view = resolveToolbarFolderView(button, path);

  const closeAndReset = () => {
    setOpen(false);
    setPath([]);
  };

  const handleActionClick = (child: ToolbarActionButtonModel) => {
    onRunAction(child);
    closeAndReset();
  };

  const handleFolderClick = (child: ToolbarFolderButtonModel) => {
    setPath((current) => pushToolbarFolderPath(current, child));
  };

  const handleBack = () => {
    setPath((current) => popToolbarFolderPath(current));
  };

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen, eventDetails) => {
        // Escape pops one level while drilled into a subfolder, and only
        // closes the popover outright once already showing the root. Cancel
        // Base UI's own close-on-escape so we can decide which of the two
        // happens instead of always closing.
        if (!nextOpen && eventDetails.reason === "escape-key") {
          const escape = resolveToolbarFolderEscape(path);
          if (!escape.closes) {
            eventDetails.cancel();
            setPath(escape.path);
            return;
          }
        }
        setOpen(nextOpen);
        if (!nextOpen) {
          setPath([]);
        }
      }}
    >
      <PopoverTrigger
        className={`flex h-7 shrink-0 items-center gap-1 rounded border border-zinc-800 px-2 text-xs text-zinc-200 hover:border-zinc-700 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-zinc-800 disabled:hover:bg-zinc-900 [-webkit-app-region:no-drag] ${
          open ? "bg-zinc-800" : "bg-zinc-900"
        }`}
        title={`${button.label || "dossier"} (${button.children.length})`}
        onPointerDown={preserveFocusOnPointerDown ? preventPointerFocus : undefined}
        disabled={disabled}
      >
        {Icon && <Icon size={14} />}
        {showLabel && <span>{button.label}</span>}
        {!Icon && !showLabel && <span className="text-zinc-500">dossier</span>}
        <ChevronDown size={12} className="text-zinc-500" />
      </PopoverTrigger>
      <PopoverPopup
        side={side}
        align="start"
        className="w-max min-w-[140px] max-w-[360px] p-1"
        viewportClassName="p-0"
        tooltipStyle
      >
        {view.parentFolder && (
          <div className="mb-1 flex items-center gap-2 border-b border-border/70 px-1.5 pb-1">
            <button
              onClick={handleBack}
              onPointerDown={preserveFocusOnPointerDown ? preventPointerFocus : undefined}
              className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              title={`Revenir à ${view.parentFolder.label || "dossier"}`}
              type="button"
            >
              <ArrowLeft size={12} />
            </button>
            <span className="truncate text-[11px] text-muted-foreground">
              {view.currentFolder.label || "dossier"}
            </span>
          </div>
        )}
        {view.children.length === 0 ? (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">Dossier vide</div>
        ) : (
          view.children.map((child) => (
            <ToolbarFolderRow
              key={child.id}
              child={child}
              onRunAction={handleActionClick}
              onOpenFolder={handleFolderClick}
              preserveFocusOnPointerDown={preserveFocusOnPointerDown}
            />
          ))
        )}
      </PopoverPopup>
    </Popover>
  );
}

function ToolbarFolderRow({
  child,
  onRunAction,
  onOpenFolder,
  preserveFocusOnPointerDown,
}: {
  child: ToolbarButtonModel;
  onRunAction: (button: ToolbarActionButtonModel) => void;
  onOpenFolder: (button: ToolbarFolderButtonModel) => void;
  preserveFocusOnPointerDown: boolean;
}) {
  const ChildIcon = getToolbarIcon(child.icon);
  const onPointerDown = preserveFocusOnPointerDown ? preventPointerFocus : undefined;

  if (child.kind === "folder") {
    const label = child.label || "dossier";
    return (
      <button
        onClick={() => onOpenFolder(child)}
        onPointerDown={onPointerDown}
        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs text-foreground hover:bg-accent hover:text-accent-foreground"
        title={`${label} (${child.children.length})`}
        type="button"
      >
        {ChildIcon && <ChildIcon size={14} className="shrink-0" />}
        <span className="flex-1 truncate">{label}</span>
        <ChevronRight size={12} className="shrink-0 text-muted-foreground" />
      </button>
    );
  }

  const label = child.label || child.command || "sans nom";
  return (
    <button
      onClick={() => onRunAction(child)}
      onPointerDown={onPointerDown}
      className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs text-foreground hover:bg-accent hover:text-accent-foreground"
      title={child.command || label}
      type="button"
    >
      {ChildIcon && <ChildIcon size={14} className="shrink-0" />}
      <span className="truncate">{label}</span>
    </button>
  );
}

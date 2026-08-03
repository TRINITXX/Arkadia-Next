import { MoreHorizontalIcon } from "lucide-react";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type {
  ToolbarActionButton as ToolbarActionButtonModel,
  ToolbarButton as ToolbarButtonModel,
} from "@t3tools/contracts";

import { Button } from "~/components/ui/button";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "~/components/ui/menu";
import { ToolbarActionButton } from "./ToolbarActionButton";
import { ToolbarFolderButton } from "./ToolbarFolderButton";
import { sortedToolbarChildren } from "./toolbarFolderNav";
import { getToolbarIcon } from "./toolbarIcons";
import { resolveVisibleToolbarItemCount } from "./toolbarOverflow";

/** Tailwind `gap-1` on the strip, in pixels — the fitting maths needs a number. */
const TOOLBAR_STRIP_GAP = 4;

interface ToolbarButtonStripProps {
  /** Already sorted by `order`. */
  buttons: ReadonlyArray<ToolbarButtonModel>;
  onRunAction: (button: ToolbarActionButtonModel) => void;
}

/**
 * The customisable button row, with the chips that don't fit collected behind
 * a "…" menu instead of being clipped off the edge or pushed under a
 * scrollbar. Widths come from an invisible copy of the full row rendered in
 * the same styles: chip widths depend on label text and font metrics, so
 * measuring beats guessing, and the copy is unconstrained so each chip reports
 * its natural width even while the real row is squeezed.
 */
export function ToolbarButtonStrip({ buttons, onRunAction }: ToolbarButtonStripProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  // `null` until the first measurement lands: rendering everything is the
  // right guess for one pre-paint frame, and it keeps the row from flashing
  // empty on mount.
  const [visibleCount, setVisibleCount] = useState<number | null>(null);

  const remeasure = useCallback(() => {
    const container = containerRef.current;
    const measure = measureRef.current;
    if (!container || !measure) return;

    // The measurement row ends with a copy of the overflow trigger, so its
    // real width is measured rather than hardcoded (it differs by breakpoint).
    const children = Array.from(measure.children) as HTMLElement[];
    const triggerElement = children[children.length - 1];
    if (!triggerElement) return;
    const itemWidths = children.slice(0, -1).map((child) => child.getBoundingClientRect().width);

    setVisibleCount(
      resolveVisibleToolbarItemCount({
        itemWidths,
        availableWidth: container.clientWidth,
        gap: TOOLBAR_STRIP_GAP,
        overflowTriggerWidth: triggerElement.getBoundingClientRect().width,
      }),
    );
  }, []);

  useLayoutEffect(() => {
    remeasure();
    const container = containerRef.current;
    const measure = measureRef.current;
    if (!container || !measure) return;

    // The container resizes with the window and the sidebar; the measurement
    // row resizes when the buttons themselves change (settings edit, web font
    // finishing loading).
    const observer = new ResizeObserver(remeasure);
    observer.observe(container);
    observer.observe(measure);
    return () => observer.disconnect();
  }, [buttons, remeasure]);

  const visible = visibleCount === null ? buttons : buttons.slice(0, visibleCount);
  const overflow = visibleCount === null ? [] : buttons.slice(visibleCount);

  return (
    <div
      ref={containerRef}
      className="relative flex min-w-0 flex-1 items-center gap-1 overflow-hidden"
      data-toolbar-buttons=""
    >
      <div
        ref={measureRef}
        aria-hidden
        className="pointer-events-none invisible absolute top-0 left-0 flex items-center gap-1"
      >
        {buttons.map((button) => (
          <ToolbarChip key={button.id} button={button} onRunAction={onRunAction} />
        ))}
        <Button size="icon-xs" variant="ghost">
          <MoreHorizontalIcon />
        </Button>
      </div>

      {buttons.length === 0 && (
        <span className="truncate text-muted-foreground text-xs">Aucun bouton configuré</span>
      )}
      {visible.map((button) => (
        <ToolbarChip key={button.id} button={button} onRunAction={onRunAction} />
      ))}
      {overflow.length > 0 && (
        <Menu>
          <MenuTrigger
            render={
              <Button
                size="icon-xs"
                variant="ghost"
                className="[-webkit-app-region:no-drag]"
                aria-label={`${overflow.length} bouton(s) de plus`}
                title={`${overflow.length} bouton(s) de plus`}
              />
            }
          >
            <MoreHorizontalIcon />
          </MenuTrigger>
          <MenuPopup align="start" className="max-w-90">
            <ToolbarOverflowItems items={overflow} onRunAction={onRunAction} />
          </MenuPopup>
        </Menu>
      )}
    </div>
  );
}

function ToolbarChip({
  button,
  onRunAction,
}: {
  button: ToolbarButtonModel;
  onRunAction: (button: ToolbarActionButtonModel) => void;
}) {
  return button.kind === "folder" ? (
    <ToolbarFolderButton button={button} onRunAction={onRunAction} />
  ) : (
    <ToolbarActionButton button={button} onRun={onRunAction} />
  );
}

/**
 * The overflowed chips as menu rows. Folders become real submenus here rather
 * than the drill-down popover the inline chips use: inside an open menu,
 * nesting is what the surrounding control already does, and Base UI's submenu
 * handles the keyboard and hover timing for free.
 */
function ToolbarOverflowItems({
  items,
  onRunAction,
}: {
  items: ReadonlyArray<ToolbarButtonModel>;
  onRunAction: (button: ToolbarActionButtonModel) => void;
}) {
  return items.map((item) => {
    const Icon = getToolbarIcon(item.icon);

    if (item.kind === "folder") {
      const label = item.label || "dossier";
      const children = sortedToolbarChildren(item.children);
      return (
        <MenuSub key={item.id}>
          <MenuSubTrigger>
            {Icon && <Icon />}
            <span className="truncate">{label}</span>
          </MenuSubTrigger>
          <MenuSubPopup className="max-w-90">
            {children.length === 0 ? (
              <div className="px-2 py-1.5 text-muted-foreground text-sm">Dossier vide</div>
            ) : (
              <ToolbarOverflowItems items={children} onRunAction={onRunAction} />
            )}
          </MenuSubPopup>
        </MenuSub>
      );
    }

    const label = item.label || item.command || "sans nom";
    return (
      <MenuItem key={item.id} onClick={() => onRunAction(item)} title={item.command || label}>
        {Icon && <Icon />}
        <span className="truncate">{label}</span>
      </MenuItem>
    );
  });
}

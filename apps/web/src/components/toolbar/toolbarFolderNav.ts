import type { ToolbarButton, ToolbarFolderButton } from "@t3tools/contracts";

/**
 * Pure drill-down logic behind the folder popover's cascading navigation.
 * Ported from Arkadia's `FolderToolbarButton` (`src/components/Toolbar.tsx:192-278`),
 * which drives a single popover in place via a `path` of the folders drilled
 * into, rather than opening nested submenus. Kept dependency-free so it is
 * testable without mounting the popover.
 */

/** A folder's children, sorted by `order` ascending. Never mutates the input. */
export function sortedToolbarChildren(children: readonly ToolbarButton[]): ToolbarButton[] {
  return [...children].sort((a, b) => a.order - b.order);
}

export interface ToolbarFolderView {
  /** The folder currently displayed: the last entry of `path`, or `root` at the top. */
  readonly currentFolder: ToolbarFolderButton;
  /** One level up from `currentFolder`, or `null` when already showing `root`. */
  readonly parentFolder: ToolbarFolderButton | null;
  /** `currentFolder`'s children, sorted by `order`. */
  readonly children: ToolbarButton[];
}

/**
 * Resolves what the popover should currently show for a `root` folder button
 * and the drill-down `path` navigated so far. `path` holds only the folders
 * drilled into below `root` — `root` itself is never part of it, mirroring
 * `Toolbar.tsx:276-278`.
 */
export function resolveToolbarFolderView(
  root: ToolbarFolderButton,
  path: readonly ToolbarFolderButton[],
): ToolbarFolderView {
  const currentFolder = path.length > 0 ? path[path.length - 1]! : root;
  const parentFolder = path.length > 1 ? path[path.length - 2]! : path.length === 1 ? root : null;
  return {
    currentFolder,
    parentFolder,
    children: sortedToolbarChildren(currentFolder.children),
  };
}

/** Pops one level off the drill-down path — the back-arrow gesture. */
export function popToolbarFolderPath(path: readonly ToolbarFolderButton[]): ToolbarFolderButton[] {
  return path.slice(0, -1);
}

/** Pushes a folder onto the drill-down path — clicking a child folder row. */
export function pushToolbarFolderPath(
  path: readonly ToolbarFolderButton[],
  folder: ToolbarFolderButton,
): ToolbarFolderButton[] {
  return [...path, folder];
}

export interface ToolbarFolderEscapeResult {
  readonly path: ToolbarFolderButton[];
  /** True once Escape should close the popover outright (path was already at root). */
  readonly closes: boolean;
}

/** Escape pops one level; only closes the popover once already at the root. */
export function resolveToolbarFolderEscape(
  path: readonly ToolbarFolderButton[],
): ToolbarFolderEscapeResult {
  if (path.length === 0) return { path: [], closes: true };
  return { path: popToolbarFolderPath(path), closes: false };
}

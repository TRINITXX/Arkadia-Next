import { MAX_TOOLBAR_FOLDER_DEPTH, type ToolbarButton } from "@t3tools/contracts";
import { findItem, isDescendant, moveItem, subtreeHeight } from "./toolbarTree";

/**
 * Pure resolution of the toolbar editor's three drop targets and the tree
 * mutation each produces. Ported from Arkadia's inline `DropTarget` handling
 * (`ToolbarSettings.tsx:64-67` for the union, `:180-192` for the drop
 * dispatch, `:346-365` and `:470-480` for the per-row disabled checks) — kept
 * dependency-free (no `@dnd-kit` types) so it is testable without mounting
 * `DndContext`.
 */
export type ToolbarDropTarget =
  | { kind: "before"; itemId: string; parentId: string | null }
  | { kind: "into"; folderId: string }
  | { kind: "root-end" };

/** Applies a resolved drop to the tree, delegating to `moveItem` for every kind. */
export function applyToolbarDrop(
  buttons: readonly ToolbarButton[],
  sourceId: string,
  target: ToolbarDropTarget,
): readonly ToolbarButton[] {
  switch (target.kind) {
    case "before":
      return moveItem(buttons, sourceId, target.parentId, target.itemId);
    case "into":
      return moveItem(buttons, sourceId, target.folderId, null);
    case "root-end":
      return moveItem(buttons, sourceId, null, null);
  }
}

/** The `before` drop zone above `itemId` is inert without an active drag, or while dragging that row itself. */
export function isBeforeDropDisabled(activeDragId: string | null, itemId: string): boolean {
  return !activeDragId || activeDragId === itemId;
}

/** The trailing root drop zone is inert without an active drag. */
export function isRootEndDropDisabled(activeDragId: string | null): boolean {
  return !activeDragId;
}

/**
 * The `into` zone on a folder row is disabled whenever dropping there would
 * be a no-op, a cycle, or would push the dragged subtree's deepest leaf to or
 * past `MAX_TOOLBAR_FOLDER_DEPTH`. Mirrors Arkadia's `intoDisabled` +
 * `depthExceedsForInto`.
 */
export function isIntoDropDisabled(input: {
  buttons: readonly ToolbarButton[];
  folderId: string;
  activeDragId: string | null;
}): boolean {
  const { buttons, folderId, activeDragId } = input;
  if (!activeDragId || activeDragId === folderId) return true;

  const folder = findItem(buttons, folderId);
  if (!folder || folder.item.kind !== "folder") return true;

  // Dragging a folder onto one of its own descendants would create a cycle.
  if (isDescendant(buttons, activeDragId, folderId)) return true;
  // The dragged item is already somewhere inside this folder.
  if (isDescendant(buttons, folderId, activeDragId)) return true;

  const dragged = findItem(buttons, activeDragId);
  if (!dragged) return true;
  const folderDepth = folder.parents.length;
  return folderDepth + 1 + subtreeHeight(dragged.item) >= MAX_TOOLBAR_FOLDER_DEPTH;
}

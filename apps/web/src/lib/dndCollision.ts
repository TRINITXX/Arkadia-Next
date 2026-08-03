import { closestCorners, pointerWithin, type CollisionDetection } from "@dnd-kit/core";

/**
 * `pointerWithin` first, falling back to `closestCorners` when the pointer
 * isn't over any droppable. Plain `closestCenter` compares droppable centres
 * to the pointer/active-rect centre, so a thin "insert before" strip stacked
 * above a much taller row loses to the row almost everywhere inside it —
 * reordering within a level becomes nearly unhittable while dropping into a
 * folder works fine. Originated in `Sidebar.tsx`'s `projectCollisionDetection`
 * for the project tree's drag and drop; shared here since the toolbar
 * settings tree (`ToolbarSettingsPanel.tsx`) has the same thin-strip-over-row
 * shape and needs the same fix.
 */
export const pointerWithinCollisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  if (pointerCollisions.length > 0) {
    return pointerCollisions;
  }

  return closestCorners(args);
};

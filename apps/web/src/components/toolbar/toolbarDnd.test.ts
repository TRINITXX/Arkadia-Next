import type { ToolbarButton } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  applyToolbarDrop,
  isBeforeDropDisabled,
  isIntoDropDisabled,
  isRootEndDropDisabled,
} from "./toolbarDnd";

function action(id: string, order: number): ToolbarButton {
  return { id, kind: "action", label: id, icon: "play", command: id, order };
}

function folder(id: string, order: number, children: ToolbarButton[]): ToolbarButton {
  return { id, kind: "folder", label: id, icon: "folder", order, children };
}

/**
 * Mirrors the fixture shape in `toolbarTree.test.ts`: a three-level folder
 * (depths 0, 1, 2) plus an unrelated shallow branch.
 *
 * root-a, root-b (actions)
 * outer (folder, depth 0)
 *   inner (folder, depth 1)
 *     innermost (empty folder, depth 2 — cannot itself hold folders)
 *     leaf-1, leaf-2 (actions, depth 2)
 *   outer-action (action, depth 1)
 * shallow (folder, depth 0, unrelated to outer/inner)
 *   shallow-leaf (action, depth 1)
 */
function threeLevelFixture(): ToolbarButton[] {
  return [
    action("root-a", 0),
    action("root-b", 1),
    folder("outer", 2, [
      folder("inner", 0, [folder("innermost", 0, []), action("leaf-1", 1), action("leaf-2", 2)]),
      action("outer-action", 1),
    ]),
    folder("shallow", 3, [action("shallow-leaf", 0)]),
  ];
}

describe("applyToolbarDrop", () => {
  it("'before' moves the source in front of the target sibling", () => {
    const tree = threeLevelFixture();
    const moved = applyToolbarDrop(tree, "root-b", {
      kind: "before",
      itemId: "outer",
      parentId: null,
    });
    expect(moved.map((b) => b.id)).toEqual(["root-a", "root-b", "outer", "shallow"]);
  });

  it("'into' moves the source inside the target folder", () => {
    const tree = threeLevelFixture();
    const moved = applyToolbarDrop(tree, "root-b", { kind: "into", folderId: "outer" });
    const outer = moved.find((b) => b.id === "outer");
    expect(outer?.kind === "folder" ? outer.children.map((c) => c.id) : null).toEqual([
      "inner",
      "outer-action",
      "root-b",
    ]);
  });

  it("'root-end' moves a nested source back to the end of the root", () => {
    const tree = threeLevelFixture();
    const moved = applyToolbarDrop(tree, "outer-action", { kind: "root-end" });
    expect(moved.map((b) => b.id)).toEqual([
      "root-a",
      "root-b",
      "outer",
      "shallow",
      "outer-action",
    ]);
  });
});

describe("isBeforeDropDisabled", () => {
  it("is disabled with no active drag", () => {
    expect(isBeforeDropDisabled(null, "outer")).toBe(true);
  });

  it("is disabled for a row dragging over itself", () => {
    expect(isBeforeDropDisabled("outer", "outer")).toBe(true);
  });

  it("is enabled while dragging a different item", () => {
    expect(isBeforeDropDisabled("root-a", "outer")).toBe(false);
  });
});

describe("isRootEndDropDisabled", () => {
  it("is disabled with no active drag", () => {
    expect(isRootEndDropDisabled(null)).toBe(true);
  });

  it("is enabled while a drag is active", () => {
    expect(isRootEndDropDisabled("root-a")).toBe(false);
  });
});

describe("isIntoDropDisabled", () => {
  it("is disabled with no active drag", () => {
    const tree = threeLevelFixture();
    expect(isIntoDropDisabled({ buttons: tree, folderId: "outer", activeDragId: null })).toBe(true);
  });

  it("is disabled when the folder is the dragged row itself", () => {
    const tree = threeLevelFixture();
    expect(isIntoDropDisabled({ buttons: tree, folderId: "outer", activeDragId: "outer" })).toBe(
      true,
    );
  });

  it("is disabled when the target id is not a folder", () => {
    const tree = threeLevelFixture();
    expect(isIntoDropDisabled({ buttons: tree, folderId: "root-a", activeDragId: "root-b" })).toBe(
      true,
    );
  });

  it("is disabled when dropping a folder onto its own descendant (would cycle)", () => {
    const tree = threeLevelFixture();
    expect(isIntoDropDisabled({ buttons: tree, folderId: "inner", activeDragId: "outer" })).toBe(
      true,
    );
  });

  it("is disabled when the dragged item is already inside that folder", () => {
    const tree = threeLevelFixture();
    expect(
      isIntoDropDisabled({ buttons: tree, folderId: "outer", activeDragId: "outer-action" }),
    ).toBe(true);
  });

  it("is disabled when it would push the deepest leaf past MAX_TOOLBAR_FOLDER_DEPTH", () => {
    const tree = threeLevelFixture();
    // "outer" (height 2) into "shallow" (depth 0) lands the deepest leaf at
    // depth 0 + 1 + 2 = 3 == MAX_TOOLBAR_FOLDER_DEPTH: refused.
    expect(isIntoDropDisabled({ buttons: tree, folderId: "shallow", activeDragId: "outer" })).toBe(
      true,
    );
  });

  it("is enabled for a legitimate move that stays within depth and isn't a cycle", () => {
    const tree = threeLevelFixture();
    expect(
      isIntoDropDisabled({ buttons: tree, folderId: "inner", activeDragId: "shallow-leaf" }),
    ).toBe(false);
  });
});

import type { ToolbarButton } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  canAddFolder,
  countDescendants,
  createActionButton,
  createFolderButton,
  depthOf,
  findItem,
  insertItem,
  isDescendant,
  moveItem,
  reindexOrder,
  removeItem,
  subtreeHeight,
  updateItem,
} from "./toolbarTree";

function action(id: string, order: number): ToolbarButton {
  return { id, kind: "action", label: id, icon: "play", command: id, order };
}

function folder(id: string, order: number, children: ToolbarButton[]): ToolbarButton {
  return { id, kind: "folder", label: id, icon: "folder", order, children };
}

/**
 * A three-level fixture (folder depths 0, 1, 2) plus an unrelated shallow
 * branch, mirroring the shape of the real default toolbar tree:
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

describe("findItem / depthOf", () => {
  it("finds a root item at depth 0", () => {
    const tree = threeLevelFixture();
    const loc = findItem(tree, "root-a");
    expect(loc?.item.id).toBe("root-a");
    expect(loc?.parentId).toBeNull();
    expect(depthOf(tree, "root-a")).toBe(0);
  });

  it("finds a nested item and reports its depth", () => {
    const tree = threeLevelFixture();
    const loc = findItem(tree, "leaf-1");
    expect(loc?.item.id).toBe("leaf-1");
    expect(loc?.parentId).toBe("inner");
    expect(loc?.parents.map((p) => p.id)).toEqual(["outer", "inner"]);
    expect(depthOf(tree, "leaf-1")).toBe(2);
  });

  it("returns null / -1 for an id that does not exist", () => {
    const tree = threeLevelFixture();
    expect(findItem(tree, "missing")).toBeNull();
    expect(depthOf(tree, "missing")).toBe(-1);
  });
});

describe("subtreeHeight", () => {
  it("is 0 for an action and for an empty folder", () => {
    expect(subtreeHeight(action("a", 0))).toBe(0);
    expect(subtreeHeight(folder("empty", 0, []))).toBe(0);
  });

  it("counts the deepest nesting level below the node", () => {
    const tree = threeLevelFixture();
    const outer = findItem(tree, "outer")?.item;
    expect(outer).toBeDefined();
    // outer -> inner -> {innermost | leaf-1 | leaf-2} : two levels below "outer".
    expect(subtreeHeight(outer!)).toBe(2);
  });
});

describe("isDescendant", () => {
  it("is true for a child nested two levels down", () => {
    const tree = threeLevelFixture();
    expect(isDescendant(tree, "outer", "leaf-1")).toBe(true);
  });

  it("is false for unrelated items and for the node itself", () => {
    const tree = threeLevelFixture();
    expect(isDescendant(tree, "outer", "root-a")).toBe(false);
    expect(isDescendant(tree, "inner", "outer-action")).toBe(false);
    expect(isDescendant(tree, "outer", "shallow")).toBe(false);
  });

  it("is false when the ancestor id is an action, not a folder", () => {
    const tree = threeLevelFixture();
    expect(isDescendant(tree, "root-a", "root-b")).toBe(false);
  });
});

describe("removeItem + reindexOrder (dense reindexing after removal)", () => {
  it("removes a root item and closes the order gap", () => {
    const tree = threeLevelFixture();
    const withoutB = reindexOrder(removeItem(tree, "root-b"));
    expect(withoutB.map((b) => b.id)).toEqual(["root-a", "outer", "shallow"]);
    expect(withoutB.map((b) => b.order)).toEqual([0, 1, 2]);
  });

  it("removes a nested item and reindexes its remaining siblings", () => {
    const tree = threeLevelFixture();
    const withoutLeaf1 = reindexOrder(removeItem(tree, "leaf-1"));
    const inner = findItem(withoutLeaf1, "inner")?.item;
    expect(inner?.kind).toBe("folder");
    expect(inner?.kind === "folder" ? inner.children.map((c) => c.id) : null).toEqual([
      "innermost",
      "leaf-2",
    ]);
    expect(inner?.kind === "folder" ? inner.children.map((c) => c.order) : null).toEqual([0, 1]);
  });
});

describe("insertItem (reordering within a level)", () => {
  it("inserts before a given sibling at the root", () => {
    const tree = threeLevelFixture();
    const inserted = reindexOrder(insertItem(tree, null, "outer", action("new", 0)));
    expect(inserted.map((b) => b.id)).toEqual(["root-a", "root-b", "new", "outer", "shallow"]);
    expect(inserted.map((b) => b.order)).toEqual([0, 1, 2, 3, 4]);
  });

  it("appends to the end of a level when insertBeforeId is null", () => {
    const tree = threeLevelFixture();
    const inserted = reindexOrder(insertItem(tree, null, null, action("new", 0)));
    expect(inserted.map((b) => b.id)).toEqual(["root-a", "root-b", "outer", "shallow", "new"]);
  });

  it("inserts into a nested folder by parentId", () => {
    const tree = threeLevelFixture();
    const inserted = insertItem(tree, "inner", null, action("leaf-3", 0));
    const inner = findItem(inserted, "inner")?.item;
    expect(inner?.kind === "folder" ? inner.children.map((c) => c.id) : null).toEqual([
      "innermost",
      "leaf-1",
      "leaf-2",
      "leaf-3",
    ]);
  });
});

describe("moveItem", () => {
  it("moves a root action into a folder", () => {
    const tree = threeLevelFixture();
    const moved = reindexOrder(moveItem(tree, "root-b", "outer", null));
    expect(moved.map((b) => b.id)).toEqual(["root-a", "outer", "shallow"]);
    const outer = findItem(moved, "outer")?.item;
    expect(outer?.kind === "folder" ? outer.children.map((c) => c.id) : null).toEqual([
      "inner",
      "outer-action",
      "root-b",
    ]);
  });

  it("moves an item out of a folder back to the root", () => {
    const tree = threeLevelFixture();
    const moved = reindexOrder(moveItem(tree, "outer-action", null, null));
    expect(moved.map((b) => b.id)).toEqual([
      "root-a",
      "root-b",
      "outer",
      "shallow",
      "outer-action",
    ]);
    const outer = findItem(moved, "outer")?.item;
    expect(outer?.kind === "folder" ? outer.children.map((c) => c.id) : null).toEqual(["inner"]);
  });

  it("refuses to move a folder into its own descendant", () => {
    const tree = threeLevelFixture();
    const attempted = moveItem(tree, "outer", "inner", null);
    // Nothing changes: the source is still where it started.
    expect(attempted).toEqual(tree);
  });

  it("refuses to move a folder into itself", () => {
    const tree = threeLevelFixture();
    const attempted = moveItem(tree, "outer", "outer", null);
    expect(attempted).toEqual(tree);
  });

  it("refuses a move that would exceed the max folder depth, even with no descendant relation", () => {
    const tree = threeLevelFixture();
    // "outer" (height 2: outer -> inner -> leaves) is entirely unrelated to
    // "shallow" (depth 0). Moving it inside "shallow" would land its deepest
    // leaf at depth 0 + 1 + 2 = 3, at MAX_TOOLBAR_FOLDER_DEPTH (3) — refused
    // purely by the depth guard, not the descendant guard.
    expect(isDescendant(tree, "shallow", "outer")).toBe(false);
    const attempted = moveItem(tree, "outer", "shallow", null);
    expect(attempted).toEqual(tree);
  });

  it("allows a move that stays within the max folder depth", () => {
    const tree = threeLevelFixture();
    // Moving the plain action "outer-action" into "inner" (depth 1) lands the
    // leaf at depth 2, within MAX_TOOLBAR_FOLDER_DEPTH (3).
    const moved = moveItem(tree, "outer-action", "inner", null);
    const inner = findItem(moved, "inner")?.item;
    expect(inner?.kind === "folder" ? inner.children.map((c) => c.id) : null).toEqual([
      "innermost",
      "leaf-1",
      "leaf-2",
      "outer-action",
    ]);
  });
});

describe("canAddFolder", () => {
  it("allows a new folder at the root", () => {
    const tree = threeLevelFixture();
    expect(canAddFolder(tree, null)).toBe(true);
  });

  it("allows a new folder one level below the root", () => {
    const tree = threeLevelFixture();
    expect(canAddFolder(tree, "outer")).toBe(true);
  });

  it("allows a new folder two levels below the root", () => {
    const tree = threeLevelFixture();
    // "inner" sits at depth 1; a folder created inside it would be depth 2,
    // which is allowed (it just cannot itself hold further folders).
    expect(canAddFolder(tree, "inner")).toBe(true);
  });

  it("refuses a new folder at the max depth", () => {
    const tree = threeLevelFixture();
    // "innermost" sits at depth 2 == MAX_TOOLBAR_FOLDER_DEPTH - 1: it cannot
    // contain folders.
    expect(canAddFolder(tree, "innermost")).toBe(false);
  });
});

describe("updateItem", () => {
  it("patches fields by id without touching kind or id", () => {
    const tree = threeLevelFixture();
    const updated = updateItem(tree, "root-a", {
      label: "Renamed",
      id: "hacked",
      kind: "folder",
    } as never);
    const item = findItem(updated, "root-a")?.item;
    expect(item?.label).toBe("Renamed");
    expect(item?.id).toBe("root-a");
    expect(item?.kind).toBe("action");
  });

  it("patches a nested item in place", () => {
    const tree = threeLevelFixture();
    const updated = updateItem(tree, "leaf-2", { icon: "check" });
    const item = findItem(updated, "leaf-2")?.item;
    expect(item?.icon).toBe("check");
  });
});

describe("countDescendants (recursive descendant counting)", () => {
  it("is 0 for actions", () => {
    expect(countDescendants(action("a", 0))).toBe(0);
  });

  it("counts every nested descendant, not just direct children", () => {
    const tree = threeLevelFixture();
    const outer = findItem(tree, "outer")?.item;
    // outer has 2 direct children (inner, outer-action); inner has 3 direct
    // children (innermost, leaf-1, leaf-2) => 2 + 3 = 5 total descendants.
    expect(countDescendants(outer!)).toBe(5);
  });
});

describe("createActionButton / createFolderButton", () => {
  it("creates a fresh action button with a generated id", () => {
    const a = createActionButton();
    const b = createActionButton();
    expect(a.kind).toBe("action");
    expect(typeof a.id).toBe("string");
    expect(a.id.length).toBeGreaterThan(0);
    expect(a.id).not.toBe(b.id);
  });

  it("creates a fresh, empty folder button with a generated id", () => {
    const f = createFolderButton();
    expect(f.kind).toBe("folder");
    expect(f.children).toEqual([]);
    expect(typeof f.id).toBe("string");
    expect(f.id.length).toBeGreaterThan(0);
  });
});

import type { ToolbarButton, ToolbarFolderButton } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  popToolbarFolderPath,
  pushToolbarFolderPath,
  resolveToolbarFolderEscape,
  resolveToolbarFolderView,
  sortedToolbarChildren,
} from "./toolbarFolderNav";

function action(id: string, order: number): ToolbarButton {
  return { id, kind: "action", label: id, icon: "play", command: id, order };
}

function folder(id: string, order: number, children: ToolbarButton[]): ToolbarFolderButton {
  return { id, kind: "folder", label: id, icon: "folder", order, children };
}

/**
 * Mirrors the shape of the real default toolbar tree: a three-level folder
 * (depths 0, 1, 2) whose children are deliberately out of `order` so sorting
 * is actually exercised.
 *
 * root (folder, depth 0)
 *   ios (folder, depth 1)
 *     build (action, depth 2, order 1)
 *     update (action, depth 2, order 0)
 *   android (folder, depth 1)
 *     leaf (action, depth 2)
 */
function threeLevelFixture(): ToolbarFolderButton {
  return folder("root", 0, [
    folder("ios", 1, [action("build", 1), action("update", 0)]),
    folder("android", 0, [action("leaf", 0)]),
  ]);
}

describe("sortedToolbarChildren", () => {
  it("sorts by order ascending without mutating the input", () => {
    const children: ToolbarButton[] = [action("b", 1), action("a", 0)];
    const sorted = sortedToolbarChildren(children);
    expect(sorted.map((c) => c.id)).toEqual(["a", "b"]);
    expect(children.map((c) => c.id)).toEqual(["b", "a"]);
  });
});

describe("resolveToolbarFolderView", () => {
  it("shows the root folder's own children when path is empty, with no parent", () => {
    const root = threeLevelFixture();
    const view = resolveToolbarFolderView(root, []);
    expect(view.currentFolder.id).toBe("root");
    expect(view.parentFolder).toBeNull();
    // root's children are already in order (android=0, ios=1)
    expect(view.children.map((c) => c.id)).toEqual(["android", "ios"]);
  });

  it("one level down, shows that folder's children sorted, with root as parent", () => {
    const root = threeLevelFixture();
    const ios = (root.children as ToolbarButton[]).find((c) => c.id === "ios") as
      | ToolbarFolderButton
      | undefined;
    if (!ios) throw new Error("fixture missing ios folder");
    const view = resolveToolbarFolderView(root, [ios]);
    expect(view.currentFolder.id).toBe("ios");
    expect(view.parentFolder?.id).toBe("root");
    expect(view.children.map((c) => c.id)).toEqual(["update", "build"]);
  });

  it("two levels down, the immediate parent is the folder one level up, not root", () => {
    const root = threeLevelFixture();
    const ios = (root.children as ToolbarButton[]).find(
      (c) => c.id === "ios",
    ) as ToolbarFolderButton;
    const view = resolveToolbarFolderView(root, [ios]);
    expect(view.parentFolder?.id).toBe("root");
    // Simulate drilling one level further isn't reachable from this fixture
    // (ios's children are actions, not folders) — the two-level case is
    // covered structurally by resolveToolbarFolderView's own path[-2] logic,
    // exercised directly here.
    const fakeGrandchild = folder("inner", 0, []);
    const twoDeep = resolveToolbarFolderView(root, [ios, fakeGrandchild]);
    expect(twoDeep.currentFolder.id).toBe("inner");
    expect(twoDeep.parentFolder?.id).toBe("ios");
  });
});

describe("pushToolbarFolderPath / popToolbarFolderPath", () => {
  it("pushes a folder onto the path and pops it back off", () => {
    const ios = folder("ios", 0, []);
    const pushed = pushToolbarFolderPath([], ios);
    expect(pushed.map((f) => f.id)).toEqual(["ios"]);
    expect(popToolbarFolderPath(pushed)).toEqual([]);
  });
});

describe("resolveToolbarFolderEscape", () => {
  it("pops one level and does not close when drilled into a subfolder", () => {
    const ios = folder("ios", 0, []);
    const result = resolveToolbarFolderEscape([ios]);
    expect(result.closes).toBe(false);
    expect(result.path).toEqual([]);
  });

  it("closes once already at the root path", () => {
    const result = resolveToolbarFolderEscape([]);
    expect(result.closes).toBe(true);
    expect(result.path).toEqual([]);
  });
});

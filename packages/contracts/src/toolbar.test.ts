import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import {
  DEFAULT_PROMPT_BUTTONS,
  DEFAULT_TOOLBAR_BUTTONS,
  MAX_TOOLBAR_FOLDER_DEPTH,
  ToolbarButton,
  type ToolbarFolderButton,
} from "./toolbar.ts";

const decodeToolbarButton = Schema.decodeUnknownSync(ToolbarButton);
const encodeToolbarButton = Schema.encodeSync(ToolbarButton);

// A three-level fixture (root -> folder -> folder -> action) proving the
// self-referencing `Schema.suspend` for `children` actually decodes and
// re-encodes recursive folder nesting, not just a single level.
const threeLevelFixture = {
  id: "root-folder",
  kind: "folder" as const,
  label: "Root",
  icon: "folder",
  order: 0,
  children: [
    {
      id: "mid-folder",
      kind: "folder" as const,
      label: "Mid",
      icon: "folder",
      order: 0,
      children: [
        {
          id: "leaf-action",
          kind: "action" as const,
          label: "Leaf",
          icon: "play",
          command: "echo leaf",
          order: 0,
        },
      ],
    },
  ],
};

describe("ToolbarButton recursive schema", () => {
  it("decodes a three-level folder fixture", () => {
    const decoded = decodeToolbarButton(threeLevelFixture) as ToolbarFolderButton;
    expect(decoded.kind).toBe("folder");
    expect(decoded.children).toHaveLength(1);

    const mid = decoded.children[0] as ToolbarFolderButton;
    expect(mid.kind).toBe("folder");
    expect(mid.children).toHaveLength(1);

    const leaf = mid.children[0]!;
    expect(leaf.kind).toBe("action");
    expect(leaf.kind === "action" ? leaf.command : null).toBe("echo leaf");
  });

  it("re-encodes the three-level fixture back to its plain wire shape", () => {
    const decoded = decodeToolbarButton(threeLevelFixture);
    const encoded = encodeToolbarButton(decoded);
    expect(encoded).toEqual(threeLevelFixture);
  });

  it("decodes an action button with the optional submit flag", () => {
    const decoded = decodeToolbarButton({
      id: "a",
      kind: "action",
      label: "commit",
      icon: "check",
      command: "/commit",
      order: 0,
      submit: true,
    });
    expect(decoded.kind === "action" ? decoded.submit : undefined).toBe(true);
  });

  it("rejects a folder missing required fields", () => {
    expect(() =>
      decodeToolbarButton({ id: "x", kind: "folder", label: "x", icon: "folder", order: 0 }),
    ).toThrow();
  });
});

describe("MAX_TOOLBAR_FOLDER_DEPTH", () => {
  it("is 3, matching the source project's MAX_FOLDER_DEPTH", () => {
    expect(MAX_TOOLBAR_FOLDER_DEPTH).toBe(3);
  });
});

describe("Default toolbar buttons", () => {
  it("carries the 8 real toolbar roots with 3 folders nested two levels deep", () => {
    expect(DEFAULT_TOOLBAR_BUTTONS).toHaveLength(8);
    const folders = DEFAULT_TOOLBAR_BUTTONS.filter((b) => b.kind === "folder");
    expect(folders).toHaveLength(3);
    for (const f of folders) {
      expect(f.kind === "folder" ? f.children.every((c) => c.kind === "folder") : false).toBe(true);
    }
  });

  it("carries the 4 flat prompt actions", () => {
    expect(DEFAULT_PROMPT_BUTTONS).toHaveLength(4);
    expect(DEFAULT_PROMPT_BUTTONS.every((b) => b.kind === "action")).toBe(true);
    expect(DEFAULT_PROMPT_BUTTONS.map((b) => (b.kind === "action" ? b.command : null))).toEqual([
      "/commit",
      "/clear",
      "/compact",
      "/resume",
    ]);
  });

  it("decodes and re-encodes the full default tree without loss", () => {
    for (const button of [...DEFAULT_TOOLBAR_BUTTONS, ...DEFAULT_PROMPT_BUTTONS]) {
      const decoded = decodeToolbarButton(button);
      expect(encodeToolbarButton(decoded)).toEqual(button);
    }
  });
});

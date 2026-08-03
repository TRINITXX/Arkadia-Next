import { describe, expect, it } from "vite-plus/test";

import { insertComposerShortcutCommand } from "./composerShortcutInsertion";

describe("insertComposerShortcutCommand", () => {
  it("inserts into an empty composer and places the caret after the command", () => {
    const result = insertComposerShortcutCommand("", 0, 0, "/commit");
    expect(result).toEqual({ text: "/commit", cursor: 7 });
  });

  it("inserts at the caret without disturbing surrounding text", () => {
    // Caret sits right after "hello ", before "world".
    const result = insertComposerShortcutCommand("hello world", 6, 6, "/commit");
    expect(result).toEqual({ text: "hello /commitworld", cursor: 13 });
  });

  it("replaces a fully-selected range with the command", () => {
    const result = insertComposerShortcutCommand("hello world", 0, 11, "/commit");
    expect(result).toEqual({ text: "/commit", cursor: 7 });
  });

  it("replaces a partial selection in the middle of the text", () => {
    // "hello [world]" -> select "world" (6..11) and replace it.
    const result = insertComposerShortcutCommand("hello world", 6, 11, "/resume");
    expect(result).toEqual({ text: "hello /resume", cursor: 13 });
  });

  it("clamps a caret past the end of the text", () => {
    const result = insertComposerShortcutCommand("hi", 50, 50, "/clear");
    expect(result).toEqual({ text: "hi/clear", cursor: 8 });
  });

  it("clamps a negative selection start to zero", () => {
    const result = insertComposerShortcutCommand("hi", -5, 0, "/clear");
    expect(result).toEqual({ text: "/clearhi", cursor: 6 });
  });

  it("collapses an inverted selection to a zero-width insertion at the start index", () => {
    // start (11) > end (6): the end clamps up to the start, so nothing gets
    // replaced and the command lands at the (clamped) start position.
    const result = insertComposerShortcutCommand("hello world", 11, 6, "/resume");
    expect(result).toEqual({ text: "hello world/resume", cursor: 18 });
  });

  it("inserting an empty command at an empty composer is a no-op", () => {
    const result = insertComposerShortcutCommand("", 0, 0, "");
    expect(result).toEqual({ text: "", cursor: 0 });
  });
});

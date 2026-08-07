import { assert, describe, it } from "@effect/vitest";

import { DICTATION_HOTKEY, systemHotkeyCommand } from "./systemHotkey.ts";

describe("systemHotkeyCommand", () => {
  it("presses the dictation shortcut through SendKeys on Windows", () => {
    const command = systemHotkeyCommand("win32", DICTATION_HOTKEY);
    assert.isNotNull(command);
    assert.strictEqual(command.command, "powershell.exe");
    assert.include(command.args.at(-1), "SendWait('^+{F8}')");
  });

  it("presses the dictation shortcut through System Events on macOS", () => {
    const command = systemHotkeyCommand("darwin", DICTATION_HOTKEY);
    assert.isNotNull(command);
    assert.strictEqual(command.command, "osascript");
    assert.strictEqual(
      command.args.at(-1),
      'tell application "System Events" to key code 100 using {control down, shift down}',
    );
  });

  it("presses the dictation shortcut through xdotool on Linux", () => {
    const command = systemHotkeyCommand("linux", DICTATION_HOTKEY);
    assert.isNotNull(command);
    assert.deepStrictEqual(
      { command: command.command, args: [...command.args] },
      { command: "xdotool", args: ["key", "ctrl+shift+F8"] },
    );
  });

  it("renders every requested modifier", () => {
    const hotkey = { control: true, shift: true, alt: true, key: "F12" } as const;
    assert.include(systemHotkeyCommand("win32", hotkey)?.args.at(-1), "SendWait('^+%{F12}')");
    assert.include(systemHotkeyCommand("darwin", hotkey)?.args.at(-1), "key code 111 using {");
    assert.deepStrictEqual(
      [...(systemHotkeyCommand("linux", hotkey)?.args ?? [])],
      ["key", "ctrl+shift+alt+F12"],
    );
  });

  it("refuses a key it cannot name on every platform", () => {
    const hotkey = { control: true, shift: true, alt: false, key: "A" } as const;
    assert.isNull(systemHotkeyCommand("win32", hotkey));
    assert.isNull(systemHotkeyCommand("darwin", hotkey));
    assert.isNull(systemHotkeyCommand("linux", hotkey));
  });

  it("has no injection path on other platforms", () => {
    assert.isNull(systemHotkeyCommand("freebsd", DICTATION_HOTKEY));
  });
});

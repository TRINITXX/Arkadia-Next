/**
 * Synthesizes a *system-wide* keyboard shortcut so the renderer can hand a
 * gesture over to whatever tool the user has bound to that shortcut. Electron
 * can only listen for global shortcuts, never emit them, so each platform is
 * driven through the OS scripting host that can inject input.
 *
 * Injected input reaches globally registered hotkeys (RegisterHotKey on
 * Windows, System Events on macOS, the X server on Linux), which is exactly
 * what a third-party dictation tool listens on.
 */

export interface SystemHotkey {
  readonly control: boolean;
  readonly shift: boolean;
  readonly alt: boolean;
  /** Function key name, `F1` through `F12`. */
  readonly key: string;
}

export interface SystemHotkeyCommand {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
}

/**
 * The shortcut the composer's dictation button fires instead of running the
 * built-in dictation: the user's own dictation tool is bound to it.
 */
export const DICTATION_HOTKEY: SystemHotkey = {
  control: true,
  shift: true,
  alt: false,
  key: "F8",
};

// `key code` is the only reliable way to press a function key through System
// Events — `keystroke` cannot name them.
const MACOS_FUNCTION_KEY_CODES: Readonly<Record<string, number>> = {
  F1: 122,
  F2: 120,
  F3: 99,
  F4: 118,
  F5: 96,
  F6: 97,
  F7: 98,
  F8: 100,
  F9: 101,
  F10: 109,
  F11: 103,
  F12: 111,
};

function isSupportedFunctionKey(key: string): boolean {
  return Object.hasOwn(MACOS_FUNCTION_KEY_CODES, key);
}

// SendKeys notation: `^` control, `+` shift, `%` alt, braces around a named key.
function toSendKeysNotation(hotkey: SystemHotkey): string {
  const modifiers = `${hotkey.control ? "^" : ""}${hotkey.shift ? "+" : ""}${hotkey.alt ? "%" : ""}`;
  return `${modifiers}{${hotkey.key}}`;
}

function toAppleScriptModifiers(hotkey: SystemHotkey): string {
  const modifiers = [
    ...(hotkey.control ? ["control down"] : []),
    ...(hotkey.shift ? ["shift down"] : []),
    ...(hotkey.alt ? ["option down"] : []),
  ];
  return modifiers.length === 0 ? "" : ` using {${modifiers.join(", ")}}`;
}

function toXdotoolNotation(hotkey: SystemHotkey): string {
  return [
    ...(hotkey.control ? ["ctrl"] : []),
    ...(hotkey.shift ? ["shift"] : []),
    ...(hotkey.alt ? ["alt"] : []),
    hotkey.key,
  ].join("+");
}

/**
 * Builds the command that presses `hotkey`, or `null` when the platform has no
 * injection path we can rely on without a native dependency.
 */
export function systemHotkeyCommand(
  platform: NodeJS.Platform,
  hotkey: SystemHotkey,
): SystemHotkeyCommand | null {
  if (!isSupportedFunctionKey(hotkey.key)) {
    return null;
  }

  if (platform === "win32") {
    return {
      command: "powershell.exe",
      args: [
        "-NoProfile",
        "-NonInteractive",
        "-WindowStyle",
        "Hidden",
        "-Command",
        `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${toSendKeysNotation(hotkey)}')`,
      ],
    };
  }

  if (platform === "darwin") {
    const keyCode = MACOS_FUNCTION_KEY_CODES[hotkey.key];
    return {
      command: "osascript",
      args: [
        "-e",
        `tell application "System Events" to key code ${String(keyCode)}${toAppleScriptModifiers(hotkey)}`,
      ],
    };
  }

  if (platform === "linux") {
    return { command: "xdotool", args: ["key", toXdotoolNotation(hotkey)] };
  }

  return null;
}

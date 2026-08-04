import type { ContentPaletteId, CustomContentPalette } from "@t3tools/contracts/settings";

/**
 * A content-theme palette. Ported from Arkadia (`src/lib/palettes.ts`), reduced
 * to background/foreground: only those (plus a derived cursor) are applied to the
 * agent thread and terminal. The 16 ANSI colors are resolved inside the ghostty
 * WASM and cannot be swapped from JS, so they are intentionally not modeled here.
 */
export interface ContentPalette {
  readonly id: ContentPaletteId;
  readonly name: string;
  /** Hex background applied to the agent-thread + terminal surface. */
  readonly bg: string;
  /** Hex foreground (text) applied to the same surface. */
  readonly fg: string;
}

const PALETTE_WEZ: ContentPalette = { id: "wez", name: "Wez", bg: "#0a0a0a", fg: "#fafafa" };

export const CONTENT_PALETTES: readonly ContentPalette[] = [
  PALETTE_WEZ,
  { id: "wezterm", name: "WezTerm", bg: "#181a1d", fg: "#fafafa" },
  { id: "dracula", name: "Dracula", bg: "#282a36", fg: "#f8f8f2" },
  { id: "solarized-dark", name: "Solarized Dark", bg: "#002b36", fg: "#839496" },
  { id: "tokyo-night", name: "Tokyo Night", bg: "#1a1b26", fg: "#c0caf5" },
  // "Arkadia-Next actuel": the app's own dark surface (neutral-950 / neutral-100).
  // Consumers treat this id as "follow the app theme" and clear their overrides.
  { id: "arkadia", name: "Arkadia-Next actuel", bg: "#0a0a0a", fg: "#f5f5f5" },
];

export const DEFAULT_CONTENT_PALETTE: ContentPalette = PALETTE_WEZ;

/**
 * Resolves the palette in effect. "custom" materializes the user's editable
 * bg/fg. Unknown ids fall back to Wez. "arkadia" resolves to its preview colors;
 * the consumer decides to clear overrides for it (native theme).
 */
export function resolveContentPalette(
  id: ContentPaletteId,
  custom: CustomContentPalette,
): ContentPalette {
  if (id === "custom") {
    return { id: "custom", name: "Custom", bg: custom.bg, fg: custom.fg };
  }
  return CONTENT_PALETTES.find((palette) => palette.id === id) ?? DEFAULT_CONTENT_PALETTE;
}

/** True when the palette should defer to the app's own light/dark tokens. */
export function isNativeContentPalette(id: ContentPaletteId): boolean {
  return id === "arkadia";
}

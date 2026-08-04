import {
  DEFAULT_AGENT_FONT_FAMILY,
  DEFAULT_TERMINAL_FONT_FAMILY,
} from "@t3tools/contracts/settings";

/** A curated, embedded font choice. `value` is a CSS `font-family` stack. */
export interface FontOption {
  readonly label: string;
  readonly value: string;
}

/**
 * Monospace families offered for the terminal. The first entry mirrors the
 * default (Maple Mono NF → Maple Mono → Cascadia Code). Maple Mono and Cascadia
 * Code are bundled via `@fontsource`; the rest fall back to system fonts.
 */
export const TERMINAL_FONT_OPTIONS: readonly FontOption[] = [
  { label: "Maple Mono", value: DEFAULT_TERMINAL_FONT_FAMILY },
  { label: "Cascadia Code", value: '"Cascadia Code", Consolas, "Courier New", monospace' },
  { label: "JetBrains Mono", value: '"JetBrains Mono", Consolas, monospace' },
  { label: "Consolas", value: 'Consolas, "Courier New", monospace' },
  { label: "Courier New", value: '"Courier New", monospace' },
];

/**
 * Sans-serif families offered for the agent thread. The first entry mirrors the
 * default (DM Sans). Inter is bundled via `@fontsource`.
 */
export const AGENT_FONT_OPTIONS: readonly FontOption[] = [
  { label: "DM Sans", value: DEFAULT_AGENT_FONT_FAMILY },
  { label: "Inter", value: '"Inter Variable", "Inter", system-ui, sans-serif' },
  {
    label: "Système",
    value: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
];

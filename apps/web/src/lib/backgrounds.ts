import type { ChromeBackgroundId } from "@t3tools/contracts/settings";

/**
 * A selectable chrome-background preset, ported from Arkadia
 * (`src/lib/backgrounds.ts`). `css` is a full CSS `background` value — a radial
 * "halo" layered over a dark linear gradient. `glass` engages the frosted-glass
 * treatment on the chrome surfaces. "Noir" keeps the current opaque look. The
 * gradients are dark by design and are applied in dark mode only.
 */
export interface ChromeBackground {
  readonly id: ChromeBackgroundId;
  readonly name: string;
  readonly css: string;
  readonly glass: boolean;
}

const BG_NOIR: ChromeBackground = { id: "noir", name: "Noir", css: "#0a0a0a", glass: false };

export const CHROME_BACKGROUNDS: readonly ChromeBackground[] = [
  BG_NOIR,
  {
    id: "midnight",
    name: "Bleu nuit",
    css: "radial-gradient(130% 90% at 85% 0%, rgba(90,130,220,0.22), transparent 60%), linear-gradient(180deg, #1c2740 0%, #0d1220 100%)",
    glass: true,
  },
  {
    id: "slate",
    name: "Ardoise",
    css: "radial-gradient(130% 90% at 85% 0%, rgba(120,150,190,0.18), transparent 60%), linear-gradient(180deg, #263243 0%, #12161f 100%)",
    glass: true,
  },
  {
    id: "graphite",
    name: "Graphite",
    css: "radial-gradient(130% 90% at 85% 0%, rgba(140,160,190,0.12), transparent 60%), linear-gradient(180deg, #232a35 0%, #101216 100%)",
    glass: true,
  },
  {
    id: "ocean",
    name: "Océan",
    css: "radial-gradient(130% 90% at 85% 0%, rgba(60,170,190,0.20), transparent 60%), linear-gradient(180deg, #123642 0%, #08171c 100%)",
    glass: true,
  },
  {
    id: "violet",
    name: "Violet nuit",
    css: "radial-gradient(130% 90% at 85% 0%, rgba(150,110,220,0.20), transparent 60%), linear-gradient(180deg, #2a2140 0%, #140f22 100%)",
    glass: true,
  },
  {
    id: "forest",
    name: "Forêt",
    css: "radial-gradient(130% 90% at 85% 0%, rgba(80,180,120,0.16), transparent 60%), linear-gradient(180deg, #1b3327 0%, #0c1712 100%)",
    glass: true,
  },
  {
    id: "bordeaux",
    name: "Bordeaux",
    css: "radial-gradient(130% 90% at 85% 0%, rgba(210,90,120,0.16), transparent 60%), linear-gradient(180deg, #331d26 0%, #1a0f14 100%)",
    glass: true,
  },
];

export const DEFAULT_CHROME_BACKGROUND: ChromeBackground = BG_NOIR;

/** Returns the preset for an id, falling back to "noir". */
export function resolveChromeBackground(id: ChromeBackgroundId): ChromeBackground {
  return CHROME_BACKGROUNDS.find((background) => background.id === id) ?? DEFAULT_CHROME_BACKGROUND;
}

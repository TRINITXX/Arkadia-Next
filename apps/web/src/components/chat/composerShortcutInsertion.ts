import { replaceTextRange } from "../../composer-logic";

/**
 * Result of inserting a composer shortcut button's command into the
 * composer: the resulting text, and where the caret should land afterwards.
 */
export interface ComposerShortcutInsertion {
  readonly text: string;
  readonly cursor: number;
}

/**
 * Computes the composer text and caret position after inserting `command`
 * over the given selection. `selectionStart === selectionEnd` is a plain
 * caret insertion (what the composer shortcut row actually wires up — see
 * `ChatComposer.tsx`, which only ever exposes a single collapsed cursor, not
 * a real anchor/focus selection); a wider range replaces the selected text,
 * mirroring how a native text input behaves. Out-of-range indices are
 * clamped to the text's bounds.
 *
 * Delegates to `replaceTextRange` (`../../composer-logic`) — the same
 * primitive every other caret-aware insertion in the composer already uses
 * (slash commands, file mentions, terminal contexts) — so this module stays
 * a thin, single-purpose, independently testable name for what the shortcut
 * row does with it, without a second implementation to drift out of sync.
 */
export function insertComposerShortcutCommand(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  command: string,
): ComposerShortcutInsertion {
  return replaceTextRange(text, selectionStart, selectionEnd, command);
}

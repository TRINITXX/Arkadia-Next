import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Hands the dictation gesture over to the user's own dictation tool by pressing
 * its global shortcut through the desktop shell. Nothing comes back from that
 * tool, so the on/off state is ours alone: each press flips it, exactly like
 * the shortcut does when typed by hand.
 */
export interface UseSystemDictationHotkey {
  /** False in the browser, or on a desktop shell that predates the bridge call. */
  readonly available: boolean;
  readonly active: boolean;
  readonly toggle: () => void;
}

export interface UseSystemDictationHotkeyOptions {
  readonly onError?: ((message: string) => void) | undefined;
}

const UNAVAILABLE_MESSAGE =
  "Le raccourci de dictée n'a pas pu être envoyé au système. Vérifiez que votre outil de dictée est lancé.";

export const useSystemDictationHotkey = ({
  onError,
}: UseSystemDictationHotkeyOptions = {}): UseSystemDictationHotkey => {
  const [active, setActive] = useState(false);
  const activeRef = useRef(false);

  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  const setActiveState = useCallback((next: boolean) => {
    activeRef.current = next;
    setActive(next);
  }, []);

  const toggle = useCallback(() => {
    const press = window.desktopBridge?.pressDictationHotkey;
    if (press === undefined) return;

    // The shortcut is fire-and-forget: assume it landed so the button reacts
    // instantly, and roll back only if the shell reports it never got sent.
    const next = !activeRef.current;
    setActiveState(next);
    void press().then(
      (pressed) => {
        if (pressed) return;
        setActiveState(false);
        onErrorRef.current?.(UNAVAILABLE_MESSAGE);
      },
      (error: unknown) => {
        setActiveState(false);
        onErrorRef.current?.(error instanceof Error ? error.message : UNAVAILABLE_MESSAGE);
      },
    );
  }, [setActiveState]);

  return {
    available: typeof window.desktopBridge?.pressDictationHotkey === "function",
    active,
    toggle,
  };
};

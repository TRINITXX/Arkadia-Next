import { useCallback, useEffect, useRef, useState } from "react";
import type { EnvironmentId } from "@t3tools/contracts";

import { voiceEnvironment } from "../state/voice";
import { useAtomCommand } from "../state/use-atom-command";
import {
  ARM_DELAY_MS,
  type DictationAction,
  type DictationEvent,
  type DictationState,
  dictationReducer,
  initialDictationState,
  isBusy,
  isCapturing,
} from "./dictationMachine";
import {
  type MicrophoneCaptureHandle,
  MicrophonePermissionError,
  startMicrophoneCapture,
} from "./microphoneCapture";

const encodeFrame = (frame: Uint8Array): string => {
  let binary = "";
  // `String.fromCharCode(...frame)` dépasse la pile sur de grosses trames.
  for (const byte of frame) binary += String.fromCharCode(byte);
  return btoa(binary);
};

export interface UseDictationOptions {
  readonly environmentId: EnvironmentId;
  /** Appelé pour chaque énoncé figé, qui remplace la prévisualisation. */
  readonly onTranscript: (text: string) => void;
  /** Appelé à chaque mise à jour de l'énoncé en cours, pour l'afficher en direct. */
  readonly onPreview?: ((text: string) => void) | undefined;
  /** Appelé à l'annulation, pour retirer l'énoncé jamais figé. */
  readonly onDiscardPreview?: (() => void) | undefined;
  /**
   * Efface l'espace saisi juste avant que le geste ne soit reconnu comme un
   * appui maintenu. Sans lui, dicter au milieu d'un texte laisserait un blanc.
   */
  readonly onRemoveTypedSpace?: (() => void) | undefined;
  readonly onError?: ((message: string) => void) | undefined;
}

export interface UseDictation {
  readonly state: DictationState;
  /** Identifie la session ouverte, ou `null` au repos. */
  readonly sessionId: string | null;
  readonly recording: boolean;
  readonly busy: boolean;
  /** Texte en cours de dictée, tant qu'il n'est pas figé. */
  readonly partial: string;
  readonly send: (event: DictationEvent) => void;
  readonly toggle: () => void;
  readonly cancel: () => void;
}

export const useDictation = ({
  environmentId,
  onTranscript,
  onPreview,
  onDiscardPreview,
  onRemoveTypedSpace,
  onError,
}: UseDictationOptions): UseDictation => {
  const [state, setState] = useState<DictationState>(initialDictationState);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const stateRef = useRef<DictationState>(initialDictationState);
  const sessionIdRef = useRef<string | null>(null);
  const sessionCounterRef = useRef(0);
  const captureRef = useRef<MicrophoneCaptureHandle | null>(null);
  const armTimerRef = useRef<number | null>(null);

  const appendAudio = useAtomCommand(voiceEnvironment.appendAudio, { reportFailure: false });
  const stopSession = useAtomCommand(voiceEnvironment.stop, { reportFailure: false });

  const callbacksRef = useRef({
    onTranscript,
    onPreview,
    onDiscardPreview,
    onRemoveTypedSpace,
    onError,
  });
  useEffect(() => {
    callbacksRef.current = {
      onTranscript,
      onPreview,
      onDiscardPreview,
      onRemoveTypedSpace,
      onError,
    };
  }, [onTranscript, onPreview, onDiscardPreview, onRemoveTypedSpace, onError]);

  /**
   * Les effets de la machine sont exécutés à travers cette référence : `send`
   * reste ainsi stable pour les écouteurs clavier, sans dépendre de leur code.
   */
  const runActionRef = useRef<(action: DictationAction) => void>(() => undefined);

  const clearArmTimer = useCallback(() => {
    if (armTimerRef.current !== null) {
      window.clearTimeout(armTimerRef.current);
      armTimerRef.current = null;
    }
  }, []);

  /**
   * Applique un évènement puis exécute immédiatement les effets décidés. Les
   * effets sont décrits par la machine (testée à part) et exécutés ici.
   */
  const send = useCallback((event: DictationEvent) => {
    const { state: next, actions } = dictationReducer(stateRef.current, event);
    stateRef.current = next;
    setState(next);

    for (const action of actions) runActionRef.current(action);
  }, []);

  const runAction = useCallback(
    (action: DictationAction): void => {
      switch (action.type) {
        case "startArmTimer":
          clearArmTimer();
          armTimerRef.current = window.setTimeout(() => {
            armTimerRef.current = null;
            send({ type: "armElapsed" });
          }, ARM_DELAY_MS);
          break;

        case "cancelArmTimer":
          clearArmTimer();
          break;

        case "startCapture": {
          sessionCounterRef.current += 1;
          const id = `voice-${String(sessionCounterRef.current)}-${String(Math.trunc(performance.now()))}`;
          sessionIdRef.current = id;
          setSessionId(id);

          void startMicrophoneCapture({
            onFrame: (frame) => {
              // Une session déjà refermée ne doit plus rien pousser.
              if (sessionIdRef.current !== id) return;
              void appendAudio({
                environmentId,
                input: { sessionId: id, audio: encodeFrame(frame) },
              });
            },
            onError: (error) => send({ type: "failed", message: error.message }),
          })
            .then((handle) => {
              if (sessionIdRef.current !== id) {
                void handle.abort();
                return;
              }
              captureRef.current = handle;
            })
            .catch((error: unknown) => {
              send({
                type: "failed",
                message:
                  error instanceof MicrophonePermissionError
                    ? "Micro indisponible — vérifiez l'autorisation du microphone."
                    : error instanceof Error
                      ? error.message
                      : String(error),
              });
            });
          break;
        }

        case "stopCapture": {
          const id = sessionIdRef.current;
          const capture = captureRef.current;
          captureRef.current = null;
          void (capture?.stop() ?? Promise.resolve()).then(() => {
            if (id !== null) void stopSession({ environmentId, input: { sessionId: id } });
          });
          break;
        }

        case "abortCapture": {
          const id = sessionIdRef.current;
          sessionIdRef.current = null;
          setSessionId(null);
          const capture = captureRef.current;
          captureRef.current = null;
          void (capture?.abort() ?? Promise.resolve()).then(() => {
            if (id !== null) {
              void stopSession({ environmentId, input: { sessionId: id, discard: true } });
            }
          });
          break;
        }

        case "previewText":
          callbacksRef.current.onPreview?.(action.text);
          break;

        case "discardPreview":
          callbacksRef.current.onDiscardPreview?.();
          break;

        case "removeTypedSpace":
          callbacksRef.current.onRemoveTypedSpace?.();
          break;

        case "commitText":
          callbacksRef.current.onTranscript(action.text);
          break;
      }
    },
    [appendAudio, clearArmTimer, environmentId, stopSession],
  );

  useEffect(() => {
    runActionRef.current = runAction;
  }, [runAction]);

  // La session serveur se referme quand la machine revient au repos.
  useEffect(() => {
    if (state.kind === "idle" || state.kind === "error") {
      sessionIdRef.current = null;
      setSessionId(null);
    }
  }, [state.kind]);

  // Le micro ne doit jamais survivre au démontage du composeur.
  useEffect(
    () => () => {
      if (armTimerRef.current !== null) window.clearTimeout(armTimerRef.current);
      void captureRef.current?.abort();
      captureRef.current = null;
    },
    [],
  );

  const toggle = useCallback(() => send({ type: "buttonToggled" }), []);
  const cancel = useCallback(() => send({ type: "cancelled" }), []);

  return {
    state,
    sessionId,
    recording: isCapturing(state),
    busy: isBusy(state),
    partial: state.kind === "recording" || state.kind === "finishing" ? state.partial : "",
    send,
    toggle,
    cancel,
  };
};

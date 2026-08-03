/**
 * Capture du micro et production de trames PCM prêtes pour le service de dictée.
 *
 * On passe par un AudioWorklet plutôt que par `createScriptProcessor` (déprécié,
 * et qui tourne sur le thread principal) : le worklet reçoit les blocs audio sur
 * un thread dédié et les renvoie tels quels, la conversion se faisant ici.
 */
import workletUrl from "./microphoneTapWorklet.js?url";

import { downmixToMono, FrameBuffer, resampleMono, TARGET_SAMPLE_RATE } from "./audioEncoding";

export interface MicrophoneCaptureHandle {
  /** Ferme le micro en vidant le reliquat audio (fin normale d'un énoncé). */
  readonly stop: () => Promise<void>;
  /** Ferme le micro en jetant le reliquat (annulation). */
  readonly abort: () => Promise<void>;
}

export interface MicrophoneCaptureOptions {
  readonly onFrame: (frame: Uint8Array) => void;
  readonly onError?: (error: Error) => void;
}

export class MicrophonePermissionError extends Error {
  constructor(cause: unknown) {
    super("Microphone access was denied or unavailable.");
    this.name = "MicrophonePermissionError";
    this.cause = cause;
  }
}

export const startMicrophoneCapture = async ({
  onFrame,
  onError,
}: MicrophoneCaptureOptions): Promise<MicrophoneCaptureHandle> => {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  } catch (error) {
    throw new MicrophonePermissionError(error);
  }

  const context = new AudioContext();
  const buffer = new FrameBuffer();
  let closed = false;

  const teardown = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    for (const track of stream.getTracks()) track.stop();
    await context.close().catch(() => undefined);
  };

  try {
    await context.audioWorklet.addModule(workletUrl);
  } catch (error) {
    await teardown();
    throw error instanceof Error ? error : new Error(String(error));
  }

  const source = context.createMediaStreamSource(stream);
  const tap = new AudioWorkletNode(context, "microphone-tap");

  tap.port.addEventListener("message", (event: MessageEvent<Float32Array[]>) => {
    if (closed) return;
    try {
      const mono = downmixToMono(event.data);
      const resampled = resampleMono(mono, context.sampleRate, TARGET_SAMPLE_RATE);
      for (const frame of buffer.push(resampled)) onFrame(frame);
    } catch (error) {
      onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  });
  // Un port ne délivre ses messages qu'une fois démarré ; `onmessage` le faisait
  // implicitement, pas `addEventListener`.
  tap.port.start();

  source.connect(tap);
  // Un worklet non connecté à une destination n'est pas cadencé par tous les
  // navigateurs ; un gain muet le garde vivant sans rien faire entendre.
  const silence = context.createGain();
  silence.gain.value = 0;
  tap.connect(silence).connect(context.destination);

  return {
    stop: async () => {
      const tail = buffer.flush();
      if (tail && !closed) onFrame(tail);
      await teardown();
    },
    abort: teardown,
  };
};

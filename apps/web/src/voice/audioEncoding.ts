/**
 * Conversion du flux micro vers le format attendu par le service de dictée :
 * PCM signé 16 bits, little-endian, 16 kHz, mono ("linear16").
 *
 * Le navigateur capture à la fréquence de la carte son (typiquement 44,1 ou
 * 48 kHz) en flottants entre -1 et 1. Ces fonctions sont pures pour rester
 * testables hors d'un contexte audio.
 */

export const TARGET_SAMPLE_RATE = 16_000;

/** Durée d'une trame envoyée au serveur. Le service découpe les énoncés sur
 * une horloge réelle : envoyer plus vite que le temps réel tronque la fin. */
export const FRAME_DURATION_MS = 100;

export const FRAME_SAMPLE_COUNT = (TARGET_SAMPLE_RATE * FRAME_DURATION_MS) / 1000;

/**
 * Rééchantillonne un bloc mono par interpolation linéaire. Suffisant pour de la
 * voix : le bruit d'interpolation reste sous le plancher de bruit du micro.
 */
export const resampleMono = (
  input: Float32Array,
  inputRate: number,
  outputRate: number = TARGET_SAMPLE_RATE,
): Float32Array => {
  if (inputRate === outputRate || input.length === 0) return input;

  const ratio = inputRate / outputRate;
  const outputLength = Math.floor(input.length / ratio);
  const output = new Float32Array(outputLength);

  for (let i = 0; i < outputLength; i += 1) {
    const position = i * ratio;
    const left = Math.floor(position);
    const right = Math.min(left + 1, input.length - 1);
    const weight = position - left;
    output[i] = (input[left] ?? 0) * (1 - weight) + (input[right] ?? 0) * weight;
  }

  return output;
};

/**
 * Convertit des échantillons flottants en PCM 16 bits little-endian.
 * Les valeurs hors [-1, 1] sont écrêtées plutôt que repliées, pour éviter
 * qu'une saturation ne devienne un craquement.
 */
export const floatToPcm16 = (input: Float32Array): Uint8Array => {
  const output = new Uint8Array(input.length * 2);
  const view = new DataView(output.buffer);

  for (let i = 0; i < input.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, input[i] ?? 0));
    // -32768 et 32767 ne sont pas symétriques : on borne le positif pour ne
    // pas déborder sur la valeur négative extrême.
    const sample = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    view.setInt16(i * 2, Math.round(sample), true);
  }

  return output;
};

/** Réduit un signal multicanal entrelacé à un seul canal en moyennant. */
export const downmixToMono = (channels: readonly Float32Array[]): Float32Array => {
  const first = channels[0];
  if (!first) return new Float32Array(0);
  if (channels.length === 1) return first;

  const output = new Float32Array(first.length);
  for (let i = 0; i < first.length; i += 1) {
    let sum = 0;
    for (const channel of channels) sum += channel[i] ?? 0;
    output[i] = sum / channels.length;
  }
  return output;
};

/**
 * Accumule les échantillons rééchantillonnés et ne relâche que des trames
 * pleines : le service refuse les trames de taille erratique et l'endpointing
 * suppose une cadence régulière.
 */
export class FrameBuffer {
  #pending: number[] = [];

  constructor(private readonly frameSampleCount: number = FRAME_SAMPLE_COUNT) {}

  push(samples: Float32Array): Uint8Array[] {
    for (const sample of samples) this.#pending.push(sample);

    const frames: Uint8Array[] = [];
    while (this.#pending.length >= this.frameSampleCount) {
      const chunk = this.#pending.splice(0, this.frameSampleCount);
      frames.push(floatToPcm16(Float32Array.from(chunk)));
    }
    return frames;
  }

  /** Vide le reliquat en complétant la dernière trame par du silence. */
  flush(): Uint8Array | null {
    if (this.#pending.length === 0) return null;
    const padded = new Float32Array(this.frameSampleCount);
    padded.set(this.#pending.slice(0, this.frameSampleCount));
    this.#pending = [];
    return floatToPcm16(padded);
  }
}

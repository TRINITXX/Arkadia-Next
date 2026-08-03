import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";

/**
 * Dictée vocale. Le navigateur capture le micro et pousse des trames PCM au
 * serveur, qui relaie vers le service de transcription et renvoie le texte au
 * fil de l'eau.
 *
 * Le transport RPC est du JSON : l'audio voyage donc en base64. Une trame de
 * 100 ms fait 3200 octets, soit ~4,3 Ko encodés, à raison de dix par seconde.
 */

/** Fréquence d'échantillonnage attendue par le service, en hertz. */
export const VOICE_SAMPLE_RATE = 16_000;

/** Durée d'une trame audio, en millisecondes. */
export const VOICE_FRAME_DURATION_MS = 100;

/** Marge large autour des ~4,3 Ko d'une trame nominale. */
const VOICE_AUDIO_CHUNK_MAX_LENGTH = 65_536;

const VoiceSessionIdSchema = TrimmedNonEmptyString.check(Schema.isMaxLength(128));

/** Chaque prise de parole est une session, ouverte puis close par le client. */
export const VoiceSessionInput = Schema.Struct({
  sessionId: VoiceSessionIdSchema,
});
export type VoiceSessionInput = Schema.Codec.Encoded<typeof VoiceSessionInput>;

export const VoiceStartInput = Schema.Struct({
  ...VoiceSessionInput.fields,
  /**
   * Langue attendue, en code ISO 639-1. Absente, le service retombe sur
   * l'anglais — on envoie donc toujours la langue de l'interface.
   */
  language: Schema.optional(Schema.String.check(Schema.isMaxLength(16))),
  /**
   * Vocabulaire à privilégier : noms du projet, termes techniques. Le service
   * peut l'ignorer selon la langue, mais le coût d'envoi est nul.
   */
  keyterms: Schema.optional(
    Schema.Array(Schema.String.check(Schema.isMaxLength(64))).check(Schema.isMaxLength(64)),
  ),
});
export type VoiceStartInput = Schema.Codec.Encoded<typeof VoiceStartInput>;

export const VoiceAppendAudioInput = Schema.Struct({
  ...VoiceSessionInput.fields,
  /** Trame PCM signée 16 bits, little-endian, 16 kHz mono, encodée en base64. */
  audio: Schema.String.check(Schema.isNonEmpty()).check(
    Schema.isMaxLength(VOICE_AUDIO_CHUNK_MAX_LENGTH),
  ),
});
export type VoiceAppendAudioInput = Schema.Codec.Encoded<typeof VoiceAppendAudioInput>;

export const VoiceStopInput = Schema.Struct({
  ...VoiceSessionInput.fields,
  /**
   * Vrai quand l'utilisateur annule : le serveur ferme sans attendre le texte
   * restant, et le client jette ce qu'il avait reçu.
   */
  discard: Schema.optional(Schema.Boolean),
});
export type VoiceStopInput = Schema.Codec.Encoded<typeof VoiceStopInput>;

/** Le service a accepté la connexion : le micro peut s'ouvrir. */
const VoiceReadyEvent = Schema.Struct({
  type: Schema.Literal("ready"),
});

/** Transcription encore susceptible de changer. */
const VoicePartialEvent = Schema.Struct({
  type: Schema.Literal("partial"),
  text: Schema.String,
});

/** Fin d'énoncé : le texte est figé et peut être inséré dans le composeur. */
const VoiceFinalEvent = Schema.Struct({
  type: Schema.Literal("final"),
  text: Schema.String,
});

const VoiceClosedEvent = Schema.Struct({
  type: Schema.Literal("closed"),
});

const VoiceErrorEvent = Schema.Struct({
  type: Schema.Literal("error"),
  message: Schema.String.check(Schema.isNonEmpty()),
  /**
   * Distingue ce que l'utilisateur peut corriger (se reconnecter à Claude) de ce
   * qui relève de la panne passagère.
   */
  recoverable: Schema.Boolean,
});

export const VoiceTranscriptEvent = Schema.Union([
  VoiceReadyEvent,
  VoicePartialEvent,
  VoiceFinalEvent,
  VoiceClosedEvent,
  VoiceErrorEvent,
]);
export type VoiceTranscriptEvent = typeof VoiceTranscriptEvent.Type;

export class VoiceUnauthenticatedError extends Schema.TaggedErrorClass<VoiceUnauthenticatedError>()(
  "VoiceUnauthenticatedError",
  {
    detail: Schema.String,
  },
) {}

export class VoiceSessionNotFoundError extends Schema.TaggedErrorClass<VoiceSessionNotFoundError>()(
  "VoiceSessionNotFoundError",
  {
    sessionId: Schema.String,
  },
) {}

export class VoiceStreamError extends Schema.TaggedErrorClass<VoiceStreamError>()(
  "VoiceStreamError",
  {
    detail: Schema.String,
  },
) {}

export const VoiceError = Schema.Union([
  VoiceUnauthenticatedError,
  VoiceSessionNotFoundError,
  VoiceStreamError,
]);
export type VoiceError = typeof VoiceError.Type;

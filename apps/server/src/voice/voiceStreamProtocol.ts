/**
 * Protocole du flux de dictée de Claude Code.
 *
 * Non documenté publiquement : reconstitué depuis le client officiel. Les
 * fonctions pures sont isolées ici pour être testables sans réseau, et pour que
 * toute dérive du service se corrige en un seul endroit.
 */
import type { VoiceTranscriptEvent } from "@t3tools/contracts";

const VOICE_STREAM_PATH = "/api/ws/speech_to_text/voice_stream";

/** Le service accepte 1024 caractères de vocabulaire, séparés par des virgules. */
const KEYTERMS_MAX_LENGTH = 1024;

export const KEEP_ALIVE_MESSAGE = '{"type":"KeepAlive"}';
export const CLOSE_STREAM_MESSAGE = '{"type":"CloseStream"}';

/** Le service coupe une connexion muette : on la maintient en vie plus souvent. */
export const KEEP_ALIVE_INTERVAL_MS = 8_000;

export interface VoiceStreamUrlOptions {
  readonly baseApiUrl: string;
  readonly language?: string | undefined;
}

/**
 * Construit l'adresse du flux. Le service raisonne en temps d'horloge pour
 * découper les énoncés : `endpointing_ms` fixe le silence qui clôt une phrase.
 */
export const buildVoiceStreamUrl = ({ baseApiUrl, language }: VoiceStreamUrlOptions): string => {
  const origin = baseApiUrl.replace(/^https:\/\//, "wss://").replace(/^http:\/\//, "ws://");
  const params = new URLSearchParams({
    encoding: "linear16",
    sample_rate: "16000",
    channels: "1",
    endpointing_ms: "300",
    utterance_end_ms: "1000",
    language: language && language.length > 0 ? language : "en",
    use_conversation_engine: "true",
    forward_interims: "typed",
    stt_provider: "deepgram-nova3",
  });
  return `${origin.replace(/\/$/, "")}${VOICE_STREAM_PATH}?${params.toString()}`;
};

/**
 * Met le vocabulaire au format attendu : pas de virgule (c'est le séparateur),
 * pas de caractère non imprimable (l'en-tête HTTP ne transporte que de l'ASCII),
 * pas de doublon, et une longueur bornée.
 */
export const formatKeyterms = (terms: readonly string[]): string => {
  const seen = new Set<string>();
  const kept: string[] = [];
  let length = 0;

  for (const term of terms) {
    const cleaned = term
      .replace(/,/g, " ")
      .replace(/[^\x20-\x7E]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (cleaned.length === 0 || seen.has(cleaned)) continue;

    const added = cleaned.length + (kept.length > 0 ? 1 : 0);
    if (length + added > KEYTERMS_MAX_LENGTH) break;

    seen.add(cleaned);
    kept.push(cleaned);
    length += added;
  }

  return kept.join(",");
};

export const buildVoiceStreamHeaders = (
  accessToken: string,
  keyterms: readonly string[] = [],
): Record<string, string> => {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "x-app": "cli",
    "anthropic-client-platform": "cli",
  };
  const formatted = formatKeyterms(keyterms);
  if (formatted.length > 0) headers["x-config-keyterms"] = formatted;
  return headers;
};

/**
 * Traduit un message du service en évènement de notre contrat.
 *
 * Le service envoie le texte complet de l'énoncé en cours à chaque mise à jour,
 * pas un delta. `TranscriptEndpoint` clôt l'énoncé sans porter de texte : c'est
 * l'appelant qui promeut le dernier partiel connu en résultat final.
 */
export type VoiceStreamMessage =
  | { readonly kind: "partial"; readonly text: string }
  | { readonly kind: "endpoint" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "ignored" };

export const parseVoiceStreamMessage = (raw: string): VoiceStreamMessage => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: "ignored" };
  }
  if (typeof parsed !== "object" || parsed === null) return { kind: "ignored" };

  const message = parsed as { type?: unknown; data?: unknown };
  switch (message.type) {
    case "TranscriptInterim":
    case "TranscriptText":
      return typeof message.data === "string" && message.data.length > 0
        ? { kind: "partial", text: message.data }
        : { kind: "ignored" };
    case "TranscriptEndpoint":
      return { kind: "endpoint" };
    case "TranscriptError":
    case "error":
      return {
        kind: "error",
        message: typeof message.data === "string" ? message.data : "Unknown transcription error.",
      };
    default:
      return { kind: "ignored" };
  }
};

/** Le service ferme avec 1008 quand le jeton est refusé — cas rattrapable par l'utilisateur. */
export const isAuthorizationCloseCode = (code: number): boolean => code === 1008;

export const transcriptEventForClose = (code: number, reason: string): VoiceTranscriptEvent =>
  code === 1000
    ? { type: "closed" }
    : {
        type: "error",
        message: isAuthorizationCloseCode(code)
          ? "Claude refused the dictation session. Run `claude` once to refresh your login."
          : `Dictation stream closed unexpectedly (code ${code}${reason ? `: ${reason}` : ""}).`,
        recoverable: isAuthorizationCloseCode(code),
      };

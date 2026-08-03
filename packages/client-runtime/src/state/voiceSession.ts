import type { VoiceTranscriptEvent } from "@t3tools/contracts";

/**
 * État d'une session de dictée, reconstruit à partir du flux d'évènements.
 *
 * Le service renvoie le texte complet de l'énoncé en cours à chaque mise à jour,
 * puis le fige. On garde donc séparément la phrase en train de s'écrire et les
 * phrases déjà arrêtées : seules ces dernières partent dans le composeur.
 */
export interface VoiceSessionState {
  /** Le service a accepté la connexion : le micro peut s'ouvrir. */
  readonly ready: boolean;
  /** Énoncé en cours, encore susceptible de changer. */
  readonly partial: string;
  /** Énoncés figés, dans l'ordre, pas encore remis au composeur. */
  readonly finals: readonly string[];
  readonly error: string | null;
  readonly recoverable: boolean;
  readonly closed: boolean;
}

export const EMPTY_VOICE_SESSION_STATE: VoiceSessionState = {
  ready: false,
  partial: "",
  finals: [],
  error: null,
  recoverable: false,
  closed: false,
};

export const applyVoiceTranscriptEvent = (
  state: VoiceSessionState,
  event: VoiceTranscriptEvent,
): VoiceSessionState => {
  switch (event.type) {
    case "ready":
      return { ...state, ready: true, error: null };
    case "partial":
      return { ...state, partial: event.text };
    case "final": {
      const text = event.text.trim();
      // Le partiel repart de zéro : la phrase suivante ne doit pas hériter
      // du texte déjà validé.
      return text.length === 0
        ? { ...state, partial: "" }
        : { ...state, partial: "", finals: [...state.finals, text] };
    }
    case "closed":
      return { ...state, closed: true, ready: false };
    case "error":
      return {
        ...state,
        error: event.message,
        recoverable: event.recoverable,
        ready: false,
      };
  }
};

/** Texte prêt à être inséré, une fois les énoncés figés recollés. */
export const voiceTranscriptText = (state: VoiceSessionState): string => state.finals.join(" ");

/** Ce que l'utilisateur voit pendant qu'il parle : le figé plus l'en-cours. */
export const voiceDisplayText = (state: VoiceSessionState): string =>
  [...state.finals, state.partial].filter((part) => part.length > 0).join(" ");

/**
 * Machine d'états du push-to-talk.
 *
 * Maintenir la barre d'espace arme la dictée après un court délai, la relâcher
 * l'arrête. Le geste vaut aussi bien sur un composeur vide qu'au milieu d'un
 * texte déjà commencé.
 *
 * La frappe normale n'est jamais retardée : le premier espace s'insère comme
 * d'habitude. Ce sont les répétitions du clavier qui sont retenues, et si
 * l'appui va jusqu'au bout, l'unique espace déjà saisi est retiré au moment où
 * l'enregistrement démarre. Un composeur vide n'a rien à nettoyer, puisqu'un
 * espace en tête n'y est jamais inséré.
 */

export const ARM_DELAY_MS = 1000;

export type DictationState =
  /** Au repos. */
  | { readonly kind: "idle" }
  /**
   * Espace enfoncé, on attend de savoir si c'est un appui maintenu.
   * `spaceTyped` retient qu'un espace a réellement été inséré dans le texte et
   * qu'il faudra l'effacer si la dictée démarre.
   */
  | { readonly kind: "arming"; readonly spaceTyped: boolean }
  /** Micro ouvert, audio en cours d'envoi. */
  | { readonly kind: "recording"; readonly partial: string }
  /** Micro fermé, on attend le texte final du service. */
  | { readonly kind: "finishing"; readonly partial: string }
  | { readonly kind: "error"; readonly message: string };

export type DictationEvent =
  | { readonly type: "spaceDown"; readonly composerEmpty: boolean }
  | { readonly type: "spaceUp" }
  | { readonly type: "armElapsed" }
  | { readonly type: "buttonToggled" }
  | { readonly type: "partial"; readonly text: string }
  | { readonly type: "finalized" }
  | { readonly type: "cancelled" }
  | { readonly type: "failed"; readonly message: string };

export type DictationAction =
  /** Démarrer le minuteur d'armement. */
  | { readonly type: "startArmTimer" }
  | { readonly type: "cancelArmTimer" }
  /** Effacer l'espace saisi avant que le geste ne soit reconnu. */
  | { readonly type: "removeTypedSpace" }
  /** Afficher l'énoncé en cours, encore susceptible de changer. */
  | { readonly type: "previewText"; readonly text: string }
  /** Retirer du composeur l'énoncé en cours, jamais figé. */
  | { readonly type: "discardPreview" }
  | { readonly type: "startCapture" }
  /** Fermer le micro mais laisser le service finir sa phrase. */
  | { readonly type: "stopCapture" }
  /** Fermer le micro et jeter ce qui a été dit. */
  | { readonly type: "abortCapture" }
  | { readonly type: "commitText"; readonly text: string };

export interface DictationTransition {
  readonly state: DictationState;
  readonly actions: readonly DictationAction[];
}

export const initialDictationState: DictationState = { kind: "idle" };

const stay = (state: DictationState): DictationTransition => ({ state, actions: [] });

/** Le geste espace vaut tant qu'on n'attend pas déjà la fin d'une transcription. */
export const spaceGestureApplies = (state: DictationState): boolean =>
  state.kind === "idle" || state.kind === "arming" || state.kind === "recording";

export const dictationReducer = (
  state: DictationState,
  event: DictationEvent,
): DictationTransition => {
  switch (event.type) {
    case "spaceDown": {
      // L'auto-répétition du clavier renvoie des spaceDown : ne pas ré-armer.
      if (state.kind !== "idle") return stay(state);
      return {
        // Sur un composeur vide l'espace n'est pas inséré : rien à effacer.
        state: { kind: "arming", spaceTyped: !event.composerEmpty },
        actions: [{ type: "startArmTimer" }],
      };
    }

    case "armElapsed": {
      if (state.kind !== "arming") return stay(state);
      const actions: DictationAction[] = state.spaceTyped
        ? [{ type: "removeTypedSpace" }, { type: "startCapture" }]
        : [{ type: "startCapture" }];
      return { state: { kind: "recording", partial: "" }, actions };
    }

    case "spaceUp": {
      if (state.kind === "arming") {
        // Appui bref : ni dictée, ni espace inséré.
        return { state: { kind: "idle" }, actions: [{ type: "cancelArmTimer" }] };
      }
      if (state.kind === "recording") {
        return {
          state: { kind: "finishing", partial: state.partial },
          actions: [{ type: "stopCapture" }],
        };
      }
      return stay(state);
    }

    case "buttonToggled": {
      if (state.kind === "idle" || state.kind === "error") {
        return { state: { kind: "recording", partial: "" }, actions: [{ type: "startCapture" }] };
      }
      if (state.kind === "arming") {
        return { state: { kind: "idle" }, actions: [{ type: "cancelArmTimer" }] };
      }
      if (state.kind === "recording") {
        return {
          state: { kind: "finishing", partial: state.partial },
          actions: [{ type: "stopCapture" }],
        };
      }
      return stay(state);
    }

    case "partial": {
      if (state.kind !== "recording" && state.kind !== "finishing") return stay(state);
      if (state.partial === event.text) return stay(state);
      return {
        state: { kind: state.kind, partial: event.text },
        actions: [{ type: "previewText", text: event.text }],
      };
    }

    case "finalized": {
      if (state.kind !== "recording" && state.kind !== "finishing") return stay(state);
      const text = state.partial.trim();
      const actions: DictationAction[] = text.length > 0 ? [{ type: "commitText", text }] : [];
      // Le service clôt un énoncé sur chaque silence. Si le micro est encore
      // ouvert, on repart pour la phrase suivante au lieu de tout arrêter.
      return {
        state: state.kind === "finishing" ? { kind: "idle" } : { kind: "recording", partial: "" },
        actions,
      };
    }

    case "cancelled": {
      if (state.kind === "idle") return stay(state);
      const actions: DictationAction[] =
        state.kind === "arming"
          ? [{ type: "cancelArmTimer" }]
          : // Annuler doit aussi retirer du composeur ce qui n'a pas été figé.
            [{ type: "discardPreview" }, { type: "abortCapture" }];
      return { state: { kind: "idle" }, actions };
    }

    case "failed": {
      const actions: DictationAction[] =
        state.kind === "arming"
          ? [{ type: "cancelArmTimer" }]
          : state.kind === "recording" || state.kind === "finishing"
            ? [{ type: "abortCapture" }]
            : [];
      return { state: { kind: "error", message: event.message }, actions };
    }
  }
};

/** Le micro est-il ouvert dans cet état ? Pilote l'indicateur d'enregistrement. */
export const isCapturing = (state: DictationState): boolean => state.kind === "recording";

/** Un travail est-il en cours ? Pilote l'état actif du bouton. */
export const isBusy = (state: DictationState): boolean =>
  state.kind === "arming" || state.kind === "recording" || state.kind === "finishing";

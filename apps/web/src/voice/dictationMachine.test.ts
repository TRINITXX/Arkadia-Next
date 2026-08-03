import { describe, expect, it } from "vite-plus/test";

import {
  type DictationEvent,
  type DictationState,
  dictationReducer,
  initialDictationState,
  isBusy,
  isCapturing,
  spaceGestureApplies,
} from "./dictationMachine";

/** Rejoue une suite d'évènements et retourne l'état final avec toutes les actions. */
const run = (events: readonly DictationEvent[], from: DictationState = initialDictationState) => {
  let state = from;
  const actions: string[] = [];
  for (const event of events) {
    const transition = dictationReducer(state, event);
    state = transition.state;
    for (const action of transition.actions) actions.push(action.type);
  }
  return { state, actions };
};

const holdSpace = (): DictationEvent[] => [
  { type: "spaceDown", composerEmpty: true },
  { type: "armElapsed" },
];

describe("geste de la barre d'espace", () => {
  it("arme puis enregistre quand l'espace est maintenu sur un composeur vide", () => {
    const { state, actions } = run(holdSpace());
    expect(state.kind).toBe("recording");
    expect(actions).toEqual(["startArmTimer", "startCapture"]);
  });

  it("enregistre aussi quand le composeur contient déjà du texte", () => {
    const { state } = run([{ type: "spaceDown", composerEmpty: false }, { type: "armElapsed" }]);
    expect(state.kind).toBe("recording");
  });

  it("efface l'espace saisi avant d'ouvrir le micro sur un composeur non vide", () => {
    const { actions } = run([{ type: "spaceDown", composerEmpty: false }, { type: "armElapsed" }]);
    expect(actions).toEqual(["startArmTimer", "removeTypedSpace", "startCapture"]);
  });

  it("n'efface rien sur un composeur vide, où aucun espace n'a été inséré", () => {
    expect(run(holdSpace()).actions).not.toContain("removeTypedSpace");
  });

  it("laisse l'espace en place quand l'appui est trop bref sur un composeur non vide", () => {
    const { state, actions } = run([
      { type: "spaceDown", composerEmpty: false },
      { type: "spaceUp" },
    ]);
    expect(state.kind).toBe("idle");
    expect(actions).toEqual(["startArmTimer", "cancelArmTimer"]);
  });

  it("annule sans enregistrer si l'espace est relâché trop tôt", () => {
    const { state, actions } = run([
      { type: "spaceDown", composerEmpty: true },
      { type: "spaceUp" },
    ]);
    expect(state.kind).toBe("idle");
    expect(actions).toEqual(["startArmTimer", "cancelArmTimer"]);
  });

  it("ignore l'auto-répétition du clavier pendant l'armement", () => {
    const { actions } = run([
      { type: "spaceDown", composerEmpty: true },
      { type: "spaceDown", composerEmpty: true },
      { type: "spaceDown", composerEmpty: true },
    ]);
    expect(actions).toEqual(["startArmTimer"]);
  });

  it("ignore l'auto-répétition pendant l'enregistrement", () => {
    const { state, actions } = run([...holdSpace(), { type: "spaceDown", composerEmpty: true }]);
    expect(state.kind).toBe("recording");
    expect(actions).toEqual(["startArmTimer", "startCapture"]);
  });

  it("ferme le micro au relâchement et attend le texte final", () => {
    const { state, actions } = run([...holdSpace(), { type: "spaceUp" }]);
    expect(state.kind).toBe("finishing");
    expect(actions.at(-1)).toBe("stopCapture");
  });
});

describe("texte transcrit", () => {
  it("garde le dernier partiel et le valide à la fin", () => {
    const { state, actions } = run([
      ...holdSpace(),
      { type: "partial", text: "Bonjour" },
      { type: "partial", text: "Bonjour tout le monde" },
      { type: "spaceUp" },
      { type: "finalized" },
    ]);
    expect(state.kind).toBe("idle");
    expect(actions).toContain("commitText");
  });

  it("transmet le texte nettoyé au composeur", () => {
    const { actions } = dictationReducer(
      { kind: "finishing", partial: "  du texte dicté  " },
      { type: "finalized" },
    );
    expect(actions).toEqual([{ type: "commitText", text: "du texte dicté" }]);
  });

  it("ne valide rien quand rien n'a été dit", () => {
    const { state, actions } = run([...holdSpace(), { type: "spaceUp" }, { type: "finalized" }]);
    expect(state.kind).toBe("idle");
    expect(actions).not.toContain("commitText");
  });

  it("enchaîne les phrases sans fermer le micro", () => {
    const { state, actions } = run([
      ...holdSpace(),
      { type: "partial", text: "Première phrase." },
      { type: "finalized" },
      { type: "partial", text: "Deuxième phrase." },
    ]);
    expect(state).toEqual({ kind: "recording", partial: "Deuxième phrase." });
    expect(actions.filter((action) => action === "commitText").length).toBe(1);
  });

  it("ignore un partiel reçu hors enregistrement", () => {
    expect(run([{ type: "partial", text: "perdu" }]).state.kind).toBe("idle");
  });

  it("demande l'affichage de chaque mise à jour pendant qu'on parle", () => {
    const { actions } = run([
      ...holdSpace(),
      { type: "partial", text: "Bon" },
      { type: "partial", text: "Bonjour" },
    ]);
    expect(actions.filter((action) => action === "previewText").length).toBe(2);
  });

  it("ne réaffiche pas un partiel identique au précédent", () => {
    const { actions } = run([
      ...holdSpace(),
      { type: "partial", text: "Bonjour" },
      { type: "partial", text: "Bonjour" },
    ]);
    expect(actions.filter((action) => action === "previewText").length).toBe(1);
  });

  it("affiche le texte avant même le relâchement", () => {
    const { actions } = dictationReducer(
      { kind: "recording", partial: "" },
      { type: "partial", text: "en direct" },
    );
    expect(actions).toEqual([{ type: "previewText", text: "en direct" }]);
  });
});

describe("bouton micro", () => {
  it("démarre depuis le repos, quel que soit le contenu du composeur", () => {
    const { state, actions } = run([{ type: "buttonToggled" }]);
    expect(state.kind).toBe("recording");
    expect(actions).toEqual(["startCapture"]);
  });

  it("arrête un enregistrement en cours", () => {
    expect(run([{ type: "buttonToggled" }, { type: "buttonToggled" }]).state.kind).toBe(
      "finishing",
    );
  });

  it("permet de repartir après une erreur", () => {
    const { state } = run([{ type: "failed", message: "micro refusé" }, { type: "buttonToggled" }]);
    expect(state.kind).toBe("recording");
  });
});

describe("annulation et erreurs", () => {
  it("jette l'audio à l'annulation pendant l'enregistrement", () => {
    const { state, actions } = run([...holdSpace(), { type: "cancelled" }]);
    expect(state.kind).toBe("idle");
    expect(actions.at(-1)).toBe("abortCapture");
  });

  it("retire du composeur le texte jamais figé quand on annule", () => {
    const { actions } = run([
      ...holdSpace(),
      { type: "partial", text: "à jeter" },
      { type: "cancelled" },
    ]);
    expect(actions).toContain("discardPreview");
    expect(actions.indexOf("discardPreview")).toBeLessThan(actions.indexOf("abortCapture"));
  });

  it("n'a rien à retirer quand on annule pendant l'armement", () => {
    const { actions } = run([{ type: "spaceDown", composerEmpty: true }, { type: "cancelled" }]);
    expect(actions).not.toContain("discardPreview");
  });

  it("annule proprement pendant l'armement", () => {
    const { actions } = run([{ type: "spaceDown", composerEmpty: true }, { type: "cancelled" }]);
    expect(actions.at(-1)).toBe("cancelArmTimer");
  });

  it("ne fait rien en annulant au repos", () => {
    expect(run([{ type: "cancelled" }]).actions).toEqual([]);
  });

  it("retient le message d'erreur et ferme le micro", () => {
    const { state, actions } = run([...holdSpace(), { type: "failed", message: "réseau coupé" }]);
    expect(state).toEqual({ kind: "error", message: "réseau coupé" });
    expect(actions.at(-1)).toBe("abortCapture");
  });
});

describe("indicateurs dérivés", () => {
  it("n'affiche l'enregistrement que micro ouvert", () => {
    expect(isCapturing({ kind: "arming", spaceTyped: false })).toBe(false);
    expect(isCapturing({ kind: "recording", partial: "" })).toBe(true);
    expect(isCapturing({ kind: "finishing", partial: "" })).toBe(false);
  });

  it("considère l'armement et la finalisation comme du travail en cours", () => {
    expect(isBusy({ kind: "idle" })).toBe(false);
    expect(isBusy({ kind: "arming", spaceTyped: false })).toBe(true);
    expect(isBusy({ kind: "finishing", partial: "" })).toBe(true);
    expect(isBusy({ kind: "error", message: "x" })).toBe(false);
  });

  it("accepte le geste espace tant qu'aucune transcription n'est attendue", () => {
    expect(spaceGestureApplies({ kind: "idle" })).toBe(true);
    expect(spaceGestureApplies({ kind: "arming", spaceTyped: false })).toBe(true);
    expect(spaceGestureApplies({ kind: "finishing", partial: "" })).toBe(false);
  });
});

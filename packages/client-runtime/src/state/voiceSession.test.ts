import { describe, expect, it } from "vite-plus/test";
import type { VoiceTranscriptEvent } from "@t3tools/contracts";

import {
  applyVoiceTranscriptEvent,
  EMPTY_VOICE_SESSION_STATE,
  voiceDisplayText,
  voiceTranscriptText,
} from "./voiceSession.ts";

const replay = (events: readonly VoiceTranscriptEvent[]) =>
  events.reduce(applyVoiceTranscriptEvent, EMPTY_VOICE_SESSION_STATE);

describe("applyVoiceTranscriptEvent", () => {
  it("part d'un état muet", () => {
    expect(EMPTY_VOICE_SESSION_STATE.ready).toBe(false);
    expect(EMPTY_VOICE_SESSION_STATE.finals).toEqual([]);
  });

  it("s'ouvre à la connexion du service", () => {
    expect(replay([{ type: "ready" }]).ready).toBe(true);
  });

  it("remplace le partiel plutôt que de l'accumuler", () => {
    const state = replay([
      { type: "ready" },
      { type: "partial", text: "Bon" },
      { type: "partial", text: "Bonjour tout le monde" },
    ]);
    expect(state.partial).toBe("Bonjour tout le monde");
    expect(state.finals).toEqual([]);
  });

  it("fige un énoncé et repart de zéro pour le suivant", () => {
    const state = replay([
      { type: "ready" },
      { type: "partial", text: "Première phrase." },
      { type: "final", text: "Première phrase." },
    ]);
    expect(state.partial).toBe("");
    expect(state.finals).toEqual(["Première phrase."]);
  });

  it("empile les énoncés successifs dans l'ordre", () => {
    const state = replay([
      { type: "final", text: "Un." },
      { type: "final", text: "Deux." },
    ]);
    expect(state.finals).toEqual(["Un.", "Deux."]);
  });

  it("nettoie les blancs autour d'un énoncé figé", () => {
    expect(replay([{ type: "final", text: "  espacé  " }]).finals).toEqual(["espacé"]);
  });

  it("ignore un énoncé vide mais vide quand même le partiel", () => {
    const state = replay([
      { type: "partial", text: "euh" },
      { type: "final", text: "   " },
    ]);
    expect(state.finals).toEqual([]);
    expect(state.partial).toBe("");
  });

  it("retient l'erreur et referme la session", () => {
    const state = replay([
      { type: "ready" },
      { type: "error", message: "jeton refusé", recoverable: true },
    ]);
    expect(state.error).toBe("jeton refusé");
    expect(state.recoverable).toBe(true);
    expect(state.ready).toBe(false);
  });

  it("efface une erreur passée quand le service accepte à nouveau", () => {
    const state = replay([
      { type: "error", message: "coupure", recoverable: false },
      { type: "ready" },
    ]);
    expect(state.error).toBeNull();
  });

  it("marque la fermeture sans perdre ce qui a été dit", () => {
    const state = replay([{ type: "final", text: "gardé" }, { type: "closed" }]);
    expect(state.closed).toBe(true);
    expect(state.finals).toEqual(["gardé"]);
  });
});

describe("textes dérivés", () => {
  it("ne rend que les énoncés figés au composeur", () => {
    const state = replay([
      { type: "final", text: "Phrase figée." },
      { type: "partial", text: "en cours" },
    ]);
    expect(voiceTranscriptText(state)).toBe("Phrase figée.");
  });

  it("montre le figé et l'en-cours pendant qu'on parle", () => {
    const state = replay([
      { type: "final", text: "Phrase figée." },
      { type: "partial", text: "en cours" },
    ]);
    expect(voiceDisplayText(state)).toBe("Phrase figée. en cours");
  });

  it("ne laisse pas d'espace parasite quand rien n'est en cours", () => {
    expect(voiceDisplayText(replay([{ type: "final", text: "Seule." }]))).toBe("Seule.");
  });

  it("rend une chaîne vide quand rien n'a été dit", () => {
    expect(voiceTranscriptText(EMPTY_VOICE_SESSION_STATE)).toBe("");
    expect(voiceDisplayText(EMPTY_VOICE_SESSION_STATE)).toBe("");
  });
});

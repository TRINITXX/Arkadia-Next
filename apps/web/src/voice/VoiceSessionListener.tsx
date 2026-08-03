import { useAtomValue } from "@effect/atom-react";
import { useEffect, useMemo, useRef } from "react";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/unstable/reactivity";
import type { EnvironmentId } from "@t3tools/contracts";

import { voiceEnvironment } from "../state/voice";
import type { DictationEvent } from "./dictationMachine";

export interface VoiceSessionListenerProps {
  readonly environmentId: EnvironmentId;
  readonly sessionId: string;
  readonly language?: string | undefined;
  readonly keyterms?: readonly string[] | undefined;
  readonly send: (event: DictationEvent) => void;
}

/**
 * Tient la session de dictée ouverte tant qu'il est monté.
 *
 * L'abonnement est ce qui ouvre le flux côté serveur : en faire un composant
 * distinct, monté seulement pendant une prise de parole, garantit qu'aucune
 * session ne traîne au repos et que la fermeture suit le démontage.
 */
export const VoiceSessionListener = ({
  environmentId,
  sessionId,
  language,
  keyterms,
  send,
}: VoiceSessionListenerProps) => {
  const target = useMemo(
    () => ({
      environmentId,
      input: {
        sessionId,
        ...(language === undefined ? {} : { language }),
        ...(keyterms === undefined ? {} : { keyterms: [...keyterms] }),
      },
    }),
    [environmentId, sessionId, language, keyterms],
  );

  const result = useAtomValue(voiceEnvironment.session(target));
  const session = Option.getOrNull(AsyncResult.value(result));
  // Une panne de transport n'apparaît pas dans l'état de session : elle fait
  // échouer l'atom lui-même.
  const transportFailed = AsyncResult.isFailure(result);

  /** Énoncés déjà remis au composeur : l'atom peut se réémettre à l'identique. */
  const deliveredRef = useRef(0);
  const lastPartialRef = useRef("");
  const reportedErrorRef = useRef<string | null>(null);

  useEffect(() => {
    deliveredRef.current = 0;
    lastPartialRef.current = "";
    reportedErrorRef.current = null;
  }, [sessionId]);

  useEffect(() => {
    if (transportFailed && reportedErrorRef.current === null) {
      reportedErrorRef.current = "transport";
      send({ type: "failed", message: "La connexion à la dictée a échoué." });
      return;
    }
    if (session === null) return;

    if (session.error !== null) {
      if (reportedErrorRef.current !== session.error) {
        reportedErrorRef.current = session.error;
        send({ type: "failed", message: session.error });
      }
      return;
    }

    const fresh = session.finals.slice(deliveredRef.current);
    if (fresh.length > 0) {
      deliveredRef.current = session.finals.length;
      // Un seul aller-retour par lot : la première finalisation peut ramener la
      // machine au repos, où les suivantes seraient ignorées et le texte perdu.
      send({ type: "partial", text: fresh.join(" ") });
      send({ type: "finalized" });
    }

    if (session.partial !== lastPartialRef.current) {
      lastPartialRef.current = session.partial;
      if (session.partial.length > 0) send({ type: "partial", text: session.partial });
    }
  }, [session, send, transportFailed]);

  return null;
};

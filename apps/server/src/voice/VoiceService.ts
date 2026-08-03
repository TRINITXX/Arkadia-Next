import * as NodeOS from "node:os";

import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";
import {
  type VoiceAppendAudioInput,
  type VoiceStartInput,
  type VoiceStopInput,
  type VoiceTranscriptEvent,
  VoiceSessionNotFoundError,
  VoiceStreamError,
  VoiceUnauthenticatedError,
} from "@t3tools/contracts";

import { CLAUDE_CREDENTIALS_SEGMENTS, parseClaudeCredentials } from "./claudeCredentials.ts";
import {
  buildVoiceStreamHeaders,
  buildVoiceStreamUrl,
  CLOSE_STREAM_MESSAGE,
  KEEP_ALIVE_INTERVAL_MS,
  KEEP_ALIVE_MESSAGE,
  parseVoiceStreamMessage,
  transcriptEventForClose,
} from "./voiceStreamProtocol.ts";

export type VoiceServiceError =
  | VoiceUnauthenticatedError
  | VoiceSessionNotFoundError
  | VoiceStreamError;

/**
 * Adresse du service de transcription. Surchargeable pour observer le protocole
 * contre un serveur local, comme le fait le client officiel.
 */
const resolveBaseApiUrl = (): string =>
  process.env["VOICE_STREAM_BASE_URL"] ?? "https://api.anthropic.com";

interface VoiceSession {
  readonly socket: WebSocket;
  /** Dernier texte connu de l'énoncé en cours, promu en final à l'endpoint. */
  pendingText: string;
  /** Vrai dès qu'on ferme volontairement : évite de signaler une fausse panne. */
  closing: boolean;
}

export class VoiceService extends Context.Service<
  VoiceService,
  {
    /** Ouvre une session et tient le flux de transcriptions jusqu'à sa fermeture. */
    readonly start: (
      input: VoiceStartInput,
    ) => Stream.Stream<VoiceTranscriptEvent, VoiceServiceError>;

    /** Pousse une trame audio dans une session ouverte. */
    readonly appendAudio: (input: VoiceAppendAudioInput) => Effect.Effect<void, VoiceServiceError>;

    /** Clôt l'énoncé et laisse le service rendre son texte, ou jette tout. */
    readonly stop: (input: VoiceStopInput) => Effect.Effect<void, VoiceServiceError>;
  }
>()("t3/voice/VoiceService") {}

export const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const sessions = new Map<string, VoiceSession>();

  const credentialsPath = path.join(NodeOS.homedir(), ...CLAUDE_CREDENTIALS_SEGMENTS);

  const readAccessToken = Effect.gen(function* () {
    const raw = yield* fileSystem.readFileString(credentialsPath).pipe(
      Effect.mapError(
        (cause) =>
          new VoiceUnauthenticatedError({
            detail: `Could not read Claude credentials at ${credentialsPath}: ${cause.message}`,
          }),
      ),
    );
    const now = yield* Clock.currentTimeMillis;
    const result = parseClaudeCredentials(raw, now);
    if (!result.ok) {
      return yield* new VoiceUnauthenticatedError({ detail: result.failure.detail });
    }
    return result.accessToken;
  });

  const teardown = (sessionId: string): void => {
    const session = sessions.get(sessionId);
    if (!session) return;
    session.closing = true;
    sessions.delete(sessionId);
    try {
      session.socket.close();
    } catch {
      // La socket peut déjà être fermée : rien à rattraper.
    }
  };

  const connect = (
    input: VoiceStartInput,
    accessToken: string,
    emit: (event: VoiceTranscriptEvent) => void,
  ): VoiceSession => {
    // Une session laissée ouverte par un client parti est remplacée.
    teardown(input.sessionId);

    const socket = new WebSocket(
      buildVoiceStreamUrl({ baseApiUrl: resolveBaseApiUrl(), language: input.language }),
      { headers: buildVoiceStreamHeaders(accessToken, input.keyterms ?? []) } as never,
    );

    const session: VoiceSession = { socket, pendingText: "", closing: false };
    sessions.set(input.sessionId, session);

    socket.addEventListener("open", () => emit({ type: "ready" }));

    socket.addEventListener("message", (event) => {
      const message = parseVoiceStreamMessage(typeof event.data === "string" ? event.data : "");
      switch (message.kind) {
        case "partial":
          session.pendingText = message.text;
          emit({ type: "partial", text: message.text });
          break;
        case "endpoint": {
          // La fin d'énoncé ne porte pas de texte : c'est le dernier partiel
          // reçu qui devient le résultat.
          const text = session.pendingText;
          session.pendingText = "";
          if (text.length > 0) emit({ type: "final", text });
          break;
        }
        case "error":
          emit({ type: "error", message: message.message, recoverable: false });
          break;
        case "ignored":
          break;
      }
    });

    socket.addEventListener("error", () => {
      if (!session.closing) {
        emit({
          type: "error",
          message: "Could not reach the dictation service.",
          recoverable: false,
        });
      }
    });

    socket.addEventListener("close", (event) => {
      const deliberate = session.closing;
      // Un énoncé en cours au moment de la fermeture ne doit pas être perdu.
      if (session.pendingText.length > 0) {
        emit({ type: "final", text: session.pendingText });
        session.pendingText = "";
      }
      sessions.delete(input.sessionId);
      if (!deliberate) emit(transcriptEventForClose(event.code, event.reason));
    });

    return session;
  };

  /** Le service coupe une connexion muette : on la tient éveillée. */
  const keepAlive = (session: VoiceSession) =>
    Effect.sync(() => {
      if (session.socket.readyState === WebSocket.OPEN) {
        session.socket.send(KEEP_ALIVE_MESSAGE);
      }
    }).pipe(Effect.repeat(Schedule.spaced(`${KEEP_ALIVE_INTERVAL_MS} millis`)));

  const requireSession = (sessionId: string): Effect.Effect<VoiceSession, VoiceServiceError> => {
    const session = sessions.get(sessionId);
    return session
      ? Effect.succeed(session)
      : Effect.fail(new VoiceSessionNotFoundError({ sessionId }));
  };

  return VoiceService.of({
    start: (input) =>
      Stream.unwrap(
        readAccessToken.pipe(
          Effect.map((accessToken) =>
            Stream.callback<VoiceTranscriptEvent, VoiceServiceError>((queue) =>
              Effect.acquireRelease(
                Effect.gen(function* () {
                  const session = connect(input, accessToken, (event) => {
                    Queue.offerUnsafe(queue, event);
                  });
                  yield* Effect.forkScoped(keepAlive(session));
                  return input.sessionId;
                }),
                (sessionId) => Effect.sync(() => teardown(sessionId)),
              ),
            ),
          ),
        ),
      ),

    appendAudio: (input) =>
      requireSession(input.sessionId).pipe(
        Effect.flatMap((session) =>
          Effect.try({
            try: () => {
              if (session.socket.readyState !== WebSocket.OPEN) return;
              session.socket.send(Buffer.from(input.audio, "base64"));
            },
            catch: (cause) =>
              new VoiceStreamError({
                detail: `Could not forward audio: ${cause instanceof Error ? cause.message : String(cause)}`,
              }),
          }),
        ),
      ),

    stop: (input) =>
      requireSession(input.sessionId).pipe(
        Effect.flatMap((session) =>
          Effect.sync(() => {
            if (input.discard === true) {
              session.pendingText = "";
              teardown(input.sessionId);
              return;
            }
            // Sans `discard`, on laisse le service finir sa phrase : il fermera
            // lui-même, ce qui délivrera le texte restant.
            if (session.socket.readyState === WebSocket.OPEN) {
              session.socket.send(CLOSE_STREAM_MESSAGE);
            } else {
              teardown(input.sessionId);
            }
          }),
        ),
      ),
  });
});

export const layer = Layer.effect(VoiceService, make);

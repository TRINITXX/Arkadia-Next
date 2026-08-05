import {
  EventId,
  ProviderDriverKind,
  type ProviderInstanceId,
  type ProviderRuntimeEvent,
  type ProviderSession,
  type ThreadId,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import type { ClaudeAdapterShape } from "../Services/ClaudeAdapter.ts";
import type { ProviderAdapterShape } from "../Services/ProviderAdapter.ts";
import type { ProviderAdapterError } from "../Errors.ts";
import type { KimiCanonicalUsage, KimiUsageError } from "./KimiUsage.ts";

const CLAUDE_PROVIDER = ProviderDriverKind.make("claudeAgent");
export const KIMI_PROVIDER = ProviderDriverKind.make("kimi");

function mapSession(session: ProviderSession): ProviderSession {
  return { ...session, provider: KIMI_PROVIDER };
}

export const makeKimiAdapter = Effect.fn("makeKimiAdapter")(function* (input: {
  readonly claudeAdapter: ClaudeAdapterShape;
  readonly instanceId: ProviderInstanceId;
  readonly fetchUsage: () => Effect.Effect<KimiCanonicalUsage, KimiUsageError>;
}) {
  const crypto = yield* Crypto.Crypto;
  const quotaEvents = yield* Queue.unbounded<ProviderRuntimeEvent>();

  const emitUsage = Effect.fn("makeKimiAdapter.emitUsage")(function* (threadId: ThreadId) {
    const rateLimits = yield* input.fetchUsage();
    if (Object.keys(rateLimits).length === 0) return;
    const eventId = yield* crypto.randomUUIDv4;
    const createdAt = DateTime.formatIso(yield* DateTime.now);
    yield* Queue.offer(quotaEvents, {
      eventId: EventId.make(eventId),
      provider: KIMI_PROVIDER,
      providerInstanceId: input.instanceId,
      threadId,
      createdAt,
      type: "account.rate-limits.updated",
      payload: { rateLimits },
    });
  });

  const refreshUsage = (threadId: ThreadId) =>
    emitUsage(threadId).pipe(
      Effect.catch((cause) => Effect.logWarning("Kimi usage refresh failed.", { cause })),
    );

  const mappedEvents = input.claudeAdapter.streamEvents.pipe(
    Stream.map((event): ProviderRuntimeEvent => ({ ...event, provider: KIMI_PROVIDER })),
    Stream.tap((event) =>
      event.type === "turn.completed" ? refreshUsage(event.threadId) : Effect.void,
    ),
  );

  return {
    ...input.claudeAdapter,
    provider: KIMI_PROVIDER,
    capabilities: { sessionModelSwitch: "unsupported" },
    startSession: (startInput) =>
      input.claudeAdapter.startSession({ ...startInput, provider: CLAUDE_PROVIDER }).pipe(
        Effect.tap((session) => Effect.forkDetach(refreshUsage(session.threadId))),
        Effect.map(mapSession),
      ),
    listSessions: () =>
      input.claudeAdapter.listSessions().pipe(Effect.map((items) => items.map(mapSession))),
    get streamEvents() {
      return Stream.merge(mappedEvents, Stream.fromQueue(quotaEvents));
    },
  } satisfies ProviderAdapterShape<ProviderAdapterError>;
});

import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import {
  EventId,
  ProviderDriverKind,
  ThreadId,
  TurnId,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";

import {
  MergeCleanupService,
  type MergeCleanupServiceShape,
} from "../../git/MergeCleanupService.ts";
import {
  ProviderService,
  type ProviderServiceShape,
} from "../../provider/Services/ProviderService.ts";
import { MergeCleanupReactorLive } from "./MergeCleanupReactor.ts";
import { MergeCleanupReactor } from "../Services/MergeCleanupReactor.ts";

const threadId = ThreadId.make("thread-merge-cleanup-reactor-1");

const turnCompletedEvent = (): ProviderRuntimeEvent =>
  ({
    type: "turn.completed",
    eventId: EventId.make("evt-merge-cleanup-reactor-turn-completed"),
    provider: ProviderDriverKind.make("codex"),
    createdAt: "2026-08-04T00:00:00.000Z",
    threadId,
    turnId: TurnId.make("turn-merge-cleanup-reactor-1"),
    payload: { state: "completed" },
  }) as ProviderRuntimeEvent;

it.effect("calls resumeIfClean for each completed turn", () =>
  Effect.gen(function* () {
    const calls = yield* Ref.make<ReadonlyArray<string>>([]);

    const mergeCleanupServiceLayer = Layer.succeed(MergeCleanupService, {
      attempt: () => Effect.die("attempt should not be called in this test"),
      resumeIfClean: (id) => Ref.update(calls, (existing) => [...existing, id]).pipe(Effect.asVoid),
    } satisfies MergeCleanupServiceShape);

    const providerServiceLayer = Layer.succeed(ProviderService, {
      startSession: () => Effect.die("startSession should not be called in this test"),
      sendTurn: () => Effect.die("sendTurn should not be called in this test"),
      interruptTurn: () => Effect.die("interruptTurn should not be called in this test"),
      respondToRequest: () => Effect.die("respondToRequest should not be called in this test"),
      respondToUserInput: () => Effect.die("respondToUserInput should not be called in this test"),
      stopSession: () => Effect.die("stopSession should not be called in this test"),
      listSessions: () => Effect.succeed([]),
      getCapabilities: () => Effect.die("getCapabilities should not be called in this test"),
      getInstanceInfo: () => Effect.die("getInstanceInfo should not be called in this test"),
      rollbackConversation: () =>
        Effect.die("rollbackConversation should not be called in this test"),
      streamEvents: Stream.make(turnCompletedEvent()),
    } satisfies ProviderServiceShape);

    const layer = MergeCleanupReactorLive.pipe(
      Layer.provide(mergeCleanupServiceLayer),
      Layer.provide(providerServiceLayer),
    );

    yield* Effect.scoped(
      Effect.gen(function* () {
        const reactor = yield* MergeCleanupReactor;
        yield* reactor.start();
        yield* Effect.yieldNow;
        yield* reactor.drain;
      }),
    ).pipe(Effect.provide(layer));

    assert.deepStrictEqual(yield* Ref.get(calls), [threadId]);
  }),
);

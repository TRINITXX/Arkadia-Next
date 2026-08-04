import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";

import { MergeCleanupService } from "../../git/MergeCleanupService.ts";
import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { forkParked } from "../../serverActivation.ts";
import {
  MergeCleanupReactor,
  type MergeCleanupReactorShape,
} from "../Services/MergeCleanupReactor.ts";

const make = Effect.gen(function* () {
  const providerService = yield* ProviderService;
  const mergeCleanup = yield* MergeCleanupService;

  const processSafely = (threadId: Parameters<typeof mergeCleanup.resumeIfClean>[0]) =>
    mergeCleanup.resumeIfClean(threadId).pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.failCause(cause)
          : Effect.logWarning("merge cleanup reactor failed to process turn.completed", {
              threadId,
              cause: Cause.pretty(cause),
            }),
      ),
    );

  const worker = yield* makeDrainableWorker(processSafely);

  const start: MergeCleanupReactorShape["start"] = Effect.fn("start")(function* () {
    yield* forkParked(
      Stream.runForEach(providerService.streamEvents, (event) => {
        if (event.type !== "turn.completed") return Effect.void;
        return worker.enqueue(event.threadId);
      }),
    );
  });

  return {
    start,
    drain: worker.drain,
  } satisfies MergeCleanupReactorShape;
});

export const MergeCleanupReactorLive = Layer.effect(MergeCleanupReactor, make);

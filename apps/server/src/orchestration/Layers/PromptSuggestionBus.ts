/**
 * PromptSuggestionBus layer.
 *
 * Backed by a sliding PubSub: at most one suggestion is produced per turn, so
 * the buffer only ever fills if a subscriber stalls — and in that case dropping
 * the oldest guesses is exactly right, since the newest one supersedes them.
 *
 * @module PromptSuggestionBus
 */
import type { ThreadPromptSuggestion } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";

import {
  PromptSuggestionBus,
  type PromptSuggestionBusShape,
} from "../Services/PromptSuggestionBus.ts";

const SUGGESTION_BUFFER_SIZE = 32;

const makePromptSuggestionBus = Effect.gen(function* () {
  const pubSub = yield* PubSub.sliding<ThreadPromptSuggestion>(SUGGESTION_BUFFER_SIZE);

  return {
    publish: (suggestion) => PubSub.publish(pubSub, suggestion).pipe(Effect.asVoid),
    get stream() {
      return Stream.fromPubSub(pubSub);
    },
  } satisfies PromptSuggestionBusShape;
});

export const PromptSuggestionBusLive = Layer.effect(PromptSuggestionBus, makePromptSuggestionBus);

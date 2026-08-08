/**
 * PromptSuggestionBus - Transient delivery of composer prompt suggestions.
 *
 * A provider's predicted next prompt is the one runtime signal that must not
 * reach the event store: it is only useful for as long as the conversation it
 * was predicted from is the newest thing on screen. Persisting it would make a
 * thread reopened the next day greet the user with yesterday's guess.
 *
 * So it bypasses the orchestration event pipeline entirely. Ingestion publishes
 * here, the thread subscription merges the stream in, and a suggestion nobody is
 * listening for is simply dropped.
 *
 * @module PromptSuggestionBus
 */
import type { ThreadPromptSuggestion } from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Stream from "effect/Stream";

/**
 * PromptSuggestionBusShape - Publish/subscribe API for prompt suggestions.
 */
export interface PromptSuggestionBusShape {
  /** Broadcast to whoever is currently subscribed. Never fails. */
  readonly publish: (suggestion: ThreadPromptSuggestion) => Effect.Effect<void>;

  /** Every suggestion published after subscription, for all threads. */
  readonly stream: Stream.Stream<ThreadPromptSuggestion>;
}

/**
 * PromptSuggestionBus - Service tag for the transient suggestion channel.
 */
export class PromptSuggestionBus extends Context.Service<
  PromptSuggestionBus,
  PromptSuggestionBusShape
>()("t3/orchestration/Services/PromptSuggestionBus") {}

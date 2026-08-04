/**
 * MergeCleanupReactor - Merge cleanup reaction service interface.
 *
 * Owns a background worker that reacts to provider `turn.completed` runtime
 * events and calls `MergeCleanupService.resumeIfClean` so a conflict
 * resolved by the agent auto-finalizes without further user action.
 *
 * @module MergeCleanupReactor
 */
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

/**
 * MergeCleanupReactorShape - Service API for merge cleanup reactor lifecycle.
 */
export interface MergeCleanupReactorShape {
  /**
   * Start the merge cleanup reactor.
   *
   * The returned effect must be run in a scope so the worker fiber can be
   * finalized on shutdown.
   *
   * Consumes provider-runtime `turn.completed` events.
   */
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;

  /**
   * Resolves when the internal processing queue is empty and idle.
   * Intended for test use to replace timing-sensitive sleeps.
   */
  readonly drain: Effect.Effect<void>;
}

/**
 * MergeCleanupReactor - Service tag for merge cleanup reactor workers.
 */
export class MergeCleanupReactor extends Context.Service<
  MergeCleanupReactor,
  MergeCleanupReactorShape
>()("t3/orchestration/Services/MergeCleanupReactor") {}

import type { OrchestrationThread } from "@t3tools/contracts";
import * as Option from "effect/Option";

export type EnvironmentThreadStatus = "empty" | "cached" | "synchronizing" | "live" | "deleted";

export interface EnvironmentThreadState {
  readonly data: Option.Option<OrchestrationThread>;
  readonly status: EnvironmentThreadStatus;
  readonly error: Option.Option<string>;
  /**
   * The provider's guess at the next prompt, offered in the composer.
   *
   * Lives here rather than on the thread because it is never cached and never
   * restored: reloading the app, or reopening the thread tomorrow, must not
   * bring back a guess made about a conversation that has since moved on.
   */
  readonly promptSuggestion: Option.Option<string>;
}

export const EMPTY_ENVIRONMENT_THREAD_STATE: EnvironmentThreadState = {
  data: Option.none(),
  status: "empty",
  error: Option.none(),
  promptSuggestion: Option.none(),
};

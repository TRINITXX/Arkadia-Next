import { VcsActionUnavailableError } from "@t3tools/client-runtime/state/vcs";
import type { ThreadId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/unstable/reactivity";
import { useCallback } from "react";

import { gitEnvironment } from "../state/git";
import {
  resolveScope,
  useAction,
  type SourceControlActionScope,
} from "../state/sourceControlActions";
import { useAtomCommand } from "../state/use-atom-command";

export function useMergeCleanupThreadAction(scope: SourceControlActionScope) {
  const mergeCleanupThread = useAtomCommand(gitEnvironment.mergeCleanupThread, {
    reportFailure: false,
  });
  const action = useCallback(
    async (input: { threadId: ThreadId }) => {
      const target = resolveScope(scope);
      if (target === null) {
        return AsyncResult.failure<never, VcsActionUnavailableError>(
          Cause.fail(
            new VcsActionUnavailableError({
              operation: "merge_cleanup_thread",
              environmentId: scope.environmentId,
              cwd: scope.cwd,
            }),
          ),
        );
      }
      return mergeCleanupThread({
        environmentId: target.environmentId,
        input: { cwd: target.cwd, threadId: input.threadId },
      });
    },
    [mergeCleanupThread, scope],
  );
  return useAction({
    kind: "mergeCleanupThread",
    label: "Merging and cleaning up worktree",
    scope,
    action,
  });
}

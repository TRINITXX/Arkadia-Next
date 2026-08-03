import type { ScopedProjectRef } from "@t3tools/contracts";
import { useCallback, useMemo } from "react";

import { terminalEnvironment } from "~/state/terminal";
import { useAtomCommand } from "~/state/use-atom-command";
import { projectTerminalThreadId } from "~/terminal/projectTerminals";
import { useProjectTerminalsStore } from "./projectTerminalsStore";

/**
 * Closes a project terminal for good: the tab goes, and so does the shell and
 * its scrollback. Unlike closing a conversation tab — which only settles the
 * conversation and leaves it reachable from the sidebar — a terminal has no
 * other home in the UI, so leaving the PTY running would strand it.
 *
 * Navigation is deliberately not handled here: the tab bar and the terminal
 * route each know a different right answer for where to go next.
 */
export function useCloseProjectTerminal(
  projectRef: ScopedProjectRef,
): (terminalId: string) => void {
  const closeTerminalTab = useProjectTerminalsStore((store) => store.closeTerminal);
  const closeTerminalSession = useAtomCommand(terminalEnvironment.close, { reportFailure: false });
  const threadId = useMemo(
    () => projectTerminalThreadId(projectRef.projectId),
    [projectRef.projectId],
  );

  return useCallback(
    (terminalId: string) => {
      closeTerminalTab(projectRef, terminalId);
      void closeTerminalSession({
        environmentId: projectRef.environmentId,
        input: { threadId, terminalId, deleteHistory: true },
      });
    },
    [closeTerminalSession, closeTerminalTab, projectRef, threadId],
  );
}

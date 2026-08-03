import { nextTerminalId } from "@t3tools/shared/terminalLabels";
import { ThreadId, type ProjectId } from "@t3tools/contracts";

/**
 * Project terminals live outside any conversation: opening one, closing the
 * conversation you started it from, and coming back later must all leave the
 * same shell running.
 *
 * The server namespaces terminals by `threadId`, which it treats as an opaque
 * key (it base64url-encodes it into the history filename and never looks the
 * thread up). Project terminals therefore get their own key in that same
 * namespace, prefixed so it can never collide with a real conversation id.
 * Every UI that lists terminals filters by an explicit thread, so these never
 * surface in conversation-scoped views.
 */
const PROJECT_TERMINAL_THREAD_PREFIX = "project-terminal:";

export function projectTerminalThreadId(projectId: ProjectId): ThreadId {
  return ThreadId.make(`${PROJECT_TERMINAL_THREAD_PREFIX}${projectId}`);
}

/**
 * Allocates the next free terminal id for a project. Ids are dense (`term-1`,
 * `term-2`, …) and reused once freed, so closing terminal 2 of 3 gives the
 * next one `term-2` again rather than growing forever.
 */
export function nextProjectTerminalId(existingTerminalIds: ReadonlyArray<string>): string {
  return nextTerminalId(existingTerminalIds);
}

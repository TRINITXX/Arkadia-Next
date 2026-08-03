/**
 * Which terminals a project has open, as workspace tabs.
 *
 * Terminals opened from the toolbar belong to the project, not to whichever
 * conversation happened to be on screen: the user asked for a shell in this
 * folder, and closing the conversation must not take it away. The list is
 * therefore keyed by scoped project ref, and it persists so terminals survive
 * a window reload the same way the server-side PTYs do.
 *
 * The transition helpers are exported and pure (same convention as
 * `uiStateStore.ts` and `notepadStore.ts`); the store is a thin keyed wrapper
 * around them.
 */
import type { ScopedProjectRef } from "@t3tools/contracts";
import { scopedProjectKey } from "@t3tools/client-runtime/environment";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { nextProjectTerminalId } from "~/terminal/projectTerminals";

export interface ProjectTerminalTab {
  readonly terminalId: string;
  /**
   * Command to send once the PTY is up, then forgotten. A toolbar action
   * button opens its terminal and runs its command in one gesture, but the
   * PTY only exists after the tab's view has mounted and opened it — so the
   * command rides along here instead of being written by the caller into a
   * terminal that does not exist yet.
   */
  readonly pendingCommand?: string;
}

const PROJECT_TERMINALS_STORAGE_KEY = "t3code:project-terminals:v1";

const EMPTY_PROJECT_TERMINALS: ReadonlyArray<ProjectTerminalTab> = Object.freeze([]);

export function selectProjectTerminals(
  byProjectKey: Readonly<Record<string, ReadonlyArray<ProjectTerminalTab>>>,
  projectKey: string | null,
): ReadonlyArray<ProjectTerminalTab> {
  if (!projectKey) return EMPTY_PROJECT_TERMINALS;
  return byProjectKey[projectKey] ?? EMPTY_PROJECT_TERMINALS;
}

export function addProjectTerminal(
  tabs: ReadonlyArray<ProjectTerminalTab>,
  options?: { readonly pendingCommand?: string },
): { readonly tabs: ReadonlyArray<ProjectTerminalTab>; readonly terminalId: string } {
  const terminalId = nextProjectTerminalId(tabs.map((tab) => tab.terminalId));
  const pendingCommand = options?.pendingCommand;
  const tab: ProjectTerminalTab = pendingCommand ? { terminalId, pendingCommand } : { terminalId };
  return { tabs: [...tabs, tab], terminalId };
}

export function removeProjectTerminal(
  tabs: ReadonlyArray<ProjectTerminalTab>,
  terminalId: string,
): ReadonlyArray<ProjectTerminalTab> {
  const next = tabs.filter((tab) => tab.terminalId !== terminalId);
  return next.length === tabs.length ? tabs : next;
}

/**
 * Returns the pending command and clears it in one step, so a re-render or a
 * remount of the terminal view can never run the same command twice.
 */
export function takeProjectTerminalCommand(
  tabs: ReadonlyArray<ProjectTerminalTab>,
  terminalId: string,
): { readonly tabs: ReadonlyArray<ProjectTerminalTab>; readonly command: string | null } {
  const tab = tabs.find((candidate) => candidate.terminalId === terminalId);
  if (!tab?.pendingCommand) return { tabs, command: null };
  return {
    tabs: tabs.map((candidate) =>
      candidate.terminalId === terminalId ? { terminalId: candidate.terminalId } : candidate,
    ),
    command: tab.pendingCommand,
  };
}

interface ProjectTerminalsStoreState {
  terminalsByProjectKey: Record<string, ReadonlyArray<ProjectTerminalTab>>;
  /** Appends a terminal tab and returns its freshly allocated id. */
  openTerminal: (projectRef: ScopedProjectRef, options?: { pendingCommand?: string }) => string;
  closeTerminal: (projectRef: ScopedProjectRef, terminalId: string) => void;
  takePendingCommand: (projectRef: ScopedProjectRef, terminalId: string) => string | null;
}

export const useProjectTerminalsStore = create<ProjectTerminalsStoreState>()(
  persist(
    (set, get) => ({
      terminalsByProjectKey: {},
      openTerminal: (projectRef, options) => {
        const projectKey = scopedProjectKey(projectRef);
        const current = selectProjectTerminals(get().terminalsByProjectKey, projectKey);
        const result = addProjectTerminal(
          current,
          options?.pendingCommand ? { pendingCommand: options.pendingCommand } : undefined,
        );
        set((state) => ({
          terminalsByProjectKey: {
            ...state.terminalsByProjectKey,
            [projectKey]: result.tabs,
          },
        }));
        return result.terminalId;
      },
      closeTerminal: (projectRef, terminalId) => {
        const projectKey = scopedProjectKey(projectRef);
        set((state) => {
          const current = selectProjectTerminals(state.terminalsByProjectKey, projectKey);
          const next = removeProjectTerminal(current, terminalId);
          if (next === current) return state;
          return {
            terminalsByProjectKey: { ...state.terminalsByProjectKey, [projectKey]: next },
          };
        });
      },
      takePendingCommand: (projectRef, terminalId) => {
        const projectKey = scopedProjectKey(projectRef);
        const current = selectProjectTerminals(get().terminalsByProjectKey, projectKey);
        const result = takeProjectTerminalCommand(current, terminalId);
        if (result.command === null) return null;
        set((state) => ({
          terminalsByProjectKey: {
            ...state.terminalsByProjectKey,
            [projectKey]: result.tabs,
          },
        }));
        return result.command;
      },
    }),
    {
      name: PROJECT_TERMINALS_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ terminalsByProjectKey: state.terminalsByProjectKey }),
    },
  ),
);

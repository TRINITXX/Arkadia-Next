import { create } from "zustand";

/**
 * Manual order of the workspace tab bar, kept per project as a flat list of tab
 * keys (conversations, the draft, and terminals share one list so any of them
 * can be dragged in front of any other). Deliberately window- and session-local:
 * it lives only in memory and is never persisted, so a reload falls back to the
 * natural order (conversations by creation date, then draft, then terminals).
 */
export interface WorkspaceTabOrderState {
  readonly orderByProjectKey: Readonly<Record<string, readonly string[]>>;
  readonly activeTabKeyByProjectKey: Readonly<Record<string, string>>;
}

interface WorkspaceTabOrderStore extends WorkspaceTabOrderState {
  readonly setOrder: (projectKey: string, orderedKeys: readonly string[]) => void;
  readonly markTabActive: (projectKey: string, tabKey: string) => void;
}

export function markWorkspaceTabActive(
  state: WorkspaceTabOrderState,
  projectKey: string,
  tabKey: string,
): WorkspaceTabOrderState {
  if (state.activeTabKeyByProjectKey[projectKey] === tabKey) return state;
  return {
    ...state,
    activeTabKeyByProjectKey: { ...state.activeTabKeyByProjectKey, [projectKey]: tabKey },
  };
}

export const useWorkspaceTabOrderStore = create<WorkspaceTabOrderStore>((set) => ({
  orderByProjectKey: {},
  activeTabKeyByProjectKey: {},
  setOrder: (projectKey, orderedKeys) =>
    set((state) => ({
      orderByProjectKey: { ...state.orderByProjectKey, [projectKey]: [...orderedKeys] },
    })),
  markTabActive: (projectKey, tabKey) =>
    set((state) => markWorkspaceTabActive(state, projectKey, tabKey)),
}));

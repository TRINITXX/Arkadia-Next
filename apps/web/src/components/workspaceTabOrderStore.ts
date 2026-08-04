import { create } from "zustand";

/**
 * Manual order of the workspace tab bar, kept per project as a flat list of tab
 * keys (conversations, the draft, and terminals share one list so any of them
 * can be dragged in front of any other). Deliberately window- and session-local:
 * it lives only in memory and is never persisted, so a reload falls back to the
 * natural order (conversations by creation date, then draft, then terminals).
 */
interface WorkspaceTabOrderStore {
  readonly orderByProjectKey: Readonly<Record<string, readonly string[]>>;
  readonly setOrder: (projectKey: string, orderedKeys: readonly string[]) => void;
}

export const useWorkspaceTabOrderStore = create<WorkspaceTabOrderStore>((set) => ({
  orderByProjectKey: {},
  setOrder: (projectKey, orderedKeys) =>
    set((state) => ({
      orderByProjectKey: { ...state.orderByProjectKey, [projectKey]: [...orderedKeys] },
    })),
}));

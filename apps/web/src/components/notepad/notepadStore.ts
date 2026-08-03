/**
 * Notepad panel state: a per-project scratchpad with a draft and an archived
 * history. Ported from Arkadia's `src/lib/notepadStore.ts`, minus the
 * clipboard-read and screenshot-to-disk plumbing that only exists inside
 * Tauri. Note content is data, not a preference, so it persists like
 * `rightPanelStore.ts` and `terminalUiStateStore.ts` rather than through
 * `ClientSettingsSchema`. Existing Arkadia notes are intentionally not
 * imported — every project starts empty.
 *
 * The transition helpers below are exported and pure (same convention as
 * `uiStateStore.ts`), so they're the part covered directly by tests; the
 * store itself is a thin per-project keyed wrapper around them.
 */
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { createDebouncedStorage, createMemoryStorage } from "~/lib/storage";

export const NOTEPAD_HISTORY_CAP = 100;

export interface NotepadEntry {
  id: string;
  text: string;
  createdAt: number; // epoch ms
}

export interface NotepadProjectState {
  /** In-progress text, not yet archived. */
  draft: string;
  /** Archived messages, most recent first. */
  history: NotepadEntry[];
}

const EMPTY_NOTEPAD_PROJECT_STATE: NotepadProjectState = Object.freeze({
  draft: "",
  history: [],
});

const NOTEPAD_STORAGE_KEY = "t3code:notepad-state:v1";
// The draft persists on every keystroke, so — like `composerDraftStore.ts` —
// writes are debounced rather than hitting localStorage synchronously per
// character.
const NOTEPAD_PERSIST_DEBOUNCE_MS = 300;

const notepadDebouncedStorage = createDebouncedStorage(
  typeof window !== "undefined" ? window.localStorage : createMemoryStorage(),
  NOTEPAD_PERSIST_DEBOUNCE_MS,
);

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("beforeunload", () => {
    notepadDebouncedStorage.flush();
  });
}

export function newNotepadEntryId(): string {
  return `note-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function selectNotepadProjectState(
  byProjectId: Readonly<Record<string, NotepadProjectState>>,
  projectId: string | null,
): NotepadProjectState {
  if (!projectId) return EMPTY_NOTEPAD_PROJECT_STATE;
  return byProjectId[projectId] ?? EMPTY_NOTEPAD_PROJECT_STATE;
}

export function setNotepadDraft(state: NotepadProjectState, draft: string): NotepadProjectState {
  if (state.draft === draft) return state;
  return { ...state, draft };
}

/** Archives `entry` at the head of history (capped) and clears the draft —
 *  the transition both the Copy button and the full-select validation
 *  gesture drive. */
export function archiveNotepadDraft(
  state: NotepadProjectState,
  entry: NotepadEntry,
): NotepadProjectState {
  return {
    draft: "",
    history: [entry, ...state.history].slice(0, NOTEPAD_HISTORY_CAP),
  };
}

export function loadNotepadEntry(state: NotepadProjectState, entryId: string): NotepadProjectState {
  const found = state.history.find((candidate) => candidate.id === entryId);
  if (!found || state.draft === found.text) return state;
  return { ...state, draft: found.text };
}

export function deleteNotepadEntry(
  state: NotepadProjectState,
  entryId: string,
): NotepadProjectState {
  if (!state.history.some((candidate) => candidate.id === entryId)) return state;
  return { ...state, history: state.history.filter((candidate) => candidate.id !== entryId) };
}

export function updateNotepadProjectState(
  byProjectId: Record<string, NotepadProjectState>,
  projectId: string,
  updater: (state: NotepadProjectState) => NotepadProjectState,
): Record<string, NotepadProjectState> {
  const current = byProjectId[projectId] ?? EMPTY_NOTEPAD_PROJECT_STATE;
  const next = updater(current);
  if (next === current) return byProjectId;
  return { ...byProjectId, [projectId]: next };
}

interface NotepadStoreState {
  byProjectId: Record<string, NotepadProjectState>;
  setDraft: (projectId: string, draft: string) => void;
  archiveDraft: (projectId: string, entry: NotepadEntry) => void;
  loadEntry: (projectId: string, entryId: string) => void;
  deleteEntry: (projectId: string, entryId: string) => void;
}

export const useNotepadStore = create<NotepadStoreState>()(
  persist(
    (set) => ({
      byProjectId: {},
      setDraft: (projectId, draft) =>
        set((state) => ({
          byProjectId: updateNotepadProjectState(state.byProjectId, projectId, (current) =>
            setNotepadDraft(current, draft),
          ),
        })),
      archiveDraft: (projectId, entry) =>
        set((state) => ({
          byProjectId: updateNotepadProjectState(state.byProjectId, projectId, (current) =>
            archiveNotepadDraft(current, entry),
          ),
        })),
      loadEntry: (projectId, entryId) =>
        set((state) => ({
          byProjectId: updateNotepadProjectState(state.byProjectId, projectId, (current) =>
            loadNotepadEntry(current, entryId),
          ),
        })),
      deleteEntry: (projectId, entryId) =>
        set((state) => ({
          byProjectId: updateNotepadProjectState(state.byProjectId, projectId, (current) =>
            deleteNotepadEntry(current, entryId),
          ),
        })),
    }),
    {
      name: NOTEPAD_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => notepadDebouncedStorage),
      partialize: (state) => ({ byProjectId: state.byProjectId }),
    },
  ),
);

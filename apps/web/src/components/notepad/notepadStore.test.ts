import { beforeEach, describe, expect, it } from "vite-plus/test";

import { NOTEPAD_HISTORY_CAP, selectNotepadProjectState, useNotepadStore } from "./notepadStore";

function entry(id: string, text: string, createdAt = 0) {
  return { id, text, createdAt };
}

beforeEach(() => {
  useNotepadStore.persist.clearStorage();
  useNotepadStore.setState({ byProjectId: {} });
});

describe("notepadStore", () => {
  it("returns an empty draft and history for a project that has never been touched", () => {
    const state = selectNotepadProjectState(useNotepadStore.getState().byProjectId, "alpha");
    expect(state).toEqual({ draft: "", history: [] });
  });

  it("returns an empty state for a null project id", () => {
    useNotepadStore.getState().setDraft("alpha", "hello");
    expect(selectNotepadProjectState(useNotepadStore.getState().byProjectId, null)).toEqual({
      draft: "",
      history: [],
    });
  });

  it("keeps each project's draft and history isolated from the others", () => {
    const store = useNotepadStore.getState();
    store.setDraft("alpha", "alpha draft");
    store.setDraft("beta", "beta draft");
    store.archiveDraft("alpha", entry("a1", "alpha entry"));

    expect(selectNotepadProjectState(useNotepadStore.getState().byProjectId, "alpha")).toEqual({
      draft: "",
      history: [entry("a1", "alpha entry")],
    });
    expect(selectNotepadProjectState(useNotepadStore.getState().byProjectId, "beta")).toEqual({
      draft: "beta draft",
      history: [],
    });
  });

  it("archiving clears the draft and prepends the entry to history", () => {
    const store = useNotepadStore.getState();
    store.setDraft("alpha", "write me down");
    store.archiveDraft("alpha", entry("a1", "write me down"));

    expect(selectNotepadProjectState(useNotepadStore.getState().byProjectId, "alpha")).toEqual({
      draft: "",
      history: [entry("a1", "write me down")],
    });

    store.setDraft("alpha", "second note");
    store.archiveDraft("alpha", entry("a2", "second note"));

    expect(
      selectNotepadProjectState(useNotepadStore.getState().byProjectId, "alpha").history,
    ).toEqual([entry("a2", "second note"), entry("a1", "write me down")]);
  });

  it("caps history at 100 entries, dropping the oldest", () => {
    const store = useNotepadStore.getState();
    for (let i = 0; i < NOTEPAD_HISTORY_CAP; i += 1) {
      store.archiveDraft("alpha", entry(`old-${i}`, `entry ${i}`));
    }
    expect(
      selectNotepadProjectState(useNotepadStore.getState().byProjectId, "alpha").history,
    ).toHaveLength(NOTEPAD_HISTORY_CAP);

    store.archiveDraft("alpha", entry("newest", "the newest entry"));

    const history = selectNotepadProjectState(
      useNotepadStore.getState().byProjectId,
      "alpha",
    ).history;
    expect(history).toHaveLength(NOTEPAD_HISTORY_CAP);
    expect(history[0]).toEqual(entry("newest", "the newest entry"));
    expect(history.some((item) => item.id === "old-0")).toBe(false);
  });

  it("loads an archived entry back into the draft", () => {
    const store = useNotepadStore.getState();
    store.archiveDraft("alpha", entry("a1", "archived text"));
    store.setDraft("alpha", "unrelated in-progress text");

    store.loadEntry("alpha", "a1");

    expect(selectNotepadProjectState(useNotepadStore.getState().byProjectId, "alpha").draft).toBe(
      "archived text",
    );
  });

  it("deletes an entry from history without touching the draft or other entries", () => {
    const store = useNotepadStore.getState();
    store.archiveDraft("alpha", entry("a1", "keep me"));
    store.archiveDraft("alpha", entry("a2", "delete me"));
    store.setDraft("alpha", "in-progress draft");

    store.deleteEntry("alpha", "a2");

    expect(selectNotepadProjectState(useNotepadStore.getState().byProjectId, "alpha")).toEqual({
      draft: "in-progress draft",
      history: [entry("a1", "keep me")],
    });
  });
});

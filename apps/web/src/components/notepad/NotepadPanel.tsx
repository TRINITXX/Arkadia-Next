import { useRef, useState, type ClipboardEvent as ReactClipboardEvent } from "react";
import { Check, Copy, Pencil, Trash2 } from "lucide-react";

import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";

import {
  newNotepadEntryId,
  selectNotepadProjectState,
  useNotepadStore,
  type NotepadEntry,
} from "./notepadStore";

/**
 * The notepad right-panel surface: a draft textarea, a Copy button, and the
 * archived history below it (load into editor / copy / delete). Ported from
 * Arkadia's `src/components/NotepadPanel.tsx`, stripped of the parts that
 * only exist inside Tauri (clipboard-read, screenshot-to-disk paste) and of
 * its own width/height resize handling — this component is embedded inside
 * the shared right-panel shell, which already owns resizing and width
 * memory.
 */

interface NotepadPanelProps {
  projectId: string | null;
}

export function NotepadPanel({ projectId }: NotepadPanelProps) {
  const { draft, history } = useNotepadStore((state) =>
    selectNotepadProjectState(state.byProjectId, projectId),
  );
  const setDraft = useNotepadStore((state) => state.setDraft);
  const archiveDraft = useNotepadStore((state) => state.archiveDraft);
  const loadEntry = useNotepadStore((state) => state.loadEntry);
  const deleteEntry = useNotepadStore((state) => state.deleteEntry);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const { copyToClipboard, isCopied } = useCopyToClipboard<string>({
    target: "notepad",
    onCopy: (id) => setCopiedId(id),
  });

  const archive = (text: string) => {
    if (!projectId) return;
    const entry: NotepadEntry = { id: newNotepadEntryId(), text, createdAt: Date.now() };
    archiveDraft(projectId, entry);
    copyToClipboard(text, entry.id);
    textareaRef.current?.focus();
  };

  const onCopyDraftClick = () => {
    const text = draft.trimEnd();
    if (text.trim().length === 0) return;
    archive(text);
  };

  // Selecting the whole draft and then copying or cutting it validates it —
  // archive to history and clear the editor, like the Copy button. Partial
  // selections stay plain copies handled by the browser default. We take
  // over the clipboard write (preventDefault + setData): clearing the
  // editor re-renders the textarea, which could otherwise race the native
  // default action and copy nothing.
  // Ported from Arkadia's NotepadPanel.tsx:192-202.
  const onEditorCopyOrCut = (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
    const textarea = textareaRef.current;
    if (!textarea || !projectId) return;
    if (textarea.selectionStart !== 0 || textarea.selectionEnd !== textarea.value.length) return;
    const text = textarea.value.trimEnd();
    if (text.trim().length === 0) return;
    event.preventDefault();
    event.clipboardData.setData("text/plain", text);
    const entry: NotepadEntry = { id: newNotepadEntryId(), text, createdAt: Date.now() };
    archiveDraft(projectId, entry);
    setCopiedId(entry.id);
  };

  const onCopyEntry = (entry: NotepadEntry) => {
    copyToClipboard(entry.text, entry.id);
  };

  const onLoadEntry = (entry: NotepadEntry) => {
    if (!projectId) return;
    loadEntry(projectId, entry.id);
    textareaRef.current?.focus();
  };

  const onDeleteEntry = (entry: NotepadEntry) => {
    if (!projectId) return;
    deleteEntry(projectId, entry.id);
  };

  if (!projectId) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 text-center text-xs text-muted-foreground">
        Sélectionnez un projet pour utiliser le bloc-notes.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-col gap-2 p-2">
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(event) => setDraft(projectId, event.target.value)}
          onCopy={onEditorCopyOrCut}
          onCut={onEditorCopyOrCut}
          placeholder="Écrire un prompt…"
          spellCheck={false}
          className="h-40 resize-none rounded-md border border-border bg-background p-2 text-sm leading-5 text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none"
        />
        <button
          type="button"
          onClick={onCopyDraftClick}
          disabled={draft.trim().length === 0}
          className="flex h-8 items-center justify-center gap-1.5 rounded-md border border-border bg-card text-xs text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Copy className="size-3.5" />
          <span>Copier</span>
          <span className="text-muted-foreground">Ctrl+A · Ctrl+C</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {history.length === 0 ? (
          <div className="px-1 py-2 text-xs text-muted-foreground">
            Aucun message pour l’instant — les prompts copiés arrivent ici.
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {history.map((entry) => (
              <div
                key={entry.id}
                className="group relative rounded-md border border-border/60 bg-card/40 hover:border-border"
              >
                <button
                  type="button"
                  onClick={() => onCopyEntry(entry)}
                  title="Copier dans le presse-papiers"
                  className="w-full px-2 py-1.5 text-left"
                >
                  <span className="line-clamp-3 whitespace-pre-wrap break-words text-xs leading-4 text-foreground/80">
                    {entry.text}
                  </span>
                </button>
                <div className="absolute right-1 top-1 hidden items-center gap-0.5 rounded bg-card px-0.5 group-hover:flex">
                  {isCopied && copiedId === entry.id && (
                    <Check className="size-3 text-success-foreground" />
                  )}
                  <button
                    type="button"
                    onClick={() => onLoadEntry(entry)}
                    title="Charger dans l’éditeur"
                    aria-label="Charger dans l’éditeur"
                    className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <Pencil className="size-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteEntry(entry)}
                    title="Supprimer"
                    aria-label="Supprimer"
                    className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-destructive"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

import type { EnvironmentId, SharedMemoryEntry } from "@t3tools/contracts";
import { Pin, Trash2 } from "lucide-react";

import { projectMemoryEnvironment } from "~/state/projectMemory";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { formatRelativeTimeLabel } from "~/timestampFormat";

/**
 * The shared "Project Memory" right-panel surface: a live, read-mostly view
 * of the cross-provider memory digest for the active project's cwd, streamed
 * from `WS_METHODS.subscribeProjectMemory`. Modeled on
 * `components/notepad/NotepadPanel.tsx` (history list, hover actions), but
 * backed by the RPC/Atom layer instead of a local Zustand store — pin/delete
 * are fire-and-forget commands: the server republishes onto the same PubSub
 * the subscription reads from, so the list updates on its own once the
 * mutation settles, with no client-side cache to invalidate.
 */

interface ProjectMemoryPanelProps {
  environmentId: EnvironmentId | null;
  cwd: string | null;
}

export function ProjectMemoryPanel({ environmentId, cwd }: ProjectMemoryPanelProps) {
  const memoryQuery = useEnvironmentQuery(
    environmentId === null || cwd === null
      ? null
      : projectMemoryEnvironment.stream({ environmentId, input: { cwd } }),
  );
  const pinEntry = useAtomCommand(projectMemoryEnvironment.pin, { reportFailure: false });
  const removeEntry = useAtomCommand(projectMemoryEnvironment.remove, { reportFailure: false });

  const onPin = (entry: SharedMemoryEntry) => {
    if (environmentId === null || cwd === null) return;
    void pinEntry({ environmentId, input: { cwd, key: entry.key } });
  };

  const onDelete = (entry: SharedMemoryEntry) => {
    if (environmentId === null || cwd === null) return;
    void removeEntry({ environmentId, input: { cwd, key: entry.key } });
  };

  if (environmentId === null || cwd === null) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 text-center text-xs text-muted-foreground">
        Sélectionnez un projet pour voir sa mémoire partagée.
      </div>
    );
  }

  const entries = memoryQuery.data?.entries ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex-1 overflow-y-auto p-2">
        {memoryQuery.error ? (
          <div className="px-1 py-2 text-xs text-destructive">{memoryQuery.error}</div>
        ) : memoryQuery.isPending && entries.length === 0 ? (
          <div className="px-1 py-2 text-xs text-muted-foreground">Chargement…</div>
        ) : entries.length === 0 ? (
          <div className="px-1 py-2 text-xs text-muted-foreground">
            Aucun souvenir partagé pour l’instant — les notes des différents providers arrivent
            ici.
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {entries.map((entry) => (
              <div
                key={entry.key}
                className="group relative rounded-md border border-border/60 bg-card/40 hover:border-border"
              >
                <div className="px-2 py-1.5 pr-11">
                  <div className="flex items-center gap-1.5 text-[10px] tracking-wide text-muted-foreground uppercase">
                    <span className="truncate">{entry.provider}</span>
                    <span aria-hidden>·</span>
                    <span className="shrink-0">{formatRelativeTimeLabel(entry.updatedAt)}</span>
                  </div>
                  <p className="mt-0.5 line-clamp-4 whitespace-pre-wrap break-words text-xs leading-4 text-foreground/80">
                    {entry.text}
                  </p>
                </div>
                <div className="absolute right-1 top-1 hidden items-center gap-0.5 rounded bg-card px-0.5 group-hover:flex">
                  <button
                    type="button"
                    onClick={() => onPin(entry)}
                    title="Épingler pour éviter qu’elle soit oubliée"
                    aria-label="Épingler"
                    className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <Pin className="size-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(entry)}
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

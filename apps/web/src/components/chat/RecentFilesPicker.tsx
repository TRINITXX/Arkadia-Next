import type { EnvironmentId, RecentFileEntry, RecentFilesSource } from "@t3tools/contracts";
import { FileIcon, FolderIcon, ImageIcon, Loader2Icon, SearchIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAssetUrls, useAssetUrlState } from "~/assets/assetUrls";
import { cn } from "~/lib/utils";
import { useEnvironmentQuery } from "~/state/query";
import { recentFilesEnvironment } from "~/state/recentFiles";
import {
  formatRecentFileDate,
  formatRecentFileSize,
  moveRecentFilesCursor,
  planRecentFilesInsertion,
  pruneRecentFileSelection,
  RECENT_FILES_TABS,
  RECENT_PHOTO_COLUMNS,
  recentFileAttachmentName,
  recentFilesInsertionText,
  type RecentFilesSelection,
  toggleRecentFileSelection,
} from "./RecentFilesPicker.logic";

const EMPTY_PATH_SET: ReadonlySet<string> = new Set();

/**
 * Marks the paperclip button so the panel's outside-click dismissal ignores it:
 * the panel is portalled away from the button, so without this the button's own
 * click would close the panel and immediately reopen it.
 */
export const RECENT_FILES_TRIGGER_ATTRIBUTE = "data-recent-files-trigger";

interface RecentFilesPickerProps {
  readonly environmentId: EnvironmentId;
  /** Images picked from the panel, already fetched and converted if needed. */
  readonly onAttachImages: (files: File[]) => void;
  /** Everything else, as the text to append to the prompt. */
  readonly onInsertText: (text: string) => void;
  /** Opens the operating system's own file dialog. */
  readonly onBrowse: () => void;
  readonly onClose: () => void;
}

async function fetchRecentFileAsImage(url: string, name: string): Promise<File | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const blob = await response.blob();
    if (!blob.type.startsWith("image/")) return null;
    return new File([blob], recentFileAttachmentName(name, blob.type), { type: blob.type });
  } catch {
    return null;
  }
}

/**
 * The composer's recent-files panel: the ten newest camera-roll photos as a
 * grid, and the ten newest downloads as a list. Downloads get no preview — what
 * lands there is an installer or a CSV as often as an image.
 *
 * Both tabs stay subscribed while the panel is open, so the selection can span
 * them — a screenshot and a log file in the same prompt — and so a capture taken
 * right now shows up without reopening anything. Picked images become real
 * composer attachments; everything else is inserted as a quoted path, because a
 * folder or an installer is something the agent has to go and read itself.
 */
export function RecentFilesPicker({
  environmentId,
  onAttachImages,
  onInsertText,
  onBrowse,
  onClose,
}: RecentFilesPickerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [source, setSource] = useState<RecentFilesSource>("photos");
  const [selection, setSelection] = useState<RecentFilesSelection>([]);
  const [cursor, setCursor] = useState(0);
  const [isInserting, setIsInserting] = useState(false);

  const photos = useEnvironmentQuery(
    recentFilesEnvironment.snapshot({ environmentId, input: { source: "photos" } }),
  );
  const downloads = useEnvironmentQuery(
    recentFilesEnvironment.snapshot({ environmentId, input: { source: "downloads" } }),
  );
  const active = source === "photos" ? photos : downloads;
  const entries = active.data?.entries ?? null;

  const entriesByPath = useMemo(() => {
    const known = new Map<string, RecentFileEntry>();
    for (const entry of [...(photos.data?.entries ?? []), ...(downloads.data?.entries ?? [])]) {
      known.set(entry.path, entry);
    }
    return known;
  }, [downloads.data, photos.data]);

  // A refresh can drop an entry that was picked.
  useEffect(() => {
    setSelection((current) => pruneRecentFileSelection(current, new Set(entriesByPath.keys())));
  }, [entriesByPath]);

  // Keep the cursor inside the tab actually on screen.
  useEffect(() => {
    setCursor((current) => Math.min(current, Math.max(0, (entries?.length ?? 1) - 1)));
  }, [entries]);

  // Grab focus once mounted, so the panel reads as the active surface.
  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  const insertion = useMemo(
    () => planRecentFilesInsertion(selection, entriesByPath),
    [entriesByPath, selection],
  );
  const imageResources = useMemo(
    () =>
      insertion.images.map((entry) => ({ _tag: "recent-file-image" as const, path: entry.path })),
    [insertion.images],
  );
  // Minted as soon as a photo is picked rather than on validation: issuing the
  // URL is what makes the server render a HEIC into a JPEG, and paying for that
  // while the user is still choosing keeps the insertion itself instant.
  const imageUrls = useAssetUrls(environmentId, imageResources);

  const insert = useCallback(() => {
    if (selection.length === 0 || isInserting) return;
    const finish = (attachments: File[], unavailable: ReadonlySet<string>) => {
      if (attachments.length > 0) onAttachImages(attachments);
      const text = recentFilesInsertionText(selection, insertion, unavailable);
      if (text.length > 0) onInsertText(text);
      onClose();
    };
    if (insertion.images.length === 0) {
      finish([], EMPTY_PATH_SET);
      return;
    }
    setIsInserting(true);
    void Promise.all(
      insertion.images.map((entry, index) => {
        const url = imageUrls[index];
        return url === null || url === undefined
          ? Promise.resolve(null)
          : fetchRecentFileAsImage(url, entry.name);
      }),
    ).then((files) => {
      const unavailable = new Set(
        insertion.images
          .filter((_entry, index) => files[index] === null)
          .map((entry) => entry.path),
      );
      setIsInserting(false);
      finish(
        files.filter((file): file is File => file !== null),
        unavailable,
      );
    });
  }, [imageUrls, insertion, isInserting, onAttachImages, onClose, onInsertText, selection]);

  const toggle = useCallback((path: string) => {
    setSelection((current) => toggleRecentFileSelection(current, path));
  }, []);

  // Capture-phase on window so the panel's shortcuts win over the composer's own
  // handlers — the space bar in particular is the composer's dictation hold.
  useEffect(() => {
    const handler = (event: globalThis.KeyboardEvent) => {
      const count = entries?.length ?? 0;
      const columns = source === "photos" ? RECENT_PHOTO_COLUMNS : 1;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        insert();
        return;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        event.stopPropagation();
        setSource((current) => (current === "photos" ? "downloads" : "photos"));
        setCursor(0);
        return;
      }
      if (event.key === " ") {
        const entry = entries?.[cursor];
        if (!entry) return;
        event.preventDefault();
        event.stopPropagation();
        toggle(entry.path);
        return;
      }
      const next = moveRecentFilesCursor({ cursor, key: event.key, count, columns });
      if (next === null) return;
      event.preventDefault();
      event.stopPropagation();
      setCursor(next);
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [cursor, entries, insert, onClose, source, toggle]);

  // Any click outside the panel dismisses it. The paperclip button is excluded
  // so its own click stays a plain toggle.
  useEffect(() => {
    const handler = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (rootRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest(`[${RECENT_FILES_TRIGGER_ATTRIBUTE}]`))
        return;
      onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      role="dialog"
      aria-label="Fichiers récents"
      className="dropdown-glass relative flex w-full max-w-md flex-col overflow-hidden rounded-[20px] p-2.5 outline-none"
    >
      <div className="mb-2 flex items-center gap-1" role="tablist">
        {RECENT_FILES_TABS.map((tab) => (
          <button
            key={tab.source}
            type="button"
            role="tab"
            aria-selected={source === tab.source}
            onClick={() => {
              setSource(tab.source);
              setCursor(0);
            }}
            className={cn(
              "cursor-pointer rounded-full px-3 py-1.5 text-xs transition-colors",
              source === tab.source
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground/70 hover:bg-accent/50 hover:text-foreground/80",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="h-[168px] overflow-y-auto">
        {active.error !== null ? (
          <p className="px-1 py-6 text-center text-muted-foreground/70 text-xs">{active.error}</p>
        ) : entries === null ? (
          <p className="flex items-center justify-center gap-2 py-8 text-muted-foreground/70 text-xs">
            <Loader2Icon className="size-3.5 animate-spin" aria-hidden="true" />
            Lecture du dossier…
          </p>
        ) : entries.length === 0 ? (
          <p className="px-1 py-6 text-center text-muted-foreground/70 text-xs">
            {source === "photos"
              ? "Aucune photo dans le dossier."
              : "Aucun fichier dans le dossier."}
          </p>
        ) : source === "photos" ? (
          <div className="grid grid-cols-[repeat(5,minmax(0,5rem))] justify-center gap-1.5">
            {entries.map((entry, index) => (
              <RecentPhotoTile
                key={entry.path}
                environmentId={environmentId}
                entry={entry}
                rank={selection.indexOf(entry.path)}
                atCursor={index === cursor}
                onPick={() => {
                  setCursor(index);
                  toggle(entry.path);
                }}
              />
            ))}
          </div>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {entries.map((entry, index) => (
              <RecentFileRow
                key={entry.path}
                entry={entry}
                rank={selection.indexOf(entry.path)}
                atCursor={index === cursor}
                onPick={() => {
                  setCursor(index);
                  toggle(entry.path);
                }}
              />
            ))}
          </ul>
        )}
      </div>

      <div className="mt-2.5 flex items-center justify-between gap-3 border-border/60 border-t pt-2">
        <button
          type="button"
          onClick={onBrowse}
          className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-2 py-1 text-muted-foreground/70 text-xs transition-colors hover:bg-accent/50 hover:text-foreground/80"
        >
          <SearchIcon className="size-3.5" aria-hidden="true" />
          Parcourir…
        </button>
        <span className="min-w-0 flex-1 truncate text-center text-[11px] text-muted-foreground/55">
          {selection.length === 0
            ? ""
            : `${selection.length} élément${selection.length > 1 ? "s" : ""} sélectionné${selection.length > 1 ? "s" : ""}`}
        </span>
        <button
          type="button"
          onClick={insert}
          disabled={selection.length === 0 || isInserting}
          className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full bg-accent px-2.5 py-1 text-accent-foreground text-xs transition-colors hover:bg-accent/80 disabled:cursor-not-allowed disabled:bg-transparent disabled:text-muted-foreground/40"
        >
          {isInserting ? (
            <Loader2Icon className="size-3.5 animate-spin" aria-hidden="true" />
          ) : null}
          Insérer{selection.length > 0 ? ` (${selection.length})` : ""}
        </button>
      </div>
    </div>
  );
}

interface RecentFileRowProps {
  readonly entry: RecentFileEntry;
  /** Position in the selection, or -1 when unpicked. */
  readonly rank: number;
  readonly atCursor: boolean;
  readonly onPick: () => void;
}

/** One download: no preview, just what tells two files apart at a glance. */
function RecentFileRow({ entry, rank, atCursor, onPick }: RecentFileRowProps) {
  const picked = rank >= 0;
  return (
    <li>
      <button
        type="button"
        onClick={onPick}
        title={entry.path}
        aria-pressed={picked}
        className={cn(
          "flex w-full cursor-pointer items-center gap-2 rounded-lg border px-2 py-1.5 text-left transition-colors",
          picked
            ? "border-primary/60 bg-primary/10"
            : atCursor
              ? "border-border bg-accent/40"
              : "border-transparent hover:bg-accent/40",
        )}
      >
        <span className="shrink-0 text-muted-foreground/70">
          {entry.isDirectory ? (
            <FolderIcon className="size-3.5" aria-hidden="true" />
          ) : (
            <FileIcon className="size-3.5" aria-hidden="true" />
          )}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs">{entry.name}</span>
        <span className="shrink-0 text-[10px] text-muted-foreground/50 tabular-nums">
          {formatRecentFileDate(entry.modifiedAt)}
        </span>
        <span className="w-12 shrink-0 text-right text-[10px] text-muted-foreground/60 tabular-nums">
          {formatRecentFileSize(entry)}
        </span>
        {picked ? <SelectionRank rank={rank} /> : null}
      </button>
    </li>
  );
}

interface RecentPhotoTileProps {
  readonly environmentId: EnvironmentId;
  readonly entry: RecentFileEntry;
  readonly rank: number;
  readonly atCursor: boolean;
  readonly onPick: () => void;
}

/** One square thumbnail; a photo the server can't render keeps its icon. */
function RecentPhotoTile({ environmentId, entry, rank, atCursor, onPick }: RecentPhotoTileProps) {
  const thumbnail = useAssetUrlState(environmentId, {
    _tag: "recent-file-thumbnail",
    path: entry.path,
  });
  const picked = rank >= 0;
  return (
    <button
      type="button"
      onClick={onPick}
      title={entry.name}
      aria-label={entry.name}
      aria-pressed={picked}
      className={cn(
        "relative aspect-square cursor-pointer overflow-hidden rounded-lg border transition-colors",
        picked
          ? "border-primary"
          : atCursor
            ? "border-border"
            : "border-border/40 hover:border-border",
      )}
    >
      {thumbnail._tag === "Success" ? (
        <img src={thumbnail.url} alt="" className="size-full object-cover" />
      ) : (
        <span className="flex size-full items-center justify-center bg-accent/40 text-muted-foreground/50">
          {thumbnail._tag === "Loading" ? (
            <Loader2Icon className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <ImageIcon className="size-4" aria-hidden="true" />
          )}
        </span>
      )}
      {picked ? (
        <span className="absolute top-1 right-1">
          <SelectionRank rank={rank} />
        </span>
      ) : null}
    </button>
  );
}

function SelectionRank({ rank }: { readonly rank: number }) {
  return (
    <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-primary font-semibold text-[9px] text-primary-foreground">
      {rank + 1}
    </span>
  );
}

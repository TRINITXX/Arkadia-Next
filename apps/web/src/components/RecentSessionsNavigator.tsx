import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/models";
import type { EnvironmentThreadSearchMatch } from "@t3tools/client-runtime/state/thread-search";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, OrchestrationThread, ScopedThreadRef } from "@t3tools/contracts";
import type { LegendListRef } from "@legendapp/list/react";
import {
  CalendarDaysIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  FolderIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from "react";
import { createPortal } from "react-dom";

import { deriveTimelineEntries } from "../session-logic";
import { useThreadDetail, useThreadSearch, type ThreadDetailView } from "../state/queries";
import { cn } from "../lib/utils";
import { MessagesTimeline } from "./chat/MessagesTimeline";
import {
  buildRecentSessionRows,
  formatRecentSessionDateLabel,
  formatRecentSessionTime,
  groupRecentSessionRows,
  type RecentSessionGroup,
  type RecentSessionGroupingMode,
  type RecentSessionRow,
} from "./recentSessionsNavigator.logic";

export function toggleRecentSessionGroupCollapsed(
  collapsedGroupKeys: ReadonlySet<string>,
  groupKey: string,
): ReadonlySet<string> {
  const next = new Set(collapsedGroupKeys);
  if (next.has(groupKey)) next.delete(groupKey);
  else next.add(groupKey);
  return next;
}

export interface RecentSessionsNavigatorState {
  readonly query: string;
  readonly grouping: RecentSessionGroupingMode;
  readonly selectedKey: string | null;
}

type RecentSessionsNavigatorAction =
  | { readonly type: "query-changed"; readonly query: string }
  | { readonly type: "grouping-changed"; readonly grouping: RecentSessionGroupingMode }
  | { readonly type: "session-selected"; readonly key: string };

export function createInitialRecentSessionsNavigatorState(): RecentSessionsNavigatorState {
  return { query: "", grouping: "date", selectedKey: null };
}

export function reduceRecentSessionsNavigatorState(
  state: RecentSessionsNavigatorState,
  action: RecentSessionsNavigatorAction,
): RecentSessionsNavigatorState {
  switch (action.type) {
    case "query-changed":
      return { ...state, query: action.query };
    case "grouping-changed":
      return { ...state, grouping: action.grouping };
    case "session-selected":
      return { ...state, selectedKey: action.key };
  }
}

export interface RecentSessionsNavigatorViewModel {
  readonly rows: ReadonlyArray<RecentSessionRow>;
  readonly groups: ReadonlyArray<RecentSessionGroup>;
  readonly selectedRow: RecentSessionRow | null;
  readonly now: Date;
}

export function deriveRecentSessionsNavigatorViewModel(input: {
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly contentMatches: ReadonlyArray<EnvironmentThreadSearchMatch>;
  readonly state: RecentSessionsNavigatorState;
  readonly now?: Date;
}): RecentSessionsNavigatorViewModel {
  const now = input.now ?? new Date();
  const rows = buildRecentSessionRows({
    threads: input.threads,
    projects: input.projects,
    query: input.state.query,
    contentMatches: input.contentMatches,
  });
  const selectedRow = rows.find((row) => row.key === input.state.selectedKey) ?? rows[0] ?? null;
  return {
    rows,
    groups: groupRecentSessionRows(rows, input.state.grouping, now),
    selectedRow,
    now,
  };
}

export interface RecentSessionsNavigatorProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly environmentIds: ReadonlyArray<EnvironmentId>;
  readonly onResume: (ref: ScopedThreadRef) => void;
  readonly onFocusOpenThread: (ref: ScopedThreadRef) => boolean;
}

export function resumeRecentSession(input: {
  readonly ref: ScopedThreadRef;
  readonly available: boolean;
  readonly onResume: (ref: ScopedThreadRef) => void;
  readonly onFocusOpenThread: (ref: ScopedThreadRef) => boolean;
  readonly onClose: () => void;
}): "focused" | "resumed" | "unavailable" {
  if (!input.available) return "unavailable";
  if (input.onFocusOpenThread(input.ref)) {
    input.onClose();
    return "focused";
  }
  input.onResume(input.ref);
  input.onClose();
  return "resumed";
}

export function RecentSessionsNavigator({
  open,
  onClose,
  threads,
  projects,
  environmentIds,
  onResume,
  onFocusOpenThread,
}: RecentSessionsNavigatorProps) {
  const [state, dispatch] = useReducer(
    reduceRecentSessionsNavigatorState,
    undefined,
    createInitialRecentSessionsNavigatorState,
  );
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      dispatch({ type: "query-changed", query: "" });
      dispatch({ type: "grouping-changed", grouping: "date" });
    }
    wasOpenRef.current = open;
  }, [open]);

  const search = useThreadSearch(environmentIds, state.query);
  const viewModel = useMemo(
    () =>
      deriveRecentSessionsNavigatorViewModel({
        threads,
        projects,
        contentMatches: search.matches,
        state,
      }),
    [projects, search.matches, state, threads],
  );
  const selectedRef = viewModel.selectedRow?.ref ?? null;
  const threadDetail = useThreadDetail(
    selectedRef?.environmentId ?? null,
    selectedRef?.threadId ?? null,
  );

  return (
    <RecentSessionsNavigatorView
      open={open}
      query={state.query}
      grouping={state.grouping}
      viewModel={viewModel}
      threadDetail={threadDetail}
      searchPending={search.isPending}
      onClose={onClose}
      onQueryChange={(query) => dispatch({ type: "query-changed", query })}
      onGroupingChange={(grouping) => dispatch({ type: "grouping-changed", grouping })}
      onSelect={(key) => dispatch({ type: "session-selected", key })}
      environmentIds={environmentIds}
      onResume={onResume}
      onFocusOpenThread={onFocusOpenThread}
    />
  );
}

interface RecentSessionsNavigatorViewProps {
  readonly open: boolean;
  readonly query: string;
  readonly grouping: RecentSessionGroupingMode;
  readonly viewModel: RecentSessionsNavigatorViewModel;
  readonly threadDetail: ThreadDetailView;
  readonly searchPending?: boolean;
  readonly onClose: () => void;
  readonly onQueryChange: (query: string) => void;
  readonly onGroupingChange: (grouping: RecentSessionGroupingMode) => void;
  readonly onSelect: (key: string) => void;
  readonly environmentIds: ReadonlyArray<EnvironmentId>;
  readonly onResume: (ref: ScopedThreadRef) => void;
  readonly onFocusOpenThread: (ref: ScopedThreadRef) => boolean;
}

export function RecentSessionsNavigatorView({
  open,
  query,
  grouping,
  viewModel,
  threadDetail,
  searchPending = false,
  onClose,
  onQueryChange,
  onGroupingChange,
  onSelect,
  environmentIds,
  onResume,
  onFocusOpenThread,
}: RecentSessionsNavigatorViewProps) {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [collapsedGroupKeys, setCollapsedGroupKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  useEffect(() => {
    if (open) searchInputRef.current?.focus();
  }, [open]);

  if (!open) return null;

  const selectedIndex = viewModel.selectedRow
    ? viewModel.rows.findIndex((row) => row.key === viewModel.selectedRow?.key)
    : -1;
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    if (viewModel.rows.length === 0) return;
    if (event.key === "Enter") {
      if (viewModel.selectedRow) onSelect(viewModel.selectedRow.key);
      return;
    }
    const direction = event.key === "ArrowDown" ? 1 : -1;
    const nextIndex =
      selectedIndex < 0
        ? 0
        : (selectedIndex + direction + viewModel.rows.length) % viewModel.rows.length;
    onSelect(viewModel.rows[nextIndex]!.key);
  };

  const dialog = (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      onKeyDown={handleKeyDown}
    >
      <button
        type="button"
        className="absolute inset-0 cursor-default bg-black/55 backdrop-blur-sm"
        aria-label="Fermer les sessions récentes"
        onClick={onClose}
      />
      <section
        data-content-surface=""
        role="dialog"
        aria-modal="true"
        aria-labelledby="recent-sessions-title"
        className="relative grid h-[calc(100dvh-3rem)] max-h-[1000px] w-[calc(100dvw-3rem)] max-w-[1600px] grid-cols-[minmax(360px,0.34fr)_minmax(0,0.66fr)] overflow-hidden rounded-2xl border border-border/70 bg-background shadow-2xl max-md:grid-cols-1"
      >
        <div className="flex min-h-0 flex-col border-r border-border/65 max-md:border-r-0">
          <header className="border-b border-border/65 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h2 id="recent-sessions-title" className="font-heading text-lg font-semibold">
                  Sessions récentes
                </h2>
                <p className="text-xs text-muted-foreground">
                  Toutes les conversations, tous projets et modèles
                </p>
              </div>
              <button
                type="button"
                aria-label="Fermer"
                className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                onClick={onClose}
              >
                <XIcon className="size-4" />
              </button>
            </div>
            <label className="flex items-center gap-2 rounded-lg border border-border/70 bg-muted/35 px-3 focus-within:border-ring/70">
              <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
              <input
                ref={searchInputRef}
                type="search"
                value={query}
                onChange={(event) => onQueryChange(event.currentTarget.value)}
                placeholder="Rechercher titres, projets et messages…"
                className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/65"
              />
              {searchPending ? (
                <span className="text-[10px] text-muted-foreground">Recherche…</span>
              ) : null}
            </label>
            <div
              className="mt-3 grid grid-cols-2 rounded-lg bg-muted/55 p-1"
              aria-label="Regroupement"
            >
              <GroupingButton
                active={grouping === "date"}
                icon={<CalendarDaysIcon className="size-3.5" />}
                label="Date"
                onClick={() => onGroupingChange("date")}
              />
              <GroupingButton
                active={grouping === "project"}
                icon={<FolderIcon className="size-3.5" />}
                label="Projet"
                onClick={() => onGroupingChange("project")}
              />
            </div>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {viewModel.groups.length === 0 ? (
              <p className="px-3 py-10 text-center text-sm text-muted-foreground">
                Aucune conversation trouvée.
              </p>
            ) : (
              viewModel.groups.map((group) => (
                <section key={group.key} className="mb-3 last:mb-0">
                  {grouping === "project" ? (
                    <button
                      type="button"
                      aria-expanded={!collapsedGroupKeys.has(group.key)}
                      aria-label={`${collapsedGroupKeys.has(group.key) ? "Déplier" : "Replier"} ${group.label}`}
                      className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70 hover:bg-muted/45 hover:text-foreground"
                      onClick={() =>
                        setCollapsedGroupKeys((current) =>
                          toggleRecentSessionGroupCollapsed(current, group.key),
                        )
                      }
                    >
                      {collapsedGroupKeys.has(group.key) ? (
                        <ChevronRightIcon className="size-3.5" />
                      ) : (
                        <ChevronDownIcon className="size-3.5" />
                      )}
                      <span className="truncate">{group.label}</span>
                      <span className="ml-auto tabular-nums">{group.rows.length}</span>
                    </button>
                  ) : (
                    <h3 className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                      {group.label}
                    </h3>
                  )}
                  {!collapsedGroupKeys.has(group.key) ? (
                    <div className="space-y-1">
                      {group.rows.map((row) => (
                        <RecentSessionRowButton
                          key={row.key}
                          row={row}
                          selected={row.key === viewModel.selectedRow?.key}
                          onSelect={onSelect}
                          {...(grouping === "project"
                            ? {
                                dateLabel: formatRecentSessionDateLabel(
                                  row.updatedAt,
                                  viewModel.now,
                                ),
                              }
                            : {})}
                        />
                      ))}
                    </div>
                  ) : null}
                </section>
              ))
            )}
          </div>
        </div>
        <RecentSessionPreview
          row={viewModel.selectedRow}
          threadDetail={threadDetail}
          available={
            viewModel.selectedRow !== null &&
            environmentIds.includes(viewModel.selectedRow.ref.environmentId)
          }
          onResume={onResume}
          onFocusOpenThread={onFocusOpenThread}
          onClose={onClose}
        />
      </section>
    </div>
  );
  return typeof document === "undefined" ? dialog : createPortal(dialog, document.body);
}

function GroupingButton(props: {
  readonly active: boolean;
  readonly icon: ReactElement;
  readonly label: string;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={props.active}
      className={cn(
        "flex h-7 items-center justify-center gap-1.5 rounded-md text-xs transition-colors",
        props.active
          ? "bg-background font-medium text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
      onClick={props.onClick}
    >
      {props.icon}
      {props.label}
    </button>
  );
}

export function RecentSessionRowButton({
  row,
  selected,
  onSelect,
  dateLabel,
}: {
  readonly row: RecentSessionRow;
  readonly selected: boolean;
  readonly onSelect: (key: string) => void;
  readonly dateLabel?: string;
}): ReactElement<{ readonly onClick: () => void }> {
  return (
    <button
      type="button"
      aria-label={`Aperçu de ${row.title}`}
      aria-current={selected ? "true" : undefined}
      onClick={() => onSelect(row.key)}
      className={cn(
        "w-full rounded-lg border px-3 py-2.5 text-left transition-colors",
        selected
          ? "border-primary/35 bg-primary/8"
          : "border-transparent hover:border-border/60 hover:bg-muted/45",
      )}
    >
      <span className="block truncate text-sm font-medium">{row.title}</span>
      <span className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
        <span className="truncate">{row.projectTitle}</span>
        <span aria-hidden>·</span>
        <span>{row.providerLabel}</span>
        <span aria-hidden>·</span>
        <span className="truncate">{row.modelLabel}</span>
        <span className="ml-auto flex shrink-0 flex-col items-end tabular-nums">
          {dateLabel ? <span>{dateLabel}</span> : null}
          <time dateTime={row.updatedAt}>{formatRecentSessionTime(row.updatedAt)}</time>
        </span>
      </span>
      {row.excerpt ? (
        <span className="mt-1.5 line-clamp-2 block text-xs leading-relaxed text-muted-foreground/85">
          {row.excerpt}
        </span>
      ) : null}
    </button>
  );
}

function RecentSessionPreview({
  row,
  threadDetail,
  available,
  onResume,
  onFocusOpenThread,
  onClose,
}: {
  readonly row: RecentSessionRow | null;
  readonly threadDetail: ThreadDetailView;
  readonly available: boolean;
  readonly onResume: (ref: ScopedThreadRef) => void;
  readonly onFocusOpenThread: (ref: ScopedThreadRef) => boolean;
  readonly onClose: () => void;
}) {
  if (row === null) {
    return (
      <div className="flex min-h-0 items-center justify-center p-8 text-sm text-muted-foreground">
        Sélectionnez une conversation pour afficher son aperçu.
      </div>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-col">
      <header className="border-b border-border/65 px-5 py-4">
        <h3 className="truncate font-heading text-base font-semibold">{row.title}</h3>
        <p className="mt-1 truncate text-xs text-muted-foreground">
          {row.projectTitle} · {row.providerLabel} · {row.modelLabel}
        </p>
      </header>
      <div className="min-h-0 flex-1">
        {threadDetail.isPending ? (
          <PreviewState>Chargement de la conversation…</PreviewState>
        ) : threadDetail.error !== null || threadDetail.isDeleted ? (
          <PreviewState>Aperçu indisponible pour cette conversation.</PreviewState>
        ) : threadDetail.data === null ? (
          <PreviewState>Cette conversation n’est pas disponible.</PreviewState>
        ) : threadDetail.data.messages.length === 0 ? (
          <PreviewState>Cette conversation ne contient aucun message.</PreviewState>
        ) : (
          <ReadOnlyTranscriptPreview
            thread={threadDetail.data}
            refValue={row.ref}
            workspaceRoot={row.projectWorkspaceRoot}
          />
        )}
      </div>
      <footer className="border-t border-border/65 px-5 py-3">
        <button
          type="button"
          disabled={!available}
          className="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity disabled:cursor-not-allowed disabled:opacity-45"
          onClick={() =>
            resumeRecentSession({
              ref: row.ref,
              available,
              onResume,
              onFocusOpenThread,
              onClose,
            })
          }
        >
          Reprendre la conversation
        </button>
        {!available ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Le fournisseur d’origine n’est pas disponible : reconnectez son environnement pour
            reprendre cette conversation.
          </p>
        ) : null}
      </footer>
    </div>
  );
}

function PreviewState({ children }: { readonly children: string }) {
  return (
    <div className="flex h-full items-center justify-center px-8 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function ReadOnlyTranscriptPreview({
  thread,
  refValue,
  workspaceRoot,
}: {
  readonly thread: OrchestrationThread;
  readonly refValue: ScopedThreadRef;
  readonly workspaceRoot: string | null;
}) {
  const listRef = useRef<LegendListRef | null>(null);
  const timelineEntries = useMemo(
    () => deriveTimelineEntries(thread.messages, [], []),
    [thread.messages],
  );
  return (
    <MessagesTimeline
      isWorking={false}
      activeTurnInProgress={false}
      activeTurnStartedAt={null}
      activeTurnOutputTokens={null}
      listRef={listRef}
      timelineEntries={timelineEntries}
      latestTurn={thread.latestTurn}
      runningTurnId={null}
      turnDiffSummaryByAssistantMessageId={new Map()}
      routeThreadKey={scopedThreadKey(refValue)}
      onOpenTurnDiff={() => {}}
      revertTurnCountByUserMessageId={new Map()}
      onRevertUserMessage={() => {}}
      isRevertingCheckpoint={false}
      onImageExpand={() => {}}
      activeThreadEnvironmentId={refValue.environmentId}
      markdownCwd={workspaceRoot ?? undefined}
      resolvedTheme="dark"
      timestampFormat="locale"
      workspaceRoot={workspaceRoot ?? undefined}
      anchorMessageId={null}
      onAnchorReady={() => {}}
      onAnchorSizeChanged={() => {}}
      contentInsetEndAdjustment={0}
      onIsAtEndChange={() => {}}
      onManualNavigation={() => {}}
    />
  );
}

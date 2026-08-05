# Recent Sessions Navigator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the command palette with a two-pane, cross-provider navigator for every stored conversation, with full-text search, preview, grouping, and safe resume.

**Architecture:** The web client already owns the complete thread-shell projection and cross-environment content-search API. Add a dedicated overlay launched from the Arkadia sidebar; keep pure list composition in a small logic module, and load the selected thread detail only for the read-only preview. Resuming navigates to the existing thread route, focusing an already-open thread rather than duplicating it.

**Tech Stack:** React, TypeScript, TanStack Router, Effect atom-backed client runtime, Tailwind CSS, Vitest.

## Global Constraints

- Replace the current command-palette entry point and do not preserve command-palette actions or shortcuts.
- Include conversations from every connected provider and environment.
- Search titles, project metadata, and user/assistant conversation text.
- Default every ordering to newest-first; offer `Date` and `Project` grouping.
- Selecting a result must only preview it. Navigation/resume is explicit.
- A selected thread already present in the workspace must be focused rather than duplicated.

---

### Task 1: Define the navigator list model

**Files:**

- Create: `apps/web/src/components/recentSessionsNavigator.logic.ts`
- Test: `apps/web/src/components/recentSessionsNavigator.logic.test.ts`

**Interfaces:**

- Consumes: `EnvironmentThreadShell`, projects, and optional content-search matches.
- Produces: `buildRecentSessionRows(input): RecentSessionRow[]` and `groupRecentSessionRows(rows, mode): RecentSessionGroup[]`.

- [ ] **Step 1: Write failing unit tests** for title/project matching, content-match merging, newest-first ordering, date buckets, and project groups whose rows remain newest-first.
- [ ] **Step 2: Run the focused test file** and confirm it fails because the model module does not exist.
- [ ] **Step 3: Implement the typed row and group model.** Deduplicate search matches by scoped environment/thread key; retain provider label, model label, project reference, title, update time, and optional excerpt.
- [ ] **Step 4: Run the focused tests** and confirm the date and project representations produce the same complete result set in their respective layouts.
- [ ] **Step 5: Commit** the pure model and tests as `feat: model recent session navigation`.

### Task 2: Build the read-only two-pane overlay

**Files:**

- Create: `apps/web/src/components/RecentSessionsNavigator.tsx`
- Create: `apps/web/src/components/recentSessionsNavigator.test.tsx`
- Reuse: `apps/web/src/components/chat/MessagesTimeline.tsx` only through a read-only preview adapter; do not mount `ChatView` because it creates a composer and mutable thread actions.

**Interfaces:**

- Consumes: `open`, `onClose`, `threads`, `projects`, `environmentIds`, `onResume(ref)`, and `onFocusOpenThread(ref)`.
- Uses: `useThreadSearch` for debounced cross-environment content search and `useThreadDetail` for the selected transcript.

- [ ] **Step 1: Write failing component tests** for opening with the newest session selected, filtering after a multi-word query, switching Date/Project grouping, selecting a result without navigation, and rendering provider/model/project metadata.
- [ ] **Step 2: Run the component test file** and confirm it fails because the overlay is absent.
- [ ] **Step 3: Implement the overlay.** Put the search input and compact Date/Project switcher above the scrollable left list; render a right-side read-only transcript preview with loading, empty, and unavailable states; focus the search field on open; support Escape to close and arrow keys/Enter to select without navigating.
- [ ] **Step 4: Run the component tests** and confirm preview selection never invokes either resume callback.
- [ ] **Step 5: Commit** the overlay and tests as `feat: add recent sessions navigator`.

### Task 3: Implement explicit resume/focus behavior

**Files:**

- Modify: `apps/web/src/components/RecentSessionsNavigator.tsx`
- Modify: `apps/web/src/components/recentSessionsNavigator.test.tsx`
- Modify: `apps/web/src/components/ArkadiaWorkspaceTabs.tsx` only if it needs a narrow exported lookup for an already-open scoped thread.

**Interfaces:**

- `onResume(ref)` navigates using `buildThreadRouteParams(ref)`.
- `onFocusOpenThread(ref)` selects the matching workspace tab if one exists.

- [ ] **Step 1: Write failing tests** for the primary action: an open session focuses its existing tab; a closed session navigates to its own environment/thread route; both close the overlay after success.
- [ ] **Step 2: Run the focused tests** and confirm they fail before callbacks are wired.
- [ ] **Step 3: Add the labelled `Reprendre la conversation` action** in the preview header/footer, with a provider-unavailable state that prevents unsupported resumes and explains why.
- [ ] **Step 4: Run the focused tests** and confirm neither path creates a second tab.
- [ ] **Step 5: Commit** as `feat: resume sessions from navigator`.

### Task 4: Replace the command palette surface

**Files:**

- Modify: `apps/web/src/components/ArkadiaSidebar.tsx`
- Modify: `apps/web/src/components/ArkadiaSidebar.test.tsx` (or create it if absent)
- Modify: `apps/web/src/components/CommandPalette.tsx` and its tests to remove its application mounting and keyboard registration.
- Modify: `apps/web/src/commandPaletteBus.ts` and tests to remove dead open actions, or delete it once all imports are removed.

**Interfaces:**

- The sidebar button opens `RecentSessionsNavigator` rather than publishing a command-palette event.

- [ ] **Step 1: Write failing sidebar tests** asserting that clicking `Sessions récentes` opens the navigator and that no command-palette UI is mounted.
- [ ] **Step 2: Run the focused test file** and confirm the old button still routes to the command palette.
- [ ] **Step 3: Replace the sidebar handler and remove the command-palette surface, hotkeys, bus, and orphaned add-project action.** Preserve the existing sidebar’s projects and workspace tabs.
- [ ] **Step 4: Run sidebar and command-palette-adjacent tests** and confirm the only sessions entry point is the navigator.
- [ ] **Step 5: Commit** as `feat: replace command palette with sessions navigator`.

### Task 5: Verify the integrated behavior

**Files:**

- Modify only tests required by the prior tasks.

- [ ] **Step 1: Run targeted unit and component tests** for the new model, overlay, sidebar, thread search, and workspace tabs.
- [ ] **Step 2: Run `npx tsc --noEmit`** from the Arkadia Next repository and fix all errors caused by removing the palette.
- [ ] **Step 3: Run the web lint/test command defined by the repository package scripts.**
- [ ] **Step 4: Manually verify** Date and Project grouping, a multi-word content search, preview-only selection, closed-session resume, and already-open-session focus.
- [ ] **Step 5: Commit the final verification fixes** only if the preceding steps required code changes.

## Self-Review

- Full-text search: Tasks 1 and 2 reuse `useThreadSearch` and merge text matches with metadata.
- All models and projects: Tasks 1 and 2 carry environment/provider/model and project data from thread shells.
- Two sorts: Task 1 defines date and project grouping; Task 2 exposes both controls.
- Right-side preview: Task 2 provides a dedicated immutable transcript renderer.
- Resume and no duplicate tabs: Task 3 makes navigation explicit and focuses an open tab.
- Full replacement of the command palette: Task 4 removes its UI, event bus, actions, and shortcuts.

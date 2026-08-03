# Arkadia Toolbar Implementation Plan — Lot 1

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the chat header that sits under the workspace tab bar with Arkadia's toolbar: a customisable tree of action buttons and folders on the left, and system buttons on the right (notepad, settings), plus a sidebar-collapse button on the far left and a shortcut row under the composer.

**Architecture:** Port Arkadia's toolbar model verbatim where it is pure (tree operations, icon registry) and re-implement its React surfaces on this repo's primitives (Base UI, Tailwind v4, TanStack Router, `@dnd-kit/core`). The button tree is a user preference, so it lives in `ClientSettingsSchema` and persists through the existing client-settings pipeline. Action buttons run their command by opening a terminal and writing the command into it — reusing the existing terminal RPC, with no server change in this lot.

**Tech Stack:** React 19, TypeScript, Effect Schema, TanStack Router, Zustand, Base UI, Tailwind v4, `@dnd-kit/core`, `lucide-react`, vite-plus tests.

**Source project being ported:** `C:\Users\TRINITX\Desktop\Claude Desktop\Arkadia` (Tauri + React 18). Read its files directly when a task names them. Nothing in that project is modified — it is a read-only reference.

## Global Constraints

- **Scope of this lot.** Terminals stay attached to a thread and open in the bottom terminal drawer. Making terminals project-scoped and giving them full-screen tabs in the top tab bar is Lot 2 and is explicitly out of scope here. Do not touch `packages/contracts/src/terminal.ts`, `apps/server/src/terminal/`, or `ArkadiaWorkspaceTabs.tsx`.
- **Two Arkadia buttons are deliberately dropped:** the font-size toggle (`ALargeSmall`) and the "modern view" reading mode (`BookOpen`). Never port them.
- **Follow surrounding code, not generic style rules.** Component files are `PascalCase.tsx` in this repo (`ChatHeader.tsx`, `ArkadiaSidebar.tsx`) — do not rename anything to kebab-case. Match the export style of the file you touch.
- **No `any`.** Use `unknown` when a type is genuinely uncertain.
- **User-visible labels are in French**, matching `ArkadiaWorkspaceTabs.tsx` ("Nouvelle conversation", "Nouvel onglet", "Fermer"). Code, identifiers, comments and commit messages are in English.
- **Pure logic lives in a sibling file and is tested without React** — the repo's dominant pattern (`arkadiaSidebarModel.ts` / `.test.ts`, `ChatView.logic.ts` / `.logic.test.ts`). Tests import from `"vite-plus/test"`, never `"vitest"`. There is no jsdom: component assertions use `renderToStaticMarkup` from `react-dom/server`.
- **Verification is scoped.** Run `vp test run <files you touched>` and `vp run --filter @t3tools/web typecheck` (plus `--filter @t3tools/contracts` when contracts change). Never run repo-wide checks (`vp check`, `vp run -r test`, `vp run -r typecheck`).
- **Commit only your own files.** Never `git add -A` and never `git add .`. Stage the explicit paths your task created or modified. An untracked `apps/server/.claude-work-test/` directory exists and must never be committed.
- **Any settings field must be declared twice**: in `ClientSettingsSchema` (`packages/contracts/src/settings.ts:65`) _and_ in `ClientSettingsPatch` (`:678`). A field missing from the patch schema is silently dropped on write — `dismissedProviderUpdateNotificationKeys` is an existing instance of this bug; do not reproduce it.
- **No user-visible dead controls.** A button that ships must do something.

---

### Task 1: Toolbar contracts, tree operations and icon registry

**Files:**

- Create: `packages/contracts/src/toolbar.ts`
- Modify: `packages/contracts/src/settings.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `apps/web/src/components/toolbar/toolbarTree.ts`
- Create: `apps/web/src/components/toolbar/toolbarTree.test.ts`
- Create: `apps/web/src/components/toolbar/toolbarIcons.ts`

**Interfaces:**

- Produces: `ToolbarActionButton`, `ToolbarFolderButton`, `ToolbarButton`, `MAX_TOOLBAR_FOLDER_DEPTH`, `DEFAULT_TOOLBAR_BUTTONS`, `DEFAULT_PROMPT_BUTTONS`, and the settings fields `toolbarButtons` / `promptButtons`.
- Produces: `findItem`, `depthOf`, `subtreeHeight`, `isDescendant`, `removeItem`, `insertItem`, `moveItem`, `canAddFolder`, `reindexOrder`, `updateItem`, `countDescendants`, `createActionButton`, `createFolderButton`.
- Produces: `TOOLBAR_ICONS` (name → lucide component) and `getToolbarIcon(name): LucideIcon | null`.

**Reference sources (read these):**

- `Arkadia/src/types.ts:156-194` — the `ActionButton` / `FolderButton` / `ToolbarButton` union and `MAX_FOLDER_DEPTH = 3`.
- `Arkadia/src/lib/toolbarTree.ts` — all tree operations, pure TypeScript with zero dependencies. Port them as-is; they have no tests in the source project, which is why this task writes them.
- `Arkadia/src/icons.ts` — the 66-entry `ICON_MAP`.
- The default button tree is provided as JSON at the path given in your dispatch. Convert it to a typed TypeScript literal.

**Shape notes:**

- `ToolbarActionButton`: `{ id, kind: "action", label, icon, command, order }`. Arkadia's prompt-bar-only fields (`submit`, `mode`, `keys`, `keysLabel`) are needed by Task 6 — include `submit` (optional boolean) and omit the PTY-keystroke fields (`mode`, `keys`, `keysLabel`), which only make sense for a raw terminal.
- `ToolbarFolderButton`: `{ id, kind: "folder", label, icon, children, order }`, recursive.
- The union is recursive, so the Effect Schema needs `Schema.suspend` for `children`. Verify the schema actually decodes a three-level fixture in a test before moving on.
- `icon` is a string slug, never a component. `getToolbarIcon` returns `null` for an unknown slug so persisted data can never crash the render.
- `order` is dense: `reindexOrder` rewrites `order = index` recursively after every mutation.
- `moveItem` enforces every invariant: no move into itself, no move into its own descendant, and `targetDepth + 1 + subtreeHeight(moved) < MAX_TOOLBAR_FOLDER_DEPTH`.
- New ids come from `crypto.randomUUID()`, not `Date.now()`.

- [ ] Write failing tests for the tree operations: reordering within a level, moving into and out of a folder, refusing a move into a descendant, refusing a move that would exceed depth 3, dense reindexing after removal, and recursive descendant counting.
- [ ] Write a failing test proving `ClientSettingsSchema` decodes an empty object to the full default toolbar tree, and that a three-level fixture round-trips through encode/decode.
- [ ] Run `vp test run apps/web/src/components/toolbar/toolbarTree.test.ts` and observe RED.
- [ ] Implement `packages/contracts/src/toolbar.ts`, export it from `index.ts`, and add `toolbarButtons` / `promptButtons` to both `ClientSettingsSchema` and `ClientSettingsPatch`.
- [ ] Implement `toolbarTree.ts` and `toolbarIcons.ts`.
- [ ] Re-run the tests and observe GREEN.
- [ ] Run `vp run --filter @t3tools/contracts --filter @t3tools/web typecheck`.
- [ ] Commit with `feat(web): add toolbar button tree contracts and operations`.

### Task 2: Strip the chat header and render the toolbar shell

**Files:**

- Create: `apps/web/src/components/toolbar/ArkadiaToolbar.tsx`
- Modify: `apps/web/src/components/ChatView.tsx`
- Modify: `apps/web/src/components/AppSidebarLayout.tsx`
- Delete: `apps/web/src/components/chat/ChatHeader.tsx`
- Delete: `apps/web/src/components/chat/ChatHeader.test.ts`

**Interfaces:**

- Produces: `ArkadiaToolbar`, rendered where `ChatHeader` used to be (`ChatView.tsx:5758`, inside the `<header data-chat-header>` opened at `:5742`).
- Consumes: `useSidebar` (from `~/components/ui/sidebar`), `useNavigate`, and the terminal opening path already used by `runProjectScript` (`ChatView.tsx:2792`).

**What is removed** — all of it, with the props and imports that become unused:

- The breadcrumb: project favicon, project name, `/` separator, and thread title (`ChatHeader.tsx:89-135`).
- `ProjectScriptsControl` (the `test` button), `OpenInPicker` (`Open`), and `GitActionsControl` (`Initialize Git`) from the header. Leave the components themselves in the repo — `GitActionsControl` is still reachable from the command palette, and `ProjectScriptsControl` still owns script CRUD used elsewhere. Only their header call sites go.
- The right-panel toggle button (`PanelRightIcon`) from `PanelLayoutControls.tsx:67`.

**What the shell contains**, left to right:

1. Sidebar collapse toggle (`PanelLeftClose` / `PanelLeftOpen`), mirroring `Arkadia/src/components/Toolbar.tsx:56-71`. The left sidebar is currently `collapsible="none"` outside settings (`AppSidebarLayout.tsx:184`) — switch the chat case to `"offcanvas"` so it can actually collapse, and keep the settings case exactly as it is.
2. A flexible empty region — Task 3 fills it with the user's buttons.
3. Notepad button (`NotebookPen`) — wired in Task 5. **Do not ship it inert:** in this task it is not rendered at all. Task 5 adds it.
4. Settings button (`SettingsIcon`) navigating to `/settings`. This restores an access path that no longer exists anywhere in the chat view since the sidebar was replaced.
5. The terminal toggle (`PanelBottomIcon`) kept from `PanelLayoutControls`, but its behaviour changes: instead of toggling the drawer, each click opens the drawer and creates a **new** terminal in it. Reuse the terminal-allocation logic already in `runProjectScript` (`ChatView.tsx:2792-2885`) — extract the "allocate a fresh terminal id, set launch context, open the drawer, call `openTerminal`" part into a reusable callback rather than duplicating it, since Task 3 needs the same thing.

**Layout:** the toolbar keeps the existing header's height and border. Match the visual density of `ArkadiaWorkspaceTabs.tsx:253` (`h-9`, `border-b border-zinc-800 bg-zinc-950 text-zinc-300`) so the two bars read as one unit.

- [ ] Extract the terminal-opening callback from `runProjectScript` so it can be called with no script, returning the new terminal id.
- [ ] Create `ArkadiaToolbar` with the sidebar toggle, the empty flexible region, the settings button, and the terminal button.
- [ ] Replace the `ChatHeader` call site in `ChatView.tsx` (import at `:228`, usage at `:5758`) and delete `ChatHeader.tsx` along with its now-unused props threading. `ChatHeader.test.ts` only covers `shouldShowOpenInPicker`, which dies with the header — delete it too rather than keeping a test for deleted code.
- [ ] Remove the right-panel toggle from `PanelLayoutControls.tsx`, keeping `RightPanelMaximizeControl` reachable when the panel is open.
- [ ] Make the chat-route sidebar collapsible in `AppSidebarLayout.tsx`.
- [ ] Run `vp test run` on any test touching the changed files, then `vp run --filter @t3tools/web typecheck`.
- [ ] Commit with `feat(web): replace chat header with the Arkadia toolbar shell`.

### Task 3: Render and run the customisable button tree

**Files:**

- Create: `apps/web/src/components/toolbar/ToolbarActionButton.tsx`
- Create: `apps/web/src/components/toolbar/ToolbarFolderButton.tsx`
- Modify: `apps/web/src/components/toolbar/ArkadiaToolbar.tsx`

**Interfaces:**

- Consumes: `useClientSettings((s) => s.toolbarButtons)`, `getToolbarIcon`, and the terminal callback extracted in Task 2.
- Produces: the rendered tree in the toolbar's flexible region.

**Reference source:** `Arkadia/src/components/Toolbar.tsx:146-373` — `ActionToolbarButton` and `FolderToolbarButton` with its cascading popover.

**Behaviour:**

- Root-level items render sorted by `order`, in a horizontally scrollable region.
- A folder opens a popover that **drills down in place**: a `path: ToolbarFolderButton[]` state with a back arrow and the current folder's name in the header, not nested submenus (`Toolbar.tsx:193`, `:304-318`). Escape pops one level, then closes. Clicking outside closes.
- Build the popover on this repo's `~/components/ui/popover` (Base UI) rather than porting Arkadia's manual `getBoundingClientRect` positioning.
- **Clicking an action button always opens a brand-new terminal** and writes `command + "\r"` into it. Never reuse an existing terminal, so a running command can never be interrupted.
- Arkadia waits `TOOLBAR_RUN_DELAY_MS` before writing, to let the shell and PSReadLine start. Check whether this repo's terminal open path already resolves before the PTY accepts input; if a delay is genuinely needed, name the constant and comment why.
- A button with no icon renders its label alone; an unknown icon slug renders no icon rather than crashing.

- [ ] Write a failing test for the pure part: given a tree and a drill-down path, which items render and what the back-navigation produces.
- [ ] Implement the action and folder buttons and mount the tree in the toolbar's flexible region.
- [ ] Verify a three-level folder opens, drills down, navigates back, and closes on Escape.
- [ ] Run the touched tests and `vp run --filter @t3tools/web typecheck`.
- [ ] Commit with `feat(web): render and run the toolbar button tree`.

### Task 4: Toolbar composition screen in Settings

**Files:**

- Create: `apps/web/src/routes/settings.toolbar.tsx`
- Create: `apps/web/src/components/settings/ToolbarSettingsPanel.tsx`
- Create: `apps/web/src/components/toolbar/IconPicker.tsx`
- Modify: `apps/web/src/components/settings/SettingsSidebarNav.tsx`
- Modify: `apps/web/src/components/settings/settingsSearch.ts`

**Interfaces:**

- Produces: `ToolbarSettingsPanel`, reusable for Task 6 by parameterising which settings key it edits and whether the "submit" field shows.
- Consumes: `useUpdatePrimarySettings`, the tree operations from Task 1, `@dnd-kit/core`.

**Reference source:** `Arkadia/src/components/ToolbarSettings.tsx` (tree pane + editor pane in one `DndContext`) and `Arkadia/src/components/IconPicker.tsx`.

**Behaviour:**

- Two panes side by side: a tree on the left (drag handle, expand chevron, icon, label, plus in-folder `+ action` / `+ folder` bars) and an editor on the right for the selected item.
- Drag and drop with three drop targets, exactly as the source models them: `{ kind: "before", itemId, parentId }`, `{ kind: "into", folderId }`, `{ kind: "root-end" }` (`ToolbarSettings.tsx:64-67`). The `into` target is disabled when it would create a cycle or exceed depth 3.
- `PointerSensor` with `activationConstraint: { distance: 4 }`, plus a `DragOverlay` preview.
- Deleting a folder asks for confirmation. Arkadia uses Tauri's native `ask()` — replace it with this repo's `~/components/ui/alert-dialog`, and say how many descendants will be deleted.
- The icon picker is a popover with a search field, a grid of the registry's icons, and a clear button.
- Every mutation writes the whole tree through `useUpdatePrimarySettings` after `reindexOrder`.
- Register the section in `SettingsSidebarNav.tsx` and `settingsSearch.ts` so it is reachable and searchable, following what the existing nine sections do.

- [ ] Add the route, the nav entry and the search entries.
- [ ] Implement the tree pane with drag and drop and the three drop targets.
- [ ] Implement the action editor (label, icon, command) and the folder editor (label, icon, delete with confirmation).
- [ ] Implement the icon picker.
- [ ] Verify end to end: create a folder, drag a button into it, rename it, change its icon, and confirm the toolbar reflects it.
- [ ] Run the touched tests and `vp run --filter @t3tools/web typecheck`.
- [ ] Commit with `feat(web): add the toolbar composition settings screen`.

### Task 5: Notepad panel

**Files:**

- Create: `apps/web/src/components/notepad/NotepadPanel.tsx`
- Create: `apps/web/src/components/notepad/notepadStore.ts`
- Create: `apps/web/src/components/notepad/notepadStore.test.ts`
- Modify: `apps/web/src/rightPanelStore.ts`
- Modify: `apps/web/src/components/RightPanelTabs.tsx`
- Modify: `apps/web/src/components/ChatView.tsx`
- Modify: `apps/web/src/components/toolbar/ArkadiaToolbar.tsx`

**Interfaces:**

- Produces: a `"notepad"` right-panel surface and the toolbar button that opens it.
- Consumes: the right-panel store's existing surface machinery.

**Reference source:** `Arkadia/src/components/NotepadPanel.tsx` and `Arkadia/src/lib/notepadStore.ts`.

**Behaviour:**

- **Content is scoped per project**, keyed by project id: `{ draft: string, history: NotepadEntry[] }` with `NotepadEntry = { id, text, createdAt }`, capped at 100 entries. Existing Arkadia notes are **not** imported — every project starts empty.
- Persist with Zustand's `persist` middleware, the pattern `rightPanelStore.ts:238` and `terminalUiStateStore.ts` already use. Do not put this in `ClientSettingsSchema`: note content is data, not a preference.
- The panel is a right-panel surface, so the panel's own resizing and width memory come for free — do not re-implement them.
- A draft textarea on top, a Copy button, and the history list below (load into editor / copy / delete).
- Port the validation gesture from the source: selecting the whole draft and copying or cutting it archives it into history and clears the editor (`NotepadPanel.tsx:192-202`).
- The surface is a singleton (`rightPanelStore.ts:85`).
- **Bump `RIGHT_PANEL_STORAGE_VERSION` (`rightPanelStore.ts:43`) and handle the new version in `migratePersistedRightPanelState` (`:156`)** — skipping this corrupts every persisted panel state.
- Add the toolbar's `NotebookPen` button, which opens the panel and focuses this surface.

- [ ] Write failing tests for the store: per-project isolation, history cap at 100, archive-on-validate, and delete.
- [ ] Implement the store and observe GREEN.
- [ ] Add the `"notepad"` surface kind, bump the storage version, and write the migration.
- [ ] Implement the panel and register it in the right-panel tab chrome and the `ChatView` content switch (`:5656`).
- [ ] Add the toolbar button.
- [ ] Run the touched tests and `vp run --filter @t3tools/web typecheck`.
- [ ] Commit with `feat(web): add the notepad right panel`.

### Task 6: Composer shortcut row

**Files:**

- Create: `apps/web/src/components/chat/ComposerShortcutBar.tsx`
- Modify: `apps/web/src/components/chat/ChatComposer.tsx`
- Create: `apps/web/src/routes/settings.prompt-buttons.tsx`
- Modify: `apps/web/src/components/settings/SettingsSidebarNav.tsx`
- Modify: `apps/web/src/components/settings/settingsSearch.ts`

**Interfaces:**

- Consumes: `useClientSettings((s) => s.promptButtons)`, the same rendering components as Task 3, and `ToolbarSettingsPanel` from Task 4.
- Produces: a row of buttons under the message field that insert text into the composer.

**Reference source:** `Arkadia/src/components/PromptBar.tsx` — the twin of the toolbar, sharing its button components with `dropup` popovers.

**Behaviour:**

- Clicking a button inserts its `command` into the composer at the caret. When `submit` is true, it also sends the message.
- Defaults are the four the user already has: `/commit`, `/clear`, `/compact`, `/resume`.
- Folder popovers open upward, since the row sits at the bottom of the screen.
- The settings screen is the Task 4 panel pointed at `promptButtons`, with the "submit after inserting" checkbox shown. Do not duplicate the editor.
- `ChatComposer.tsx` was touched by the voice work committed just before this plan started — read it before editing and leave the dictation code alone.

- [ ] Add the settings route reusing the Task 4 panel against `promptButtons`.
- [ ] Implement the shortcut row with upward-opening folder popovers.
- [ ] Wire insertion at the caret, and submission when `submit` is set.
- [ ] Run the touched tests and `vp run --filter @t3tools/web typecheck`.
- [ ] Commit with `feat(web): add the composer shortcut row`.

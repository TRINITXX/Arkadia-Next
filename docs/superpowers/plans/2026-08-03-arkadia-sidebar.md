# Arkadia Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace T3's chat sidebar presentation with the current Arkadia sidebar while keeping T3's projects, durable threads, routing, provider sessions, and command palette.

**Architecture:** Add a pure projection that maps T3 projects and threads into Arkadia Active/Inactive groups, then render a dedicated `ArkadiaSidebar` component. Wire it only on chat routes; settings keep T3's settings navigation. No T3 server or provider code changes.

**Tech Stack:** React, TypeScript, TanStack Router, Effect Atom, Zustand, Tailwind CSS, Vite+ tests.

## Global Constraints

- The T3 chat timeline and composer remain unchanged.
- The sidebar is fixed at 224 px, matching Arkadia's `w-56` source.
- Active projects contain at least one visible non-settled thread.
- Inactive projects contain no visible non-settled thread.
- Archived threads do not appear in either project list; the command palette remains the history browser.
- Clicking a thread navigates to that T3 thread.
- Clicking a project opens its most recently updated active thread, then its most recent settled thread, then creates a new draft if it has no thread.
- Middle-clicking an active thread settles it; middle-clicking an active project settles every settleable child thread.
- `Sessions récentes` opens T3's command palette; `+ New project` opens its add-project flow.
- Settings routes continue rendering T3's existing settings sidebar.
- No user-visible dead controls.

---

### Task 1: Project T3 state into Arkadia sidebar groups

**Files:**

- Create: `apps/web/src/components/arkadiaSidebarModel.ts`
- Create: `apps/web/src/components/arkadiaSidebarModel.test.ts`

**Interfaces:**

- Produces: `buildArkadiaSidebarGroups`, `arkadiaProjectColor`, and `shortenArkadiaProjectPath`.
- Consumes: T3 `EnvironmentProject`, `EnvironmentThreadShell`, and `effectiveSettled`.

- [x] Write failing tests proving active/inactive partitioning, archived-thread exclusion, newest-thread ordering, stable colors, and compact paths.
- [x] Run `vp test run apps/web/src/components/arkadiaSidebarModel.test.ts` and observe RED because the module does not exist.
- [x] Implement the minimal pure projection.
- [x] Re-run the test and observe GREEN.

### Task 2: Render the Arkadia sidebar over T3 state

**Files:**

- Create: `apps/web/src/components/ArkadiaSidebar.tsx`
- Modify: `apps/web/src/components/AppSidebarLayout.tsx`

**Interfaces:**

- Consumes: `useProjects`, `useThreadShells`, `useThreadActions`, `useNewThreadHandler`, `useClientSettings`, `useParams`, and `useRouter`.
- Produces: the fixed-width Arkadia Active/Inactive sidebar for chat routes.

- [x] Render the two-tab header with Arcadia's exact spacing, colors, typography, borders, and empty states.
- [x] Render active project groups with a stable left color bar and child thread rows.
- [x] Render inactive project rows with project name and compact path.
- [x] Wire thread/project navigation, new-thread fallback, middle-click settlement, recent sessions, and add-project.
- [x] Replace T3's chat sidebar selection in `AppSidebarLayout`; preserve `ThreadSidebar` on settings routes.
- [x] Remove resizing on chat routes and set `--sidebar-width` to `14rem`.

### Task 3: Verify the vertical slice

**Files:**

- No production files expected beyond Tasks 1 and 2.

- [x] Run `vp test run apps/web/src/components/arkadiaSidebarModel.test.ts apps/web/src/components/branding.test.ts`.
- [x] Run `npx tsc --noEmit` as required by the workspace workflow (root has no `tsconfig.json`; the scoped web typecheck below is authoritative).
- [x] Run `vp run --filter @t3tools/web typecheck`.
- [x] Run `vp run build:desktop`.
- [x] Run `vp run test:desktop-smoke`.
- [ ] Commit with `feat(web): replace chat sidebar with Arkadia layout`.
- [ ] Push `codex/arkadia-shell` without creating a pull request or merging.

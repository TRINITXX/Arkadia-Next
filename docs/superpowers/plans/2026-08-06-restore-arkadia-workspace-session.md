# Arkadia Workspace Session Restore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the last active Arkadia workspace tab without creating an extra new-conversation draft, select the matching sidebar section, and theme the recent-sessions surface like the selected terminal palette.

**Architecture:** Persist one global last-active workspace tab key alongside the already-persisted open conversation keys. Resolve the `/` startup target from persisted tabs and hydrated threads/drafts before falling back to the existing inactive-project draft landing. Keep sidebar startup selection and recent-session palette application as small, testable presentation decisions.

**Tech Stack:** React 19, TanStack Router, Zustand, Vite Plus tests, Tailwind CSS.

## Global Constraints

- Inactive projects keep their reusable `Nouvelle conversation` draft behavior when explicitly opened.
- Active projects must not receive a new draft during application startup.
- Existing open tabs remain the source of truth for active projects.
- No browser or computer-use verification without explicit user permission.
- Work is performed on the current clean `main` checkout because the user requested the change in this workspace; no commit or PR is implied.

---

### Task 1: Persist and resolve the restored workspace tab

**Files:**

- Modify: `apps/web/src/uiStateStore.ts`
- Modify: `apps/web/src/uiStateStore.test.ts`
- Create: `apps/web/src/routes/chatIndexRestore.ts`
- Create: `apps/web/src/routes/chatIndexRestore.test.ts`
- Modify: `apps/web/src/routes/_chat.index.tsx`
- Modify: `apps/web/src/components/ArkadiaWorkspaceTabs.tsx`

**Interfaces:**

- Produces: `lastActiveWorkspaceTabKey: string | null`, `setLastActiveWorkspaceTabKey(tabKey)` and `resolveChatIndexRestoreTarget(input)`.
- Consumes: persisted open thread tab keys, hydrated thread shells, and hydrated draft sessions.

- [ ] **Step 1: Write failing persistence and startup-resolution tests**

```ts
expect(
  parsePersistedState({ lastActiveWorkspaceTabKey: "local:thread-1" }).lastActiveWorkspaceTabKey,
).toBe("local:thread-1");
expect(
  resolveChatIndexRestoreTarget({
    lastActiveWorkspaceTabKey: "local:thread-1",
    openWorkspaceThreadTabKeys: ["local:thread-1"],
    threads: [threadOne],
    drafts: {},
  }),
).toEqual({ kind: "thread", environmentId: "local", threadId: "thread-1" });
```

- [ ] **Step 2: Run focused tests and verify they fail because the persisted field and resolver do not exist**

Run: `.\node_modules\.bin\vp.cmd test run apps/web/src/uiStateStore.test.ts apps/web/src/routes/chatIndexRestore.test.ts`

- [ ] **Step 3: Implement minimal persistence, active-tab recording, and startup navigation**

```ts
type ChatIndexRestoreTarget =
  | { readonly kind: "thread"; readonly environmentId: string; readonly threadId: string }
  | { readonly kind: "draft"; readonly draftId: string }
  | null;
```

The resolver must accept only an open, non-archived thread or a hydrated, unpromoted draft. If the saved active key is stale, it may fall back to another persisted open conversation; it must return `null` when no prior active workspace tab is restorable so the existing inactive-project draft landing remains available.

- [ ] **Step 4: Run the focused tests and verify they pass**

Run: `.\node_modules\.bin\vp.cmd test run apps/web/src/uiStateStore.test.ts apps/web/src/routes/chatIndexRestore.test.ts`

### Task 2: Select the correct sidebar section after restoration

**Files:**

- Modify: `apps/web/src/components/arkadiaSidebarModel.ts`
- Modify: `apps/web/src/components/arkadiaSidebarModel.test.ts`
- Modify: `apps/web/src/components/ArkadiaSidebar.tsx`

**Interfaces:**

- Produces: `resolveArkadiaSidebarViewAfterGroupsChange(input): "active" | "inactive" | null`.
- Consumes: previous and next active-project key sets plus the currently selected project key.

- [ ] **Step 1: Write a failing test proving initial restoration selects Active**

```ts
expect(
  resolveArkadiaSidebarViewAfterGroupsChange({
    previousActiveProjectKeys: null,
    nextActiveProjectKeys: new Set(["local:arkadia"]),
    selectedProjectKey: "local:arkadia",
  }),
).toBe("active");
```

- [ ] **Step 2: Run the focused test and verify it fails because the resolver does not exist**

Run: `.\node_modules\.bin\vp.cmd test run apps/web/src/components/arkadiaSidebarModel.test.ts`

- [ ] **Step 3: Implement the resolver and use it from the sidebar effect**

Return `"active"` when the selected project is already active on initial hydration or when a project newly becomes active. Otherwise return `null` so an explicit user choice of Active/Inactif is not overwritten.

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `.\node_modules\.bin\vp.cmd test run apps/web/src/components/arkadiaSidebarModel.test.ts`

### Task 3: Apply the terminal content palette to Sessions recentes

**Files:**

- Modify: `apps/web/src/components/RecentSessionsNavigator.tsx`
- Modify: `apps/web/src/components/RecentSessionsNavigator.test.tsx`
- Modify: `apps/web/src/index.css`

**Interfaces:**

- Produces: a `data-content-surface` marker whose `--background` and `--foreground` tokens are overridden by the selected content/terminal palette.

- [ ] **Step 1: Write a failing rendered-output test for the content-surface marker**

```ts
expect(markup).toContain('data-content-surface=""');
```

- [ ] **Step 2: Run the focused test and verify it fails because the marker is absent**

Run: `.\node_modules\.bin\vp.cmd test run apps/web/src/components/RecentSessionsNavigator.test.tsx`

- [ ] **Step 3: Add the marker and scoped palette CSS**

```css
:root[data-content-palette="on"] [data-content-surface] {
  --background: var(--content-bg);
  --foreground: var(--content-fg);
}
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `.\node_modules\.bin\vp.cmd test run apps/web/src/components/RecentSessionsNavigator.test.tsx`

### Task 4: Focused verification

**Files:**

- Verify all files changed above.

- [ ] **Step 1: Run all touched tests together**

Run: `.\node_modules\.bin\vp.cmd test run apps/web/src/uiStateStore.test.ts apps/web/src/routes/chatIndexRestore.test.ts apps/web/src/components/arkadiaSidebarModel.test.ts apps/web/src/components/RecentSessionsNavigator.test.tsx apps/web/src/components/ArkadiaWorkspaceTabs.test.tsx`

- [ ] **Step 2: Run the required TypeScript check**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Review the final diff and confirm no unrelated files changed**

Run: `git status --short` and `git diff --check`.

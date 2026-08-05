# Workspace Tabs Source of Truth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the per-client workspace tab bar the only source of truth for open conversations, drafts, and terminals, with the Arkadia sidebar rendering the exact same ordered tabs under each project.

**Architecture:** Persist an explicit set of open conversation-tab keys in the existing client-local UI store instead of inferring open tabs from server activity. Build one discriminated `ArkadiaWorkspaceTabItem` collection from explicit conversations, persisted drafts, and in-memory terminals; both the top bar and sidebar consume this same pure model. Keep terminal tabs transient, and keep the active-tab pointer session-local so project-header navigation selects the last tab used without syncing UI state across clients.

**Tech Stack:** React 19, TypeScript, Zustand 5, TanStack Router, Vitest through Vite Plus.

## Global Constraints

- The top workspace tab bar is the sole authority for what is open on one client.
- The sidebar mirrors every open conversation, draft, and terminal in the exact top-bar order.
- Server activity from another client must never open a local tab.
- Conversation tabs and draft tabs survive a client restart; terminal tabs do not.
- The state remains client-local and is not sent through server contracts.
- The Active count remains a count of projects with at least one open tab.
- A project always renders its child tab row, including when it owns only one tab.
- Closing from the sidebar and closing from the tab bar execute the same type-specific behavior.
- Web and desktop are in scope; mobile is unchanged.
- Preserve the existing uncommitted recent-sessions and terminal work; do not commit or push unless separately requested.

---

### Task 1: Persist explicit conversation tabs

**Files:**

- Modify: `apps/web/src/uiStateStore.ts`
- Modify: `apps/web/src/uiStateStore.test.ts`
- Modify: `apps/web/src/components/arkadiaSidebarModel.ts`
- Modify: `apps/web/src/components/arkadiaSidebarModel.test.ts`

**Interfaces:**

- Produces: `openWorkspaceThreadTabKeys: string[]`, `openWorkspaceThreadTab(tabKey)`, and `closeWorkspaceThreadTab(tabKey)`.
- Produces: `buildArkadiaWorkspaceTabs({ threads, environmentId, projectId, currentThreadId, openTabKeys })` that includes only explicit or currently routed conversations.
- Migrates: legacy `retainedWorkspaceTabKeys` into `openWorkspaceThreadTabKeys`; legacy closed keys no longer define openness.

- [ ] **Step 1: Write failing UI-store tests** proving that opening is idempotent, closing removes the explicit key, persistence round-trips `openWorkspaceThreadTabKeys`, and legacy retained keys migrate into the explicit list.

```ts
it("stores only explicitly opened conversation tabs", () => {
  const opened = openWorkspaceThreadTab(makeUiState(), "local:thread-1");
  expect(opened.openWorkspaceThreadTabKeys).toEqual(["local:thread-1"]);
  expect(openWorkspaceThreadTab(opened, "local:thread-1")).toBe(opened);
  expect(closeWorkspaceThreadTab(opened, "local:thread-1").openWorkspaceThreadTabKeys).toEqual([]);
});
```

- [ ] **Step 2: Run the focused store test and observe RED.**

Run: `.\node_modules\.bin\vp.cmd test run apps/web/src/uiStateStore.test.ts`

Expected: FAIL because `openWorkspaceThreadTab` and `openWorkspaceThreadTabKeys` do not exist.

- [ ] **Step 3: Implement the explicit state and migration.** Replace the inverse closed/retained model in UI consumers with one persisted list. Keep deserialization tolerant of older payloads by reading `openWorkspaceThreadTabKeys ?? retainedWorkspaceTabKeys ?? []`.

- [ ] **Step 4: Write and observe a failing model test** proving a non-settled remote conversation is absent unless its key is explicit, while the routed conversation stays visible during route hydration.

```ts
expect(
  buildArkadiaWorkspaceTabs({
    threads: [thread("local-open", "alpha"), thread("remote-active", "alpha")],
    environmentId: "local",
    projectId: "alpha",
    currentThreadId: null,
    openTabKeys: new Set(["local:local-open"]),
  }).map((item) => item.id),
).toEqual(["local-open"]);
```

- [ ] **Step 5: Implement the minimal explicit filter and rerun both focused tests GREEN.**

---

### Task 2: Build one canonical mixed-tab model

**Files:**

- Modify: `apps/web/src/components/arkadiaSidebarModel.ts`
- Modify: `apps/web/src/components/arkadiaSidebarModel.test.ts`
- Modify: `apps/web/src/components/workspaceTabOrderStore.ts`
- Create: `apps/web/src/components/workspaceTabOrderStore.test.ts`

**Interfaces:**

- Produces: `ArkadiaWorkspaceTabItem`, a discriminated union with `thread`, `draft`, and `terminal` variants, each carrying one stable `key`.
- Produces: `buildArkadiaWorkspaceTabItems(input): ArkadiaWorkspaceTabItem[]`.
- Changes: `ArkadiaSidebarProjectGroup` carries `tabs` rather than conversation-only `threads`.
- Produces: `activeTabKeyByProjectKey`, `markTabActive(projectKey, tabKey)`, and `resolveArkadiaProjectOpenTab(tabs, lastActiveKey)`.

- [ ] **Step 1: Write failing pure-model tests** with literal expectations proving that the mixed list contains exactly one explicit conversation, two drafts, and one terminal; respects the shared preferred order; classifies the project active; and leaves a zero-tab project inactive.

```ts
expect(group.tabs.map((tab) => `${tab.kind}:${tab.key}`)).toEqual([
  "terminal:terminal:term-1",
  "draft:draft:draft-1",
  "thread:local:thread-1",
]);
```

- [ ] **Step 2: Run the focused model test and observe RED** because groups expose only `threads` and ignore drafts and terminals.

Run: `.\node_modules\.bin\vp.cmd test run apps/web/src/components/arkadiaSidebarModel.test.ts`

- [ ] **Step 3: Implement the canonical union and group builder.** Natural order is explicit conversations by creation time, drafts by creation time, then current in-memory terminals; `orderItemsByPreferredIds` applies the same project-scoped order to both surfaces.

- [ ] **Step 4: Write and observe a failing workspace-order-store test** for recording the last active key without altering manual order.

- [ ] **Step 5: Implement session-local active-tab tracking and rerun both focused tests GREEN.**

---

### Task 3: Render and control the same tabs on both surfaces

**Files:**

- Modify: `apps/web/src/components/ArkadiaWorkspaceTabs.tsx`
- Modify: `apps/web/src/components/ArkadiaWorkspaceTabs.test.tsx`
- Modify: `apps/web/src/components/ArkadiaSidebar.tsx`
- Modify: `apps/web/src/components/ArkadiaSidebar.test.tsx`
- Modify: `apps/web/src/hooks/useLeaveToNextActiveProject.ts`
- Modify: `apps/web/src/routes/_chat.$environmentId.project.$projectId.terminal.$terminalId.tsx`

**Interfaces:**

- Both surfaces consume `buildArkadiaWorkspaceTabItems` / `ArkadiaSidebarProjectGroup.tabs`.
- Opening any server conversation calls `openWorkspaceThreadTab` before navigation.
- Closing any server conversation calls `closeWorkspaceThreadTab` and preserves the existing stop/settle behavior.
- Project-header navigation resolves `activeTabKeyByProjectKey[projectKey]`, falling back to the first remaining ordered tab.

- [ ] **Step 1: Write failing component-contract tests** proving the sidebar renders a child for one tab, renders draft and terminal labels/icons, and no longer maps `group.threads`.

- [ ] **Step 2: Run the sidebar and workspace-tab tests and observe RED.**

Run: `.\node_modules\.bin\vp.cmd test run apps/web/src/components/ArkadiaSidebar.test.tsx apps/web/src/components/ArkadiaWorkspaceTabs.test.tsx`

- [ ] **Step 3: Refactor the top bar to render the canonical item list.** Mark the routed item active in the session-local active-tab map. Opening a routed or recent-session conversation first records the explicit conversation key.

- [ ] **Step 4: Refactor the sidebar group UI to always render a project header plus every canonical child tab.** Route each union variant to its existing conversation, draft, or project-terminal route. Use the same close functions and fallbacks as the top bar; closing the project iterates every mixed tab.

- [ ] **Step 5: Update next-project fallback** to select the next active group from canonical tabs and open that project’s last active remaining tab instead of scanning server-active threads.

- [ ] **Step 6: Rerun the two component test files GREEN.**

---

### Task 4: Make terminals transient and verify the feature

**Files:**

- Modify: `apps/web/src/components/terminal/projectTerminalsStore.ts`
- Modify: `apps/web/src/components/terminal/projectTerminalsStore.test.ts`
- Modify only additional targeted tests required by type errors caused by the new interfaces.

**Interfaces:**

- `useProjectTerminalsStore` remains the same public Zustand hook but is created without `persist` middleware or storage hydration.

- [ ] **Step 1: Write a failing fresh-module test** that seeds the former `t3code:project-terminals:v1` local-storage payload, imports a fresh terminal store, and expects `terminalsByProjectKey` to start empty.

- [ ] **Step 2: Run the focused terminal-store test and observe RED** because the persisted payload currently hydrates terminal tabs.

Run: `.\node_modules\.bin\vp.cmd test run apps/web/src/components/terminal/projectTerminalsStore.test.ts`

- [ ] **Step 3: Remove terminal persistence while preserving the existing store API**, then rerun the terminal test GREEN.

- [ ] **Step 4: Run all touched focused tests.**

Run: `.\node_modules\.bin\vp.cmd test run apps/web/src/uiStateStore.test.ts apps/web/src/components/arkadiaSidebarModel.test.ts apps/web/src/components/workspaceTabOrderStore.test.ts apps/web/src/components/ArkadiaSidebar.test.tsx apps/web/src/components/ArkadiaWorkspaceTabs.test.tsx apps/web/src/components/terminal/projectTerminalsStore.test.ts`

- [ ] **Step 5: Run the required type verification.**

Run: `npx tsc --noEmit`

- [ ] **Step 6: Run targeted formatting/diff checks.**

Run: `git diff --check`

- [ ] **Step 7: Report runtime verification separately.** Do not launch a browser or use computer control without the user’s explicit permission; automated tests and typecheck are the completion gate for this turn.

## Self-Review

- Spec coverage: the explicit conversation list prevents remote server activity from creating tabs; persisted drafts already provide restart restoration; removing terminal persistence enforces the terminal exception; the canonical union makes the sidebar a true mirror and keeps Active project-based.
- Placeholder scan: every task has exact files, interfaces, commands, expected RED causes, and concrete implementation behavior.
- Type consistency: `ArkadiaWorkspaceTabItem.key` is the shared identity for ordering, active selection, opening, and closing on both surfaces.

# New conversation tab closing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Allow a "Nouvelle conversation" tab to close whenever its project has another conversation, draft, or terminal tab, while keeping a sole draft open.

**Architecture:** Add one pure closeability predicate to the existing canonical workspace-tab model. Both the top tab bar and the Arkadia sidebar consume that predicate; the top bar resolves active-draft fallback navigation from its existing mixed ordered collection, and the sidebar reuses its existing mixed-tab opener. Conversation and terminal close behavior remains untouched.

**Tech Stack:** React 19, TypeScript, TanStack Router, Zustand stores, Vitest through Vite Plus.

## Global Constraints

- The rule applies only to individual "Nouvelle conversation" draft-tab controls.
- Count every current-project tab kind: conversation, draft, and project terminal.
- Hide the draft close button and ignore draft middle-click when the draft is the only tab.
- When an active draft closes, start fallback navigation before clearing the draft.
- Do not change server contracts, persistence schemas, router contracts, mobile behavior, or project-level close controls.
- Preserve the unrelated dirty files apps/web/src/components/settings/SettingsPanels.tsx and apps/web/src/components/settings/ProviderSettingsPanel.test.tsx.
- Use English for code, identifiers, comments, and commit messages; keep existing French UI labels.

---

### Task 1: Add the shared draft-closeability policy

**Files:**

- Modify: apps/web/src/components/arkadiaSidebarModel.ts
- Modify: apps/web/src/components/arkadiaSidebarModel.test.ts

**Interfaces:**

- Consumes: ArkadiaWorkspaceTabItem[] and a draft tab key.
- Produces: canCloseArkadiaDraftTab(tabs, draftKey): boolean.

- [ ] Step 1: Write the failing pure-model tests.

Add a focused describe block. Use the existing thread test fixture for the conversation item and literal union members for drafts and terminals:

```ts
const draft = {
  kind: "draft",
  key: "draft:draft-1",
  draftId: "draft-1",
  createdAt: "2026-08-05T10:00:00.000Z",
} as const;
const secondDraft = { ...draft, key: "draft:draft-2", draftId: "draft-2" } as const;
const terminal = {
  kind: "terminal",
  key: "terminal:terminal-1",
  terminalId: "terminal-1",
} as const;
const conversation = {
  kind: "thread",
  key: "local:thread-1",
  thread: thread("thread-1", "alpha"),
} as const;

expect(canCloseArkadiaDraftTab([draft], draft.key)).toBe(false);
expect(canCloseArkadiaDraftTab([draft, conversation], draft.key)).toBe(true);
expect(canCloseArkadiaDraftTab([draft, secondDraft], draft.key)).toBe(true);
expect(canCloseArkadiaDraftTab([draft, terminal], draft.key)).toBe(true);
expect(canCloseArkadiaDraftTab([conversation, terminal], draft.key)).toBe(false);
```

Import canCloseArkadiaDraftTab from the model module beside the existing imports.

- [ ] Step 2: Run the model test and verify it fails.

```powershell
.\\node_modules\\.bin\\vp.cmd test run apps/web/src/components/arkadiaSidebarModel.test.ts
```

Expected: FAIL because canCloseArkadiaDraftTab is not exported yet.

- [ ] Step 3: Implement the minimal pure predicate.

Add this function beside the existing tab helpers:

```ts
export function canCloseArkadiaDraftTab(
  tabs: ReadonlyArray<ArkadiaWorkspaceTabItem>,
  draftKey: string,
): boolean {
  return tabs.length > 1 && tabs.some((tab) => tab.kind === "draft" && tab.key === draftKey);
}
```

This checks the canonical mixed collection, not draft count or server-thread count.

- [ ] Step 4: Rerun the pure-model test and verify it passes.

Run the same vp.cmd test command. Expected: PASS, including all existing model tests.

- [ ] Step 5: Commit the isolated model change.

```powershell
git add apps/web/src/components/arkadiaSidebarModel.ts apps/web/src/components/arkadiaSidebarModel.test.ts
git commit -m "fix(web): define draft tab closeability"
```

Do not stage the settings files or any other workspace changes.

### Task 2: Make the top workspace bar close drafts only when eligible

**Files:**

- Modify: apps/web/src/components/ArkadiaWorkspaceTabs.tsx
- Modify: apps/web/src/components/ArkadiaWorkspaceTabs.test.tsx

**Interfaces:**

- Consumes: canCloseArkadiaDraftTab, orderedTabItems, and the existing openThread, openDraft, and terminal navigation functions.
- Produces: top-bar draft controls that are hidden/no-op for a sole draft and mixed-tab-aware active fallback navigation.

- [ ] Step 1: Add failing source-contract tests for the top bar.

Extend the existing workspace-tab test suite:

```ts
it("guards draft close controls with the canonical mixed tab list", () => {
  expect(workspaceTabsSource).toContain("canCloseArkadiaDraftTab");
  expect(workspaceTabsSource).toMatch(/canCloseArkadiaDraftTab\(orderedTabItems, item\.key\)/);
  expect(workspaceTabsSource).toContain("onMiddleClick={() => {");
});

it("routes an active draft close through any remaining tab kind", () => {
  expect(workspaceTabsSource).toContain("orderedTabItems.map((item) => item.key)");
  expect(workspaceTabsSource).toContain("openTerminalTab");
  expect(workspaceTabsSource).toContain("openWorkspaceTab");
});
```

Keep these tests aligned with the existing raw-source contract style in this file.

- [ ] Step 2: Run the focused top-bar test and verify it fails.

```powershell
.\\node_modules\\.bin\\vp.cmd test run apps/web/src/components/ArkadiaWorkspaceTabs.test.tsx
```

Expected: FAIL because the top bar currently closes every rendered draft and computes fallback from separate draft/conversation arrays.

- [ ] Step 3: Import the shared predicate and define a mixed-tab opener.

Add the predicate to the model imports. Define a callback that accepts one ArkadiaWorkspaceTabItem and routes by kind:

```ts
const openWorkspaceTab = useCallback(
  (item: ArkadiaWorkspaceTabItem) => {
    if (item.kind === "thread") {
      openThread(item.thread);
      return;
    }
    if (item.kind === "draft") {
      const draft = visibleDrafts.find((candidate) => String(candidate.draftId) === item.draftId);
      if (draft) openDraft(draft);
      return;
    }
    openTerminalTab(item.terminalId);
  },
  [openDraft, openTerminalTab, openThread, visibleDrafts],
);
```

Place this callback after the three type-specific open callbacks are available; move openTerminalTab earlier if necessary without changing its route.

- [ ] Step 4: Refactor closeDraft to guard and resolve from orderedTabItems.

At the start of closeDraft, derive draftKey as "draft:" + draft.draftId and return immediately if canCloseArkadiaDraftTab(orderedTabItems, draftKey) is false. For an active draft, compute the adjacent key and item before clearing:

```ts
const fallbackId = resolveArkadiaTabAfterClose(
  orderedTabItems.map((item) => item.key),
  draftKey,
);
const fallback = fallbackId
  ? (orderedTabItems.find((item) => item.key === fallbackId) ?? null)
  : null;

void closeArkadiaDraftTab({
  navigateAway: () => (fallback ? openWorkspaceTab(fallback) : openEmptyProject(true)),
  clearDraft: () => clearDraftThread(draft.draftId),
});
```

Keep the inactive-draft branch as a clear-only operation, but let the same closeability guard protect it. Remove the old fallback selection that only checks visibleDrafts and tabs. Update dependencies for orderedTabItems, openWorkspaceTab, and the existing callbacks.

- [ ] Step 5: Hide the draft X and ignore its middle-click when it is sole.

Inside the draft render branch, compute:

```ts
const canClose = canCloseArkadiaDraftTab(orderedTabItems, item.key);
```

Pass a guarded middle-click callback:

```tsx
onMiddleClick={() => {
  if (canClose) closeDraft(draft);
}}
```

Render the X button only when canClose is true. Keep the normal click/open behavior unchanged.

- [ ] Step 6: Rerun the top-bar focused tests and web typecheck.

```powershell
.\\node_modules\\.bin\\vp.cmd test run apps/web/src/components/ArkadiaWorkspaceTabs.test.tsx
.\\node_modules\\.bin\\vp.cmd run --filter @t3tools/web typecheck
```

Expected: PASS.

- [ ] Step 7: Commit the top-bar change.

```powershell
git add apps/web/src/components/ArkadiaWorkspaceTabs.tsx apps/web/src/components/ArkadiaWorkspaceTabs.test.tsx
git commit -m "fix(web): close eligible new conversation tabs"
```

### Task 3: Apply the same rule in the Arkadia sidebar

**Files:**

- Modify: apps/web/src/components/ArkadiaSidebar.tsx
- Modify: apps/web/src/components/ArkadiaSidebar.test.tsx

**Interfaces:**

- Consumes: canCloseArkadiaDraftTab(group.tabs, tab.key) and the existing mixed openTab callback.
- Produces: sidebar draft controls matching the top bar for sole and multi-tab projects.

- [ ] Step 1: Add failing sidebar source-contract tests.

Extend the existing sidebar test suite:

```ts
it("guards sidebar draft close controls with the mixed project tab list", () => {
  expect(arkadiaSidebarSource).toContain("canCloseArkadiaDraftTab");
  expect(arkadiaSidebarSource).toContain("canCloseArkadiaDraftTab(group.tabs, tab.key)");
  expect(arkadiaSidebarSource).toContain("group.tabs.map");
});
```

- [ ] Step 2: Run the sidebar test and verify it fails.

```powershell
.\\node_modules\\.bin\\vp.cmd test run apps/web/src/components/ArkadiaSidebar.test.tsx
```

Expected: FAIL because the sidebar currently renders a close button and dispatches close for every draft, including a sole draft.

- [ ] Step 3: Import the shared predicate.

Add canCloseArkadiaDraftTab to the arkadiaSidebarModel import list without changing the existing group-building inputs.

- [ ] Step 4: Guard closeOneTab for sole drafts.

At the top of closeOneTab, before calculating navigation or clearing resources, add:

```ts
if (tab.kind === "draft" && !canCloseArkadiaDraftTab(group.tabs, tab.key)) return;
```

Leave thread and terminal closure behavior exactly as it is. The existing active-draft path already starts fallback navigation before clearing and uses openTab(next, group), so it retains the correct mixed-tab route once the guard permits closure.

- [ ] Step 5: Hide the sidebar draft close button and ignore its middle-click when sole.

In the group.tabs.map row, derive:

```ts
const canClose = tab.kind !== "draft" || canCloseArkadiaDraftTab(group.tabs, tab.key);
```

In the row's middle-button handler, return before preventing/stopping the event when canClose is false. Render SidebarCloseButton only when canClose is true. Keep the row's primary click opening the tab.

- [ ] Step 6: Rerun sidebar and web typecheck checks.

```powershell
.\\node_modules\\.bin\\vp.cmd test run apps/web/src/components/ArkadiaSidebar.test.tsx
.\\node_modules\\.bin\\vp.cmd run --filter @t3tools/web typecheck
```

Expected: PASS.

- [ ] Step 7: Commit the sidebar change.

```powershell
git add apps/web/src/components/ArkadiaSidebar.tsx apps/web/src/components/ArkadiaSidebar.test.tsx
git commit -m "fix(web): mirror draft closeability in sidebar"
```

### Task 4: Run the integrated focused verification

**Files:**

- Test: apps/web/src/components/arkadiaSidebarModel.test.ts
- Test: apps/web/src/components/ArkadiaWorkspaceTabs.test.tsx
- Test: apps/web/src/components/ArkadiaSidebar.test.tsx

**Interfaces:**

- Consumes: the shared predicate and both surface implementations from Tasks 1–3.
- Produces: verified behavior with unrelated user work still unstaged.

- [ ] Step 1: Run all focused tab tests together.

```powershell
.\\node_modules\\.bin\\vp.cmd test run apps/web/src/components/arkadiaSidebarModel.test.ts apps/web/src/components/ArkadiaWorkspaceTabs.test.tsx apps/web/src/components/ArkadiaSidebar.test.tsx
```

Expected: PASS with no failures in the existing workspace-tab coverage.

- [ ] Step 2: Run the web package typecheck.

```powershell
.\\node_modules\\.bin\\vp.cmd run --filter @t3tools/web typecheck
```

Expected: PASS. The repository has no root tsconfig.json, so npx tsc --noEmit is not a valid project command; use the package's configured tsgo --noEmit script through Vite Plus.

- [ ] Step 3: Check the final diff and status boundaries.

```powershell
git diff --check
git status --short
git diff HEAD~3 --stat
```

Expected: only the implementation commits' web/model/test files are committed; the pre-existing settings files remain the only unrelated worktree changes.

- [ ] Step 4: Report completion without browser automation.

Do not launch a browser or computer-control session unless the user separately requests runtime UI verification. Report the focused tests and typecheck result, the implementation commit(s), and the preserved unrelated dirty files.

## Self-Review

- Spec coverage: Tasks 1–3 cover the shared mixed-tab rule, both surfaces, sole-draft no-op behavior, mixed active fallback, and unchanged non-draft behavior; Task 4 covers verification and scope boundaries.
- Placeholder scan: every step contains concrete file paths, commands, expected results, or implementation content.
- Type consistency: canCloseArkadiaDraftTab(tabs, draftKey) is produced by Task 1 and consumed with orderedTabItems or group.tabs in Tasks 2–3; ArkadiaWorkspaceTabItem is the existing discriminated union used by both surfaces.

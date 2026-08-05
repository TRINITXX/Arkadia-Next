# Design: Closable "New conversation" tabs

**Date:** 2026-08-05

**Status:** Approved for implementation

## Goal

Allow a `Nouvelle conversation` workspace tab to be closed when its project has another open tab, regardless of whether the remaining tab is a server conversation, another draft, or a project terminal.

When it is the project's only tab, keep the draft open and hide its per-tab close control.

## Scope

The rule applies to draft-tab controls in both web surfaces:

- the top `ArkadiaWorkspaceTabs` bar;
- the Arkadia sidebar's child-tab rows.

Conversation-tab and terminal-tab close behavior is unchanged. Project-level close controls are also unchanged; this design only governs closing an individual `Nouvelle conversation` tab.

No server contract, persistence schema, router contract, or mobile behavior changes.

## User-visible behavior

| Project tab state                                   | Draft close control                                        | Closing the draft                                 | Active-route result                            |
| --------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------- |
| Draft is the only tab                               | Hidden in the top bar and sidebar; middle-click is ignored | No-op                                             | Draft remains open                             |
| Draft is inactive and at least one other tab exists | Visible/available                                          | Draft is cleared                                  | Current route is unchanged                     |
| Draft is active and at least one other tab exists   | Visible/available                                          | Draft is cleared after fallback navigation starts | The adjacent remaining canonical tab is opened |

The fallback tab is chosen from the same ordered mixed collection already used by each surface. Its kind determines the route: conversation, draft, or project terminal. The existing adjacent-tab rule remains the source of ordering (`resolveArkadiaTabAfterClose`); no new ordering policy is introduced.

## Architecture

Add one pure, shared draft-closeability rule in `arkadiaSidebarModel.ts`, based on the canonical tab collection and the draft tab key. Both surfaces use it to decide whether to render/execute the draft close action.

`ArkadiaWorkspaceTabs` already has `orderedTabItems`, so its active-draft fallback will resolve the adjacent `ArkadiaWorkspaceTabItem` from that collection instead of checking conversations and drafts separately. The existing type-specific open functions remain the route boundaries.

`ArkadiaSidebar` already receives `group.tabs`, so it will apply the same rule and keep using its existing mixed-tab opener for active fallback navigation. For a draft that is not active, clearing it remains synchronous and does not navigate.

The rule must be evaluated against all tab kinds in the current project. The implementation must not infer availability from draft count alone or from server conversations alone.

## Edge cases and failure handling

- A stale draft that is no longer present is not rendered and cannot be closed through the tab UI.
- The active fallback is calculated before clearing the draft, so the draft route cannot redirect to the home page before the intended route is started.
- If a stale snapshot leaves no valid fallback despite reporting multiple tabs, retain the existing empty-project/next-project fallback rather than inventing a new draft.
- Closing a draft does not stop or settle a server thread; drafts have no started server session at this stage.

## Verification

Add focused tests for:

- a draft being non-closeable when it is the only mixed tab;
- a draft being closeable with a conversation, another draft, or a terminal;
- inactive-draft closure clearing without navigation;
- active-draft closure selecting the adjacent remaining tab for each tab kind;
- both top-bar and sidebar controls using the shared rule.

Run the touched tests, `npx tsc --noEmit`, and `git diff --check`. Runtime browser/computer verification remains separate and requires explicit user permission.

## Alternatives considered

1. **Recommended — shared UI/model rule.** Reuses the canonical mixed-tab collections, keeps both surfaces consistent, and changes only draft controls.
2. **Top-bar-only guard.** Smaller local diff, but the sidebar would still allow closing a sole draft or reject a closable draft inconsistently.
3. **Store-level restriction.** Places a project-wide UI rule in the draft store, which cannot see conversations or terminals and would also affect non-UI draft lifecycle operations.

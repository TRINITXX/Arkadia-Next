# Immediate First Message Cancellation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Arkadia web/desktop users stop a first-message send immediately, restore the submitted content to the composer, and prevent or terminate provider contact without reverting workspace files.

**Architecture:** Add a dedicated event-sourced turn-cancel command instead of changing session-stop semantics, because session stop is also used by `/clear` and must retain conversation history. The web composer keeps a per-send cancellation snapshot: a pre-dispatch cancellation prevents `thread.turn.start`, while an in-flight cancellation queues the cancel command after the serialized start command; the server stops the provider session and projects a conversation-only rewind without invoking filesystem checkpoint restoration.

**Tech Stack:** TypeScript, React, Effect, Effect Schema, Vitest, T3 typed WebSocket orchestration.

## Global Constraints

- Scope is Arkadia web and desktop only; do not modify `apps/mobile`.
- Restore the cancelled text and attachments to the composer.
- Keep the conversation available as a draft.
- Never revert or delete workspace file modifications.
- Preserve the concurrent `/clear` and context-window-reset changes already present in the worktree.
- Use focused tests only; do not run repo-wide checks.

---

### Task 1: Typed turn-cancel orchestration

**Files:**

- Modify: `packages/contracts/src/orchestration.ts`
- Modify: `packages/client-runtime/src/operations/commands.ts`
- Modify: `packages/client-runtime/src/state/threadCommands.ts`
- Modify: `apps/server/src/orchestration/decider.ts`
- Modify: `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts`
- Test: `apps/server/src/orchestration/Layers/ProviderCommandReactor.test.ts`

**Interfaces:**

- Produces: dispatchable command `{ type: "thread.turn.cancel"; threadId; messageId; createdAt; commandId }`.
- Produces: intent event `thread.turn-cancel-requested` carrying `threadId`, `messageId`, and `createdAt`.
- Produces: client command `cancelThreadTurn(input)` and `threadEnvironment.cancelTurn`.
- Preserves: `thread.session.stop` behavior used by `/clear`.

- [ ] **Step 1: Write a failing reactor test**

Add a focused test that starts a pending turn, dispatches `thread.turn.cancel`, drains the reactor, and asserts that the provider session is stopped, the cancelled user message/current turn are removed from the read model, the thread session is stopped, and previously completed messages remain.

- [ ] **Step 2: Run the reactor test to verify RED**

Run: `vp test run apps/server/src/orchestration/Layers/ProviderCommandReactor.test.ts`

Expected: FAIL because `thread.turn.cancel` is not part of the command schema or reactor event union.

- [ ] **Step 3: Implement the minimal typed command and reactor path**

Define the command/event schemas, expose the client operation, and process cancellation by stopping the active provider session, setting the session to `stopped`, then dispatching the internal `thread.revert.complete` command at the last completed checkpoint count. Do not call the checkpoint revert command or Git/provider revert operations.

- [ ] **Step 4: Run the reactor test to verify GREEN**

Run: `vp test run apps/server/src/orchestration/Layers/ProviderCommandReactor.test.ts`

Expected: PASS with the new cancellation behavior and the concurrent `/clear` context-reset test intact.

### Task 2: Immediate web composer cancellation

**Files:**

- Modify: `apps/web/src/components/chat/ComposerPrimaryActions.tsx`
- Test: `apps/web/src/components/chat/ComposerPrimaryActions.test.ts`
- Modify: `apps/web/src/components/ChatView.logic.ts`
- Test: `apps/web/src/components/ChatView.logic.test.ts`
- Modify: `apps/web/src/components/ChatView.tsx`
- Modify: `packages/client-runtime/src/state/runtime.ts`
- Test: `packages/client-runtime/src/state/runtime.test.ts`
- Modify: `apps/web/src/state/use-atom-command.ts`

**Interfaces:**

- Consumes: `threadEnvironment.cancelTurn` from Task 1.
- Produces: a cancellable local-send snapshot keyed by `messageId`, with an idempotent restore action and a `turnStartDispatched` flag.
- Produces: Stop visibility while `isSendBusy` is true.
- Produces: an optional `AbortSignal` execution boundary for atom commands so Stop can interrupt bootstrap/worktree preparation instead of waiting behind it.

- [ ] **Step 1: Write failing UI logic tests**

Extend the primary-action test to require Stop for `{ isSendBusy: true, isConnecting: false, isRunning: false }`. Add pure cancellation-state tests proving that cancellation before dispatch skips the turn start and cancellation after dispatch requires the server cancel command exactly once. Add a runtime-command test proving an aborted execution signal interrupts the running Effect and releases its finalizer.

- [ ] **Step 2: Run the focused web tests to verify RED**

Run: `vp test run apps/web/src/components/chat/ComposerPrimaryActions.test.ts apps/web/src/components/ChatView.logic.test.ts packages/client-runtime/src/state/runtime.test.ts`

Expected: FAIL because send-busy is not considered stoppable and no send-cancellation state exists.

- [ ] **Step 3: Implement the minimal web wiring**

Show Stop for local dispatch, capture the outgoing composer snapshot, restore it idempotently on Stop, remove the optimistic row, prevent `startThreadTurn` when cancellation wins before dispatch, abort an in-flight bootstrap command, and call `cancelThreadTurn` when start dispatch has begun. Keep the existing interrupt path for ordinary running turns.

- [ ] **Step 4: Run the focused web tests to verify GREEN**

Run: `vp test run apps/web/src/components/chat/ComposerPrimaryActions.test.ts apps/web/src/components/ChatView.logic.test.ts packages/client-runtime/src/state/runtime.test.ts`

Expected: PASS.

### Task 3: Scoped verification

**Files:**

- Verify only the files changed by Tasks 1 and 2.

- [ ] **Step 1: Run focused behavior tests**

Run: `vp test run apps/server/src/orchestration/Layers/ProviderCommandReactor.test.ts apps/web/src/components/chat/ComposerPrimaryActions.test.ts apps/web/src/components/ChatView.logic.test.ts apps/web/src/composer-logic.test.ts`

- [ ] **Step 2: Run the required TypeScript check**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Inspect the final diff and scope**

Confirm no `apps/mobile` file changed, no checkpoint/filesystem revert is invoked by cancellation, and all pre-existing `/clear` changes remain present.

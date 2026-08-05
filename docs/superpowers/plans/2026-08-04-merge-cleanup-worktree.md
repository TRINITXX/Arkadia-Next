# Merge & Cleanup Worktree Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a one-click "Fusionner & nettoyer" action that merges a worktree thread's branch into its base branch locally, then deletes the worktree and branch and archives the thread — with conflicts handed to the thread's AI agent and the cleanup auto-resuming once resolved.

**Architecture:** Three new git driver primitives (`mergeRef`, `fastForwardBranch`, `deleteBranch`) expose the raw operations. A new server-side `MergeCleanupService` orchestrates the sequence: auto-commit the worktree, merge the base _into_ the worktree branch (so conflicts surface where the agent works), then fast-forward the base, remove the worktree, delete the branch, and archive the thread. On conflict, the service posts a resolution prompt to the agent (`thread.turn.start`) and records the thread in an in-memory pending set; a `MergeCleanupReactor` watching `turn.completed` finalizes automatically once the worktree is clean. A dedicated non-streaming RPC (`git.mergeCleanupThread`, modeled on `preparePullRequestThread`) is the trigger; the client button lives in the worktree/branch strip under the composer.

**Tech Stack:** TypeScript, Effect (`effect/*`, `effect/unstable/*`), `@effect/vitest`, React (apps/web), pnpm workspaces, vite-plus (`vp`) test/lint/build runner, SQLite projections.

## Global Constraints

- **Package manager:** `pnpm@11.10.0`. Node `^24.13.1`. No turbo. Test/lint/format run through vite-plus (`vp`).
- **Run only scoped checks, never repo-wide** (`AGENTS.md:106-107`). Use `pnpm --filter t3 …` (server package name is `t3`) and `pnpm --filter @t3tools/client-runtime …`. Do NOT run `vp check` / `vp run -r test` / `vp run -r typecheck`.
- **Test a single server file:** `cd apps/server && pnpm exec vp test run <relative/path.test.ts>` (add `-t "<name>"` to filter by test name).
- **Typecheck (server):** `pnpm --filter t3 typecheck` (runs `tsgo --noEmit`). **Typecheck (client-runtime):** `pnpm --filter @t3tools/client-runtime typecheck`.
- **Lint scoped:** `pnpm exec vp lint <path>`. **Format:** `pnpm exec vp fmt` (only `vp fmt` runs on staged files at commit — lint and typecheck are NOT enforced by a hook, run them manually).
- **No `any`** — use `unknown` (lint `t3code` rules enforce this). Node imports namespaced: `import * as NodeFS from "node:fs"`.
- **In tests, never build a manual Effect runtime** (`t3code/no-manual-effect-runtime-in-tests` is an error) — use `@effect/vitest` `it.effect` / `it.layer`.
- **Async server flows are event-sourced.** Tests must await typed events/receipts, never `sleep`/poll (`AGENTS.md:109`).
- **Read `.repos/effect-smol/LLMS.md` before writing Effect code** (`AGENTS.md:130`).
- **Commits:** Conventional Commits, description in English, scope by surface (e.g. `feat(server): …`, `feat(web): …`). End commit messages with the Co-Authored-By / Claude-Session trailers per repo convention.
- **Behavior decisions locked with the user (do not re-litigate):** auto-commit dirty worktree before merging; fast-forward-else-merge-commit shape (achieved by merging base _into_ the branch first, then FF into base); delete the merged branch; archive (not delete) the thread; stay 100% local (never push); light confirmation before running; conflicts resolved by the agent in-conversation with automatic resume; the button is the primary git action for worktree threads and lives in the branch/worktree strip under the composer.

---

## File Structure

**Create:**

- `apps/server/src/git/MergeCleanupService.ts` — the orchestration service (attempt + resume + in-memory pending set).
- `apps/server/src/git/MergeCleanupService.test.ts` — service tests over real temp git repos + a fake orchestration engine.
- `apps/server/src/orchestration/Layers/MergeCleanupReactor.ts` — reactor: `turn.completed` → `resumeIfClean`.
- `apps/server/src/orchestration/Services/MergeCleanupReactor.ts` — reactor Service tag/interface.
- `apps/web/src/hooks/useMergeCleanupThreadAction.ts` — client action hook (model: `usePreparePullRequestThreadAction`).

**Modify:**

- `packages/contracts/src/git.ts` — `GitMergeCleanupThreadInput` / `GitMergeCleanupThreadResult` schemas.
- `packages/contracts/src/rpc.ts` — `WS_METHODS.gitMergeCleanupThread`, `WsGitMergeCleanupThreadRpc`, register in `WsRpcGroup`.
- `apps/server/src/vcs/GitVcsDriver.ts` — new input/result types + 3 `readonly` methods on the Service interface.
- `apps/server/src/vcs/GitVcsDriverCore.ts` — implement `mergeRef` / `fastForwardBranch` / `deleteBranch` + register in `.of({…})`.
- `apps/server/src/vcs/GitVcsDriverCore.test.ts` — primitive tests.
- `apps/server/src/git/GitWorkflowService.ts` — expose the 3 primitives through the service.
- `apps/server/src/ws.ts` — WS handler for `git.mergeCleanupThread`.
- `apps/server/src/server.ts` — register `MergeCleanupService` + `MergeCleanupReactorLive` layers.
- `apps/server/src/orchestration/Layers/OrchestrationReactor.ts` — call `mergeCleanupReactor.start()`.
- `packages/client-runtime/src/state/…` (the `gitEnvironment` atoms object) — add `mergeCleanupThread` atom.
- `apps/web/src/components/BranchToolbar.tsx` — the "Fusionner & nettoyer" button.
- `apps/web/src/components/BranchToolbar.logic.ts` + `BranchToolbar.logic.test.ts` — pure helper for button visibility + confirmation copy.

**Design notes carried across tasks:**

- **Base branch resolution:** read `branch.<branch>.gh-merge-base` from the worktree via `gitCore.readConfigValue` (it is always written when the app creates a worktree — `GitVcsDriverCore.ts:2594-2606`). Fallback to the repo default branch if absent.
- **Why merge base → branch first:** it forces any conflict into the worktree (agent's cwd) and guarantees the later base←branch update is a pure fast-forward. This is exactly the user's chosen "avance rapide sinon commit de fusion" shape.
- **`cwd` conventions:** git that mutates the _branch's_ content runs with `cwd = worktreePath`. Git that updates the _base_ / removes the worktree / deletes the branch runs with `cwd = workspaceRoot` (the project root) — you cannot remove a worktree or delete a checked-out branch from inside it.
- **Pending state is in-memory** (a `Ref<HashMap<ThreadId, MergeCleanupContext>>` inside `MergeCleanupService`). **Known limitation to state in the PR body:** if the server restarts while a conflict is being resolved, auto-resume is lost and the user must click the button again (idempotent — the worktree still exists and the re-run merges cleanly). This is an intentional simplification for a solo-dev v1; the alternative (persisting a projection column + migration + events) was scoped out.

---

## Task 1: Driver primitive `deleteBranch`

Establishes the pattern (simplest primitive: one git call, no return value).

**Files:**

- Modify: `apps/server/src/vcs/GitVcsDriver.ts` (interface + input type)
- Modify: `apps/server/src/vcs/GitVcsDriverCore.ts` (implementation + registration)
- Modify: `apps/server/src/git/GitWorkflowService.ts` (expose)
- Test: `apps/server/src/vcs/GitVcsDriverCore.test.ts`

**Interfaces:**

- Produces: `GitDeleteBranchInput { readonly cwd: string; readonly branch: string; readonly force?: boolean }`; `GitVcsDriver` method `deleteBranch: (input: GitDeleteBranchInput) => Effect.Effect<void, GitCommandError>`; `GitWorkflowService.deleteBranch` with the same signature.

- [ ] **Step 1: Write the failing test** (append inside the existing `it.layer(TestLayer)("GitVcsDriver core integration", (it) => { … })` block in `GitVcsDriverCore.test.ts`, in a new `describe("branch deletion", …)`):

```ts
it.effect("deletes a merged branch", () =>
  Effect.gen(function* () {
    const cwd = yield* makeTmpDir();
    const { initialBranch } = yield* initRepoWithCommit(cwd);
    const driver = yield* GitVcsDriver.GitVcsDriver;

    yield* driver.createRef({ cwd, refName: "feature/done" });
    // feature/done points at the same commit as the base → safe (-d) delete
    yield* driver.deleteBranch({ cwd, branch: "feature/done" });

    const branches = yield* git(cwd, ["branch", "--format=%(refname:short)"]);
    assert.equal(branches.includes("feature/done"), false);
    assert.equal(branches.includes(initialBranch), true);
  }),
);
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd apps/server && pnpm exec vp test run src/vcs/GitVcsDriverCore.test.ts -t "deletes a merged branch"`
Expected: FAIL — `driver.deleteBranch is not a function` (type error / runtime).

- [ ] **Step 3: Add the input type + interface method** in `GitVcsDriver.ts`. Put the input near the other input interfaces (around `GitVcsDriver.ts:145-189`):

```ts
export interface GitDeleteBranchInput {
  readonly cwd: string;
  readonly branch: string;
  readonly force?: boolean;
}
```

Add to the `Context.Service` Service interface (around `GitVcsDriver.ts:191-268`, next to `renameBranch`):

```ts
    readonly deleteBranch: (
      input: GitDeleteBranchInput,
    ) => Effect.Effect<void, GitCommandError>;
```

- [ ] **Step 4: Implement in `GitVcsDriverCore.ts`** — add this `const` right after `renameBranch` (~`:2741`), mirroring `removeWorktree`:

```ts
const deleteBranch: GitVcsDriver.GitVcsDriver["Service"]["deleteBranch"] = Effect.fn(
  "deleteBranch",
)(function* (input) {
  yield* executeGit(
    "GitVcsDriver.deleteBranch",
    input.cwd,
    ["branch", input.force ? "-D" : "-d", "--", input.branch],
    { timeoutMs: 10_000, fallbackErrorDetail: "git branch delete failed" },
  );
});
```

Register it in the returned `GitVcsDriver.GitVcsDriver.of({…})` object (~`:2919-2922`), with the cache-invalidation wrapper like its neighbors:

```ts
    deleteBranch: (input) => withListRefsInvalidation(input.cwd, deleteBranch(input)),
```

- [ ] **Step 5: Expose through `GitWorkflowService.ts`** — add to the interface (~`:35-95`, next to `removeWorktree`):

```ts
    readonly deleteBranch: (
      input: GitVcsDriver.GitDeleteBranchInput,
    ) => Effect.Effect<void, GitCommandError>;
```

and to the returned implementation object (~`:280-326`, mirroring `removeWorktree`):

```ts
    deleteBranch: (input) =>
      ensureGitCommand("GitWorkflowService.deleteBranch", input.cwd).pipe(
        Effect.andThen(git.deleteBranch(input)),
      ),
```

(`git` is the resolved `GitVcsDriver.GitVcsDriver`; `GitVcsDriver` is already imported in this file. Add the type import if needed.)

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd apps/server && pnpm exec vp test run src/vcs/GitVcsDriverCore.test.ts -t "deletes a merged branch"`
Expected: PASS.

- [ ] **Step 7: Typecheck + commit**

Run: `pnpm --filter t3 typecheck`
Then:

```bash
git add apps/server/src/vcs/GitVcsDriver.ts apps/server/src/vcs/GitVcsDriverCore.ts apps/server/src/git/GitWorkflowService.ts apps/server/src/vcs/GitVcsDriverCore.test.ts
git commit -m "feat(server): add git deleteBranch driver primitive"
```

---

## Task 2: Driver primitive `fastForwardBranch`

Fast-forwards a (possibly non-checked-out) local branch to another ref via `git fetch . <toRef>:<branch>`. Used to advance the base to the branch tip without switching the main checkout.

**Files:**

- Modify: `apps/server/src/vcs/GitVcsDriver.ts`, `GitVcsDriverCore.ts`, `GitWorkflowService.ts`
- Test: `apps/server/src/vcs/GitVcsDriverCore.test.ts`

**Interfaces:**

- Produces: `GitFastForwardBranchInput { readonly cwd: string; readonly branch: string; readonly toRef: string }`; `fastForwardBranch: (input) => Effect.Effect<void, GitCommandError>` on both `GitVcsDriver` and `GitWorkflowService`.

- [ ] **Step 1: Write the failing test** (in the `describe("branch deletion", …)` sibling, add a new `describe("fast-forward", …)`):

```ts
it.effect("fast-forwards a base branch to a descendant branch tip", () =>
  Effect.gen(function* () {
    const cwd = yield* makeTmpDir();
    const { initialBranch } = yield* initRepoWithCommit(cwd);
    const driver = yield* GitVcsDriver.GitVcsDriver;

    // Create feature branch, add a commit on it, then return to base.
    yield* driver.createRef({ cwd, refName: "feature/ahead", switchRef: true });
    yield* writeTextFile(cwd, "feature.txt", "feature work\n");
    yield* git(cwd, ["add", "."]);
    yield* git(cwd, ["commit", "-m", "feature commit"]);
    const featureSha = yield* git(cwd, ["rev-parse", "HEAD"]);
    yield* driver.switchRef({ cwd, refName: initialBranch });

    yield* driver.fastForwardBranch({ cwd, branch: initialBranch, toRef: "feature/ahead" });

    assert.equal(yield* git(cwd, ["rev-parse", initialBranch]), featureSha);
  }),
);
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd apps/server && pnpm exec vp test run src/vcs/GitVcsDriverCore.test.ts -t "fast-forwards a base branch"`
Expected: FAIL — `driver.fastForwardBranch is not a function`.

- [ ] **Step 3: Add type + interface method** in `GitVcsDriver.ts`:

```ts
export interface GitFastForwardBranchInput {
  readonly cwd: string;
  readonly branch: string;
  readonly toRef: string;
}
```

```ts
    readonly fastForwardBranch: (
      input: GitFastForwardBranchInput,
    ) => Effect.Effect<void, GitCommandError>;
```

- [ ] **Step 4: Implement in `GitVcsDriverCore.ts`** (after `deleteBranch`). `git fetch . <src>:<dst>` performs a fast-forward-only update of local branch `dst` to `src` and refuses a non-FF move or a `dst` that is checked out anywhere — exactly the safety we want:

```ts
const fastForwardBranch: GitVcsDriver.GitVcsDriver["Service"]["fastForwardBranch"] = Effect.fn(
  "fastForwardBranch",
)(function* (input) {
  yield* executeGit(
    "GitVcsDriver.fastForwardBranch",
    input.cwd,
    ["fetch", ".", `${input.toRef}:${input.branch}`],
    { timeoutMs: 30_000, fallbackErrorDetail: "git fast-forward update failed" },
  );
});
```

Register in `.of({…})`:

```ts
    fastForwardBranch: (input) => withListRefsInvalidation(input.cwd, fastForwardBranch(input)),
```

- [ ] **Step 5: Expose through `GitWorkflowService.ts`** (interface + impl, mirroring `deleteBranch` from Task 1):

```ts
    readonly fastForwardBranch: (
      input: GitVcsDriver.GitFastForwardBranchInput,
    ) => Effect.Effect<void, GitCommandError>;
```

```ts
    fastForwardBranch: (input) =>
      ensureGitCommand("GitWorkflowService.fastForwardBranch", input.cwd).pipe(
        Effect.andThen(git.fastForwardBranch(input)),
      ),
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd apps/server && pnpm exec vp test run src/vcs/GitVcsDriverCore.test.ts -t "fast-forwards a base branch"`
Expected: PASS.

- [ ] **Step 7: Typecheck + commit**

Run: `pnpm --filter t3 typecheck`

```bash
git add apps/server/src/vcs/GitVcsDriver.ts apps/server/src/vcs/GitVcsDriverCore.ts apps/server/src/git/GitWorkflowService.ts apps/server/src/vcs/GitVcsDriverCore.test.ts
git commit -m "feat(server): add git fastForwardBranch driver primitive"
```

---

## Task 3: Driver primitive `mergeRef` (with conflict detection)

Merges a ref into the current branch of `cwd`. Returns `"merged"` (with the resulting HEAD sha) or `"conflict"` (leaving conflict markers in the working tree for later resolution). A non-zero exit that is _not_ a conflict is a real failure.

**Files:**

- Modify: `apps/server/src/vcs/GitVcsDriver.ts`, `GitVcsDriverCore.ts`, `GitWorkflowService.ts`
- Test: `apps/server/src/vcs/GitVcsDriverCore.test.ts`

**Interfaces:**

- Produces:

```ts
export interface GitMergeRefInput {
  readonly cwd: string;
  readonly refName: string;
}
export type GitMergeRefResult =
  | { readonly status: "merged"; readonly mergeCommitSha: string }
  | { readonly status: "conflict"; readonly mergeCommitSha: null };
```

`mergeRef: (input: GitMergeRefInput) => Effect.Effect<GitMergeRefResult, GitCommandError>` on both `GitVcsDriver` and `GitWorkflowService`.

- [ ] **Step 1: Write the failing tests** — a clean merge and a conflicting merge (new `describe("merge", …)`):

```ts
it.effect("merges a ref into the current branch cleanly", () =>
  Effect.gen(function* () {
    const cwd = yield* makeTmpDir();
    const { initialBranch } = yield* initRepoWithCommit(cwd);
    const driver = yield* GitVcsDriver.GitVcsDriver;

    // base advances on a NEW file; feature untouched → clean merge.
    yield* writeTextFile(cwd, "base.txt", "base change\n");
    yield* git(cwd, ["add", "."]);
    yield* git(cwd, ["commit", "-m", "base commit"]);
    const baseSha = yield* git(cwd, ["rev-parse", "HEAD"]);

    yield* driver.createRef({ cwd, refName: "feature/clean", switchRef: true });
    yield* git(cwd, ["reset", "--hard", "HEAD~0"]); // no-op, keep feature at base tip minus base.txt
    // Put feature one commit behind base by branching from the first commit:
    yield* driver.switchRef({ cwd, refName: initialBranch });

    // Re-branch feature from BEFORE base.txt so base is ahead by one file-add.
    yield* git(cwd, ["branch", "-D", "feature/clean"]);
    yield* git(cwd, ["branch", "feature/clean", `${baseSha}~1`]);
    yield* driver.switchRef({ cwd, refName: "feature/clean" });

    const result = yield* driver.mergeRef({ cwd, refName: initialBranch });

    assert.equal(result.status, "merged");
    assert.equal(
      yield* git(cwd, [
        "cat-file",
        "-e",
        `${result.status === "merged" ? result.mergeCommitSha : ""}^{commit}`,
      ]),
      "",
    );
  }),
);

it.effect("reports a conflict without aborting the merge", () =>
  Effect.gen(function* () {
    const cwd = yield* makeTmpDir();
    const { initialBranch } = yield* initRepoWithCommit(cwd);
    const driver = yield* GitVcsDriver.GitVcsDriver;

    // Both branches edit README's single line → guaranteed conflict.
    yield* writeTextFile(cwd, "README.md", "# base edit\n");
    yield* git(cwd, ["add", "."]);
    yield* git(cwd, ["commit", "-m", "base edits readme"]);
    const baseSha = yield* git(cwd, ["rev-parse", "HEAD"]);

    yield* git(cwd, ["branch", "feature/conflict", `${baseSha}~1`]);
    yield* driver.switchRef({ cwd, refName: "feature/conflict" });
    yield* writeTextFile(cwd, "README.md", "# feature edit\n");
    yield* git(cwd, ["add", "."]);
    yield* git(cwd, ["commit", "-m", "feature edits readme"]);

    const result = yield* driver.mergeRef({ cwd, refName: initialBranch });

    assert.equal(result.status, "conflict");
    const unmerged = yield* git(cwd, ["ls-files", "--unmerged"]);
    assert.equal(unmerged.length > 0, true);
  }),
);
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd apps/server && pnpm exec vp test run src/vcs/GitVcsDriverCore.test.ts -t "merges a ref"`
Expected: FAIL — `driver.mergeRef is not a function`.

- [ ] **Step 3: Add types + interface method** in `GitVcsDriver.ts`:

```ts
export interface GitMergeRefInput {
  readonly cwd: string;
  readonly refName: string;
}
export type GitMergeRefResult =
  | { readonly status: "merged"; readonly mergeCommitSha: string }
  | { readonly status: "conflict"; readonly mergeCommitSha: null };
```

```ts
    readonly mergeRef: (
      input: GitMergeRefInput,
    ) => Effect.Effect<GitMergeRefResult, GitCommandError>;
```

- [ ] **Step 4: Implement in `GitVcsDriverCore.ts`** (after `fastForwardBranch`). `gitCommandContext` and `GitCommandError` are already available in this module (`GitVcsDriverCore.ts:376-385`, imported from `@t3tools/contracts`):

```ts
const mergeRef: GitVcsDriver.GitVcsDriver["Service"]["mergeRef"] = Effect.fn("mergeRef")(
  function* (input) {
    const mergeResult = yield* executeGit(
      "GitVcsDriver.mergeRef",
      input.cwd,
      ["merge", "--no-edit", input.refName],
      { timeoutMs: 60_000, allowNonZeroExit: true, fallbackErrorDetail: "git merge failed" },
    );

    if (mergeResult.exitCode === 0) {
      const mergeCommitSha = yield* runGitStdout("GitVcsDriver.mergeRef.head", input.cwd, [
        "rev-parse",
        "HEAD",
      ]).pipe(Effect.map((stdout) => stdout.trim()));
      return { status: "merged" as const, mergeCommitSha };
    }

    const unmerged = yield* runGitStdout(
      "GitVcsDriver.mergeRef.unmerged",
      input.cwd,
      ["ls-files", "--unmerged"],
      true,
    ).pipe(Effect.map((stdout) => stdout.trim()));

    if (unmerged.length > 0) {
      return { status: "conflict" as const, mergeCommitSha: null };
    }

    return yield* new GitCommandError({
      ...gitCommandContext({
        operation: "GitVcsDriver.mergeRef",
        cwd: input.cwd,
        args: ["merge", "--no-edit", input.refName],
      }),
      detail: "git merge failed without producing conflicts.",
      ...(mergeResult.exitCode === null ? {} : { exitCode: mergeResult.exitCode }),
    });
  },
);
```

Register in `.of({…})`:

```ts
    mergeRef: (input) => withListRefsInvalidation(input.cwd, mergeRef(input)),
```

- [ ] **Step 5: Expose through `GitWorkflowService.ts`** (interface + impl):

```ts
    readonly mergeRef: (
      input: GitVcsDriver.GitMergeRefInput,
    ) => Effect.Effect<GitVcsDriver.GitMergeRefResult, GitCommandError>;
```

```ts
    mergeRef: (input) =>
      ensureGitCommand("GitWorkflowService.mergeRef", input.cwd).pipe(
        Effect.andThen(git.mergeRef(input)),
      ),
```

- [ ] **Step 6: Run both tests to verify they pass**

Run: `cd apps/server && pnpm exec vp test run src/vcs/GitVcsDriverCore.test.ts -t "mergeRef"` (or run the two `-t "merges a ref"` and `-t "reports a conflict"`).
Expected: PASS.

- [ ] **Step 7: Typecheck + commit**

Run: `pnpm --filter t3 typecheck`

```bash
git add apps/server/src/vcs/GitVcsDriver.ts apps/server/src/vcs/GitVcsDriverCore.ts apps/server/src/git/GitWorkflowService.ts apps/server/src/vcs/GitVcsDriverCore.test.ts
git commit -m "feat(server): add git mergeRef driver primitive with conflict detection"
```

---

## Task 4: `MergeCleanupService` — happy path (no conflict)

The service that runs the whole sequence when the base merges cleanly: auto-commit the worktree, merge base into the branch, fast-forward the base, remove the worktree, delete the branch, archive the thread.

**Files:**

- Create: `apps/server/src/git/MergeCleanupService.ts`
- Test: `apps/server/src/git/MergeCleanupService.test.ts`

**Interfaces:**

- Consumes: `GitWorkflowService` (`runStackedAction`, `mergeRef`, `fastForwardBranch`, `removeWorktree`, `deleteBranch`), `GitVcsDriver.GitVcsDriver` (`readConfigValue`, `execute`), `ProjectionSnapshotQuery` (`getThreadShellById` → thread shell with `worktreePath`, `branch`, `projectId`), `OrchestrationEngineService` (`dispatch`), `Crypto.Crypto`.
- Produces:

```ts
export interface MergeCleanupContext {
  readonly threadId: ThreadId;
  readonly workspaceRoot: string;
  readonly worktreePath: string;
  readonly branch: string;
  readonly base: string;
}
export interface MergeCleanupAttemptResult {
  readonly outcome: "completed" | "awaiting_conflict";
}
export interface MergeCleanupServiceShape {
  readonly attempt: (input: {
    readonly threadId: ThreadId;
    readonly workspaceRoot: string;
  }) => Effect.Effect<MergeCleanupAttemptResult, MergeCleanupError>;
  readonly resumeIfClean: (threadId: ThreadId) => Effect.Effect<void, never>;
}
export class MergeCleanupService extends Context.Service<
  MergeCleanupService,
  MergeCleanupServiceShape
>()("t3/git/MergeCleanupService") {}
export const MergeCleanupServiceLive: Layer.Layer<MergeCleanupService, never, /* deps */ never>;
```

`MergeCleanupError` is a `Schema.TaggedErrorClass` with `{ threadId: string; detail: string }`.

> **Note on `ProjectionSnapshotQuery`:** confirm the exact service tag and method used elsewhere in the server for reading a thread shell by id. `ws.ts:1024-1089` uses `projectionSnapshotQuery.getThreadShellById(threadId)` returning `Option<…>`. Resolve `workspaceRoot` from the RPC input (the client passes the project root — see Task 7), NOT from a project projection, to avoid a second query.

- [ ] **Step 1: Write the failing test** — clean-merge finalize over a real repo, with a fake `OrchestrationEngineService` capturing dispatched commands. Build the layer from `GitVcsDriver.layer` + `ServerConfig.layerTest` + `NodeServices.layer` (same as `GitVcsDriverCore.test.ts:33-40`) plus a fake `ProjectionSnapshotQuery` returning a thread shell whose `worktreePath`/`branch`/`projectId` you control, and a fake `OrchestrationEngineService` whose `dispatch` pushes into a `Ref<ReadonlyArray<…>>`.

```ts
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
// … NodeServices, FileSystem, Path, ServerConfig, GitVcsDriver, GitWorkflowService, fakes …

it.effect("merges cleanly, removes the worktree, deletes the branch, and archives the thread", () =>
  Effect.gen(function* () {
    // Arrange: init a repo on `main`, create a worktree branch `feature/x` via the driver
    // (this writes branch.feature/x.gh-merge-base=main), add a commit in the worktree,
    // and advance main by one unrelated file so the merge is a real (clean) merge.
    // Point the fake ProjectionSnapshotQuery at { worktreePath, branch: "feature/x", projectId }.

    const service = yield* MergeCleanupService;
    const result = yield* service.attempt({ threadId, workspaceRoot: repoDir });

    assert.equal(result.outcome, "completed");
    // main now contains the feature commit (fast-forwarded / merged):
    assert.equal(
      yield* git(repoDir, ["log", "main", "--oneline"]).pipe(/* contains feature */),
      true,
    );
    // worktree dir removed, branch gone:
    assert.equal(yield* fileExists(worktreePath), false);
    assert.equal((yield* git(repoDir, ["branch", "--list", "feature/x"])).trim(), "");
    // a thread.archive command was dispatched:
    const dispatched = yield* Ref.get(dispatchedCommands);
    assert.equal(
      dispatched.some((c) => c.type === "thread.archive" && c.threadId === threadId),
      true,
    );
  }),
);
```

(Use the temp-repo helpers copied from `GitVcsDriverCore.test.ts:47-115`: `makeTmpDir`, `writeTextFile`, `git`, `initRepoWithCommit`. Create the worktree with `driver.createWorktree({ cwd: repoDir, refName: "main", newRefName: "feature/x", baseRefName: "main", path: worktreePath })` so `gh-merge-base` is set.)

- [ ] **Step 2: Run to confirm failure**

Run: `cd apps/server && pnpm exec vp test run src/git/MergeCleanupService.test.ts`
Expected: FAIL — module `./MergeCleanupService.ts` does not exist.

- [ ] **Step 3: Create `MergeCleanupService.ts`** with the happy-path logic. `serverCommandId` mirrors `CheckpointReactor.ts:79-83`. The auto-commit reuses the existing `runStackedAction("commit")` (generates a message and gracefully skips when the worktree is clean). Read the base from `gh-merge-base`; fall back to the main checkout's current branch name only if the config key is missing.

```ts
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as HashMap from "effect/HashMap";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Crypto from "effect/unstable/crypto/Crypto";

import { CommandId, MessageId, type ThreadId } from "@t3tools/contracts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as GitWorkflowService from "./GitWorkflowService.ts";
import { OrchestrationEngineService } from "../orchestration/Layers/OrchestrationEngine.ts"; // verify exact import path
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts"; // verify exact tag

export class MergeCleanupError extends Schema.TaggedErrorClass<MergeCleanupError>()(
  "MergeCleanupError",
  { threadId: Schema.String, detail: Schema.String },
) {
  override get message(): string {
    return `Merge cleanup failed for thread ${this.threadId}: ${this.detail}`;
  }
}

export interface MergeCleanupContext {
  readonly threadId: ThreadId;
  readonly workspaceRoot: string;
  readonly worktreePath: string;
  readonly branch: string;
  readonly base: string;
}
export interface MergeCleanupAttemptResult {
  readonly outcome: "completed" | "awaiting_conflict";
}
export interface MergeCleanupServiceShape {
  readonly attempt: (input: {
    readonly threadId: ThreadId;
    readonly workspaceRoot: string;
  }) => Effect.Effect<MergeCleanupAttemptResult, MergeCleanupError>;
  readonly resumeIfClean: (threadId: ThreadId) => Effect.Effect<void, never>;
}
export class MergeCleanupService extends Context.Service<
  MergeCleanupService,
  MergeCleanupServiceShape
>()("t3/git/MergeCleanupService") {}

const make = Effect.gen(function* () {
  const gitWorkflow = yield* GitWorkflowService.GitWorkflowService;
  const gitCore = yield* GitVcsDriver.GitVcsDriver;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const crypto = yield* Crypto.Crypto;
  const pending = yield* Ref.make(HashMap.empty<ThreadId, MergeCleanupContext>());

  const serverCommandId = (tag: string) =>
    crypto.randomUUIDv4.pipe(Effect.map((uuid) => CommandId.make(`server:${tag}:${uuid}`)));

  const currentBranchOf = (cwd: string) =>
    gitCore
      .execute({ operation: "MergeCleanup.currentBranch", cwd, args: ["branch", "--show-current"] })
      .pipe(Effect.map((r) => r.stdout.trim()));

  const fail = (threadId: ThreadId, detail: string) =>
    Effect.fail(new MergeCleanupError({ threadId, detail }));

  const resolveContext = (input: { readonly threadId: ThreadId; readonly workspaceRoot: string }) =>
    Effect.gen(function* () {
      const shellOption = yield* projectionSnapshotQuery
        .getThreadShellById(input.threadId)
        .pipe(Effect.orElseSucceed(() => Option.none()));
      if (Option.isNone(shellOption)) {
        return yield* fail(input.threadId, "Thread not found.");
      }
      const shell = shellOption.value;
      if (!shell.worktreePath || !shell.branch) {
        return yield* fail(input.threadId, "Thread has no worktree to merge.");
      }
      const configuredBase = yield* gitCore
        .readConfigValue(shell.worktreePath, `branch.${shell.branch}.gh-merge-base`)
        .pipe(Effect.orElseSucceed(() => null));
      const base = configuredBase ?? (yield* currentBranchOf(input.workspaceRoot));
      if (!base || base === shell.branch) {
        return yield* fail(input.threadId, "Could not resolve a base branch to merge into.");
      }
      return {
        threadId: input.threadId,
        workspaceRoot: input.workspaceRoot,
        worktreePath: shell.worktreePath,
        branch: shell.branch,
        base,
      } satisfies MergeCleanupContext;
    });

  const advanceBase = (ctx: MergeCleanupContext) =>
    Effect.gen(function* () {
      const mainBranch = yield* currentBranchOf(ctx.workspaceRoot);
      if (mainBranch === ctx.base) {
        // base is checked out in the main tree → fast-forward it there (updates the tree).
        yield* gitWorkflow.mergeRef({ cwd: ctx.workspaceRoot, refName: ctx.branch });
      } else {
        yield* gitWorkflow.fastForwardBranch({
          cwd: ctx.workspaceRoot,
          branch: ctx.base,
          toRef: ctx.branch,
        });
      }
    });

  const finalize = (ctx: MergeCleanupContext) =>
    Effect.gen(function* () {
      yield* advanceBase(ctx);
      yield* gitWorkflow.removeWorktree({
        cwd: ctx.workspaceRoot,
        path: ctx.worktreePath,
        force: true,
      });
      yield* gitWorkflow.deleteBranch({ cwd: ctx.workspaceRoot, branch: ctx.branch });
      yield* orchestrationEngine.dispatch({
        type: "thread.archive",
        commandId: yield* serverCommandId("merge-cleanup-archive"),
        threadId: ctx.threadId,
      });
      yield* Ref.update(pending, HashMap.remove(ctx.threadId));
    });

  const attempt: MergeCleanupServiceShape["attempt"] = (input) =>
    Effect.gen(function* () {
      const ctx = yield* resolveContext(input);
      // 1. auto-commit whatever is dirty in the worktree (skips cleanly if nothing to commit)
      const commitActionId = yield* serverCommandId("merge-cleanup-commit");
      yield* gitWorkflow
        .runStackedAction({ actionId: commitActionId, cwd: ctx.worktreePath, action: "commit" })
        .pipe(
          Effect.mapError(
            (error) => new MergeCleanupError({ threadId: ctx.threadId, detail: error.message }),
          ),
        );
      // 2. bring the base into the worktree branch
      const merge = yield* gitWorkflow
        .mergeRef({ cwd: ctx.worktreePath, refName: ctx.base })
        .pipe(
          Effect.mapError(
            (error) => new MergeCleanupError({ threadId: ctx.threadId, detail: error.message }),
          ),
        );
      if (merge.status === "conflict") {
        // handled in Task 5
        return { outcome: "awaiting_conflict" as const };
      }
      yield* finalize(ctx).pipe(
        Effect.mapError((error) =>
          error instanceof MergeCleanupError
            ? error
            : new MergeCleanupError({ threadId: ctx.threadId, detail: String(error) }),
        ),
      );
      return { outcome: "completed" as const };
    });

  const resumeIfClean: MergeCleanupServiceShape["resumeIfClean"] = () => Effect.void; // Task 5

  return { attempt, resumeIfClean } satisfies MergeCleanupServiceShape;
});

export const MergeCleanupServiceLive = Layer.effect(MergeCleanupService, make);
```

> Verify the exact import paths/tags for `OrchestrationEngineService` and `ProjectionSnapshotQuery` against the server tree (`apps/server/src/orchestration/Layers/OrchestrationEngine.ts`, `.../Services/ProjectionSnapshotQuery.ts` and `.../Layers/ProjectionSnapshotQuery.ts`). The `thread.archive` command shape is `{ type, commandId, threadId }` (`orchestration.ts:576-580`).

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/server && pnpm exec vp test run src/git/MergeCleanupService.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter t3 typecheck`

```bash
git add apps/server/src/git/MergeCleanupService.ts apps/server/src/git/MergeCleanupService.test.ts
git commit -m "feat(server): add MergeCleanupService happy-path merge/cleanup/archive"
```

---

## Task 5: `MergeCleanupService` — conflict path + auto-resume

On conflict, record the context in the in-memory pending map and post a resolution prompt to the agent via `thread.turn.start`. `resumeIfClean` finalizes once the worktree is clean and has no unmerged paths.

**Files:**

- Modify: `apps/server/src/git/MergeCleanupService.ts`, `MergeCleanupService.test.ts`

**Interfaces:**

- Consumes: the `thread.turn.start` command schema (`orchestration.ts:685-704`): `{ type: "thread.turn.start", commandId, threadId, message: { messageId, role: "user", text, attachments: [] }, createdAt }` (runtime/interaction modes have decoding defaults, so omit them).
- Produces: `resumeIfClean` now finalizes pending threads; `attempt` sets pending + dispatches the prompt on conflict.

- [ ] **Step 1: Write the failing tests** — (a) conflict → `awaiting_conflict`, worktree untouched (still conflicted), a `thread.turn.start` dispatched with a French prompt; (b) after the test resolves the conflict + commits, `resumeIfClean(threadId)` finalizes (base advanced, worktree removed, branch deleted, `thread.archive` dispatched).

```ts
it.effect("hands a conflict to the agent and stays pending", () =>
  Effect.gen(function* () {
    // Arrange a guaranteed conflict (both base and feature edit the same README line).
    const service = yield* MergeCleanupService;
    const result = yield* service.attempt({ threadId, workspaceRoot: repoDir });

    assert.equal(result.outcome, "awaiting_conflict");
    // worktree + branch still there:
    assert.equal(yield* fileExists(worktreePath), true);
    // a turn.start with a user message was dispatched:
    const dispatched = yield* Ref.get(dispatchedCommands);
    const turn = dispatched.find((c) => c.type === "thread.turn.start" && c.threadId === threadId);
    assert.equal(turn !== undefined, true);
    // no archive yet:
    assert.equal(
      dispatched.some((c) => c.type === "thread.archive"),
      false,
    );
  }),
);

it.effect("resumeIfClean finalizes once the conflict is resolved and committed", () =>
  Effect.gen(function* () {
    const service = yield* MergeCleanupService;
    yield* service.attempt({ threadId, workspaceRoot: repoDir }); // → conflict, pending

    // Simulate the agent resolving + committing the merge inside the worktree:
    yield* writeTextFile(worktreePath, "README.md", "# resolved\n");
    yield* git(worktreePath, ["add", "README.md"]);
    yield* git(worktreePath, ["commit", "--no-edit"]); // conclude the in-progress merge

    yield* service.resumeIfClean(threadId);

    assert.equal(yield* fileExists(worktreePath), false);
    assert.equal((yield* git(repoDir, ["branch", "--list", "feature/x"])).trim(), "");
    const dispatched = yield* Ref.get(dispatchedCommands);
    assert.equal(
      dispatched.some((c) => c.type === "thread.archive" && c.threadId === threadId),
      true,
    );
  }),
);

it.effect("resumeIfClean does nothing while the worktree is still conflicted", () =>
  Effect.gen(function* () {
    const service = yield* MergeCleanupService;
    yield* service.attempt({ threadId, workspaceRoot: repoDir }); // conflict, pending, NOT resolved

    yield* service.resumeIfClean(threadId);

    assert.equal(yield* fileExists(worktreePath), true); // untouched
  }),
);
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd apps/server && pnpm exec vp test run src/git/MergeCleanupService.test.ts -t "conflict"`
Expected: FAIL — attempt currently returns `awaiting_conflict` but dispatches no prompt and never records pending; `resumeIfClean` is a no-op.

- [ ] **Step 3: Implement the conflict branch + resume** in `MergeCleanupService.ts`.

Add a prompt builder + `MessageId` import (`import { CommandId, MessageId, type ThreadId } from "@t3tools/contracts";`) and a clean-check helper. Replace the conflict branch in `attempt` and the `resumeIfClean` stub:

```ts
const CONFLICT_PROMPT = (base: string) =>
  [
    `La fusion de la branche \`${base}\` dans cette branche a produit des conflits git.`,
    "Résous les conflits dans les fichiers marqués, puis conclus la fusion avec un commit.",
    "Ne touche à rien d'autre : une fois le worktree propre, la finalisation reprendra automatiquement.",
  ].join("\n");

const isWorktreeClean = (cwd: string) =>
  Effect.gen(function* () {
    const unmerged = yield* gitCore
      .execute({ operation: "MergeCleanup.unmerged", cwd, args: ["ls-files", "--unmerged"] })
      .pipe(Effect.map((r) => r.stdout.trim()));
    const status = yield* gitCore
      .execute({ operation: "MergeCleanup.status", cwd, args: ["status", "--porcelain"] })
      .pipe(Effect.map((r) => r.stdout.trim()));
    return unmerged.length === 0 && status.length === 0;
  });

const postConflictPrompt = (ctx: MergeCleanupContext) =>
  Effect.gen(function* () {
    const commandId = yield* serverCommandId("merge-cleanup-conflict");
    const messageId = yield* crypto.randomUUIDv4.pipe(Effect.map(MessageId.make));
    const createdAt = yield* nowIso; // resolve via a Clock helper used elsewhere in the server
    yield* orchestrationEngine.dispatch({
      type: "thread.turn.start",
      commandId,
      threadId: ctx.threadId,
      message: { messageId, role: "user", text: CONFLICT_PROMPT(ctx.base), attachments: [] },
      createdAt,
    });
  });
```

In `attempt`, replace the conflict branch body:

```ts
if (merge.status === "conflict") {
  yield * Ref.update(pending, HashMap.set(ctx.threadId, ctx));
  yield *
    postConflictPrompt(ctx).pipe(
      Effect.mapError(
        (error) => new MergeCleanupError({ threadId: ctx.threadId, detail: String(error) }),
      ),
    );
  return { outcome: "awaiting_conflict" as const };
}
```

Implement `resumeIfClean` (must never fail — log and swallow, like reactors do):

```ts
const resumeIfClean: MergeCleanupServiceShape["resumeIfClean"] = (threadId) =>
  Effect.gen(function* () {
    const ctxOption = yield* Ref.get(pending).pipe(Effect.map(HashMap.get(threadId)));
    if (Option.isNone(ctxOption)) return;
    const ctx = ctxOption.value;
    const clean = yield* isWorktreeClean(ctx.worktreePath);
    if (!clean) return; // agent not done — wait for the next turn.completed
    yield* finalize(ctx);
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("merge cleanup resume failed", { threadId, cause }),
    ),
  );
```

> `nowIso`: use whatever ISO-timestamp helper the server already uses when building commands (e.g. the `nowIso` used in `ws.ts` around the `thread.session.stop` build, `ws.ts:1024-1089`). If a `Clock` service is required, add it to the `make` dependencies. Do not use `new Date()` directly.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/server && pnpm exec vp test run src/git/MergeCleanupService.test.ts`
Expected: PASS (all conflict + resume + happy-path tests).

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter t3 typecheck`

```bash
git add apps/server/src/git/MergeCleanupService.ts apps/server/src/git/MergeCleanupService.test.ts
git commit -m "feat(server): hand merge conflicts to the agent and auto-resume cleanup"
```

---

## Task 6: `MergeCleanupReactor` + layer wiring

A reactor that watches runtime `turn.completed` events and calls `resumeIfClean` for each finished turn. Threads not in the pending map are no-ops.

**Files:**

- Create: `apps/server/src/orchestration/Services/MergeCleanupReactor.ts`
- Create: `apps/server/src/orchestration/Layers/MergeCleanupReactor.ts`
- Modify: `apps/server/src/orchestration/Layers/OrchestrationReactor.ts`
- Modify: `apps/server/src/server.ts`

**Interfaces:**

- Consumes: `ProviderService` (`streamEvents` emitting `turn.completed`), `MergeCleanupService` (`resumeIfClean`). Read `threadId` off the runtime event the same way `CheckpointReactor.ts:932-937` reads it for `turn.completed`.
- Produces: `MergeCleanupReactor` service with `start(): Effect<void, never, Scope>` and `drain`.

- [ ] **Step 1: Write the failing test** — a reactor test that, given a `MergeCleanupService` fake whose `resumeIfClean` records calls, and a `ProviderService` fake whose `streamEvents` emits one `turn.completed` for `threadId`, asserts `resumeIfClean` was called with that `threadId` after `start()` + `drain`. Model it on `CheckpointReactor.test.ts` (subscription + drain) — see that file for the fake `ProviderService` stream pattern.

```ts
it.effect("calls resumeIfClean for each completed turn", () =>
  Effect.gen(function* () {
    const calls = yield* Ref.make<ReadonlyArray<string>>([]);
    // provide MergeCleanupService fake: resumeIfClean = (id) => Ref.update(calls, (a) => [...a, id])
    // provide ProviderService fake: streamEvents = Stream.make(turnCompletedEvent(threadId))
    const reactor = yield* MergeCleanupReactor;
    yield* reactor.start();
    yield* reactor.drain;
    assert.deepEqual(yield* Ref.get(calls), [threadId]);
  }),
);
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd apps/server && pnpm exec vp test run src/orchestration/Layers/MergeCleanupReactor.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Create the Service tag** `Services/MergeCleanupReactor.ts` (mirror `Services/CheckpointReactor.ts:16-40`):

```ts
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

export interface MergeCleanupReactorShape {
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;
  readonly drain: Effect.Effect<void>;
}
export class MergeCleanupReactor extends Context.Service<
  MergeCleanupReactor,
  MergeCleanupReactorShape
>()("t3/orchestration/Services/MergeCleanupReactor") {}
```

- [ ] **Step 4: Create the reactor** `Layers/MergeCleanupReactor.ts` (mirror `Layers/ThreadDeletionReactor.ts:40-100` + the runtime-stream filter from `CheckpointReactor.ts:930-937`). Use `makeDrainableWorker` and `forkParked`:

```ts
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import { ProviderService } from "../../provider/…/ProviderService.ts"; // verify path (as used by CheckpointReactor)
import { forkParked } from "../../serverActivation.ts";
import { MergeCleanupService } from "../../git/MergeCleanupService.ts";
import {
  MergeCleanupReactor,
  type MergeCleanupReactorShape,
} from "../Services/MergeCleanupReactor.ts";

const make = Effect.gen(function* () {
  const providerService = yield* ProviderService;
  const mergeCleanup = yield* MergeCleanupService;

  const processSafely = (threadId: string) =>
    mergeCleanup
      .resumeIfClean(/* ThreadId */ threadId as never)
      .pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.failCause(cause)
            : Effect.logWarning("merge cleanup reactor failed", {
                threadId,
                cause: Cause.pretty(cause),
              }),
        ),
      );

  const worker = yield* makeDrainableWorker(processSafely);

  const start: MergeCleanupReactorShape["start"] = Effect.fn("start")(function* () {
    yield* forkParked(
      Stream.runForEach(providerService.streamEvents, (event) => {
        if (event.type !== "turn.completed") return Effect.void;
        // read threadId exactly as CheckpointReactor.ts:932-937 does for turn.completed
        return worker.enqueue(event.threadId);
      }),
    );
  });

  return { start, drain: worker.drain } satisfies MergeCleanupReactorShape;
});

export const MergeCleanupReactorLive = Layer.effect(MergeCleanupReactor, make);
```

> Confirm the exact `ProviderService` import path and the `turn.completed` payload's threadId accessor by reading `CheckpointReactor.ts` around lines 915-937. Match it precisely (drop the `as never` cast — use the real `ThreadId` typing the event exposes).

- [ ] **Step 5: Wire `start()`** in `OrchestrationReactor.ts` (`:14-27`) — resolve the service and call it alongside the others:

```ts
const mergeCleanupReactor = yield * MergeCleanupReactor;
// …
yield * threadDeletionReactor.start();
yield * mergeCleanupReactor.start();
```

- [ ] **Step 6: Register the layers** in `server.ts` (imports near `:57-58`, `Layer.provideMerge` near `:219-220`):

```ts
import { MergeCleanupReactorLive } from "./orchestration/Layers/MergeCleanupReactor.ts";
import { MergeCleanupServiceLive } from "./git/MergeCleanupService.ts";
// …
  Layer.provideMerge(MergeCleanupServiceLive),
  Layer.provideMerge(MergeCleanupReactorLive),
```

(Ensure `MergeCleanupServiceLive` is provided before/merged with the reactor and the WS handler layer so both resolve the same singleton.)

- [ ] **Step 7: Run the reactor test + typecheck**

Run: `cd apps/server && pnpm exec vp test run src/orchestration/Layers/MergeCleanupReactor.test.ts`
Then: `pnpm --filter t3 typecheck`
Expected: PASS + clean typecheck.

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/orchestration/Services/MergeCleanupReactor.ts apps/server/src/orchestration/Layers/MergeCleanupReactor.ts apps/server/src/orchestration/Layers/OrchestrationReactor.ts apps/server/src/server.ts apps/server/src/orchestration/Layers/MergeCleanupReactor.test.ts
git commit -m "feat(server): auto-resume merge cleanup via turn.completed reactor"
```

---

## Task 7: RPC `git.mergeCleanupThread` + WS handler

A dedicated non-streaming RPC (modeled on `preparePullRequestThread`) that carries `{ cwd, threadId }` and returns `{ outcome }`. The `cwd` is the project `workspaceRoot` (client-provided).

**Files:**

- Modify: `packages/contracts/src/git.ts` (input/result schemas)
- Modify: `packages/contracts/src/rpc.ts` (`WS_METHODS` entry, `Rpc.make`, group registration)
- Modify: `apps/server/src/ws.ts` (handler)

**Interfaces:**

- Produces:

```ts
export const GitMergeCleanupThreadInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  threadId: ThreadId,
});
export const GitMergeCleanupThreadResult = Schema.Struct({
  outcome: Schema.Literals(["completed", "awaiting_conflict"]),
});
```

RPC method string `"git.mergeCleanupThread"` at `WS_METHODS.gitMergeCleanupThread`.

- [ ] **Step 1: Add the contract schemas** in `git.ts` (near the other stacked-action schemas; `ThreadId` is importable from the contracts base — check existing imports in this file). Export both.

- [ ] **Step 2: Add the RPC** in `rpc.ts`: add `gitMergeCleanupThread: "git.mergeCleanupThread"` to `WS_METHODS` (near `:202`), then define and register:

```ts
export const WsGitMergeCleanupThreadRpc = Rpc.make(WS_METHODS.gitMergeCleanupThread, {
  payload: GitMergeCleanupThreadInput,
  success: GitMergeCleanupThreadResult,
  error: Schema.Union([GitManagerServiceError, EnvironmentAuthorizationError]),
});
```

Add `WsGitMergeCleanupThreadRpc` to the `WsRpcGroup = RpcGroup.make(…)` list (alongside `WsGitRunStackedActionRpc`, `:913`). Import `GitMergeCleanupThreadInput`/`GitMergeCleanupThreadResult` from contracts `git.ts`.

- [ ] **Step 3: Add the WS handler** in `ws.ts` (near the `gitRunStackedAction` handler, `:1785-1807`). Use `observeRpcEffect` (non-streaming) and map the service error to the RPC error type. `mergeCleanupService` is resolved in this layer alongside `gitWorkflow` (`ws.ts:363`):

```ts
        [WS_METHODS.gitMergeCleanupThread]: (input) =>
          observeRpcEffect(
            WS_METHODS.gitMergeCleanupThread,
            mergeCleanupService
              .attempt({ threadId: input.threadId, workspaceRoot: input.cwd })
              .pipe(
                Effect.tap(() => refreshGitStatus(input.cwd)),
                Effect.mapError(
                  (error) =>
                    new GitManagerServiceError({
                      // match GitManagerServiceError's fields; carry error.message as detail
                      message: error.message,
                    }),
                ),
              ),
            { "rpc.aggregate": "vcs" },
          ),
```

Resolve the service at the top of the handler layer: `const mergeCleanupService = yield* MergeCleanupService;` (import from `./git/MergeCleanupService.ts`). Verify the exact constructor/fields of `GitManagerServiceError` and adapt the `mapError` accordingly (or add `MergeCleanupError` to the RPC error union in Step 2 instead of mapping — pick whichever keeps the error typed end-to-end).

- [ ] **Step 4: Typecheck contracts + server**

Run: `pnpm --filter @t3tools/contracts typecheck && pnpm --filter t3 typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/git.ts packages/contracts/src/rpc.ts apps/server/src/ws.ts
git commit -m "feat(server): add git.mergeCleanupThread RPC + handler"
```

---

## Task 8: Client atom + action hook

Expose the RPC as a `gitEnvironment` atom and a `useMergeCleanupThreadAction` hook (model: `usePreparePullRequestThreadAction`, `apps/web/src/state/sourceControlActions.ts:307-343`).

**Files:**

- Modify: the `gitEnvironment` atoms object (the file that defines `gitEnvironment.preparePullRequestThread` — locate via the import in `sourceControlActions.ts`; likely `apps/web/src/state/…` or a client-runtime atoms module).
- Create: `apps/web/src/hooks/useMergeCleanupThreadAction.ts`

**Interfaces:**

- Consumes: `useAtomCommand`, `SourceControlActionScope { environmentId: EnvironmentId | null; cwd: string | null }`, `resolveScope`, `useAction` (all from `apps/web/src/state/sourceControlActions.ts`).
- Produces: `useMergeCleanupThreadAction(scope)` returning an action whose `run({ threadId })` calls the RPC and resolves to `AsyncResult<GitMergeCleanupThreadResult>`.

- [ ] **Step 1: Add the atom** next to `preparePullRequestThread` in the `gitEnvironment` atoms object:

```ts
mergeCleanupThread: makeAtomCommand(WsGitMergeCleanupThreadRpc), // match the exact factory used for preparePullRequestThread in this file
```

(Use the same atom-command factory the sibling entries use — read the file to copy the precise call shape and imports.)

- [ ] **Step 2: Write the hook** `useMergeCleanupThreadAction.ts` (copy the structure of `usePreparePullRequestThreadAction`):

```ts
import { AsyncResult } from "…"; // same import as sourceControlActions.ts
import { useCallback } from "react";
import type { ThreadId } from "@t3tools/contracts";
import {
  resolveScope,
  useAction,
  type SourceControlActionScope,
} from "../state/sourceControlActions";
import { gitEnvironment } from "…"; // same source as preparePullRequestThread
import { useAtomCommand } from "…";

export function useMergeCleanupThreadAction(scope: SourceControlActionScope) {
  const mergeCleanupThread = useAtomCommand(gitEnvironment.mergeCleanupThread, {
    reportFailure: false,
  });
  const action = useCallback(
    async (input: { threadId: ThreadId }) => {
      const target = resolveScope(scope);
      if (target === null) {
        return AsyncResult.failure(/* VcsActionUnavailableError "merge_cleanup_thread" — mirror the sibling */);
      }
      return mergeCleanupThread({
        environmentId: target.environmentId,
        input: { cwd: target.cwd, threadId: input.threadId },
      });
    },
    [mergeCleanupThread, scope],
  );
  return useAction({
    kind: "mergeCleanupThread",
    label: "Merging and cleaning up worktree",
    scope,
    action,
  });
}
```

> The exact `useAtomCommand`/`gitEnvironment` import paths and the `AsyncResult.failure(...)` error value must be copied verbatim from `usePreparePullRequestThreadAction` and its neighbors in `sourceControlActions.ts`. `useAction`'s `kind` is a free string used for `useSourceControlActionRunning`.

- [ ] **Step 3: Typecheck web + client-runtime**

Run: `pnpm --filter @t3tools/web typecheck` (verify the web package name; otherwise `pnpm --filter @t3tools/client-runtime typecheck` for the atoms file).
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/hooks/useMergeCleanupThreadAction.ts <the gitEnvironment atoms file>
git commit -m "feat(web): add mergeCleanupThread atom + action hook"
```

---

## Task 9: "Fusionner & nettoyer" button in the branch strip

The primary git action for worktree threads: a button in the branch/worktree strip under the composer, visible only when the active _server_ thread has a worktree. Clicking shows a light confirmation, then runs the action and toasts the outcome.

**Files:**

- Modify: `apps/web/src/components/BranchToolbar.tsx`
- Modify: `apps/web/src/components/BranchToolbar.logic.ts`
- Test: `apps/web/src/components/BranchToolbar.logic.test.ts`

**Interfaces:**

- Consumes: `useMergeCleanupThreadAction` (Task 8); `useThread`/`useProject` already used in `BranchToolbar.tsx:240-249`; `dialogs.confirm` via `readLocalApi()` (`apps/web/src/localApi.ts`); `toastManager.add(stackedThreadToast({…}))` (`apps/web/src/components/ui/toast`).
- Produces: pure helpers `shouldShowMergeCleanupButton(input): boolean` and `resolveMergeCleanupConfirmation(input): string`.

- [ ] **Step 1: Write the failing pure-logic tests** in `BranchToolbar.logic.test.ts`:

```ts
import { describe, expect, it } from "@effect/vitest";
import {
  resolveMergeCleanupConfirmation,
  shouldShowMergeCleanupButton,
} from "./BranchToolbar.logic";

describe("merge cleanup button", () => {
  it("shows only for a started server thread that has a worktree", () => {
    expect(
      shouldShowMergeCleanupButton({ hasServerThread: true, worktreePath: "/wt/x", isBusy: false }),
    ).toBe(true);
    expect(
      shouldShowMergeCleanupButton({ hasServerThread: true, worktreePath: null, isBusy: false }),
    ).toBe(false);
    expect(
      shouldShowMergeCleanupButton({
        hasServerThread: false,
        worktreePath: "/wt/x",
        isBusy: false,
      }),
    ).toBe(false);
    expect(
      shouldShowMergeCleanupButton({ hasServerThread: true, worktreePath: "/wt/x", isBusy: true }),
    ).toBe(false);
  });

  it("names the base branch in the confirmation copy", () => {
    const copy = resolveMergeCleanupConfirmation({ base: "main", branch: "feature/x" });
    expect(copy).toContain("main");
    expect(copy).toContain("feature/x");
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd apps/web && pnpm exec vp test run src/components/BranchToolbar.logic.test.ts -t "merge cleanup button"`
Expected: FAIL — helpers not exported.

- [ ] **Step 3: Add the helpers** to `BranchToolbar.logic.ts`:

```ts
export function shouldShowMergeCleanupButton(input: {
  hasServerThread: boolean;
  worktreePath: string | null;
  isBusy: boolean;
}): boolean {
  return input.hasServerThread && input.worktreePath !== null && !input.isBusy;
}

export function resolveMergeCleanupConfirmation(input: { base: string; branch: string }): string {
  return [
    `Fusionner « ${input.branch} » dans « ${input.base} », puis :`,
    "• effacer le worktree et supprimer la branche,",
    "• archiver ce thread.",
    "",
    "Tout reste 100% local. Continuer ?",
  ].join("\n");
}
```

- [ ] **Step 4: Run to verify the helpers pass**

Run: `cd apps/web && pnpm exec vp test run src/components/BranchToolbar.logic.test.ts -t "merge cleanup button"`
Expected: PASS.

- [ ] **Step 5: Add the button** in `BranchToolbar.tsx`. Inside the component (which already computes `serverThread`, `activeWorktreePath`, `activeProject` — `:240-249`), wire the hook and a click handler, and render the button in the desktop branch of the strip (near the `BranchToolbarBranchSelector`, `:347`). The base branch for the confirmation copy comes from the thread's recorded base; read it from `serverThread` if available, else fall back to the branch label (the server re-resolves the real base at run time, so the copy is informational).

```tsx
// near the other hooks in the component body:
const mergeCleanup = useMergeCleanupThreadAction({
  environmentId,
  cwd: activeProject?.workspaceRoot ?? null,
});
const showMergeCleanup = shouldShowMergeCleanupButton({
  hasServerThread: serverThread !== null,
  worktreePath: activeWorktreePath,
  isBusy: mergeCleanup.isPending,
});

const onMergeCleanup = useCallback(async () => {
  if (!serverThread || !activeWorktreePath) return;
  const localApi = readLocalApi();
  const message = resolveMergeCleanupConfirmation({
    base: serverThread.branch ?? "la base",
    branch: serverThread.branch ?? activeWorktreePath,
  });
  const confirmed = localApi ? await localApi.dialogs.confirm(message) : window.confirm(message);
  if (!confirmed) return;

  const result = await mergeCleanup.run({ threadId });
  if (result._tag === "Failure") {
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title: "Fusion impossible",
        description: "Le worktree n'a pas pu être fusionné. Voir les détails dans le thread.",
      }),
    );
    return;
  }
  if (result.value.outcome === "awaiting_conflict") {
    toastManager.add(
      stackedThreadToast({
        type: "info",
        title: "Conflit confié à l'agent",
        description: "Résous-le dans la conversation ; le nettoyage reprendra automatiquement.",
      }),
    );
  }
}, [serverThread, activeWorktreePath, mergeCleanup, threadId]);
```

Render (desktop strip, before/after the branch selector):

```tsx
{
  showMergeCleanup && (
    <Button
      variant="secondary"
      size="sm"
      onClick={() => void onMergeCleanup()}
      disabled={mergeCleanup.isPending}
    >
      Fusionner & nettoyer
    </Button>
  );
}
```

Add imports: `useMergeCleanupThreadAction` from `../hooks/useMergeCleanupThreadAction`, `shouldShowMergeCleanupButton` + `resolveMergeCleanupConfirmation` from `./BranchToolbar.logic`, `readLocalApi` from `../localApi`, `toastManager` + `stackedThreadToast` from `./ui/toast` (confirm the exact export names against `useThreadActions.ts:388-394`).

> `mergeCleanup.run` / `.isPending` — match the actual shape returned by `useAction` (see how `usePreparePullRequestThreadAction`'s result is consumed in `PullRequestThreadDialog.tsx`). Adapt `.run(...)`/`.value`/`._tag` to that shape.

- [ ] **Step 6: Typecheck web + run the logic test**

Run: `cd apps/web && pnpm exec vp test run src/components/BranchToolbar.logic.test.ts`
Then: `pnpm --filter @t3tools/web typecheck` (verify package name).
Expected: PASS + clean typecheck.

- [ ] **Step 7: Lint the touched files + commit**

Run: `pnpm exec vp lint apps/web/src/components/BranchToolbar.tsx apps/web/src/components/BranchToolbar.logic.ts apps/web/src/hooks/useMergeCleanupThreadAction.ts`

```bash
git add apps/web/src/components/BranchToolbar.tsx apps/web/src/components/BranchToolbar.logic.ts apps/web/src/components/BranchToolbar.logic.test.ts
git commit -m "feat(web): add Fusionner & nettoyer button for worktree threads"
```

---

## Final Verification

- [ ] **Server suite (scoped):** `pnpm --filter t3 test` — all server tests pass.
- [ ] **Client-runtime + web typecheck:** `pnpm --filter @t3tools/client-runtime typecheck` and the web package typecheck.
- [ ] **Manual smoke test** (desktop app, in the execution worktree):
  1. Start a thread in a "New worktree", make the agent change a file.
  2. Click "Fusionner & nettoyer" → confirm → verify: base branch contains the work, the worktree directory is gone, the branch is deleted, the thread is archived, nothing was pushed.
  3. Force a conflict (edit the same line on the base between worktree creation and merge) → click → verify the agent gets a resolution prompt in the conversation, and once it resolves + commits, the cleanup finalizes automatically.
- [ ] **PR body must note the in-memory-pending limitation** (server restart during conflict resolution loses auto-resume; re-clicking the button recovers).

---

## Self-Review Notes (for the executor)

- **Behavior coverage vs. the confirmed spec:** auto-commit (Task 4 step 3, reuses `runStackedAction("commit")`); FF-else-merge-commit shape (base merged into branch first — Task 4/5; then FF into base — `advanceBase`); delete branch (Task 1 + `finalize`); archive thread (`finalize` dispatches `thread.archive`); stay local (no push anywhere); light confirmation (Task 9); conflict → agent + auto-resume (Task 5 + Task 6); primary button in the worktree strip (Task 9).
- **Uncertain anchors to verify before coding each task** (flagged inline): exact `ProjectionSnapshotQuery` tag/method, `OrchestrationEngineService` import path, `ProviderService` path + `turn.completed` threadId accessor (mirror `CheckpointReactor.ts`), `GitManagerServiceError` fields, the `gitEnvironment` atoms module + `makeAtomCommand` factory, the web package name for `pnpm --filter`, and `useAction`'s exact result shape.
- **No new orchestration commands/events, no migration, no projector/decider changes** — the trigger is a dedicated RPC and the only orchestration dispatches are the existing `thread.turn.start` and `thread.archive`.

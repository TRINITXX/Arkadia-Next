/**
 * MergeCleanupService - Happy-path orchestration for merging a thread's
 * worktree branch back into its base branch and tearing the worktree down.
 *
 * Sequence:
 *   1. Auto-commit whatever is dirty in the worktree (reuses the existing
 *      stacked "commit" action; gracefully skips when the worktree is clean).
 *   2. Merge the base branch into the worktree's branch.
 *   3. If that merge is clean: advance the base branch (fast-forward it, or
 *      merge into it directly if it's the branch currently checked out in
 *      the main working tree), remove the worktree, delete the branch, and
 *      dispatch a `thread.archive` command.
 *   4. If that merge conflicts: record the thread as pending, post a French
 *      resolution prompt to the agent via `thread.turn.start`, and report
 *      `awaiting_conflict`. `resumeIfClean` is polled (by the reactor wired
 *      in a later task) after each agent turn; once the worktree has no
 *      unmerged paths and a clean `git status`, it finalizes the same way
 *      the happy path does.
 *
 * @module MergeCleanupService
 */
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as HashMap from "effect/HashMap";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";

import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  MessageId,
  type ThreadId,
} from "@t3tools/contracts";

import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as GitWorkflowService from "./GitWorkflowService.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";

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

  // randomUUIDv4's PlatformError is effectively unreachable (in-memory
  // random byte generation); die rather than widen every caller's error
  // channel with it (mirrors McpSessionRegistry.ts / PreviewAutomationBroker.ts).
  const serverCommandId = (tag: string) =>
    crypto.randomUUIDv4.pipe(
      Effect.orDie,
      Effect.map((uuid) => CommandId.make(`server:${tag}:${uuid}`)),
    );

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
      const base =
        configuredBase ??
        (yield* currentBranchOf(input.workspaceRoot).pipe(
          Effect.mapError(
            (error) => new MergeCleanupError({ threadId: input.threadId, detail: error.message }),
          ),
        ));
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
        // Base is checked out in the main tree → merge the branch there
        // directly, which both advances the ref and updates the tree.
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
      // `-d` (safe delete) checks whether the branch is merged into the
      // *main tree's checked-out HEAD*, not into `ctx.base`. When base isn't
      // what's checked out in the main tree, advanceBase just took the
      // fastForwardBranch branch above: it advanced `base` without moving
      // HEAD, so `-d` looks at the wrong ref and errors "not fully merged"
      // even though the branch is fully contained in `base`. `-D` is safe
      // here: advanceBase has already fast-forwarded/merged `base` to
      // include every commit on `ctx.branch`, so nothing is lost.
      yield* gitWorkflow.deleteBranch({
        cwd: ctx.workspaceRoot,
        branch: ctx.branch,
        force: true,
      });
      yield* orchestrationEngine.dispatch({
        type: "thread.archive",
        commandId: yield* serverCommandId("merge-cleanup-archive"),
        threadId: ctx.threadId,
      });
      yield* Ref.update(pending, HashMap.remove(ctx.threadId));
    });

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
      const createdAt = yield* Effect.map(DateTime.now, DateTime.formatIso);
      yield* orchestrationEngine.dispatch({
        type: "thread.turn.start",
        commandId,
        threadId: ctx.threadId,
        message: { messageId, role: "user", text: CONFLICT_PROMPT(ctx.base), attachments: [] },
        runtimeMode: DEFAULT_RUNTIME_MODE,
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        createdAt,
      });
    });

  const attempt: MergeCleanupServiceShape["attempt"] = (input) =>
    Effect.gen(function* () {
      const ctx = yield* resolveContext(input);

      // 1. Auto-commit whatever is dirty in the worktree (skips cleanly if
      // there is nothing to commit).
      const commitActionId = yield* serverCommandId("merge-cleanup-commit");
      yield* gitWorkflow
        .runStackedAction({ actionId: commitActionId, cwd: ctx.worktreePath, action: "commit" })
        .pipe(
          Effect.mapError(
            (error) => new MergeCleanupError({ threadId: ctx.threadId, detail: error.message }),
          ),
        );

      // 2. Bring the base into the worktree branch. A conflict here hands
      // resolution to the agent (see below) and stops short of finalizing.
      const merge = yield* gitWorkflow
        .mergeRef({ cwd: ctx.worktreePath, refName: ctx.base })
        .pipe(
          Effect.mapError(
            (error) => new MergeCleanupError({ threadId: ctx.threadId, detail: error.message }),
          ),
        );
      if (merge.status === "conflict") {
        yield* Ref.update(pending, HashMap.set(ctx.threadId, ctx));
        yield* postConflictPrompt(ctx).pipe(
          Effect.mapError(
            (error) => new MergeCleanupError({ threadId: ctx.threadId, detail: String(error) }),
          ),
        );
        return { outcome: "awaiting_conflict" as const };
      }

      yield* finalize(ctx).pipe(
        Effect.mapError((error) =>
          Schema.is(MergeCleanupError)(error)
            ? error
            : new MergeCleanupError({ threadId: ctx.threadId, detail: String(error) }),
        ),
      );
      return { outcome: "completed" as const };
    });

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

  return { attempt, resumeIfClean } satisfies MergeCleanupServiceShape;
});

export const MergeCleanupServiceLive = Layer.effect(MergeCleanupService, make);

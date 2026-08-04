import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";

import {
  GitCommandError,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type GitRunStackedActionResult,
  type OrchestrationCommand,
  type OrchestrationThreadShell,
} from "@t3tools/contracts";

import { ServerConfig } from "../config.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as GitWorkflowService from "./GitWorkflowService.ts";
import { MergeCleanupService, MergeCleanupServiceLive } from "./MergeCleanupService.ts";
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../orchestration/Services/OrchestrationEngine.ts";
import {
  ProjectionSnapshotQuery,
  type ProjectionSnapshotQueryShape,
} from "../orchestration/Services/ProjectionSnapshotQuery.ts";

// Test layer + temp-repo helpers mirrored from
// apps/server/src/vcs/GitVcsDriverCore.test.ts (lines ~18-115).
const ServerConfigLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "t3-merge-cleanup-test-",
});
const GitVcsDriverTestLayer = GitVcsDriver.layer.pipe(
  Layer.provide(ServerConfigLayer),
  Layer.provideMerge(NodeServices.layer),
);

const makeTmpDir = (
  prefix = "merge-cleanup-test-",
): Effect.Effect<string, PlatformError.PlatformError, FileSystem.FileSystem | Scope.Scope> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    return yield* fileSystem.makeTempDirectoryScoped({ prefix });
  });

const writeTextFile = (
  cwd: string,
  relativePath: string,
  contents: string,
): Effect.Effect<void, PlatformError.PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const filePath = pathService.join(cwd, relativePath);
    yield* fileSystem.makeDirectory(pathService.dirname(filePath), { recursive: true });
    yield* fileSystem.writeFileString(filePath, contents);
  });

const git = (
  cwd: string,
  args: ReadonlyArray<string>,
): Effect.Effect<string, GitCommandError, GitVcsDriver.GitVcsDriver> =>
  Effect.gen(function* () {
    const driver = yield* GitVcsDriver.GitVcsDriver;
    const result = yield* driver.execute({
      operation: "MergeCleanupService.test.git",
      cwd,
      args,
      timeoutMs: 10_000,
    });
    return result.stdout.trim();
  });

const initRepoWithCommit = (
  cwd: string,
): Effect.Effect<
  { readonly initialBranch: string },
  GitCommandError | PlatformError.PlatformError,
  GitVcsDriver.GitVcsDriver | FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const driver = yield* GitVcsDriver.GitVcsDriver;
    yield* driver.initRepo({ cwd });
    yield* git(cwd, ["config", "user.email", "test@test.com"]);
    yield* git(cwd, ["config", "user.name", "Test"]);
    yield* writeTextFile(cwd, "README.md", "# test\n");
    yield* git(cwd, ["add", "."]);
    yield* git(cwd, ["commit", "-m", "initial commit"]);
    const initialBranch = yield* git(cwd, ["branch", "--show-current"]);
    return { initialBranch };
  });

// A fixed "nothing to commit" result for the fake GitWorkflowService below.
// MergeCleanupService's auto-commit step is a pass-through to
// GitWorkflowService.runStackedAction("commit"); GitManager's own commit /
// commit-message-generation behavior (including the real skip-when-clean
// path) is already covered by GitManager.test.ts, so this test fakes that
// one collaborator method rather than standing up GitManager's full
// dependency graph (TextGeneration, ServerSettings, ProviderRegistry,
// SourceControlProviderRegistry) just to exercise a no-op commit.
const skippedCommitResult = {
  action: "commit",
  branch: { status: "skipped_not_requested" },
  commit: { status: "skipped_no_changes" },
  push: { status: "skipped_not_requested" },
  pr: { status: "skipped_not_requested" },
  toast: { title: "Nothing to commit", cta: { kind: "none" } },
} satisfies GitRunStackedActionResult;

// A GitWorkflowService test double: the git-primitive methods MergeCleanupService
// relies on (mergeRef, fastForwardBranch, removeWorktree, deleteBranch,
// createWorktree) delegate to the real GitVcsDriver so this test exercises real
// git operations end-to-end; runStackedAction is faked per the note above.
const gitWorkflowTestLayer = Layer.effect(
  GitWorkflowService.GitWorkflowService,
  Effect.gen(function* () {
    const driver = yield* GitVcsDriver.GitVcsDriver;
    return GitWorkflowService.GitWorkflowService.of({
      status: () => Effect.die("GitWorkflowService.status: not implemented in this fake"),
      localStatus: () => Effect.die("GitWorkflowService.localStatus: not implemented in this fake"),
      remoteStatus: () =>
        Effect.die("GitWorkflowService.remoteStatus: not implemented in this fake"),
      invalidateLocalStatus: () => Effect.void,
      invalidateRemoteStatus: () => Effect.void,
      invalidateStatus: () => Effect.void,
      pullCurrentBranch: () =>
        Effect.die("GitWorkflowService.pullCurrentBranch: not implemented in this fake"),
      runStackedAction: () => Effect.succeed(skippedCommitResult),
      resolvePullRequest: () =>
        Effect.die("GitWorkflowService.resolvePullRequest: not implemented in this fake"),
      preparePullRequestThread: () =>
        Effect.die("GitWorkflowService.preparePullRequestThread: not implemented in this fake"),
      listRefs: () => Effect.die("GitWorkflowService.listRefs: not implemented in this fake"),
      createWorktree: driver.createWorktree,
      fetchRemote: () => Effect.die("GitWorkflowService.fetchRemote: not implemented in this fake"),
      resolveRemoteTrackingCommit: () =>
        Effect.die("GitWorkflowService.resolveRemoteTrackingCommit: not implemented in this fake"),
      removeWorktree: driver.removeWorktree,
      deleteBranch: driver.deleteBranch,
      fastForwardBranch: driver.fastForwardBranch,
      mergeRef: driver.mergeRef,
      createRef: driver.createRef,
      switchRef: () => Effect.die("GitWorkflowService.switchRef: not implemented in this fake"),
      renameBranch: () =>
        Effect.die("GitWorkflowService.renameBranch: not implemented in this fake"),
    });
  }),
);

it.effect("merges cleanly, removes the worktree, deletes the branch, and archives the thread", () =>
  Effect.gen(function* () {
    const cwd = yield* makeTmpDir("merge-cleanup-repo-");
    const { initialBranch } = yield* initRepoWithCommit(cwd);
    const pathService = yield* Path.Path;
    const worktreePath = pathService.join(
      yield* makeTmpDir("merge-cleanup-worktree-"),
      "feature-x",
    );
    const driver = yield* GitVcsDriver.GitVcsDriver;

    // Create the worktree branch off the base — this writes
    // branch.feature/x.gh-merge-base=<initialBranch>.
    yield* driver.createWorktree({
      cwd,
      refName: initialBranch,
      newRefName: "feature/x",
      baseRefName: initialBranch,
      path: worktreePath,
    });

    // Commit feature work in the worktree.
    yield* writeTextFile(worktreePath, "feature.txt", "feature work\n");
    yield* git(worktreePath, ["add", "."]);
    yield* git(worktreePath, ["commit", "-m", "feature commit"]);

    // Advance the base by one unrelated commit so the merge is a real
    // (non-trivial) clean merge, not a no-op.
    yield* writeTextFile(cwd, "base.txt", "base change\n");
    yield* git(cwd, ["add", "."]);
    yield* git(cwd, ["commit", "-m", "base commit"]);

    const threadId = ThreadId.make("thread-merge-cleanup-1");
    const projectId = ProjectId.make("project-merge-cleanup-1");
    const now = "2026-08-04T00:00:00.000Z";

    const thread = {
      id: threadId,
      projectId,
      title: "Merge cleanup thread",
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5-codex" },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: "feature/x",
      worktreePath,
      latestTurn: null,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      settledOverride: null,
      settledAt: null,
      session: null,
      latestUserMessageAt: null,
      hasPendingApprovals: false,
      hasPendingUserInput: false,
      hasActionableProposedPlan: false,
    } satisfies OrchestrationThreadShell;

    const dispatched = yield* Ref.make<ReadonlyArray<OrchestrationCommand>>([]);

    const serviceLayer = MergeCleanupServiceLive.pipe(
      Layer.provide(gitWorkflowTestLayer),
      Layer.provide(
        Layer.succeed(ProjectionSnapshotQuery, {
          getThreadShellById: () => Effect.succeed(Option.some(thread)),
        } as unknown as ProjectionSnapshotQueryShape),
      ),
      Layer.provide(
        Layer.succeed(OrchestrationEngineService, {
          dispatch: (command: OrchestrationCommand) =>
            Ref.update(dispatched, (commands) => [...commands, command]).pipe(
              Effect.as({ sequence: 1 }),
            ),
        } as unknown as OrchestrationEngineShape),
      ),
    );

    const result = yield* Effect.gen(function* () {
      const service = yield* MergeCleanupService;
      return yield* service.attempt({ threadId, workspaceRoot: cwd });
    }).pipe(Effect.provide(serviceLayer));

    assert.equal(result.outcome, "completed");

    const mainLog = yield* git(cwd, ["log", initialBranch, "--oneline"]);
    assert.equal(mainLog.includes("feature commit"), true);

    const fileSystem = yield* FileSystem.FileSystem;
    assert.equal(yield* fileSystem.exists(worktreePath), false);

    assert.equal((yield* git(cwd, ["branch", "--list", "feature/x"])).trim(), "");

    const dispatchedCommands = yield* Ref.get(dispatched);
    assert.equal(
      dispatchedCommands.some(
        (command) => command.type === "thread.archive" && command.threadId === threadId,
      ),
      true,
    );
  }).pipe(Effect.provide(GitVcsDriverTestLayer)),
);

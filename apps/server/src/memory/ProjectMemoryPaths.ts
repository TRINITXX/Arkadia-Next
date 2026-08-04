// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as RepositoryIdentityResolver from "../project/RepositoryIdentityResolver.ts";

/**
 * ProjectMemoryPaths - Resolves the per-project shared-memory store directory.
 *
 * All worktrees of the same repository resolve to the SAME store directory,
 * keyed by the repository's canonical identity (or, absent a remote, by the
 * git common dir, which is shared across a repo's worktrees).
 */
export class ProjectMemoryPaths extends Context.Service<
  ProjectMemoryPaths,
  {
    readonly resolveStoreDir: (cwd: string) => Effect.Effect<string>;
  }
>()("t3/memory/ProjectMemoryPaths") {}

const hashProjectKey = (key: string): string =>
  NodeCrypto.createHash("sha256").update(key).digest("hex").slice(0, 16);

export const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const identity = yield* RepositoryIdentityResolver.RepositoryIdentityResolver;
  const processRunner = yield* ProcessRunner.ProcessRunner;
  const path = yield* Path.Path;

  // No-remote fallback: `git rev-parse --git-common-dir` resolves to the same
  // path from every worktree of a repository (unlike `--show-toplevel`, which
  // differs per worktree), so it still yields one shared store for the repo.
  const resolveGitCommonDirKey = (cwd: string) =>
    processRunner
      .run({
        command: "git",
        args: ["-C", cwd, "rev-parse", "--git-common-dir"],
        timeoutBehavior: "timedOutResult",
      })
      .pipe(
        Effect.option,
        Effect.map((result) => {
          if (result._tag === "None" || result.value.code !== 0) return null;
          const commonDir = result.value.stdout.trim();
          if (commonDir.length === 0) return null;
          // The common dir is reported relative to `cwd`; make it absolute so it
          // is comparable regardless of which worktree we were invoked from.
          return path.isAbsolute(commonDir) ? commonDir : path.join(cwd, commonDir);
        }),
      );

  const resolveProjectKey = (cwd: string) =>
    Effect.gen(function* () {
      const repositoryIdentity = yield* identity.resolve(cwd);
      if (repositoryIdentity !== null) {
        return repositoryIdentity.canonicalKey;
      }

      const commonDirKey = yield* resolveGitCommonDirKey(cwd);
      // Last-resort fallback: cwd itself (deterministic, but not shared across worktrees).
      return commonDirKey ?? cwd;
    });

  const resolveStoreDir = (cwd: string) =>
    resolveProjectKey(cwd).pipe(
      Effect.map((key) => path.join(config.projectMemoryDir, hashProjectKey(key))),
    );

  return ProjectMemoryPaths.of({ resolveStoreDir });
});

export const layer = Layer.effect(ProjectMemoryPaths, make).pipe(
  Layer.provide(RepositoryIdentityResolver.layer),
  Layer.provide(ProcessRunner.layer),
);

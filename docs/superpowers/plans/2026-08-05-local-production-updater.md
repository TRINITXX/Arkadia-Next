# Local Arkadia Production Updater Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide a one-click Windows workflow that backs up and synchronizes Arkadia configuration from the development profile to production, builds a uniquely versioned production installer, installs it silently, and restarts Arkadia.

**Architecture:** Keep pure decisions and filesystem synchronization in a testable TypeScript module under `scripts/`. A thin CLI entrypoint performs process guards, configuration synchronization, the existing desktop artifact build, silent NSIS installation, and restart. A desktop batch launcher locates the repository after either the `Arkadia-Next` or `Arkadia` folder name and delegates to the versioned CLI.

**Tech Stack:** Node.js 24, TypeScript, `node:test` through Vite Plus, PowerShell process inspection, pnpm, electron-builder NSIS.

## Global Constraints

- Development configuration is authoritative for configuration files and provider secrets only.
- Production `state.sqlite`, conversations, attachments, logs, and production-only history must never be replaced.
- Refuse to synchronize, build, or install while the installed Arkadia executable or the repository Electron development runtime is active.
- Back up every production configuration target before overwriting it.
- Generate a local timestamp prerelease version without modifying package manifests.
- Install silently and restart Arkadia only after a successful build and installation.
- Preserve unrelated working-tree changes and do not commit, push, or create a pull request.

---

### Task 1: Testable update workflow helpers

**Files:**

- Create: `scripts/update-local-arkadia.ts`
- Create: `scripts/update-local-arkadia.test.ts`

**Interfaces:**

- Produces: `makeLocalBuildVersion(baseVersion, now)`, `configurationEntries`, `makeConfigurationSyncPlan(devDir, productionDir, backupDir)`, and `findBlockingArkadiaProcesses(processes, paths)`.
- Consumes: Node path and filesystem primitives only; no build or installer side effects in helper tests.

- [ ] **Step 1: Write failing tests for local version generation**

```ts
expect(makeLocalBuildVersion("0.0.31", new Date("2026-08-05T21:15:42Z"))).toBe(
  "0.0.31-local.20260805.211542",
);
```

- [ ] **Step 2: Run the targeted test and observe the expected missing-export failure**

Run: `vp test run scripts/update-local-arkadia.test.ts`

- [ ] **Step 3: Implement the minimum version helper and rerun green**

```ts
export function makeLocalBuildVersion(baseVersion: string, now: Date): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace("T", ".").slice(0, 15);
  return `${baseVersion}-local.${stamp}`;
}
```

- [ ] **Step 4: Add failing tests for the allowlisted configuration sync plan**

The plan must include `settings.json`, `client-settings.json`, `desktop-settings.json`, `keybindings.json`, and `secrets`, and must exclude `state.sqlite`, attachments, logs, runtime files, and environment identity.

- [ ] **Step 5: Implement the minimum allowlisted plan and rerun green**

Return explicit source, destination, and backup paths for each allowlisted entry rather than traversing the whole profile.

- [ ] **Step 6: Add failing tests for exact-path process blocking**

Installed `Arkadia.exe` and repository `electron.exe` paths must block; the legacy Tauri Arkadia executable in another repository must not block this workflow.

- [ ] **Step 7: Implement exact normalized-path matching and rerun green**

Use case-insensitive Windows path normalization and never match processes by name alone.

### Task 2: CLI orchestration and safe synchronization

**Files:**

- Modify: `scripts/update-local-arkadia.ts`
- Modify: `scripts/update-local-arkadia.test.ts`

**Interfaces:**

- Consumes: helpers from Task 1 and injected command/process/filesystem adapters.
- Produces: `runLocalArkadiaUpdate(options)` plus CLI flags `--sync-only` and `--dry-run`.

- [ ] **Step 1: Write failing tests proving a blocker aborts before backup or writes**

Inject a blocking installed-process snapshot and assert that no filesystem or command action is recorded.

- [ ] **Step 2: Implement the blocker gate and rerun green**

Read process executable paths through a bounded PowerShell command and fail with a clear instruction to close Arkadia.

- [ ] **Step 3: Write failing tests for backup-before-copy ordering**

Assert each existing production target is copied into a timestamped backup before the corresponding development target overwrites it.

- [ ] **Step 4: Implement safe backup and synchronization and rerun green**

Create `C:\Users\TRINITX\.arkadia\backups\production-config-<timestamp>`, copy existing production targets first, then copy development files. Merge development secret files into the production `secrets` directory without deleting production-only files.

- [ ] **Step 5: Write failing tests for build-install-restart ordering**

Assert the CLI invokes build with `T3CODE_DESKTOP_VERSION` and the dedicated Rust toolchain, checks the expected artifact, installs it with `/S`, then launches the exact installed executable.

- [ ] **Step 6: Implement orchestration and rerun green**

Use `pnpm dist:desktop:win:x64`, wait for its exit code, run the generated NSIS executable with `/S`, and restart `%LOCALAPPDATA%\Programs\t3code\Arkadia.exe` only after success.

### Task 3: Desktop launcher and initial migration

**Files:**

- Create: `C:\Users\TRINITX\Desktop\Mettre a jour Arkadia.bat`
- Use: `scripts/update-local-arkadia.ts --sync-only`

**Interfaces:**

- Consumes: the Task 2 CLI.
- Produces: one visible double-click entrypoint on the Windows desktop and a populated production configuration profile.

- [ ] **Step 1: Create the batch launcher**

The launcher checks direct children of `C:\Users\TRINITX\Desktop\Claude Desktop` for `scripts\update-local-arkadia.ts`, prefers a repository whose desktop package has `productName` equal to `Arkadia`, invokes Node from that repository, pauses on failure, and closes after a short success message.

- [ ] **Step 2: Verify no relevant Arkadia process is active**

Run the CLI process guard. Do not stop processes by name or PID; if blocked, ask the user to close the exact application and retry.

- [ ] **Step 3: Run the initial configuration-only migration**

Run: `node scripts/update-local-arkadia.ts --sync-only`

- [ ] **Step 4: Verify migrated configuration without exposing secrets**

Confirm the production settings contains provider instance key `kimi_kimi`, verify allowlisted file hashes match development, verify production `state.sqlite` hash and timestamp were not changed by the migration, and record the backup path.

### Task 4: Final targeted verification

**Files:**

- Verify: `scripts/update-local-arkadia.ts`
- Verify: `scripts/update-local-arkadia.test.ts`
- Verify: `C:\Users\TRINITX\Desktop\Mettre a jour Arkadia.bat`

**Interfaces:**

- Consumes: all previous deliverables.
- Produces: evidence that the workflow is safe and runnable without performing a second expensive production build.

- [ ] **Step 1: Run targeted tests**

Run: `vp test run scripts/update-local-arkadia.test.ts`

- [ ] **Step 2: Run the required typecheck**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Run a dry-run from the desktop launcher target**

Run the repository CLI with `--dry-run` and verify it reports sync, version, artifact, install, and restart actions without writing or launching processes.

- [ ] **Step 4: Inspect Git and user-data state**

Confirm only intended repository files were added, unrelated changes remain untouched, the production database is unchanged, and the desktop launcher exists.

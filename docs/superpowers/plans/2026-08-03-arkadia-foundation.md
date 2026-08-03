# Arkadia Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce an isolated, Windows-buildable Arkadia desktop fork with Arkadia branding and Claude defaults matching the user's `ccd` PowerShell function.

**Architecture:** Keep T3's server, contracts, provider adapters, web client, and Electron shell. Change only product identity/state defaults and the default Claude configuration in this milestone; do not alter the conversation UI, protocol parsing, cloud login, or other providers yet.

**Tech Stack:** TypeScript, React, Effect, Electron, Vite+, Vitest/Effect Vitest, pnpm.

## Global Constraints

- Existing repositories `Arkadia` and `Arkadia-agent-mode` remain untouched.
- The upstream MIT `LICENSE` and notices remain intact.
- `origin` remains `TRINITXX/Arkadia-Next`; `upstream` remains `pingdotgg/t3code`.
- Do not read or write the installed T3 database at `~/.t3/userdata` during development.
- Do not change `t3code://` protocol schemes in this milestone.
- Claude executable is `claude`; launch arguments are `--permission-mode auto --allow-dangerously-skip-permissions --effort high`.
- Codex, Cursor, Grok, and OpenCode implementations remain available but are not customized in this milestone.
- Use focused tests only; do not run repository-wide checks.

---

### Task 1: Establish and document the stock baseline

**Files:**

- Create: `docs/superpowers/plans/2026-08-03-arkadia-t3-migration-roadmap.md`
- Create: `docs/superpowers/plans/2026-08-03-arkadia-foundation.md`

**Interfaces:**

- Consumes: upstream `main` at the fork point and the root `build:desktop` script.
- Produces: a reproducible baseline and the migration boundaries used by all later tasks.

- [x] **Step 1: Create the fork and remotes**

```powershell
gh repo fork pingdotgg/t3code --fork-name Arkadia-Next
git clone https://github.com/TRINITXX/Arkadia-Next.git Arkadia-Next
git -C Arkadia-Next remote add upstream https://github.com/pingdotgg/t3code.git
```

- [x] **Step 2: Create the isolated implementation branch**

```powershell
git switch -c codex/arkadia-shell
```

- [x] **Step 3: Install the repository toolchain and dependencies**

```powershell
Invoke-RestMethod https://viteplus.dev/install.ps1 | Invoke-Expression
$env:Path = "$env:USERPROFILE\.vite-plus\bin;$env:Path"
vp install --frozen-lockfile
```

- [x] **Step 4: Verify the unmodified desktop build**

```powershell
vp run build:desktop
```

Expected: web, server, and Electron bundles complete with exit code `0`.

### Task 2: Isolate Arkadia desktop identity and state

**Files:**

- Modify: `apps/desktop/src/app/DesktopEnvironment.test.ts`
- Modify: `apps/desktop/src/app/DesktopEnvironment.ts`
- Modify: `apps/web/src/branding.test.ts`
- Modify: `apps/web/src/branding.ts`
- Modify: `apps/desktop/scripts/electron-launcher.mjs`
- Modify: `apps/desktop/package.json`

**Interfaces:**

- Consumes: `DesktopEnvironment.layer`, `DesktopAppBranding`, and the renderer's injected desktop branding.
- Produces: default state root `~/.arkadia`, desktop user-data directories `arkadia-dev`/`arkadia`, application model IDs `com.trinitxx.arkadia.dev`/`com.trinitxx.arkadia`, and display name `Arkadia` with existing stage suffix behavior.

- [ ] **Step 1: Write failing desktop environment identity tests**

Change the implicit-state test to assert:

```ts
assert.equal(development.baseDir, "/Users/alice/.arkadia");
assert.equal(development.stateDir, "/Users/alice/.arkadia/dev");
assert.equal(production.stateDir, "/Users/alice/.arkadia/userdata");
assert.equal(development.userDataDirName, "arkadia-dev");
assert.equal(production.userDataDirName, "arkadia");
assert.equal(development.appUserModelId, "com.trinitxx.arkadia.dev");
assert.equal(production.appUserModelId, "com.trinitxx.arkadia");
assert.equal(development.branding.baseName, "Arkadia");
assert.equal(development.displayName, "Arkadia (Dev)");
```

- [ ] **Step 2: Run the desktop test and observe RED**

```powershell
vp test run apps/desktop/src/app/DesktopEnvironment.test.ts
```

Expected: assertions fail because the stock implementation still returns `.t3`, `t3code-*`, `com.t3tools.t3code.*`, and `T3 Code`.

- [ ] **Step 3: Implement the minimal desktop identity change**

In `DesktopEnvironment.ts`, use these defaults while preserving explicit configuration overrides:

```ts
const APP_BASE_NAME = "Arkadia";
const baseDir = Option.getOrElse(configuredBaseDir, () => path.join(homeDirectory, ".arkadia"));
const userDataDirName = isDevelopment ? "arkadia-dev" : "arkadia";
const legacyUserDataDirName = userDataDirName;
// default appUserModelId values:
// development: com.trinitxx.arkadia.dev
// production: com.trinitxx.arkadia
```

- [ ] **Step 4: Run the desktop test and observe GREEN**

```powershell
vp test run apps/desktop/src/app/DesktopEnvironment.test.ts
```

Expected: all tests in the file pass.

- [ ] **Step 5: Write a failing renderer fallback-brand test**

Add a test that imports `branding.ts` without desktop injection and asserts:

```ts
expect(branding.APP_BASE_NAME).toBe("Arkadia");
expect(branding.APP_DISPLAY_NAME).toBe("Arkadia (Dev)");
```

- [ ] **Step 6: Run the renderer test and observe RED**

```powershell
vp test run apps/web/src/branding.test.ts
```

Expected: fallback branding is still `T3 Code`.

- [ ] **Step 7: Change renderer and launcher branding**

- Set the fallback `APP_BASE_NAME` in `apps/web/src/branding.ts` to `Arkadia`.
- Set launcher display names to `Arkadia (Dev)` and `Arkadia`.
- Set launcher bundle IDs to `com.trinitxx.arkadia.dev.<checkout-suffix>` and `com.trinitxx.arkadia`.
- Keep launcher protocol schemes `t3code-dev` and `t3code` unchanged in this milestone.
- Set `apps/desktop/package.json` `productName` to `Arkadia`.

- [ ] **Step 8: Run focused branding and desktop tests**

```powershell
vp test run apps/web/src/branding.test.ts apps/desktop/src/app/DesktopEnvironment.test.ts apps/desktop/scripts/electron-launcher.test.mjs
```

Expected: all selected tests pass.

- [ ] **Step 9: Commit isolated identity changes**

```powershell
git add docs/superpowers/plans apps/desktop/src/app/DesktopEnvironment.ts apps/desktop/src/app/DesktopEnvironment.test.ts apps/web/src/branding.ts apps/web/src/branding.test.ts apps/desktop/scripts/electron-launcher.mjs apps/desktop/package.json
git commit -m "feat(desktop): establish isolated Arkadia identity"
```

### Task 3: Default Claude to the verified `ccd` launch behavior

**Files:**

- Modify: `packages/contracts/src/settings.test.ts`
- Modify: `packages/contracts/src/settings.ts`
- Test: `apps/server/src/provider/Layers/ClaudeAdapter.test.ts`

**Interfaces:**

- Consumes: `ClaudeSettings`, legacy-provider hydration, and `ClaudeAdapter`'s existing `parseCliArgs(claudeSettings.launchArgs)` path.
- Produces: a fresh Arkadia state decodes Claude settings with `binaryPath: "claude"` and `launchArgs: "--permission-mode auto --allow-dangerously-skip-permissions --effort high"`; persisted user settings still override the default.

- [ ] **Step 1: Record the local Claude CLI capability evidence**

```powershell
Get-Command ccd | Format-List Definition
claude --version
claude --help | Select-String -Pattern "permission-mode|dangerously|effort"
```

Expected: `ccd` expands to the required command and Claude Code advertises all three arguments.

- [ ] **Step 2: Write a failing settings-default test**

Add assertions for a fresh decoded settings object:

```ts
expect(DEFAULT_SERVER_SETTINGS.providers.claudeAgent.binaryPath).toBe("claude");
expect(DEFAULT_SERVER_SETTINGS.providers.claudeAgent.launchArgs).toBe(
  "--permission-mode auto --allow-dangerously-skip-permissions --effort high",
);
```

Also decode an explicit empty launch-argument value and assert it remains empty, proving a persisted override wins.

- [ ] **Step 3: Run the settings test and observe RED**

```powershell
vp test run packages/contracts/src/settings.test.ts
```

Expected: the fresh default launch arguments are currently an empty string.

- [ ] **Step 4: Implement the minimal Claude default**

Change only the `ClaudeSettings.launchArgs` decoding default:

```ts
Schema.withDecodingDefault(
  Effect.succeed("--permission-mode auto --allow-dangerously-skip-permissions --effort high"),
);
```

Do not change the adapter or construct a PowerShell command string.

- [ ] **Step 5: Run settings and existing Claude adapter tests**

```powershell
vp test run packages/contracts/src/settings.test.ts apps/server/src/provider/Layers/ClaudeAdapter.test.ts
```

Expected: both files pass and the adapter continues tokenizing launch arguments through its existing path.

- [ ] **Step 6: Commit the Claude preset**

```powershell
git add packages/contracts/src/settings.ts packages/contracts/src/settings.test.ts
git commit -m "feat(claude): match Arkadia ccd launch defaults"
```

### Task 4: Verify the customized desktop foundation

**Files:**

- No production file changes expected.

**Interfaces:**

- Consumes: outputs of Tasks 2 and 3.
- Produces: build and smoke-test evidence for the first customized Arkadia foundation.

- [ ] **Step 1: Run focused type checks**

```powershell
vp run --filter @t3tools/contracts typecheck
vp run --filter @t3tools/desktop typecheck
vp run --filter @t3tools/web typecheck
```

Expected: all selected packages exit `0`.

- [ ] **Step 2: Build the customized desktop bundles**

```powershell
vp run build:desktop
```

Expected: web, server, and Electron bundles complete with exit code `0`.

- [ ] **Step 3: Run the desktop smoke test**

```powershell
vp run test:desktop-smoke
```

Expected: packaged Electron entry points and required resources pass the smoke test.

- [ ] **Step 4: Confirm repository boundaries**

```powershell
git status --short
git -C "C:\Users\TRINITX\Desktop\Claude Desktop\Arkadia" status --short --branch
git -C "C:\Users\TRINITX\Desktop\Claude Desktop\Arkadia-agent-mode" status --short --branch
```

Expected: only Arkadia-Next contains this milestone's committed changes; existing Arkadia repositories retain their prior state.

- [ ] **Step 5: Push the implementation branch**

```powershell
git push -u origin codex/arkadia-shell
```

Expected: the branch is available on the Arkadia fork without creating a pull request or merging to `main`.

# Arkadia Upstream Sync and Hermes Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring Arkadia up to date with the useful T3 Code changes since its fork point and install a durable Hermes workflow that proposes future upstream changes through Telegram before applying them.

**Architecture:** Arkadia keeps `origin` as its personal repository and `upstream` as `pingdotgg/t3code`. Upstream history is merged into `main`, while Arkadia-owned UI, locally deleted features, and the entire mobile surface are preserved. Hermes' `openai` profile runs a daily policy skill from the VPS, reaches the Windows checkout over Tailscale SSH, uses Luna for routine analysis, and invokes Sol only for risky integration work.

**Tech Stack:** Git, PowerShell/OpenSSH on Windows, Hermes Agent cron/gateway/skills on Linux, Telegram, GPT-5.6 Luna, GPT-5.6 Sol.

## Global Constraints

- Work directly on `main`; do not create an implementation worktree.
- Create a cheap backup branch before every mutation.
- Never touch the checkout when tracked or safe untracked work remains uncommitted unless the user presses `Commit`.
- Exclude `apps/mobile`, official left-sidebar behavior, and locally deleted features from proposals and integration.
- Keep excluded changes completely invisible in Telegram.
- Telegram explanations are short, simple, and contain no file names or implementation jargon.
- Run at 10:00 Europe/Paris; retry every 30 minutes through 12:00 when the PC is unreachable; then wait until the next day.
- Luna is the persistent/default model. Sol is a per-invocation escalation for conflicts, migrations, major dependency changes, and risky architectural changes; return to Luna afterward.
- Push `main` automatically only after all required checks pass.
- After two failed Sol repair attempts, restore the backup, do not push, and attach a complete technical log for Claude Fable.
- Rejected upstream items stay rejected unless materially changed or required by a later accepted dependency.
- Urgent security fixes may notify immediately but still require explicit approval.

---

### Task 1: Protect and merge the current upstream baseline

**Files:**

- Modify: Git repository metadata and the current `main` merge result.
- Preserve: Arkadia-owned sidebar, command/session navigator, branding, providers, and deleted components.
- Preserve: `apps/mobile/**` exactly as Arkadia currently carries it.

**Interfaces:**

- Consumes: `origin/main`, `upstream/main`, clean local `main`.
- Produces: one reviewable merge commit on local `main` plus a `backup/upstream-2026-08-05-*` ref.

- [ ] **Step 1: Verify the repository is clean and current**

  Run `git status --short --branch`, `git fetch upstream --prune --tags`, and verify `origin/main...main` is `0 0`.

- [ ] **Step 2: Enable reusable conflict resolutions and create the backup**

  Run `git config rerere.enabled true`, `git config rerere.autoupdate true`, and create a uniquely named backup branch at the pre-merge `HEAD`.

- [ ] **Step 3: Merge without committing**

  Run `git merge --no-ff --no-commit upstream/main`. Record every conflict before resolving it.

- [ ] **Step 4: Preserve permanent Arkadia exclusions**

  Restore `apps/mobile/**` from the pre-merge backup. Keep locally deleted command palette, legacy sidebar, legacy chat header, Git actions control, and project scripts deleted. Preserve Arkadia's left-sidebar and workspace-navigation behavior rather than accepting upstream sidebar behavior.

- [ ] **Step 5: Resolve shared contracts and settings semantically**

  Combine upstream compatibility, stability, browser, terminal, title, diff, and dependency improvements with Arkadia's Hermes/Kimi providers, appearance system, project memory, merge cleanup, toolbar, and branding.

- [ ] **Step 6: Regenerate dependency metadata if necessary**

  Use the repository package manager to produce a coherent lockfile after resolving manifest conflicts; do not hand-edit generated lockfile conflict markers.

- [ ] **Step 7: Commit the merge only after verification**

  Use a conventional commit message describing the upstream synchronization and preserved Arkadia exclusions.

### Task 2: Verify the synchronized application

**Files:**

- Test: focused tests covering every conflicted contract, server, desktop, and web area.
- Test: existing Arkadia tests for sidebar/navigation, Hermes, Kimi, appearance, project memory, and merge cleanup.

**Interfaces:**

- Consumes: resolved merge tree from Task 1.
- Produces: recorded typecheck and focused-test evidence.

- [ ] **Step 1: Run `npx tsc --noEmit`**

  This is required by the repository instructions before committing.

- [ ] **Step 2: Run affected package typechecks**

  Run focused desktop, server, contracts, and web typechecks using the repository-local `vp` command.

- [ ] **Step 3: Run focused tests**

  Select tests from the actual conflict and retained-feature list. Do not run the repository-wide suite.

- [ ] **Step 4: Confirm exclusions**

  Verify `apps/mobile` has no diff from the backup and locally deleted features remain deleted.

### Task 3: Install the Hermes upstream-policy skill

**Files:**

- Create on VPS: `/home/hermes/.hermes/profiles/openai/skills/arkadia-upstream-sync/SKILL.md` or the profile-resolved equivalent.
- Create on VPS: policy/state files under the `openai` profile's private state directory.
- Create on VPS: scripts under the profile-resolved `~/.hermes/scripts/` directory.

**Interfaces:**

- Consumes: GitHub upstream releases, Tailscale SSH target `TRINITX@pc1.tailc880c9.ts.net`, Windows repository path `C:\Users\TRINITX\Desktop\Claude Desktop\Arkadia-Next`.
- Produces: filtered proposals, durable decisions, safe commits, verified updates, backups, rollback logs.

- [ ] **Step 1: Encode the permanent policy**

  Define included surfaces (`apps/desktop`, `apps/web`, `apps/server`, shared contracts/runtime) and excluded surfaces (`apps/mobile`, marketing/relay unless a required shared dependency, official sidebar, locally deleted features).

- [ ] **Step 2: Implement reachability and cleanliness preflight**

  Use non-interactive SSH over Tailscale. A failed connection emits no Telegram message during retries. A dirty checkout generates a simple summary and exposes only `Reporter` and `Commit` choices.

- [ ] **Step 3: Implement release analysis and durable decisions**

  Compare the last reviewed upstream tag/commit with current releases, group inseparable dependencies, hide exclusions, and persist accepted, rejected, pending, applied, and superseded decisions.

- [ ] **Step 4: Implement safe application**

  Create a backup branch, apply only accepted groups, invoke Sol explicitly for risky work, verify, commit, and push `origin/main` only on success.

- [ ] **Step 5: Implement failure recovery and logs**

  After two failed Sol attempts, restore the backup, attach the full log to Telegram, and keep Luna as the profile default.

### Task 4: Configure and test the Hermes schedule

**Files:**

- Modify on VPS: Hermes `openai` profile cron database through `hermes cron` commands.

**Interfaces:**

- Consumes: Task 3 skill and scripts.
- Produces: one enabled daily workflow and a harmless dry-run result.

- [ ] **Step 1: Create the 10:00 Europe/Paris schedule**

  Pin the job to GPT-5.6 Luna/OpenAI Codex and deliver only actionable messages to the configured Telegram home chat.

- [ ] **Step 2: Encode retry-window behavior**

  Retry unreachable-PC preflight at 10:30, 11:00, 11:30, and 12:00 without noise; do not retry after noon.

- [ ] **Step 3: Run a dry test**

  Confirm the job can reach the Windows checkout, read Git state, find the configured remotes, and produce no mutation in dry-run mode.

- [ ] **Step 4: Verify Telegram delivery and button handling**

  Send one clearly labeled test proposal, exercise a non-mutating callback, and remove the test state afterward.

### Task 5: Deliver the operator prompt and runbook

**Files:**

- Create: `docs/operations/arkadia-upstream-sync.md`.

**Interfaces:**

- Consumes: exact installed paths, cron job ID, model routes, backup convention, and log location.
- Produces: one copyable French bootstrap prompt and recovery instructions.

- [ ] **Step 1: Document normal operation**

  Describe the daily report, approvals, dirty-checkout flow, automatic push, refusal memory, urgent notifications, and retry window in user language.

- [ ] **Step 2: Document recovery**

  Include commands to pause/resume the cron, inspect runs, locate logs, identify the backup branch, and hand the failure log to Claude Fable.

- [ ] **Step 3: Provide the bootstrap prompt**

  The prompt must restate the permanent exclusions and require Hermes to inspect current machine state rather than assuming paths, credentials, or model availability.

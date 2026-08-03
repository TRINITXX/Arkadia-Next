# Arkadia T3 Migration Roadmap

## Product decision

Arkadia becomes an agent-first desktop application built from the T3 Code fork. The existing Tauri Arkadia repository and the experimental `Arkadia-agent-mode` worktree remain untouched as references until this fork has proven functional parity.

## Non-negotiable behavior

- Keep T3's structured provider integration, streaming thread model, attachments, queueing, checkpoints, slash commands, terminal access, and durable history.
- Start with Claude Code only in the visible product flow, while preserving provider boundaries so Codex and local providers can be enabled later.
- Launch Claude in the selected project directory with the behavior of the PowerShell `ccd` function: `claude --permission-mode auto --allow-dangerously-skip-permissions --effort high`.
- Keep one composer only. Enter sends; Shift+Enter inserts a newline.
- Keep attachments functional and visible before sending.
- Keep queued follow-ups visible, append by default while Claude is running, and expose an explicit send-now action.
- Preserve access to the real terminal for project toolbar actions and exceptional provider flows.
- Rebuild the left project/thread navigation around Arkadia's workflow.
- Add an Arkadia top toolbar and bottom status/action bar without replacing the T3 agent conversation surface.
- Keep each project's selected conversation stable when switching projects.
- Preserve the current Arkadia `/w` and `/m` worktree workflow, including live project add/remove notifications.
- Add native hold-Space dictation after the core Claude workflow is stable.
- Keep the upstream MIT license and notices.

## Migration strategy

The migration is split into independently testable vertical slices. Upstream features are hidden behind Arkadia presentation policy before being deleted. This keeps provider and session behavior intact and makes upstream rebases practical.

### Phase 0 — Fork and baseline

- GitHub fork: `TRINITXX/Arkadia-Next`.
- Local checkout: `C:\Users\TRINITX\Desktop\Claude Desktop\Arkadia-Next`.
- Upstream remote: `pingdotgg/t3code`.
- Working branch: `codex/arkadia-shell`.
- Install Vite+ and the repository's pinned dependency graph.
- Prove the unmodified web/server/Electron build on Windows.

Exit criterion: `vp run build:desktop` succeeds before product modifications.

### Phase 1 — Arkadia identity and isolated state

- Display Arkadia branding in web and desktop surfaces.
- Use Arkadia-specific application identifiers and user-data directories.
- Use `~/.arkadia` for server/session state by default.
- Keep explicit `T3CODE_HOME` support temporarily for upstream compatibility and deterministic tests.
- Keep the internal T3 protocol unchanged until the cloud/auth dependency audit is complete.

Exit criterion: desktop environment tests prove that default Arkadia state cannot collide with an installed T3 Code instance.

### Phase 2 — Claude-first baseline

- Default the Claude provider to the exact `ccd` launch arguments.
- Keep `claude` as the executable rather than trying to spawn a PowerShell alias.
- Verify Claude Code version and supported arguments locally.
- Start a real thread in a disposable project, send text and an image, queue a second turn, use send-now, run a slash command, interrupt, resume, and open the native terminal.
- Record any T3 behavior that does not match the requested workflow before visual restructuring.

Exit criterion: one complete Claude session works without PTY transcript parsing or a duplicated composer.

### Phase 3 — Arkadia application shell

- Add a central Arkadia presentation policy rather than scattering product checks across components.
- Build the top toolbar as a thin command surface over T3 project scripts and terminal APIs.
- Build the bottom bar from connection, provider, model, effort, git branch, worktree, and queue state already owned by T3.
- Keep T3's chat timeline and composer internals intact while restyling their shell.
- Use the current T3 sidebar implementation as the data source; replace its presentation incrementally.

Exit criterion: project/thread navigation, toolbar commands, composer, queue, terminal, and status bar work together in one desktop window.

### Phase 4 — Arkadia project and worktree parity

- Import or recreate Arcadia's project organization without directly editing T3's database.
- Port the `/w` live add/switch notification and `/m` live remove notification through a supported Arkadia/T3 IPC or local RPC boundary.
- Preserve parent-branch metadata and worktree cleanup semantics.
- Restore active-project bulk tab/thread actions where they still make sense in T3's thread model.

Exit criterion: create a worktree from an Arkadia project, open it automatically, work in Claude, merge it back, and remove the worktree project without stale sidebar entries.

### Phase 5 — Voice mode

- Capture hold-Space only while the composer is focused and empty of conflicting shortcuts.
- Show recording state, elapsed time, cancel state, and transcription state inside the single composer.
- Insert the final transcript into the editable draft; never write partial dictation directly into Claude's process.
- Preserve T3 attachments, mentions, slash commands, Enter, and Shift+Enter behavior.

Exit criterion: repeated real-microphone tests produce editable French transcripts without changing focus to the terminal.

### Phase 6 — Product reduction and polish

- Hide remote/mobile/cloud/account surfaces that are not part of Arkadia's first release.
- Keep underlying modules until their dependency graph and upstream-rebase cost are understood.
- Remove only code proven unreachable by tests and builds.
- Apply Arkadia spacing, typography, colors, icons, empty states, loading states, and motion across the desktop surface.
- Produce before/after screenshots for each major UI slice.

Exit criterion: no visible T3 branding remains in the local desktop flow and no hidden feature removal breaks the Claude workflow.

## Upstream maintenance rule

- `origin` is the Arkadia fork.
- `upstream` is `pingdotgg/t3code`.
- Arkadia changes live in small conventional commits grouped by concern.
- Upstream syncs are rebased or merged on a dedicated integration branch and validated against the Claude end-to-end checklist before entering the Arkadia branch.
- Generic bug fixes should stay separable from Arkadia presentation changes so they can be compared with or contributed to upstream later.

## Deferred decisions

These choices are intentionally deferred until their dependent phase begins:

- Final application icon and installer assets: after the shell direction is visually approved.
- Codex and local provider visibility: after Claude reaches functional parity.
- T3 remote/mobile/cloud deletion: after the desktop-only dependency audit.
- Migration of existing Arkadia persisted data: after the new project/thread schema is stable.
- Renaming internal `t3code` storage keys and protocol schemes: after compatibility and OAuth paths are mapped.

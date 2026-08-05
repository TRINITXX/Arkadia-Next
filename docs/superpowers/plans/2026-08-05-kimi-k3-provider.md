# Kimi K3 Provider Implementation Plan

> **For Codex:** Execute this plan task by task with strict red-green-refactor cycles. Do not use the exposed API key from the conversation; runtime verification requires a newly rotated key entered by the user.

**Goal:** Add Kimi as a first-class Arkadia provider that runs through the installed Claude Code harness, defaults to K3 1M with max thinking, offers K3 256K plus low/high/max thinking, stores the Kimi API key as a secret, and surfaces Kimi's 5-hour and weekly quota.

**Architecture:** Keep the Claude protocol implementation in `ClaudeAdapter`, but parameterize its provider identity and model/runtime profile. A small Kimi driver supplies Kimi-only models, environment variables, isolated Claude state, and quota lookup. Provider settings reuse the existing per-instance registry and secret-store path so web, desktop, remote, and mobile consumers continue to receive the same canonical provider snapshots and account-rate-limit events. Shared project memory remains injected by `ProviderService` before the selected adapter is called.

**Tech Stack:** TypeScript, Effect, React, Claude Agent SDK, Vite Plus tests.

---

## Task 1: Define the Kimi contract and model policy

**Files:**

- Modify: `packages/contracts/src/settings.ts`
- Modify: `packages/contracts/src/model.ts`
- Test: `packages/contracts/src/settings.test.ts`
- Test: `packages/contracts/src/model.test.ts`

- [ ] Add failing contract tests for decoding Kimi defaults and retaining explicit overrides.
- [ ] Add failing model tests for the Kimi display name and the K3 default selection.
- [ ] Add `KimiSettings` with Claude Code binary/home defaults suitable for an isolated harness.
- [ ] Add Kimi model defaults and labels without changing Claude defaults.
- [ ] Run the focused tests and confirm green.

## Task 2: Extract a configurable Claude-harness profile

**Files:**

- Modify: `apps/server/src/provider/Layers/ClaudeAdapter.ts`
- Test: `apps/server/src/provider/Layers/ClaudeAdapter.test.ts`

- [ ] Add a failing adapter test proving a custom harness identity is used in validation, session state, and emitted runtime events.
- [ ] Add a failing adapter test proving a custom model resolver and per-session environment resolver receive the selected model.
- [ ] Parameterize the adapter's driver kind, model capabilities, API model id, session environment, and model-switch capability while keeping Claude defaults byte-for-byte compatible.
- [ ] Replace adapter-local hard-coded provider references with the bound driver kind.
- [ ] Run the focused adapter tests and confirm green.

## Task 3: Implement Kimi models, environment, and provider snapshot

**Files:**

- Add: `apps/server/src/provider/Layers/KimiProvider.ts`
- Add: `apps/server/src/provider/Layers/KimiProvider.test.ts`
- Add: `apps/server/src/provider/Drivers/KimiHome.ts`
- Add: `apps/server/src/provider/Drivers/KimiHome.test.ts`

- [ ] Add failing tests for exactly two models: `k3[1m]` and `k3`, with K3 1M first/default.
- [ ] Add failing tests for low/high/max thinking with max selected by default.
- [ ] Add failing tests for model-specific context environment: 1,048,576 vs 262,144 tokens.
- [ ] Add failing tests proving the Kimi harness uses an isolated Claude config directory and Kimi endpoint variables without inheriting personal Claude model/auth variables.
- [ ] Implement the minimal Kimi catalog, capabilities, model resolver, and environment builder.
- [ ] Mark model switching as requiring a new thread in the provider presentation/adapter capability.
- [ ] Run the focused tests and confirm green.

## Task 4: Add secure Kimi credential setup

**Files:**

- Modify: `apps/web/src/components/settings/providerDriverMeta.ts`
- Modify: `apps/web/src/components/settings/AddProviderInstanceDialog.tsx`
- Modify: `apps/web/src/components/settings/ProviderInstanceCard.tsx`
- Modify: `apps/web/src/components/settings/ProviderEnvironmentSection.tsx` (if needed to hide the managed variable)
- Test: `apps/web/src/components/settings/AddProviderInstanceDialog.test.ts`
- Test: `apps/web/src/components/settings/ProviderInstanceCard.test.ts`

- [ ] Add failing pure-logic tests for mapping a Kimi API key to a sensitive `ANTHROPIC_API_KEY` environment entry.
- [ ] Add failing tests that a redacted existing secret is preserved unless the user replaces it.
- [ ] Add optional credential metadata to the provider client definition.
- [ ] Render a password field in Kimi setup/settings and keep the managed variable out of generic environment editing.
- [ ] Persist the credential through `ProviderInstanceConfig.environment` with `sensitive: true`, relying on the existing `ServerSecretStore` redaction path.
- [ ] Run the focused web tests and confirm green.

## Task 5: Implement Kimi quota parsing and refresh

**Files:**

- Add: `apps/server/src/provider/Layers/KimiUsage.ts`
- Add: `apps/server/src/provider/Layers/KimiUsage.test.ts`
- Modify: `apps/server/src/provider/Layers/ClaudeAdapter.ts`
- Test: `apps/server/src/provider/Layers/ClaudeAdapter.test.ts`

- [ ] Add failing schema/parser tests using representative weekly and rolling 5-hour Kimi usage payloads.
- [ ] Add a failing test proving a Kimi quota refresh emits canonical `account.rate-limits.updated` data and failure remains non-fatal.
- [ ] Decode the untrusted response with Effect Schema and call `GET https://api.kimi.com/coding/v1/usages` with bearer auth.
- [ ] Map Kimi windows to the existing canonical 5-hour/7-day shape so the current quota meter works unchanged.
- [ ] Refresh quota at session start and after a completed turn with bounded/cached best-effort behavior.
- [ ] Run quota, ingestion, and account-meter tests and confirm green.

## Task 6: Register the first-class Kimi driver

**Files:**

- Add: `apps/server/src/provider/Drivers/KimiDriver.ts`
- Modify: `apps/server/src/provider/builtInDrivers.ts`
- Modify: `apps/web/src/components/settings/providerDriverMeta.ts`
- Test: `apps/server/src/provider/Drivers/KimiDriver.test.ts`
- Test: `apps/server/src/provider/Layers/ProviderInstanceRegistryHydration.test.ts` (or nearest registry test)

- [ ] Add failing tests that `kimi` is registered and materializes only from an explicit provider instance.
- [ ] Add failing tests that Kimi snapshots and adapter events retain the `kimi` driver identity.
- [ ] Build `KimiDriver` from the Claude harness profile, isolated environment, Kimi snapshot, text generation, and quota client.
- [ ] Register Kimi in server and client metadata with a distinct label/icon.
- [ ] Confirm missing Claude Code or missing key surfaces as an unavailable/configuration state without attempting installation.
- [ ] Run focused driver and registry tests and confirm green.

## Task 7: Documentation and verification

**Files:**

- Add: `docs/user/kimi-provider.md`
- Modify: the relevant provider index under `docs/user/` if one exists

- [ ] Document subscription/API-key prerequisites, K3 1M quota cost, model-lock behavior, thinking choices, secret rotation, and Claude Code installation responsibility.
- [ ] Run all touched focused test files together.
- [ ] Run targeted lint for touched packages/files.
- [ ] Run `npx tsc --noEmit` as required by repository instructions.
- [ ] Inspect `git diff --check` and `git status --short`.
- [ ] Report that live authentication/quota verification remains pending until the user enters a newly rotated key; do not launch a browser without permission.

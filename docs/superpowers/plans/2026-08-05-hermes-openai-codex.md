# Hermes OpenAI Codex GPT-5.6 Luna

## Goal

Make Hermes use its existing OpenAI Codex OAuth route for GPT-5.6 Luna by default, keep the route visible in Arkadia's model picker, and preserve the VPS-wide Hermes reasoning effort configured as `max`.

## Scope

- Change the Hermes default model slug to `openai-codex:gpt-5.6-luna`.
- Prefer that model when Hermes ACP discovery reports it, while retaining the current ACP model as a fallback when Codex is unavailable.
- Keep a built-in fallback model list that contains both the OpenAI Codex route and the existing Nous/DeepSeek route.
- Remove only the stale local hidden-model preference for the requested Codex route and add it to Hermes favorites in the active development client settings.
- Do not change Hermes authentication, OpenAI credentials, unrelated provider defaults, background text-generation defaults, or user work-in-progress files.
- Verify that the remote Hermes setting `agent.reasoning_effort` is already `max`; do not rewrite it on every ACP launch.

## TDD tasks

### Task 1: Add failing contract/provider default tests

- Update the contracts test to assert Hermes defaults to `openai-codex:gpt-5.6-luna`.
- Add a Hermes provider discovery test where both the current Nous model and the OpenAI Codex model are present; assert the Codex model is marked default.
- Add a fallback-model test asserting the OpenAI Codex route is preferred and DeepSeek remains available.
- Run the focused tests and observe the expected failures.

### Task 2: Implement Hermes model selection defaults

- Add a shared Hermes OpenAI Codex model constant in the contracts model metadata.
- Update Hermes provider fallback models and ACP discovery default selection to prefer the Codex route.
- Keep arbitrary Hermes model slugs intact so explicit Nous/OpenRouter selections still work.
- Run the focused tests and confirm they pass.

### Task 3: Update the active development client preference

- Remove only `openai-codex:gpt-5.6-luna` from the Hermes `hiddenModels` array in the active development `client-settings.json`.
- Add the exact route to Hermes favorites without changing other preferences.
- Re-read and parse the JSON to verify it remains valid and the route is visible/favorited.

### Task 4: Verify the end-to-end contract

- Re-run the focused provider, ACP-support, and contracts tests.
- Run the relevant package typecheck; if a commit is requested later, run the required `npx tsc --noEmit` before committing.
- Report the live remote `agent.reasoning_effort=max` evidence and the exact route that Hermes ACP accepted through `openai-codex`.

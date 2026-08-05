# Kimi

Kimi runs in T3 Code as its own provider while using Claude Code as the local coding harness. Your normal Claude account, model preferences, hooks, and configuration directory are not reused.

## Requirements

- An active Kimi Coding subscription with API access.
- Claude Code installed on the machine running the T3 server. T3 Code does not install it automatically.
- A Kimi API key. If a key has been pasted into a chat, revoke it and create a new one before setup.

## Add Kimi

1. Open **Settings** and choose **Add provider instance**.
2. Select **Kimi**.
3. Enter a label and your Kimi API key.
4. Keep the default binary path (`claude`) unless Claude Code is installed elsewhere.
5. Add the instance and refresh its status if needed.

The API key is stored as a sensitive provider secret. It is redacted when settings are sent to clients and is only restored on the server for that Kimi instance.

## Models and thinking

Kimi offers two K3 choices:

- **K3 1M** is selected by default and provides a 1,048,576-token context window.
- **K3 256K** provides a 262,144-token context window and uses less subscription quota.

Thinking is always available with **Low**, **High**, and **Max** choices. **Max** is the default. The model is fixed for the lifetime of a conversation; start a new conversation to switch between K3 1M and K3 256K.

## Quota

After a Kimi session starts, T3 Code reads Kimi's official usage endpoint and shows the rolling 5-hour and weekly limits in the existing quota meter. A quota refresh failure does not stop the coding session.

K3 1M currently consumes about twice as much subscription quota as K3 256K. Kimi can change plan limits and accounting rules, so check the Kimi subscription page for the current details.

## Shared project memory

Kimi receives the same shared project memory as other T3 Code providers. Memory is injected by T3 Code before the request reaches the Claude Code harness, so switching providers does not create a separate memory silo.

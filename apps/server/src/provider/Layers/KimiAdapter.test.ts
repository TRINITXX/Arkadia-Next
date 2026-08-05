import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type ProviderSessionStartInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import type { ClaudeAdapterShape } from "../Services/ClaudeAdapter.ts";
import { makeKimiAdapter } from "./KimiAdapter.ts";

it.layer(NodeServices.layer)("makeKimiAdapter", (it) => {
  it.effect("presents Claude Code sessions under the Kimi provider identity", () =>
    Effect.gen(function* () {
      let receivedStart: ProviderSessionStartInput | undefined;
      const threadId = ThreadId.make("thread-kimi-adapter");
      const claudeAdapter = {
        provider: ProviderDriverKind.make("claudeAgent"),
        capabilities: { sessionModelSwitch: "in-session" },
        startSession: (input: ProviderSessionStartInput) => {
          receivedStart = input;
          return Effect.succeed({
            provider: ProviderDriverKind.make("claudeAgent"),
            providerInstanceId: ProviderInstanceId.make("kimi"),
            threadId,
            status: "ready" as const,
            runtimeMode: "full-access" as const,
            createdAt: "2026-08-05T12:00:00.000Z",
            updatedAt: "2026-08-05T12:00:00.000Z",
          });
        },
        streamEvents: Stream.empty,
      } as unknown as ClaudeAdapterShape;

      const adapter = yield* makeKimiAdapter({
        claudeAdapter,
        instanceId: ProviderInstanceId.make("kimi"),
        fetchUsage: () => Effect.succeed({}),
      });
      const session = yield* adapter.startSession({
        threadId,
        provider: ProviderDriverKind.make("kimi"),
        runtimeMode: "full-access",
      });

      expect(receivedStart?.provider).toBe("claudeAgent");
      expect(adapter.provider).toBe("kimi");
      expect(adapter.capabilities.sessionModelSwitch).toBe("unsupported");
      expect(session.provider).toBe("kimi");
    }),
  );
});

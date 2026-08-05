import {
  EventId,
  ProviderDriverKind,
  ThreadId,
  type OrchestrationThreadActivity,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { runtimeEventToActivities } from "./ProviderRuntimeIngestion.ts";

function rateLimitsEvent(rateLimits: unknown, provider = "claude"): ProviderRuntimeEvent {
  return {
    type: "account.rate-limits.updated",
    eventId: EventId.make("evt-rate-limits"),
    provider: ProviderDriverKind.make(provider),
    createdAt: "2026-08-05T10:00:00.000Z",
    threadId: ThreadId.make("thread-1"),
    payload: { rateLimits },
  } satisfies ProviderRuntimeEvent;
}

type Window = { key: string; utilization: number; resetsAt: number | null };

function windowsOf(activity: OrchestrationThreadActivity | undefined): ReadonlyArray<Window> {
  const payload = activity?.payload as { windows?: ReadonlyArray<Window> } | undefined;
  return payload?.windows ?? [];
}

describe("account rate-limit normalization", () => {
  it("scales the Claude streaming event's 0-1 fraction to 0-100", () => {
    // The bug: 0.94 was surfaced verbatim and rendered as "0.9%" instead of 94%.
    const [activity] = runtimeEventToActivities(
      rateLimitsEvent({
        rate_limit_info: {
          status: "allowed",
          rateLimitType: "seven_day",
          utilization: 0.94,
          resetsAt: 1_760_000_000,
        },
      }),
    );

    expect(windowsOf(activity)).toEqual([
      { key: "seven_day", utilization: 94, resetsAt: 1_760_000_000_000 },
    ]);
  });

  it("surfaces both windows from the Claude structured /usage snapshot", () => {
    const [activity] = runtimeEventToActivities(
      rateLimitsEvent({
        five_hour: { utilization: 12, resets_at: "2026-08-05T13:00:00.000Z" },
        seven_day: { utilization: 94, resets_at: "2026-08-08T23:00:00.000Z" },
      }),
    );

    const windows = windowsOf(activity);
    expect(windows).toContainEqual({
      key: "five_hour",
      utilization: 12,
      resetsAt: Date.parse("2026-08-05T13:00:00.000Z"),
    });
    expect(windows).toContainEqual({
      key: "seven_day",
      utilization: 94,
      resetsAt: Date.parse("2026-08-08T23:00:00.000Z"),
    });
  });

  it("picks the binding (highest) weekly window across per-model snapshots", () => {
    const [activity] = runtimeEventToActivities(
      rateLimitsEvent({
        seven_day: { utilization: 30, resets_at: "2026-08-08T23:00:00.000Z" },
        seven_day_opus: { utilization: 94, resets_at: "2026-08-09T01:00:00.000Z" },
        seven_day_sonnet: { utilization: 50, resets_at: "2026-08-08T20:00:00.000Z" },
      }),
    );

    expect(windowsOf(activity)).toEqual([
      { key: "seven_day", utilization: 94, resetsAt: Date.parse("2026-08-09T01:00:00.000Z") },
    ]);
  });

  it("surfaces both Codex windows from primary/secondary (double-wrap fixed)", () => {
    const [activity] = runtimeEventToActivities(
      rateLimitsEvent(
        {
          primary: { usedPercent: 20, windowDurationMins: 300, resetsAt: 1_760_000_000 },
          secondary: { usedPercent: 88, windowDurationMins: 10_080, resetsAt: 1_760_500_000 },
        },
        "codex",
      ),
    );

    const windows = windowsOf(activity);
    expect(windows).toContainEqual({
      key: "five_hour",
      utilization: 20,
      resetsAt: 1_760_000_000_000,
    });
    expect(windows).toContainEqual({
      key: "seven_day",
      utilization: 88,
      resetsAt: 1_760_500_000_000,
    });
  });

  it("emits no activity when the payload carries no usable window", () => {
    expect(runtimeEventToActivities(rateLimitsEvent({}))).toEqual([]);
    expect(runtimeEventToActivities(rateLimitsEvent(null))).toEqual([]);
  });
});

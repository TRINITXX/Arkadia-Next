import type { OrchestrationThreadActivity } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import { deriveAccountRateLimits, formatResetCountdown } from "./accountRateLimits";

function rateLimitActivity(
  createdAt: string,
  windows: ReadonlyArray<{ key: string; utilization: number; resetsAt: number | null }>,
): OrchestrationThreadActivity {
  return {
    id: `evt-${createdAt}`,
    tone: "info",
    kind: "account.rate-limits.updated",
    summary: "Account rate limits updated",
    payload: { windows },
    turnId: null,
    createdAt,
  } as unknown as OrchestrationThreadActivity;
}

describe("deriveAccountRateLimits", () => {
  it("returns null when there are no rate-limit activities", () => {
    expect(deriveAccountRateLimits([])).toBeNull();
  });

  it("merges the two windows Claude reports one at a time", () => {
    const result = deriveAccountRateLimits([
      rateLimitActivity("2026-08-04T10:00:00.000Z", [
        { key: "five_hour", utilization: 42, resetsAt: 1000 },
      ]),
      rateLimitActivity("2026-08-04T10:01:00.000Z", [
        { key: "seven_day", utilization: 18, resetsAt: 2000 },
      ]),
    ]);
    expect(result).toEqual({
      fiveHour: { utilization: 42, resetsAt: 1000 },
      sevenDay: { utilization: 18, resetsAt: 2000 },
    });
  });

  it("keeps the newest value per window regardless of array order", () => {
    const result = deriveAccountRateLimits([
      rateLimitActivity("2026-08-04T10:05:00.000Z", [
        { key: "five_hour", utilization: 60, resetsAt: 5000 },
      ]),
      rateLimitActivity("2026-08-04T10:00:00.000Z", [
        { key: "five_hour", utilization: 40, resetsAt: 4000 },
      ]),
    ]);
    expect(result?.fiveHour).toEqual({ utilization: 60, resetsAt: 5000 });
  });

  it("ignores activities of other kinds", () => {
    const noise = {
      id: "evt-noise",
      tone: "tool",
      kind: "tool.completed",
      summary: "Tool",
      payload: {},
      turnId: null,
      createdAt: "2026-08-04T10:00:00.000Z",
    } as unknown as OrchestrationThreadActivity;
    expect(deriveAccountRateLimits([noise])).toBeNull();
  });
});

describe("formatResetCountdown", () => {
  const now = 1_000_000_000_000;

  it("returns null when the reset time is unknown", () => {
    expect(formatResetCountdown(null, now)).toBeNull();
  });

  it("reports 'maintenant' once the window has reset", () => {
    expect(formatResetCountdown(now - 1000, now)).toBe("maintenant");
  });

  it("formats hours and minutes", () => {
    expect(formatResetCountdown(now + (2 * 60 + 13) * 60_000, now)).toBe("2 h 13 min");
  });

  it("formats days and hours", () => {
    expect(formatResetCountdown(now + (4 * 24 + 3) * 60 * 60_000, now)).toBe("4 j 3 h");
  });

  it("formats minutes only", () => {
    expect(formatResetCountdown(now + 45 * 60_000, now)).toBe("45 min");
  });
});

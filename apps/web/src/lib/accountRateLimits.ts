import type { OrchestrationThreadActivity } from "@t3tools/contracts";

// Claude subscription rate-limit windows surfaced next to the context meter.
// The server (ProviderRuntimeIngestion) normalizes both Claude and Codex
// payloads into `account.rate-limits.updated` activities carrying
// `{ windows: [{ key, utilization, resetsAt }] }`. Claude reports one window
// per event, so we keep the newest value seen for each window.

export interface AccountRateLimitWindow {
  /** Percent of the window consumed, 0–100. */
  readonly utilization: number;
  /** Epoch milliseconds when the window resets, or null if unknown. */
  readonly resetsAt: number | null;
}

export interface AccountRateLimits {
  readonly fiveHour: AccountRateLimitWindow | null;
  readonly sevenDay: AccountRateLimitWindow | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

/**
 * Fold the rate-limit activities into the latest known value for the five-hour
 * and weekly windows. Returns null when no rate-limit data has been seen yet
 * (e.g. before the first turn, or on an API-key session where the SDK reports
 * nothing).
 */
export function deriveAccountRateLimits(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): AccountRateLimits | null {
  let fiveHour: AccountRateLimitWindow | null = null;
  let sevenDay: AccountRateLimitWindow | null = null;
  let fiveHourAt = "";
  let sevenDayAt = "";

  for (const activity of activities) {
    if (activity.kind !== "account.rate-limits.updated") continue;
    const payload = asRecord(activity.payload);
    const windows = payload?.windows;
    if (!Array.isArray(windows)) continue;
    const at = String(activity.createdAt);
    for (const entry of windows) {
      const record = asRecord(entry);
      if (!record || typeof record.utilization !== "number") continue;
      const window: AccountRateLimitWindow = {
        utilization: record.utilization,
        resetsAt: typeof record.resetsAt === "number" ? record.resetsAt : null,
      };
      // ISO timestamps sort lexicographically, so string comparison picks the
      // newest activity regardless of the array's ordering.
      if (record.key === "five_hour" && at >= fiveHourAt) {
        fiveHour = window;
        fiveHourAt = at;
      } else if (record.key === "seven_day" && at >= sevenDayAt) {
        sevenDay = window;
        sevenDayAt = at;
      }
    }
  }

  if (!fiveHour && !sevenDay) return null;
  return { fiveHour, sevenDay };
}

/**
 * Human-readable countdown until a window resets, e.g. "2 h 13 min", "4 j 3 h".
 * Returns null when the reset time is unknown.
 */
export function formatResetCountdown(resetsAtMs: number | null, nowMs: number): string | null {
  if (resetsAtMs === null) return null;
  const diffMs = resetsAtMs - nowMs;
  if (diffMs <= 0) return "maintenant";
  const totalMinutes = Math.floor(diffMs / 60_000);
  const days = Math.floor(totalMinutes / 1_440);
  const hours = Math.floor((totalMinutes % 1_440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days} j ${hours} h`;
  if (hours > 0) return `${hours} h ${minutes} min`;
  return `${minutes} min`;
}

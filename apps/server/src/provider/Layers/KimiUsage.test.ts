import { describe, expect, it } from "vite-plus/test";

import { parseKimiUsagePayload } from "./KimiUsage.ts";

describe("parseKimiUsagePayload", () => {
  it("maps the weekly summary and rolling 5-hour window to canonical usage", () => {
    expect(
      parseKimiUsagePayload({
        usage: {
          name: "Weekly limit",
          used: 400,
          limit: 1000,
          resetAt: "2026-08-10T00:00:00Z",
        },
        limits: [
          {
            detail: {
              name: "5h limit",
              used: "25",
              limit: "100",
              resetAt: "2026-08-05T18:00:00Z",
            },
            window: { duration: 5, timeUnit: "HOUR" },
          },
        ],
      }),
    ).toEqual({
      five_hour: { utilization: 25, resets_at: "2026-08-05T18:00:00Z" },
      seven_day: { utilization: 40, resets_at: "2026-08-10T00:00:00Z" },
    });
  });

  it("ignores malformed or zero-limit rows", () => {
    expect(parseKimiUsagePayload({ usage: { used: 10, limit: 0 }, limits: [{}] })).toEqual({});
  });
});

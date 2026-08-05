import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Duration from "effect/Duration";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";

const NumericValue = Schema.Union([Schema.Number, Schema.String]);
const UsageRow = Schema.Struct({
  name: Schema.optional(Schema.String),
  used: Schema.optional(NumericValue),
  remaining: Schema.optional(NumericValue),
  limit: Schema.optional(NumericValue),
  resetAt: Schema.optional(Schema.String),
  reset_at: Schema.optional(Schema.String),
});
const UsageLimit = Schema.Struct({
  detail: Schema.optional(UsageRow),
  window: Schema.optional(
    Schema.Struct({
      duration: Schema.optional(NumericValue),
      timeUnit: Schema.optional(Schema.String),
    }),
  ),
});
const KimiUsagePayload = Schema.Struct({
  usage: Schema.optional(UsageRow),
  limits: Schema.optional(Schema.Array(UsageLimit)),
});

const decodeKimiUsagePayload = Schema.decodeUnknownOption(KimiUsagePayload);

export class KimiUsageError extends Schema.TaggedErrorClass<KimiUsageError>()("KimiUsageError", {
  cause: Schema.Defect(),
}) {}

interface CanonicalUsageWindow {
  readonly utilization: number;
  readonly resets_at?: string;
}

export interface KimiCanonicalUsage {
  readonly five_hour?: CanonicalUsageWindow;
  readonly seven_day?: CanonicalUsageWindow;
}

function toNumber(value: number | string | undefined): number | undefined {
  const parsed = typeof value === "number" ? value : value === undefined ? NaN : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toCanonicalWindow(row: typeof UsageRow.Type): CanonicalUsageWindow | undefined {
  const limit = toNumber(row.limit);
  if (limit === undefined || limit <= 0) return undefined;
  const explicitUsed = toNumber(row.used);
  const remaining = toNumber(row.remaining);
  const used = explicitUsed ?? (remaining === undefined ? undefined : limit - remaining);
  if (used === undefined) return undefined;
  const resetsAt = row.resetAt ?? row.reset_at;
  return {
    utilization: Math.max(0, Math.min(100, (used / limit) * 100)),
    ...(resetsAt ? { resets_at: resetsAt } : {}),
  };
}

export function parseKimiUsagePayload(payload: unknown): KimiCanonicalUsage {
  const decoded = decodeKimiUsagePayload(payload);
  if (Option.isNone(decoded)) return {};

  const weekly = decoded.value.usage ? toCanonicalWindow(decoded.value.usage) : undefined;
  const fiveHourEntry = decoded.value.limits?.find((entry) => {
    const name = entry.detail?.name?.toLowerCase() ?? "";
    const duration = toNumber(entry.window?.duration);
    const unit = entry.window?.timeUnit?.toUpperCase() ?? "";
    return name.includes("5h") || (duration === 5 && unit.includes("HOUR"));
  });
  const fiveHour = fiveHourEntry?.detail ? toCanonicalWindow(fiveHourEntry.detail) : undefined;

  return {
    ...(fiveHour ? { five_hour: fiveHour } : {}),
    ...(weekly ? { seven_day: weekly } : {}),
  };
}

export const fetchKimiUsage = Effect.fn("fetchKimiUsage")(function* (apiKey: string) {
  const client = yield* HttpClient.HttpClient;
  const payload = yield* HttpClientRequest.get("https://api.kimi.com/coding/v1/usages").pipe(
    HttpClientRequest.acceptJson,
    HttpClientRequest.bearerToken(apiKey),
    client.execute,
    Effect.flatMap(HttpClientResponse.filterStatusOk),
    Effect.flatMap(HttpClientResponse.schemaBodyJson(KimiUsagePayload)),
    Effect.timeout(Duration.seconds(8)),
    Effect.mapError((cause) => new KimiUsageError({ cause })),
  );
  return parseKimiUsagePayload(payload);
});

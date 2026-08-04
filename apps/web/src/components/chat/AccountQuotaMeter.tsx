import { ClockIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "~/lib/utils";
import {
  formatResetCountdown,
  type AccountRateLimits,
  type AccountRateLimitWindow,
} from "~/lib/accountRateLimits";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";

function formatPercentage(value: number): string {
  if (!Number.isFinite(value)) return "0%";
  if (value < 10) return `${value.toFixed(1).replace(/\.0$/, "")}%`;
  return `${Math.round(value)}%`;
}

function usageColorFor(percentage: number): string {
  if (percentage > 90) return "var(--color-red-500)";
  if (percentage > 75) return "var(--color-amber-500)";
  // Distinct from the grey context-window ring so the two never read as one.
  return "color-mix(in oklab, var(--color-blue-500) 70%, transparent)";
}

function QuotaRow(props: { label: string; window: AccountRateLimitWindow; nowMs: number }) {
  const percentage = Math.max(0, Math.min(100, props.window.utilization));
  const countdown = formatResetCountdown(props.window.resetsAt, props.nowMs);
  const color = usageColorFor(percentage);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium text-muted-foreground text-xs">{props.label}</span>
        <span className="text-[11px] tabular-nums text-muted-foreground/70">
          {formatPercentage(percentage)}
          {countdown ? (
            <>
              <span className="mx-1">·</span>
              <span>reset {countdown}</span>
            </>
          ) : null}
        </span>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted/60"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percentage)}
        aria-label={`${props.label} usage`}
      >
        <div
          className="h-full rounded-full transition-[width,background-color] duration-500 ease-out motion-reduce:transition-none"
          style={{ width: `${percentage}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

/**
 * Claude subscription quota (5-hour + weekly windows) shown next to the context
 * meter. The ring reflects the binding (higher) window; the popover breaks out
 * each window with its own bar and a live countdown to reset. Distinct from the
 * context ring by colour and a centred clock glyph. Renders nothing when no
 * quota data is available (API-key sessions, or before the first turn).
 */
export function AccountQuotaMeter(props: { quota: AccountRateLimits }) {
  const { fiveHour, sevenDay } = props.quota;
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, []);

  if (!fiveHour && !sevenDay) return null;

  // The ring shows whichever window is closest to its limit.
  const bindingPercentage = Math.max(
    0,
    Math.min(100, Math.max(fiveHour?.utilization ?? 0, sevenDay?.utilization ?? 0)),
  );
  const radius = 9.75;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - bindingPercentage / 100);
  const color = usageColorFor(bindingPercentage);

  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={150}
        closeDelay={0}
        render={
          <button
            type="button"
            className={cn(
              "inline-flex size-7 cursor-pointer items-center justify-center rounded-full border border-transparent text-muted-foreground outline-none transition-colors",
              "hover:bg-accent data-[pressed]:bg-accent",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
            )}
            aria-label={`Quota Claude ${formatPercentage(bindingPercentage)} utilisé`}
          >
            <span className="relative flex size-5 items-center justify-center">
              <svg
                viewBox="0 0 24 24"
                className="-rotate-90 absolute inset-0 size-full transform-gpu"
                aria-hidden="true"
              >
                <circle
                  cx="12"
                  cy="12"
                  r={radius}
                  fill="none"
                  stroke="color-mix(in oklab, var(--color-muted-foreground) 24%, transparent)"
                  strokeWidth="3"
                />
                <circle
                  cx="12"
                  cy="12"
                  r={radius}
                  fill="none"
                  stroke={color}
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={dashOffset}
                  className="transition-[stroke-dashoffset,stroke] duration-500 ease-out motion-reduce:transition-none"
                />
              </svg>
              <ClockIcon
                className="relative size-2.5 text-muted-foreground/70"
                aria-hidden="true"
              />
            </span>
          </button>
        }
      />
      <PopoverPopup
        tooltipStyle
        side="top"
        align="end"
        viewportClassName="p-0"
        className="w-64 max-w-none text-left whitespace-normal"
      >
        <div className="flex flex-col gap-2.5 p-[var(--floating-content-inset)]">
          <div className="font-medium text-muted-foreground text-xs">Quota Claude</div>
          {fiveHour ? <QuotaRow label="5 heures" window={fiveHour} nowMs={nowMs} /> : null}
          {sevenDay ? <QuotaRow label="Semaine" window={sevenDay} nowMs={nowMs} /> : null}
        </div>
      </PopoverPopup>
    </Popover>
  );
}

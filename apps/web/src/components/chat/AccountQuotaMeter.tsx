import { CalendarDaysIcon, ClockIcon } from "lucide-react";
import type { ReactNode } from "react";
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
 * A single Claude quota window rendered as its own ring, with a centred glyph
 * that tells the two windows apart at a glance (clock = 5-hour, calendar =
 * weekly) and a popover breaking out the percentage plus a live reset
 * countdown. Ring colour reflects that window's own utilization.
 */
function QuotaRing(props: {
  label: string;
  window: AccountRateLimitWindow;
  nowMs: number;
  icon: ReactNode;
}) {
  const percentage = Math.max(0, Math.min(100, props.window.utilization));
  const radius = 9.75;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - percentage / 100);
  const color = usageColorFor(percentage);

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
            aria-label={`Quota Claude ${props.label} ${formatPercentage(percentage)} utilisé`}
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
              {props.icon}
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
          <QuotaRow label={props.label} window={props.window} nowMs={props.nowMs} />
        </div>
      </PopoverPopup>
    </Popover>
  );
}

/**
 * Claude subscription quota shown next to the context meter as two separate
 * rings — the 5-hour window on the left, the weekly window on its right — each
 * reflecting its own utilization with a live reset countdown in its popover.
 * Distinct from the context ring by colour and a centred glyph. Renders nothing
 * when no quota data is available (API-key sessions, or before the first turn).
 */
export function AccountQuotaMeter(props: { quota: AccountRateLimits }) {
  const { fiveHour, sevenDay } = props.quota;
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, []);

  if (!fiveHour && !sevenDay) return null;

  return (
    <>
      {fiveHour ? (
        <QuotaRing
          label="5 heures"
          window={fiveHour}
          nowMs={nowMs}
          icon={
            <ClockIcon className="relative size-2.5 text-muted-foreground/70" aria-hidden="true" />
          }
        />
      ) : null}
      {sevenDay ? (
        <QuotaRing
          label="Semaine"
          window={sevenDay}
          nowMs={nowMs}
          icon={
            <CalendarDaysIcon
              className="relative size-2.5 text-muted-foreground/70"
              aria-hidden="true"
            />
          }
        />
      ) : null}
    </>
  );
}

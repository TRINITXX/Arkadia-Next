import { useEffect, useId, useRef, useState } from "react";
import { CheckIcon, ClipboardList, ChevronDownIcon } from "lucide-react";

import type { ActivePlanState } from "../session-logic";
import { cn } from "~/lib/utils";

interface AgentTasksBarProps {
  readonly plan: ActivePlanState | null;
}

export function hasActiveAgentTasks(plan: ActivePlanState | null): boolean {
  return Boolean(
    plan && plan.steps.length > 0 && plan.steps.some((step) => step.status !== "completed"),
  );
}

function currentTask(plan: ActivePlanState): ActivePlanState["steps"][number] {
  const task =
    plan.steps.find((step) => step.status === "inProgress") ??
    plan.steps.find((step) => step.status === "pending") ??
    plan.steps.at(-1);
  if (!task) throw new Error("Active Tasks must contain at least one step");
  return task;
}

function stepStatusIcon(status: ActivePlanState["steps"][number]["status"]) {
  if (status === "completed") {
    return (
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/12 text-emerald-400">
        <CheckIcon aria-hidden="true" className="size-3" />
      </span>
    );
  }

  if (status === "inProgress") {
    return (
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-blue-500/12">
        <span className="size-1.5 rounded-full bg-blue-400" />
      </span>
    );
  }

  return (
    <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-border/70 bg-muted/20">
      <span className="size-1.5 rounded-full bg-muted-foreground/35" />
    </span>
  );
}

const AgentTasksBar = function AgentTasksBar({ plan }: AgentTasksBarProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [isClickExpanded, setIsClickExpanded] = useState(false);
  const tasksListId = useId();
  const planIdentity = plan ? String(plan.turnId ?? plan.createdAt) : null;
  const previousPlanIdentity = useRef(planIdentity);
  const expanded = isHovered || isFocused || isClickExpanded;

  useEffect(() => {
    if (planIdentity !== previousPlanIdentity.current) {
      setIsHovered(false);
      setIsFocused(false);
      setIsClickExpanded(false);
      previousPlanIdentity.current = planIdentity;
    }
  }, [planIdentity]);

  if (!plan || !hasActiveAgentTasks(plan)) return null;

  const completedCount = plan.steps.filter((step) => step.status === "completed").length;
  const activeStep = currentTask(plan);

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div
        data-agent-tasks="true"
        data-agent-tasks-trigger="hover"
        data-agent-tasks-expanded={expanded ? "true" : "false"}
        className="relative w-fit max-w-full rounded-xl border border-border/60 bg-background/95 text-foreground shadow-lg shadow-black/10 backdrop-blur-md"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => {
          setIsHovered(false);
          setIsFocused(false);
          setIsClickExpanded(false);
        }}
        onFocusCapture={() => setIsFocused(true)}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setIsFocused(false);
            setIsClickExpanded(false);
          }
        }}
      >
        <div data-agent-tasks-toggle="true" className="relative z-10 overflow-hidden rounded-xl">
          <button
            type="button"
            className="flex min-h-8 max-w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-inset"
            aria-expanded={expanded}
            aria-controls={tasksListId}
            aria-label={expanded ? "Collapse Tasks" : "Expand Tasks"}
            onClick={() => setIsClickExpanded((current) => !current)}
          >
            <ClipboardList aria-hidden="true" className="size-3.5 shrink-0 text-blue-400" />
            <span className="shrink-0 font-medium">Tasks</span>
            <span className="shrink-0 tabular-nums text-muted-foreground/70">
              {completedCount}/{plan.steps.length}
            </span>
            <span className="min-w-0 break-words text-muted-foreground">{activeStep.step}</span>
            <ChevronDownIcon
              aria-hidden="true"
              className={cn(
                "size-3.5 shrink-0 text-muted-foreground/60 transition-transform duration-150 motion-reduce:transition-none",
                expanded && "rotate-180",
              )}
            />
          </button>
        </div>

        {expanded ? (
          <div
            id={tasksListId}
            data-agent-tasks-list="true"
            className="absolute bottom-full left-0 z-20 max-h-60 w-full overflow-y-auto overscroll-contain rounded-xl border border-border/60 bg-background px-2 pb-2 pt-1 shadow-lg shadow-black/10"
          >
            <div className="grid gap-0.5">
              {plan.steps.map((step) => (
                <div
                  key={`${step.status}:${step.step}`}
                  data-agent-tasks-step-status={step.status}
                  className={cn(
                    "flex items-start gap-2 rounded-lg px-1.5 py-1.5 text-xs leading-snug",
                    step.status === "inProgress" && "bg-blue-500/8 text-foreground/90",
                    step.status === "completed" && "text-muted-foreground/55",
                    step.status === "pending" && "text-muted-foreground/75",
                  )}
                >
                  {stepStatusIcon(step.status)}
                  <span
                    className={cn(
                      "min-w-0 break-words pt-0.5",
                      step.status === "completed" && "line-through decoration-muted-foreground/25",
                    )}
                  >
                    {step.step}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default AgentTasksBar;

export type { AgentTasksBarProps };

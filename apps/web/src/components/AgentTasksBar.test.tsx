import { renderToStaticMarkup } from "react-dom/server";
import { TurnId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { ActivePlanState } from "../session-logic";
import AgentTasksBar from "./AgentTasksBar";

function plan(steps: ActivePlanState["steps"]): ActivePlanState {
  return {
    createdAt: "2026-08-05T10:00:00.000Z",
    turnId: TurnId.make("turn-1"),
    steps,
  };
}

describe("AgentTasksBar", () => {
  it("renders a compact collapsed summary with progress and the current task", () => {
    const markup = renderToStaticMarkup(
      <AgentTasksBar
        plan={plan([
          { step: "Inspect the current layout", status: "completed" },
          { step: "Integrate the Tasks bar", status: "inProgress" },
          { step: "Run the focused tests", status: "pending" },
        ])}
      />,
    );

    expect(markup).toContain('data-agent-tasks="true"');
    expect(markup).toContain('data-agent-tasks-trigger="hover"');
    expect(markup).toContain('data-agent-tasks-expanded="false"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain("Tasks");
    expect(markup).toContain("1/3");
    expect(markup).toContain("Integrate the Tasks bar");
    expect(markup).toContain("mx-auto w-full max-w-3xl");
    expect(markup).toContain('class="relative w-fit max-w-full');
    expect(markup).toContain('data-agent-tasks-toggle="true"');
    expect(markup).toContain('class="relative z-10 overflow-hidden rounded-xl"');
    expect(markup).toContain("max-w-full");
    expect(markup).not.toContain("Inspect the current layout");
  });

  it("does not render after every task is completed", () => {
    const markup = renderToStaticMarkup(
      <AgentTasksBar
        plan={plan([
          { step: "Write the component", status: "completed" },
          { step: "Verify the component", status: "completed" },
        ])}
      />,
    );

    expect(markup).toBe("");
  });
});

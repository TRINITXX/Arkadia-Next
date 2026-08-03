import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import type { ToolbarActionButton as ToolbarActionButtonModel } from "@t3tools/contracts";

import { ToolbarActionButton } from "./ToolbarActionButton";

function actionButton(overrides: Partial<ToolbarActionButtonModel> = {}): ToolbarActionButtonModel {
  return {
    id: "btn-1",
    kind: "action",
    label: "",
    icon: "play",
    command: "",
    order: 0,
    ...overrides,
  };
}

describe("ToolbarActionButton", () => {
  it("renders only the icon for an unknown icon slug with a label (falls back silently, never crashes)", () => {
    const markup = renderToStaticMarkup(
      <ToolbarActionButton
        button={actionButton({
          icon: "not-a-real-icon-slug",
          label: "Build",
          command: "npm run build",
        })}
        onRun={() => {}}
      />,
    );

    // `getToolbarIcon` returns null for an unknown slug, so no <svg> renders,
    // but the label still does — an unrecognised slug must never crash.
    expect(markup).not.toContain("<svg");
    expect(markup).toContain("Build");
  });

  it("falls back to the command when the label is empty", () => {
    const markup = renderToStaticMarkup(
      <ToolbarActionButton
        button={actionButton({ icon: "not-a-real-icon-slug", label: "", command: "npm run build" })}
        onRun={() => {}}
      />,
    );

    expect(markup).not.toContain("<svg");
    expect(markup).toContain("npm run build");
  });

  it("renders both icon and label when both are set", () => {
    const markup = renderToStaticMarkup(
      <ToolbarActionButton
        button={actionButton({ icon: "play", label: "Run", command: "npm start" })}
        onRun={() => {}}
      />,
    );

    expect(markup).toContain("<svg");
    expect(markup).toContain("Run");
    // The fallback text (raw command) only shows when there is neither an
    // icon nor a label — it must not leak in alongside a real label.
    expect(markup).not.toContain("npm start<");
  });

  it("falls back to a placeholder when there is neither icon nor label", () => {
    const markup = renderToStaticMarkup(
      <ToolbarActionButton
        button={actionButton({ icon: "not-a-real-icon-slug", label: "", command: "" })}
        onRun={() => {}}
      />,
    );

    expect(markup).not.toContain("<svg");
    expect(markup).toContain("sans nom");
  });
});

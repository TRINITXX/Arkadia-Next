import { describe, expect, it } from "vite-plus/test";

import {
  resolveComposerPromptSuggestion,
  shouldAcceptPromptSuggestionOnTab,
  type ComposerPromptSuggestionInput,
} from "./composerPromptSuggestion";

const RESTING: ComposerPromptSuggestionInput = {
  suggestion: "run the tests",
  isApprovalState: false,
  hasPendingProgress: false,
  pendingUserInputCount: 0,
  awaitingPlanFollowUp: false,
  projectSelectionRequired: false,
  noProviderAvailable: false,
};

describe("resolveComposerPromptSuggestion", () => {
  it("offers the suggestion in the resting composer", () => {
    expect(resolveComposerPromptSuggestion(RESTING)).toBe("run the tests");
  });

  it("offers nothing when there is no suggestion", () => {
    expect(resolveComposerPromptSuggestion({ ...RESTING, suggestion: null })).toBeNull();
  });

  it("treats a blank suggestion as no suggestion", () => {
    expect(resolveComposerPromptSuggestion({ ...RESTING, suggestion: "   " })).toBeNull();
  });

  const BUSY_STATES: ReadonlyArray<readonly [string, Partial<ComposerPromptSuggestionInput>]> = [
    ["an approval is waiting", { isApprovalState: true }],
    ["a question is in progress", { hasPendingProgress: true }],
    ["the agent asked for input", { pendingUserInputCount: 1 }],
    ["a plan awaits follow-up", { awaitingPlanFollowUp: true }],
    ["no project is selected", { projectSelectionRequired: true }],
    ["no provider is available", { noProviderAvailable: true }],
  ];

  for (const [label, overrides] of BUSY_STATES) {
    it(`stays quiet while ${label}`, () => {
      expect(resolveComposerPromptSuggestion({ ...RESTING, ...overrides })).toBeNull();
    });
  }
});

describe("shouldAcceptPromptSuggestionOnTab", () => {
  it("accepts on an empty composer", () => {
    expect(
      shouldAcceptPromptSuggestionOnTab({ suggestion: "run the tests", promptLength: 0 }),
    ).toBe(true);
  });

  it("declines once the user has typed", () => {
    expect(
      shouldAcceptPromptSuggestionOnTab({ suggestion: "run the tests", promptLength: 3 }),
    ).toBe(false);
  });

  it("declines when nothing is offered", () => {
    expect(shouldAcceptPromptSuggestionOnTab({ suggestion: null, promptLength: 0 })).toBe(false);
  });
});

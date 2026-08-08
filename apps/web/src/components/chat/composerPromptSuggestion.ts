/**
 * When the composer may offer the provider's predicted next prompt.
 *
 * Every other composer placeholder states something the user has to deal with
 * first — an approval, a pending question, a plan to confirm, a missing
 * project or provider. Offering a suggestion in those states would talk over a
 * message that matters more, so the suggestion is confined to the resting
 * state where the placeholder is only an invitation to type.
 */
export interface ComposerPromptSuggestionInput {
  readonly suggestion: string | null;
  readonly isApprovalState: boolean;
  readonly hasPendingProgress: boolean;
  readonly pendingUserInputCount: number;
  readonly awaitingPlanFollowUp: boolean;
  readonly projectSelectionRequired: boolean;
  readonly noProviderAvailable: boolean;
}

export function resolveComposerPromptSuggestion(
  input: ComposerPromptSuggestionInput,
): string | null {
  if (input.suggestion === null || input.suggestion.trim().length === 0) {
    return null;
  }
  if (
    input.isApprovalState ||
    input.hasPendingProgress ||
    input.pendingUserInputCount > 0 ||
    input.awaitingPlanFollowUp ||
    input.projectSelectionRequired ||
    input.noProviderAvailable
  ) {
    return null;
  }
  return input.suggestion;
}

/**
 * Tab takes the suggestion only on an untouched composer. Once there is text,
 * the suggestion is no longer on screen — appending it to what the user is
 * writing would come out of nowhere — and Tab goes back to its other duties.
 */
export function shouldAcceptPromptSuggestionOnTab(input: {
  readonly suggestion: string | null;
  readonly promptLength: number;
}): boolean {
  return input.suggestion !== null && input.promptLength === 0;
}

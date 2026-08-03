/**
 * How many toolbar chips fit on one row, and therefore how many spill into the
 * overflow menu. Kept pure and separate from the DOM measuring so the fitting
 * rule — the part that is easy to get subtly wrong — is testable without a
 * layout engine.
 */
export interface ToolbarOverflowLayoutInput {
  /** Natural width of every chip, in row order, measured off-screen. */
  readonly itemWidths: ReadonlyArray<number>;
  /** Inner width of the strip the chips have to fit into. */
  readonly availableWidth: number;
  /** Horizontal gap the flex row puts between two adjacent chips. */
  readonly gap: number;
  /** Width of the "…" trigger, which only exists when something overflows. */
  readonly overflowTriggerWidth: number;
}

/**
 * Returns the number of leading chips to render inline; the rest belong in the
 * overflow menu. When everything fits there is no trigger at all, so the full
 * width is available — which is why the no-overflow case is decided first
 * rather than always reserving room for a trigger that may not be needed.
 */
export function resolveVisibleToolbarItemCount(input: ToolbarOverflowLayoutInput): number {
  const { itemWidths, availableWidth, gap, overflowTriggerWidth } = input;
  if (itemWidths.length === 0) return 0;

  const totalWidth = itemWidths.reduce(
    (sum, width, index) => sum + width + (index > 0 ? gap : 0),
    0,
  );
  if (totalWidth <= availableWidth) return itemWidths.length;

  // Something overflows, so the trigger is on screen and takes its own slot at
  // the end of the row, gap included.
  const budget = availableWidth - overflowTriggerWidth - gap;
  let used = 0;
  let count = 0;
  for (const width of itemWidths) {
    const next = used + (count > 0 ? gap : 0) + width;
    if (next > budget) break;
    used = next;
    count += 1;
  }
  return count;
}

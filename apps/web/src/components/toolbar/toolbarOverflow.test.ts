import { describe, expect, it } from "vite-plus/test";

import { resolveVisibleToolbarItemCount } from "./toolbarOverflow";

const GAP = 4;
const TRIGGER = 24;

describe("resolveVisibleToolbarItemCount", () => {
  it("keeps every chip inline when the row fits exactly, with no room reserved for a trigger", () => {
    // 3 chips of 50 + 2 gaps of 4 = 158, and the strip is exactly 158 wide.
    // Reserving trigger space here would wrongly push the last chip out.
    expect(
      resolveVisibleToolbarItemCount({
        itemWidths: [50, 50, 50],
        availableWidth: 158,
        gap: GAP,
        overflowTriggerWidth: TRIGGER,
      }),
    ).toBe(3);
  });

  it("reserves room for the overflow trigger as soon as one chip spills", () => {
    // Full row needs 158; only 157 available. Budget becomes 157 - 24 - 4 =
    // 129, which fits two chips (50 + 4 + 50 = 104) but not three.
    expect(
      resolveVisibleToolbarItemCount({
        itemWidths: [50, 50, 50],
        availableWidth: 157,
        gap: GAP,
        overflowTriggerWidth: TRIGGER,
      }),
    ).toBe(2);
  });

  it("shows the trigger alone when not even the first chip fits beside it", () => {
    expect(
      resolveVisibleToolbarItemCount({
        itemWidths: [120, 120],
        availableWidth: 100,
        gap: GAP,
        overflowTriggerWidth: TRIGGER,
      }),
    ).toBe(0);
  });

  it("never returns a negative count when the strip has no width yet", () => {
    expect(
      resolveVisibleToolbarItemCount({
        itemWidths: [40],
        availableWidth: 0,
        gap: GAP,
        overflowTriggerWidth: TRIGGER,
      }),
    ).toBe(0);
  });

  it("returns zero for an empty toolbar", () => {
    expect(
      resolveVisibleToolbarItemCount({
        itemWidths: [],
        availableWidth: 400,
        gap: GAP,
        overflowTriggerWidth: TRIGGER,
      }),
    ).toBe(0);
  });

  it("counts gaps between chips only, never before the first one", () => {
    // One chip of 400 in a 400-wide strip fits: a leading gap would break it.
    expect(
      resolveVisibleToolbarItemCount({
        itemWidths: [400],
        availableWidth: 400,
        gap: GAP,
        overflowTriggerWidth: TRIGGER,
      }),
    ).toBe(1);
  });
});

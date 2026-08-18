import { describe, expect, it } from "vitest";

import { RAIL_HEIGHT, computeWindow } from "@/components/MessageNavigator";

const PITCH = 24;

describe("computeWindow", () => {
  it("returns empty for count 0", () => {
    expect(computeWindow(0, 0)).toEqual({ startIdx: 0, endIdx: 0, paddingTop: 0, paddingBottom: 0 });
  });

  it("renders everything when count fits the rail", () => {
    const small = Math.floor(RAIL_HEIGHT / PITCH);
    const w = computeWindow(0, small);
    expect(w.startIdx).toBe(0);
    expect(w.endIdx).toBe(small);
    expect(w.paddingTop).toBe(0);
    expect(w.paddingBottom).toBe(0);
  });

  it("renders full list for a single message", () => {
    expect(computeWindow(0, 1)).toEqual({ startIdx: 0, endIdx: 1, paddingTop: 0, paddingBottom: 0 });
  });

  it("windows at the top of a long list", () => {
    const w = computeWindow(0, 300);
    expect(w.startIdx).toBe(0);
    expect(w.endIdx).toBeLessThan(300);
    expect(w.paddingTop).toBe(0);
  });

  it("conserves total scroll height (start + rendered + end = count)", () => {
    const count = 300;
    const w = computeWindow(0, count);
    const rendered = w.endIdx - w.startIdx;
    expect(w.paddingTop / PITCH + rendered + w.paddingBottom / PITCH).toBe(count);
  });

  it("windows in the middle with balanced padding", () => {
    const mid = 300 * PITCH / 2; // scroll to the middle of a 300-dot list
    const w = computeWindow(mid, 300);
    expect(w.startIdx).toBeGreaterThan(0);
    expect(w.endIdx).toBeLessThan(300);
    // Rendered window is bounded by the viewport + overscan
    expect(w.endIdx - w.startIdx).toBeLessThanOrEqual(Math.ceil(RAIL_HEIGHT / PITCH) + 2 * 4);
  });

  it("clamps at the bottom of the list", () => {
    const count = 300;
    const w = computeWindow(count * PITCH, count); // scrolled far past the end
    expect(w.endIdx).toBe(count);
    expect(w.paddingBottom).toBe(0);
  });

  it("clamps start and keeps ranges valid when scrolled far past the list", () => {
    // A 5-dot list is ~120px tall; scrolling to 10000 is impossible in the
    // browser (scrollTop is clamped) but computeWindow must stay consistent.
    const w = computeWindow(10000, 5);
    expect(w.startIdx).toBeLessThanOrEqual(5);
    expect(w.endIdx - w.startIdx).toBeGreaterThanOrEqual(0);
    expect(w.paddingBottom).toBeGreaterThanOrEqual(0);
  });
});

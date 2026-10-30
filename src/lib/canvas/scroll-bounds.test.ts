import { describe, expect, test } from "bun:test";
import { gridScrollBounds, SCROLLBAR_SIZE, scrollThumbLength } from "./scroll-bounds";

describe("gridScrollBounds", () => {
  test("the last row is no longer hidden under the horizontal bar", () => {
    // 1000 px of content for 600 px visible, in width and height
    const b = gridScrollBounds(1000, 1000, 600, 600, true);
    expect(b.showH && b.showV).toBe(true);
    expect(b.maxY).toBeGreaterThanOrEqual(400 + SCROLLBAR_SIZE);
    expect(b.maxX).toBeGreaterThanOrEqual(400 + SCROLLBAR_SIZE);
  });

  test("touch: no bar drawn, nothing reserved", () => {
    expect(gridScrollBounds(1000, 1000, 600, 600, false)).toEqual({ maxX: 400, maxY: 400, showH: true, showV: true });
  });

  test("everything fits on screen: no scrolling", () => {
    expect(gridScrollBounds(500, 500, 600, 600, true)).toEqual({ maxX: 0, maxY: 0, showH: false, showV: false });
  });

  test("the horizontal bar alone reserves its space under the last row", () => {
    // The content fits in height, but the horizontal bar would cover it
    const b = gridScrollBounds(1000, 590, 600, 600, true);
    expect(b.showH).toBe(true);
    expect(b.maxY).toBeGreaterThanOrEqual(590 + SCROLLBAR_SIZE - 600);
  });
});

describe("first render and thumbs", () => {
  test("grid not measured yet or empty: no bar", () => {
    expect(gridScrollBounds(1000, 0, 0, 0, true)).toEqual({ maxX: 0, maxY: 0, showH: false, showV: false });
    expect(gridScrollBounds(1000, 0, 600, 600, true)).toEqual({ maxX: 0, maxY: 0, showH: false, showV: false });
  });

  test("thumb length: never NaN, bounded by the track", () => {
    expect(scrollThumbLength(0, 24, 500, 36)).toBe(0);
    expect(scrollThumbLength(600, 0, 500, 36)).toBe(0);
    expect(scrollThumbLength(600, 600, 500, 36)).toBe(250);
    expect(scrollThumbLength(600, 100000, 500, 36)).toBe(36);
    expect(scrollThumbLength(600, 100000, 20, 36)).toBe(20);
  });
});

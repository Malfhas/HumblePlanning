import { describe, expect, test } from "bun:test";
import { endIconsOf, layoutEndIcons } from "./icons";

describe("endIconsOf", () => {
  test("attachment, note, milestone, in this order from the label", () => {
    expect(endIconsOf({ notes: "Accès par le portail B", isMilestone: true }, true)).toEqual(["file", "note", "milestone"]);
    expect(endIconsOf({ notes: "  ", isMilestone: false }, false)).toEqual([]);
    expect(endIconsOf({ notes: null, isMilestone: true }, false)).toEqual(["milestone"]);
  });
});

describe("layoutEndIcons (icons at the end of a bar)", () => {
  test("one icon with room for text: at the end, the label stops before it", () => {
    expect(layoutEndIcons(["milestone"], 10, 110, 12, 4)).toEqual({ icons: [{ key: "milestone", x: 98 }], labelEnd: 94 });
  });

  test("three icons with room for text: side by side, the milestone outermost", () => {
    expect(layoutEndIcons(["file", "note", "milestone"], 10, 110, 12, 4)).toEqual({
      icons: [{ key: "file", x: 66 }, { key: "note", x: 82 }, { key: "milestone", x: 98 }],
      labelEnd: 62,
    });
  });

  test("too narrow for the icons and some text: the icons alone", () => {
    // 30 px: 12 (icon) + 4 (gap) + 20 (text) would be needed
    expect(layoutEndIcons(["milestone"], 10, 40, 12, 4)).toEqual({ icons: [{ key: "milestone", x: 28 }], labelEnd: 10 });
  });

  test("too narrow for every icon: the attachment goes first, then the note, the milestone stays", () => {
    // 30 px holds two icons (12 + 4 + 12 = 28), not three
    expect(layoutEndIcons(["file", "note", "milestone"], 10, 40, 12, 4).icons.map((i) => i.key)).toEqual(["note", "milestone"]);
    // 20 px holds one
    expect(layoutEndIcons(["file", "note", "milestone"], 10, 30, 12, 4).icons.map((i) => i.key)).toEqual(["milestone"]);
  });

  test("too narrow even for one icon: the label keeps the room", () => {
    expect(layoutEndIcons(["milestone"], 10, 18, 12, 4)).toEqual({ icons: [], labelEnd: 18 });
  });
});

import { describe, it, expect } from "vitest";
import { moveIndex } from "./gridNav";

describe("moveIndex", () => {
  it("moves by delta within bounds", () => {
    expect(moveIndex(2, 10, 3)).toBe(5);
    expect(moveIndex(5, 10, -2)).toBe(3);
  });

  it("clamps to [0, len-1]", () => {
    expect(moveIndex(8, 10, 5)).toBe(9);
    expect(moveIndex(1, 10, -5)).toBe(0);
  });

  it("returns 0 for empty list", () => {
    expect(moveIndex(0, 0, 1)).toBe(0);
  });
});

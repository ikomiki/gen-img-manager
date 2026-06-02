import { describe, it, expect } from "vitest";
import { mulberry32, buildOrder, step } from "./playlist";

describe("mulberry32", () => {
  it("is deterministic for the same seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it("produces values in [0, 1)", () => {
    const r = mulberry32(7);
    for (let i = 0; i < 100; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("buildOrder", () => {
  it("returns identity when not random", () => {
    expect(buildOrder(4, false, mulberry32(1))).toEqual([0, 1, 2, 3]);
  });

  it("returns a permutation of all indices when random", () => {
    const order = buildOrder(5, true, mulberry32(123));
    expect([...order].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
  });

  it("returns empty for length 0", () => {
    expect(buildOrder(0, true, mulberry32(1))).toEqual([]);
  });
});

describe("step", () => {
  it("advances forward within bounds", () => {
    expect(step(0, 3, false, 1)).toEqual({ pos: 1, wrapped: false, stop: false });
  });

  it("stops at end when not looping", () => {
    expect(step(2, 3, false, 1)).toEqual({ pos: 2, wrapped: false, stop: true });
  });

  it("wraps to start at end when looping", () => {
    expect(step(2, 3, true, 1)).toEqual({ pos: 0, wrapped: true, stop: false });
  });

  it("goes backward within bounds", () => {
    expect(step(2, 3, false, -1)).toEqual({ pos: 1, wrapped: false, stop: false });
  });

  it("stays at start going backward when not looping", () => {
    expect(step(0, 3, false, -1)).toEqual({ pos: 0, wrapped: false, stop: false });
  });

  it("wraps to end going backward when looping", () => {
    expect(step(0, 3, true, -1)).toEqual({ pos: 2, wrapped: true, stop: false });
  });

  it("stops for empty list", () => {
    expect(step(0, 0, true, 1)).toEqual({ pos: 0, wrapped: false, stop: true });
  });
});

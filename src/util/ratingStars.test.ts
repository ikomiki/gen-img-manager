import { describe, it, expect } from "vitest";
import { ratingStarFills } from "./ratingStars";

describe("ratingStarFills", () => {
  it("未評価(null)は全て空", () => {
    expect(ratingStarFills(null)).toEqual([false, false, false, false, false]);
  });

  it("0 は全て空", () => {
    expect(ratingStarFills(0)).toEqual([false, false, false, false, false]);
  });

  it("3 は先頭3つが塗り", () => {
    expect(ratingStarFills(3)).toEqual([true, true, true, false, false]);
  });

  it("5 は全て塗り", () => {
    expect(ratingStarFills(5)).toEqual([true, true, true, true, true]);
  });

  it("範囲外（上限超え）は5つに丸める", () => {
    expect(ratingStarFills(7)).toEqual([true, true, true, true, true]);
  });

  it("負値は全て空に丸める", () => {
    expect(ratingStarFills(-1)).toEqual([false, false, false, false, false]);
  });
});

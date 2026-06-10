import { describe, it, expect } from "vitest";
import { nextUnratedIndex } from "./ratingNav";

const r = (rating: number | null) => ({ rating });

describe("nextUnratedIndex", () => {
  it("fromIndex より後ろで最初の rating==null を返す", () => {
    const list = [r(3), r(4), r(null), r(2), r(null)];
    expect(nextUnratedIndex(list, 0)).toBe(2);
  });

  it("見つからなければ -1", () => {
    const list = [r(null), r(3), r(4)];
    expect(nextUnratedIndex(list, 0)).toBe(-1);
  });

  it("fromIndex 自身は探索対象外（前方のみ）", () => {
    const list = [r(null), r(null)];
    expect(nextUnratedIndex(list, 0)).toBe(1);
  });

  it("末尾 fromIndex では -1", () => {
    const list = [r(null), r(3)];
    expect(nextUnratedIndex(list, 1)).toBe(-1);
  });

  it("空配列では -1", () => {
    expect(nextUnratedIndex([], 0)).toBe(-1);
  });

  it("fromIndex が範囲外（負）でも先頭から探索する", () => {
    const list = [r(null), r(3)];
    expect(nextUnratedIndex(list, -1)).toBe(0);
  });
});

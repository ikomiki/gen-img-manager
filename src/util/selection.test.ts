import { describe, it, expect } from "vitest";
import { rangeSet, toggleInSet, allIndices, clampAfterDelete } from "./selection";

describe("rangeSet", () => {
  it("昇順の範囲を集合にする", () => {
    expect([...rangeSet(2, 5)].sort((a, b) => a - b)).toEqual([2, 3, 4, 5]);
  });
  it("anchor > index でも昇順に正規化する", () => {
    expect([...rangeSet(5, 2)].sort((a, b) => a - b)).toEqual([2, 3, 4, 5]);
  });
  it("同一なら 1 要素", () => {
    expect([...rangeSet(3, 3)]).toEqual([3]);
  });
});

describe("toggleInSet", () => {
  it("無ければ追加・あれば削除（非破壊）", () => {
    const a = new Set([1, 2]);
    const added = toggleInSet(a, 3);
    expect([...added].sort()).toEqual([1, 2, 3]);
    expect([...a].sort()).toEqual([1, 2]); // 元は不変
    const removed = toggleInSet(added, 2);
    expect([...removed].sort()).toEqual([1, 3]);
  });
});

describe("allIndices", () => {
  it("0..count-1 の集合", () => {
    expect([...allIndices(3)].sort()).toEqual([0, 1, 2]);
  });
  it("0 件なら空集合", () => {
    expect(allIndices(0).size).toBe(0);
  });
});

describe("clampAfterDelete", () => {
  it("残件があれば 削除最小index と 残件-1 の小さい方", () => {
    expect(clampAfterDelete(2, 5)).toBe(2);
    expect(clampAfterDelete(8, 5)).toBe(4);
  });
  it("残件 0 なら -1", () => {
    expect(clampAfterDelete(0, 0)).toBe(-1);
  });
});

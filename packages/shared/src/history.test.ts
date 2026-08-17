import { describe, it, expect } from "vitest";
import { recordHistory } from "./history";

describe("recordHistory", () => {
  it("新しいものを先頭に足す", () => {
    expect(recordHistory(["a"], "b", 50)).toEqual(["b", "a"]);
  });

  it("空文字列と空白のみは無視する", () => {
    expect(recordHistory(["a"], "", 50)).toEqual(["a"]);
    expect(recordHistory(["a"], "   ", 50)).toEqual(["a"]);
  });

  it("前後の空白を落として記録する", () => {
    expect(recordHistory([], "  rating:5  ", 50)).toEqual(["rating:5"]);
  });

  it("既存の同一文字列は先頭へ昇格し、重複を作らない", () => {
    expect(recordHistory(["a", "b", "c"], "c", 50)).toEqual(["c", "a", "b"]);
  });

  it("上限を超えたら古いものから捨てる", () => {
    const hist = ["a", "b", "c"];
    expect(recordHistory(hist, "d", 3)).toEqual(["d", "a", "b"]);
  });

  it("元の配列を書き換えない", () => {
    const hist = ["a"];
    recordHistory(hist, "b", 50);
    expect(hist).toEqual(["a"]);
  });
});

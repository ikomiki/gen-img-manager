import { describe, it, expect } from "vitest";
import { parseRatingToken, buildRatingToken, type RatingValue } from "./ratingFilter";

const set = (...vals: RatingValue[]) => new Set<RatingValue>(vals);

describe("parseRatingToken", () => {
  it("null/空文字は空集合", () => {
    expect(parseRatingToken(null)).toEqual(set());
    expect(parseRatingToken("")).toEqual(set());
  });

  it(">=N は N〜5", () => {
    expect(parseRatingToken(">=4")).toEqual(set(4, 5));
    expect(parseRatingToken(">=1")).toEqual(set(1, 2, 3, 4, 5));
  });

  it("カンマ集合（none含む）を解釈する", () => {
    expect(parseRatingToken("none,1,3")).toEqual(set("none", 1, 3));
    expect(parseRatingToken("2,4")).toEqual(set(2, 4));
  });

  it("bare none は未評価のみ", () => {
    expect(parseRatingToken("none")).toEqual(set("none"));
  });

  it("bare 整数は単一値", () => {
    expect(parseRatingToken("3")).toEqual(set(3));
  });

  it("A..B は範囲（両端含む、1〜5にクランプ）", () => {
    expect(parseRatingToken("2..4")).toEqual(set(2, 3, 4));
  });

  it("<=N / <N / >N も解釈する", () => {
    expect(parseRatingToken("<=3")).toEqual(set(1, 2, 3));
    expect(parseRatingToken("<3")).toEqual(set(1, 2));
    expect(parseRatingToken(">3")).toEqual(set(4, 5));
  });

  it("範囲外や不正値は無視（集合から除外）", () => {
    expect(parseRatingToken("0,1,6,3")).toEqual(set(1, 3));
    expect(parseRatingToken("abc")).toEqual(set());
  });
});

describe("buildRatingToken", () => {
  it("空集合は null（フィルタ無し）", () => {
    expect(buildRatingToken(set())).toBeNull();
  });

  it("全6個ONは null（実質フィルタ無し）", () => {
    expect(buildRatingToken(set("none", 1, 2, 3, 4, 5))).toBeNull();
  });

  it("N〜5の上位連続（なし含まず）は >=N", () => {
    expect(buildRatingToken(set(4, 5))).toBe(">=4");
    expect(buildRatingToken(set(3, 4, 5))).toBe(">=3");
    expect(buildRatingToken(set(1, 2, 3, 4, 5))).toBe(">=1");
  });

  it("なしを含む選択はカンマ集合（none先頭・昇順）", () => {
    expect(buildRatingToken(set("none", 1, 3))).toBe("none,1,3");
    expect(buildRatingToken(set("none"))).toBe("none");
    expect(buildRatingToken(set("none", 4, 5))).toBe("none,4,5");
  });

  it("飛びや低評価のみはカンマ集合", () => {
    expect(buildRatingToken(set(1, 3))).toBe("1,3");
    expect(buildRatingToken(set(1, 2))).toBe("1,2");
    expect(buildRatingToken(set(3))).toBe("3");
  });

  it("parse→build で round-trip する", () => {
    for (const v of [">=4", "none,1,3", "none", "1,2", "3"]) {
      expect(buildRatingToken(parseRatingToken(v))).toBe(v);
    }
  });
});

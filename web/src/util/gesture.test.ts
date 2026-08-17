import { describe, it, expect } from "vitest";
import { swipeAction, isTap, distance, pinchScale, MAX_SCALE } from "./gesture";

describe("swipeAction", () => {
  it("左へ十分引けば次へ", () => {
    expect(swipeAction(-120, 5, 200)).toBe("next");
  });

  it("右へ十分引けば前へ", () => {
    expect(swipeAction(120, 5, 200)).toBe("prev");
  });

  it("横移動が足りなければ送らない", () => {
    expect(swipeAction(-30, 0, 200)).toBe("none");
  });

  it("縦に流れていたら送らない（スクロールとの誤認を避ける）", () => {
    expect(swipeAction(-120, 100, 200)).toBe("none");
  });

  it("ゆっくり引きずったら送らない（パンとの誤認を避ける）", () => {
    expect(swipeAction(-120, 5, 2000)).toBe("none");
  });

  it("境界: ちょうど 50px は送る", () => {
    expect(swipeAction(-50, 0, 100)).toBe("next");
    expect(swipeAction(-49, 0, 100)).toBe("none");
  });
});

describe("isTap", () => {
  it("ほとんど動かず短ければタップ", () => {
    expect(isTap(2, 3, 120)).toBe(true);
    expect(isTap(0, 0, 0)).toBe(true);
  });

  it("動きすぎたらタップではない", () => {
    expect(isTap(20, 0, 120)).toBe(false);
    expect(isTap(0, 20, 120)).toBe(false);
  });

  it("長押しはタップではない", () => {
    expect(isTap(0, 0, 900)).toBe(false);
  });

  it("境界: 10px 未満・300ms 未満", () => {
    expect(isTap(9, 9, 299)).toBe(true);
    expect(isTap(10, 0, 100)).toBe(false);
    expect(isTap(0, 0, 300)).toBe(false);
  });
});

describe("distance", () => {
  it("2点間の距離を返す", () => {
    expect(distance(0, 0, 3, 4)).toBe(5);
  });

  it("同じ点なら 0", () => {
    expect(distance(7, 7, 7, 7)).toBe(0);
  });
});

describe("pinchScale", () => {
  it("指を広げると拡大する", () => {
    expect(pinchScale(100, 200, 1)).toBe(2);
  });

  it("指を縮めると縮小する", () => {
    expect(pinchScale(200, 100, 2)).toBe(1);
  });

  it("1 未満には縮まない", () => {
    expect(pinchScale(200, 10, 1)).toBe(1);
  });

  it("上限を超えない", () => {
    expect(pinchScale(10, 10000, 1)).toBe(MAX_SCALE);
  });

  it("開始距離が 0 なら倍率を変えない（測定できていない）", () => {
    expect(pinchScale(0, 100, 1.5)).toBe(1.5);
  });
});

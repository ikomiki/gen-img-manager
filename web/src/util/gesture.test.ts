import { describe, it, expect } from "vitest";
import { swipeAction, isTap, distance, pinchScale, clampPan, containedSize, MAX_SCALE } from "./gesture";

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

describe("clampPan", () => {
  // 表示領域 390x800。画像は収めた状態で 390x300 なので、拡大後は 390s x 300s。
  const view = [390, 800] as const;

  it("2倍なら中心から動かせるのは（拡大後の幅 - 画面の幅）の半分まで", () => {
    // 横: (780 - 390)/2 = 195
    expect(clampPan({ x: 500, y: 0 }, 780, 600, ...view)).toEqual({ x: 195, y: 0 });
    expect(clampPan({ x: -500, y: 0 }, 780, 600, ...view)).toEqual({ x: -195, y: 0 });
  });

  it("上限の内側はそのまま通す", () => {
    expect(clampPan({ x: 100, y: 0 }, 780, 600, ...view)).toEqual({ x: 100, y: 0 });
  });

  it("拡大しても画面より小さい軸は中央に固定する", () => {
    // 縦: 600 < 800 なので、縦にずらす余地はない
    expect(clampPan({ x: 0, y: 200 }, 780, 600, ...view)).toEqual({ x: 0, y: 0 });
  });

  it("画面より大きい軸だけ動かせる", () => {
    // 縦: (900 - 800)/2 = 50
    expect(clampPan({ x: 0, y: 200 }, 1170, 900, ...view)).toEqual({ x: 0, y: 50 });
  });

  it("等倍では中央に戻す（拡大後も画面に収まっているため）", () => {
    expect(clampPan({ x: 120, y: 90 }, 390, 300, ...view)).toEqual({ x: 0, y: 0 });
  });

  it("両軸が同時に効く", () => {
    expect(clampPan({ x: 999, y: -999 }, 1170, 900, ...view)).toEqual({ x: 390, y: -50 });
  });

  it("小数の実測値でも端がぴったり合う（整数へ丸めると端に余白が残る）", () => {
    // 実測: 拡大後 1134.625、表示領域 730 → 上限は 202.3125。
    // offsetHeight の 284 から 284*4=1136 で計算すると 203 になり 0.7px の余白が出る。
    expect(clampPan({ x: 0, y: 999 }, 1560, 1134.625, 390, 730).y).toBeCloseTo(202.3125, 6);
  });

  it("寸法が測れていないときは制限しない（レイアウト前に中央固定して動かせなくしない）", () => {
    expect(clampPan({ x: 40, y: 30 }, 0, 0, 390, 800)).toEqual({ x: 40, y: 30 });
    expect(clampPan({ x: 40, y: 30 }, 780, 600, 0, 0)).toEqual({ x: 40, y: 30 });
  });
});

describe("containedSize", () => {
  it("縦横比が同じなら矩形をそのまま返す", () => {
    expect(containedSize(1000, 500, 400, 200)).toEqual({ w: 400, h: 200 });
  });

  it("横長の絵を正方形の矩形に入れると高さが縮む", () => {
    expect(containedSize(1000, 500, 400, 400)).toEqual({ w: 400, h: 200 });
  });

  it("縦長の絵を正方形の矩形に入れると幅が縮む", () => {
    expect(containedSize(500, 1000, 400, 400)).toEqual({ w: 200, h: 400 });
  });

  it("拡大後の矩形でも比率どおりに絵の大きさが出る", () => {
    // 表示領域 390x800 を 3 倍したのが矩形。絵は 1024x768。
    expect(containedSize(1024, 768, 1170, 2400)).toEqual({ w: 1170, h: 877.5 });
  });

  it("自然サイズが分からないときは矩形をそのまま返す（制限しない側に倒す）", () => {
    expect(containedSize(0, 0, 390, 800)).toEqual({ w: 390, h: 800 });
    expect(containedSize(1024, 768, 0, 0)).toEqual({ w: 0, h: 0 });
  });
});

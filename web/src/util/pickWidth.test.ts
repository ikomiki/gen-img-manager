import { describe, it, expect } from "vitest";
import { pickWidth, containedLongEdge, ALLOWED_WIDTHS } from "./pickWidth";

describe("pickWidth", () => {
  it("要求以上で最小の許可値を返す", () => {
    expect(pickWidth(100, 1)).toBe(640);
    expect(pickWidth(640, 1)).toBe(640);
    expect(pickWidth(641, 1)).toBe(1280);
  });

  it("devicePixelRatio を掛ける", () => {
    // スマホ縦 390px 幅・dpr 3 → 1170 を要求 → 1280 へ切り上げ
    expect(pickWidth(390, 3)).toBe(1280);
    // 同じ幅でも dpr 1 なら 640 で足りる
    expect(pickWidth(390, 1)).toBe(640);
  });

  it("2560 を超えたら 2560 に丸める", () => {
    // 1440px 幅・dpr 2 → 2880 を要求するが、サーバの上限は 2560
    expect(pickWidth(1440, 2)).toBe(2560);
    expect(pickWidth(4000, 3)).toBe(2560);
  });

  it("0 や負でも最小値を返す（レイアウト前の測定値を渡されても壊れない）", () => {
    expect(pickWidth(0, 2)).toBe(640);
    expect(pickWidth(-10, 2)).toBe(640);
  });

  it("許可値はサーバの ALLOWED_WIDTHS と同じ並び", () => {
    expect(ALLOWED_WIDTHS).toEqual([640, 1280, 1920, 2560]);
  });
});

describe("containedLongEdge", () => {
  it("横長の画像が横長の画面に収まるとき、画面幅が長辺になる", () => {
    // 3000x2000 を 1500x1000 に収める → 1500x1000。長辺は 1500
    expect(containedLongEdge(3000, 2000, 1500, 1000)).toBe(1500);
  });

  it("縦長の画像を横長の画面に収めると、画面の高さが長辺になる", () => {
    // 1000x3000 を 1500x900 に収める → 300x900。長辺は 900
    expect(containedLongEdge(1000, 3000, 1500, 900)).toBe(900);
  });

  it("画面より小さい画像でも、収める倍率で計算する（等倍で止めない）", () => {
    // 表示は拡大されるので、要求する解像度も拡大後の長辺で決める
    expect(containedLongEdge(100, 100, 800, 600)).toBe(600);
  });

  it("画像サイズが未知（0）なら画面の長辺を返す", () => {
    expect(containedLongEdge(0, 0, 1500, 900)).toBe(1500);
  });
});

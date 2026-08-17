import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ZoomableImage } from "./ZoomableImage";
import { useViewerStore } from "../store/useViewerStore";

beforeEach(() => {
  useViewerStore.setState({ scale: 1, zoomMode: "shrink" });
  // jsdom は Pointer Capture を実装していない。
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});

function renderImage(overrides: Partial<Parameters<typeof ZoomableImage>[0]> = {}) {
  const onTap = vi.fn();
  const onSwipe = vi.fn();
  render(<ZoomableImage src="/api/image/1?w=1280" alt="a.png" onTap={onTap} onSwipe={onSwipe} {...overrides} />);
  return { onTap, onSwipe, el: screen.getByAltText("a.png").parentElement! };
}

describe("ZoomableImage", () => {
  it("短く触れて離すとタップになる", () => {
    const { onTap, onSwipe, el } = renderImage();

    fireEvent.pointerDown(el, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(el, { pointerId: 1, clientX: 102, clientY: 101 });

    expect(onTap).toHaveBeenCalledTimes(1);
    expect(onSwipe).not.toHaveBeenCalled();
  });

  it("左へ払うと次へ", () => {
    const { onTap, onSwipe, el } = renderImage();

    fireEvent.pointerDown(el, { pointerId: 1, clientX: 300, clientY: 100 });
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 150, clientY: 105 });
    fireEvent.pointerUp(el, { pointerId: 1, clientX: 150, clientY: 105 });

    expect(onSwipe).toHaveBeenCalledWith("next");
    expect(onTap).not.toHaveBeenCalled();
  });

  it("右へ払うと前へ", () => {
    const { onSwipe, el } = renderImage();

    fireEvent.pointerDown(el, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 250, clientY: 105 });
    fireEvent.pointerUp(el, { pointerId: 1, clientX: 250, clientY: 105 });

    expect(onSwipe).toHaveBeenCalledWith("prev");
  });

  it("縦に流れた払いは送らない", () => {
    const { onSwipe, el } = renderImage();

    fireEvent.pointerDown(el, { pointerId: 1, clientX: 300, clientY: 100 });
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 150, clientY: 300 });
    fireEvent.pointerUp(el, { pointerId: 1, clientX: 150, clientY: 300 });

    expect(onSwipe).not.toHaveBeenCalled();
  });

  it("2本指を広げると拡大する", () => {
    const { el } = renderImage();

    fireEvent.pointerDown(el, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerDown(el, { pointerId: 2, clientX: 200, clientY: 100 });
    fireEvent.pointerMove(el, { pointerId: 2, clientX: 300, clientY: 100 });

    expect(useViewerStore.getState().scale).toBeCloseTo(2, 5);
  });

  it("拡大中は横に払っても送らない（パンとして扱う）", () => {
    useViewerStore.setState({ scale: 3 });
    const { onSwipe, el } = renderImage();

    fireEvent.pointerDown(el, { pointerId: 1, clientX: 300, clientY: 100 });
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 150, clientY: 100 });
    fireEvent.pointerUp(el, { pointerId: 1, clientX: 150, clientY: 100 });

    expect(onSwipe).not.toHaveBeenCalled();
  });

  it("倍率がストアに反映される", () => {
    useViewerStore.setState({ scale: 2.5 });
    const { el } = renderImage();
    const img = el.querySelector("img")!;
    expect(img.style.transform).toContain("scale(2.5)");
  });

  it("ピンチして縮小し、1本目を離しても送られない", () => {
    useViewerStore.setState({ scale: 2 });
    const { onTap, onSwipe, el } = renderImage();

    fireEvent.pointerDown(el, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerDown(el, { pointerId: 2, clientX: 300, clientY: 100 });
    // 縮める向きに動かして scale を 1 まで戻す（pinchScale の下限クランプ）。
    fireEvent.pointerMove(el, { pointerId: 2, clientX: 150, clientY: 100 });
    fireEvent.pointerUp(el, { pointerId: 2, clientX: 150, clientY: 100 });
    // 1本目は大きく動かさずに離す。
    fireEvent.pointerUp(el, { pointerId: 1, clientX: 102, clientY: 101 });

    expect(onSwipe).not.toHaveBeenCalled();
    expect(onTap).not.toHaveBeenCalled();
  });

  it("setPointerCapture が例外を投げても、スワイプ判定は続く", () => {
    Element.prototype.setPointerCapture = vi.fn(() => {
      throw new DOMException("", "NotFoundError");
    });
    const { onTap, onSwipe, el } = renderImage();

    fireEvent.pointerDown(el, { pointerId: 1, clientX: 300, clientY: 100 });
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 150, clientY: 105 });
    fireEvent.pointerUp(el, { pointerId: 1, clientX: 150, clientY: 105 });

    expect(onSwipe).toHaveBeenCalledWith("next");
    expect(onTap).not.toHaveBeenCalled();
  });

  it("pointercancel では送りもタップも起こさない", () => {
    const { onTap, onSwipe, el } = renderImage();

    fireEvent.pointerDown(el, { pointerId: 1, clientX: 300, clientY: 100 });
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 150, clientY: 105 });
    fireEvent.pointerCancel(el, { pointerId: 1, clientX: 150, clientY: 105 });

    expect(onSwipe).not.toHaveBeenCalled();
    expect(onTap).not.toHaveBeenCalled();
  });

  it("2本目を離した後のパンが飛ばない", () => {
    useViewerStore.setState({ scale: 2 });
    const { el } = renderImage();
    const img = el.querySelector("img")!;

    fireEvent.pointerDown(el, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerDown(el, { pointerId: 2, clientX: 300, clientY: 100 });
    // ピンチ中に1本目も動く。
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 140, clientY: 100 });
    fireEvent.pointerUp(el, { pointerId: 2, clientX: 300, clientY: 100 });
    // 2本目を離した後、残った1本目をさらに動かす。
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 170, clientY: 100 });

    // 「離した後の移動量」(170-140=30) に対応していること。
    // 1本目の最初の down 位置 (100) からの累積 (70) になっていないこと。
    expect(img.style.transform).toContain("translate(30px, 0px)");
  });
});

describe("拡大中のパンの範囲", () => {
  // jsdom はレイアウトしないので getBoundingClientRect が常に 0 を返す。このブロックだけ
  // 実寸を返すよう差し替え、afterEach で必ず元へ戻す（他のテストファイルへ漏らさない）。
  const stubbed: HTMLElement[] = [];

  function stubRect(el: HTMLElement, size: () => { width: number; height: number }) {
    Object.defineProperty(el, "getBoundingClientRect", {
      configurable: true,
      value: () => {
        const { width, height } = size();
        return { width, height, x: 0, y: 0, top: 0, left: 0, right: width, bottom: height } as DOMRect;
      },
    });
    stubbed.push(el);
  }

  afterEach(() => {
    for (const el of stubbed) Reflect.deleteProperty(el, "getBoundingClientRect");
    stubbed.length = 0;
  });

  /**
   * 表示領域 390x800。画像は収めた状態で 390x300 で、拡大後は倍率を掛けた値になる。
   * 端数のある高さにしてあるのは、整数へ丸めた寸法で計算すると端に余白が残ることを
   * このテストでも踏むようにするため。
   */
  const LAYOUT_W = 390;
  const LAYOUT_H = 300.4;

  function renderSized() {
    const r = renderImage();
    const img = screen.getByAltText("a.png");
    stubRect(img, () => {
      const s = useViewerStore.getState().scale;
      return { width: LAYOUT_W * s, height: LAYOUT_H * s };
    });
    stubRect(r.el, () => ({ width: 390, height: 800 }));
    return { ...r, img };
  }

  function pan(el: HTMLElement, dx: number, dy: number) {
    fireEvent.pointerDown(el, { pointerId: 1, clientX: 200, clientY: 400 });
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 200 + dx, clientY: 400 + dy });
    fireEvent.pointerUp(el, { pointerId: 1, clientX: 200 + dx, clientY: 400 + dy });
  }

  it("画像の端より外へは動かせない", () => {
    useViewerStore.setState({ scale: 2 });
    const { el, img } = renderSized();

    pan(el, 500, 0);

    // 横の上限は (390*2 - 390)/2 = 195
    expect(img.style.transform).toContain("translate(195px, 0px)");
  });

  it("拡大しても画面より小さい軸は中央から動かない", () => {
    useViewerStore.setState({ scale: 2 });
    const { el, img } = renderSized();

    pan(el, 0, 300);

    // 縦は 300.4*2 = 600.8 < 800 なのでずらす余地がない
    expect(img.style.transform).toContain("translate(0px, 0px)");
  });

  it("上限の内側なら指の動きどおりに動く", () => {
    useViewerStore.setState({ scale: 2 });
    const { el, img } = renderSized();

    pan(el, 100, 0);

    expect(img.style.transform).toContain("translate(100px, 0px)");
  });

  it("端数のある高さでも端がぴったり合う", () => {
    useViewerStore.setState({ scale: 3 });
    const { el, img } = renderSized();

    pan(el, 0, -999);

    // 縦の上限は (300.4*3 - 800)/2 = 50.6。整数へ丸めた 300 から計算すると 50 になり 0.6px ずれる。
    // 文字列比較だと浮動小数の表記（-50.599999999999966）に振り回されるので数値で見る。
    const ty = Number(/translate\(0px, (-?[\d.]+)px\)/.exec(img.style.transform)![1]);
    expect(ty).toBeCloseTo(-50.6, 6);
  });

  it("倍率を下げると、はみ出していた分を詰め直す", () => {
    useViewerStore.setState({ scale: 3 });
    const { el, img } = renderSized();

    pan(el, 380, 0); // 3倍の上限 (390*3-390)/2 = 390 の内側
    expect(img.style.transform).toContain("translate(380px, 0px)");

    // 2倍へ縮めると上限が 195 になるので、380 のままでは画像の外側が見えてしまう。
    // 描画後にストアを書き換えるので act で包む（包まないと再レンダリング前に検証してしまう）。
    act(() => {
      useViewerStore.setState({ scale: 2 });
    });
    expect(img.style.transform).toContain("translate(195px, 0px)");
  });
});

describe("ズームモード", () => {
  const stubbed: HTMLElement[] = [];

  function stubRect(el: HTMLElement, width: number, height: number) {
    Object.defineProperty(el, "getBoundingClientRect", {
      configurable: true,
      value: () =>
        ({ width, height, x: 0, y: 0, top: 0, left: 0, right: width, bottom: height }) as DOMRect,
    });
    stubbed.push(el);
  }

  afterEach(() => {
    for (const el of stubbed) Reflect.deleteProperty(el, "getBoundingClientRect");
    stubbed.length = 0;
  });

  it("shrink は等倍を超えて拡大しない指定になる", () => {
    useViewerStore.setState({ zoomMode: "shrink" });
    renderImage();
    const img = screen.getByAltText("a.png");
    expect(img.style.maxWidth).toBe("100%");
    expect(img.style.maxHeight).toBe("100%");
    expect(img.style.width).toBe("");
  });

  it("always は表示領域いっぱいへ広げる指定になる", () => {
    useViewerStore.setState({ zoomMode: "always" });
    renderImage();
    const img = screen.getByAltText("a.png");
    expect(img.style.width).toBe("100%");
    expect(img.style.height).toBe("100%");
    expect(img.style.objectFit).toBe("contain");
    expect(img.style.maxWidth).toBe("");
  });

  it("always のパンは要素の矩形ではなく絵の大きさで止まる", () => {
    useViewerStore.setState({ zoomMode: "always", scale: 3 });
    const { el } = renderImage();
    const img = screen.getByAltText("a.png") as HTMLImageElement;
    // always では要素が表示領域 390x800 いっぱいになり、3倍で 1170x2400。
    stubRect(img, 1170, 2400);
    stubRect(el, 390, 800);
    // 絵は 1024x768 なので、その矩形へ contain で収めると 1170x877.5 しか描かれない。
    Object.defineProperty(img, "naturalWidth", { configurable: true, value: 1024 });
    Object.defineProperty(img, "naturalHeight", { configurable: true, value: 768 });

    fireEvent.pointerDown(el, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 100, clientY: 1099 });

    // 絵で見た上限は (877.5 - 800) / 2 = 38.75。要素で見た (2400 - 800) / 2 = 800 ではない。
    expect(img.style.transform).toContain("translate(0px, 38.75px)");
  });
});

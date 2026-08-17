import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ZoomableImage } from "./ZoomableImage";
import { useViewerStore } from "../store/useViewerStore";

beforeEach(() => {
  useViewerStore.setState({ scale: 1 });
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

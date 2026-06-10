import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSlideTimer } from "./useSlideTimer";

// rAF・setTimeout・performance.now をすべて偽装して時間を進める。
beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "performance",
    ],
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const advance = (ms: number) => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};

describe("useSlideTimer", () => {
  it("読み込み完了（markLoaded）から delayMs 経過後に onElapsed を一度だけ呼ぶ", () => {
    const onElapsed = vi.fn();
    const { result } = renderHook(() => useSlideTimer(true, 5000, 0, onElapsed));
    act(() => result.current.markLoaded());
    advance(4900);
    expect(onElapsed).not.toHaveBeenCalled();
    advance(1100); // rAF 経路と保険 setTimeout の両方が期限を越えるが、発火は一度だけ
    expect(onElapsed).toHaveBeenCalledTimes(1);
  });

  it("markLoaded が呼ばれるまでは時間が経っても発火しない", () => {
    const onElapsed = vi.fn();
    const { result } = renderHook(() => useSlideTimer(true, 5000, 0, onElapsed));
    advance(60000);
    expect(onElapsed).not.toHaveBeenCalled();
    act(() => result.current.markLoaded());
    advance(5100);
    expect(onElapsed).toHaveBeenCalledTimes(1);
  });

  it("読み込みからの経過で数える（読み込みに時間がかかった分だけ発火が遅れる）", () => {
    const onElapsed = vi.fn();
    const { result } = renderHook(() => useSlideTimer(true, 5000, 0, onElapsed));
    advance(3000); // 読み込みに 3000ms かかった想定
    act(() => result.current.markLoaded());
    advance(4900); // 通算 7900ms だが読み込み完了から 4900ms
    expect(onElapsed).not.toHaveBeenCalled();
    advance(200);
    expect(onElapsed).toHaveBeenCalledTimes(1);
  });

  it("active でなければ読み込み完了後も呼ばない", () => {
    const onElapsed = vi.fn();
    const { result } = renderHook(() => useSlideTimer(false, 5000, 0, onElapsed));
    act(() => result.current.markLoaded());
    advance(60000);
    expect(onElapsed).not.toHaveBeenCalled();
  });

  it("epoch が変わると次の読み込み完了までカウントしない", () => {
    const onElapsed = vi.fn();
    const { result, rerender } = renderHook(
      ({ epoch }) => useSlideTimer(true, 5000, epoch, onElapsed),
      { initialProps: { epoch: 0 } },
    );
    act(() => result.current.markLoaded());
    advance(3000);
    rerender({ epoch: 1 }); // 画像が変わった: 読み込み待ちに戻る
    advance(60000);
    expect(onElapsed).not.toHaveBeenCalled();
    act(() => result.current.markLoaded()); // 新しい画像の読み込み完了
    advance(5100);
    expect(onElapsed).toHaveBeenCalledTimes(1);
  });

  it("発火後、epoch が変わらない限り再発火しない", () => {
    const onElapsed = vi.fn();
    const { result } = renderHook(() => useSlideTimer(true, 1000, 0, onElapsed));
    act(() => result.current.markLoaded());
    advance(1500);
    expect(onElapsed).toHaveBeenCalledTimes(1);
    advance(10000);
    expect(onElapsed).toHaveBeenCalledTimes(1);
  });

  it("一時停止で止まり、再開すると読み込み済みならカウントし直す", () => {
    const onElapsed = vi.fn();
    const { result, rerender } = renderHook(
      ({ active }) => useSlideTimer(active, 5000, 0, onElapsed),
      { initialProps: { active: true } },
    );
    act(() => result.current.markLoaded());
    advance(3000);
    rerender({ active: false });
    advance(60000);
    expect(onElapsed).not.toHaveBeenCalled();
    rerender({ active: true }); // 表示中の画像は読み込み済みなので再カウント開始
    advance(4900);
    expect(onElapsed).not.toHaveBeenCalled();
    advance(1100);
    expect(onElapsed).toHaveBeenCalledTimes(1);
  });

  it("rAF が動かない環境でも保険の setTimeout で発火する", () => {
    vi.stubGlobal("requestAnimationFrame", () => 0);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    const onElapsed = vi.fn();
    const { result } = renderHook(() => useSlideTimer(true, 5000, 0, onElapsed));
    act(() => result.current.markLoaded());
    advance(4999);
    expect(onElapsed).not.toHaveBeenCalled();
    advance(1001); // 保険は delayMs より少し遅れて入る（猶予 < 1s）
    expect(onElapsed).toHaveBeenCalledTimes(1);
  });

  it("keep-alive 要素の transform を毎フレーム書き換える", () => {
    const { result } = renderHook(() => useSlideTimer(true, 5000, 0, vi.fn()));
    const el = document.createElement("div");
    act(() => {
      result.current.keepAliveRef.current = el;
    });
    advance(32); // 2 フレーム
    expect(el.style.transform).not.toBe("");
    const t1 = el.style.transform;
    advance(16); // さらに 1 フレームで交互の値に変わる
    expect(el.style.transform).not.toBe(t1);
  });

  it("アンマウント後は発火しない", () => {
    const onElapsed = vi.fn();
    const { result, unmount } = renderHook(() => useSlideTimer(true, 5000, 0, onElapsed));
    act(() => result.current.markLoaded());
    advance(3000);
    unmount();
    advance(60000);
    expect(onElapsed).not.toHaveBeenCalled();
  });
});

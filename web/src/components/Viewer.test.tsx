import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { Viewer } from "./Viewer";
import { useViewerStore } from "../store/useViewerStore";
import { useQueryStore } from "../store/useQueryStore";
import * as imagesApi from "../api/images";

function rows(from: number, count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: from + i,
    filename: `f${from + i}.png`,
    width: 832,
    height: 1216,
    rating: null,
    created_at: 1000,
    modified_at: 1000,
    source_tool: "a1111",
    model: null,
  }));
}

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(imagesApi, "listImageIds").mockResolvedValue([]);
  vi.spyOn(imagesApi, "listImages").mockResolvedValue([]);
  vi.spyOn(imagesApi, "countImages").mockResolvedValue({ total: 0 });
  useQueryStore.setState({ results: rows(1, 5), total: 5, exhausted: true, loading: false });
  useViewerStore.setState({
    open: false,
    ids: [],
    idsSeq: null,
    order: [],
    pos: 0,
    scale: 1,
    chromeVisible: true,
    playing: false,
    intervalSec: 5,
    loop: true,
    shuffle: false,
  });
});

afterEach(() => vi.restoreAllMocks());

describe("Viewer", () => {
  it("閉じているときは何も描かない", () => {
    const { container } = render(<Viewer />);
    expect(container.firstChild).toBeNull();
  });

  it("開くと画像とファイル名と位置を出す", () => {
    useViewerStore.getState().openAt(2, 5);
    render(<Viewer />);

    expect(screen.getByAltText("f3.png")).toBeTruthy();
    expect(screen.getByText("3 / 5")).toBeTruthy();
  });

  it("次へボタンで送る", () => {
    useViewerStore.getState().openAt(0, 5);
    render(<Viewer />);

    fireEvent.click(screen.getByLabelText("次へ"));
    expect(useViewerStore.getState().pos).toBe(1);
    expect(screen.getByAltText("f2.png")).toBeTruthy();
  });

  it("前へボタンで戻る", () => {
    useViewerStore.getState().openAt(2, 5);
    render(<Viewer />);

    fireEvent.click(screen.getByLabelText("前へ"));
    expect(useViewerStore.getState().pos).toBe(1);
  });

  it("閉じるボタンで閉じる", () => {
    useViewerStore.getState().openAt(0, 5);
    render(<Viewer />);

    fireEvent.click(screen.getByLabelText("閉じる"));
    expect(useViewerStore.getState().open).toBe(false);
  });

  it("画像をタップするとバーの表示が切り替わる", () => {
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
    useViewerStore.getState().openAt(0, 5);
    render(<Viewer />);

    const area = screen.getByAltText("f1.png").parentElement!;
    expect(useViewerStore.getState().chromeVisible).toBe(true);
    fireEvent.pointerDown(area, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(area, { pointerId: 1, clientX: 11, clientY: 10 });
    expect(useViewerStore.getState().chromeVisible).toBe(false);
  });

  it("左へ払うと次の画像へ送る", () => {
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
    useViewerStore.getState().openAt(0, 5);
    render(<Viewer />);

    const area = screen.getByAltText("f1.png").parentElement!;
    fireEvent.pointerDown(area, { pointerId: 1, clientX: 300, clientY: 100 });
    fireEvent.pointerMove(area, { pointerId: 1, clientX: 150, clientY: 105 });
    fireEvent.pointerUp(area, { pointerId: 1, clientX: 150, clientY: 105 });

    expect(useViewerStore.getState().pos).toBe(1);
  });

  it("結果が変わったら順序を合わせ直す", () => {
    useViewerStore.getState().openAt(0, 5);
    render(<Viewer />);

    // 描画後にストアを書き換えると React の更新が走るので act で包む。
    // 包まないと「An update to Viewer inside a test was not wrapped in act(...)」の
    // 警告が出て、テスト出力が汚れる。
    act(() => {
      useQueryStore.setState({ results: rows(1, 12), total: 12 });
    });
    expect(useViewerStore.getState().order).toHaveLength(12);
  });

  it("末尾に近づいたら追加読み込みを促す", async () => {
    const spy = vi.spyOn(imagesApi, "listImages").mockResolvedValue([]);
    useQueryStore.setState({ results: rows(1, 10), total: 100, exhausted: false });
    useViewerStore.getState().openAt(8, 10);
    render(<Viewer />);

    await vi.waitFor(() => expect(spy).toHaveBeenCalled());
  });

  it("再生中は、画像の読み込み完了から間隔だけ経つと次へ送る", async () => {
    vi.useFakeTimers();
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
    useViewerStore.getState().openAt(0, 5);
    useViewerStore.setState({ playing: true, intervalSec: 5 });
    render(<Viewer />);

    // 読み込みが終わるまでは数え始めない。
    await vi.advanceTimersByTimeAsync(10_000);
    expect(useViewerStore.getState().pos).toBe(0);

    fireEvent.load(screen.getByAltText("f1.png"));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(useViewerStore.getState().pos).toBe(1);

    vi.useRealTimers();
  });

  it("画像の読み込みが失敗しても、間隔が経てば次へ送る", async () => {
    vi.useFakeTimers();
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
    useViewerStore.getState().openAt(0, 5);
    useViewerStore.setState({ playing: true, intervalSec: 5 });
    render(<Viewer />);

    fireEvent.error(screen.getByAltText("f1.png"));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(useViewerStore.getState().pos).toBe(1);

    vi.useRealTimers();
  });

  it("停止中は送らない", async () => {
    vi.useFakeTimers();
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
    useViewerStore.getState().openAt(0, 5);
    render(<Viewer />);

    fireEvent.load(screen.getByAltText("f1.png"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(useViewerStore.getState().pos).toBe(0);

    vi.useRealTimers();
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import { Viewer } from "./Viewer";
import { useViewerStore } from "../store/useViewerStore";
import { useQueryStore } from "../store/useQueryStore";
import type { ImageDto } from "../api/images";
import * as imagesApi from "../api/images";

function row(id: number): ImageDto {
  return {
    id,
    filename: `${id}.png`,
    width: 1024,
    height: 768,
    rating: null,
    created_at: null,
    modified_at: null,
    source_tool: "a1111",
    model: null,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(imagesApi, "listImageIds").mockResolvedValue([1, 2, 3]);
  // 3件すべて results にあるので窓取得は走らないはず。走ったら気づけるように監視する。
  vi.spyOn(imagesApi, "listImages").mockResolvedValue([]);
  useQueryStore.setState({ results: [row(1), row(2), row(3)], total: 3, exhausted: true, seq: 1 });
  useViewerStore.setState({
    open: false,
    ids: [],
    idsSeq: null,
    order: [],
    pos: 0,
    shuffle: false,
    loop: true,
    intervalSec: 3,
    playing: false,
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/**
 * 表示中の画像の onLoad を発火させて「読み込みが決着した」状態にする。
 * alt が空になり得るので role では引かない（空 alt の img は role="presentation"）。
 */
function settle() {
  const img = document.querySelector("img");
  if (!img) throw new Error("img が描画されていない");
  fireEvent.load(img);
}

describe("スライドショーの計時", () => {
  it("再生中は間隔ごとに送る", () => {
    act(() => useViewerStore.getState().openAt(0, 3));
    render(<Viewer />);
    act(() => useViewerStore.getState().play());
    act(() => settle());

    expect(useViewerStore.getState().pos).toBe(0);
    act(() => void vi.advanceTimersByTime(3000));
    expect(useViewerStore.getState().pos).toBe(1);
  });

  it("閉じたあとはタイマーが残らない", () => {
    act(() => useViewerStore.getState().openAt(0, 3));
    render(<Viewer />);
    act(() => useViewerStore.getState().play());
    act(() => settle());

    act(() => useViewerStore.getState().close());
    const posAtClose = useViewerStore.getState().pos;

    act(() => void vi.advanceTimersByTime(30000));

    expect(useViewerStore.getState().playing).toBe(false);
    expect(useViewerStore.getState().pos).toBe(posAtClose);
  });

  it("停止すると送らない", () => {
    act(() => useViewerStore.getState().openAt(0, 3));
    render(<Viewer />);
    act(() => useViewerStore.getState().play());
    act(() => settle());
    act(() => useViewerStore.getState().pause());

    act(() => void vi.advanceTimersByTime(30000));

    expect(useViewerStore.getState().pos).toBe(0);
  });
});

describe("全件ID の取得", () => {
  it("開いたときに一度だけ取り、results にある行は窓取得しない", async () => {
    act(() => useViewerStore.getState().openAt(0, 3));
    render(<Viewer />);
    await act(async () => {});

    expect(imagesApi.listImageIds).toHaveBeenCalledTimes(1);
    expect(useViewerStore.getState().ids).toEqual([1, 2, 3]);
    expect(useViewerStore.getState().idsSeq).toBe(1);
    expect(imagesApi.listImages).not.toHaveBeenCalled();
  });

  it("閉じて開き直しても再生範囲は全件のまま", async () => {
    vi.mocked(imagesApi.listImageIds).mockResolvedValue(
      Array.from({ length: 50 }, (_, i) => i + 1),
    );
    act(() => useViewerStore.getState().openAt(0, 3));
    render(<Viewer />);
    await act(async () => {});
    expect(useViewerStore.getState().order.length).toBe(50);

    act(() => useViewerStore.getState().close());
    // ImageGrid は読み込み済みの件数で開く。
    act(() => useViewerStore.getState().openAt(0, 3));
    await act(async () => {});

    expect(useViewerStore.getState().order.length).toBe(50);
  });
});

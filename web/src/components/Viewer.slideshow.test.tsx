import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, act, screen } from "@testing-library/react";
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
  // 3件すべて results にあるので行取得は走らないはず。走ったら気づけるように監視する。
  vi.spyOn(imagesApi, "listImagesByIds").mockResolvedValue([]);
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

  it("並びが作り直されて pos が動いても送りは止まらない", async () => {
    vi.mocked(imagesApi.listImageIds).mockResolvedValue(
      Array.from({ length: 50 }, (_, i) => i + 1),
    );
    act(() => useViewerStore.getState().openAt(0, 3));
    render(<Viewer />);
    await act(async () => {});
    act(() => settle());
    act(() => useViewerStore.getState().play());

    // シャッフルを入れると order を作り直す。見ている画像は同じなので src は変わらず、
    // pos だけが動く。
    act(() => useViewerStore.getState().setShuffle(true, 12345));
    const posBefore = useViewerStore.getState().pos;
    expect(posBefore).not.toBe(0);

    act(() => void vi.advanceTimersByTime(3000));
    expect(useViewerStore.getState().pos).not.toBe(posBefore);
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
  it("開いたときに一度だけ取り、results にある行は取りにいかない", async () => {
    act(() => useViewerStore.getState().openAt(0, 3));
    render(<Viewer />);
    await act(async () => {});

    expect(imagesApi.listImageIds).toHaveBeenCalledTimes(1);
    expect(useViewerStore.getState().ids).toEqual([1, 2, 3]);
    expect(useViewerStore.getState().idsSeq).toBe(1);
    expect(imagesApi.listImagesByIds).not.toHaveBeenCalled();
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

  it("未読み込みの位置でも ids から正しい画像とファイル名を出す", async () => {
    vi.mocked(imagesApi.listImageIds).mockResolvedValue(
      Array.from({ length: 100 }, (_, i) => i + 1),
    );
    vi.mocked(imagesApi.listImagesByIds).mockImplementation(async (ids) => ids.map(row));
    useQueryStore.setState({ results: [row(1)], total: 1, exhausted: true, seq: 1 });

    act(() => useViewerStore.getState().openAt(0, 1));
    render(<Viewer />);
    // ids（1..100）が入るのを待つ。
    await act(async () => {});
    expect(useViewerStore.getState().ids.length).toBe(100);

    // shuffle:false なら order[pos] === pos。40 以上まで送って先読み済みの範囲を越える。
    act(() => {
      for (let i = 0; i < 40; i++) useViewerStore.getState().go(1);
    });
    await act(async () => {});

    expect(imagesApi.listImagesByIds).toHaveBeenCalledWith(expect.arrayContaining([41]));
    const img = document.querySelector("img");
    expect(img?.getAttribute("src")).toContain("/api/image/41");
    expect(screen.getByText("41.png")).toBeTruthy();
  });

  it("シャッフル再生でも行の取得は数十枚に 1 回で済む", async () => {
    vi.mocked(imagesApi.listImageIds).mockResolvedValue(
      Array.from({ length: 1000 }, (_, i) => i + 1),
    );
    vi.mocked(imagesApi.listImagesByIds).mockImplementation(async (ids) => ids.map(row));
    useQueryStore.setState({ results: [row(1)], total: 1, exhausted: true, seq: 1 });
    useViewerStore.setState({ shuffle: true });

    act(() => useViewerStore.getState().openAt(0, 1));
    render(<Viewer />);
    await act(async () => {});
    expect(useViewerStore.getState().order.length).toBe(1000);
    // 表示位置を先頭へ揃えて、以降の送り回数と取得回数の関係を決定的にする。
    // ジャンプ自体で 1 回取るので、その後から数える。
    act(() => useViewerStore.setState({ pos: 0 }));
    await act(async () => {});
    const mock = vi.mocked(imagesApi.listImagesByIds).mock;
    expect(mock.calls.at(-1)?.[0]).toHaveLength(40);
    mock.calls.length = 0;

    // 先読み分（40 枚）を使い切るまでは取りにいかない。
    for (let i = 0; i < 30; i++) {
      act(() => useViewerStore.getState().go(1));
      await act(async () => {});
    }
    expect(mock.calls).toHaveLength(0);

    // 使い切る手前で次の 40 枚ぶんをまとめて取る。
    for (let i = 0; i < 10; i++) {
      act(() => useViewerStore.getState().go(1));
      await act(async () => {});
    }
    expect(mock.calls).toHaveLength(1);
    expect(screen.getByText(`${useViewerStore.getState().ids[useViewerStore.getState().order[40]]}.png`)).toBeTruthy();
  });
});

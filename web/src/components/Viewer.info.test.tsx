import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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

/** id 2 だけ Negative が無い。 */
function detail(id: number): imagesApi.ImageDetailDto {
  return {
    id,
    filename: `f${id}.png`,
    width: 832,
    height: 1216,
    rating: 4,
    source_tool: "a1111",
    model: "m",
    sampler: null,
    steps: 20,
    cfg: 7,
    seed: 1,
    positive: `pos${id}`,
    negative: id === 2 ? null : `neg${id}`,
    raw_parameters: null,
  };
}

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(imagesApi, "listImageIds").mockResolvedValue([]);
  vi.spyOn(imagesApi, "listImages").mockResolvedValue([]);
  vi.spyOn(imagesApi, "countImages").mockResolvedValue({ total: 0 });
  vi.spyOn(imagesApi, "getImageDetail").mockImplementation(async (id) => detail(id));
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
    zoomMode: "shrink",
    infoOpen: false,
    normalizePrompt: false,
    maximizedBlock: null,
  });
});

afterEach(() => vi.restoreAllMocks());

describe("Viewer の情報パネル", () => {
  it("i キーで開閉し、閉じている間は取得しない", async () => {
    useViewerStore.getState().openAt(0, 5);
    render(<Viewer />);
    expect(imagesApi.getImageDetail).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: "i" });
    expect(await screen.findByText("pos1")).toBeTruthy();
    expect(screen.getByText("★4")).toBeTruthy();

    fireEvent.keyDown(document, { key: "i" });
    expect(screen.queryByText("pos1")).toBeNull();
  });

  it("修飾キー付きの i では開かない", () => {
    useViewerStore.getState().openAt(0, 5);
    render(<Viewer />);
    fireEvent.keyDown(document, { key: "i", metaKey: true });
    expect(useViewerStore.getState().infoOpen).toBe(false);
  });

  it("→ で送っても開いたまま、内容は次の画像に変わる", async () => {
    useViewerStore.setState({ infoOpen: true });
    useViewerStore.getState().openAt(0, 5);
    render(<Viewer />);
    await screen.findByText("pos1");

    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(await screen.findByText("pos2")).toBeTruthy();
  });

  it("最大化は送っても保ち、そのブロックが無い画像では通常表示、戻れば再び最大化", async () => {
    useViewerStore.setState({ infoOpen: true });
    useViewerStore.getState().openAt(0, 5);
    render(<Viewer />);
    await screen.findByText("neg1");

    fireEvent.click(screen.getByLabelText("Negativeを最大化"));
    expect(screen.queryByText("pos1")).toBeNull();

    // id 2 は Negative が無い。
    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(await screen.findByText("pos2")).toBeTruthy();
    expect(useViewerStore.getState().maximizedBlock).toBe("negative");

    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(await screen.findByText("neg3")).toBeTruthy();
    expect(screen.queryByText("pos3")).toBeNull();

    fireEvent.click(screen.getByLabelText("Negativeを元に戻す"));
    expect(screen.getByText("pos3")).toBeTruthy();
  });

  it("バーを隠すとパネルも隠れ、開閉の状態は保つ", async () => {
    useViewerStore.setState({ infoOpen: true });
    useViewerStore.getState().openAt(0, 5);
    render(<Viewer />);
    await screen.findByText("pos1");

    fireEvent.click(screen.getByLabelText("情報"));
    expect(useViewerStore.getState().infoOpen).toBe(false);
    fireEvent.click(screen.getByLabelText("情報"));

    useViewerStore.setState({ chromeVisible: false });
    await vi.waitFor(() => expect(screen.queryByText("pos1")).toBeNull());
    expect(useViewerStore.getState().infoOpen).toBe(true);
  });

  it("コピーで表示中のテキストを書き込み、ボタンに結果を出す", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    useViewerStore.setState({ infoOpen: true });
    useViewerStore.getState().openAt(0, 5);
    render(<Viewer />);
    await screen.findByText("pos1");

    fireEvent.click(screen.getByLabelText("Promptをコピー"));
    expect(await screen.findByText("コピー済み")).toBeTruthy();
    expect(writeText).toHaveBeenCalledWith("pos1");
    vi.unstubAllGlobals();
  });
});

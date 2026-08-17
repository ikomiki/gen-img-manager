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
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});

afterEach(() => vi.restoreAllMocks());

describe("Viewer のキーボード操作", () => {
  it("→ で次へ、← で前へ", () => {
    useViewerStore.getState().openAt(2, 5);
    render(<Viewer />);

    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(useViewerStore.getState().pos).toBe(3);

    fireEvent.keyDown(document, { key: "ArrowLeft" });
    expect(useViewerStore.getState().pos).toBe(2);
  });

  it("Space で再生と停止を切り替える", () => {
    useViewerStore.getState().openAt(0, 5);
    render(<Viewer />);

    fireEvent.keyDown(document, { key: " " });
    expect(useViewerStore.getState().playing).toBe(true);

    fireEvent.keyDown(document, { key: " " });
    expect(useViewerStore.getState().playing).toBe(false);
  });

  it("Escape で閉じる", () => {
    useViewerStore.getState().openAt(0, 5);
    render(<Viewer />);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(useViewerStore.getState().open).toBe(false);
  });

  it("修飾キー付きは無視する", () => {
    useViewerStore.getState().openAt(2, 5);
    render(<Viewer />);

    fireEvent.keyDown(document, { key: "ArrowRight", metaKey: true });
    fireEvent.keyDown(document, { key: "ArrowRight", shiftKey: true });
    expect(useViewerStore.getState().pos).toBe(2);
  });

  it("閉じているときはキーを奪わない", () => {
    render(<Viewer />);
    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(useViewerStore.getState().open).toBe(false);
    expect(useViewerStore.getState().pos).toBe(0);
  });

  it("F はフルスクリーンを試みるが、使えない環境でも落ちない", () => {
    useViewerStore.getState().openAt(0, 5);
    render(<Viewer />);

    // jsdom は Fullscreen API を実装していない。例外にならないことだけを見る。
    expect(() => fireEvent.keyDown(document, { key: "f" })).not.toThrow();
  });

  it("スライドショー設定が開いている間はキーを奪わない", () => {
    useViewerStore.getState().openAt(2, 5);
    render(<Viewer />);

    fireEvent.click(screen.getByLabelText("スライドショー"));
    fireEvent.keyDown(document, { key: "ArrowRight" });

    expect(useViewerStore.getState().pos).toBe(2);
    expect(useViewerStore.getState().open).toBe(true);
  });

  it("スライドショー設定を開いた状態で Escape を押すと、シートだけが閉じてビューアは開いたままになる", () => {
    useViewerStore.getState().openAt(2, 5);
    render(<Viewer />);

    fireEvent.click(screen.getByLabelText("スライドショー"));
    expect(screen.queryByRole("dialog", { name: "スライドショー" })).not.toBeNull();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: "スライドショー" })).toBeNull();
    expect(useViewerStore.getState().open).toBe(true);
  });
});

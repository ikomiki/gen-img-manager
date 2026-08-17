import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ImageGrid } from "./ImageGrid";
import { useQueryStore } from "../store/useQueryStore";
import { useViewerStore } from "../store/useViewerStore";
import * as imagesApi from "../api/images";
import type { ImageDto } from "../api/images";

function rows(count: number): ImageDto[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    filename: `f${i + 1}.png`,
    width: 512,
    height: 768,
    rating: null,
    created_at: 1000,
    modified_at: 1000,
    source_tool: "a1111",
    model: null,
  }));
}

beforeEach(() => {
  // jsdom には ResizeObserver がない。clientWidth は 0 のままなので columns=1 経路になる。
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  // @tanstack/react-virtual はスクロール要素の offsetHeight が 0 だと可視範囲を計算できず、
  // getVirtualItems() が常に空になる。jsdom はレイアウトしないので明示的に高さを与える。
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    value: 500,
  });
  vi.spyOn(imagesApi, "listImages").mockResolvedValue([]);
  useQueryStore.setState({ results: [], exhausted: true, error: null });
  useViewerStore.setState({ open: false, order: [], pos: 0 });
});

afterEach(() => vi.restoreAllMocks());

describe("ImageGrid", () => {
  it("results があればサムネイルが描画される", () => {
    useQueryStore.setState({ results: rows(3), exhausted: true, error: null });
    render(<ImageGrid />);
    expect(screen.getAllByRole("img")).toHaveLength(3);
  });

  it("error があっても results が空でなければグリッドが残る", () => {
    useQueryStore.setState({ results: rows(3), exhausted: true, error: "network error" });
    render(<ImageGrid />);
    expect(screen.getAllByRole("img")).toHaveLength(3);
    expect(screen.getByText("再試行")).toBeTruthy();
  });

  it("error があり results が空なら全面のエラー表示になる", () => {
    useQueryStore.setState({ results: [], exhausted: true, error: "network error" });
    render(<ImageGrid />);
    expect(screen.queryAllByRole("img")).toHaveLength(0);
    expect(screen.getByText(/読み込みに失敗しました/)).toBeTruthy();
  });

  it("サムネイルを押すとビューアが開く", () => {
    useQueryStore.setState({ results: rows(3), total: 3, exhausted: true, error: null });
    render(<ImageGrid />);

    fireEvent.click(screen.getAllByRole("button")[0]);
    expect(useViewerStore.getState().open).toBe(true);
    expect(useViewerStore.getState().order[useViewerStore.getState().pos]).toBe(0);
  });
});

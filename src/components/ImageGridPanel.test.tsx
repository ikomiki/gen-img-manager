import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { render, act, fireEvent } from "@testing-library/react";
import { ImageGridPanel } from "./ImageGridPanel";
import { useQueryStore } from "../store/useQueryStore";
import { useViewerStore } from "../store/useViewerStore";
import type { ImageRow } from "../types";

vi.mock("../api/images");
vi.mock("../api/slideshow");
vi.mock("../api/prefs");

// ResizeObserver は jsdom に無いのでモックし、コールバックを手動発火できるようにする。
let roCallbacks: Array<(entries: unknown) => void> = [];
class MockResizeObserver {
  constructor(cb: (entries: unknown) => void) {
    roCallbacks.push(cb);
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

const rows = (n: number): ImageRow[] =>
  Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    path: `/d/${i + 1}.png`,
    filename: `${i + 1}.png`,
    thumb_path: null,
    width: 512,
    height: 512,
    pixels: 262144,
    rating: null,
    created_at: 1700000000 + i,
    modified_at: null,
    source_tool: "a1111",
    model: null,
  }));

// ResizeObserver 発火（width 確定）をシミュレートする。rect は virtualizer 側の
// オブザーバも壊さないよう一通りの値を入れる。
function fireResize(width: number) {
  const rect = {
    width,
    height: 600,
    top: 0,
    left: 0,
    right: width,
    bottom: 600,
    x: 0,
    y: 0,
  };
  const el = document.querySelector(".image-grid");
  act(() => {
    roCallbacks.forEach((cb) => {
      try {
        cb([{ contentRect: rect, target: el }]);
      } catch {
        /* virtualizer 側オブザーバの形式差は無視 */
      }
    });
  });
}

beforeAll(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = MockResizeObserver;
});

beforeEach(() => {
  roCallbacks = [];
  useViewerStore.setState({ selection: new Set<number>(), selectedIndex: -1, anchorIndex: -1 });
  useQueryStore.setState({ results: rows(20), total: 20 });
});

describe("ImageGridPanel レイアウト安定性（真っ白バグの回帰防止）", () => {
  it("width 確定の再レンダーで .image-grid が同一 DOM ノードのまま（再マウントしない）", () => {
    const { container } = render(<ImageGridPanel />);
    const before = container.querySelector(".image-grid");
    expect(before).toBeTruthy();
    // 初期 width 0 → ResizeObserver 発火で width 800 確定 → 再レンダー。
    fireResize(800);
    const after = container.querySelector(".image-grid");
    // 早期 return で別ツリーを返す実装だと、ここで .image-grid が再マウントされ別ノードになる
    // （= ResizeObserver が旧要素を監視し続け width=0 に陥り真っ白になる）。
    expect(after).toBe(before);
  });

  it("選択バー出現でも .image-grid が同一 DOM ノードのまま", () => {
    const { container } = render(<ImageGridPanel />);
    fireResize(800);
    const before = container.querySelector(".image-grid");
    // 複数選択にして選択バーを出現させる。
    act(() => {
      useViewerStore.setState({ selection: new Set<number>([0, 1]), selectedIndex: 1, anchorIndex: 0 });
    });
    const after = container.querySelector(".image-grid");
    expect(after).toBe(before);
  });

  it("常に .image-grid を単一要素で返す（width 0 でも早期 return で消えない）", () => {
    const { container } = render(<ImageGridPanel />);
    // width 0（ResizeObserver 未発火）でも .image-grid は存在する。
    expect(container.querySelectorAll(".image-grid").length).toBe(1);
  });
});

describe("選択バー: 選択解除ボタンと Esc の挙動差", () => {
  function clickClearButton(container: HTMLElement) {
    const btn = [
      ...container.querySelectorAll<HTMLButtonElement>(".selection-bar button"),
    ].find((b) => b.textContent === "選択解除");
    expect(btn, "選択解除ボタンが見つからない").toBeTruthy();
    act(() => {
      fireEvent.click(btn!);
    });
  }

  it("選択解除ボタンは選択を 0 件にする（アクティブも残さない）", () => {
    const { container } = render(<ImageGridPanel />);
    fireResize(800);
    act(() => {
      useViewerStore.setState({
        selection: new Set<number>([0, 1, 2]),
        selectedIndex: 2,
        anchorIndex: 0,
      });
    });
    clickClearButton(container);
    expect(useViewerStore.getState().selection.size).toBe(0);
    expect(useViewerStore.getState().selectedIndex).toBe(-1);
  });

  it("Esc は単一選択へ戻す（アクティブ 1 件を残す）", () => {
    render(<ImageGridPanel />);
    fireResize(800);
    act(() => {
      useViewerStore.setState({
        selection: new Set<number>([0, 1, 2]),
        selectedIndex: 2,
        anchorIndex: 0,
      });
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(useViewerStore.getState().selection.size).toBe(1);
    expect(useViewerStore.getState().selection.has(2)).toBe(true);
  });
});

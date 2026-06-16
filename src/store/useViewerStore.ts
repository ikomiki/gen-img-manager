import { create } from "zustand";
import type { ZoomMode } from "../types";
import { useQueryStore, setOnResultsReplaced } from "./useQueryStore";
import { syncZoomMenu, setSetting, getSetting } from "../api/prefs";
import { serializeZoom, parseZoom } from "../util/zoomSetting";
import { nextZoomMode } from "../util/zoomCycle";
import { rangeSet, toggleInSet, allIndices } from "../util/selection";

const MIN_SCALE = 0.1;
const MAX_SCALE = 10;

interface ViewerState {
  isOpen: boolean;
  /** ビューアで現在表示中の画像（useQueryStore.results のインデックス）。 */
  index: number;
  /** グリッドでの選択ハイライト位置（Enterでこのインデックスを open する）。 */
  selectedIndex: number;
  /** 複数選択集合（results のインデックス）。単一選択時は selectedIndex のみを含む。 */
  selection: Set<number>;
  /** Shift 範囲選択の起点インデックス。未設定は -1。 */
  anchorIndex: number;
  zoomMode: ZoomMode;
  scale: number;
  /** ビューアのメタデータサイドバーを開いているか。 */
  metaOpen: boolean;
  /** prompt/negative を整形表示するか（空行・カンマだけの行・前後空白を除去）。 */
  normalizePrompt: boolean;
  open: (index: number) => void;
  close: () => void;
  next: () => void;
  prev: () => void;
  select: (index: number) => void;
  selectSingle: (index: number) => void;
  toggleSelect: (index: number) => void;
  selectRange: (index: number) => void;
  selectAll: (count: number) => void;
  clearSelection: () => void;
  resetSelection: (index: number) => void;
  setZoomMode: (m: ZoomMode) => void;
  zoomBy: (factor: number) => void;
  cycleZoom: () => void;
  first: () => void;
  last: () => void;
  goTo: (index: number) => void;
  toggleMeta: () => void;
  toggleNormalize: () => void;
  loadZoom: () => Promise<void>;
}

function resultsLength(): number {
  return useQueryStore.getState().results.length;
}

export const useViewerStore = create<ViewerState>((set, get) => ({
  isOpen: false,
  index: 0,
  selectedIndex: -1,
  selection: new Set<number>(),
  anchorIndex: -1,
  zoomMode: "fit",
  scale: 1,
  metaOpen: true,
  normalizePrompt: false,
  // 再オープン時は直前のズーム設定（zoomMode/scale）を復元する（リセットしない）。
  open: (index) => {
    set({ isOpen: true, index, selectedIndex: index });
    syncZoomMenu(get().zoomMode).catch((e) => console.error("syncZoomMenu failed:", e));
  },
  close: () => set({ isOpen: false }),
  // ナビゲーション時はズーム状態（zoomMode/scale）を維持する。
  // 新規に画像を開く（open）ときだけ fit にリセットする。
  next: () => {
    const last = Math.max(resultsLength() - 1, 0);
    set({ index: Math.min(get().index + 1, last) });
  },
  prev: () => {
    set({ index: Math.max(get().index - 1, 0) });
  },
  select: (index) => set({ selectedIndex: index }),
  // 通常クリック/矢印: 単一選択（他を解除）。
  selectSingle: (index) =>
    set({ selection: new Set([index]), selectedIndex: index, anchorIndex: index }),
  // Cmd/Ctrl+クリック: 個別トグル。
  toggleSelect: (index) =>
    set((s) => ({
      selection: toggleInSet(s.selection, index),
      selectedIndex: index,
      anchorIndex: index,
    })),
  // Shift+クリック / Shift+矢印: anchor..index を選択。
  selectRange: (index) =>
    set((s) => ({
      selection: rangeSet(s.anchorIndex < 0 ? index : s.anchorIndex, index),
      selectedIndex: index,
    })),
  // Cmd/Ctrl+A: 全選択（アクティブ/アンカーは維持）。
  selectAll: (count) => set({ selection: allIndices(count) }),
  // Esc: 単一選択に戻す（完全クリアではない）。
  clearSelection: () =>
    set((s) => ({ selection: new Set(s.selectedIndex >= 0 ? [s.selectedIndex] : []) })),
  // 削除後/総入替後にアクティブと選択を作り直す。index<0 で全解除。
  resetSelection: (index) =>
    set({
      selection: index >= 0 ? new Set([index]) : new Set(),
      selectedIndex: index,
      anchorIndex: index,
    }),
  setZoomMode: (m) => {
    set({ zoomMode: m, scale: 1 });
    syncZoomMenu(m).catch((e) => console.error("syncZoomMenu failed:", e));
    setSetting("zoom", serializeZoom(m, 1)).catch((e) =>
      console.error("setSetting(zoom) failed:", e),
    );
  },
  zoomBy: (factor) => {
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, get().scale * factor));
    set({ zoomMode: "custom", scale: next });
    syncZoomMenu("custom").catch((e) => console.error("syncZoomMenu failed:", e));
    setSetting("zoom", serializeZoom("custom", next)).catch((e) =>
      console.error("setSetting(zoom) failed:", e),
    );
  },
  cycleZoom: () => get().setZoomMode(nextZoomMode(get().zoomMode)),
  first: () => set({ index: 0 }),
  last: () => set({ index: Math.max(resultsLength() - 1, 0) }),
  goTo: (index) =>
    set({ index: Math.min(Math.max(index, 0), Math.max(resultsLength() - 1, 0)) }),
  toggleMeta: () => set({ metaOpen: !get().metaOpen }),
  toggleNormalize: () => set({ normalizePrompt: !get().normalizePrompt }),
  // 起動時に永続化されたズーム設定を復元する。不正値は無視してデフォルトのまま。
  loadZoom: async () => {
    const parsed = parseZoom(await getSetting("zoom"));
    if (parsed) {
      set({ zoomMode: parsed.mode, scale: parsed.scale });
      syncZoomMenu(parsed.mode).catch((e) => console.error("syncZoomMenu failed:", e));
    }
  },
}));

// クエリ再実行・ソート変更・フィルタ適用などで results が総入替されたら選択を解除する。
// （rateSelected/deleteSelected は results を直接更新し、このコールバックは呼ばない。）
setOnResultsReplaced(() => {
  useViewerStore.setState({ selection: new Set<number>(), selectedIndex: -1, anchorIndex: -1 });
});

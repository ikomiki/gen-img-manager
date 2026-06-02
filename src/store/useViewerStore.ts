import { create } from "zustand";
import type { ZoomMode } from "../types";
import { useQueryStore } from "./useQueryStore";
import { syncZoomMenu } from "../api/prefs";

const MIN_SCALE = 0.1;
const MAX_SCALE = 10;

interface ViewerState {
  isOpen: boolean;
  /** ビューアで現在表示中の画像（useQueryStore.results のインデックス）。 */
  index: number;
  /** グリッドでの選択ハイライト位置（Enterでこのインデックスを open する）。 */
  selectedIndex: number;
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
  setZoomMode: (m: ZoomMode) => void;
  zoomBy: (factor: number) => void;
  toggleMeta: () => void;
  toggleNormalize: () => void;
}

function resultsLength(): number {
  return useQueryStore.getState().results.length;
}

export const useViewerStore = create<ViewerState>((set, get) => ({
  isOpen: false,
  index: 0,
  selectedIndex: -1,
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
  setZoomMode: (m) => {
    set({ zoomMode: m, scale: 1 });
    syncZoomMenu(m).catch((e) => console.error("syncZoomMenu failed:", e));
  },
  zoomBy: (factor) => {
    set({
      zoomMode: "custom",
      scale: Math.min(MAX_SCALE, Math.max(MIN_SCALE, get().scale * factor)),
    });
    syncZoomMenu("custom").catch((e) => console.error("syncZoomMenu failed:", e));
  },
  toggleMeta: () => set({ metaOpen: !get().metaOpen }),
  toggleNormalize: () => set({ normalizePrompt: !get().normalizePrompt }),
}));

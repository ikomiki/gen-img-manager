import { create } from "zustand";
import type { ZoomMode } from "../types";
import { useQueryStore } from "./useQueryStore";

const MIN_SCALE = 0.1;
const MAX_SCALE = 10;

interface ViewerState {
  isOpen: boolean;
  index: number;
  selectedIndex: number;
  zoomMode: ZoomMode;
  scale: number;
  open: (index: number) => void;
  close: () => void;
  next: () => void;
  prev: () => void;
  select: (index: number) => void;
  setZoomMode: (m: ZoomMode) => void;
  zoomBy: (factor: number) => void;
}

function resultsLength(): number {
  return useQueryStore.getState().results.length;
}

export const useViewerStore = create<ViewerState>((set, get) => ({
  isOpen: false,
  index: 0,
  selectedIndex: 0,
  zoomMode: "fit",
  scale: 1,
  open: (index) =>
    set({ isOpen: true, index, selectedIndex: index, zoomMode: "fit", scale: 1 }),
  close: () => set({ isOpen: false }),
  next: () => {
    const last = Math.max(resultsLength() - 1, 0);
    set({ index: Math.min(get().index + 1, last), scale: 1 });
  },
  prev: () => {
    set({ index: Math.max(get().index - 1, 0), scale: 1 });
  },
  select: (index) => set({ selectedIndex: index }),
  setZoomMode: (m) => set({ zoomMode: m, scale: 1 }),
  zoomBy: (factor) =>
    set({
      zoomMode: "custom",
      scale: Math.min(MAX_SCALE, Math.max(MIN_SCALE, get().scale * factor)),
    }),
}));

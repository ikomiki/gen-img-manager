import { create } from "zustand";
import type { Directory, ScanProgress } from "../types";
import * as api from "../api/directories";

interface LibraryState {
  directories: Directory[];
  scanning: Record<number, ScanProgress | undefined>;
  imageCounts: Record<number, number>;
  loadDirectories: () => Promise<void>;
  addDirectory: (path: string, recursive: boolean) => Promise<void>;
  removeDirectory: (id: number) => Promise<void>;
  setDirectoryVisible: (id: number, visible: boolean) => Promise<void>;
  setScanProgress: (p: ScanProgress) => void;
  clearScanProgress: (id: number) => void;
  setImageCount: (id: number, count: number) => void;
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  directories: [],
  scanning: {},
  imageCounts: {},
  loadDirectories: async () => {
    set({ directories: await api.listDirectories() });
  },
  addDirectory: async (path, recursive) => {
    const created = await api.addDirectory(path, recursive);
    set({ directories: [...get().directories, created] });
  },
  removeDirectory: async (id) => {
    await api.removeDirectory(id);
    set({ directories: get().directories.filter((d) => d.id !== id) });
  },
  setDirectoryVisible: async (id, visible) => {
    await api.setDirectoryVisible(id, visible);
    set({
      directories: get().directories.map((d) =>
        d.id === id ? { ...d, visible } : d,
      ),
    });
  },
  setScanProgress: (p) => set({ scanning: { ...get().scanning, [p.directory_id]: p } }),
  clearScanProgress: (id) => {
    const next = { ...get().scanning };
    delete next[id];
    set({ scanning: next });
  },
  setImageCount: (id, count) => set({ imageCounts: { ...get().imageCounts, [id]: count } }),
}));

import { create } from "zustand";
import type { ImageRow, SortKey, SortDir } from "../types";
import * as imagesApi from "../api/images";
import * as prefsApi from "../api/prefs";
import * as fsApi from "../api/fs";

interface QueryState {
  query: string;
  sort: SortKey;
  dir: SortDir;
  results: ImageRow[];
  total: number;
  history: string[];
  showFilename: boolean;
  dirCollapsed: boolean;
  helpOpen: boolean;
  toast: string | null;
  toastSeq: number;
  xmpAutoExport: boolean;
  ratingMode: boolean;
  unratedOnly: boolean;
  setQuery: (q: string) => void;
  setSort: (sort: SortKey, dir: SortDir) => void;
  runQuery: () => Promise<void>;
  commitHistory: () => Promise<void>;
  loadHistory: () => Promise<void>;
  toggleShowFilename: () => Promise<void>;
  toggleDirCollapsed: () => Promise<void>;
  toggleHelp: () => void;
  closeHelp: () => void;
  setRating: (id: number, rating: number | null) => Promise<void>;
  deleteImage: (id: number, path: string) => Promise<void>;
  loadSettings: () => Promise<void>;
  showToast: (msg: string) => void;
  clearToast: () => void;
  toggleXmpAutoExport: () => Promise<void>;
  toggleRatingMode: () => Promise<void>;
  toggleUnratedOnly: () => Promise<void>;
  showCurrentFilename: boolean;
  showCurrentPosition: boolean;
  toggleShowCurrentFilename: () => Promise<void>;
  toggleShowCurrentPosition: () => Promise<void>;
}

export const useQueryStore = create<QueryState>((set, get) => ({
  query: "",
  sort: "filename",
  dir: "asc",
  results: [],
  total: 0,
  history: [],
  showFilename: true,
  dirCollapsed: false,
  helpOpen: false,
  toast: null,
  toastSeq: 0,
  xmpAutoExport: false,
  ratingMode: false,
  unratedOnly: false,
  showCurrentFilename: false,
  showCurrentPosition: false,
  setQuery: (q) => set({ query: q }),
  setSort: (sort, dir) => {
    set({ sort, dir });
    get().runQuery().catch((e) => console.error("runQuery failed:", e));
    prefsApi
      .setSetting("sort", `${sort}:${dir}`)
      .catch((e) => console.error("setSetting(sort) failed:", e));
  },
  runQuery: async () => {
    const { query, sort, dir, ratingMode, unratedOnly } = get();
    let results = await imagesApi.queryImages(query, sort, dir, -1, 0);
    if (ratingMode && unratedOnly) {
      // 「未入力のみ表示」: rating が null の画像だけに共有リストを絞り込む。
      results = results.filter((r) => r.rating == null);
    }
    set({ results, total: results.length });
    prefsApi
      .setSetting("filter_query", query)
      .catch((e) => console.error("setSetting(filter_query) failed:", e));
  },
  commitHistory: async () => {
    const q = get().query.trim();
    if (!q) return;
    await prefsApi.addFilterHistory(q);
    await get().loadHistory();
  },
  loadHistory: async () => {
    set({ history: await prefsApi.listFilterHistory() });
  },
  toggleShowFilename: async () => {
    const next = !get().showFilename;
    set({ showFilename: next });
    await prefsApi.setSetting("show_filename", String(next));
    prefsApi.syncFilenameMenu(next).catch((e) => console.error("syncFilenameMenu failed:", e));
  },
  toggleDirCollapsed: async () => {
    const next = !get().dirCollapsed;
    set({ dirCollapsed: next });
    await prefsApi.setSetting("dir_collapsed", String(next));
  },
  toggleHelp: () => set({ helpOpen: !get().helpOpen }),
  closeHelp: () => set({ helpOpen: false }),
  setRating: async (id, rating) => {
    await imagesApi.setRating(id, rating);
    const { xmpAutoExport, ratingMode, unratedOnly } = get();
    if (xmpAutoExport) {
      const row = get().results.find((r) => r.id === id);
      if (row) {
        try {
          await fsApi.writeXmpRating(row.path, rating);
        } catch (e) {
          console.error("XMP書き出しに失敗しました:", e);
          get().showToast("XMPの書き出しに失敗しました");
        }
      }
    }
    if (ratingMode && unratedOnly && rating !== null) {
      // 未入力のみ表示中に評価が付いた画像はリストから除去（=自動送りを兼ねる）。
      const next = get().results.filter((r) => r.id !== id);
      set({ results: next, total: next.length });
    } else {
      set({ results: get().results.map((r) => (r.id === id ? { ...r, rating } : r)) });
    }
  },
  deleteImage: async (id, path) => {
    await fsApi.deleteImage(id, path);
    const next = get().results.filter((r) => r.id !== id);
    set({ results: next, total: next.length });
    get().showToast("ゴミ箱に移動しました");
  },
  loadSettings: async () => {
    const [sortRaw, showRaw, queryRaw, dirCollapsedRaw, xmpAutoRaw, unratedOnlyRaw, showCurFnameRaw, showCurPosRaw] = await Promise.all([
      prefsApi.getSetting("sort"),
      prefsApi.getSetting("show_filename"),
      prefsApi.getSetting("filter_query"),
      prefsApi.getSetting("dir_collapsed"),
      prefsApi.getSetting("xmp_auto"),
      prefsApi.getSetting("unrated_only"),
      prefsApi.getSetting("show_current_filename"),
      prefsApi.getSetting("show_current_position"),
    ]);
    if (sortRaw) {
      const [sort, dir] = sortRaw.split(":");
      set({ sort: sort as SortKey, dir: (dir || "asc") as SortDir });
    }
    if (showRaw !== null) {
      const on = showRaw !== "false";
      set({ showFilename: on });
      prefsApi.syncFilenameMenu(on).catch((e) => console.error("syncFilenameMenu failed:", e));
    }
    if (queryRaw !== null) {
      set({ query: queryRaw });
    }
    if (dirCollapsedRaw !== null) {
      set({ dirCollapsed: dirCollapsedRaw === "true" });
    }
    if (xmpAutoRaw !== null) {
      set({ xmpAutoExport: xmpAutoRaw === "true" });
    }
    if (unratedOnlyRaw !== null) {
      set({ unratedOnly: unratedOnlyRaw === "true" });
      prefsApi.syncUnratedOnlyMenu(unratedOnlyRaw === "true").catch(() => {});
    }
    if (showCurFnameRaw !== null) {
      const on = showCurFnameRaw === "true";
      set({ showCurrentFilename: on });
      prefsApi.syncCurrentFilenameMenu(on).catch(() => {});
    }
    if (showCurPosRaw !== null) {
      const on = showCurPosRaw === "true";
      set({ showCurrentPosition: on });
      prefsApi.syncCurrentPositionMenu(on).catch(() => {});
    }
  },
  showToast: (msg) => set({ toast: msg, toastSeq: get().toastSeq + 1 }),
  clearToast: () => set({ toast: null }),
  toggleXmpAutoExport: async () => {
    const next = !get().xmpAutoExport;
    set({ xmpAutoExport: next });
    await prefsApi.setSetting("xmp_auto", String(next));
  },
  toggleRatingMode: async () => {
    const next = !get().ratingMode;
    set({ ratingMode: next });
    // 非永続。メニューのチェック更新＋未入力項目の有効/無効を同期し、フィルタを反映する。
    prefsApi.syncRatingModeMenu(next).catch((e) => console.error("syncRatingModeMenu failed:", e));
    await get().runQuery();
  },
  toggleUnratedOnly: async () => {
    const next = !get().unratedOnly;
    set({ unratedOnly: next });
    await prefsApi.setSetting("unrated_only", String(next));
    prefsApi.syncUnratedOnlyMenu(next).catch((e) => console.error("syncUnratedOnlyMenu failed:", e));
    await get().runQuery();
  },
  toggleShowCurrentFilename: async () => {
    const next = !get().showCurrentFilename;
    set({ showCurrentFilename: next });
    await prefsApi.setSetting("show_current_filename", String(next));
    prefsApi.syncCurrentFilenameMenu(next).catch((e) => console.error("syncCurrentFilenameMenu failed:", e));
  },
  toggleShowCurrentPosition: async () => {
    const next = !get().showCurrentPosition;
    set({ showCurrentPosition: next });
    await prefsApi.setSetting("show_current_position", String(next));
    prefsApi.syncCurrentPositionMenu(next).catch((e) => console.error("syncCurrentPositionMenu failed:", e));
  },
}));

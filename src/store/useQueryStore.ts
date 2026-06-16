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
  rateSelected: (ids: number[], rating: number | null) => Promise<void>;
  deleteSelected: (items: { id: number; path: string }[]) => Promise<void>;
  loadSettings: () => Promise<void>;
  showToast: (msg: string) => void;
  clearToast: () => void;
  toggleXmpAutoExport: () => Promise<void>;
  toggleRatingMode: () => Promise<void>;
  toggleUnratedOnly: () => Promise<void>;
  showCurrentFilename: boolean;
  showCurrentPosition: boolean;
  showCurrentRating: boolean;
  toggleShowCurrentFilename: () => Promise<void>;
  toggleShowCurrentPosition: () => Promise<void>;
  toggleShowCurrentRating: () => Promise<void>;
}

// useQueryStore → useViewerStore の循環 import を避けるため、クエリ総入替時の
// 選択クリアはコールバック経由で useViewerStore 側から登録する。
let onResultsReplaced: (() => void) | null = null;
export function setOnResultsReplaced(cb: () => void): void {
  onResultsReplaced = cb;
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
  showCurrentRating: false,
  setQuery: (q) => set({ query: q }),
  setSort: (sort, dir) => {
    set({ sort, dir });
    get().runQuery().catch((e) => console.error("runQuery failed:", e));
    prefsApi
      .setSetting("sort", `${sort}:${dir}`)
      .catch((e) => console.error("setSetting(sort) failed:", e));
  },
  runQuery: async () => {
    const { query, sort, dir } = get();
    const results = await imagesApi.queryImages(query, sort, dir, -1, 0);
    set({ results, total: results.length });
    onResultsReplaced?.();
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
    const { xmpAutoExport } = get();
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
    // ratingMode/unratedOnly でもリストからは除去しない（送り制御は呼び出し側で行う）。
    set({ results: get().results.map((r) => (r.id === id ? { ...r, rating } : r)) });
  },
  deleteImage: async (id, path) => {
    await fsApi.deleteImage(id, path);
    const next = get().results.filter((r) => r.id !== id);
    set({ results: next, total: next.length });
    get().showToast("ゴミ箱に移動しました");
  },
  rateSelected: async (ids, rating) => {
    if (ids.length === 0) return;
    await imagesApi.setRatings(ids, rating);
    const idSet = new Set(ids);
    const { xmpAutoExport } = get();
    if (xmpAutoExport) {
      const targets = get().results.filter((r) => idSet.has(r.id));
      let failed = 0;
      for (const row of targets) {
        try {
          await fsApi.writeXmpRating(row.path, rating);
        } catch (e) {
          console.error("XMP書き出しに失敗しました:", e);
          failed++;
        }
      }
      if (failed > 0) get().showToast(`XMPの書き出しに${failed}件失敗しました`);
    }
    set({ results: get().results.map((r) => (idSet.has(r.id) ? { ...r, rating } : r)) });
    get().showToast(`${ids.length}件のレーティングを設定しました`);
  },
  deleteSelected: async (items) => {
    if (items.length === 0) return;
    const res = await fsApi.deleteImages(items);
    const failedIds = new Set(res.failed.map((f) => f.id));
    const targetIds = new Set(items.map((i) => i.id));
    // 成功した（=失敗集合に無い）対象だけを除去する。
    const next = get().results.filter((r) => !targetIds.has(r.id) || failedIds.has(r.id));
    set({ results: next, total: next.length });
    if (res.failed.length > 0) {
      console.error("一部の削除に失敗しました:", res.failed);
      get().showToast(`${res.succeeded}件をゴミ箱に移動（${res.failed.length}件失敗）`);
    } else {
      get().showToast(`${res.succeeded}件をゴミ箱に移動しました`);
    }
  },
  loadSettings: async () => {
    const [sortRaw, showRaw, queryRaw, dirCollapsedRaw, xmpAutoRaw, unratedOnlyRaw, showCurFnameRaw, showCurPosRaw, showCurRatingRaw] = await Promise.all([
      prefsApi.getSetting("sort"),
      prefsApi.getSetting("show_filename"),
      prefsApi.getSetting("filter_query"),
      prefsApi.getSetting("dir_collapsed"),
      prefsApi.getSetting("xmp_auto"),
      prefsApi.getSetting("unrated_only"),
      prefsApi.getSetting("show_current_filename"),
      prefsApi.getSetting("show_current_position"),
      prefsApi.getSetting("show_current_rating"),
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
      const on = xmpAutoRaw === "true";
      set({ xmpAutoExport: on });
      prefsApi.syncXmpAutoMenu(on).catch(() => {});
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
    if (showCurRatingRaw !== null) {
      const on = showCurRatingRaw === "true";
      set({ showCurrentRating: on });
      prefsApi.syncCurrentRatingMenu(on).catch(() => {});
    }
  },
  showToast: (msg) => set({ toast: msg, toastSeq: get().toastSeq + 1 }),
  clearToast: () => set({ toast: null }),
  toggleXmpAutoExport: async () => {
    const next = !get().xmpAutoExport;
    set({ xmpAutoExport: next });
    await prefsApi.setSetting("xmp_auto", String(next));
    prefsApi.syncXmpAutoMenu(next).catch((e) => console.error("syncXmpAutoMenu failed:", e));
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
  toggleShowCurrentRating: async () => {
    const next = !get().showCurrentRating;
    set({ showCurrentRating: next });
    await prefsApi.setSetting("show_current_rating", String(next));
    prefsApi.syncCurrentRatingMenu(next).catch((e) => console.error("syncCurrentRatingMenu failed:", e));
  },
}));

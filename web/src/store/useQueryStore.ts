import { create } from "zustand";
import type { SortKey, SortDir } from "@gim/shared/types";
import { recordHistory } from "@gim/shared/history";
import * as imagesApi from "../api/images";
import type { ImageDto } from "../api/images";
import { loadPrefs, savePrefs, HISTORY_MAX } from "../storage";

export const PAGE_SIZE = 200;

interface QueryState {
  query: string;
  sort: SortKey;
  dir: SortDir;
  dirs: number[] | null;
  results: ImageDto[];
  total: number;
  loading: boolean;
  exhausted: boolean;
  error: string | null;
  /** 実行中のクエリの世代。古い応答が新しい結果を上書きするのを防ぐ。 */
  seq: number;
  history: string[];

  init: () => Promise<void>;
  setQuery: (q: string) => void;
  commitQuery: () => Promise<void>;
  setSort: (sort: SortKey, dir: SortDir) => Promise<void>;
  setDirs: (dirs: number[] | null) => Promise<void>;
  runQuery: () => Promise<void>;
  loadMore: () => Promise<void>;
}

export const useQueryStore = create<QueryState>((set, get) => ({
  query: "",
  sort: "created",
  dir: "desc",
  dirs: null,
  results: [],
  total: 0,
  loading: false,
  exhausted: false,
  error: null,
  seq: 0,
  history: [],

  init: async () => {
    const p = loadPrefs();
    set({ query: p.query, sort: p.sort, dir: p.dir, dirs: p.dirs, history: p.history });
    await get().runQuery();
  },

  // 打鍵ごとに保存すると重い。保存は runQuery 実行時（Enter・履歴選択等）にまとめて行う。
  setQuery: (q) => set({ query: q }),

  commitQuery: async () => {
    const { query, history } = get();
    const next = recordHistory(history, query, HISTORY_MAX);
    set({ history: next });
    savePrefs({ history: next });
    await get().runQuery();
  },

  setSort: async (sort, dir) => {
    set({ sort, dir });
    savePrefs({ sort, dir });
    await get().runQuery();
  },

  setDirs: async (dirs) => {
    set({ dirs });
    savePrefs({ dirs });
    await get().runQuery();
  },

  runQuery: async () => {
    const seq = get().seq + 1;
    set({ seq, loading: true, error: null });
    const { query, sort, dir, dirs } = get();
    const params = { q: query, sort, dir, dirs };
    try {
      const [rows, count] = await Promise.all([
        imagesApi.listImages({ ...params, limit: PAGE_SIZE, offset: 0 }),
        imagesApi.countImages(params),
      ]);
      if (get().seq !== seq) return;
      set({
        results: rows,
        total: count.total,
        exhausted: rows.length >= count.total,
        loading: false,
      });
      savePrefs({ query });
    } catch (e) {
      if (get().seq !== seq) return;
      set({
        results: [],
        total: 0,
        exhausted: true,
        loading: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  },

  loadMore: async () => {
    const { loading, exhausted, results, query, sort, dir, dirs, total, seq } = get();
    if (loading || exhausted) return;
    set({ loading: true });
    try {
      const rows = await imagesApi.listImages({
        q: query,
        sort,
        dir,
        dirs,
        limit: PAGE_SIZE,
        offset: results.length,
      });
      // runQuery に追い越されていたら、その runQuery が最終的に loading: false を書く。
      if (get().seq !== seq) return;
      const next = [...results, ...rows];
      set({
        results: next,
        exhausted: rows.length === 0 || next.length >= total,
        loading: false,
      });
    } catch (e) {
      if (get().seq !== seq) return;
      set({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  },
}));

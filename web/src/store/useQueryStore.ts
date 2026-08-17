import { create } from "zustand";
import type { SortKey, SortDir } from "@gim/shared/types";
import * as imagesApi from "../api/images";
import type { ImageDto } from "../api/images";
import { loadPrefs, savePrefs } from "../storage";

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

  init: () => Promise<void>;
  setQuery: (q: string) => void;
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

  init: async () => {
    const p = loadPrefs();
    set({ query: p.query, sort: p.sort, dir: p.dir, dirs: p.dirs });
    await get().runQuery();
  },

  setQuery: (q) => set({ query: q }),

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
    const { query, sort, dir, dirs } = get();
    set({ loading: true, error: null });
    const params = { q: query, sort, dir, dirs };
    try {
      const [rows, count] = await Promise.all([
        imagesApi.listImages({ ...params, limit: PAGE_SIZE, offset: 0 }),
        imagesApi.countImages(params),
      ]);
      set({
        results: rows,
        total: count.total,
        exhausted: rows.length >= count.total,
        loading: false,
      });
      savePrefs({ query });
    } catch (e) {
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
    const { loading, exhausted, results, query, sort, dir, dirs, total } = get();
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
      const next = [...results, ...rows];
      set({
        results: next,
        exhausted: rows.length === 0 || next.length >= total,
        loading: false,
      });
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  },
}));

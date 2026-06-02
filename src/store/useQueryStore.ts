import { create } from "zustand";
import type { ImageRow, SortKey, SortDir } from "../types";
import * as imagesApi from "../api/images";
import * as prefsApi from "../api/prefs";

const PAGE = 200;

interface QueryState {
  query: string;
  sort: SortKey;
  dir: SortDir;
  results: ImageRow[];
  total: number;
  history: string[];
  showFilename: boolean;
  setQuery: (q: string) => void;
  setSort: (sort: SortKey, dir: SortDir) => void;
  runQuery: () => Promise<void>;
  commitHistory: () => Promise<void>;
  loadHistory: () => Promise<void>;
  toggleShowFilename: () => Promise<void>;
  loadSettings: () => Promise<void>;
}

export const useQueryStore = create<QueryState>((set, get) => ({
  query: "",
  sort: "filename",
  dir: "asc",
  results: [],
  total: 0,
  history: [],
  showFilename: true,
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
    const [results, total] = await Promise.all([
      imagesApi.queryImages(query, sort, dir, PAGE, 0),
      imagesApi.countQuery(query),
    ]);
    set({ results, total });
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
  },
  loadSettings: async () => {
    const [sortRaw, showRaw] = await Promise.all([
      prefsApi.getSetting("sort"),
      prefsApi.getSetting("show_filename"),
    ]);
    if (sortRaw) {
      const [sort, dir] = sortRaw.split(":");
      set({ sort: sort as SortKey, dir: (dir || "asc") as SortDir });
    }
    if (showRaw !== null) {
      set({ showFilename: showRaw !== "false" });
    }
  },
}));

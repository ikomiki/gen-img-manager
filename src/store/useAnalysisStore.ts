import { create } from "zustand";
import type { TagFreq, LiftRow, TagRatingAnalysis, AnalysisParams } from "../types";
import * as api from "../api/analysis";
import { useQueryStore } from "./useQueryStore";

type Tab = "frequency" | "cause" | "excluded";
type ScopeMode = "all" | "filter";

interface AnalysisState {
  open: boolean;
  tab: Tab;
  scopeMode: ScopeMode;
  applyExclusion: boolean;
  minRatedCount: number;
  priorWeight: number;
  freq: TagFreq[];
  freqSort: "count" | "name";
  cause: LiftRow[];
  causeDirection: "high" | "low";
  selectedTag: { tagId: number; name: string } | null;
  tagAnalysis: TagRatingAnalysis | null;
  excluded: string[];
  nameFilter: string;
  // derived
  scopeArg: () => string | undefined;
  params: () => AnalysisParams;
  // actions
  toggleOpen: () => void;
  setOpen: (v: boolean) => void;
  setTab: (t: Tab) => void;
  setScopeMode: (m: ScopeMode) => void;
  toggleExclusion: () => void;
  setNameFilter: (s: string) => void;
  setFreqSort: (s: "count" | "name") => void;
  setCauseDirection: (d: "high" | "low") => void;
  setMinRatedCount: (n: number) => void;
  setPriorWeight: (n: number) => void;
  loadFrequency: () => Promise<void>;
  loadCause: () => Promise<void>;
  selectTag: (tagId: number, name: string) => void;
  reloadSelectedTag: () => Promise<void>;
  clearSelectedTag: () => void;
  loadExcluded: () => Promise<void>;
  setExcluded: (text: string) => Promise<void>;
}

export const useAnalysisStore = create<AnalysisState>((set, get) => ({
  open: false,
  tab: "frequency",
  scopeMode: "filter",
  applyExclusion: true,
  minRatedCount: 10,
  priorWeight: 10,
  freq: [],
  freqSort: "count",
  cause: [],
  causeDirection: "high",
  selectedTag: null,
  tagAnalysis: null,
  excluded: [],
  nameFilter: "",

  scopeArg: () =>
    get().scopeMode === "filter" ? useQueryStore.getState().query : undefined,
  params: () => ({
    applyExclusion: get().applyExclusion,
    minRatedCount: get().minRatedCount,
    priorWeight: get().priorWeight,
  }),

  toggleOpen: () => set((s) => ({ open: !s.open })),
  setOpen: (v) => set({ open: v }),
  setTab: (t) => set({ tab: t }),
  setScopeMode: (m) => set({ scopeMode: m }),
  toggleExclusion: () => set((s) => ({ applyExclusion: !s.applyExclusion })),
  setNameFilter: (s) => set({ nameFilter: s }),
  setFreqSort: (s) => set({ freqSort: s }),
  setCauseDirection: (d) => set({ causeDirection: d }),
  setMinRatedCount: (n) => set({ minRatedCount: n }),
  setPriorWeight: (n) => set({ priorWeight: n }),

  loadFrequency: async () => {
    const { scopeArg, params, nameFilter, freqSort } = get();
    const freq = await api.tagFrequency(scopeArg(), params(), nameFilter || undefined, freqSort, 500, 0);
    set({ freq });
  },
  loadCause: async () => {
    const { scopeArg, params, causeDirection, nameFilter } = get();
    const cause = await api.ratingLift(scopeArg(), params(), causeDirection, nameFilter || undefined, 100);
    set({ cause });
  },
  // 選択のみ設定し、取得は TagRatingAnalysis の effect（reloadSelectedTag）に委ねる。
  selectTag: (tagId, name) => set({ selectedTag: { tagId, name }, tagAnalysis: null }),
  reloadSelectedTag: async () => {
    const { selectedTag, scopeArg, params } = get();
    if (!selectedTag) return;
    const tagAnalysis = await api.tagRating(scopeArg(), params(), selectedTag.tagId);
    set({ tagAnalysis });
  },
  clearSelectedTag: () => set({ selectedTag: null, tagAnalysis: null }),
  loadExcluded: async () => {
    set({ excluded: await api.listExcluded() });
  },
  setExcluded: async (text) => {
    await api.setExcluded(text.split("\n"));
    await get().loadExcluded();
  },
}));

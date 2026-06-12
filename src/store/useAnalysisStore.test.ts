import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../api/analysis", () => ({
  tagFrequency: vi.fn(async () => [{ tag_id: 1, name: "forest", image_count: 3 }]),
  ratingLift: vi.fn(async () => []),
  tagRating: vi.fn(async () => ({ has: [], without: [], has_avg: null, without_avg: null })),
  listExcluded: vi.fn(async () => ["masterpiece"]),
  addExcluded: vi.fn(async () => {}),
  removeExcluded: vi.fn(async () => {}),
}));

import { useAnalysisStore } from "./useAnalysisStore";
import { useQueryStore } from "./useQueryStore";
import * as api from "../api/analysis";

beforeEach(() => {
  useAnalysisStore.setState({
    open: false,
    tab: "frequency",
    scopeMode: "all",
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
  });
  vi.clearAllMocks();
});

describe("useAnalysisStore", () => {
  it("scopeArg() は all のとき undefined、filter のとき現在クエリ", () => {
    useQueryStore.setState({ query: "rating:>=4" });
    expect(useAnalysisStore.getState().scopeArg()).toBeUndefined();
    useAnalysisStore.setState({ scopeMode: "filter" });
    expect(useAnalysisStore.getState().scopeArg()).toBe("rating:>=4");
  });

  it("toggleExclusion は applyExclusion を反転する", () => {
    useAnalysisStore.getState().toggleExclusion();
    expect(useAnalysisStore.getState().applyExclusion).toBe(false);
  });

  it("loadFrequency は API 結果を freq に格納する", async () => {
    await useAnalysisStore.getState().loadFrequency();
    expect(useAnalysisStore.getState().freq).toEqual([{ tag_id: 1, name: "forest", image_count: 3 }]);
    expect(api.tagFrequency).toHaveBeenCalledOnce();
  });

  it("toggleOpen は open を反転する", () => {
    useAnalysisStore.getState().toggleOpen();
    expect(useAnalysisStore.getState().open).toBe(true);
  });
});

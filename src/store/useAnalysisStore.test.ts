import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../api/analysis", () => ({
  tagFrequency: vi.fn(async () => [{ tag_id: 1, name: "forest", image_count: 3 }]),
  ratingLift: vi.fn(async () => []),
  tagRating: vi.fn(async () => ({ has: [], without: [], has_avg: null, without_avg: null })),
  listExcluded: vi.fn(async () => ["masterpiece"]),
  setExcluded: vi.fn(async () => {}),
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

  it("loadCause は nameFilter を API へ渡す（空なら undefined）", async () => {
    useAnalysisStore.setState({ nameFilter: "" });
    await useAnalysisStore.getState().loadCause();
    expect(api.ratingLift).toHaveBeenLastCalledWith(undefined, expect.anything(), "high", undefined, 100);
    useAnalysisStore.setState({ nameFilter: "hair" });
    await useAnalysisStore.getState().loadCause();
    expect(api.ratingLift).toHaveBeenLastCalledWith(undefined, expect.anything(), "high", "hair", 100);
  });

  it("setExcluded は改行で分割して API へ渡し、再読込する", async () => {
    await useAnalysisStore.getState().setExcluded("# comment\nmasterpiece\nscore 9");
    expect(api.setExcluded).toHaveBeenCalledWith(["# comment", "masterpiece", "score 9"]);
    expect(api.listExcluded).toHaveBeenCalled();
  });

  it("selectTag は同期的に選択を設定し tagAnalysis をクリアする", () => {
    useAnalysisStore.setState({ tagAnalysis: { has: [], without: [], has_avg: 3, without_avg: 2 } });
    useAnalysisStore.getState().selectTag(7, "forest");
    expect(useAnalysisStore.getState().selectedTag).toEqual({ tagId: 7, name: "forest" });
    expect(useAnalysisStore.getState().tagAnalysis).toBeNull();
  });
});

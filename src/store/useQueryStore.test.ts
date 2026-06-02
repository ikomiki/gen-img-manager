import { describe, it, expect, vi, beforeEach } from "vitest";
import { useQueryStore } from "./useQueryStore";
import * as imagesApi from "../api/images";
import * as prefsApi from "../api/prefs";
import type { ImageRow } from "../types";

vi.mock("../api/images");
vi.mock("../api/prefs");

const row = (id: number, filename: string): ImageRow => ({
  id, path: `/d/${filename}`, filename, thumb_path: `/t/${id}.webp`,
  width: 100, height: 100, pixels: 10000, rating: null,
  created_at: 1, modified_at: 1, source_tool: "a1111", model: null,
});

beforeEach(() => {
  useQueryStore.setState({
    query: "", sort: "filename", dir: "asc",
    results: [], total: 0, history: [], showFilename: true,
  });
  vi.resetAllMocks();
});

describe("useQueryStore", () => {
  it("runQuery loads results and total", async () => {
    vi.mocked(imagesApi.queryImages).mockResolvedValue([row(1, "a.png")]);
    vi.mocked(imagesApi.countQuery).mockResolvedValue(1);
    await useQueryStore.getState().runQuery();
    expect(useQueryStore.getState().results).toHaveLength(1);
    expect(useQueryStore.getState().total).toBe(1);
  });

  it("setQuery updates query text", () => {
    useQueryStore.getState().setQuery("forest");
    expect(useQueryStore.getState().query).toBe("forest");
  });

  it("setSort updates sort key and dir", () => {
    useQueryStore.getState().setSort("created", "desc");
    expect(useQueryStore.getState().sort).toBe("created");
    expect(useQueryStore.getState().dir).toBe("desc");
  });

  it("commitHistory records and refreshes history", async () => {
    vi.mocked(prefsApi.addFilterHistory).mockResolvedValue(undefined as unknown as void);
    vi.mocked(prefsApi.listFilterHistory).mockResolvedValue(["forest"]);
    useQueryStore.getState().setQuery("forest");
    await useQueryStore.getState().commitHistory();
    expect(prefsApi.addFilterHistory).toHaveBeenCalledWith("forest");
    expect(useQueryStore.getState().history).toEqual(["forest"]);
  });

  it("toggleShowFilename flips and persists", async () => {
    vi.mocked(prefsApi.setSetting).mockResolvedValue(undefined as unknown as void);
    await useQueryStore.getState().toggleShowFilename();
    expect(useQueryStore.getState().showFilename).toBe(false);
    expect(prefsApi.setSetting).toHaveBeenCalledWith("show_filename", "false");
  });
});

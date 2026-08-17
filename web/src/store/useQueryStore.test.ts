import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useQueryStore } from "./useQueryStore";
import * as imagesApi from "../api/images";

function rows(from: number, count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: from + i,
    filename: `f${from + i}.png`,
    width: 512,
    height: 768,
    rating: null,
    created_at: 1000,
    modified_at: 1000,
    source_tool: "a1111",
    model: null,
  }));
}

beforeEach(() => {
  localStorage.clear();
  useQueryStore.setState({
    query: "",
    sort: "created",
    dir: "desc",
    dirs: null,
    results: [],
    total: 0,
    loading: false,
    exhausted: false,
    error: null,
  });
});

afterEach(() => vi.restoreAllMocks());

describe("runQuery", () => {
  it("結果を総入れ替えし、件数を取る", async () => {
    vi.spyOn(imagesApi, "listImages").mockResolvedValue(rows(1, 3));
    vi.spyOn(imagesApi, "countImages").mockResolvedValue({ total: 3 });

    useQueryStore.setState({ results: rows(100, 5) });
    await useQueryStore.getState().runQuery();

    const s = useQueryStore.getState();
    expect(s.results.map((r) => r.id)).toEqual([1, 2, 3]);
    expect(s.total).toBe(3);
    expect(s.exhausted).toBe(true);
  });

  it("失敗したら error に入れ、結果は空にする", async () => {
    vi.spyOn(imagesApi, "listImages").mockRejectedValue(new Error("boom"));
    vi.spyOn(imagesApi, "countImages").mockResolvedValue({ total: 0 });

    await useQueryStore.getState().runQuery();
    expect(useQueryStore.getState().error).toContain("boom");
    expect(useQueryStore.getState().results).toEqual([]);
  });
});

describe("loadMore", () => {
  it("末尾に足し、offset は現在の件数", async () => {
    const spy = vi.spyOn(imagesApi, "listImages").mockResolvedValue(rows(201, 2));
    useQueryStore.setState({ results: rows(1, 200), total: 202 });

    await useQueryStore.getState().loadMore();

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ offset: 200 }));
    expect(useQueryStore.getState().results).toHaveLength(202);
    expect(useQueryStore.getState().exhausted).toBe(true);
  });

  it("すべて読み終えていたら何もしない", async () => {
    const spy = vi.spyOn(imagesApi, "listImages");
    useQueryStore.setState({ results: rows(1, 3), total: 3, exhausted: true });

    await useQueryStore.getState().loadMore();
    expect(spy).not.toHaveBeenCalled();
  });

  it("読み込み中は重ねて呼ばない", async () => {
    const spy = vi.spyOn(imagesApi, "listImages").mockResolvedValue([]);
    useQueryStore.setState({ results: rows(1, 200), total: 400, loading: true });

    await useQueryStore.getState().loadMore();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("setQuery / setSort / setDirs", () => {
  it("localStorage へ保存する", async () => {
    vi.spyOn(imagesApi, "listImages").mockResolvedValue([]);
    vi.spyOn(imagesApi, "countImages").mockResolvedValue({ total: 0 });

    useQueryStore.getState().setQuery("rating:5");
    await useQueryStore.getState().setSort("filename", "asc");
    await useQueryStore.getState().setDirs([2]);

    const saved = JSON.parse(localStorage.getItem("gim.web.prefs")!);
    expect(saved.query).toBe("rating:5");
    expect(saved.sort).toBe("filename");
    expect(saved.dirs).toEqual([2]);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useQueryStore } from "./useQueryStore";
import * as imagesApi from "../api/images";
import type { ImageDto } from "../api/images";

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
    seq: 0,
    history: [],
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

  it("古い runQuery の応答が新しい結果を上書きしない", async () => {
    let resolveFirst!: (v: ImageDto[]) => void;
    const first = new Promise<ImageDto[]>((r) => {
      resolveFirst = r;
    });
    vi.spyOn(imagesApi, "listImages")
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce(rows(50, 1));
    vi.spyOn(imagesApi, "countImages").mockResolvedValue({ total: 1 });

    const p1 = useQueryStore.getState().runQuery();
    const p2 = useQueryStore.getState().runQuery();
    resolveFirst(rows(1, 3)); // 古い方をあとから解決させる
    await Promise.all([p1, p2]);

    expect(useQueryStore.getState().results.map((r) => r.id)).toEqual([50]);
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

  it("loadMore の途中で runQuery が走ったら、古いページを継ぎ足さない", async () => {
    let resolveMore!: (v: ImageDto[]) => void;
    const more = new Promise<ImageDto[]>((r) => {
      resolveMore = r;
    });
    vi.spyOn(imagesApi, "listImages")
      .mockReturnValueOnce(more) // 先に呼ばれる loadMore の分
      .mockResolvedValueOnce(rows(500, 2)); // あとから呼ばれる runQuery の分
    vi.spyOn(imagesApi, "countImages").mockResolvedValue({ total: 2 });

    useQueryStore.setState({ results: rows(1, 200), total: 400 });

    const pMore = useQueryStore.getState().loadMore();
    const pRun = useQueryStore.getState().runQuery();

    // runQuery を先に完全に終わらせてから、古い loadMore を解決させる。
    // これが競合の実際の順序（遅れて返った古い応答が新しい結果を上書きする）。
    await pRun;
    resolveMore(rows(201, 200));
    await pMore;

    expect(useQueryStore.getState().results.map((r) => r.id)).toEqual([500, 501]);
  });
});

describe("setSort / setDirs", () => {
  it("localStorage へ即座に保存する", async () => {
    vi.spyOn(imagesApi, "listImages").mockResolvedValue([]);
    vi.spyOn(imagesApi, "countImages").mockResolvedValue({ total: 0 });

    await useQueryStore.getState().setSort("filename", "asc");
    await useQueryStore.getState().setDirs([2]);

    const saved = JSON.parse(localStorage.getItem("gim.web.prefs")!);
    expect(saved.sort).toBe("filename");
    expect(saved.dirs).toEqual([2]);
  });
});

describe("commitQuery", () => {
  it("履歴へ記録して検索する", async () => {
    vi.spyOn(imagesApi, "listImages").mockResolvedValue([]);
    vi.spyOn(imagesApi, "countImages").mockResolvedValue({ total: 0 });

    useQueryStore.setState({ query: "rating:5", history: [] });
    await useQueryStore.getState().commitQuery();

    expect(useQueryStore.getState().history).toEqual(["rating:5"]);
    expect(JSON.parse(localStorage.getItem("gim.web.prefs")!).history).toEqual(["rating:5"]);
  });

  it("空のクエリは履歴に残さないが検索はする", async () => {
    const spy = vi.spyOn(imagesApi, "listImages").mockResolvedValue([]);
    vi.spyOn(imagesApi, "countImages").mockResolvedValue({ total: 0 });

    useQueryStore.setState({ query: "  ", history: ["a"] });
    await useQueryStore.getState().commitQuery();

    expect(useQueryStore.getState().history).toEqual(["a"]);
    expect(spy).toHaveBeenCalled();
  });
});

describe("setQuery", () => {
  it("状態だけ更新し、保存はクエリ実行時に行う", async () => {
    vi.spyOn(imagesApi, "listImages").mockResolvedValue([]);
    vi.spyOn(imagesApi, "countImages").mockResolvedValue({ total: 0 });

    useQueryStore.getState().setQuery("rating:5");
    expect(useQueryStore.getState().query).toBe("rating:5");
    expect(localStorage.getItem("gim.web.prefs")).toBeNull();

    await useQueryStore.getState().runQuery();
    expect(JSON.parse(localStorage.getItem("gim.web.prefs")!).query).toBe("rating:5");
  });
});

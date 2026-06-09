import { describe, it, expect, vi, beforeEach } from "vitest";
import { useQueryStore } from "./useQueryStore";
import * as imagesApi from "../api/images";
import * as prefsApi from "../api/prefs";
import * as fsApi from "../api/fs";
import type { ImageRow } from "../types";

vi.mock("../api/images");
vi.mock("../api/prefs");
vi.mock("../api/fs", () => ({
  deleteImage: vi.fn().mockResolvedValue(undefined),
  writeXmpRating: vi.fn().mockResolvedValue(undefined),
}));

const row = (id: number, filename: string): ImageRow => ({
  id, path: `/d/${filename}`, filename, thumb_path: `/t/${id}.webp`,
  width: 100, height: 100, pixels: 10000, rating: null,
  created_at: 1, modified_at: 1, source_tool: "a1111", model: null,
});

beforeEach(() => {
  useQueryStore.setState({
    query: "", sort: "filename", dir: "asc",
    results: [], total: 0, history: [], showFilename: true,
    dirCollapsed: false, helpOpen: false,
    toast: null, toastSeq: 0,
  });
  vi.resetAllMocks();
  vi.mocked(prefsApi.syncFilenameMenu).mockResolvedValue(undefined as unknown as void);
  vi.mocked(prefsApi.setSetting).mockResolvedValue(undefined as unknown as void);
  vi.mocked(prefsApi.syncRatingModeMenu).mockResolvedValue(undefined as unknown as void);
  vi.mocked(prefsApi.syncUnratedOnlyMenu).mockResolvedValue(undefined as unknown as void);
  vi.mocked(prefsApi.syncCurrentFilenameMenu).mockResolvedValue(undefined as unknown as void);
  vi.mocked(prefsApi.syncCurrentPositionMenu).mockResolvedValue(undefined as unknown as void);
});

describe("useQueryStore", () => {
  it("runQuery loads all results and total equals length", async () => {
    vi.mocked(imagesApi.queryImages).mockResolvedValue([row(1, "a.png"), row(2, "b.png")]);
    await useQueryStore.getState().runQuery();
    expect(imagesApi.queryImages).toHaveBeenCalledWith("", "filename", "asc", -1, 0);
    expect(useQueryStore.getState().results).toHaveLength(2);
    expect(useQueryStore.getState().total).toBe(2);
  });

  it("setQuery updates query text", () => {
    useQueryStore.getState().setQuery("forest");
    expect(useQueryStore.getState().query).toBe("forest");
  });

  it("setSort updates sort key and dir", () => {
    vi.mocked(imagesApi.queryImages).mockResolvedValue([]);
    vi.mocked(prefsApi.setSetting).mockResolvedValue(undefined as unknown as void);
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

  it("loadSettings applies persisted sort and filename", async () => {
    vi.mocked(prefsApi.getSetting).mockImplementation(async (key: string) => {
      if (key === "sort") return "created:desc";
      if (key === "show_filename") return "false";
      return null;
    });
    await useQueryStore.getState().loadSettings();
    expect(useQueryStore.getState().sort).toBe("created");
    expect(useQueryStore.getState().dir).toBe("desc");
    expect(useQueryStore.getState().showFilename).toBe(false);
  });

  it("loadSettings falls back dir to asc when missing", async () => {
    vi.mocked(prefsApi.getSetting).mockImplementation(async (key: string) => {
      if (key === "sort") return "filename"; // dir 欠落
      return null;
    });
    await useQueryStore.getState().loadSettings();
    expect(useQueryStore.getState().sort).toBe("filename");
    expect(useQueryStore.getState().dir).toBe("asc");
  });

  it("runQuery persists the current filter query", async () => {
    vi.mocked(imagesApi.queryImages).mockResolvedValue([]);
    useQueryStore.getState().setQuery("forest");
    await useQueryStore.getState().runQuery();
    expect(prefsApi.setSetting).toHaveBeenCalledWith("filter_query", "forest");
  });

  it("loadSettings restores persisted filter query", async () => {
    vi.mocked(prefsApi.getSetting).mockImplementation(async (key: string) => {
      if (key === "filter_query") return "cat -blurry";
      return null;
    });
    await useQueryStore.getState().loadSettings();
    expect(useQueryStore.getState().query).toBe("cat -blurry");
  });

  it("toggleDirCollapsed flips and persists", async () => {
    vi.mocked(prefsApi.setSetting).mockResolvedValue(undefined as unknown as void);
    await useQueryStore.getState().toggleDirCollapsed();
    expect(useQueryStore.getState().dirCollapsed).toBe(true);
    expect(prefsApi.setSetting).toHaveBeenCalledWith("dir_collapsed", "true");
  });

  it("loadSettings restores persisted dir_collapsed", async () => {
    vi.mocked(prefsApi.getSetting).mockImplementation(async (key: string) => {
      if (key === "dir_collapsed") return "true";
      return null;
    });
    await useQueryStore.getState().loadSettings();
    expect(useQueryStore.getState().dirCollapsed).toBe(true);
  });

  it("setRating calls api and patches the row in results", async () => {
    vi.mocked(imagesApi.setRating).mockResolvedValue(undefined as unknown as void);
    useQueryStore.setState({ results: [row(1, "a.png"), row(2, "b.png")] });
    await useQueryStore.getState().setRating(2, 4);
    expect(imagesApi.setRating).toHaveBeenCalledWith(2, 4);
    expect(useQueryStore.getState().results.find((r) => r.id === 2)?.rating).toBe(4);
    expect(useQueryStore.getState().results.find((r) => r.id === 1)?.rating).toBeNull();
  });

  it("setRating with null clears the row rating", async () => {
    vi.mocked(imagesApi.setRating).mockResolvedValue(undefined as unknown as void);
    useQueryStore.setState({ results: [{ ...row(1, "a.png"), rating: 5 }] });
    await useQueryStore.getState().setRating(1, null);
    expect(imagesApi.setRating).toHaveBeenCalledWith(1, null);
    expect(useQueryStore.getState().results[0].rating).toBeNull();
  });
});

describe("toast", () => {
  it("showToast で toast と toastSeq が更新される", () => {
    const before = useQueryStore.getState().toastSeq;
    useQueryStore.getState().showToast("テスト");
    expect(useQueryStore.getState().toast).toBe("テスト");
    expect(useQueryStore.getState().toastSeq).toBe(before + 1);
  });
  it("clearToast で toast が null になる", () => {
    useQueryStore.getState().showToast("x");
    useQueryStore.getState().clearToast();
    expect(useQueryStore.getState().toast).toBeNull();
  });
});

describe("deleteImage", () => {
  it("results から該当を除去しトーストを出す", async () => {
    useQueryStore.setState({
      results: [
        { id: 1, path: "/a.png", filename: "a.png", thumb_path: null, width: 1, height: 1, pixels: 1, rating: null, created_at: null, modified_at: null, source_tool: "x", model: null },
        { id: 2, path: "/b.png", filename: "b.png", thumb_path: null, width: 1, height: 1, pixels: 1, rating: null, created_at: null, modified_at: null, source_tool: "x", model: null },
      ],
      total: 2,
      toast: null,
    });
    await useQueryStore.getState().deleteImage(1, "/a.png");
    const st = useQueryStore.getState();
    expect(st.results.map((r) => r.id)).toEqual([2]);
    expect(st.total).toBe(1);
    expect(st.toast).toBe("ゴミ箱に移動しました");
  });
});

describe("未入力のみフィルタ", () => {
  it("ratingMode && unratedOnly で rating!=null を除外する", async () => {
    vi.mocked(imagesApi.queryImages).mockResolvedValue([
      { id: 1, path: "/a", filename: "a", thumb_path: null, width: 1, height: 1, pixels: 1, rating: null, created_at: null, modified_at: null, source_tool: "x", model: null },
      { id: 2, path: "/b", filename: "b", thumb_path: null, width: 1, height: 1, pixels: 1, rating: 4, created_at: null, modified_at: null, source_tool: "x", model: null },
    ]);
    useQueryStore.setState({ ratingMode: true, unratedOnly: true });
    await useQueryStore.getState().runQuery();
    expect(useQueryStore.getState().results.map((r) => r.id)).toEqual([1]);
  });

  it("ratingMode OFF なら絞り込まない", async () => {
    vi.mocked(imagesApi.queryImages).mockResolvedValue([
      { id: 1, path: "/a", filename: "a", thumb_path: null, width: 1, height: 1, pixels: 1, rating: null, created_at: null, modified_at: null, source_tool: "x", model: null },
      { id: 2, path: "/b", filename: "b", thumb_path: null, width: 1, height: 1, pixels: 1, rating: 4, created_at: null, modified_at: null, source_tool: "x", model: null },
    ]);
    useQueryStore.setState({ ratingMode: false, unratedOnly: true });
    await useQueryStore.getState().runQuery();
    expect(useQueryStore.getState().results.length).toBe(2);
  });
});

describe("表示トグル", () => {
  it("toggleShowCurrentFilename で反転し永続化する", async () => {
    useQueryStore.setState({ showCurrentFilename: false });
    await useQueryStore.getState().toggleShowCurrentFilename();
    expect(useQueryStore.getState().showCurrentFilename).toBe(true);
    expect(prefsApi.setSetting).toHaveBeenCalledWith("show_current_filename", "true");
  });
  it("toggleShowCurrentPosition で反転する", async () => {
    useQueryStore.setState({ showCurrentPosition: false });
    await useQueryStore.getState().toggleShowCurrentPosition();
    expect(useQueryStore.getState().showCurrentPosition).toBe(true);
    expect(prefsApi.setSetting).toHaveBeenCalledWith("show_current_position", "true");
  });
});

describe("setRating + XMP 連携", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useQueryStore.setState({
      results: [{ id: 1, path: "/a.png", filename: "a.png", thumb_path: null, width: 1, height: 1, pixels: 1, rating: null, created_at: null, modified_at: null, source_tool: "x", model: null }],
      xmpAutoExport: false,
      ratingMode: false,
      unratedOnly: false,
    });
  });

  it("xmpAutoExport OFF のとき writeXmpRating を呼ばない", async () => {
    vi.mocked(imagesApi.setRating).mockResolvedValue(undefined as unknown as void);
    await useQueryStore.getState().setRating(1, 3);
    expect(fsApi.writeXmpRating).not.toHaveBeenCalled();
  });

  it("xmpAutoExport ON のとき writeXmpRating を呼ぶ", async () => {
    vi.mocked(imagesApi.setRating).mockResolvedValue(undefined as unknown as void);
    useQueryStore.setState({ xmpAutoExport: true });
    await useQueryStore.getState().setRating(1, 3);
    expect(fsApi.writeXmpRating).toHaveBeenCalledWith("/a.png", 3);
  });
});

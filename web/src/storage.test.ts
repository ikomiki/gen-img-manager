import { describe, it, expect, beforeEach } from "vitest";
import { loadPrefs, savePrefs, sanitizePrefs, DEFAULT_PREFS, INTERVAL_CHOICES } from "./storage";

beforeEach(() => localStorage.clear());

describe("loadPrefs", () => {
  it("何も無ければ既定値を返す", () => {
    expect(loadPrefs()).toEqual(DEFAULT_PREFS);
  });

  it("保存した値を読み戻す", () => {
    savePrefs({ query: "rating:5", dirs: [1, 2] });
    const p = loadPrefs();
    expect(p.query).toBe("rating:5");
    expect(p.dirs).toEqual([1, 2]);
    expect(p.sort).toBe(DEFAULT_PREFS.sort);
  });

  it("dirs の null と空配列を区別して保存できる", () => {
    savePrefs({ dirs: [] });
    expect(loadPrefs().dirs).toEqual([]);
    savePrefs({ dirs: null });
    expect(loadPrefs().dirs).toBeNull();
  });

  it("壊れた JSON があっても既定値へ落ちる", () => {
    localStorage.setItem("gim.web.prefs", "{not json");
    expect(loadPrefs()).toEqual(DEFAULT_PREFS);
  });

  it("知らないキーが混ざっていても既定値で補う", () => {
    localStorage.setItem("gim.web.prefs", JSON.stringify({ query: "x", bogus: 1 }));
    const p = loadPrefs();
    expect(p.query).toBe("x");
    expect(p.history).toEqual([]);
  });
});

describe("sanitizePrefs", () => {
  it("何も無ければ既定値", () => {
    expect(sanitizePrefs(undefined)).toEqual(DEFAULT_PREFS);
    expect(sanitizePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(sanitizePrefs("文字列")).toEqual(DEFAULT_PREFS);
  });

  it("正しい値はそのまま通す", () => {
    const p = sanitizePrefs({
      query: "rating:5",
      sort: "filename",
      dir: "asc",
      dirs: [1, 2],
      history: ["a", "b"],
      slideshow: { intervalSec: 10, loop: false, shuffle: true },
    });
    expect(p.query).toBe("rating:5");
    expect(p.sort).toBe("filename");
    expect(p.dir).toBe("asc");
    expect(p.dirs).toEqual([1, 2]);
    expect(p.history).toEqual(["a", "b"]);
    expect(p.slideshow).toEqual({ intervalSec: 10, loop: false, shuffle: true });
  });

  it("知らない sort / dir は既定値へ落とす", () => {
    expect(sanitizePrefs({ sort: "bogus" }).sort).toBe(DEFAULT_PREFS.sort);
    expect(sanitizePrefs({ dir: "sideways" }).dir).toBe(DEFAULT_PREFS.dir);
  });

  it("dirs は null と数値配列だけを受け付ける", () => {
    expect(sanitizePrefs({ dirs: null }).dirs).toBeNull();
    expect(sanitizePrefs({ dirs: [] }).dirs).toEqual([]);
    expect(sanitizePrefs({ dirs: "abc" }).dirs).toBeNull();
    expect(sanitizePrefs({ dirs: [1, "x", 3] }).dirs).toBeNull();
    expect(sanitizePrefs({ dirs: [1, NaN] }).dirs).toBeNull();
  });

  it("history は文字列配列だけを受け付ける", () => {
    expect(sanitizePrefs({ history: ["a"] }).history).toEqual(["a"]);
    expect(sanitizePrefs({ history: "a" }).history).toEqual([]);
    expect(sanitizePrefs({ history: [1, 2] }).history).toEqual([]);
  });

  it("間隔は選択肢に無ければ既定値へ落とす", () => {
    expect(sanitizePrefs({ slideshow: { intervalSec: 7 } }).slideshow.intervalSec).toBe(
      DEFAULT_PREFS.slideshow.intervalSec,
    );
    expect(sanitizePrefs({ slideshow: { intervalSec: 0 } }).slideshow.intervalSec).toBe(
      DEFAULT_PREFS.slideshow.intervalSec,
    );
    expect(sanitizePrefs({ slideshow: { intervalSec: 30 } }).slideshow.intervalSec).toBe(30);
  });

  it("知らないキーは落とす", () => {
    const p = sanitizePrefs({ query: "x", bogus: 1 });
    expect(p.query).toBe("x");
    expect("bogus" in p).toBe(false);
  });

  it("間隔の選択肢", () => {
    expect(INTERVAL_CHOICES).toEqual([3, 5, 10, 30]);
  });
});

describe("loadPrefs（検証つき）", () => {
  beforeEach(() => localStorage.clear());

  it("壊れた値が入っていても既定値へ落ちる", () => {
    localStorage.setItem("gim.web.prefs", JSON.stringify({ dirs: "abc", sort: "bogus" }));
    const p = loadPrefs();
    expect(p.dirs).toBeNull();
    expect(p.sort).toBe(DEFAULT_PREFS.sort);
  });

  it("保存すると知らないキーが消える", () => {
    localStorage.setItem("gim.web.prefs", JSON.stringify({ query: "x", bogus: 1 }));
    savePrefs({ sort: "filename" });
    const raw = JSON.parse(localStorage.getItem("gim.web.prefs")!);
    expect(raw.query).toBe("x");
    expect(raw.sort).toBe("filename");
    expect("bogus" in raw).toBe(false);
  });

  it("スライドショー設定を読み書きできる", () => {
    savePrefs({ slideshow: { intervalSec: 30, loop: false, shuffle: true } });
    expect(loadPrefs().slideshow).toEqual({ intervalSec: 30, loop: false, shuffle: true });
  });
});

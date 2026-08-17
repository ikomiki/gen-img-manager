import { describe, it, expect, beforeEach } from "vitest";
import { loadPrefs, savePrefs, DEFAULT_PREFS } from "./storage";

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

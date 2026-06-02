import { describe, it, expect } from "vitest";
import { matchHistory } from "./historyMatch";

const HISTORY = ["prompt:1girl rating:>=4", "forest", "FOREST night", "cat -blurry"];

describe("matchHistory", () => {
  it("returns all history for empty input", () => {
    expect(matchHistory("", HISTORY)).toEqual(HISTORY);
  });

  it("returns all history for whitespace-only input", () => {
    expect(matchHistory("   ", HISTORY)).toEqual(HISTORY);
  });

  it("matches substrings anywhere (contains)", () => {
    expect(matchHistory("1girl", HISTORY)).toEqual(["prompt:1girl rating:>=4"]);
  });

  it("is case-insensitive", () => {
    expect(matchHistory("forest", HISTORY)).toEqual(["forest", "FOREST night"]);
  });

  it("excludes entries equal to the input (case-insensitive)", () => {
    expect(matchHistory("Forest", HISTORY)).toEqual(["FOREST night"]);
  });

  it("returns empty when nothing matches", () => {
    expect(matchHistory("zzz", HISTORY)).toEqual([]);
  });

  it("preserves the original order of history", () => {
    expect(matchHistory("r", ["bar", "car", "rim"])).toEqual(["bar", "car", "rim"]);
  });
});

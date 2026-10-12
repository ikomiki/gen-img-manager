import { describe, it, expect } from "vitest";
import { buildInfoBlocks } from "./infoBlocks";

describe("buildInfoBlocks", () => {
  it("positive があれば Prompt と Negative を出し、Parameters は出さない", () => {
    const b = buildInfoBlocks({ positive: "p", negative: "n", raw_parameters: "raw" });
    expect(b.map((x) => x.key)).toEqual(["prompt", "negative"]);
    expect(b.every((x) => x.normalizable)).toBe(true);
  });

  it("negative が無ければ Prompt だけ", () => {
    const b = buildInfoBlocks({ positive: "p", negative: null, raw_parameters: "raw" });
    expect(b.map((x) => x.key)).toEqual(["prompt"]);
  });

  it("positive が無ければ Parameters を整形対象外で出す", () => {
    const b = buildInfoBlocks({ positive: null, negative: null, raw_parameters: "raw" });
    expect(b).toEqual([{ key: "params", label: "Parameters", text: "raw", normalizable: false }]);
  });

  it("何も無ければ空", () => {
    expect(buildInfoBlocks({ positive: "", negative: null, raw_parameters: null })).toEqual([]);
  });
});

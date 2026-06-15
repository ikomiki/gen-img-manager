import { describe, it, expect } from "vitest";
import { splitPromptInput, applyPromptField, promptFieldToInput } from "./promptQuery";

describe("splitPromptInput", () => {
  it("separates top-level excludes from the positive expression", () => {
    expect(splitPromptInput("forest AND cabin -blurry")).toEqual({
      positive: "forest AND cabin",
      excludes: ["blurry"],
    });
  });

  it("keeps a parenthesized group as part of the positive expression", () => {
    expect(splitPromptInput("(a AND b) OR c -bad")).toEqual({
      positive: "(a AND b) OR c",
      excludes: ["bad"],
    });
  });

  it("does not treat a hyphen inside parens as a top-level exclude", () => {
    expect(splitPromptInput("(a-b) cat")).toEqual({
      positive: "(a-b) cat",
      excludes: [],
    });
  });

  it("returns empty for blank input", () => {
    expect(splitPromptInput("   ")).toEqual({ positive: "", excludes: [] });
  });
});

describe("applyPromptField", () => {
  it("writes a single bare word without parens", () => {
    expect(applyPromptField("1girl", "prompt", "forest")).toBe("1girl prompt:forest");
  });

  it("wraps a logical expression in parens", () => {
    expect(applyPromptField("", "prompt", "forest AND cabin")).toBe("prompt:(forest AND cabin)");
  });

  it("emits a single exclude as -prompt:word", () => {
    expect(applyPromptField("", "prompt", "forest -blurry")).toBe("prompt:forest -prompt:blurry");
  });

  it("groups multiple excludes with OR", () => {
    expect(applyPromptField("", "prompt", "forest -blurry -lowres")).toBe(
      "prompt:forest -prompt:(blurry OR lowres)",
    );
  });

  it("replaces existing positive and negated prompt tokens, preserving others", () => {
    const q = "prompt:(old AND thing) -prompt:bad rating:>=4 1girl";
    expect(applyPromptField(q, "prompt", "forest")).toBe("rating:>=4 1girl prompt:forest");
  });

  it("clears the field when input is empty", () => {
    expect(applyPromptField("prompt:(a AND b) -prompt:c 1girl", "prompt", "")).toBe("1girl");
  });
});

describe("promptFieldToInput", () => {
  it("unwraps a parenthesized positive value", () => {
    expect(promptFieldToInput("prompt:(forest AND cabin)", "prompt")).toBe("forest AND cabin");
  });

  it("keeps a quoted phrase quoted", () => {
    expect(promptFieldToInput('prompt:"best quality"', "prompt")).toBe('"best quality"');
  });

  it("renders a single bare word as-is", () => {
    expect(promptFieldToInput("prompt:forest", "prompt")).toBe("forest");
  });

  it("appends excludes as -word", () => {
    expect(promptFieldToInput("prompt:(forest AND cabin) -prompt:blurry", "prompt")).toBe(
      "forest AND cabin -blurry",
    );
  });

  it("expands a grouped exclude into -word tokens", () => {
    expect(promptFieldToInput("prompt:forest -prompt:(blurry OR lowres)", "prompt")).toBe(
      "forest -blurry -lowres",
    );
  });

  it("round-trips through applyPromptField", () => {
    const input = "forest AND cabin -blurry";
    const q = applyPromptField("", "prompt", input);
    expect(promptFieldToInput(q, "prompt")).toBe(input);
  });
});

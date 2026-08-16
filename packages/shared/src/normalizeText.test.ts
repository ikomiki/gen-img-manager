import { describe, it, expect } from "vitest";
import { normalizePromptText } from "./normalizeText";

describe("normalizePromptText", () => {
  it("removes empty lines", () => {
    expect(normalizePromptText("a\n\n\nb")).toBe("a\nb");
  });

  it("removes lines containing only commas (and whitespace)", () => {
    expect(normalizePromptText("a\n,\nb\n , ,\nc")).toBe("a\nb\nc");
  });

  it("trims leading and trailing whitespace on each line", () => {
    expect(normalizePromptText("  a  \n\tb\t")).toBe("a\nb");
  });

  it("keeps inner content and commas within a line", () => {
    expect(normalizePromptText("  1girl, solo,  ")).toBe("1girl, solo,");
  });

  it("handles CRLF line endings", () => {
    expect(normalizePromptText("a\r\n\r\nb")).toBe("a\nb");
  });

  it("returns empty string for whitespace/comma-only input", () => {
    expect(normalizePromptText("\n , \n,,\n")).toBe("");
  });

  it("leaves clean text unchanged", () => {
    expect(normalizePromptText("a\nb\nc")).toBe("a\nb\nc");
  });
});

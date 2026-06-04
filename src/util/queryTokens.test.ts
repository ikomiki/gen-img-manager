import { describe, it, expect } from "vitest";
import { extractField, upsertField } from "./queryTokens";

describe("extractField", () => {
  it("reads an unquoted field value", () => {
    expect(extractField("forest prompt:cat rating:>=4", "prompt")).toBe("cat");
    expect(extractField("forest prompt:cat rating:>=4", "rating")).toBe(">=4");
  });

  it("reads a quoted field value (with spaces)", () => {
    expect(extractField('prompt:"best quality" -blurry', "prompt")).toBe("best quality");
  });

  it("ignores negated tokens of the same field", () => {
    expect(extractField("-prompt:bad foo", "prompt")).toBeNull();
  });

  it("does not treat a quoted colon phrase as a field", () => {
    expect(extractField('"foo:bar"', "foo")).toBeNull();
  });

  it("returns null when field is absent", () => {
    expect(extractField("forest", "prompt")).toBeNull();
  });
});

describe("upsertField", () => {
  it("adds a new field token preserving the rest", () => {
    expect(upsertField("1girl -blurry", "rating", ">=4")).toBe("1girl -blurry rating:>=4");
  });

  it("replaces an existing non-negated field token", () => {
    expect(upsertField("prompt:old 1girl", "prompt", "new")).toBe("1girl prompt:new");
  });

  it("removes the field when value is null", () => {
    expect(upsertField("1girl prompt:old", "prompt", null)).toBe("1girl");
  });

  it("quotes values containing whitespace", () => {
    expect(upsertField("1girl", "prompt", "best quality")).toBe('1girl prompt:"best quality"');
  });

  it("preserves negated tokens of the same field", () => {
    expect(upsertField("-prompt:bad cat", "prompt", "good")).toBe('-prompt:bad cat prompt:good');
  });

  it("round-trips a quoted value", () => {
    const q = upsertField("", "prompt", "a b");
    expect(extractField(q, "prompt")).toBe("a b");
  });
});

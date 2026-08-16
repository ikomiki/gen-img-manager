import { describe, it, expect } from "vitest";
import { extractField, upsertField, tokenizeQuery } from "./queryTokens";

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

describe("tokenizeQuery 括弧式", () => {
  it("keeps field:(...) as one token", () => {
    const toks = tokenizeQuery("prompt:(forest AND cabin) rating:>=4");
    expect(toks.map((t) => t.text)).toEqual(["prompt:(forest AND cabin)", "rating:>=4"]);
    expect(toks[0].lead).toBe("prompt:");
    expect(toks[0].quoted).toBe(false);
    expect(toks[0].negate).toBe(false);
  });

  it("keeps -field:(...) as one negated token", () => {
    const toks = tokenizeQuery("-prompt:(a OR b)");
    expect(toks).toHaveLength(1);
    expect(toks[0].negate).toBe(true);
    expect(toks[0].text).toBe("prompt:(a OR b)");
    expect(toks[0].lead).toBe("prompt:");
  });

  it("keeps quotes inside the paren value", () => {
    const toks = tokenizeQuery('prompt:("best quality" AND x)');
    expect(toks[0].text).toBe('prompt:("best quality" AND x)');
  });
});

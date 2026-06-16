import { describe, it, expect } from "vitest";
import { isApplyEnter } from "./dialogKeys";

const base = { key: "Enter", isComposing: false, keyCode: 13, tagName: "INPUT", inputType: "text" };

describe("isApplyEnter", () => {
  it("テキスト入力欄での Enter は true", () => {
    expect(isApplyEnter(base)).toBe(true);
  });

  it("数値入力欄での Enter は true", () => {
    expect(isApplyEnter({ ...base, inputType: "number" })).toBe(true);
  });

  it("IME 変換確定中（isComposing）は false", () => {
    expect(isApplyEnter({ ...base, isComposing: true })).toBe(false);
  });

  it("IME 変換確定中（keyCode 229）は false", () => {
    expect(isApplyEnter({ ...base, keyCode: 229 })).toBe(false);
  });

  it("Enter 以外のキーは false", () => {
    expect(isApplyEnter({ ...base, key: "a" })).toBe(false);
  });

  it("select 上の Enter は false", () => {
    expect(isApplyEnter({ ...base, tagName: "SELECT", inputType: "" })).toBe(false);
  });

  it("button 上の Enter は false", () => {
    expect(isApplyEnter({ ...base, tagName: "BUTTON", inputType: "" })).toBe(false);
  });

  it("text/number 以外の input（checkbox 等）は false", () => {
    expect(isApplyEnter({ ...base, inputType: "checkbox" })).toBe(false);
  });
});

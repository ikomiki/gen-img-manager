import { describe, it, expect } from "vitest";
import { isPlainKey, isTypingTarget } from "./keys";

function ev(key: string, mods: Partial<Record<"ctrlKey" | "metaKey" | "shiftKey" | "altKey", boolean>> = {}) {
  return { key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods } as KeyboardEvent;
}

describe("isPlainKey", () => {
  it("修飾キー無しで一致する", () => {
    expect(isPlainKey(ev("/"), "/")).toBe(true);
    expect(isPlainKey(ev("Escape"), "Escape")).toBe(true);
  });

  it("キーが違えば false", () => {
    expect(isPlainKey(ev("a"), "/")).toBe(false);
  });

  it("修飾キーが1つでも押されていれば false", () => {
    expect(isPlainKey(ev("/", { ctrlKey: true }), "/")).toBe(false);
    expect(isPlainKey(ev("/", { metaKey: true }), "/")).toBe(false);
    expect(isPlainKey(ev("/", { shiftKey: true }), "/")).toBe(false);
    expect(isPlainKey(ev("/", { altKey: true }), "/")).toBe(false);
  });
});

describe("isTypingTarget", () => {
  it("input と textarea は入力中とみなす", () => {
    expect(isTypingTarget(document.createElement("input"))).toBe(true);
    expect(isTypingTarget(document.createElement("textarea"))).toBe(true);
  });

  it("select も入力中とみなす", () => {
    expect(isTypingTarget(document.createElement("select"))).toBe(true);
  });

  it("div は入力中ではない", () => {
    expect(isTypingTarget(document.createElement("div"))).toBe(false);
  });

  it("contenteditable な要素は入力中とみなす", () => {
    const d = document.createElement("div");
    d.setAttribute("contenteditable", "true");
    expect(isTypingTarget(d)).toBe(true);
  });

  it("null は入力中ではない", () => {
    expect(isTypingTarget(null)).toBe(false);
  });
});

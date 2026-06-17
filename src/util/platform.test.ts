import { describe, it, expect, afterEach, vi } from "vitest";
import { isMac, isFullscreenToggleKey, hasPrimaryModifier, isSelectAllKey } from "./platform";

function setUA(ua: string) {
  vi.stubGlobal("navigator", { userAgent: ua });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isMac", () => {
  it("Mac の userAgent で true", () => {
    setUA("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)");
    expect(isMac()).toBe(true);
  });
  it("Windows の userAgent で false", () => {
    setUA("Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
    expect(isMac()).toBe(false);
  });
});

describe("isFullscreenToggleKey", () => {
  it("macOS では Option+Command+F (code=KeyF) で true", () => {
    setUA("Macintosh");
    expect(
      isFullscreenToggleKey({ altKey: true, metaKey: true, code: "KeyF", key: "ƒ" } as KeyboardEvent),
    ).toBe(true);
  });
  it("macOS では F11 単体は false", () => {
    setUA("Macintosh");
    expect(
      isFullscreenToggleKey({ altKey: false, metaKey: false, code: "F11", key: "F11" } as KeyboardEvent),
    ).toBe(false);
  });
  it("非macOS では F11 で true", () => {
    setUA("Windows NT 10.0");
    expect(
      isFullscreenToggleKey({ altKey: false, metaKey: false, code: "F11", key: "F11" } as KeyboardEvent),
    ).toBe(true);
  });
  it("非macOS では Option+Command+F は false", () => {
    setUA("Windows NT 10.0");
    expect(
      isFullscreenToggleKey({ altKey: true, metaKey: true, code: "KeyF", key: "f" } as KeyboardEvent),
    ).toBe(false);
  });
});

describe("hasPrimaryModifier", () => {
  it("Command (metaKey) 併用で true（Cmd+C 等は標準動作へ委ねる）", () => {
    expect(hasPrimaryModifier({ metaKey: true, ctrlKey: false })).toBe(true);
  });
  it("Ctrl (ctrlKey) 併用で true", () => {
    expect(hasPrimaryModifier({ metaKey: false, ctrlKey: true })).toBe(true);
  });
  it("修飾キーなしの単独キーは false（c=パスコピー等のアプリショートカット対象）", () => {
    expect(hasPrimaryModifier({ metaKey: false, ctrlKey: false })).toBe(false);
  });
});

describe("isSelectAllKey", () => {
  it("Cmd+A で true（全選択）", () => {
    expect(
      isSelectAllKey({ metaKey: true, ctrlKey: false, shiftKey: false, altKey: false, key: "a" }),
    ).toBe(true);
  });
  it("Ctrl+A で true（全選択）", () => {
    expect(
      isSelectAllKey({ metaKey: false, ctrlKey: true, shiftKey: false, altKey: false, key: "a" }),
    ).toBe(true);
  });
  it("CapsLock 等で key が大文字 A でも Shift 未併用なら true", () => {
    expect(
      isSelectAllKey({ metaKey: true, ctrlKey: false, shiftKey: false, altKey: false, key: "A" }),
    ).toBe(true);
  });
  it("Cmd+Shift+A は false（分析メニューのアクセラレータへ委ねる）", () => {
    expect(
      isSelectAllKey({ metaKey: true, ctrlKey: false, shiftKey: true, altKey: false, key: "A" }),
    ).toBe(false);
  });
  it("Cmd+Alt+A は false（修飾キー完全一致のため）", () => {
    expect(
      isSelectAllKey({ metaKey: true, ctrlKey: false, shiftKey: false, altKey: true, key: "a" }),
    ).toBe(false);
  });
  it("修飾キーなしの A は false", () => {
    expect(
      isSelectAllKey({ metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, key: "a" }),
    ).toBe(false);
  });
});

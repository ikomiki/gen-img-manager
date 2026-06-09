import { describe, it, expect, afterEach, vi } from "vitest";
import { isMac, isFullscreenToggleKey } from "./platform";

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

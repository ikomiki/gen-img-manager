import { describe, it, expect, vi, afterEach } from "vitest";
import { isFullscreen, isFullscreenSupported, toggleFullscreen } from "./fullscreen";

/** jsdom は Fullscreen API を持たないので、テストごとに必要な分だけ生やす。 */
function stubDoc(props: Record<string, unknown>) {
  for (const [k, v] of Object.entries(props)) {
    Object.defineProperty(document, k, { configurable: true, value: v });
    added.push(k);
  }
}

const added: string[] = [];
let hadRequest = false;

afterEach(() => {
  for (const k of added) Reflect.deleteProperty(document, k);
  added.length = 0;
  if (hadRequest) {
    Reflect.deleteProperty(Element.prototype, "requestFullscreen");
    hadRequest = false;
  }
});

function stubRequestFullscreen(fn: () => Promise<void>) {
  Object.defineProperty(Element.prototype, "requestFullscreen", { configurable: true, value: fn });
  hadRequest = true;
}

describe("isFullscreenSupported", () => {
  it("fullscreenEnabled とメソッドの両方が揃っていれば対応とみなす", () => {
    stubDoc({ fullscreenEnabled: true });
    stubRequestFullscreen(() => Promise.resolve());
    expect(isFullscreenSupported()).toBe(true);
  });

  it("メソッドが無い環境（iPhone Safari）は非対応", () => {
    stubDoc({ fullscreenEnabled: true });
    expect(isFullscreenSupported()).toBe(false);
  });

  it("fullscreenEnabled が false なら非対応", () => {
    stubDoc({ fullscreenEnabled: false });
    stubRequestFullscreen(() => Promise.resolve());
    expect(isFullscreenSupported()).toBe(false);
  });
});

describe("isFullscreen", () => {
  it("fullscreenElement があれば真", () => {
    stubDoc({ fullscreenElement: document.body });
    expect(isFullscreen()).toBe(true);
  });

  it("null なら偽", () => {
    stubDoc({ fullscreenElement: null });
    expect(isFullscreen()).toBe(false);
  });
});

describe("toggleFullscreen", () => {
  it("出ていれば入る", () => {
    const request = vi.fn(() => Promise.resolve());
    stubDoc({ fullscreenElement: null });
    stubRequestFullscreen(request);
    toggleFullscreen(document.createElement("div"));
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("入っていれば出る", () => {
    const exit = vi.fn(() => Promise.resolve());
    stubDoc({ fullscreenElement: document.body, exitFullscreen: exit });
    toggleFullscreen(document.createElement("div"));
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it("要素が無ければ何もしない", () => {
    const exit = vi.fn(() => Promise.resolve());
    stubDoc({ fullscreenElement: document.body, exitFullscreen: exit });
    toggleFullscreen(null);
    expect(exit).not.toHaveBeenCalled();
  });

  it("要求が reject されても例外を投げず、未処理の拒否も残さない", async () => {
    stubDoc({ fullscreenElement: null });
    stubRequestFullscreen(() => Promise.reject(new Error("not allowed")));
    expect(() => toggleFullscreen(document.createElement("div"))).not.toThrow();
    await Promise.resolve();
  });

  it("メソッドが無い環境でも例外を投げない", () => {
    stubDoc({ fullscreenElement: null });
    expect(() => toggleFullscreen(document.createElement("div"))).not.toThrow();
  });
});

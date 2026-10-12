import { describe, it, expect, vi, afterEach } from "vitest";
import { copyText } from "./copyText";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("copyText", () => {
  it("clipboard API があればそれを使う", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    expect(await copyText("abc")).toBe(true);
    expect(writeText).toHaveBeenCalledWith("abc");
  });

  it("clipboard API が無ければ execCommand へ落とし、textarea を残さない", async () => {
    vi.stubGlobal("navigator", {});
    let copied = "";
    document.execCommand = vi.fn(() => {
      copied = document.querySelector("textarea")?.value ?? "";
      return true;
    });
    expect(await copyText("xyz")).toBe(true);
    expect(copied).toBe("xyz");
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("clipboard API が拒否されても execCommand を試す", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error()) } });
    document.execCommand = vi.fn(() => false);
    expect(await copyText("x")).toBe(false);
    expect(document.execCommand).toHaveBeenCalledWith("copy");
  });
});

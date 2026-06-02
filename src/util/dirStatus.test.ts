import { describe, it, expect } from "vitest";
import { formatCount, formatScanTimestamp, dirStatusLine } from "./dirStatus";

describe("formatCount", () => {
  it("adds thousands separators and 枚 suffix", () => {
    expect(formatCount(1234)).toBe("1,234枚");
    expect(formatCount(0)).toBe("0枚");
  });
});

describe("formatScanTimestamp", () => {
  it("formats as YYYY-MM-DD HH:MM (zero-padded)", () => {
    expect(formatScanTimestamp(1717000000)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });
});

describe("dirStatusLine", () => {
  it("shows scan progress when scanning (highest priority)", () => {
    expect(
      dirStatusLine({
        scanning: { processed: 1234, total: 4560 },
        isOnline: false,
        count: 10,
        lastScannedAt: 1717000000,
      }),
    ).toBe("スキャン中 1,234 / 4,560");
  });

  it("shows offline when not scanning and offline", () => {
    expect(
      dirStatusLine({ isOnline: false, count: 10, lastScannedAt: 1717000000 }),
    ).toBe("オフライン");
  });

  it("shows 未スキャン when online but never scanned", () => {
    expect(
      dirStatusLine({ isOnline: true, count: undefined, lastScannedAt: null }),
    ).toBe("未スキャン");
  });

  it("shows count and last scanned when online and scanned", () => {
    const line = dirStatusLine({ isOnline: true, count: 1234, lastScannedAt: 1717000000 });
    expect(line).toMatch(/^1,234枚 · 最終 \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it("treats missing count as 0 when online and scanned", () => {
    const line = dirStatusLine({ isOnline: true, count: undefined, lastScannedAt: 1717000000 });
    expect(line.startsWith("0枚 · 最終 ")).toBe(true);
  });
});

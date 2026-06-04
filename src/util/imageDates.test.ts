import { describe, it, expect } from "vitest";
import { imageDateInfo, localDateToDate, dateToLocalString } from "./imageDates";

// ローカルTZでの epoch 秒を作る（テストのTZ非依存化）。
const localEpoch = (y: number, m: number, d: number, h = 12): number =>
  Math.floor(new Date(y, m - 1, d, h, 0, 0).getTime() / 1000);

describe("imageDateInfo", () => {
  it("returns null min/max for empty or all-null input", () => {
    expect(imageDateInfo([]).min).toBeNull();
    expect(imageDateInfo([{ created_at: null }]).max).toBeNull();
    expect(imageDateInfo([{ created_at: null }]).dates.size).toBe(0);
  });

  it("computes min/max and the set of local dates", () => {
    const info = imageDateInfo([
      { created_at: localEpoch(2025, 1, 3) },
      { created_at: localEpoch(2025, 6, 30) },
      { created_at: localEpoch(2025, 1, 3) },
      { created_at: null },
    ]);
    expect(info.min).toBe("2025-01-03");
    expect(info.max).toBe("2025-06-30");
    expect(info.dates.has("2025-01-03")).toBe(true);
    expect(info.dates.has("2025-06-30")).toBe(true);
    expect(info.dates.size).toBe(2);
  });
});

describe("date helpers", () => {
  it("round-trips a local date string and Date", () => {
    const d = localDateToDate("2025-03-09");
    expect(d.getFullYear()).toBe(2025);
    expect(d.getMonth()).toBe(2);
    expect(d.getDate()).toBe(9);
    expect(dateToLocalString(d)).toBe("2025-03-09");
  });
});

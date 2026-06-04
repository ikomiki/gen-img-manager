import { describe, it, expect } from "vitest";
import { nextZoomMode } from "./zoomCycle";

describe("nextZoomMode", () => {
  it("cycles fit -> actual -> fill -> fit", () => {
    expect(nextZoomMode("fit")).toBe("actual");
    expect(nextZoomMode("actual")).toBe("fill");
    expect(nextZoomMode("fill")).toBe("fit");
  });

  it("returns fit when current is outside the cycle (custom)", () => {
    expect(nextZoomMode("custom")).toBe("fit");
  });
});

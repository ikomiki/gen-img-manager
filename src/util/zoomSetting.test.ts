import { describe, it, expect } from "vitest";
import { serializeZoom, parseZoom } from "./zoomSetting";

describe("serializeZoom", () => {
  it("serializes mode and scale as 'mode:scale'", () => {
    expect(serializeZoom("fit", 1)).toBe("fit:1");
    expect(serializeZoom("custom", 2.5)).toBe("custom:2.5");
  });
});

describe("parseZoom", () => {
  it("round-trips a serialized value", () => {
    expect(parseZoom(serializeZoom("custom", 2.5))).toEqual({ mode: "custom", scale: 2.5 });
    expect(parseZoom(serializeZoom("fit", 1))).toEqual({ mode: "fit", scale: 1 });
  });

  it("returns null for null input", () => {
    expect(parseZoom(null)).toBeNull();
  });

  it("returns null for unknown mode", () => {
    expect(parseZoom("zoomy:1")).toBeNull();
  });

  it("returns null for non-numeric scale", () => {
    expect(parseZoom("custom:abc")).toBeNull();
  });

  it("returns null for non-positive scale", () => {
    expect(parseZoom("custom:0")).toBeNull();
    expect(parseZoom("custom:-2")).toBeNull();
  });

  it("returns null for malformed strings", () => {
    expect(parseZoom("")).toBeNull();
    expect(parseZoom("fit")).toBeNull();
  });
});

import { describe, it, expect } from "vitest";
import { gridLayout } from "./gridLayout";

describe("gridLayout", () => {
  it("390px 幅（実測 3 列・127px）", () => {
    const { columns, cell } = gridLayout(390, 110, 4);
    expect(columns).toBe(3);
    expect(cell).toBeCloseTo(127, 0);
  });

  it("1440px 幅（実測 12 列・116px）", () => {
    const { columns, cell } = gridLayout(1440, 110, 4);
    expect(columns).toBe(12);
    expect(cell).toBeCloseTo(116, 0);
  });

  it("測定前（width: 0）は columns: 1、cell: 0 になる（現状の挙動）", () => {
    const { columns, cell } = gridLayout(0, 110, 4);
    expect(columns).toBe(1);
    expect(cell).toBe(0);
  });

  it("極端に狭い幅でも columns は 1 以上", () => {
    const { columns } = gridLayout(50, 110, 4);
    expect(columns).toBeGreaterThanOrEqual(1);
  });
});

import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useContextMenu } from "./useContextMenu";

describe("useContextMenu", () => {
  it("starts closed with no imageId", () => {
    const { result } = renderHook(() => useContextMenu());
    expect(result.current.menuState.open).toBe(false);
    expect(result.current.menuState.imageId).toBeNull();
  });

  it("showMenu opens with given position and imageId", () => {
    const { result } = renderHook(() => useContextMenu());
    act(() => {
      result.current.showMenu(100, 200, 42);
    });
    expect(result.current.menuState).toEqual({ open: true, x: 100, y: 200, imageId: 42 });
  });

  it("closeMenu sets open to false while preserving imageId", () => {
    const { result } = renderHook(() => useContextMenu());
    act(() => {
      result.current.showMenu(100, 200, 42);
    });
    act(() => {
      result.current.closeMenu();
    });
    expect(result.current.menuState.open).toBe(false);
    expect(result.current.menuState.imageId).toBe(42);
  });
});

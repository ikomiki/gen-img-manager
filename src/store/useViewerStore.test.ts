import { describe, it, expect, beforeEach, vi } from "vitest";
import { useViewerStore } from "./useViewerStore";
import { useQueryStore } from "./useQueryStore";
import type { ImageRow } from "../types";
import * as prefsApi from "../api/prefs";

vi.mock("../api/prefs", () => ({
  syncZoomMenu: vi.fn().mockResolvedValue(undefined),
  syncFilenameMenu: vi.fn().mockResolvedValue(undefined),
  setSetting: vi.fn().mockResolvedValue(undefined),
  getSetting: vi.fn().mockResolvedValue(null),
}));

const row = (id: number): ImageRow => ({
  id, path: `/d/${id}.png`, filename: `${id}.png`, thumb_path: null,
  width: 10, height: 10, pixels: 100, rating: null,
  created_at: null, modified_at: null, source_tool: "a1111", model: null,
});

beforeEach(() => {
  useQueryStore.setState({ results: [row(1), row(2), row(3)] });
  useViewerStore.setState({ isOpen: false, index: 0, selectedIndex: 0, zoomMode: "fit", scale: 1 });
});

describe("useViewerStore", () => {
  it("open sets isOpen and index", () => {
    useViewerStore.getState().open(1);
    expect(useViewerStore.getState().isOpen).toBe(true);
    expect(useViewerStore.getState().index).toBe(1);
  });

  it("next/prev clamp within results bounds", () => {
    useViewerStore.getState().open(0);
    useViewerStore.getState().next();
    expect(useViewerStore.getState().index).toBe(1);
    useViewerStore.getState().prev();
    expect(useViewerStore.getState().index).toBe(0);
    useViewerStore.getState().prev();
    expect(useViewerStore.getState().index).toBe(0);
  });

  it("next stops at last index", () => {
    useViewerStore.getState().open(2);
    useViewerStore.getState().next();
    expect(useViewerStore.getState().index).toBe(2);
  });

  it("close resets isOpen", () => {
    useViewerStore.getState().open(0);
    useViewerStore.getState().close();
    expect(useViewerStore.getState().isOpen).toBe(false);
  });

  it("setZoomMode changes mode and resets scale", () => {
    useViewerStore.getState().zoomBy(2);
    expect(useViewerStore.getState().zoomMode).toBe("custom");
    useViewerStore.getState().setZoomMode("fit");
    expect(useViewerStore.getState().zoomMode).toBe("fit");
    expect(useViewerStore.getState().scale).toBe(1);
  });

  it("zoomBy sets custom mode and multiplies scale (clamped)", () => {
    useViewerStore.getState().setZoomMode("fit");
    useViewerStore.getState().zoomBy(2);
    expect(useViewerStore.getState().zoomMode).toBe("custom");
    expect(useViewerStore.getState().scale).toBe(2);
  });

  it("open restores the previous zoom state (does not reset to fit)", () => {
    useViewerStore.getState().setZoomMode("fill");
    useViewerStore.getState().open(0);
    expect(useViewerStore.getState().zoomMode).toBe("fill");
  });

  it("cycleZoom advances fit -> actual -> fill -> fit", () => {
    useViewerStore.setState({ zoomMode: "fit", scale: 1 });
    useViewerStore.getState().cycleZoom();
    expect(useViewerStore.getState().zoomMode).toBe("actual");
    useViewerStore.getState().cycleZoom();
    expect(useViewerStore.getState().zoomMode).toBe("fill");
    useViewerStore.getState().cycleZoom();
    expect(useViewerStore.getState().zoomMode).toBe("fit");
  });

  it("toggleMeta flips metaOpen", () => {
    useViewerStore.setState({ metaOpen: true });
    useViewerStore.getState().toggleMeta();
    expect(useViewerStore.getState().metaOpen).toBe(false);
    useViewerStore.getState().toggleMeta();
    expect(useViewerStore.getState().metaOpen).toBe(true);
  });

  it("toggleNormalize flips normalizePrompt", () => {
    useViewerStore.setState({ normalizePrompt: false });
    useViewerStore.getState().toggleNormalize();
    expect(useViewerStore.getState().normalizePrompt).toBe(true);
    useViewerStore.getState().toggleNormalize();
    expect(useViewerStore.getState().normalizePrompt).toBe(false);
  });

  it("setZoomMode persists the zoom setting", () => {
    useViewerStore.getState().setZoomMode("fill");
    expect(prefsApi.setSetting).toHaveBeenCalledWith("zoom", "fill:1");
  });

  it("zoomBy persists the custom zoom setting", () => {
    useViewerStore.setState({ zoomMode: "fit", scale: 1 });
    useViewerStore.getState().zoomBy(2);
    expect(useViewerStore.getState().scale).toBe(2);
    expect(prefsApi.setSetting).toHaveBeenCalledWith("zoom", "custom:2");
  });

  it("loadZoom restores a valid persisted zoom", async () => {
    vi.mocked(prefsApi.getSetting).mockResolvedValue("custom:2.5");
    await useViewerStore.getState().loadZoom();
    expect(useViewerStore.getState().zoomMode).toBe("custom");
    expect(useViewerStore.getState().scale).toBe(2.5);
  });

  it("loadZoom ignores invalid persisted zoom", async () => {
    useViewerStore.setState({ zoomMode: "fit", scale: 1 });
    vi.mocked(prefsApi.getSetting).mockResolvedValue("bogus");
    await useViewerStore.getState().loadZoom();
    expect(useViewerStore.getState().zoomMode).toBe("fit");
    expect(useViewerStore.getState().scale).toBe(1);
  });
});

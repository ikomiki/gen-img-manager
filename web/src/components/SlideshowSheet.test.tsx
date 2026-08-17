import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SlideshowSheet } from "./SlideshowSheet";
import { useViewerStore } from "../store/useViewerStore";

beforeEach(() => {
  localStorage.clear();
  useViewerStore.setState({
    open: true,
    order: [0, 1, 2],
    pos: 0,
    scale: 1,
    chromeVisible: true,
    playing: false,
    intervalSec: 5,
    loop: true,
    shuffle: false,
  });
});

describe("SlideshowSheet", () => {
  it("間隔の選択肢を出し、現在値が選ばれている", () => {
    render(<SlideshowSheet open onClose={() => {}} />);
    expect((screen.getByLabelText("5秒") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("30秒") as HTMLInputElement).checked).toBe(false);
  });

  it("間隔を選ぶと保存される", () => {
    render(<SlideshowSheet open onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText("30秒"));

    expect(useViewerStore.getState().intervalSec).toBe(30);
    expect(JSON.parse(localStorage.getItem("gim.web.prefs")!).slideshow.intervalSec).toBe(30);
  });

  it("ループとシャッフルを切り替えられる", () => {
    render(<SlideshowSheet open onClose={() => {}} />);

    fireEvent.click(screen.getByLabelText("繰り返す"));
    expect(useViewerStore.getState().loop).toBe(false);

    fireEvent.click(screen.getByLabelText("順番をシャッフル"));
    expect(useViewerStore.getState().shuffle).toBe(true);
  });

  it("再生を始めるとシートが閉じ、バーも隠れる", () => {
    let open = true;
    const onClose = () => { open = false; };
    render(<SlideshowSheet open onClose={onClose} />);

    fireEvent.click(screen.getByText("再生"));

    expect(useViewerStore.getState().playing).toBe(true);
    expect(useViewerStore.getState().chromeVisible).toBe(false);
    expect(open).toBe(false);
  });
});

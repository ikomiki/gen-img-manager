import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DirectorySheet } from "./DirectorySheet";
import { useQueryStore } from "../store/useQueryStore";
import * as dirsApi from "../api/directories";
import * as imagesApi from "../api/images";

const DIRS = [
  { id: 1, label: "A1111", is_online: true, visible: true, image_count: 100 },
  { id: 2, label: "ComfyUI", is_online: true, visible: false, image_count: 208 },
  { id: 3, label: "外付け", is_online: false, visible: true, image_count: 5 },
];

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(dirsApi, "listDirectories").mockResolvedValue(DIRS);
  vi.spyOn(imagesApi, "listImages").mockResolvedValue([]);
  vi.spyOn(imagesApi, "countImages").mockResolvedValue({ total: 0 });
  useQueryStore.setState({ dirs: null });
});

afterEach(() => vi.restoreAllMocks());

describe("DirectorySheet", () => {
  it("ラベルと枚数を出す", async () => {
    render(<DirectorySheet open onClose={() => {}} />);
    expect(await screen.findByText("A1111")).toBeTruthy();
    expect(screen.getByText("208 枚")).toBeTruthy();
  });

  it("未指定のときは visible のものにチェックが入る", async () => {
    render(<DirectorySheet open onClose={() => {}} />);
    expect(((await screen.findByLabelText("A1111")) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("ComfyUI") as HTMLInputElement).checked).toBe(false);
  });

  it("チェックを変えると dirs が配列になる", async () => {
    render(<DirectorySheet open onClose={() => {}} />);
    fireEvent.click(await screen.findByLabelText("ComfyUI"));
    expect(useQueryStore.getState().dirs).toEqual(expect.arrayContaining([1, 2, 3]));
  });

  it("すべて解除すると空配列になる（未指定には戻らない）", async () => {
    render(<DirectorySheet open onClose={() => {}} />);
    fireEvent.click(await screen.findByText("すべて解除"));
    expect(useQueryStore.getState().dirs).toEqual([]);
  });

  it("オフラインのディレクトリに注記を出す", async () => {
    render(<DirectorySheet open onClose={() => {}} />);
    expect(await screen.findByText(/オフライン/)).toBeTruthy();
  });
});

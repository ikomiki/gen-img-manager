import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FilterBar } from "./FilterBar";
import { useQueryStore } from "../store/useQueryStore";
import * as imagesApi from "../api/images";

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(imagesApi, "listImages").mockResolvedValue([]);
  vi.spyOn(imagesApi, "countImages").mockResolvedValue({ total: 0 });
  useQueryStore.setState({ query: "", history: ["rating:5", "forest"], total: 42 });
});

afterEach(() => vi.restoreAllMocks());

describe("FilterBar", () => {
  it("件数を表示する", () => {
    render(<FilterBar onOpenFilter={() => {}} onOpenDirectories={() => {}} />);
    expect(screen.getByText("42 枚")).toBeTruthy();
  });

  it("フォーカスで履歴が開き、入力で絞り込まれる", () => {
    render(<FilterBar onOpenFilter={() => {}} onOpenDirectories={() => {}} />);
    const input = screen.getByPlaceholderText("検索");

    fireEvent.focus(input);
    expect(screen.getByText("rating:5")).toBeTruthy();
    expect(screen.getByText("forest")).toBeTruthy();

    fireEvent.change(input, { target: { value: "for" } });
    expect(screen.queryByText("rating:5")).toBeNull();
    expect(screen.getByText("forest")).toBeTruthy();
  });

  it("履歴をタップすると検索が走る", async () => {
    render(<FilterBar onOpenFilter={() => {}} onOpenDirectories={() => {}} />);
    fireEvent.focus(screen.getByPlaceholderText("検索"));
    fireEvent.click(screen.getByText("forest"));

    expect(useQueryStore.getState().query).toBe("forest");
    await vi.waitFor(() => expect(imagesApi.listImages).toHaveBeenCalled());
  });

  it("入力しただけでは検索しない", () => {
    render(<FilterBar onOpenFilter={() => {}} onOpenDirectories={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText("検索"), { target: { value: "x" } });
    expect(imagesApi.listImages).not.toHaveBeenCalled();
  });

  it("絞り込みボタンでコールバックが呼ばれる", () => {
    const onOpenFilter = vi.fn();
    render(<FilterBar onOpenFilter={onOpenFilter} onOpenDirectories={() => {}} />);
    fireEvent.click(screen.getByText("絞り込み"));
    expect(onOpenFilter).toHaveBeenCalled();
  });

  it("↓キーで履歴を1件ずつ選び、入力欄にプレビューされる", () => {
    render(<FilterBar onOpenFilter={() => {}} onOpenDirectories={() => {}} />);
    const input = screen.getByPlaceholderText("検索");

    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(useQueryStore.getState().query).toBe("rating:5");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(useQueryStore.getState().query).toBe("forest");
  });

  it("Escape で履歴が閉じる", () => {
    render(<FilterBar onOpenFilter={() => {}} onOpenDirectories={() => {}} />);
    const input = screen.getByPlaceholderText("検索");

    fireEvent.focus(input);
    expect(screen.getByText("forest")).toBeTruthy();

    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByText("forest")).toBeNull();
  });

  it("loading 中は読み込み中の帯が高さを持つ", () => {
    useQueryStore.setState({ loading: true });
    render(<FilterBar onOpenFilter={() => {}} onOpenDirectories={() => {}} />);
    expect(screen.getByRole("progressbar").style.height).toBe("2px");
  });

  it("loading でなければ帯は消える", () => {
    useQueryStore.setState({ loading: false });
    render(<FilterBar onOpenFilter={() => {}} onOpenDirectories={() => {}} />);
    expect(screen.getByRole("progressbar").style.height).toBe("0px");
  });
});

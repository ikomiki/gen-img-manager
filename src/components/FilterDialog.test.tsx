import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FilterDialog } from "./FilterDialog";
import { useQueryStore } from "../store/useQueryStore";
import type { ImageRow } from "../types";

vi.mock("../api/images");
vi.mock("../api/prefs");

const row = (id: number, created_at: number | null): ImageRow => ({
  id, path: `/d/${id}.png`, filename: `${id}.png`, thumb_path: null,
  width: 100, height: 100, pixels: 10000, rating: null,
  created_at, modified_at: null, source_tool: "a1111", model: null,
});

beforeEach(() => {
  useQueryStore.setState({
    query: 'prompt:"best quality" 1girl rating:>=4',
    sort: "filename", dir: "asc",
    results: [row(1, null)], total: 1, history: [], showFilename: true,
  });
  vi.resetAllMocks();
});

describe("FilterDialog", () => {
  it("populates controls from the current query on open", () => {
    render(<FilterDialog onClose={() => {}} />);
    expect((screen.getByLabelText("プロンプト") as HTMLInputElement).value).toBe("best quality");
    expect((screen.getByLabelText("レーティング下限") as HTMLSelectElement).value).toBe("4");
  });

  it("upserts managed fields and preserves the rest on apply", async () => {
    const setQuery = vi.fn();
    useQueryStore.setState({ setQuery, runQuery: vi.fn().mockResolvedValue(undefined) });

    render(<FilterDialog onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("プロンプト"), { target: { value: "forest cabin" } });
    fireEvent.click(screen.getByText("適用"));

    expect(setQuery).toHaveBeenCalled();
    const q = setQuery.mock.calls[0][0] as string;
    expect(q).toContain("1girl");
    expect(q).toContain("rating:>=4");
    expect(q).toContain('prompt:"forest cabin"');
  });

  it("round-trips a created date range unchanged on apply", () => {
    const setQuery = vi.fn();
    useQueryStore.setState({
      query: "created:2025-01-01..2025-01-03",
      setQuery,
      runQuery: vi.fn().mockResolvedValue(undefined),
    });

    render(<FilterDialog onClose={() => {}} />);
    fireEvent.click(screen.getByText("適用"));

    expect(setQuery).toHaveBeenCalledWith("created:2025-01-01..2025-01-03");
  });

  it("✕ ボタンでプロンプト入力をクリアできる", () => {
    render(<FilterDialog onClose={() => {}} />);
    const input = screen.getByLabelText("プロンプト") as HTMLInputElement;
    expect(input.value).toBe("best quality");
    fireEvent.click(screen.getByLabelText("プロンプトをクリア"));
    expect(input.value).toBe("");
  });

  it("背景クリックでは閉じない", () => {
    const onClose = vi.fn();
    const { container } = render(<FilterDialog onClose={onClose} />);
    fireEvent.click(container.querySelector(".dialog-backdrop")!);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("ESC で閉じる", () => {
    const onClose = vi.fn();
    render(<FilterDialog onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clears the created-from value when クリア is clicked", () => {
    const setQuery = vi.fn();
    useQueryStore.setState({
      query: "created:>=2025-02-10",
      setQuery,
      runQuery: vi.fn().mockResolvedValue(undefined),
    });

    render(<FilterDialog onClose={() => {}} />);
    // 開始のクリアボタン（開始フィールドが値を持つ時のみ表示）。
    fireEvent.click(screen.getAllByText("クリア")[0]);
    fireEvent.click(screen.getByText("適用"));

    const q = setQuery.mock.calls[0][0] as string;
    expect(q).toBe("");
  });
});

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

const pressed = (label: string) =>
  screen.getByLabelText(label).getAttribute("aria-pressed");

describe("FilterDialog", () => {
  it("populates controls from the current query on open", () => {
    render(<FilterDialog onClose={() => {}} />);
    expect((screen.getByLabelText("プロンプト") as HTMLInputElement).value).toBe('"best quality"');
    // rating:>=4 → ★4,★5 が ON、なし/★1/★2/★3 は OFF。
    expect(pressed("レーティング: ★4")).toBe("true");
    expect(pressed("レーティング: ★5")).toBe("true");
    expect(pressed("レーティング: ★3")).toBe("false");
    expect(pressed("レーティング: なし")).toBe("false");
  });

  it("upserts managed fields and preserves the rest on apply", async () => {
    const setQuery = vi.fn();
    useQueryStore.setState({ setQuery, runQuery: vi.fn().mockResolvedValue(undefined) });

    render(<FilterDialog onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("プロンプト"), { target: { value: "forest AND cabin" } });
    fireEvent.click(screen.getByText("適用"));

    expect(setQuery).toHaveBeenCalled();
    const q = setQuery.mock.calls[0][0] as string;
    expect(q).toContain("1girl");
    expect(q).toContain("rating:>=4"); // ★4,★5 のまま → >=4
    expect(q).toContain("prompt:(forest AND cabin)");
  });

  it("レーティングボタンのトグルで aria-pressed が切り替わる", () => {
    render(<FilterDialog onClose={() => {}} />);
    expect(pressed("レーティング: ★1")).toBe("false");
    fireEvent.click(screen.getByLabelText("レーティング: ★1"));
    expect(pressed("レーティング: ★1")).toBe("true");
    fireEvent.click(screen.getByLabelText("レーティング: ★1"));
    expect(pressed("レーティング: ★1")).toBe("false");
  });

  it("下限セレクトは N〜5 を ON・他を OFF に一括設定する", () => {
    render(<FilterDialog onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("レーティング下限"), { target: { value: "3" } });
    expect(pressed("レーティング: ★3")).toBe("true");
    expect(pressed("レーティング: ★4")).toBe("true");
    expect(pressed("レーティング: ★5")).toBe("true");
    expect(pressed("レーティング: ★2")).toBe("false");
    expect(pressed("レーティング: なし")).toBe("false");
    // セレクトは一瞬のアクションでプレースホルダへ戻る。
    expect((screen.getByLabelText("レーティング下限") as HTMLSelectElement).value).toBe("");
  });

  it("なし＋低評価の選択は集合構文 none,.. で書き出す", () => {
    const setQuery = vi.fn();
    useQueryStore.setState({
      query: "",
      setQuery,
      runQuery: vi.fn().mockResolvedValue(undefined),
    });
    render(<FilterDialog onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText("レーティング: なし"));
    fireEvent.click(screen.getByLabelText("レーティング: ★1"));
    fireEvent.click(screen.getByText("適用"));
    expect(setQuery).toHaveBeenCalledWith("rating:none,1");
  });

  it("全ボタン OFF なら rating トークンを出さない", () => {
    const setQuery = vi.fn();
    useQueryStore.setState({ setQuery, runQuery: vi.fn().mockResolvedValue(undefined) });
    render(<FilterDialog onClose={() => {}} />);
    // 既存の ★4,★5 を OFF にする。
    fireEvent.click(screen.getByLabelText("レーティング: ★4"));
    fireEvent.click(screen.getByLabelText("レーティング: ★5"));
    fireEvent.click(screen.getByText("適用"));
    const q = setQuery.mock.calls[0][0] as string;
    expect(q).not.toContain("rating:");
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
    expect(input.value).toBe('"best quality"');
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

  it("writes excludes from the prompt field as -prompt", () => {
    const setQuery = vi.fn();
    useQueryStore.setState({ query: "", setQuery, runQuery: vi.fn().mockResolvedValue(undefined) });
    render(<FilterDialog onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("プロンプト"), { target: { value: "forest -blurry" } });
    fireEvent.click(screen.getByText("適用"));
    expect(setQuery).toHaveBeenCalledWith("prompt:forest -prompt:blurry");
  });

  it("記法ヘルプ行を表示する", () => {
    render(<FilterDialog onClose={() => {}} />);
    expect(screen.getByText(/AND=両方/)).toBeTruthy();
  });

  it("年月ドロップダウンを表示する", () => {
    render(<FilterDialog onClose={() => {}} />);
    // captionLayout="dropdown" は月・年の <select> を描画する。
    const combos = screen.getAllByRole("combobox");
    // レーティング下限セレクト + 開始(月,年) + 終了(月,年) = 少なくとも 5 個。
    expect(combos.length).toBeGreaterThanOrEqual(5);
  });

  it("「終了月を開く」は終了日が未選択なら無効", () => {
    useQueryStore.setState({ query: "" });
    render(<FilterDialog onClose={() => {}} />);
    expect((screen.getByText("終了月を開く") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText("開始月を開く") as HTMLButtonElement).disabled).toBe(true);
  });

  it("相手の選択日があれば月ジャンプボタンが有効", () => {
    useQueryStore.setState({ query: "created:2025-03-10..2025-08-20" });
    render(<FilterDialog onClose={() => {}} />);
    // 開始=2025-03-10, 終了=2025-08-20 がともに選択済み。
    expect((screen.getByText("終了月を開く") as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByText("開始月を開く") as HTMLButtonElement).disabled).toBe(false);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FilterBar } from "./FilterBar";
import { useQueryStore } from "../store/useQueryStore";

vi.mock("../api/images");
vi.mock("../api/prefs");
vi.mock("../api/slideshow");

beforeEach(() => {
  useQueryStore.setState({
    query: "",
    sort: "filename",
    dir: "asc",
    results: [],
    total: 0,
    history: [],
    showFilename: true,
  });
  vi.resetAllMocks();
});

describe("FilterBar", () => {
  it("入力系とそれ以外を別グループで描画する", () => {
    const { container } = render(<FilterBar />);
    expect(container.querySelector(".fb-group-input")).not.toBeNull();
    expect(container.querySelector(".fb-group-actions")).not.toBeNull();
  });

  it("詳細ボタンは入力系グループに置く", () => {
    const { container } = render(<FilterBar />);
    const detail = screen.getByLabelText("詳細フィルタを開く");
    expect(container.querySelector(".fb-group-input")?.contains(detail)).toBe(true);
  });

  it("ファイル名トグルを FilterBar（それ以外グループ）に表示する", () => {
    const { container } = render(<FilterBar />);
    const actions = container.querySelector(".fb-group-actions");
    expect(actions?.querySelector(".filename-toggle")).not.toBeNull();
    expect(screen.getByText(/ファイル名/)).toBeTruthy();
  });

  it("再読込ボタンのクリックで runQuery を呼ぶ", () => {
    const runQuery = vi.fn().mockResolvedValue(undefined);
    useQueryStore.setState({ runQuery });
    render(<FilterBar />);
    fireEvent.click(screen.getByLabelText("再読込"));
    expect(runQuery).toHaveBeenCalledTimes(1);
  });

  it("再読込ボタンはそれ以外グループの検索ボタン直後に置く", () => {
    const { container } = render(<FilterBar />);
    const actions = container.querySelector(".fb-group-actions");
    const search = actions?.querySelector('[aria-label="検索"]');
    expect(search?.nextElementSibling?.getAttribute("aria-label")).toBe("再読込");
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FilterSheet } from "./FilterSheet";
import { useQueryStore } from "../store/useQueryStore";
import * as imagesApi from "../api/images";
import { extractField } from "@gim/shared/queryTokens";

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  vi.spyOn(imagesApi, "listImages").mockResolvedValue([]);
  vi.spyOn(imagesApi, "countImages").mockResolvedValue({ total: 0 });
  useQueryStore.setState({ query: "", history: [] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("FilterSheet", () => {
  it("レーティングを選ぶとクエリ文字列に反映される", () => {
    render(<FilterSheet open onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText("レーティング 5"));
    expect(extractField(useQueryStore.getState().query, "rating")).toBe(">=5");
  });

  it("既存のクエリからフォームの初期値を復元する", () => {
    useQueryStore.setState({ query: "rating:3,5 width:>=1024" });
    render(<FilterSheet open onClose={() => {}} />);

    expect((screen.getByLabelText("レーティング 3") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("レーティング 5") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("レーティング 1") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText("幅") as HTMLInputElement).value).toBe(">=1024");
  });

  it("フリーワード部分を壊さない", () => {
    useQueryStore.setState({ query: "forest cabin" });
    render(<FilterSheet open onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("幅"), { target: { value: ">=512" } });

    const q = useQueryStore.getState().query;
    expect(q).toContain("forest");
    expect(q).toContain("cabin");
    expect(q).toContain("width:>=512");
  });

  it("値を空にするとフィールドが消える", () => {
    useQueryStore.setState({ query: "width:>=1024" });
    render(<FilterSheet open onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("幅"), { target: { value: "" } });
    expect(useQueryStore.getState().query).not.toContain("width:");
  });

  it("レーティングを選ぶと即座に検索が走る", async () => {
    render(<FilterSheet open onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText("レーティング 5"));
    await vi.waitFor(() => expect(imagesApi.listImages).toHaveBeenCalled());
  });

  it("自由入力はすぐには検索せず、少し待ってから走る", async () => {
    render(<FilterSheet open onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("幅"), { target: { value: ">=1024" } });

    expect(imagesApi.listImages).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    expect(imagesApi.listImages).toHaveBeenCalled();
  });

  it("閉じるときに履歴へ記録する", async () => {
    const onClose = vi.fn();
    useQueryStore.setState({ query: "rating:>=5", history: [] });
    const { rerender } = render(<FilterSheet open onClose={onClose} />);

    rerender(<FilterSheet open={false} onClose={onClose} />);
    await vi.waitFor(() => expect(useQueryStore.getState().history).toEqual(["rating:>=5"]));
  });

  it("クリアはシートの全項目を消すが、フリーワードは残す", () => {
    useQueryStore.setState({ query: "forest prompt:cabin rating:>=4 width:>=1024" });
    render(<FilterSheet open onClose={() => {}} />);
    fireEvent.click(screen.getByText("クリア"));

    const q = useQueryStore.getState().query;
    expect(q).toContain("forest");
    expect(q).not.toContain("prompt:");
    expect(q).not.toContain("rating:");
    expect(q).not.toContain("width:");
  });
});

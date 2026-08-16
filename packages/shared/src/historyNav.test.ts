import { describe, it, expect } from "vitest";
import { historyNav } from "./historyNav";

const HISTORY = ["newest", "middle", "oldest"]; // index 0 = 最新

const base = {
  open: false,
  index: -1,
  items: [] as string[],
  query: "",
  draft: "",
  history: HISTORY,
};

describe("historyNav — 閉じた状態から開く", () => {
  it("ArrowDown は開いて先頭(最新)をハイライトし、現在の入力を draft に保持する", () => {
    const r = historyNav({ ...base, key: "ArrowDown" });
    expect(r).toEqual({
      open: true,
      index: 0,
      items: HISTORY,
      query: "newest",
      draft: "",
    });
  });

  it("ArrowUp は開いて末尾(最古)をハイライトする", () => {
    const r = historyNav({ ...base, key: "ArrowUp" });
    expect(r.open).toBe(true);
    expect(r.index).toBe(2);
    expect(r.query).toBe("oldest");
  });

  it("開く時に現在の入力を draft として捕捉し、入力でフィルタする", () => {
    const r = historyNav({ ...base, key: "ArrowDown", query: "mid" });
    expect(r.items).toEqual(["middle"]);
    expect(r.index).toBe(0);
    expect(r.query).toBe("middle");
    expect(r.draft).toBe("mid");
  });

  it("候補が無い時は状態を変えない", () => {
    const r = historyNav({ ...base, key: "ArrowDown", query: "zzz" });
    expect(r).toEqual({ open: false, index: -1, items: [], query: "zzz", draft: "" });
  });

  it("入力が空白のみなら全履歴を使う", () => {
    const r = historyNav({ ...base, key: "ArrowDown", query: "  " });
    expect(r.items).toEqual(HISTORY);
  });
});

describe("historyNav — 開いた状態でのナビゲーション", () => {
  const open = { ...base, open: true, items: HISTORY, draft: "draft" };

  it("ArrowDown は古い方へ進み、末尾でクランプする", () => {
    expect(historyNav({ ...open, key: "ArrowDown", index: 0 }).index).toBe(1);
    expect(historyNav({ ...open, key: "ArrowDown", index: 2 }).index).toBe(2);
  });

  it("ArrowDown は選択解除(-1)から先頭(0)へ", () => {
    const r = historyNav({ ...open, key: "ArrowDown", index: -1 });
    expect(r.index).toBe(0);
    expect(r.query).toBe("newest");
  });

  it("ArrowUp は新しい方へ進む", () => {
    const r = historyNav({ ...open, key: "ArrowUp", index: 2 });
    expect(r.index).toBe(1);
    expect(r.query).toBe("middle");
  });

  it("ArrowUp は先頭(0)からさらに上で選択解除し draft を復元する", () => {
    const r = historyNav({ ...open, key: "ArrowUp", index: 0 });
    expect(r.index).toBe(-1);
    expect(r.query).toBe("draft");
  });

  it("ArrowUp は選択解除(-1)では解除のまま draft を表示する", () => {
    const r = historyNav({ ...open, key: "ArrowUp", index: -1 });
    expect(r.index).toBe(-1);
    expect(r.query).toBe("draft");
  });

  it("プレビューはハイライト中の候補を反映する", () => {
    expect(historyNav({ ...open, key: "ArrowDown", index: 0 }).query).toBe("middle");
  });
});

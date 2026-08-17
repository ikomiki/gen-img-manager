import { matchHistory } from "./historyMatch";

export type NavKey = "ArrowDown" | "ArrowUp";

export interface NavInput {
  key: NavKey;
  open: boolean;
  index: number;
  items: string[];
  query: string;
  draft: string;
  history: string[];
}

export interface NavResult {
  open: boolean;
  index: number;
  items: string[];
  query: string;
  draft: string;
}

/** 候補の算出。入力が空なら全履歴、そうでなければマッチ候補。フォーカス／入力経路と矢印キー経路の両方から使う。 */
export function openItems(query: string, history: string[]): string[] {
  return query.trim() === "" ? history : matchHistory(query, history);
}

/**
 * フィルタ入力欄での ↑/↓ による履歴ナビゲーションの次状態を計算する純粋関数。
 * - 閉じている（または候補が空）なら開く: ↓は先頭(最新)、↑は末尾(最古)をハイライト。
 *   このとき現在の入力を draft として保持する。
 * - 開いているなら: ↓は1つ下(古い方)へ、末尾でクランプ。-1からは0へ。
 *   ↑は1つ上(新しい方)へ、先頭(0)からさらに上で選択解除(index=-1)し draft を復元。
 * - ナビ中は入力欄に候補（解除時は draft）をプレビュー表示する（query で返す）。
 */
export function historyNav(input: NavInput): NavResult {
  const { key, open, index, items, query, draft, history } = input;

  if (!open || items.length === 0) {
    const fresh = openItems(query, history);
    if (fresh.length === 0) {
      return { open, index, items, query, draft };
    }
    const newIndex = key === "ArrowDown" ? 0 : fresh.length - 1;
    return {
      open: true,
      index: newIndex,
      items: fresh,
      query: fresh[newIndex],
      draft: query,
    };
  }

  if (key === "ArrowDown") {
    const next = index < 0 ? 0 : Math.min(index + 1, items.length - 1);
    return { open: true, index: next, items, query: items[next], draft };
  }

  // ArrowUp（開いている）
  const next = Math.max(index - 1, -1);
  return {
    open: true,
    index: next,
    items,
    query: next === -1 ? draft : items[next],
    draft,
  };
}

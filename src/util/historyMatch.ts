/**
 * フィルタ入力 `input` に対し、履歴 `history` からオートコンプリート候補を返す。
 * - 大文字小文字を区別しない部分一致（contains）。
 * - 入力と（大小無視で）完全一致する履歴は候補から除外する。
 * - 入力が空白のみ/空のときは履歴全件をそのまま返す（全件ブラウズ用）。
 * - 履歴の元の並び順を保持する。
 */
export function matchHistory(input: string, history: string[]): string[] {
  const q = input.trim().toLowerCase();
  if (q === "") return history;
  return history.filter((h) => {
    const hl = h.toLowerCase();
    return hl.includes(q) && hl !== q;
  });
}

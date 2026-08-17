/**
 * クエリ履歴へ1件記録する。Rust の db::history::record と同じ規則。
 * 空は無視、既存の同一文字列は先頭へ昇格（重複を作らない）、上限超過は古いものから捨てる。
 */
export function recordHistory(history: string[], query: string, max: number): string[] {
  const trimmed = query.trim();
  if (!trimmed) return history;
  return [trimmed, ...history.filter((h) => h !== trimmed)].slice(0, max);
}

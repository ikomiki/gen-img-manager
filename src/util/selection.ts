/**
 * 画像一覧の複数選択で使う、選択集合（results のインデックス Set）を操作する純粋関数群。
 * いずれも入力の Set を破壊せず新しい Set を返す。
 */

/** anchor..index（両端含む）を昇順に正規化した集合。 */
export function rangeSet(anchor: number, index: number): Set<number> {
  const lo = Math.min(anchor, index);
  const hi = Math.max(anchor, index);
  const out = new Set<number>();
  for (let i = lo; i <= hi; i++) out.add(i);
  return out;
}

/** index を集合へトグル（非破壊）。 */
export function toggleInSet(set: Set<number>, index: number): Set<number> {
  const next = new Set(set);
  if (next.has(index)) next.delete(index);
  else next.add(index);
  return next;
}

/** 0..count-1 の全インデックス集合。 */
export function allIndices(count: number): Set<number> {
  const out = new Set<number>();
  for (let i = 0; i < count; i++) out.add(i);
  return out;
}

/**
 * 一括削除後のアクティブ index。削除した最小 index 付近へクランプする。
 * 残件 0 なら -1（選択なし）。
 */
export function clampAfterDelete(removedMinIndex: number, remaining: number): number {
  if (remaining <= 0) return -1;
  return Math.min(removedMinIndex, remaining - 1);
}

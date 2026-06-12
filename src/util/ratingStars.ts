/** レーティング値を長さ5の塗り真偽配列へ変換する（先頭 rating 個が true）。範囲外は丸める。 */
export function ratingStarFills(rating: number | null): boolean[] {
  const n = Math.max(0, Math.min(5, rating ?? 0));
  return [1, 2, 3, 4, 5].map((i) => i <= n);
}

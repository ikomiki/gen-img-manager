/** fromIndex より後ろで最初に rating==null の index を返す。無ければ -1。 */
export function nextUnratedIndex(
  results: { rating: number | null }[],
  fromIndex: number,
): number {
  for (let i = fromIndex + 1; i < results.length; i++) {
    if (results[i].rating == null) return i;
  }
  return -1;
}

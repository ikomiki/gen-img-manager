/** cur を delta だけ移動し [0, len-1] にクランプする。len<=0 のときは 0。 */
export function moveIndex(cur: number, len: number, delta: number): number {
  if (len <= 0) return 0;
  return Math.min(len - 1, Math.max(0, cur + delta));
}

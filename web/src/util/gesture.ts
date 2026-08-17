export type SwipeAction = "prev" | "next" | "none";

/** これ未満の横移動は送りとみなさない。 */
const MIN_DISTANCE = 50;
/** 縦移動が横移動のこの割合以上なら、スクロールの意図とみなして送らない。 */
const MAX_OFF_AXIS_RATIO = 0.6;
/** これより長くかかった動きはパンとみなして送らない。 */
const MAX_DURATION_MS = 800;

export const MAX_SCALE = 6;

/** 指の移動量から送り方向を決める。dx が負（左へ引いた）なら次の画像。 */
export function swipeAction(dx: number, dy: number, dtMs: number): SwipeAction {
  if (dtMs > MAX_DURATION_MS) return "none";
  const ax = Math.abs(dx);
  if (ax < MIN_DISTANCE) return "none";
  if (Math.abs(dy) >= ax * MAX_OFF_AXIS_RATIO) return "none";
  return dx < 0 ? "next" : "prev";
}

/** これ未満の移動と時間で指を離したらタップ（＝UI の表示切替）とみなす。 */
const TAP_SLOP = 10;
const TAP_DURATION_MS = 300;

export function isTap(dx: number, dy: number, dtMs: number): boolean {
  return Math.abs(dx) < TAP_SLOP && Math.abs(dy) < TAP_SLOP && dtMs < TAP_DURATION_MS;
}

export function distance(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(bx - ax, by - ay);
}

/**
 * 2本指の距離の比から倍率を出す。1 未満に縮むと画像が画面から消えるので下限を 1 に置く。
 * 開始距離が 0 のときは、まだ測れていないので倍率を変えない。
 */
export function pinchScale(startDist: number, dist: number, startScale: number): number {
  if (startDist <= 0) return startScale;
  const next = startScale * (dist / startDist);
  return Math.min(MAX_SCALE, Math.max(1, next));
}

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

/**
 * `object-fit: contain` で要素の矩形に絵を収めたときに、実際に絵が描かれる大きさ。
 *
 * 要素の矩形と絵の大きさは一致しない。「常に画面にあわせる」モードでは要素へ
 * `width: 100%` / `height: 100%` を与えるので、要素は表示領域いっぱいになり、
 * 縦横比の差の分だけ絵より大きくなる。パンの上限を要素の矩形で決めると、
 * 絵の外の余白まで動けてしまう。
 *
 * 自然サイズが分からない（読み込み前で 0）ときは矩形をそのまま返す。制限しない側に
 * 倒すのは、測れないのに中央固定すると動かせなくなるため。
 */
export function containedSize(
  natW: number,
  natH: number,
  boxW: number,
  boxH: number,
): { w: number; h: number } {
  if (natW <= 0 || natH <= 0 || boxW <= 0 || boxH <= 0) return { w: boxW, h: boxH };
  const s = Math.min(boxW / natW, boxH / natH);
  return { w: natW * s, h: natH * s };
}

/**
 * パンの位置を「拡大後の画像が表示領域を覆う」範囲へ収める。
 * 画像は表示領域の中央に置いて transform でずらすので、ずらせる量は片側
 * (拡大後のサイズ - 表示領域のサイズ) / 2 まで。拡大してもまだ表示領域より小さい軸は
 * 上限が 0 になり中央へ固定される（動かしても余白しか出ないため）。
 *
 * 受け取るのは**拡大後**のサイズ。呼び出し側が倍率を掛けた値ではなく実測値を渡せるように
 * してあるのは、`offsetHeight` のような整数へ丸められた値から計算すると端に 1px 弱の
 * 余白が残るため（丸め誤差が倍率の分だけ拡大される）。
 *
 * 寸法が 0（レイアウト前で測れていない）のときは制限しない。測れないのに中央固定すると
 * 動かせなくなるので、一時的に自由に動く方を選ぶ。
 */
export function clampPan(
  offset: { x: number; y: number },
  scaledW: number,
  scaledH: number,
  viewW: number,
  viewH: number,
): { x: number; y: number } {
  if (scaledW <= 0 || scaledH <= 0 || viewW <= 0 || viewH <= 0) return offset;
  const maxX = Math.max(0, (scaledW - viewW) / 2);
  const maxY = Math.max(0, (scaledH - viewH) / 2);
  return {
    x: Math.min(maxX, Math.max(-maxX, offset.x)),
    y: Math.min(maxY, Math.max(-maxY, offset.y)),
  };
}

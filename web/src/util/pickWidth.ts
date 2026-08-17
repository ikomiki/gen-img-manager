/** サーバ（crates/server/src/resize.rs）が受け付ける値と一致させる。 */
export const ALLOWED_WIDTHS: readonly number[] = [640, 1280, 1920, 2560];

const MAX = ALLOWED_WIDTHS[ALLOWED_WIDTHS.length - 1];

/**
 * 要求する `w` を選ぶ。サーバの `w` は幅ではなく**長辺の上限**なので、
 * 渡すのは「画面上で画像の長辺が何 CSS ピクセルになるか」。
 */
export function pickWidth(longEdgeCssPx: number, dpr: number): number {
  const want = Math.min(Math.max(longEdgeCssPx, 0) * dpr, MAX);
  return ALLOWED_WIDTHS.find((w) => w >= want) ?? MAX;
}

/**
 * 画像を画面に「収めて」表示したときの長辺の CSS ピクセル数。
 * 画像サイズが分かる前（naturalWidth が 0）は画面の長辺で近似する。
 */
export function containedLongEdge(
  imgW: number,
  imgH: number,
  viewW: number,
  viewH: number,
): number {
  if (imgW <= 0 || imgH <= 0) return Math.max(viewW, viewH);
  const scale = Math.min(viewW / imgW, viewH / imgH);
  return Math.max(imgW * scale, imgH * scale);
}

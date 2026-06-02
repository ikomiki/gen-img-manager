import type { ZoomMode } from "../types";

const VALID_MODES: ZoomMode[] = ["fit", "actual", "fill", "custom"];

/** ズーム設定を `"mode:scale"` 形式の文字列へ直列化する。 */
export function serializeZoom(mode: ZoomMode, scale: number): string {
  return `${mode}:${scale}`;
}

/**
 * 永続化されたズーム設定文字列を解釈する。
 * 不正値（null・未知モード・数値化できない/非正の scale・形式不正）は null を返し、
 * 呼び出し側でデフォルトへフォールバックさせる。
 */
export function parseZoom(raw: string | null): { mode: ZoomMode; scale: number } | null {
  if (!raw) return null;
  const sep = raw.indexOf(":");
  if (sep < 0) return null;
  const modePart = raw.slice(0, sep);
  const scalePart = raw.slice(sep + 1);
  if (!VALID_MODES.includes(modePart as ZoomMode)) return null;
  const scale = Number(scalePart);
  if (!Number.isFinite(scale) || scale <= 0) return null;
  return { mode: modePart as ZoomMode, scale };
}

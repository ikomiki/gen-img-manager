import type { ZoomMode } from "../types";

/** Z キーで循環するズームモードの並び順。custom は循環対象外。 */
const CYCLE: ZoomMode[] = ["fit", "actual", "fill"];

/** 現在のズームモードから次のモードを返す。custom など循環外は fit に戻す。 */
export function nextZoomMode(current: ZoomMode): ZoomMode {
  const i = CYCLE.indexOf(current);
  if (i < 0) return "fit";
  return CYCLE[(i + 1) % CYCLE.length];
}

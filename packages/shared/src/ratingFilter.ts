/**
 * 詳細フィルタの「レーティング」欄（なし/1〜5の独立オンオフ）と
 * クエリの rating トークン値を相互変換する純粋ユーティリティ。
 *
 * クエリ表現（バックエンド src-tauri/src/query/parse.rs と同仕様）:
 * - 全OFF / 全6個ON → トークンなし（null）。
 * - N〜5の上位連続（なし含まず） → ">=N"（従来表記を維持）。
 * - それ以外（なし含む・飛び・低評価のみ） → "none,1,3" のカンマ集合（未評価は none）。
 * 読み込み時は ">=N" / "<=N" / "<N" / ">N" / "A..B" / カンマ集合 / 単一値も解釈する。
 */

/** ボタン1つ分の値。"none" は未評価（rating IS NULL）。 */
export type RatingValue = "none" | 1 | 2 | 3 | 4 | 5;

/** UI 上のボタン順（なしが先頭、以降 1〜5）。 */
export const RATING_VALUES: readonly RatingValue[] = ["none", 1, 2, 3, 4, 5];

const NUMERIC: readonly RatingValue[] = [1, 2, 3, 4, 5];

/** 1〜5 の整数だけ集合へ追加するヘルパ（範囲外は無視）。 */
function addRange(out: Set<RatingValue>, lo: number, hi: number): void {
  for (let n = Math.max(1, lo); n <= Math.min(5, hi); n++) {
    out.add(n as RatingValue);
  }
}

/** rating トークン値（"rating:" の後ろ）をボタン集合へ分解。 */
export function parseRatingToken(value: string | null): Set<RatingValue> {
  const out = new Set<RatingValue>();
  if (!value) return out;

  if (value.startsWith(">=")) {
    const n = Number(value.slice(2));
    if (Number.isInteger(n)) addRange(out, n, 5);
    return out;
  }
  if (value.startsWith("<=")) {
    const n = Number(value.slice(2));
    if (Number.isInteger(n)) addRange(out, 1, n);
    return out;
  }
  if (value.startsWith(">")) {
    const n = Number(value.slice(1));
    if (Number.isInteger(n)) addRange(out, n + 1, 5);
    return out;
  }
  if (value.startsWith("<")) {
    const n = Number(value.slice(1));
    if (Number.isInteger(n)) addRange(out, 1, n - 1);
    return out;
  }
  if (value.includes("..")) {
    const [a, b] = value.split("..");
    const lo = Number(a);
    const hi = Number(b);
    if (Number.isInteger(lo) && Number.isInteger(hi)) addRange(out, lo, hi);
    return out;
  }

  // カンマ集合 / bare none / 単一整数。
  for (const part of value.split(",")) {
    const p = part.trim();
    if (p === "none") {
      out.add("none");
    } else {
      const n = Number(p);
      if (Number.isInteger(n) && n >= 1 && n <= 5) out.add(n as RatingValue);
    }
  }
  return out;
}

/** ボタン集合を rating トークン値へ。フィルタ不要なら null。 */
export function buildRatingToken(sel: Set<RatingValue>): string | null {
  if (sel.size === 0 || sel.size === RATING_VALUES.length) return null;

  const nums = NUMERIC.filter((n) => sel.has(n)) as number[];
  const hasNone = sel.has("none");

  // なしを含まず、N〜5の上位連続なら >=N。
  if (!hasNone && nums.length > 0 && nums[nums.length - 1] === 5) {
    const min = nums[0];
    const isContiguousTop = nums.length === 5 - min + 1;
    if (isContiguousTop) return `>=${min}`;
  }

  // それ以外はカンマ集合（none 先頭、数値は昇順）。
  const parts: string[] = [];
  if (hasNone) parts.push("none");
  parts.push(...nums.map(String));
  return parts.join(",");
}

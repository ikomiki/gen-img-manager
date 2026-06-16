/** isApplyEnter の入力。KeyboardEvent から必要な値だけ抜き出した形。 */
export interface ApplyEnterInput {
  /** KeyboardEvent.key。 */
  key: string;
  /** 変換確定途中か（KeyboardEvent.isComposing / nativeEvent.isComposing）。 */
  isComposing: boolean;
  /** KeyboardEvent.keyCode。IME 変換中は多くの環境で 229。 */
  keyCode: number;
  /** イベント発生元要素の tagName（大文字、例 "INPUT"）。 */
  tagName: string;
  /** 発生元が <input> のときの type 属性。それ以外は ""。 */
  inputType: string;
}

/**
 * フィルタダイアログで Enter を「適用」とみなすか。
 * テキスト/数値入力欄での Enter のみ true。IME 変換確定の Enter（isComposing / keyCode 229）は除外。
 * select・DayPicker・各 <button> 上の Enter はネイティブ挙動を維持するため false。
 */
export function isApplyEnter(e: ApplyEnterInput): boolean {
  if (e.key !== "Enter") return false;
  if (e.isComposing || e.keyCode === 229) return false;
  if (e.tagName !== "INPUT") return false;
  return e.inputType === "text" || e.inputType === "number";
}

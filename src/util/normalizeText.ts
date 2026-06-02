/**
 * prompt / negative 表示用の整形。
 * - 各行の行頭・行末の空白を除去する
 * - 空行を除去する
 * - カンマ（および空白）だけの行を除去する
 */
export function normalizePromptText(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.replace(/,/g, "").trim() !== "")
    .join("\n");
}

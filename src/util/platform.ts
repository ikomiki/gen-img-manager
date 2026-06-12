/** Webview の userAgent から macOS かを判定する。 */
export function isMac(): boolean {
  return typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent);
}

/**
 * フルスクリーン切替キー押下かを判定する。
 * macOS: Option+Command+F（Option併用時 e.key は特殊文字になるため e.code で判定）。
 * その他: F11。
 */
export function isFullscreenToggleKey(
  e: Pick<KeyboardEvent, "altKey" | "metaKey" | "code" | "key">,
): boolean {
  if (isMac()) {
    return e.altKey && e.metaKey && e.code === "KeyF";
  }
  return e.key === "F11";
}

/**
 * Command（macOS）/ Ctrl（その他）の主修飾キーを伴う入力かを判定する。
 * 単独キーのアプリショートカット（c=パスコピー等）は、Cmd+C による選択テキストの
 * コピーなどブラウザ標準操作を奪わないよう、これが true の間は発火させない。
 */
export function hasPrimaryModifier(
  e: Pick<KeyboardEvent, "metaKey" | "ctrlKey">,
): boolean {
  return e.metaKey || e.ctrlKey;
}

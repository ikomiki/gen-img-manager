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

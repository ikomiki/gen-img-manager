/**
 * 修飾キーが1つも押されていない状態でのキー一致。
 * 「Cmd を含む」程度の緩い判定は、より多くの修飾キーを伴う別ショートカットを
 * 巻き込んで preventDefault してしまうため、完全一致で判定する。
 */
export function isPlainKey(
  e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">,
  key: string,
): boolean {
  return e.key === key && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey;
}

/** 文字入力中の要素にフォーカスがあるか。ショートカットを横取りしない判断に使う。 */
export function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  // jsdom は isContentEditable を実装しておらず常に undefined を返すため、
  // 属性を直接見て jsdom テスト環境と実ブラウザの両方で判定できるようにする。
  return t.isContentEditable === true || t.getAttribute("contenteditable") === "true";
}

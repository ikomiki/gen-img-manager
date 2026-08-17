/**
 * iPhone の Safari は要素のフルスクリーンを実装していない（iPadOS は実装している）。
 * 使えない環境ではボタンを出さないので、判定はここに集める。
 * `fullscreenEnabled` だけを見ないのは、埋め込みの permissions policy で false に
 * なることはあっても、逆に true でメソッドが無い環境を除けないため。
 */
export function isFullscreenSupported(): boolean {
  if (typeof document === "undefined") return false;
  return (
    document.fullscreenEnabled === true &&
    typeof Element.prototype.requestFullscreen === "function"
  );
}

export function isFullscreen(): boolean {
  return typeof document !== "undefined" && document.fullscreenElement !== null;
}

/**
 * 入っていれば出る、出ていれば入る。
 * 失敗を握り潰すのは、フルスクリーンに入れなくても閲覧そのものは続けられるため。
 * `catch` を両方に付けるのは、要求がユーザ操作起点でないと Promise が reject し、
 * 未処理の拒否としてコンソールに出るのを避けるため。
 */
export function toggleFullscreen(el: HTMLElement | null): void {
  if (!el) return;
  try {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    else el.requestFullscreen?.().catch(() => {});
  } catch {
    // 上記コメントのとおり、入れなくても無視して続ける。
  }
}

import { useEffect } from "react";
import type { RefObject } from "react";
import { useViewerStore } from "../store/useViewerStore";
import { isPlainKey, isTypingTarget } from "../util/keys";

interface Options {
  /** シートが開いている間などは切る。 */
  enabled: boolean;
  /** F キーでフルスクリーンにする要素。 */
  rootRef: RefObject<HTMLElement | null>;
}

export function useViewerKeys({ enabled, rootRef }: Options): void {
  const go = useViewerStore((s) => s.go);
  const pause = useViewerStore((s) => s.pause);
  const play = useViewerStore((s) => s.play);
  const close = useViewerStore((s) => s.close);

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (isPlainKey(e, "ArrowRight")) {
        e.preventDefault();
        go(1);
      } else if (isPlainKey(e, "ArrowLeft")) {
        e.preventDefault();
        go(-1);
      } else if (isPlainKey(e, " ")) {
        // Space はページスクロールの既定動作を持つ。
        e.preventDefault();
        if (useViewerStore.getState().playing) pause();
        else play();
      } else if (isPlainKey(e, "Escape")) {
        e.preventDefault();
        close();
      } else if (isPlainKey(e, "f")) {
        e.preventDefault();
        toggleFullscreen(rootRef.current);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [enabled, go, pause, play, close, rootRef]);
}

/** iOS Safari は要素のフルスクリーンを実装していない。使えない環境では何もしない。 */
function toggleFullscreen(el: HTMLElement | null): void {
  if (!el) return;
  try {
    if (document.fullscreenElement) void document.exitFullscreen?.();
    else void el.requestFullscreen?.();
  } catch {
    // フルスクリーンに入れなくても閲覧そのものは続けられる。
  }
}

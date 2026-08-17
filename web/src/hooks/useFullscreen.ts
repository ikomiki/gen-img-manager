import { useCallback, useEffect, useState } from "react";
import type { RefObject } from "react";
import { isFullscreen, isFullscreenSupported, toggleFullscreen } from "../util/fullscreen";

interface Fullscreen {
  /** 対応していない環境（iPhone Safari）ではボタンを出さない。 */
  supported: boolean;
  active: boolean;
  toggle: () => void;
}

/**
 * `fullscreenchange` を購読して現在の状態を返す。イベントで追うのは、Esc や
 * ブラウザ UI からの離脱でもボタンの見た目を合わせる必要があるため。
 */
export function useFullscreen(ref: RefObject<HTMLElement | null>): Fullscreen {
  const [active, setActive] = useState(isFullscreen);

  useEffect(() => {
    const onChange = () => setActive(isFullscreen());
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  return {
    supported: isFullscreenSupported(),
    active,
    toggle: useCallback(() => toggleFullscreen(ref.current), [ref]),
  };
}

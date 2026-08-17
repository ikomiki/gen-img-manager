import { useEffect } from "react";
import { useViewerStore } from "../store/useViewerStore";

/**
 * 自動送りの計時。`settled`（表示中の画像の読み込みが決着したか）が立ってから数え始める。
 * 読み込み前から数えると、遅い画像は表示時間を削られたり表示前に送られたりする。
 * 失敗も決着に数えるのは、消えた画像やオフラインドライブのタイムアウトで止まらないため。
 */
export function useSlideshowTimer(settled: boolean): void {
  const playing = useViewerStore((s) => s.playing);
  const intervalSec = useViewerStore((s) => s.intervalSec);
  const go = useViewerStore((s) => s.go);

  useEffect(() => {
    if (!playing || !settled) return;
    const id = setTimeout(() => go(1), intervalSec * 1000);
    return () => clearTimeout(id);
  }, [playing, settled, intervalSec, go]);
}

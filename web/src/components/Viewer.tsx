import { useEffect, useMemo } from "react";
import { useQueryStore } from "../store/useQueryStore";
import { useViewerStore } from "../store/useViewerStore";
import { imageUrl } from "../api/images";
import { containedLongEdge, pickWidth } from "../util/pickWidth";
import { createPreloader } from "../util/preloader";
import { buttonStyle } from "../ui";

/** 末尾からこの枚数以内に来たら次のページを取りにいく。 */
const LOAD_MORE_MARGIN = 5;
/** 何枚先まで先読みするか。 */
const PRELOAD_AHEAD = 2;

export function Viewer() {
  const open = useViewerStore((s) => s.open);
  const order = useViewerStore((s) => s.order);
  const pos = useViewerStore((s) => s.pos);
  const chromeVisible = useViewerStore((s) => s.chromeVisible);
  const close = useViewerStore((s) => s.close);
  const go = useViewerStore((s) => s.go);
  const toggleChrome = useViewerStore((s) => s.toggleChrome);
  const syncLength = useViewerStore((s) => s.syncLength);

  const results = useQueryStore((s) => s.results);
  const exhausted = useQueryStore((s) => s.exhausted);
  const loadMore = useQueryStore((s) => s.loadMore);

  const preloader = useMemo(() => createPreloader(), []);

  // 一覧が伸び縮みしたら再生順序を作り直す。
  useEffect(() => {
    syncLength(results.length);
  }, [results.length, syncLength]);

  // 末尾に近づいたら次のページを取る。ビューアだけで 17,000 枚を送れるように。
  useEffect(() => {
    if (!open || exhausted) return;
    if (pos >= order.length - LOAD_MORE_MARGIN) void loadMore();
  }, [open, exhausted, pos, order.length, loadMore]);

  const image = open ? results[order[pos]] : undefined;

  // 先読み。表示中と同じ幅を要求しないと別のキャッシュエントリになって無駄になる。
  useEffect(() => {
    if (!open) return;
    for (let i = 1; i <= PRELOAD_AHEAD; i++) {
      const next = results[order[pos + i]];
      if (next) preloader.preload(imageUrl(next.id, widthFor(next.width, next.height)));
    }
  }, [open, order, pos, results, preloader]);

  if (!open || !image) return null;

  const src = imageUrl(image.id, widthFor(image.width, image.height));

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 20,
        background: "var(--bg-media)",
        display: "flex",
        flexDirection: "column",
        // 画像を送るたびに文字選択が走ると、長押しで選択ハンドルが出て邪魔になる。
        userSelect: "none",
        WebkitUserSelect: "none",
      }}
    >
      {chromeVisible && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "env(safe-area-inset-top, 0px) 12px 8px",
            background: "var(--surface)",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <button type="button" aria-label="閉じる" onClick={close} style={buttonStyle}>
            閉じる
          </button>
          <span style={{ color: "var(--text-dim)", fontSize: 13 }}>
            {`${pos + 1} / ${order.length}`}
          </span>
          <span
            style={{
              flex: 1,
              color: "var(--text-dim)",
              fontSize: 13,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {image.filename}
          </span>
        </div>
      )}

      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
        }}
      >
        <img
          src={src}
          alt={image.filename}
          onClick={toggleChrome}
          decoding="async"
          style={{
            maxWidth: "100%",
            maxHeight: "100%",
            objectFit: "contain",
            display: "block",
          }}
        />
      </div>

      {chromeVisible && (
        <div
          style={{
            display: "flex",
            gap: 8,
            padding: "8px 12px",
            paddingBottom: "calc(8px + env(safe-area-inset-bottom, 0px))",
            background: "var(--surface)",
            borderTop: "1px solid var(--border)",
          }}
        >
          <button
            type="button"
            aria-label="前へ"
            onClick={() => go(-1)}
            style={{ ...buttonStyle, flex: 1 }}
          >
            ‹
          </button>
          <button
            type="button"
            aria-label="次へ"
            onClick={() => go(1)}
            style={{ ...buttonStyle, flex: 1 }}
          >
            ›
          </button>
        </div>
      )}
    </div>
  );
}

/** 画面に収めて表示したときの長辺から、要求する w を決める。 */
function widthFor(imgW: number, imgH: number): number {
  const longEdge = containedLongEdge(imgW, imgH, window.innerWidth, window.innerHeight);
  return pickWidth(longEdge, window.devicePixelRatio || 1);
}

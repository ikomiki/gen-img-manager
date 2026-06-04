import { useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useQueryStore } from "../store/useQueryStore";
import { useViewerStore } from "../store/useViewerStore";
import { getImageDetail } from "../api/images";
import type { ImageDetail, ZoomMode } from "../types";
import { MetadataPanel } from "./MetadataPanel";

const ZOOM_LABELS: Record<ZoomMode, string> = {
  fit: "全体フィット",
  actual: "等倍",
  fill: "Fill",
  custom: "任意倍率",
};

export function ImageViewer() {
  const isOpen = useViewerStore((s) => s.isOpen);
  const index = useViewerStore((s) => s.index);
  const zoomMode = useViewerStore((s) => s.zoomMode);
  const scale = useViewerStore((s) => s.scale);
  const metaOpen = useViewerStore((s) => s.metaOpen);
  const close = useViewerStore((s) => s.close);
  const next = useViewerStore((s) => s.next);
  const prev = useViewerStore((s) => s.prev);
  const select = useViewerStore((s) => s.select);
  const setZoomMode = useViewerStore((s) => s.setZoomMode);
  const zoomBy = useViewerStore((s) => s.zoomBy);
  const toggleMeta = useViewerStore((s) => s.toggleMeta);
  const cycleZoom = useViewerStore((s) => s.cycleZoom);
  const first = useViewerStore((s) => s.first);
  const last = useViewerStore((s) => s.last);

  const results = useQueryStore((s) => s.results);
  const setRating = useQueryStore((s) => s.setRating);
  const image = results[index];

  const [detail, setDetail] = useState<ImageDetail | null>(null);

  // ズーム倍率インジケータ（一定時間で消える）。
  const [zoomIndicator, setZoomIndicator] = useState<string | null>(null);
  const indicatorTimer = useRef<number | null>(null);
  const firstZoomEffect = useRef(true);

  // 現在画像のメタデータを取得。
  useEffect(() => {
    if (!isOpen || !image) return;
    let active = true;
    setDetail(null);
    getImageDetail(image.id)
      .then((d) => {
        if (active) setDetail(d);
      })
      .catch((e) => console.error("メタデータ取得に失敗しました:", e));
    return () => {
      active = false;
    };
  }, [isOpen, image?.id]);

  // ズーム変更時に倍率インジケータを表示し、一定時間後に消す。
  useEffect(() => {
    if (firstZoomEffect.current) {
      firstZoomEffect.current = false;
      return;
    }
    const text =
      zoomMode === "custom" ? `${Math.round(scale * 100)}%` : ZOOM_LABELS[zoomMode];
    setZoomIndicator(text);
    if (indicatorTimer.current) window.clearTimeout(indicatorTimer.current);
    indicatorTimer.current = window.setTimeout(() => setZoomIndicator(null), 1200);
    return () => {
      if (indicatorTimer.current) window.clearTimeout(indicatorTimer.current);
    };
  }, [zoomMode, scale]);

  // キーボード操作。
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case "Escape":
          // オーバーレイ表示中は ESC を消費し、OS（macOSネイティブ全画面など）へ伝播させない。
          // ベストエフォート: Web content 側の preventDefault が効かない環境では OS 挙動が優先される。
          e.preventDefault();
          e.stopPropagation();
          void getCurrentWindow()
            .setFullscreen(false)
            .catch(() => {});
          close();
          break;
        case "Enter":
          // 現在表示中の画像を選択しつつ一覧へ戻る。
          e.preventDefault();
          void getCurrentWindow()
            .setFullscreen(false)
            .catch(() => {});
          select(index);
          close();
          break;
        case "ArrowRight":
        case " ":
          e.preventDefault();
          next();
          break;
        case "ArrowLeft":
          prev();
          break;
        case "Home":
          e.preventDefault();
          first();
          break;
        case "End":
          e.preventDefault();
          last();
          break;
        case "i":
        case "I":
          e.preventDefault();
          toggleMeta();
          break;
        case "F11": {
          e.preventDefault();
          const w = getCurrentWindow();
          void w
            .isFullscreen()
            .then((on) => w.setFullscreen(!on))
            .catch((err) => console.error("setFullscreen failed:", err));
          break;
        }
        case "+":
        case "=":
          zoomBy(1.25);
          break;
        case "-":
          zoomBy(0.8);
          break;
        case "z":
        case "Z":
          cycleZoom();
          break;
        case "0":
        case "1":
        case "2":
        case "3":
        case "4":
        case "5":
          e.preventDefault();
          applyRating(e.key === "0" ? null : Number(e.key));
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, index, close, next, prev, select, zoomBy, cycleZoom, first, last, toggleMeta, image, setRating]);

  // 現在表示中の画像にレーティングを適用し、detail もその場で更新する。
  const applyRating = (rating: number | null) => {
    if (!image) return;
    void setRating(image.id, rating);
    setDetail((d) => (d ? { ...d, rating } : d));
  };

  if (!isOpen || !image) return null;

  const src = convertFileSrc(image.path);
  const imgClass = `viewer-img viewer-${zoomMode}`;
  const imgStyle =
    zoomMode === "custom" ? { transform: `scale(${scale})` } : undefined;

  // 任意倍率時はホイールでズーム。
  const onWheel = (e: React.WheelEvent) => {
    if (zoomMode !== "custom") return;
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? 1.1 : 0.9);
  };

  return (
    <div className="viewer-overlay">
      <div className="viewer-main">
        <div className="viewer-toolbar">
          <button onClick={close} aria-label="閉じる">
            ✕
          </button>
          <span className="viewer-pos">
            {index + 1} / {results.length}
          </span>
          <div className="viewer-zoom">
            {(Object.keys(ZOOM_LABELS) as ZoomMode[]).map((m) => (
              <button
                key={m}
                className={zoomMode === m ? "active" : ""}
                onClick={() => setZoomMode(m)}
              >
                {ZOOM_LABELS[m]}
              </button>
            ))}
          </div>
          <button
            className="viewer-meta-toggle"
            onClick={toggleMeta}
            aria-pressed={metaOpen}
            aria-label="情報パネルの表示切替"
          >
            {metaOpen ? "情報 ▶" : "◀ 情報"}
          </button>
        </div>
        <div
          className="viewer-stage"
          onWheel={onWheel}
          onDoubleClick={() => {
            // Enter と同義: 現在表示中の画像を選択して一覧へ戻る。
            select(index);
            close();
          }}
        >
          <button
            className="viewer-nav prev"
            onClick={prev}
            onDoubleClick={(e) => e.stopPropagation()}
            aria-label="前へ"
          >
            ‹
          </button>
          <img className={imgClass} style={imgStyle} src={src} alt={image.filename} />
          <button
            className="viewer-nav next"
            onClick={next}
            onDoubleClick={(e) => e.stopPropagation()}
            aria-label="次へ"
          >
            ›
          </button>
          {zoomIndicator && <div className="viewer-zoom-indicator">{zoomIndicator}</div>}
        </div>
      </div>
      {metaOpen && <MetadataPanel detail={detail} onRate={applyRating} />}
    </div>
  );
}

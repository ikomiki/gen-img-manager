import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
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
  const close = useViewerStore((s) => s.close);
  const next = useViewerStore((s) => s.next);
  const prev = useViewerStore((s) => s.prev);
  const setZoomMode = useViewerStore((s) => s.setZoomMode);
  const zoomBy = useViewerStore((s) => s.zoomBy);

  const results = useQueryStore((s) => s.results);
  const image = results[index];

  const [detail, setDetail] = useState<ImageDetail | null>(null);

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
  }, [isOpen, image]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case "Escape":
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
        case "+":
        case "=":
          zoomBy(1.25);
          break;
        case "-":
          zoomBy(0.8);
          break;
        case "1":
          setZoomMode("fit");
          break;
        case "2":
          setZoomMode("actual");
          break;
        case "3":
          setZoomMode("fill");
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, close, next, prev, zoomBy, setZoomMode]);

  if (!isOpen || !image) return null;

  const src = convertFileSrc(image.path);
  const imgClass = `viewer-img viewer-${zoomMode}`;
  const imgStyle =
    zoomMode === "custom" ? { transform: `scale(${scale})` } : undefined;

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
        </div>
        <div className="viewer-stage">
          <button className="viewer-nav prev" onClick={prev} aria-label="前へ">
            ‹
          </button>
          <img className={imgClass} style={imgStyle} src={src} alt={image.filename} />
          <button className="viewer-nav next" onClick={next} aria-label="次へ">
            ›
          </button>
        </div>
      </div>
      <MetadataPanel detail={detail} />
    </div>
  );
}

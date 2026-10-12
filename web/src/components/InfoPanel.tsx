import { useEffect, useRef, useState } from "react";
import { normalizePromptText } from "@gim/shared/normalizeText";
import { getImageDetail, type ImageDetailDto } from "../api/images";
import { useViewerStore } from "../store/useViewerStore";
import { buildInfoBlocks, type InfoBlock, type InfoBlockKey } from "../util/infoBlocks";
import { copyText } from "../util/copyText";

/** コピー結果をボタンに出しておく時間。 */
const COPY_FEEDBACK_MS = 1500;

function Row({ label, value }: { label: string; value: string | number | null }) {
  if (value === null || value === "") return null;
  return (
    <div className="info-row">
      <span className="info-label">{label}</span>
      <span className="info-value">{value}</span>
    </div>
  );
}

export function InfoPanel({ id }: { id: number }) {
  const normalizePrompt = useViewerStore((s) => s.normalizePrompt);
  const toggleNormalize = useViewerStore((s) => s.toggleNormalize);
  const maximizedBlock = useViewerStore((s) => s.maximizedBlock);
  const setMaximizedBlock = useViewerStore((s) => s.setMaximizedBlock);

  // 取り直しの間は直前の画像の内容を出しておく。送るたびに空になるとちらつく。
  const [detail, setDetail] = useState<ImageDetailDto | null>(null);
  const [copied, setCopied] = useState<{ key: InfoBlockKey; ok: boolean } | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    void getImageDetail(id)
      .then((d) => {
        if (alive) setDetail(d);
      })
      .catch(() => {
        // 取れなければ直前の内容のまま。パネルは補助情報なので閲覧は止めない。
      });
    return () => {
      alive = false;
    };
  }, [id]);

  useEffect(() => () => clearTimeout(copiedTimer.current), []);

  if (!detail) return <div className="info-panel" />;

  const onCopy = async (key: InfoBlockKey, text: string) => {
    const ok = await copyText(text);
    clearTimeout(copiedTimer.current);
    setCopied({ key, ok });
    copiedTimer.current = setTimeout(() => setCopied(null), COPY_FEEDBACK_MS);
  };

  const blocks = buildInfoBlocks(detail);

  const renderBlock = (b: InfoBlock) => {
    const isMax = maximizedBlock === b.key;
    const displayText = b.normalizable && normalizePrompt ? normalizePromptText(b.text) : b.text;
    const feedback = copied?.key === b.key ? (copied.ok ? "コピー済み" : "失敗") : "コピー";
    return (
      <div className={isMax ? "info-block maximized" : "info-block"} key={b.key}>
        <div className="info-block-head">
          <span className="info-label">{b.label}</span>
          <span className="info-block-actions">
            <button type="button" onClick={() => void onCopy(b.key, displayText)} aria-label={`${b.label}をコピー`}>
              {feedback}
            </button>
            <button
              type="button"
              onClick={() => setMaximizedBlock(isMax ? null : b.key)}
              aria-label={isMax ? `${b.label}を元に戻す` : `${b.label}を最大化`}
            >
              {isMax ? "戻す" : "最大化"}
            </button>
          </span>
        </div>
        <pre className="info-text">{displayText}</pre>
      </div>
    );
  };

  const normalizeToggle = blocks.some((b) => b.normalizable) ? (
    <label className="info-normalize-toggle">
      <input type="checkbox" checked={normalizePrompt} onChange={toggleNormalize} />
      整形（空行・カンマ行・前後空白を除去）
    </label>
  ) : null;

  // key で作り直してスクロール位置を先頭へ戻す。
  const maxBlock = blocks.find((b) => b.key === maximizedBlock);
  if (maxBlock) {
    return (
      <div className="info-panel maximized" key={detail.id}>
        {maxBlock.normalizable && normalizeToggle}
        {renderBlock(maxBlock)}
      </div>
    );
  }

  return (
    <div className="info-panel" key={detail.id}>
      <h3 className="info-filename">{detail.filename}</h3>
      {normalizeToggle}
      <Row label="サイズ" value={`${detail.width} × ${detail.height}`} />
      <Row label="ツール" value={detail.source_tool} />
      <Row label="モデル" value={detail.model} />
      <Row label="サンプラー" value={detail.sampler} />
      <Row label="Steps" value={detail.steps} />
      <Row label="CFG" value={detail.cfg} />
      <Row label="Seed" value={detail.seed} />
      <Row label="レーティング" value={detail.rating !== null ? `★${detail.rating}` : null} />
      {blocks.map(renderBlock)}
    </div>
  );
}

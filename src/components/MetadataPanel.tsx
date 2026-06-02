import { useEffect, useState } from "react";
import type { ImageDetail } from "../types";
import { useViewerStore } from "../store/useViewerStore";
import { normalizePromptText } from "../util/normalizeText";

interface Props {
  detail: ImageDetail | null;
}

interface TextBlock {
  key: string;
  label: string;
  text: string;
  /** 整形トグルの対象か（prompt/negative のみ true）。 */
  normalizable: boolean;
}

function Row({ label, value }: { label: string; value: string | number | null }) {
  if (value === null || value === "") return null;
  return (
    <div className="meta-row">
      <span className="meta-label">{label}</span>
      <span className="meta-value">{value}</span>
    </div>
  );
}

export function MetadataPanel({ detail }: Props) {
  // prompt/negative の整形表示トグル（空行・カンマだけの行・前後空白を除去）。
  const normalizePrompt = useViewerStore((s) => s.normalizePrompt);
  const toggleNormalize = useViewerStore((s) => s.toggleNormalize);

  // どのテキストブロックをサイドバー全体に最大化表示しているか。
  const [maximized, setMaximized] = useState<string | null>(null);

  // 画像が切り替わったら最大化状態を解除する。
  useEffect(() => {
    setMaximized(null);
  }, [detail?.id]);

  if (!detail) {
    return <div className="meta-panel" />;
  }

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      console.error("クリップボードへのコピーに失敗しました:", e);
    }
  };

  // 表示するテキストブロック（positive があれば Prompt、無ければ Parameters）。
  const blocks: TextBlock[] = [];
  if (detail.positive)
    blocks.push({ key: "prompt", label: "Prompt", text: detail.positive, normalizable: true });
  if (detail.negative)
    blocks.push({ key: "negative", label: "Negative", text: detail.negative, normalizable: true });
  if (!detail.positive && detail.raw_parameters) {
    blocks.push({ key: "params", label: "Parameters", text: detail.raw_parameters, normalizable: false });
  }

  const renderBlock = (b: TextBlock) => {
    const isMax = maximized === b.key;
    // prompt/negative かつトグルONのときだけ整形して表示・コピーする。
    const displayText = b.normalizable && normalizePrompt ? normalizePromptText(b.text) : b.text;
    return (
      <div className={isMax ? "meta-block maximized" : "meta-block"} key={b.key}>
        <div className="meta-block-head">
          <span className="meta-label">{b.label}</span>
          <span className="meta-block-actions">
            <button onClick={() => void copyText(displayText)} aria-label={`${b.label}をコピー`}>
              コピー
            </button>
            <button
              onClick={() => setMaximized(isMax ? null : b.key)}
              aria-label={isMax ? "元に戻す" : "最大化"}
            >
              {isMax ? "戻す" : "最大化"}
            </button>
          </span>
        </div>
        <pre className="meta-text">{displayText}</pre>
      </div>
    );
  };

  // 整形トグル（prompt/negative がある場合のみ表示）。
  const hasNormalizable = blocks.some((b) => b.normalizable);
  const normalizeToggle = hasNormalizable ? (
    <label className="meta-normalize-toggle" title="空行・カンマだけの行・行頭行末の空白を除去">
      <input type="checkbox" checked={normalizePrompt} onChange={toggleNormalize} />
      整形（空行・カンマ行・前後空白を除去）
    </label>
  ) : null;

  // 最大化中は対象ブロックのみをサイドバー全体に表示する。
  const maxBlock = maximized ? blocks.find((b) => b.key === maximized) : undefined;
  if (maxBlock) {
    return (
      <div className="meta-panel maximized">
        {maxBlock.normalizable && normalizeToggle}
        {renderBlock(maxBlock)}
      </div>
    );
  }

  return (
    <div className="meta-panel">
      <h3 className="meta-filename" title={detail.path}>
        {detail.filename}
      </h3>
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

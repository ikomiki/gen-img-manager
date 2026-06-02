import { useEffect, useState } from "react";
import type { ImageDetail } from "../types";

interface Props {
  detail: ImageDetail | null;
}

interface TextBlock {
  key: string;
  label: string;
  text: string;
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
  if (detail.positive) blocks.push({ key: "prompt", label: "Prompt", text: detail.positive });
  if (detail.negative) blocks.push({ key: "negative", label: "Negative", text: detail.negative });
  if (!detail.positive && detail.raw_parameters) {
    blocks.push({ key: "params", label: "Parameters", text: detail.raw_parameters });
  }

  const renderBlock = (b: TextBlock) => {
    const isMax = maximized === b.key;
    return (
      <div className={isMax ? "meta-block maximized" : "meta-block"} key={b.key}>
        <div className="meta-block-head">
          <span className="meta-label">{b.label}</span>
          <span className="meta-block-actions">
            <button onClick={() => void copyText(b.text)} aria-label={`${b.label}をコピー`}>
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
        <pre className="meta-text">{b.text}</pre>
      </div>
    );
  };

  // 最大化中は対象ブロックのみをサイドバー全体に表示する。
  const maxBlock = maximized ? blocks.find((b) => b.key === maximized) : undefined;
  if (maxBlock) {
    return <div className="meta-panel maximized">{renderBlock(maxBlock)}</div>;
  }

  return (
    <div className="meta-panel">
      <h3 className="meta-filename" title={detail.path}>
        {detail.filename}
      </h3>
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

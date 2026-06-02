import type { ImageDetail } from "../types";

interface Props {
  detail: ImageDetail | null;
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
  if (!detail) {
    return <div className="meta-panel" />;
  }

  const copyPrompt = async () => {
    const text = detail.raw_parameters ?? detail.positive ?? "";
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      console.error("クリップボードへのコピーに失敗しました:", e);
    }
  };

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

      {detail.positive && (
        <div className="meta-block">
          <div className="meta-block-head">
            <span className="meta-label">Prompt</span>
            <button onClick={() => void copyPrompt()}>コピー</button>
          </div>
          <pre className="meta-text">{detail.positive}</pre>
        </div>
      )}
      {detail.negative && (
        <div className="meta-block">
          <span className="meta-label">Negative</span>
          <pre className="meta-text">{detail.negative}</pre>
        </div>
      )}
      {!detail.positive && detail.raw_parameters && (
        <div className="meta-block">
          <div className="meta-block-head">
            <span className="meta-label">Parameters</span>
            <button onClick={() => void copyPrompt()}>コピー</button>
          </div>
          <pre className="meta-text">{detail.raw_parameters}</pre>
        </div>
      )}
    </div>
  );
}

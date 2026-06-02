import { useState } from "react";
import { useQueryStore } from "../store/useQueryStore";

interface Props {
  onClose: () => void;
}

/**
 * 既存クエリから指定フィールドのトークンを除去して新トークンを追記する。
 * NOTE(既知の制限): 空白で分割するため、クエリ中のダブルクォート句（例 prompt:"a b"）は
 * 壊れる可能性がある。詳細ダイアログが扱う field:value トークンは引用句を含まないため実用上問題ない。
 */
function upsertToken(query: string, field: string, token: string | null): string {
  const tokens = query.split(/\s+/).filter((t) => t && !t.startsWith(`${field}:`));
  if (token) tokens.push(token);
  return tokens.join(" ").trim();
}

export function FilterDialog({ onClose }: Props) {
  const query = useQueryStore((s) => s.query);
  const setQuery = useQueryStore((s) => s.setQuery);
  const runQuery = useQueryStore((s) => s.runQuery);

  const [minRating, setMinRating] = useState("");
  const [minWidth, setMinWidth] = useState("");
  const [minHeight, setMinHeight] = useState("");
  const [createdFrom, setCreatedFrom] = useState("");
  const [createdTo, setCreatedTo] = useState("");

  const apply = async () => {
    try {
      let q = query;
      q = upsertToken(q, "rating", minRating ? `rating:>=${minRating}` : null);
      q = upsertToken(q, "width", minWidth ? `width:>=${minWidth}` : null);
      q = upsertToken(q, "height", minHeight ? `height:>=${minHeight}` : null);
      q = upsertToken(
        q,
        "created",
        createdFrom && createdTo ? `created:${createdFrom}..${createdTo}` : null,
      );
      setQuery(q);
      await runQuery();
    } catch (e) {
      console.error("フィルタ適用に失敗しました:", e);
    } finally {
      onClose();
    }
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h3>詳細フィルタ</h3>
        <label>
          レーティング下限
          <select value={minRating} onChange={(e) => setMinRating(e.target.value)}>
            <option value="">指定なし</option>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                ★{n}以上
              </option>
            ))}
          </select>
        </label>
        <label>
          幅下限(px)
          <input type="number" min="0" step="1" value={minWidth} onChange={(e) => setMinWidth(e.target.value)} />
        </label>
        <label>
          高さ下限(px)
          <input type="number" min="0" step="1" value={minHeight} onChange={(e) => setMinHeight(e.target.value)} />
        </label>
        <label>
          作成日 開始
          <input type="date" value={createdFrom} onChange={(e) => setCreatedFrom(e.target.value)} />
        </label>
        <label>
          作成日 終了
          <input type="date" value={createdTo} onChange={(e) => setCreatedTo(e.target.value)} />
        </label>
        <div className="dialog-actions">
          <button onClick={onClose}>キャンセル</button>
          <button onClick={() => void apply()}>適用</button>
        </div>
      </div>
    </div>
  );
}

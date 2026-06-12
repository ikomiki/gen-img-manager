import { useAnalysisStore } from "../store/useAnalysisStore";

function ratingLabel(r: number | null): string {
  return r === null ? "未評価" : `★${r}`;
}

export function TagRatingAnalysis() {
  const selectedTag = useAnalysisStore((s) => s.selectedTag);
  const a = useAnalysisStore((s) => s.tagAnalysis);
  const clear = useAnalysisStore((s) => s.clearSelectedTag);
  if (!selectedTag || !a) return null;

  return (
    <div className="tag-rating-analysis">
      <button type="button" onClick={clear}>← 頻度一覧へ戻る</button>
      <h3>タグ「{selectedTag.name}」のレーティング分析</h3>
      <p>
        平均: ある = {a.has_avg?.toFixed(2) ?? "—"} / ない = {a.without_avg?.toFixed(2) ?? "—"}
      </p>
      <table>
        <thead>
          <tr>
            <th>レーティング</th>
            <th>ある（件数）</th>
            <th>ない（件数）</th>
          </tr>
        </thead>
        <tbody>
          {a.has.map((bucket, i) => (
            <tr key={i}>
              <td>{ratingLabel(bucket.rating)}</td>
              <td>{bucket.cnt}</td>
              <td>{a.without[i]?.cnt ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

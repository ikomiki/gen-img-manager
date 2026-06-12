import { useEffect } from "react";
import { useAnalysisStore } from "../store/useAnalysisStore";

export function RatingCauseTable() {
  const cause = useAnalysisStore((s) => s.cause);
  const direction = useAnalysisStore((s) => s.causeDirection);
  const setDirection = useAnalysisStore((s) => s.setCauseDirection);
  const minRatedCount = useAnalysisStore((s) => s.minRatedCount);
  const priorWeight = useAnalysisStore((s) => s.priorWeight);
  const setMinRatedCount = useAnalysisStore((s) => s.setMinRatedCount);
  const setPriorWeight = useAnalysisStore((s) => s.setPriorWeight);
  const loadCause = useAnalysisStore((s) => s.loadCause);
  const scopeMode = useAnalysisStore((s) => s.scopeMode);
  const applyExclusion = useAnalysisStore((s) => s.applyExclusion);

  useEffect(() => {
    void loadCause();
  }, [loadCause, direction, scopeMode, applyExclusion, minRatedCount, priorWeight]);

  return (
    <div className="rating-cause">
      <div>
        <label>
          <input
            type="radio"
            checked={direction === "high"}
            onChange={() => setDirection("high")}
          />
          高評価の原因
        </label>
        <label>
          <input
            type="radio"
            checked={direction === "low"}
            onChange={() => setDirection("low")}
          />
          低評価の原因
        </label>
        <label>
          最小評価済み件数
          <input
            type="number"
            min={1}
            value={minRatedCount}
            onChange={(e) => setMinRatedCount(Math.max(1, Number(e.target.value) || 1))}
          />
        </label>
        <label>
          事前重み m
          <input
            type="number"
            min={0}
            step={1}
            value={priorWeight}
            onChange={(e) => setPriorWeight(Math.max(0, Number(e.target.value) || 0))}
          />
        </label>
      </div>
      <table>
        <thead>
          <tr>
            <th>タグ</th>
            <th>評価済み件数</th>
            <th>生平均</th>
            <th>調整平均</th>
            <th>全体平均との差</th>
          </tr>
        </thead>
        <tbody>
          {cause.map((r) => (
            <tr key={r.tag_id}>
              <td>{r.name}</td>
              <td>{r.rated_count}</td>
              <td>{r.raw_avg?.toFixed(2) ?? "—"}</td>
              <td>{r.adjusted_avg?.toFixed(2) ?? "—"}</td>
              <td>
                {r.adjusted_avg !== null && r.overall_avg !== null
                  ? (r.adjusted_avg - r.overall_avg >= 0 ? "+" : "") +
                    (r.adjusted_avg - r.overall_avg).toFixed(2)
                  : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {cause.length === 0 && <p>しきい値を満たすタグがありません。</p>}
    </div>
  );
}

import { useEffect } from "react";
import { useAnalysisStore } from "../store/useAnalysisStore";
import { useQueryStore } from "../store/useQueryStore";
import { TagRatingAnalysis } from "./TagRatingAnalysis";

export function TagFrequencyTable() {
  const freq = useAnalysisStore((s) => s.freq);
  const nameFilter = useAnalysisStore((s) => s.nameFilter);
  const freqSort = useAnalysisStore((s) => s.freqSort);
  const setFreqSort = useAnalysisStore((s) => s.setFreqSort);
  const loadFrequency = useAnalysisStore((s) => s.loadFrequency);
  const selectTag = useAnalysisStore((s) => s.selectTag);
  const selectedTag = useAnalysisStore((s) => s.selectedTag);
  const scopeMode = useAnalysisStore((s) => s.scopeMode);
  const applyExclusion = useAnalysisStore((s) => s.applyExclusion);
  const query = useQueryStore((s) => s.query);
  // フィルタ範囲のときだけクエリ変更で再取得する（全体時はクエリ非依存）。
  const scopeKey = scopeMode === "filter" ? query : null;

  // スコープ/除外/フィルタ/ソート/クエリ変更時に再取得。
  useEffect(() => {
    void loadFrequency();
  }, [loadFrequency, scopeMode, applyExclusion, nameFilter, freqSort, scopeKey]);

  if (selectedTag) return <TagRatingAnalysis />;

  return (
    <div className="tag-frequency">
      <table>
        <thead>
          <tr>
            <th
              onClick={() => setFreqSort("name")}
              style={{ cursor: "pointer" }}
              aria-sort={freqSort === "name" ? "ascending" : "none"}
            >
              タグ{freqSort === "name" ? " ▲" : ""}
            </th>
            <th
              onClick={() => setFreqSort("count")}
              style={{ cursor: "pointer" }}
              aria-sort={freqSort === "count" ? "descending" : "none"}
            >
              出現画像数{freqSort === "count" ? " ▼" : ""}
            </th>
          </tr>
        </thead>
        <tbody>
          {freq.map((t) => (
            <tr
              key={t.tag_id}
              onClick={() => void selectTag(t.tag_id, t.name)}
              style={{ cursor: "pointer" }}
            >
              <td>{t.name}</td>
              <td>{t.image_count}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {freq.length === 0 && <p>該当タグがありません。</p>}
    </div>
  );
}

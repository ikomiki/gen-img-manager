import { useEffect } from "react";
import { useAnalysisStore } from "../store/useAnalysisStore";
import { TagRatingAnalysis } from "./TagRatingAnalysis";

export function TagFrequencyTable() {
  const freq = useAnalysisStore((s) => s.freq);
  const nameFilter = useAnalysisStore((s) => s.nameFilter);
  const setNameFilter = useAnalysisStore((s) => s.setNameFilter);
  const freqSort = useAnalysisStore((s) => s.freqSort);
  const setFreqSort = useAnalysisStore((s) => s.setFreqSort);
  const loadFrequency = useAnalysisStore((s) => s.loadFrequency);
  const selectTag = useAnalysisStore((s) => s.selectTag);
  const selectedTag = useAnalysisStore((s) => s.selectedTag);
  const scopeMode = useAnalysisStore((s) => s.scopeMode);
  const applyExclusion = useAnalysisStore((s) => s.applyExclusion);

  // スコープ/除外/フィルタ/ソート変更時に再取得。
  useEffect(() => {
    void loadFrequency();
  }, [loadFrequency, scopeMode, applyExclusion, nameFilter, freqSort]);

  if (selectedTag) return <TagRatingAnalysis />;

  return (
    <div className="tag-frequency">
      <input
        type="search"
        placeholder="タグ名で絞り込み"
        value={nameFilter}
        onChange={(e) => setNameFilter(e.target.value)}
      />
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

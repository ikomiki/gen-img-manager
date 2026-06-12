import { useAnalysisStore } from "../store/useAnalysisStore";
import { TagFrequencyTable } from "./TagFrequencyTable";
import { RatingCauseTable } from "./RatingCauseTable";
import { ExcludedTagsEditor } from "./ExcludedTagsEditor";

export function AnalysisView() {
  const open = useAnalysisStore((s) => s.open);
  const setOpen = useAnalysisStore((s) => s.setOpen);
  const tab = useAnalysisStore((s) => s.tab);
  const setTab = useAnalysisStore((s) => s.setTab);
  const scopeMode = useAnalysisStore((s) => s.scopeMode);
  const setScopeMode = useAnalysisStore((s) => s.setScopeMode);
  const applyExclusion = useAnalysisStore((s) => s.applyExclusion);
  const toggleExclusion = useAnalysisStore((s) => s.toggleExclusion);
  const nameFilter = useAnalysisStore((s) => s.nameFilter);
  const setNameFilter = useAnalysisStore((s) => s.setNameFilter);

  if (!open) return null;

  return (
    <div className="analysis-view">
      <div className="analysis-toolbar">
        <div className="analysis-tabs">
          <button type="button" aria-pressed={tab === "frequency"} onClick={() => setTab("frequency")}>頻度一覧</button>
          <button type="button" aria-pressed={tab === "cause"} onClick={() => setTab("cause")}>原因分析</button>
          <button type="button" aria-pressed={tab === "excluded"} onClick={() => setTab("excluded")}>除外リスト</button>
        </div>
        <div className="analysis-scope">
          <label>
            <input
              type="radio"
              checked={scopeMode === "all"}
              onChange={() => setScopeMode("all")}
            />
            全体
          </label>
          <label>
            <input
              type="radio"
              checked={scopeMode === "filter"}
              onChange={() => setScopeMode("filter")}
            />
            フィルタ範囲
          </label>
          <label>
            <input
              type="checkbox"
              checked={!applyExclusion}
              onChange={toggleExclusion}
            />
            除外リストを無効化
          </label>
        </div>
        {(tab === "frequency" || tab === "cause") && (
          <div className="analysis-filter">
            <input
              type="search"
              placeholder="タグ名で絞り込み"
              value={nameFilter}
              onChange={(e) => setNameFilter(e.target.value)}
              aria-label="タグフィルタ"
            />
            {nameFilter && (
              <button type="button" aria-label="フィルタをクリア" onClick={() => setNameFilter("")}>
                ✕
              </button>
            )}
          </div>
        )}
        <button type="button" onClick={() => setOpen(false)}>閉じる</button>
      </div>
      <div className="analysis-body">
        {tab === "frequency" && <TagFrequencyTable />}
        {tab === "cause" && <RatingCauseTable />}
        {tab === "excluded" && <ExcludedTagsEditor />}
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { useAnalysisStore } from "../store/useAnalysisStore";

export function ExcludedTagsEditor() {
  const excluded = useAnalysisStore((s) => s.excluded);
  const loadExcluded = useAnalysisStore((s) => s.loadExcluded);
  const addExcluded = useAnalysisStore((s) => s.addExcluded);
  const removeExcluded = useAnalysisStore((s) => s.removeExcluded);
  const [name, setName] = useState("");

  useEffect(() => {
    void loadExcluded();
  }, [loadExcluded]);

  const submit = () => {
    const n = name.trim();
    if (!n) return;
    void addExcluded(n);
    setName("");
  };

  return (
    <div className="excluded-editor">
      <p>分析から除外するタグ（正規化名で保存されます）。</p>
      <div>
        <input
          type="text"
          value={name}
          placeholder="追加するタグ名"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
        />
        <button type="button" onClick={submit}>追加</button>
      </div>
      <ul>
        {excluded.map((n) => (
          <li key={n}>
            {n} <button type="button" onClick={() => void removeExcluded(n)}>削除</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

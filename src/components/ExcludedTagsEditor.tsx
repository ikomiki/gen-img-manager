import { useEffect, useState } from "react";
import { useAnalysisStore } from "../store/useAnalysisStore";

export function ExcludedTagsEditor() {
  const excluded = useAnalysisStore((s) => s.excluded);
  const loadExcluded = useAnalysisStore((s) => s.loadExcluded);
  const setExcluded = useAnalysisStore((s) => s.setExcluded);
  const [text, setText] = useState("");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    void loadExcluded();
  }, [loadExcluded]);

  // 読み込み結果（保存後の正規化済みリスト含む）でテキストエリアを初期化する。
  // 編集中（dirty）は上書きしない。
  useEffect(() => {
    if (!dirty) setText(excluded.join("\n"));
  }, [excluded, dirty]);

  const save = async () => {
    await setExcluded(text);
    setDirty(false);
  };

  const revert = () => {
    setText(excluded.join("\n"));
    setDirty(false);
  };

  return (
    <div className="excluded-editor">
      <p>
        分析から除外するタグ（1行1タグ。<code>#</code> で始まる行はコメント。保存時に正規化されます）。
      </p>
      <textarea
        className="excluded-textarea"
        value={text}
        rows={16}
        spellCheck={false}
        onChange={(e) => {
          setText(e.target.value);
          setDirty(true);
        }}
        aria-label="除外タグリスト"
      />
      <div className="excluded-actions">
        <button type="button" onClick={() => void save()} disabled={!dirty}>
          保存
        </button>
        <button type="button" onClick={revert} disabled={!dirty}>
          取消
        </button>
      </div>
    </div>
  );
}

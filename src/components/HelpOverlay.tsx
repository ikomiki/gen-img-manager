import { useEffect, useRef } from "react";

interface Props {
  onClose: () => void;
}

interface Row {
  keys: string;
  desc: string;
}

const SECTIONS: { title: string; rows: Row[] }[] = [
  {
    title: "一覧（グリッド）",
    rows: [
      { keys: "← → ↑ ↓", desc: "選択を移動" },
      { keys: "Home / End", desc: "先頭 / 末尾の画像" },
      { keys: "PageUp / PageDown", desc: "ページ単位で移動" },
      { keys: "Enter", desc: "ビューアで開く" },
      { keys: "0 - 5", desc: "レーティング設定（0でクリア）" },
      { keys: "O", desc: "Finderで表示" },
      { keys: "C", desc: "パスをコピー" },
    ],
  },
  {
    title: "ビューア",
    rows: [
      { keys: "← / → / Space", desc: "前へ / 次へ" },
      { keys: "Home / End", desc: "先頭 / 末尾の画像" },
      { keys: "+ / -", desc: "ズームイン / アウト" },
      { keys: "Z", desc: "ズームモード循環（fit→actual→fill）" },
      { keys: "I", desc: "情報パネルの開閉" },
      { keys: "F11", desc: "フルスクリーン切替" },
      { keys: "0 - 5", desc: "レーティング設定（0でクリア）" },
      { keys: "O", desc: "Finderで表示" },
      { keys: "C", desc: "パスをコピー" },
      { keys: "Enter", desc: "選択して一覧へ戻る" },
      { keys: "Esc", desc: "閉じる" },
    ],
  },
  {
    title: "スライドショー",
    rows: [
      { keys: "← / →", desc: "前へ / 次へ" },
      { keys: "Space", desc: "再生 / 一時停止" },
      { keys: "Home / End", desc: "先頭 / 末尾の画像" },
      { keys: "F11", desc: "フルスクリーン切替" },
      { keys: "Esc", desc: "閉じる" },
    ],
  },
  {
    title: "全体",
    rows: [
      { keys: "B", desc: "左ディレクトリパネルの開閉" },
      { keys: "?", desc: "このヘルプの表示 / 非表示" },
    ],
  },
];

export function HelpOverlay({ onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  return (
    <div className="help-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="help-dialog-title">
      <div className="help-panel" onClick={(e) => e.stopPropagation()}>
        <div className="help-header">
          <h2 id="help-dialog-title">キーボードショートカット</h2>
          <button ref={closeRef} onClick={onClose} aria-label="閉じる">
            ✕
          </button>
        </div>
        <div className="help-body">
          {SECTIONS.map((sec) => (
            <section key={sec.title} className="help-section">
              <h3>{sec.title}</h3>
              <table>
                <tbody>
                  {sec.rows.map((r) => (
                    <tr key={r.keys}>
                      <td className="help-keys">{r.keys}</td>
                      <td className="help-desc">{r.desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

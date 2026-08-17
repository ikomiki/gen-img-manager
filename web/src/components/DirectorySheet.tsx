import { useEffect, useState } from "react";
import { listDirectories, type DirectoryDto } from "../api/directories";
import { useQueryStore } from "../store/useQueryStore";
import { Sheet } from "./Sheet";
import { buttonStyle } from "../ui";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function DirectorySheet({ open, onClose }: Props) {
  const dirs = useQueryStore((s) => s.dirs);
  const setDirs = useQueryStore((s) => s.setDirs);
  const [all, setAll] = useState<DirectoryDto[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    listDirectories()
      .then(setAll)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [open]);

  // dirs が null（未指定）のときはサーバの visible に従うので、その見え方を再現する。
  const selectedIds = dirs ?? all.filter((d) => d.visible).map((d) => d.id);
  const isChecked = (id: number) => selectedIds.includes(id);

  const toggle = (id: number) => {
    const next = isChecked(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id];
    void setDirs(next);
  };

  // 一覧の読み込み前は all が空なので、「すべて選択」を押すと 0 件になってしまう。
  const bulkDisabled = all.length === 0;

  return (
    <Sheet open={open} title="表示する場所" onClose={onClose}>
      {error && <p style={{ color: "var(--text-dim)" }}>読み込みに失敗しました: {error}</p>}

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button
          type="button"
          onClick={() => void setDirs(all.map((d) => d.id))}
          disabled={bulkDisabled}
          style={{
            ...buttonStyle,
            flex: 1,
            opacity: bulkDisabled ? 0.5 : 1,
            cursor: bulkDisabled ? "default" : "pointer",
          }}
        >
          すべて選択
        </button>
        <button
          type="button"
          onClick={() => void setDirs([])}
          disabled={bulkDisabled}
          style={{
            ...buttonStyle,
            flex: 1,
            opacity: bulkDisabled ? 0.5 : 1,
            cursor: bulkDisabled ? "default" : "pointer",
          }}
        >
          すべて解除
        </button>
      </div>

      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {all.map((d) => (
          <li key={d.id} style={{ borderBottom: "1px solid var(--border)" }}>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                minHeight: "var(--tap)",
                cursor: "pointer",
                opacity: d.is_online ? 1 : 0.5,
              }}
            >
              <input
                aria-label={d.label}
                type="checkbox"
                checked={isChecked(d.id)}
                onChange={() => toggle(d.id)}
              />
              <span style={{ flex: 1 }}>
                {d.label}
                {!d.is_online && (
                  <span style={{ color: "var(--text-dim)", fontSize: 12, marginLeft: 8 }}>
                    オフライン（最後のスキャン時点）
                  </span>
                )}
              </span>
              <span style={{ color: "var(--text-dim)", fontSize: 13 }}>{d.image_count} 枚</span>
            </label>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

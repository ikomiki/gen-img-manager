import { useEffect, useRef } from "react";
import { extractField, upsertField } from "@gim/shared/queryTokens";
import { applyPromptField, promptFieldToInput } from "@gim/shared/promptQuery";
import {
  RATING_VALUES,
  buildRatingToken,
  parseRatingToken,
  type RatingValue,
} from "@gim/shared/ratingFilter";
import { useQueryStore } from "../store/useQueryStore";
import { Sheet } from "./Sheet";
import { buttonStyle, inputStyle } from "../ui";

interface Props {
  open: boolean;
  onClose: () => void;
}

/** 構造化フィールドだけを消す。フリーワードは残す（プロンプトは別扱いで clearFields 内で消す）。 */
const STRUCTURED = ["rating", "width", "height", "model", "tool", "created"] as const;

export function FilterSheet({ open, onClose }: Props) {
  const query = useQueryStore((s) => s.query);
  const setQuery = useQueryStore((s) => s.setQuery);
  const commitQuery = useQueryStore((s) => s.commitQuery);
  const runQuery = useQueryStore((s) => s.runQuery);
  const runQueryDebounced = useQueryStore((s) => s.runQueryDebounced);

  // シートは状態を持たない。クエリ文字列が唯一の正で、毎回そこから読む。
  const ratings = parseRatingToken(extractField(query, "rating"));

  /** 自由入力の欄。打鍵ごとにクエリ文字列は直すが、検索は落ち着いてから投げる。 */
  const setField = (field: string, value: string) => {
    setQuery(upsertField(query, field, value.trim() === "" ? null : value.trim()));
    runQueryDebounced();
  };

  const toggleRating = (v: RatingValue) => {
    const next = new Set(ratings);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    setQuery(upsertField(query, "rating", buildRatingToken(next)));
    void runQuery();
  };

  const clearFields = () => {
    const withoutStructured = STRUCTURED.reduce((q, f) => upsertField(q, f, null), query);
    setQuery(applyPromptField(withoutStructured, "prompt", ""));
    void runQuery();
  };

  // シート操作中の検索は履歴に残さない（チップ1つで1件増えると使い物にならない）。
  // 閉じた時点の文字列だけを1件記録する。
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !open) void commitQuery();
    wasOpen.current = open;
  }, [open, commitQuery]);

  return (
    <Sheet open={open} title="絞り込み" onClose={onClose}>
      <Field label="プロンプト">
        <input
          aria-label="プロンプト"
          type="text"
          value={promptFieldToInput(query, "prompt")}
          placeholder="forest -blurry"
          onChange={(e) => {
            setQuery(applyPromptField(query, "prompt", e.target.value));
            runQueryDebounced();
          }}
          style={{ ...inputStyle, width: "100%" }}
        />
      </Field>

      <Field label="レーティング">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {RATING_VALUES.map((v) => {
            const label = v === "none" ? "レーティング なし" : `レーティング ${v}`;
            return (
              <label key={String(v)} style={chipStyle(ratings.has(v))}>
                <input
                  aria-label={label}
                  type="checkbox"
                  checked={ratings.has(v)}
                  onChange={() => toggleRating(v)}
                  style={{ marginRight: 6 }}
                />
                {v === "none" ? "なし" : v}
              </label>
            );
          })}
        </div>
      </Field>

      <Field label="幅">
        <input
          aria-label="幅"
          type="text"
          inputMode="text"
          value={extractField(query, "width") ?? ""}
          placeholder=">=1024"
          onChange={(e) => setField("width", e.target.value)}
          style={{ ...inputStyle, width: "100%" }}
        />
      </Field>

      <Field label="高さ">
        <input
          aria-label="高さ"
          type="text"
          value={extractField(query, "height") ?? ""}
          placeholder=">=1024"
          onChange={(e) => setField("height", e.target.value)}
          style={{ ...inputStyle, width: "100%" }}
        />
      </Field>

      <Field label="モデル">
        <input
          aria-label="モデル"
          type="text"
          value={extractField(query, "model") ?? ""}
          onChange={(e) => setField("model", e.target.value)}
          style={{ ...inputStyle, width: "100%" }}
        />
      </Field>

      <Field label="生成ツール">
        <input
          aria-label="生成ツール"
          type="text"
          value={extractField(query, "tool") ?? ""}
          placeholder="a1111"
          onChange={(e) => setField("tool", e.target.value)}
          style={{ ...inputStyle, width: "100%" }}
        />
      </Field>

      <Field label="作成日（以降）">
        <input
          aria-label="作成日"
          type="date"
          value={(extractField(query, "created") ?? "").replace(/^>=/, "")}
          onChange={(e) => {
            setQuery(upsertField(query, "created", e.target.value === "" ? null : `>=${e.target.value}`));
            void runQuery();
          }}
          style={{ ...inputStyle, width: "100%" }}
        />
      </Field>

      <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
        <button type="button" onClick={clearFields} style={{ ...buttonStyle, flex: 1 }}>
          クリア
        </button>
      </div>
    </Sheet>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 13, color: "var(--text-dim)", marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  );
}

function chipStyle(active: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    minHeight: "var(--tap)",
    padding: "0 12px",
    background: active ? "var(--accent)" : "var(--surface-raised)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    cursor: "pointer",
  };
}

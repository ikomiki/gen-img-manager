import { useEffect, useMemo, useState } from "react";
import { DayPicker } from "react-day-picker";
import "react-day-picker/style.css";
import { useQueryStore } from "../store/useQueryStore";
import { extractField, upsertField } from "../util/queryTokens";
import { applyPromptField, promptFieldToInput } from "../util/promptQuery";
import { imageDateInfo, localDateToDate, dateToLocalString } from "../util/imageDates";
import {
  parseRatingToken,
  buildRatingToken,
  RATING_VALUES,
  type RatingValue,
} from "../util/ratingFilter";

interface Props {
  onClose: () => void;
}

/** created トークン値 (">=A" / "<=B" / "A..B" / "A") を from/to へ分解。 */
function parseCreated(v: string | null): { from: string; to: string } {
  if (!v) return { from: "", to: "" };
  if (v.includes("..")) {
    const [a, b] = v.split("..");
    return { from: a ?? "", to: b ?? "" };
  }
  if (v.startsWith(">=")) return { from: v.slice(2), to: "" };
  if (v.startsWith("<=")) return { from: "", to: v.slice(2) };
  return { from: v, to: v };
}

/**
 * from/to から created トークン値を生成。
 * NOTE: 単一日（from==to）は `A..A` になる。バックエンドは bare な `A` も `A..A` も
 * 同日の Range(0時, 23:59:59) として解釈するため意味は同じ（トークン表記のみ変わる）。
 */
function buildCreated(from: string, to: string): string | null {
  if (from && to) return `${from}..${to}`;
  if (from) return `>=${from}`;
  if (to) return `<=${to}`;
  return null;
}

/** ">=N" から N を取り出す。整数のみ。 */
function parseMin(v: string | null): string {
  const m = v?.match(/^>=(\d+)$/);
  return m ? m[1] : "";
}

/** レーティングボタンのラベル（"なし" / "★N"）。 */
function ratingLabel(v: RatingValue): string {
  return v === "none" ? "なし" : `★${v}`;
}

export function FilterDialog({ onClose }: Props) {
  const query = useQueryStore((s) => s.query);
  const setQuery = useQueryStore((s) => s.setQuery);
  const runQuery = useQueryStore((s) => s.runQuery);
  const results = useQueryStore((s) => s.results);

  const [ratings, setRatings] = useState<Set<RatingValue>>(
    () => parseRatingToken(extractField(query, "rating")),
  );
  const [minWidth, setMinWidth] = useState(() => parseMin(extractField(query, "width")));
  const [minHeight, setMinHeight] = useState(() => parseMin(extractField(query, "height")));
  const [createdFrom, setCreatedFrom] = useState(() => parseCreated(extractField(query, "created")).from);
  const [createdTo, setCreatedTo] = useState(() => parseCreated(extractField(query, "created")).to);
  const [prompt, setPrompt] = useState(() => promptFieldToInput(query, "prompt"));
  const [negative, setNegative] = useState(() => promptFieldToInput(query, "negative"));
  const [model, setModel] = useState(() => extractField(query, "model") ?? "");
  const [sampler, setSampler] = useState(() => extractField(query, "sampler") ?? "");
  const [tool, setTool] = useState(() => extractField(query, "tool") ?? "");

  const dateInfo = useMemo(() => imageDateInfo(results), [results]);
  const highlighted = useMemo(
    () => [...dateInfo.dates].map(localDateToDate),
    [dateInfo],
  );

  const yearRange = useMemo(() => {
    const today = new Date();
    const lo = localDateToDate(dateInfo.min ?? dateToLocalString(today));
    const hi = localDateToDate(dateInfo.max ?? dateToLocalString(today));
    return {
      start: new Date(lo.getFullYear(), 0, 1),
      end: new Date(hi.getFullYear(), 11, 1),
    };
  }, [dateInfo.min, dateInfo.max]);

  const [fromMonth, setFromMonth] = useState<Date>(() =>
    localDateToDate(createdFrom || dateInfo.min || dateToLocalString(new Date())),
  );
  const [toMonth, setToMonth] = useState<Date>(() =>
    localDateToDate(createdTo || dateInfo.max || dateToLocalString(new Date())),
  );

  const apply = async () => {
    let q = query;
    q = upsertField(q, "rating", buildRatingToken(ratings));
    q = upsertField(q, "width", minWidth ? `>=${minWidth}` : null);
    q = upsertField(q, "height", minHeight ? `>=${minHeight}` : null);
    q = upsertField(q, "created", buildCreated(createdFrom, createdTo));
    q = applyPromptField(q, "prompt", prompt.trim());
    q = applyPromptField(q, "negative", negative.trim());
    q = upsertField(q, "model", model.trim() || null);
    q = upsertField(q, "sampler", sampler.trim() || null);
    q = upsertField(q, "tool", tool.trim() || null);
    setQuery(q);
    try {
      await runQuery();
    } catch (e) {
      console.error("フィルタ適用に失敗しました:", e);
    } finally {
      onClose();
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();   // フルスクリーン解除抑止（ベストエフォート）
        e.stopPropagation();  // App グローバルキーへ伝播させない
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  // レーティングボタンのトグル。
  const toggleRating = (v: RatingValue) => {
    setRatings((prev) => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next;
    });
  };

  // 下限セレクト（入力補助）。N〜5 を ON・他を OFF に一括置換する。
  const applyMinRating = (n: number) => {
    const next = new Set<RatingValue>();
    for (let r = n; r <= 5; r++) next.add(r as RatingValue);
    setRatings(next);
  };

  const modifiers = { hasImages: highlighted };
  const modifiersClassNames = { hasImages: "rdp-has-images" };

  return (
    <div className="dialog-backdrop">
      <div className="dialog filter-dialog">
        <h3>詳細フィルタ</h3>

        <div className="filter-fields">
          <label>
            <span className="field-label">レーティング</span>
            <span className="field-input rating-field">
              <span className="rating-buttons" role="group" aria-label="レーティング">
                {RATING_VALUES.map((v) => (
                  <button
                    key={String(v)}
                    type="button"
                    className={`rating-toggle${ratings.has(v) ? " on" : ""}`}
                    aria-label={`レーティング: ${ratingLabel(v)}`}
                    aria-pressed={ratings.has(v)}
                    onClick={() => toggleRating(v)}
                  >
                    {ratingLabel(v)}
                  </button>
                ))}
              </span>
              <select
                className="rating-min-helper"
                value=""
                onChange={(e) => {
                  if (e.target.value) applyMinRating(Number(e.target.value));
                }}
                aria-label="レーティング下限"
                title="下限を選ぶとそれ以上を一括ON"
              >
                <option value="">下限で一括選択…</option>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>★{n}以上</option>
                ))}
              </select>
            </span>
          </label>

          <label>
            <span className="field-label">幅下限(px)</span>
            <span className="field-input">
              <input type="number" min="0" step="1" value={minWidth} onChange={(e) => setMinWidth(e.target.value)}
                aria-label="幅下限(px)" spellCheck={false} autoCorrect="off" autoCapitalize="off" autoComplete="off" />
              {minWidth && (
                <button type="button" className="field-clear" aria-label="幅下限(px)をクリア" onClick={() => setMinWidth("")}>✕</button>
              )}
            </span>
          </label>

          <label>
            <span className="field-label">高さ下限(px)</span>
            <span className="field-input">
              <input type="number" min="0" step="1" value={minHeight} onChange={(e) => setMinHeight(e.target.value)}
                aria-label="高さ下限(px)" spellCheck={false} autoCorrect="off" autoCapitalize="off" autoComplete="off" />
              {minHeight && (
                <button type="button" className="field-clear" aria-label="高さ下限(px)をクリア" onClick={() => setMinHeight("")}>✕</button>
              )}
            </span>
          </label>

          <label>
            <span className="field-label">プロンプト</span>
            <span className="field-input">
              <input type="text" value={prompt} onChange={(e) => setPrompt(e.target.value)}
                aria-label="プロンプト" spellCheck={false} autoCorrect="off" autoCapitalize="off" autoComplete="off" />
              {prompt && (
                <button type="button" className="field-clear" aria-label="プロンプトをクリア" onClick={() => setPrompt("")}>✕</button>
              )}
            </span>
          </label>
          <p className="field-hint">
            AND=両方　OR=どちらか　-=除外　&quot;句&quot;=フレーズ　()=グループ
          </p>

          <label>
            <span className="field-label">ネガティブ</span>
            <span className="field-input">
              <input type="text" value={negative} onChange={(e) => setNegative(e.target.value)}
                aria-label="ネガティブ" spellCheck={false} autoCorrect="off" autoCapitalize="off" autoComplete="off" />
              {negative && (
                <button type="button" className="field-clear" aria-label="ネガティブをクリア" onClick={() => setNegative("")}>✕</button>
              )}
            </span>
          </label>

          <label>
            <span className="field-label">モデル名</span>
            <span className="field-input">
              <input type="text" value={model} onChange={(e) => setModel(e.target.value)}
                aria-label="モデル名" spellCheck={false} autoCorrect="off" autoCapitalize="off" autoComplete="off" />
              {model && (
                <button type="button" className="field-clear" aria-label="モデル名をクリア" onClick={() => setModel("")}>✕</button>
              )}
            </span>
          </label>

          <label>
            <span className="field-label">サンプラー</span>
            <span className="field-input">
              <input type="text" value={sampler} onChange={(e) => setSampler(e.target.value)}
                aria-label="サンプラー" spellCheck={false} autoCorrect="off" autoCapitalize="off" autoComplete="off" />
              {sampler && (
                <button type="button" className="field-clear" aria-label="サンプラーをクリア" onClick={() => setSampler("")}>✕</button>
              )}
            </span>
          </label>

          <label>
            <span className="field-label">ツール</span>
            <span className="field-input">
              <input type="text" value={tool} onChange={(e) => setTool(e.target.value)}
                aria-label="ツール" spellCheck={false} autoCorrect="off" autoCapitalize="off" autoComplete="off" />
              {tool && (
                <button type="button" className="field-clear" aria-label="ツールをクリア" onClick={() => setTool("")}>✕</button>
              )}
            </span>
          </label>
        </div>

        <div className="date-fields">
          <div className="date-field">
            <div className="date-field-head">
              <span>作成日 開始</span>
              <button
                type="button"
                disabled={!dateInfo.min}
                onClick={() => {
                  if (!dateInfo.min) return;
                  setCreatedFrom(dateInfo.min);
                  setFromMonth(localDateToDate(dateInfo.min));
                }}
              >
                {dateInfo.min ? `最小: ${dateInfo.min}` : "最小: -"}
              </button>
              {createdFrom && (
                <button type="button" className="date-clear" onClick={() => setCreatedFrom("")}>
                  クリア
                </button>
              )}
            </div>
            <DayPicker
              mode="single"
              captionLayout="dropdown"
              startMonth={yearRange.start}
              endMonth={yearRange.end}
              month={fromMonth}
              onMonthChange={setFromMonth}
              selected={createdFrom ? localDateToDate(createdFrom) : undefined}
              onSelect={(d) => setCreatedFrom(d ? dateToLocalString(d) : "")}
              modifiers={modifiers}
              modifiersClassNames={modifiersClassNames}
            />
          </div>

          <div className="date-field">
            <div className="date-field-head">
              <span>作成日 終了</span>
              <button
                type="button"
                disabled={!dateInfo.max}
                onClick={() => {
                  if (!dateInfo.max) return;
                  setCreatedTo(dateInfo.max);
                  setToMonth(localDateToDate(dateInfo.max));
                }}
              >
                {dateInfo.max ? `最大: ${dateInfo.max}` : "最大: -"}
              </button>
              {createdTo && (
                <button type="button" className="date-clear" onClick={() => setCreatedTo("")}>
                  クリア
                </button>
              )}
            </div>
            <DayPicker
              mode="single"
              captionLayout="dropdown"
              startMonth={yearRange.start}
              endMonth={yearRange.end}
              month={toMonth}
              onMonthChange={setToMonth}
              selected={createdTo ? localDateToDate(createdTo) : undefined}
              onSelect={(d) => setCreatedTo(d ? dateToLocalString(d) : "")}
              modifiers={modifiers}
              modifiersClassNames={modifiersClassNames}
            />
          </div>
        </div>

        <div className="dialog-actions">
          <button onClick={onClose}>キャンセル</button>
          <button onClick={() => void apply()}>適用</button>
        </div>
      </div>
    </div>
  );
}

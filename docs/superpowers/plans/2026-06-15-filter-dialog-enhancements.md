# フィルタダイアログ強化（プロンプト論理演算・日付ピッカー）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** フィルタダイアログのプロンプト/ネガティブ欄で論理演算（AND/OR/除外/フレーズ/グループ化）を書けるようにし、日付ピッカーに年月ドロップダウンと「相手の月を開く」ボタンを追加する。

**Architecture:** クエリ DSL（`parse.rs`）にフィールド値の括弧式 `prompt:(...)` を追加し、中身を FTS5 の列スコープ式 `positive : (...)` へ変換する。`compile.rs` は無変更（完成済み FTS5 式を MATCH に渡すだけ）。フロントは「ダイアログ欄入力 ⇄ クエリ文字列」変換を純粋関数（`src/util/promptQuery.ts`）に切り出し、FilterDialog から呼ぶ。日付ピッカーは react-day-picker v10 の `captionLayout="dropdown"` と制御 `month` 化で対応する。

**Tech Stack:** Rust (rusqlite, FTS5), TypeScript, React 19, react-day-picker v10, vitest, cargo test。

設計書: `docs/superpowers/specs/2026-06-15-filter-dialog-enhancements-design.md`

---

## File Structure

**変更:**
- `src-tauri/src/query/parse.rs` — `tokenize` に括弧バランス追跡を追加（`field:(...)` を1トークン化）、`field_expr_to_fts` 関数を新設、`parse()` でテキストフィールド値が `(...)` のとき同関数を使う。インラインテスト追加。
- `src/util/queryTokens.ts` — `tokenizeQuery` に同じ括弧バランス追跡を追加（`serializeToken`/`extractField`/`upsertField` は括弧トークンを quoted=false の素トークンとして自然に扱えるため大きな変更不要）。
- `src/components/FilterDialog.tsx` — プロンプト/ネガティブ欄を `promptQuery` 経由に差し替え、記法ヘルプ行を追加、日付ピッカーをドロップダウン＋制御 month 化、月ジャンプボタンを追加。
- `src/App.css` — `.field-hint`（記法ヘルプ）と `.date-jump` ボタンのスタイル追加。

**新規:**
- `src/util/promptQuery.ts` — 欄入力⇄クエリ変換の純粋関数（`splitPromptInput` / `applyPromptField` / `promptFieldToInput`）。
- `src/util/promptQuery.test.ts` — 上記のテスト。

**無変更（確認のみ）:**
- `src-tauri/src/query/compile.rs` — `fts_include`/`fts_exclude` をそのまま MATCH に渡すため変更不要。Task 3 完了後に既存テストが通ることで確認。

---

## Phase A: バックエンド DSL（parse.rs）

### Task 1: `tokenize` に括弧バランス追跡を追加

`field:(...)` を空白で分割せず1トークンとして取り込む。括弧内はクォートを除去せず生のまま保持する（フィールド値内のフレーズ情報を失わないため）。

**Files:**
- Modify: `src-tauri/src/query/parse.rs`（`tokenize` 関数 49-92 行、テストは同ファイル `#[cfg(test)] mod tests`）

- [ ] **Step 1: 失敗するテストを追加**

`src-tauri/src/query/parse.rs` の `mod tests` 末尾（446 行 `}` の直前）に追加:

```rust
    #[test]
    fn field_paren_value_is_single_token() {
        // prompt:(forest AND cabin) は空白で割れず1トークンとして field 値になる。
        let pq = parse("prompt:(forest AND cabin)");
        assert_eq!(
            pq.fts_include.as_deref(),
            Some("positive : (\"forest\" AND \"cabin\")")
        );
        assert_eq!(pq.fts_exclude, None);
        assert!(pq.conds.is_empty());
    }
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cargo test --manifest-path src-tauri/Cargo.toml field_paren_value_is_single_token`
Expected: FAIL（現状は `prompt:(forest` と `AND` と `cabin)` に割れるため期待文字列にならない）

- [ ] **Step 3: `tokenize` に括弧追跡を実装**

`tokenize` 関数を以下に置き換える（49-92 行）:

```rust
/// 空白区切り。ダブルクォートで囲まれた部分は1トークン（クォートは外す）。
/// lead にはクォート前の素のテキストを記録し、フィールド判定に用いる。
/// 例外: `field:(...)` のフィールド値括弧は、対応する `)` まで（内側のクォート・
/// 空白も含め）生のまま1トークンに取り込む（中身は field_expr_to_fts が解釈する）。
fn tokenize(input: &str) -> Vec<RawToken> {
    let mut tokens = Vec::new();
    let mut cur = String::new();
    let mut lead = String::new();
    let mut in_quote = false;
    let mut quoted = false;
    // フィールド値括弧の状態。paren_depth>0 の間は空白で区切らずクォートも外さない。
    let mut paren_depth: u32 = 0;
    let mut paren_in_quote = false;

    let flush = |cur: &mut String, lead: &mut String, quoted: &mut bool, tokens: &mut Vec<RawToken>| {
        if !cur.is_empty() || *quoted {
            tokens.push(RawToken {
                text: std::mem::take(cur),
                quoted: *quoted,
                lead: std::mem::take(lead),
            });
            *quoted = false;
        } else {
            lead.clear();
        }
    };

    for c in input.chars() {
        if paren_depth > 0 {
            // フィールド値括弧の内側: 生のまま積む。lead は更新しない。
            cur.push(c);
            if c == '"' {
                paren_in_quote = !paren_in_quote;
            } else if !paren_in_quote {
                if c == '(' {
                    paren_depth += 1;
                } else if c == ')' {
                    paren_depth -= 1;
                }
            }
            continue;
        }
        match c {
            '"' => {
                if in_quote {
                    in_quote = false;
                } else {
                    in_quote = true;
                    quoted = true;
                }
            }
            // コロン直後の '(' はフィールド値括弧の開始（未クォート時のみ）。
            '(' if !in_quote && !quoted && cur.ends_with(':') && cur.len() > 1 => {
                cur.push('(');
                paren_depth = 1;
                paren_in_quote = false;
            }
            c if c.is_whitespace() && !in_quote => {
                flush(&mut cur, &mut lead, &mut quoted, &mut tokens);
            }
            _ => {
                cur.push(c);
                if !quoted {
                    lead.push(c);
                }
            }
        }
    }
    flush(&mut cur, &mut lead, &mut quoted, &mut tokens);
    tokens
}
```

このステップだけでは Step 1 のテストはまだ通らない（`field_expr_to_fts` 未実装のため `parse()` がフィールド値 `(forest AND cabin)` を `fts_quote` で1フレーズ化してしまう）。Task 2・3 で完成させる。ここでは「tokenize が1トークンに取り込む」ことだけ先に作る。

- [ ] **Step 4: tokenize 単体の挙動を確認するテストを追加し、コンパイルが通ることを確認**

`mod tests` 末尾に一時確認用テストを追加:

```rust
    #[test]
    fn field_paren_is_not_split_into_bare_terms() {
        // 暫定: field_expr_to_fts 未実装の段階では1フレーズ化される。
        // Task 3 完了後にこのテストは削除する。
        let pq = parse("prompt:(forest AND cabin)");
        // 少なくとも "AND" や "cabin)" が独立トークンとして混ざっていないこと。
        let inc = pq.fts_include.unwrap_or_default();
        assert!(!inc.contains("\"cabin)\""), "got: {inc}");
    }
```

Run: `cargo test --manifest-path src-tauri/Cargo.toml field_paren_is_not_split_into_bare_terms`
Expected: PASS（tokenize が `(forest AND cabin)` を1トークン化できている）

- [ ] **Step 5: コミット**

```bash
git add src-tauri/src/query/parse.rs
git commit -m "feat(query): tokenize で field:(...) を1トークンとして取り込む"
```

---

### Task 2: `field_expr_to_fts` 関数を追加

フィールド値の括弧式（`(forest AND cabin OR sunset)`）を FTS5 式（`("forest" AND "cabin" OR "sunset")`）へ変換する純粋関数。語は `fts_quote` でクォート、`AND`/`OR`（大文字のみ）と括弧はそのまま転写する。空白区切りは FTS5 の暗黙 AND に委ねる。除外（`-`/`NOT`）はスコープ外（フロントが括弧の外へ出すため正常系では現れない）。

**Files:**
- Modify: `src-tauri/src/query/parse.rs`（`fts_quote`（95-97 行）の直後に関数追加、テストは `mod tests`）

- [ ] **Step 1: 失敗するテストを追加**

`mod tests` 末尾に追加:

```rust
    #[test]
    fn field_expr_to_fts_quotes_terms_and_keeps_operators() {
        assert_eq!(
            field_expr_to_fts("(forest AND cabin OR sunset)"),
            "( \"forest\" AND \"cabin\" OR \"sunset\" )"
        );
    }

    #[test]
    fn field_expr_to_fts_handles_nested_and_phrases() {
        assert_eq!(
            field_expr_to_fts("((forest AND cabin) OR \"best quality\")"),
            "( ( \"forest\" AND \"cabin\" ) OR \"best quality\" )"
        );
    }

    #[test]
    fn field_expr_to_fts_lowercase_and_is_a_term() {
        // 小文字 and は演算子でなく検索語（FTS5 準拠: 演算子は大文字のみ）。
        assert_eq!(field_expr_to_fts("(cat and dog)"), "( \"cat\" \"and\" \"dog\" )");
    }
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cargo test --manifest-path src-tauri/Cargo.toml field_expr_to_fts`
Expected: FAIL with "cannot find function `field_expr_to_fts`"

- [ ] **Step 3: 関数を実装**

`fts_quote` 関数（95-97 行）の直後に追加:

```rust
/// フィールド値内のミニ論理式を FTS5 式へ変換する。
/// - 裸の語 → fts_quote でダブルクォート（インジェクション/構文エラー対策）
/// - `AND` / `OR`（大文字のみ）→ そのまま転写（FTS5 演算子）
/// - `(` / `)` → そのまま転写（FTS5 がグループ化を解釈）
/// - `"..."` → 中身を fts_quote でフレーズとして転写
/// 空白区切りは FTS5 の暗黙 AND に委ねる。出力はスペース結合（FTS5 はスペースを無視）。
fn field_expr_to_fts(value: &str) -> String {
    let mut out: Vec<String> = Vec::new();
    let mut chars = value.chars().peekable();
    while let Some(&c) = chars.peek() {
        match c {
            '(' | ')' => {
                out.push(c.to_string());
                chars.next();
            }
            c if c.is_whitespace() => {
                chars.next();
            }
            '"' => {
                chars.next(); // 開きクォート
                let mut s = String::new();
                while let Some(&c2) = chars.peek() {
                    chars.next();
                    if c2 == '"' {
                        break;
                    }
                    s.push(c2);
                }
                out.push(fts_quote(&s));
            }
            _ => {
                let mut s = String::new();
                while let Some(&c2) = chars.peek() {
                    if c2.is_whitespace() || c2 == '(' || c2 == ')' || c2 == '"' {
                        break;
                    }
                    s.push(c2);
                    chars.next();
                }
                if s == "AND" || s == "OR" {
                    out.push(s);
                } else {
                    out.push(fts_quote(&s));
                }
            }
        }
    }
    out.join(" ")
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cargo test --manifest-path src-tauri/Cargo.toml field_expr_to_fts`
Expected: PASS（3 テスト）

- [ ] **Step 5: コミット**

```bash
git add src-tauri/src/query/parse.rs
git commit -m "feat(query): フィールド値の括弧式を FTS5 式へ変換する field_expr_to_fts を追加"
```

---

### Task 3: `parse()` でテキストフィールドの括弧式を `field_expr_to_fts` 経由にする

テキストフィールド（prompt/negative/model/filename）の値が `(` で始まるとき `field_expr_to_fts` を使い、それ以外は従来どおり `fts_quote`。肯定・除外の両方に適用する。

**Files:**
- Modify: `src-tauri/src/query/parse.rs`（`parse()` の text_field 分岐 223-231 行）

- [ ] **Step 1: 失敗するテストを追加し、暫定テストを削除**

まず Task 1 Step 4 で追加した暫定テスト `field_paren_is_not_split_into_bare_terms` を削除する。次に `mod tests` 末尾へ追加:

```rust
    #[test]
    fn field_paren_negation_goes_to_exclude() {
        // -prompt:(blurry OR lowres) は除外側へ。
        let pq = parse("-prompt:(blurry OR lowres)");
        assert_eq!(pq.fts_include, None);
        assert_eq!(
            pq.fts_exclude.as_deref(),
            Some("positive : ( \"blurry\" OR \"lowres\" )")
        );
    }

    #[test]
    fn field_paren_combined_with_exclude_and_cond() {
        let pq = parse("prompt:(forest AND cabin) -prompt:blurry rating:>=4");
        assert_eq!(
            pq.fts_include.as_deref(),
            Some("positive : ( \"forest\" AND \"cabin\" )")
        );
        assert_eq!(pq.fts_exclude.as_deref(), Some("positive : \"blurry\""));
        assert_eq!(
            pq.conds,
            vec![Cond { column: "rating", op: CondOp::Ge(4), negate: false }]
        );
    }

    #[test]
    fn legacy_field_values_unchanged() {
        // 後方互換: 括弧なしの既存記法は従来どおり。
        assert_eq!(parse("prompt:forest").fts_include.as_deref(), Some("positive : \"forest\""));
        assert_eq!(parse("prompt:\"best quality\"").fts_include.as_deref(), Some("positive : \"best quality\""));
        let pq = parse("prompt:forest cabin");
        assert_eq!(pq.fts_include.as_deref(), Some("positive : \"forest\" AND \"cabin\""));
    }
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cargo test --manifest-path src-tauri/Cargo.toml field_paren`
Expected: FAIL（`field_paren_value_is_single_token`・`field_paren_negation_goes_to_exclude`・`field_paren_combined_with_exclude_and_cond` が、値が `fts_quote` で1フレーズ化されるため不一致）

- [ ] **Step 3: `parse()` の text_field 分岐を修正**

`parse()` 内の text_field 分岐（223-231 行）を以下に置き換える:

```rust
                if let Some(col) = text_field_column(field) {
                    // 値が括弧式なら論理式として展開、それ以外は従来どおり1フレーズ。
                    let rhs = if value.starts_with('(') {
                        field_expr_to_fts(value)
                    } else {
                        fts_quote(value)
                    };
                    let expr = format!("{col} : {rhs}");
                    if negate {
                        excludes.push(expr);
                    } else {
                        append_include(&mut include, &mut include_or_pending, &expr);
                    }
                    continue;
                }
```

- [ ] **Step 4: 新規・既存テストが全て通ることを確認**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS（parse の新規テスト、`legacy_field_values_unchanged` を含む既存テスト、compile.rs の既存テストすべて。`compile.rs` 無変更で通ることを確認）

- [ ] **Step 5: コミット**

```bash
git add src-tauri/src/query/parse.rs
git commit -m "feat(query): prompt:(...) 等の括弧式を FTS5 列スコープ式へ展開"
```

---

## Phase B: フロント変換ロジック

### Task 4: `tokenizeQuery` に括弧バランス追跡を追加

`parse.rs` と同仕様で、`prompt:(...)` をフロントでも1トークンとして扱えるようにする。これにより既存の `upsertField`/`serializeToken` が括弧式トークンを壊さない。

**Files:**
- Modify: `src/util/queryTokens.ts`（`tokenizeQuery` 19-58 行）
- Modify: `src/util/queryTokens.test.ts`（`describe("tokenizeQuery", ...)` を新設）

- [ ] **Step 1: 失敗するテストを追加**

`src/util/queryTokens.test.ts` の `import` 行を更新し、末尾に追加:

```ts
import { extractField, upsertField, tokenizeQuery } from "./queryTokens";
```

```ts
describe("tokenizeQuery 括弧式", () => {
  it("keeps field:(...) as one token", () => {
    const toks = tokenizeQuery("prompt:(forest AND cabin) rating:>=4");
    expect(toks.map((t) => t.text)).toEqual(["prompt:(forest AND cabin)", "rating:>=4"]);
    expect(toks[0].lead).toBe("prompt:");
    expect(toks[0].quoted).toBe(false);
    expect(toks[0].negate).toBe(false);
  });

  it("keeps -field:(...) as one negated token", () => {
    const toks = tokenizeQuery("-prompt:(a OR b)");
    expect(toks).toHaveLength(1);
    expect(toks[0].negate).toBe(true);
    expect(toks[0].text).toBe("prompt:(a OR b)");
    expect(toks[0].lead).toBe("prompt:");
  });

  it("keeps quotes inside the paren value", () => {
    const toks = tokenizeQuery('prompt:("best quality" AND x)');
    expect(toks[0].text).toBe('prompt:("best quality" AND x)');
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/util/queryTokens.test.ts -t "括弧式"`
Expected: FAIL（現状は空白で分割される）

- [ ] **Step 3: `tokenizeQuery` を修正**

`src/util/queryTokens.ts` の `tokenizeQuery`（19-58 行）を以下に置き換える:

```ts
export function tokenizeQuery(input: string): RawToken[] {
  const tokens: RawToken[] = [];
  let cur = "";
  let lead = "";
  let inQuote = false;
  let quoted = false;
  // フィールド値括弧の状態。parenDepth>0 の間は空白で区切らずクォートも外さない。
  let parenDepth = 0;
  let parenInQuote = false;

  const flush = () => {
    if (cur !== "" || quoted) {
      const negate = lead.startsWith("-");
      const text = negate ? cur.slice(1) : cur;
      const leadStripped = negate ? lead.slice(1) : lead;
      if (text !== "" || quoted) {
        tokens.push({ text, quoted, lead: leadStripped, negate });
      }
    }
    cur = "";
    lead = "";
    quoted = false;
  };

  for (const c of input) {
    if (parenDepth > 0) {
      cur += c;
      if (c === '"') {
        parenInQuote = !parenInQuote;
      } else if (!parenInQuote) {
        if (c === "(") parenDepth++;
        else if (c === ")") parenDepth--;
      }
      continue;
    }
    if (c === '"') {
      if (inQuote) {
        inQuote = false;
      } else {
        inQuote = true;
        quoted = true;
      }
    } else if (c === "(" && !inQuote && !quoted && cur.endsWith(":") && cur.length > 1) {
      cur += "(";
      parenDepth = 1;
      parenInQuote = false;
    } else if (/\s/.test(c) && !inQuote) {
      flush();
    } else {
      cur += c;
      if (!quoted) lead += c;
    }
  }
  flush();
  return tokens;
}
```

- [ ] **Step 4: 新規・既存テストが通ることを確認**

Run: `npx vitest run src/util/queryTokens.test.ts`
Expected: PASS（既存 11 テスト＋括弧式 3 テスト）

- [ ] **Step 5: コミット**

```bash
git add src/util/queryTokens.ts src/util/queryTokens.test.ts
git commit -m "feat(query): フロントの tokenizeQuery を括弧式に対応"
```

---

### Task 5: `promptQuery.ts` を新設（欄入力⇄クエリ変換）

ダイアログのプロンプト/ネガティブ欄の入力（`forest AND cabin -blurry`）と、クエリ内の `prompt:(...)` / `-prompt:...` トークンを相互変換する純粋関数。

**Files:**
- Create: `src/util/promptQuery.ts`
- Create: `src/util/promptQuery.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`src/util/promptQuery.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { splitPromptInput, applyPromptField, promptFieldToInput } from "./promptQuery";

describe("splitPromptInput", () => {
  it("separates top-level excludes from the positive expression", () => {
    expect(splitPromptInput("forest AND cabin -blurry")).toEqual({
      positive: "forest AND cabin",
      excludes: ["blurry"],
    });
  });

  it("keeps a parenthesized group as part of the positive expression", () => {
    expect(splitPromptInput("(a AND b) OR c -bad")).toEqual({
      positive: "(a AND b) OR c",
      excludes: ["bad"],
    });
  });

  it("does not treat a hyphen inside parens as a top-level exclude", () => {
    expect(splitPromptInput("(a-b) cat")).toEqual({
      positive: "(a-b) cat",
      excludes: [],
    });
  });

  it("returns empty for blank input", () => {
    expect(splitPromptInput("   ")).toEqual({ positive: "", excludes: [] });
  });
});

describe("applyPromptField", () => {
  it("writes a single bare word without parens", () => {
    expect(applyPromptField("1girl", "prompt", "forest")).toBe("1girl prompt:forest");
  });

  it("wraps a logical expression in parens", () => {
    expect(applyPromptField("", "prompt", "forest AND cabin")).toBe("prompt:(forest AND cabin)");
  });

  it("emits a single exclude as -prompt:word", () => {
    expect(applyPromptField("", "prompt", "forest -blurry")).toBe("prompt:forest -prompt:blurry");
  });

  it("groups multiple excludes with OR", () => {
    expect(applyPromptField("", "prompt", "forest -blurry -lowres")).toBe(
      "prompt:forest -prompt:(blurry OR lowres)",
    );
  });

  it("replaces existing positive and negated prompt tokens, preserving others", () => {
    const q = "prompt:(old AND thing) -prompt:bad rating:>=4 1girl";
    expect(applyPromptField(q, "prompt", "forest")).toBe("rating:>=4 1girl prompt:forest");
  });

  it("clears the field when input is empty", () => {
    expect(applyPromptField("prompt:(a AND b) -prompt:c 1girl", "prompt", "")).toBe("1girl");
  });
});

describe("promptFieldToInput", () => {
  it("unwraps a parenthesized positive value", () => {
    expect(promptFieldToInput("prompt:(forest AND cabin)", "prompt")).toBe("forest AND cabin");
  });

  it("keeps a quoted phrase quoted", () => {
    expect(promptFieldToInput('prompt:"best quality"', "prompt")).toBe('"best quality"');
  });

  it("renders a single bare word as-is", () => {
    expect(promptFieldToInput("prompt:forest", "prompt")).toBe("forest");
  });

  it("appends excludes as -word", () => {
    expect(promptFieldToInput("prompt:(forest AND cabin) -prompt:blurry", "prompt")).toBe(
      "forest AND cabin -blurry",
    );
  });

  it("expands a grouped exclude into -word tokens", () => {
    expect(promptFieldToInput("prompt:forest -prompt:(blurry OR lowres)", "prompt")).toBe(
      "forest -blurry -lowres",
    );
  });

  it("round-trips through applyPromptField", () => {
    const input = "forest AND cabin -blurry";
    const q = applyPromptField("", "prompt", input);
    expect(promptFieldToInput(q, "prompt")).toBe(input);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/util/promptQuery.test.ts`
Expected: FAIL with "Failed to resolve import './promptQuery'"

- [ ] **Step 3: `promptQuery.ts` を実装**

`src/util/promptQuery.ts`:

```ts
/**
 * フィルタダイアログのプロンプト/ネガティブ欄の入力と、クエリ内の
 * `field:(...)` / `-field:...` トークンを相互変換する純粋関数群。
 *
 * 欄入力の記法: スペース=AND / AND・OR（大文字）/ -語=除外 / "句"=フレーズ / ()=グループ。
 * 除外（トップレベルの -語）は肯定式から分離し、-field:... として書き出す。
 * 括弧の中身（肯定式）の FTS5 変換はバックエンド（parse.rs）が行うため、ここでは触らない。
 */
import { tokenizeQuery, type RawToken } from "./queryTokens";

/** 欄入力をトップレベルの空白/括弧で分割し、各要素を返す（クォート・括弧内の空白は保持）。 */
function topLevelTokens(input: string): string[] {
  const out: string[] = [];
  let cur = "";
  let depth = 0;
  let inQuote = false;
  for (const c of input) {
    if (c === '"') {
      inQuote = !inQuote;
      cur += c;
    } else if (inQuote) {
      cur += c;
    } else if (c === "(") {
      depth++;
      cur += c;
    } else if (c === ")") {
      if (depth > 0) depth--;
      cur += c;
    } else if (/\s/.test(c) && depth === 0) {
      if (cur !== "") out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  if (cur !== "") out.push(cur);
  return out;
}

/** 欄入力を肯定式と除外語に分離する。 */
export function splitPromptInput(input: string): { positive: string; excludes: string[] } {
  const tokens = topLevelTokens(input.trim());
  const positive: string[] = [];
  const excludes: string[] = [];
  for (const t of tokens) {
    if (t.startsWith("-") && t.length > 1) {
      excludes.push(t.slice(1));
    } else {
      positive.push(t);
    }
  }
  return { positive: positive.join(" "), excludes };
}

/** 肯定式が単一の裸の語（演算子・括弧・空白・クォートなし）か。 */
function isBareWord(expr: string): boolean {
  return expr !== "" && !/[\s()"]/.test(expr) && expr !== "AND" && expr !== "OR";
}

/** field の肯定トークンを生成（単一語は括弧なし、複雑な式は括弧で包む）。 */
function buildPositiveToken(field: string, positive: string): string | null {
  if (positive === "") return null;
  if (isBareWord(positive)) return `${field}:${positive}`;
  return `${field}:(${positive})`;
}

/** field の除外トークンを生成（単一は -field:word、複数は -field:(a OR b)）。 */
function buildExcludeToken(field: string, excludes: string[]): string | null {
  if (excludes.length === 0) return null;
  if (excludes.length === 1 && isBareWord(excludes[0])) return `-${field}:${excludes[0]}`;
  return `-${field}:(${excludes.join(" OR ")})`;
}

/** クエリ内の field の肯定/除外トークンを差し替えて返す。他トークンは順序を保って温存。 */
export function applyPromptField(query: string, field: string, input: string): string {
  const kept: string[] = [];
  for (const t of tokenizeQuery(query)) {
    const colon = t.lead.indexOf(":");
    const isField = colon >= 0 && t.lead.slice(0, colon) === field;
    if (isField) continue; // 肯定・除外どちらの field トークンも除去
    kept.push(serialize(t));
  }
  const { positive, excludes } = splitPromptInput(input);
  const pos = buildPositiveToken(field, positive);
  const neg = buildExcludeToken(field, excludes);
  if (pos) kept.push(pos);
  if (neg) kept.push(neg);
  return kept.join(" ").trim();
}

/** RawToken を元のクエリ片へ復元する（queryTokens の serializeToken と同等）。 */
function serialize(t: RawToken): string {
  const sign = t.negate ? "-" : "";
  if (t.quoted) {
    const valuePart = t.text.slice(t.lead.length);
    return `${sign}${t.lead}"${valuePart}"`;
  }
  return `${sign}${t.text}`;
}

/** field トークンの値部分（colon 以降）を取り出す。 */
function fieldValue(t: RawToken): string {
  const colon = t.lead.indexOf(":");
  return t.text.slice(colon + 1);
}

/** `(a OR b)` 形式の括弧式を ["a","b"] へ分解（トップレベル OR 区切り）。 */
function splitOrGroup(value: string): string[] {
  const inner = value.slice(1, -1); // 外側括弧を外す
  return topLevelTokens(inner).filter((t) => t !== "OR");
}

/** クエリから field の肯定/除外をまとめて欄表示文字列へ復元する。 */
export function promptFieldToInput(query: string, field: string): string {
  let positive = "";
  const excludes: string[] = [];
  for (const t of tokenizeQuery(query)) {
    const colon = t.lead.indexOf(":");
    if (colon < 0 || t.lead.slice(0, colon) !== field) continue;
    const value = fieldValue(t);
    if (t.negate) {
      if (value.startsWith("(")) excludes.push(...splitOrGroup(value));
      else excludes.push(value);
    } else {
      if (value.startsWith("(")) positive = value.slice(1, -1);
      else if (t.quoted) positive = `"${value}"`;
      else positive = value;
    }
  }
  const parts: string[] = [];
  if (positive) parts.push(positive);
  for (const e of excludes) parts.push(`-${e}`);
  return parts.join(" ");
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/util/promptQuery.test.ts`
Expected: PASS（全テスト）

- [ ] **Step 5: コミット**

```bash
git add src/util/promptQuery.ts src/util/promptQuery.test.ts
git commit -m "feat(filter): プロンプト欄入力⇄クエリ変換の promptQuery を追加"
```

---

## Phase C: ダイアログ UI（FilterDialog.tsx）

### Task 6: プロンプト/ネガティブ欄を promptQuery 経由にし、記法ヘルプを追加

**Files:**
- Modify: `src/components/FilterDialog.tsx`（import 4-6 行、state 66-67 行、apply 84-85 行、プロンプト欄 193-213 行）
- Modify: `src/components/FilterDialog.test.tsx`（既存「forest cabin」テストを新仕様へ更新、新テスト追加）
- Modify: `src/App.css`（`.field-hint` 追加）

- [ ] **Step 1: 既存テストを新仕様へ更新し、失敗する新テストを追加**

`src/components/FilterDialog.test.tsx` の `upserts managed fields...`（39-52 行）の期待値を更新:

```ts
  it("upserts managed fields and preserves the rest on apply", async () => {
    const setQuery = vi.fn();
    useQueryStore.setState({ setQuery, runQuery: vi.fn().mockResolvedValue(undefined) });

    render(<FilterDialog onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("プロンプト"), { target: { value: "forest AND cabin" } });
    fireEvent.click(screen.getByText("適用"));

    expect(setQuery).toHaveBeenCalled();
    const q = setQuery.mock.calls[0][0] as string;
    expect(q).toContain("1girl");
    expect(q).toContain("rating:>=4");
    expect(q).toContain("prompt:(forest AND cabin)");
  });
```

`populates controls...`（29-37 行）のプロンプト期待値を更新（初期クエリ `prompt:"best quality"` はフレーズなので欄にはクォート付きで出る）:

```ts
    expect((screen.getByLabelText("プロンプト") as HTMLInputElement).value).toBe('"best quality"');
```

`✕ ボタンでプロンプト入力をクリアできる`（115-121 行）の初期値も同様に更新:

```ts
  it("✕ ボタンでプロンプト入力をクリアできる", () => {
    render(<FilterDialog onClose={() => {}} />);
    const input = screen.getByLabelText("プロンプト") as HTMLInputElement;
    expect(input.value).toBe('"best quality"');
    fireEvent.click(screen.getByLabelText("プロンプトをクリア"));
    expect(input.value).toBe("");
  });
```

`describe` 末尾に新テストを追加:

```ts
  it("writes excludes from the prompt field as -prompt", () => {
    const setQuery = vi.fn();
    useQueryStore.setState({ query: "", setQuery, runQuery: vi.fn().mockResolvedValue(undefined) });
    render(<FilterDialog onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("プロンプト"), { target: { value: "forest -blurry" } });
    fireEvent.click(screen.getByText("適用"));
    expect(setQuery).toHaveBeenCalledWith("prompt:forest -prompt:blurry");
  });

  it("記法ヘルプ行を表示する", () => {
    render(<FilterDialog onClose={() => {}} />);
    expect(screen.getByText(/AND=両方/)).toBeTruthy();
  });
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/components/FilterDialog.test.tsx`
Expected: FAIL（プロンプト初期値が `best quality`、apply 結果が `prompt:"forest AND cabin"` のため不一致。ヘルプ行も未存在）

- [ ] **Step 3: FilterDialog を修正**

import を変更（4-6 行）。`extractField, upsertField` の import から `extractField` を残しつつ `promptQuery` を追加:

```tsx
import { extractField, upsertField } from "../util/queryTokens";
import { applyPromptField, promptFieldToInput } from "../util/promptQuery";
import { imageDateInfo, localDateToDate, dateToLocalString } from "../util/imageDates";
```

prompt/negative の state 初期化（66-67 行）を置き換え:

```tsx
  const [prompt, setPrompt] = useState(() => promptFieldToInput(query, "prompt"));
  const [negative, setNegative] = useState(() => promptFieldToInput(query, "negative"));
```

apply 内の prompt/negative 反映（84-85 行）を置き換え:

```tsx
    q = applyPromptField(q, "prompt", prompt.trim());
    q = applyPromptField(q, "negative", negative.trim());
```

プロンプト欄の `</label>`（202 行）の直後（ネガティブ欄の前）に記法ヘルプ行を追加:

```tsx
          <p className="field-hint">
            AND=両方　OR=どちらか　-=除外　&quot;句&quot;=フレーズ　()=グループ
          </p>
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/components/FilterDialog.test.tsx`
Expected: PASS（更新済み既存テスト＋新テスト）

- [ ] **Step 5: CSS を追加してコミット**

`src/App.css` の `.filter-fields` 関連の近くに追加（`.field-input` の定義の後など、フィルタダイアログのスタイル群に隣接させる）:

```css
.field-hint {
  margin: 2px 0 8px;
  font-size: 12px;
  color: var(--muted, #888);
  line-height: 1.4;
}
```

```bash
git add src/components/FilterDialog.tsx src/components/FilterDialog.test.tsx src/App.css
git commit -m "feat(filter): プロンプト/ネガティブ欄を論理式入力に対応し記法ヘルプを追加"
```

---

### Task 7: 日付ピッカーを年月ドロップダウン＋制御 month 化

**Files:**
- Modify: `src/components/FilterDialog.tsx`（state 追加、DayPicker 2 箇所 266-273 / 292-299 行、「最小/最大」ボタン 253-259 / 279-285 行）
- Modify: `src/components/FilterDialog.test.tsx`（ドロップダウン存在テスト追加）

- [ ] **Step 1: 失敗するテストを追加**

`src/components/FilterDialog.test.tsx` の `describe` 末尾に追加:

```ts
  it("年月ドロップダウンを表示する", () => {
    render(<FilterDialog onClose={() => {}} />);
    // captionLayout="dropdown" は月・年の <select> を描画する（aria 属性で month/year ドロップダウン）。
    const combos = screen.getAllByRole("combobox");
    // レーティング下限セレクト + 開始(月,年) + 終了(月,年) = 少なくとも 5 個。
    expect(combos.length).toBeGreaterThanOrEqual(5);
  });
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/components/FilterDialog.test.tsx -t "年月ドロップダウン"`
Expected: FAIL（現状の DayPicker は `captionLayout="label"` 相当でドロップダウンを描画しない）

- [ ] **Step 3: 表示月 state と年範囲を追加し、DayPicker を制御化**

`dateInfo`/`highlighted` の定義（72-76 行）の直後に、年範囲と表示月 state を追加:

```tsx
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
```

開始 DayPicker（266-273 行）を置き換え:

```tsx
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
```

終了 DayPicker（292-299 行）を置き換え:

```tsx
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
```

「最小」ボタン（253-259 行）の onClick を、選択日と表示月の両方を更新するよう変更:

```tsx
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
```

「最大」ボタン（279-285 行）も同様に変更:

```tsx
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
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/components/FilterDialog.test.tsx`
Expected: PASS（「年月ドロップダウン」を含む全テスト）

- [ ] **Step 5: コミット**

```bash
git add src/components/FilterDialog.tsx src/components/FilterDialog.test.tsx
git commit -m "feat(filter): 日付ピッカーを年月ドロップダウン＋表示月制御に変更"
```

---

### Task 8: 「相手の月を開く」ボタンを追加

開始カレンダーに「終了月を開く」、終了カレンダーに「開始月を開く」。相手の選択日の月へ自分の表示月をジャンプ。相手が未選択なら disabled。

**Files:**
- Modify: `src/components/FilterDialog.tsx`（開始/終了の `date-field-head` 内、260-264 / 286-290 行のクリアボタン付近）
- Modify: `src/components/FilterDialog.test.tsx`（月ジャンプの挙動テスト追加）
- Modify: `src/App.css`（`.date-jump` 任意のスタイル）

- [ ] **Step 1: 失敗するテストを追加**

`src/components/FilterDialog.test.tsx` の `describe` 末尾に追加:

```ts
  it("「終了月を開く」は終了日が未選択なら無効", () => {
    useQueryStore.setState({ query: "" });
    render(<FilterDialog onClose={() => {}} />);
    expect((screen.getByText("終了月を開く") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText("開始月を開く") as HTMLButtonElement).disabled).toBe(true);
  });

  it("相手の選択日があれば月ジャンプボタンが有効", () => {
    useQueryStore.setState({ query: "created:2025-03-10..2025-08-20" });
    render(<FilterDialog onClose={() => {}} />);
    // 開始=2025-03-10, 終了=2025-08-20 がともに選択済み。
    expect((screen.getByText("終了月を開く") as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByText("開始月を開く") as HTMLButtonElement).disabled).toBe(false);
  });
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/components/FilterDialog.test.tsx -t "月を開く"`
Expected: FAIL（ボタンが存在しない）

- [ ] **Step 3: ボタンを追加**

開始の `date-field-head` 内、クリアボタンのブロック（260-264 行）の直後に追加:

```tsx
              <button
                type="button"
                className="date-jump"
                disabled={!createdTo}
                onClick={() => createdTo && setFromMonth(localDateToDate(createdTo))}
              >
                終了月を開く
              </button>
```

終了の `date-field-head` 内、クリアボタンのブロック（286-290 行）の直後に追加:

```tsx
              <button
                type="button"
                className="date-jump"
                disabled={!createdFrom}
                onClick={() => createdFrom && setToMonth(localDateToDate(createdFrom))}
              >
                開始月を開く
              </button>
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/components/FilterDialog.test.tsx`
Expected: PASS（月ジャンプ 2 テストを含む全テスト）

- [ ] **Step 5: 全テスト・lint を実行してコミット**

```bash
npx vitest run
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml
```
Expected: いずれも成功（既存テストの回帰なし）

```bash
git add src/components/FilterDialog.tsx src/components/FilterDialog.test.tsx src/App.css
git commit -m "feat(filter): 開始/終了カレンダーに相手の月を開くボタンを追加"
```

---

## 最終確認（手動）

`npm run tauri dev` で起動し、以下を確認する（jsdom で検証しづらい部分）:

- プロンプト欄に `forest AND cabin OR sunset -blurry` を入力 → 適用 → フィルタバーに `prompt:(forest AND cabin OR sunset) -prompt:blurry` が出て、検索結果が期待どおり絞られる。
- ネガティブ欄でも同様に動く（`negative:(...)`）。
- 既存の保存クエリ（`prompt:"best quality"` 等）を開いて適用しても壊れない。
- 日付ピッカーで年・月ドロップダウンが効き、離れた年月へ一気に移動できる。
- 終了日を選んでから開始カレンダーの「終了月を開く」を押すと、開始カレンダーが終了日の月へ移動する。相手未選択時はボタンが無効。

---

## Self-Review（計画作成者によるチェック結果）

- **Spec coverage**: 論理演算（Task 1-6）/ 年月ドロップダウン（Task 7）/ 月ジャンプボタン（Task 8）/ 記法ヘルプ（Task 6）/ 後方互換テスト（Task 3 `legacy_field_values_unchanged`）/ 除外の外出し（Task 3・5）—— spec の各要件にタスクが対応。
- **Placeholder scan**: 各コード手順に完全なコードを記載。TBD/TODO なし。
- **Type consistency**: `field_expr_to_fts`（Rust）/ `splitPromptInput`・`applyPromptField`・`promptFieldToInput`（TS）/ `fromMonth`・`toMonth`・`yearRange`（React state）の名称はタスク間で一致。
- **既知の非一貫（許容）**: トップレベルの `OR` は既存実装が大小無視、フィールド括弧内の `AND`/`OR` は大文字のみ（FTS5 準拠）。実害は小さく、記法ヘルプで大文字を案内するため許容。

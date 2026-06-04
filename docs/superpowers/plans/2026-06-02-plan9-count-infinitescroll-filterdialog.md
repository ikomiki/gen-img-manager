# Plan9: 件数表示・全件表示・詳細フィルタダイアログ強化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ディレクトリ件数の正しい表示、画像一覧の全件表示、詳細フィルタダイアログの現在値反映・文字列/日付コントロール追加（カレンダーのハイライト含む）を実現する。

**Architecture:** バックエンドは `list_directories` が相関サブクエリで件数(`image_count`)を返すよう拡張し、日付パーサをローカルTZ基準(chrono)に変更、クエリ文法に `field:"quoted value"` を追加する。フロントは結果を全件ロード(`LIMIT -1`)し、`FilterDialog` を react-day-picker ベースに刷新（現在クエリの取り込み・テキスト欄・min/maxボタン・存在日ハイライト）。クエリのトークン読み書きは純粋関数 `queryTokens` に、日付集計は `imageDates` に切り出してテストする。

**Tech Stack:** Rust + rusqlite + chrono / React 19 + Zustand 5 + TypeScript(strict) + react-day-picker + @tanstack/react-virtual / Vitest + cargo test

**全体方針（grill-me合意事項）:**
- 要件1: 件数は `Directory.image_count`（`list_directories` の相関サブクエリ, `missing=0`）。scan-done で `loadDirectories()` 再取得（件数・last_scanned_at・is_online を一括更新）。`imageCounts` ストア・`count_images` コマンドは廃止。
- 要件2: 全件一括取得（`queryImages(..., -1, 0)`）。`total = results.length`、`countQuery` 呼び出しは廃止。
- 要件3: ダイアログは開いた時点のクエリから管理対象フィールド（rating/width/height/created/prompt/negative/model/sampler/tool）の**非除外トークン**を取り込み、適用時にそれらだけ upsert。素の語・OR・除外(-token)・未対応フィールドは温存。
- 要件4: 作成日 開始/終了それぞれに「最小/最大」ボタン（現在の `results` から算出, ローカル日付）。0件時は無効化。片側のみで `created:>=A` / `created:<=B`、両方で `created:A..B`。
- 要件5: react-day-picker のインライン2カレンダー。`results` から算出した「画像が存在するローカル日付」を `hasImages` modifier でハイライト。
- TZ: 作成日は**ローカル基準に統一**。バックエンド `date_to_epoch` を chrono::Local に変更（既存 created/modified フィルタもローカル基準に）。
- 文法拡張: `field:"a b"` をサポート（トークナイザがクォート前の素のリード部でフィールド判定）。フロントの `queryTokens` も同仕様。

---

## File Structure

**バックエンド (Rust)**
- `src-tauri/Cargo.toml` — `chrono` を直接依存に追加。
- `src-tauri/src/models.rs` — `Directory` に `image_count: i64` 追加。
- `src-tauri/src/db/directories.rs` — `list`/`get` SQL に相関サブクエリで件数追加、`row_to_dir` 更新。
- `src-tauri/src/db/images.rs` — 未使用化する `count_in_directory` を削除。
- `src-tauri/src/commands/scan.rs` — `count_images` コマンド削除。
- `src-tauri/src/lib.rs` — `commands::scan::count_images` 登録解除。
- `src-tauri/src/query/parse.rs` — `date_to_epoch` を chrono::Local 化（自前の暦計算関数を削除）、トークナイザに `lead` を導入し `field:"quoted"` 対応。

**フロント (TypeScript)**
- `package.json` — `react-day-picker` 追加。
- `src/types.ts` — `Directory` に `image_count: number` 追加。
- `src/api/scan.ts` — `countImages` 削除。
- `src/store/useLibraryStore.ts` — `imageCounts`/`setImageCount` 削除。
- `src/store/useLibraryStore.test.ts` — `imageCounts` 関連を削除、`dir()` モックに `image_count`。
- `src/store/useQueryStore.ts` — `runQuery` を全件ロードへ、`total = results.length`、`PAGE` 削除。
- `src/store/useQueryStore.test.ts` — `countQuery` モック削除、全件＝total の検証へ。
- `src/components/DirectoryPanel.tsx` — `image_count` 表示、scan-done で `loadDirectories()`。
- `src/util/queryTokens.ts`（新規）+ `.test.ts` — トークナイズ・フィールド抽出/upsert（クォート対応）。
- `src/util/imageDates.ts`（新規）+ `.test.ts` — ローカル日付集合・min/max 算出と Date 変換ヘルパ。
- `src/components/FilterDialog.tsx` — react-day-picker ベースに刷新。
- `src/components/FilterDialog.test.tsx`（新規）— 現在値取り込み・適用の結合テスト。
- `src/App.css` — ダイアログ・カレンダーのスタイル。

---

## Task 1: バックエンド — Directory.image_count（相関サブクエリ）

**Files:**
- Modify: `src-tauri/src/models.rs`
- Modify: `src-tauri/src/db/directories.rs`
- Test: `src-tauri/src/db/directories.rs`（既存 `mod tests` に追加）

- [ ] **Step 1: 失敗するテストを追加**

`src-tauri/src/db/directories.rs` の `mod tests` 内、先頭で `use crate::db::images::NewImage;` を追加し、次のテストを追加する:

```rust
    #[test]
    fn list_includes_image_count_excluding_missing() {
        let c = conn();
        let d = add(&c, "/a", "a", true).unwrap();
        // 画像なしは 0。
        assert_eq!(list(&c).unwrap()[0].image_count, 0);

        crate::db::images::upsert(
            &c,
            &NewImage {
                directory_id: d.id,
                path: "/a/x.png".into(),
                filename: "x.png".into(),
                size: 1,
                mtime: 1,
                format: "png".into(),
                source_tool: "a1111".into(),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(list(&c).unwrap()[0].image_count, 1);
        assert_eq!(get(&c, d.id).unwrap().image_count, 1);

        // missing は除外。
        c.execute("UPDATE images SET missing = 1", []).unwrap();
        assert_eq!(list(&c).unwrap()[0].image_count, 0);
    }
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd src-tauri && cargo test -p gen-img-manager directories::`
Expected: コンパイルエラー（`Directory` に `image_count` フィールドが無い）。

- [ ] **Step 3: モデルに image_count を追加**

`src-tauri/src/models.rs`:

```rust
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Directory {
    pub id: i64,
    pub path: String,
    pub label: String,
    pub is_online: bool,
    pub last_scanned_at: Option<i64>,
    pub recursive: bool,
    pub visible: bool,
    pub image_count: i64,
}
```

- [ ] **Step 4: SQL とロウマッパを更新**

`src-tauri/src/db/directories.rs` の `get` と `list` の SQL を相関サブクエリ付きに変更し、`row_to_dir` で 7 番目の列を読む:

```rust
pub fn get(conn: &Connection, id: i64) -> rusqlite::Result<Directory> {
    conn.query_row(
        "SELECT id, path, label, is_online, last_scanned_at, recursive, visible,
                (SELECT count(*) FROM images i WHERE i.directory_id = directories.id AND i.missing = 0)
         FROM directories WHERE id = ?1",
        params![id],
        row_to_dir,
    )
}

pub fn list(conn: &Connection) -> rusqlite::Result<Vec<Directory>> {
    let mut stmt = conn.prepare(
        "SELECT id, path, label, is_online, last_scanned_at, recursive, visible,
                (SELECT count(*) FROM images i WHERE i.directory_id = directories.id AND i.missing = 0)
         FROM directories ORDER BY label COLLATE NOCASE",
    )?;
    let rows = stmt.query_map([], row_to_dir)?;
    rows.collect()
}
```

```rust
fn row_to_dir(r: &rusqlite::Row) -> rusqlite::Result<Directory> {
    Ok(Directory {
        id: r.get(0)?,
        path: r.get(1)?,
        label: r.get(2)?,
        is_online: r.get::<_, i64>(3)? != 0,
        last_scanned_at: r.get(4)?,
        recursive: r.get::<_, i64>(5)? != 0,
        visible: r.get::<_, i64>(6)? != 0,
        image_count: r.get(7)?,
    })
}
```

- [ ] **Step 5: テストが通ることを確認**

Run: `cd src-tauri && cargo test -p gen-img-manager directories::`
Expected: PASS（既存テストも含め緑）。

- [ ] **Step 6: コミット**

```bash
git add src-tauri/src/models.rs src-tauri/src/db/directories.rs
git commit -m "feat(dirs): expose image_count via list_directories"
```

---

## Task 2: バックエンド — count_images コマンド削除

**Files:**
- Modify: `src-tauri/src/commands/scan.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/db/images.rs`

- [ ] **Step 1: 参照状況を確認**

Run: `cd src-tauri && grep -rn "count_in_directory\|count_images" src/`
Expected: `count_in_directory` は `commands/scan.rs` の `count_images` からのみ、`count_images` は `scan.rs` 定義と `lib.rs` 登録のみ。他参照が無いことを確認（あれば本タスクを中止して報告）。

- [ ] **Step 2: count_images コマンドを削除**

`src-tauri/src/commands/scan.rs` から次のブロックを削除する:

```rust
/// ディレクトリ内の（missing除く）画像件数を返す。
#[tauri::command]
pub fn count_images(db: State<Db>, id: i64) -> Result<i64, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    images::count_in_directory(&conn, id).map_err(|e| e.to_string())
}
```

- [ ] **Step 3: lib.rs の登録を解除**

`src-tauri/src/lib.rs` の `invoke_handler` 配列から `commands::scan::count_images,` の行を削除する。

- [ ] **Step 4: 未使用になった count_in_directory を削除**

`src-tauri/src/db/images.rs` から次を削除する（Step 1 で他参照が無いことを確認済み）:

```rust
pub fn count_in_directory(conn: &Connection, directory_id: i64) -> rusqlite::Result<i64> {
    conn.query_row(
        "SELECT count(*) FROM images WHERE directory_id = ?1 AND missing = 0",
        params![directory_id],
        |r| r.get(0),
    )
}
```

`images.rs` 内に `count_in_directory` のテストがあれば併せて削除する（`grep -n count_in_directory src/db/images.rs` で確認）。

- [ ] **Step 5: ビルドと警告チェック**

Run: `cd src-tauri && cargo build 2>&1 | grep -i "warning\|error" ; cargo test -p gen-img-manager`
Expected: `count_images`/`count_in_directory` 関連の未使用警告・エラーが無く、全テスト PASS。`images` の use が未使用になった場合は `scan.rs` の `use` を調整する。

- [ ] **Step 6: コミット**

```bash
git add src-tauri/src/commands/scan.rs src-tauri/src/lib.rs src-tauri/src/db/images.rs
git commit -m "refactor(scan): drop count_images in favor of list_directories count"
```

---

## Task 3: バックエンド — date_to_epoch をローカルTZ(chrono)化

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/query/parse.rs`
- Test: `src-tauri/src/query/parse.rs`（既存テスト更新）

- [ ] **Step 1: chrono を依存に追加**

`src-tauri/Cargo.toml` の `[dependencies]` に追加:

```toml
chrono = "0.4"
```

- [ ] **Step 2: 既存テストをローカル基準へ更新（失敗させる）**

`src-tauri/src/query/parse.rs` の `date_range_converts_to_epoch_seconds` を次に置き換える（固定UTC値をやめ、chrono で期待値を算出してTZ非依存にする）:

```rust
    #[test]
    fn date_range_converts_to_epoch_seconds() {
        use chrono::{Local, NaiveDate, TimeZone};
        let pq = parse("created:2025-01-01..2025-01-02");
        assert_eq!(pq.conds.len(), 1);
        assert_eq!(pq.conds[0].column, "created_at");
        let lo = Local
            .from_local_datetime(&NaiveDate::from_ymd_opt(2025, 1, 1).unwrap().and_hms_opt(0, 0, 0).unwrap())
            .earliest()
            .unwrap()
            .timestamp();
        let hi = Local
            .from_local_datetime(&NaiveDate::from_ymd_opt(2025, 1, 2).unwrap().and_hms_opt(23, 59, 59).unwrap())
            .earliest()
            .unwrap()
            .timestamp();
        assert_eq!(pq.conds[0].op, CondOp::Range(lo, hi));
    }
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `cd src-tauri && cargo test -p gen-img-manager query::parse::date_range_converts_to_epoch_seconds`
Expected: FAIL（現状 UTC 計算のため、JST 等では期待値と不一致）。CI が UTC の環境でも、Step 4 適用前は実装差異でコンパイル/論理エラーになり得る。

- [ ] **Step 4: date_to_epoch を chrono 実装に置換し、自前暦計算を削除**

`src-tauri/src/query/parse.rs` 冒頭の `use` に追加:

```rust
use chrono::{Local, NaiveDate, TimeZone};
```

`is_leap` / `days_in_month` / `date_to_epoch` / `days_from_civil` の 4 関数を削除し、次の `date_to_epoch` のみを置く:

```rust
/// "YYYY-MM-DD" をローカルTZの epoch 秒へ。end_of_day=true なら同日 23:59:59。
/// DST の重なり/欠落は最早の瞬間を採用する。
fn date_to_epoch(s: &str, end_of_day: bool) -> Option<i64> {
    let parts: Vec<&str> = s.split('-').collect();
    if parts.len() != 3 {
        return None;
    }
    let y: i32 = parts[0].parse().ok()?;
    let m: u32 = parts[1].parse().ok()?;
    let d: u32 = parts[2].parse().ok()?;
    let date = NaiveDate::from_ymd_opt(y, m, d)?;
    let naive = if end_of_day {
        date.and_hms_opt(23, 59, 59)?
    } else {
        date.and_hms_opt(0, 0, 0)?
    };
    Local.from_local_datetime(&naive).earliest().map(|dt| dt.timestamp())
}
```

- [ ] **Step 5: テストが通ることを確認**

Run: `cd src-tauri && cargo test -p gen-img-manager query::parse::`
Expected: PASS。`invalid_date_is_ignored`（2025-02-30）は `NaiveDate::from_ymd_opt` が `None` を返すため引き続き無視され、`reverse_range_is_ignored` も `lo <= hi` チェックで維持される。

- [ ] **Step 6: コミット**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/query/parse.rs
git commit -m "feat(query): interpret created/modified dates in local timezone"
```

---

## Task 4: バックエンド — `field:"quoted value"` 対応

**Files:**
- Modify: `src-tauri/src/query/parse.rs`
- Test: `src-tauri/src/query/parse.rs`（既存 `mod tests` に追加）

- [ ] **Step 1: 失敗するテストを追加**

`src-tauri/src/query/parse.rs` の `mod tests` に追加:

```rust
    #[test]
    fn quoted_field_value_maps_to_fts_phrase() {
        let pq = parse("prompt:\"best quality\"");
        assert_eq!(pq.fts_include.as_deref(), Some("positive : \"best quality\""));
        assert_eq!(pq.fts_exclude, None);
        assert!(pq.conds.is_empty());
    }

    #[test]
    fn quoted_colon_phrase_is_not_a_field() {
        // クォート内のコロンはフィールド指定にしない（純粋句として扱う）。
        let pq = parse("\"foo:bar\"");
        assert_eq!(pq.fts_include.as_deref(), Some("\"foo:bar\""));
    }

    #[test]
    fn negated_quoted_field_value() {
        let pq = parse("-negative:\"low quality\"");
        assert_eq!(pq.fts_include, None);
        assert_eq!(pq.fts_exclude.as_deref(), Some("negative : \"low quality\""));
    }
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd src-tauri && cargo test -p gen-img-manager query::parse::quoted_field_value_maps_to_fts_phrase`
Expected: FAIL（現状はクォート語をフィールド扱いせず `"prompt:best quality"` のような素の句になる）。

- [ ] **Step 3: トークナイザに lead を追加**

`src-tauri/src/query/parse.rs` の `RawToken` と `tokenize` を次に置き換える:

```rust
struct RawToken {
    /// クォートを外した全文（例 prompt:a b）。
    text: String,
    /// クォートが1度でも出現したか。
    quoted: bool,
    /// 最初のクォートより前の「素の」リード部（例 prompt:"a b" なら "prompt:"）。
    /// クォートが先頭から始まる純粋句では空になる。
    lead: String,
}

/// 空白区切り。ダブルクォートで囲まれた部分は1トークン（クォートは外す）。
/// lead にはクォート前の素のテキストを記録し、フィールド判定に用いる。
fn tokenize(input: &str) -> Vec<RawToken> {
    let mut tokens = Vec::new();
    let mut cur = String::new();
    let mut lead = String::new();
    let mut in_quote = false;
    let mut quoted = false;

    let mut flush = |cur: &mut String, lead: &mut String, quoted: &mut bool, tokens: &mut Vec<RawToken>| {
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
        match c {
            '"' => {
                if in_quote {
                    in_quote = false;
                } else {
                    in_quote = true;
                    quoted = true;
                }
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

- [ ] **Step 4: parse のフィールド判定を lead ベースに変更**

`src-tauri/src/query/parse.rs` の `parse` 関数のループ本体（`for tok in tokens { ... }` の中身）を次に置き換える:

```rust
    for tok in tokens {
        if !tok.quoted && tok.text.eq_ignore_ascii_case("OR") {
            include_or_pending = true;
            continue;
        }

        // 先頭 '-' は除外。判定は素のリード部で行う（純粋句 "..." は lead が空なので除外記号を持てない）。
        let negate = tok.lead.starts_with('-');
        let body = if negate { tok.text[1..].to_string() } else { tok.text.clone() };
        let lead = if negate { tok.lead[1..].to_string() } else { tok.lead.clone() };
        if body.is_empty() {
            continue;
        }

        // フィールド検出はクォート前の lead 内のコロンで行う。
        // lead は body の先頭と一致するため、コロン位置は body 上でも同じ。
        if let Some(colon) = lead.find(':') {
            let field = &lead[..colon];
            let value = &body[colon + 1..];
            if !value.is_empty() {
                if let Some((column, kind)) = struct_field(field) {
                    let op = match kind {
                        FieldKind::Like => Some(CondOp::Like(value.to_string())),
                        FieldKind::Num { is_date } => parse_value_op(value, is_date),
                    };
                    if let Some(op) = op {
                        conds.push(Cond { column, op, negate });
                    }
                    continue;
                }
                if let Some(col) = text_field_column(field) {
                    let expr = format!("{} : {}", col, fts_quote(value));
                    if negate {
                        excludes.push(expr);
                    } else {
                        append_include(&mut include, &mut include_or_pending, &expr);
                    }
                    continue;
                }
            }
        }

        let expr = fts_quote(&body);
        if negate {
            excludes.push(expr);
        } else {
            append_include(&mut include, &mut include_or_pending, &expr);
        }
    }
```

- [ ] **Step 5: テストが通ることを確認**

Run: `cd src-tauri && cargo test -p gen-img-manager query::parse::`
Expected: PASS（新規3件＋既存全て。`field_exclusion`/`unknown_field_is_treated_as_bare_text`/`quoted_phrase` 等が引き続き緑）。

- [ ] **Step 6: コミット**

```bash
git add src-tauri/src/query/parse.rs
git commit -m "feat(query): support quoted field values like prompt:\"a b\""
```

---

## Task 5: フロント — 件数まわりの型/API/ストア整理

**Files:**
- Modify: `src/types.ts`
- Modify: `src/api/scan.ts`
- Modify: `src/store/useLibraryStore.ts`
- Test: `src/store/useLibraryStore.test.ts`

- [ ] **Step 1: テストを更新（失敗させる）**

`src/store/useLibraryStore.test.ts` を次の3点で更新する:

1. `dir()` モックに `image_count` を追加:

```ts
const dir = (id: number, label: string): import("../types").Directory => ({
  id, path: `/p/${label}`, label, is_online: true, last_scanned_at: null,
  recursive: true, visible: true, image_count: 0,
});
```

2. `beforeEach` の `setState` から `imageCounts` を除去:

```ts
  useLibraryStore.setState({ directories: [], scanning: {} });
```

3. `setImageCount stores the count by directory id` テストを削除する。

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/store/useLibraryStore.test.ts`
Expected: FAIL（型エラー、または存在しない `imageCounts`/`setImageCount` 参照）。

- [ ] **Step 3: 型に image_count を追加**

`src/types.ts` の `Directory`:

```ts
export interface Directory {
  id: number;
  path: string;
  label: string;
  is_online: boolean;
  last_scanned_at: number | null;
  recursive: boolean;
  visible: boolean;
  image_count: number;
}
```

- [ ] **Step 4: scan API から countImages を削除**

`src/api/scan.ts` の次の行を削除する:

```ts
export const countImages = (id: number) => invoke<number>("count_images", { id });
```

- [ ] **Step 5: ストアから imageCounts/setImageCount を削除**

`src/store/useLibraryStore.ts` を次に更新する（`imageCounts`・`setImageCount` を全削除）:

```ts
import { create } from "zustand";
import type { Directory, ScanProgress } from "../types";
import * as api from "../api/directories";

interface LibraryState {
  directories: Directory[];
  scanning: Record<number, ScanProgress | undefined>;
  loadDirectories: () => Promise<void>;
  addDirectory: (path: string, recursive: boolean) => Promise<void>;
  removeDirectory: (id: number) => Promise<void>;
  setDirectoryVisible: (id: number, visible: boolean) => Promise<void>;
  setScanProgress: (p: ScanProgress) => void;
  clearScanProgress: (id: number) => void;
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  directories: [],
  scanning: {},
  loadDirectories: async () => {
    set({ directories: await api.listDirectories() });
  },
  addDirectory: async (path, recursive) => {
    const created = await api.addDirectory(path, recursive);
    set({ directories: [...get().directories, created] });
  },
  removeDirectory: async (id) => {
    await api.removeDirectory(id);
    set({ directories: get().directories.filter((d) => d.id !== id) });
  },
  setDirectoryVisible: async (id, visible) => {
    await api.setDirectoryVisible(id, visible);
    set({
      directories: get().directories.map((d) =>
        d.id === id ? { ...d, visible } : d,
      ),
    });
  },
  setScanProgress: (p) => set({ scanning: { ...get().scanning, [p.directory_id]: p } }),
  clearScanProgress: (id) => {
    const next = { ...get().scanning };
    delete next[id];
    set({ scanning: next });
  },
}));
```

- [ ] **Step 6: テストが通ることを確認**

Run: `npx vitest run src/store/useLibraryStore.test.ts`
Expected: PASS。（この時点で `DirectoryPanel.tsx` は型エラーが残るが Task 6 で解消するため、`npx tsc` はまだ通らなくてよい。）

- [ ] **Step 7: コミット**

```bash
git add src/types.ts src/api/scan.ts src/store/useLibraryStore.ts src/store/useLibraryStore.test.ts
git commit -m "refactor(store): drop imageCounts; Directory carries image_count"
```

---

## Task 6: フロント — DirectoryPanel で image_count 表示・scan-done 再取得

**Files:**
- Modify: `src/components/DirectoryPanel.tsx`

- [ ] **Step 1: import とセレクタを整理**

`src/components/DirectoryPanel.tsx` 冒頭の不要 import を削除する。`import * as scanApi from "./api/scan"` は残り使用が無くなるため削除（下記 Step で `scanApi` 参照を消す）。`useLibraryStore` から `imageCounts`/`setImageCount` セレクタ行を削除し、`loadDirectories` を追加:

```tsx
  const loadDirectories = useLibraryStore((s) => s.loadDirectories);
```

（削除する行）

```tsx
  const imageCounts = useLibraryStore((s) => s.imageCounts);
  const setImageCount = useLibraryStore((s) => s.setImageCount);
```

- [ ] **Step 2: scan-done ハンドラを loadDirectories 再取得へ**

`useEffect` 内の `unlistenDone` を次に置き換える:

```tsx
    const unlistenDone = listen<ScanDone>("scan-done", async (e) => {
      const { directory_id: id, success } = e.payload;
      clearScanProgress(id);
      if (!success) {
        console.error("スキャンに失敗しました（directory_id）:", id);
      }
      // 件数・last_scanned_at・is_online を一括で最新化する。
      try {
        await loadDirectories();
      } catch (err) {
        console.error("loadDirectories failed:", err);
      }
      // スキャン完了で新しい画像が入った可能性があるため一覧も更新。
      void runQuery();
    });
```

`useEffect` の依存配列を更新する:

```tsx
  }, [setScanProgress, clearScanProgress, loadDirectories, runQuery]);
```

`import * as scanApi from "../api/scan";` を削除する（`scanApi.countImages` 参照が消えるため。`scanDirectory`/`scanAll` は `handleScan`/`handleScanAll` で使用しているので、これらが `scanApi` を使う場合は import を残す）。

> NOTE: `handleScan`/`handleScanAll` は `scanApi.scanDirectory`/`scanApi.scanAll` を使用している。したがって `import * as scanApi from "../api/scan";` は**残す**こと。削除するのは `countImages` 呼び出し箇所のみ（scan-done 内）。

- [ ] **Step 3: 2行目の件数を image_count から渡す**

`dirStatusLine` 呼び出しの `count` 引数を `d.image_count` に変更する:

```tsx
          const status = dirStatusLine({
            scanning: prog ? { processed: prog.processed, total: prog.total } : undefined,
            isOnline: d.is_online,
            count: d.image_count,
            lastScannedAt: d.last_scanned_at,
          });
```

- [ ] **Step 4: 型チェックとテスト**

Run: `npx tsc -p tsconfig.json && npx vitest run`
Expected: 型エラー無し、全テスト PASS。

- [ ] **Step 5: コミット**

```bash
git add src/components/DirectoryPanel.tsx
git commit -m "feat(dirs): show image_count and refresh directories on scan-done"
```

---

## Task 7: フロント — 画像一覧を全件ロード

**Files:**
- Modify: `src/store/useQueryStore.ts`
- Test: `src/store/useQueryStore.test.ts`

- [ ] **Step 1: テストを更新（失敗させる）**

`src/store/useQueryStore.test.ts` を次の通り更新する:

1. `runQuery loads results and total` を全件＝total の検証に変更し、`countQuery` モックを削除:

```ts
  it("runQuery loads all results and total equals length", async () => {
    vi.mocked(imagesApi.queryImages).mockResolvedValue([row(1, "a.png"), row(2, "b.png")]);
    await useQueryStore.getState().runQuery();
    expect(imagesApi.queryImages).toHaveBeenCalledWith("", "filename", "asc", -1, 0);
    expect(useQueryStore.getState().results).toHaveLength(2);
    expect(useQueryStore.getState().total).toBe(2);
  });
```

2. 他テスト中の `vi.mocked(imagesApi.countQuery).mockResolvedValue(...)` 行をすべて削除（`setSort updates...`, `runQuery persists the current filter query`）。`runQuery persists...` の `queryImages` モックは残す。

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/store/useQueryStore.test.ts`
Expected: FAIL（`queryImages` が `(..., 200, 0)` で呼ばれている / もしくは期待呼び出し不一致）。

- [ ] **Step 3: runQuery を全件ロードに変更**

`src/store/useQueryStore.ts` の `PAGE` 定数を削除し、`runQuery` を次に置き換える:

```ts
  runQuery: async () => {
    const { query, sort, dir } = get();
    // 全件取得（LIMIT -1）。total は取得件数から導出する。
    const results = await imagesApi.queryImages(query, sort, dir, -1, 0);
    set({ results, total: results.length });
    // 直前に効いていたフィルタを永続化する（次回起動時に復元する）。
    prefsApi
      .setSetting("filter_query", query)
      .catch((e) => console.error("setSetting(filter_query) failed:", e));
  },
```

（`const PAGE = 200;` の行を削除。）

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/store/useQueryStore.test.ts && npx tsc -p tsconfig.json`
Expected: PASS、型エラー無し。

- [ ] **Step 5: コミット**

```bash
git add src/store/useQueryStore.ts src/store/useQueryStore.test.ts
git commit -m "feat(query): load full result set (no 200-row cap)"
```

---

## Task 8: フロント — queryTokens ユーティリティ

**Files:**
- Create: `src/util/queryTokens.ts`
- Test: `src/util/queryTokens.test.ts`

- [ ] **Step 1: 失敗するテストを作成**

`src/util/queryTokens.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { extractField, upsertField } from "./queryTokens";

describe("extractField", () => {
  it("reads an unquoted field value", () => {
    expect(extractField("forest prompt:cat rating:>=4", "prompt")).toBe("cat");
    expect(extractField("forest prompt:cat rating:>=4", "rating")).toBe(">=4");
  });

  it("reads a quoted field value (with spaces)", () => {
    expect(extractField('prompt:"best quality" -blurry', "prompt")).toBe("best quality");
  });

  it("ignores negated tokens of the same field", () => {
    expect(extractField("-prompt:bad foo", "prompt")).toBeNull();
  });

  it("does not treat a quoted colon phrase as a field", () => {
    expect(extractField('"foo:bar"', "foo")).toBeNull();
  });

  it("returns null when field is absent", () => {
    expect(extractField("forest", "prompt")).toBeNull();
  });
});

describe("upsertField", () => {
  it("adds a new field token preserving the rest", () => {
    expect(upsertField("1girl -blurry", "rating", ">=4")).toBe("1girl -blurry rating:>=4");
  });

  it("replaces an existing non-negated field token", () => {
    expect(upsertField("prompt:old 1girl", "prompt", "new")).toBe("1girl prompt:new");
  });

  it("removes the field when value is null", () => {
    expect(upsertField("1girl prompt:old", "prompt", null)).toBe("1girl");
  });

  it("quotes values containing whitespace", () => {
    expect(upsertField("1girl", "prompt", "best quality")).toBe('1girl prompt:"best quality"');
  });

  it("preserves negated tokens of the same field", () => {
    expect(upsertField("-prompt:bad cat", "prompt", "good")).toBe('-prompt:bad cat prompt:good');
  });

  it("round-trips a quoted value", () => {
    const q = upsertField("", "prompt", "a b");
    expect(extractField(q, "prompt")).toBe("a b");
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/util/queryTokens.test.ts`
Expected: FAIL（モジュール未作成）。

- [ ] **Step 3: 実装を作成**

`src/util/queryTokens.ts`:

```ts
/**
 * クエリ文字列のトークン読み書きユーティリティ。
 * バックエンド (src-tauri/src/query/parse.rs) のトークナイザと同仕様:
 * - 空白区切り。ダブルクォートで囲んだ部分は1トークン（クォートは外す）。
 * - フィールド判定はクォート前の素のリード部 (lead) のコロンで行う
 *   （"foo:bar" のようにクォート内コロンはフィールド扱いしない）。
 */
export interface RawToken {
  /** クォートを外した全文（例 prompt:a b）。負号は除去済み。 */
  text: string;
  /** クォートが1度でも出現したか。 */
  quoted: boolean;
  /** 最初のクォートより前の素のリード部（例 "prompt:"）。負号は除去済み。 */
  lead: string;
  /** 先頭が '-' の除外トークンか。 */
  negate: boolean;
}

export function tokenizeQuery(input: string): RawToken[] {
  const tokens: RawToken[] = [];
  let cur = "";
  let lead = "";
  let inQuote = false;
  let quoted = false;

  const flush = () => {
    if (cur !== "" || quoted) {
      const negate = lead.startsWith("-");
      const text = negate ? cur.slice(1) : cur;
      const leadStripped = negate ? lead.slice(1) : lead;
      // 負号のみ（本体が空）のトークンは捨てる。
      if (text !== "" || quoted) {
        tokens.push({ text, quoted, lead: leadStripped, negate });
      }
    }
    cur = "";
    lead = "";
    quoted = false;
  };

  for (const c of input) {
    if (c === '"') {
      if (inQuote) {
        inQuote = false;
      } else {
        inQuote = true;
        quoted = true;
      }
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

/** 非除外の field トークンの値（最初の1件）を返す。無ければ null。 */
export function extractField(query: string, field: string): string | null {
  for (const t of tokenizeQuery(query)) {
    if (t.negate) continue;
    const colon = t.lead.indexOf(":");
    if (colon < 0) continue;
    if (t.lead.slice(0, colon) === field) {
      return t.text.slice(colon + 1);
    }
  }
  return null;
}

/** RawToken を元のクエリ片へ復元する。 */
function serializeToken(t: RawToken): string {
  const sign = t.negate ? "-" : "";
  if (t.quoted) {
    const valuePart = t.text.slice(t.lead.length);
    return `${sign}${t.lead}"${valuePart}"`;
  }
  return `${sign}${t.text}`;
}

/** field:value を生成（空白を含む値はクォート）。 */
function serializeField(field: string, value: string): string {
  const needsQuote = /\s/.test(value);
  return needsQuote ? `${field}:"${value}"` : `${field}:${value}`;
}

/**
 * 非除外の field トークンを除去し、value があれば末尾に追加する。
 * それ以外のトークン（素の語・OR・除外・他フィールド）は順序を保って温存する。
 */
export function upsertField(query: string, field: string, value: string | null): string {
  const kept: string[] = [];
  for (const t of tokenizeQuery(query)) {
    const colon = t.lead.indexOf(":");
    const isManaged = !t.negate && colon >= 0 && t.lead.slice(0, colon) === field;
    if (isManaged) continue;
    kept.push(serializeToken(t));
  }
  if (value != null && value !== "") {
    kept.push(serializeField(field, value));
  }
  return kept.join(" ").trim();
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/util/queryTokens.test.ts && npx tsc -p tsconfig.json`
Expected: PASS、型エラー無し。

- [ ] **Step 5: コミット**

```bash
git add src/util/queryTokens.ts src/util/queryTokens.test.ts
git commit -m "feat(filter): query token extract/upsert utility with quote handling"
```

---

## Task 9: フロント — imageDates ユーティリティ

**Files:**
- Create: `src/util/imageDates.ts`
- Test: `src/util/imageDates.test.ts`

- [ ] **Step 1: 失敗するテストを作成**

`src/util/imageDates.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { imageDateInfo, localDateToDate, dateToLocalString } from "./imageDates";

// ローカルTZでの epoch 秒を作る（テストのTZ非依存化）。
const localEpoch = (y: number, m: number, d: number, h = 12): number =>
  Math.floor(new Date(y, m - 1, d, h, 0, 0).getTime() / 1000);

describe("imageDateInfo", () => {
  it("returns null min/max for empty or all-null input", () => {
    expect(imageDateInfo([]).min).toBeNull();
    expect(imageDateInfo([{ created_at: null }]).max).toBeNull();
    expect(imageDateInfo([{ created_at: null }]).dates.size).toBe(0);
  });

  it("computes min/max and the set of local dates", () => {
    const info = imageDateInfo([
      { created_at: localEpoch(2025, 1, 3) },
      { created_at: localEpoch(2025, 6, 30) },
      { created_at: localEpoch(2025, 1, 3) },
      { created_at: null },
    ]);
    expect(info.min).toBe("2025-01-03");
    expect(info.max).toBe("2025-06-30");
    expect(info.dates.has("2025-01-03")).toBe(true);
    expect(info.dates.has("2025-06-30")).toBe(true);
    expect(info.dates.size).toBe(2);
  });
});

describe("date helpers", () => {
  it("round-trips a local date string and Date", () => {
    const d = localDateToDate("2025-03-09");
    expect(d.getFullYear()).toBe(2025);
    expect(d.getMonth()).toBe(2);
    expect(d.getDate()).toBe(9);
    expect(dateToLocalString(d)).toBe("2025-03-09");
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/util/imageDates.test.ts`
Expected: FAIL（モジュール未作成）。

- [ ] **Step 3: 実装を作成**

`src/util/imageDates.ts`:

```ts
/** epoch 秒（ローカルTZ解釈）を "YYYY-MM-DD" に。 */
export function epochToLocalDate(tsSec: number): string {
  return dateToLocalString(new Date(tsSec * 1000));
}

/** Date をローカルの "YYYY-MM-DD" に。 */
export function dateToLocalString(d: Date): string {
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** "YYYY-MM-DD" をローカル深夜0時の Date に。 */
export function localDateToDate(s: string): Date {
  const [y, m, d] = s.split("-").map((x) => parseInt(x, 10));
  return new Date(y, m - 1, d);
}

export interface ImageDateInfo {
  /** 画像が存在するローカル日付（"YYYY-MM-DD"）の集合。 */
  dates: Set<string>;
  /** 最小日付（"YYYY-MM-DD"）。該当なしは null。 */
  min: string | null;
  /** 最大日付（"YYYY-MM-DD"）。該当なしは null。 */
  max: string | null;
}

/** created_at（epoch秒, null可）の配列から日付集合と最小/最大を算出する。 */
export function imageDateInfo(rows: { created_at: number | null }[]): ImageDateInfo {
  const dates = new Set<string>();
  let minTs: number | null = null;
  let maxTs: number | null = null;
  for (const r of rows) {
    if (r.created_at == null) continue;
    dates.add(epochToLocalDate(r.created_at));
    if (minTs == null || r.created_at < minTs) minTs = r.created_at;
    if (maxTs == null || r.created_at > maxTs) maxTs = r.created_at;
  }
  return {
    dates,
    min: minTs == null ? null : epochToLocalDate(minTs),
    max: maxTs == null ? null : epochToLocalDate(maxTs),
  };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/util/imageDates.test.ts && npx tsc -p tsconfig.json`
Expected: PASS、型エラー無し。

- [ ] **Step 5: コミット**

```bash
git add src/util/imageDates.ts src/util/imageDates.test.ts
git commit -m "feat(filter): image date set/min/max utility (local timezone)"
```

---

## Task 10: フロント — react-day-picker 導入と FilterDialog 刷新

**Files:**
- Modify: `package.json`（`react-day-picker` 追加）
- Modify: `src/components/FilterDialog.tsx`
- Create: `src/components/FilterDialog.test.tsx`
- Modify: `src/App.css`

- [ ] **Step 1: react-day-picker を追加**

Run: `npm install react-day-picker`
Expected: `package.json` の `dependencies` に `react-day-picker`（v9 系）が追加され、React 19 環境でインストールが成功する。

- [ ] **Step 2: 失敗する結合テストを作成**

`src/components/FilterDialog.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FilterDialog } from "./FilterDialog";
import { useQueryStore } from "../store/useQueryStore";
import type { ImageRow } from "../types";

vi.mock("../api/images");
vi.mock("../api/prefs");

const row = (id: number, created_at: number | null): ImageRow => ({
  id, path: `/d/${id}.png`, filename: `${id}.png`, thumb_path: null,
  width: 100, height: 100, pixels: 10000, rating: null,
  created_at, modified_at: null, source_tool: "a1111", model: null,
});

beforeEach(() => {
  useQueryStore.setState({
    query: 'prompt:"best quality" 1girl rating:>=4',
    sort: "filename", dir: "asc",
    results: [row(1, null)], total: 1, history: [], showFilename: true,
  });
  vi.resetAllMocks();
});

describe("FilterDialog", () => {
  it("populates controls from the current query on open", () => {
    render(<FilterDialog onClose={() => {}} />);
    expect((screen.getByLabelText("プロンプト") as HTMLInputElement).value).toBe("best quality");
    expect((screen.getByLabelText("レーティング下限") as HTMLSelectElement).value).toBe("4");
  });

  it("upserts managed fields and preserves the rest on apply", async () => {
    const setQuery = vi.fn();
    useQueryStore.setState({ setQuery, runQuery: vi.fn().mockResolvedValue(undefined) });

    render(<FilterDialog onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("プロンプト"), { target: { value: "forest cabin" } });
    fireEvent.click(screen.getByText("適用"));

    expect(setQuery).toHaveBeenCalled();
    const q = setQuery.mock.calls[0][0] as string;
    expect(q).toContain("1girl");                  // 管理外は温存
    expect(q).toContain("rating:>=4");             // 既存の管理フィールド
    expect(q).toContain('prompt:"forest cabin"');  // 置換＋クォート
  });
});
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `npx vitest run src/components/FilterDialog.test.tsx`
Expected: FAIL（現行 `FilterDialog` には「プロンプト」欄が無く、現在値も取り込まない）。

- [ ] **Step 4: FilterDialog を刷新**

`src/components/FilterDialog.tsx` を全置換する:

```tsx
import { useMemo, useState } from "react";
import { DayPicker } from "react-day-picker";
import "react-day-picker/style.css";
import { useQueryStore } from "../store/useQueryStore";
import { extractField, upsertField } from "../util/queryTokens";
import { imageDateInfo, localDateToDate, dateToLocalString } from "../util/imageDates";

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

/** from/to から created トークン値を生成。 */
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

export function FilterDialog({ onClose }: Props) {
  const query = useQueryStore((s) => s.query);
  const setQuery = useQueryStore((s) => s.setQuery);
  const runQuery = useQueryStore((s) => s.runQuery);
  const results = useQueryStore((s) => s.results);

  // 開いた時点のクエリから初期値を取り込む。
  const initCreated = parseCreated(extractField(query, "created"));
  const [minRating, setMinRating] = useState(() => parseMin(extractField(query, "rating")));
  const [minWidth, setMinWidth] = useState(() => parseMin(extractField(query, "width")));
  const [minHeight, setMinHeight] = useState(() => parseMin(extractField(query, "height")));
  const [createdFrom, setCreatedFrom] = useState(initCreated.from);
  const [createdTo, setCreatedTo] = useState(initCreated.to);
  const [prompt, setPrompt] = useState(() => extractField(query, "prompt") ?? "");
  const [negative, setNegative] = useState(() => extractField(query, "negative") ?? "");
  const [model, setModel] = useState(() => extractField(query, "model") ?? "");
  const [sampler, setSampler] = useState(() => extractField(query, "sampler") ?? "");
  const [tool, setTool] = useState(() => extractField(query, "tool") ?? "");

  // 開く前のリストから日付情報（ハイライト・min/max）。
  const dateInfo = useMemo(() => imageDateInfo(results), [results]);
  const highlighted = useMemo(
    () => [...dateInfo.dates].map(localDateToDate),
    [dateInfo],
  );

  const apply = async () => {
    let q = query;
    q = upsertField(q, "rating", minRating ? `>=${minRating}` : null);
    q = upsertField(q, "width", minWidth ? `>=${minWidth}` : null);
    q = upsertField(q, "height", minHeight ? `>=${minHeight}` : null);
    q = upsertField(q, "created", buildCreated(createdFrom, createdTo));
    q = upsertField(q, "prompt", prompt.trim() || null);
    q = upsertField(q, "negative", negative.trim() || null);
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

  const modifiers = { hasImages: highlighted };
  const modifiersClassNames = { hasImages: "rdp-has-images" };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog filter-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>詳細フィルタ</h3>

        <label>
          レーティング下限
          <select value={minRating} onChange={(e) => setMinRating(e.target.value)} aria-label="レーティング下限">
            <option value="">指定なし</option>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>★{n}以上</option>
            ))}
          </select>
        </label>

        <label>
          幅下限(px)
          <input type="number" min="0" step="1" value={minWidth} onChange={(e) => setMinWidth(e.target.value)} />
        </label>
        <label>
          高さ下限(px)
          <input type="number" min="0" step="1" value={minHeight} onChange={(e) => setMinHeight(e.target.value)} />
        </label>

        <label>
          プロンプト
          <input type="text" value={prompt} onChange={(e) => setPrompt(e.target.value)} aria-label="プロンプト" />
        </label>
        <label>
          ネガティブ
          <input type="text" value={negative} onChange={(e) => setNegative(e.target.value)} aria-label="ネガティブ" />
        </label>
        <label>
          モデル名
          <input type="text" value={model} onChange={(e) => setModel(e.target.value)} aria-label="モデル名" />
        </label>
        <label>
          サンプラー
          <input type="text" value={sampler} onChange={(e) => setSampler(e.target.value)} aria-label="サンプラー" />
        </label>
        <label>
          ツール
          <input type="text" value={tool} onChange={(e) => setTool(e.target.value)} aria-label="ツール" />
        </label>

        <div className="date-fields">
          <div className="date-field">
            <div className="date-field-head">
              <span>作成日 開始</span>
              <button
                type="button"
                disabled={!dateInfo.min}
                onClick={() => dateInfo.min && setCreatedFrom(dateInfo.min)}
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
              selected={createdFrom ? localDateToDate(createdFrom) : undefined}
              defaultMonth={localDateToDate(createdFrom || dateInfo.min || dateToLocalString(new Date()))}
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
                onClick={() => dateInfo.max && setCreatedTo(dateInfo.max)}
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
              selected={createdTo ? localDateToDate(createdTo) : undefined}
              defaultMonth={localDateToDate(createdTo || dateInfo.max || dateToLocalString(new Date()))}
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
```

> NOTE: `defaultMonth` は `new Date()` を素のデフォルトに使うが、これは「選択日もデータ日付も無い」場合のみ。`Date.now()` 依存はテストの決定性に影響しないため許容（テストは selected/min/max を与える）。

- [ ] **Step 5: スタイルを追加**

`src/App.css` の `/* 詳細ダイアログ */` セクションに追記する:

```css
.filter-dialog {
  max-height: 90vh;
  overflow-y: auto;
  min-width: 360px;
}
.filter-dialog label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.filter-dialog input[type="text"],
.filter-dialog input[type="number"] {
  flex: 1;
  min-width: 0;
}
.date-fields {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  margin-top: 8px;
}
.date-field-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}
.date-field-head span {
  font-weight: 600;
}
.date-clear {
  font-size: 11px;
}
/* 画像が存在する日のハイライト */
.rdp-has-images:not([disabled]) {
  font-weight: 700;
  text-decoration: underline;
  text-underline-offset: 3px;
  color: #3a6ea5;
}
```

- [ ] **Step 6: テストが通ることを確認**

Run: `npx vitest run src/components/FilterDialog.test.tsx && npx tsc -p tsconfig.json`
Expected: PASS、型エラー無し。

- [ ] **Step 7: フル検証**

Run: `npx vitest run && npx tsc -p tsconfig.json && npm run build`
Expected: フロント全テスト PASS、型エラー無し、ビルド成功。

Run: `cd src-tauri && cargo test -p gen-img-manager`
Expected: Rust 全テスト PASS。

- [ ] **Step 8: コミット**

```bash
git add package.json package-lock.json src/components/FilterDialog.tsx src/components/FilterDialog.test.tsx src/App.css
git commit -m "feat(filter): rich filter dialog with current-value sync, text fields, and calendar"
```

---

## Self-Review（プラン作成者によるチェック）

**スペック網羅:**
- 要件1（件数0表示）: Task 1（image_count）+ Task 5/6（表示・scan-done再取得）。✅
- 要件2（200打ち切り→全件）: Task 7。✅
- 要件3（現在値反映＋文字列コントロール）: Task 4（field:"quoted"）+ Task 8（extract/upsert）+ Task 10（prompt/negative/model/sampler/tool 欄と取り込み）。✅
- 要件4（min/maxボタン）: Task 9（min/max算出）+ Task 10（ボタン）。✅
- 要件5（存在日ハイライト）: Task 3（ローカルTZ）+ Task 9（日付集合）+ Task 10（react-day-picker `hasImages`）。✅

**型整合:** `Directory.image_count`(Rust i64 / TS number)、`extractField`/`upsertField`/`imageDateInfo`/`localDateToDate`/`dateToLocalString` のシグネチャは Task 8/9 定義と Task 10 使用で一致。`queryImages(query, sort, dir, -1, 0)` は既存 API シグネチャ通り。

**既知の留意点（スコープ外・意図的）:**
- 全件ロードに上限キャップは設けない（grill-me 合意）。超大規模ライブラリでは IPC シリアライズ負荷が増える。
- `defaultMonth` のフォールバックに `new Date()` を使用（選択日・データ日付が共に無い場合のみ）。
- react-day-picker のキーボード/ロケールは既定のまま（日本語ロケール設定は将来課題）。

---

## Execution Handoff

実行方式は本計画提示後にユーザーへ確認する（subagent-driven 推奨）。実装前に superpowers:using-git-worktrees で隔離ワークスペース（フィーチャーブランチ）を用意する。

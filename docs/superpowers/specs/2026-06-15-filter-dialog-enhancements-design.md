# フィルタダイアログ強化（プロンプト論理演算・日付ピッカー）設計

- 日付: 2026-06-15
- 対象: フィルタダイアログ（`src/components/FilterDialog.tsx`）、クエリDSL（`src-tauri/src/query/parse.rs`）、フロントのトークン処理（`src/util/queryTokens.ts`）

## 背景・目的

フィルタダイアログに対して3つの改善を行う。

1. **プロンプト/ネガティブプロンプトの論理演算対応**: AND/OR/除外/フレーズ/グループ化を書けるようにする。クエリDSL（生クエリ）も同じ記法に対応するため、画像一覧画面のフィルタバーからも同記法が使える。
2. **日付ピッカーの年月ドロップダウン選択**: 現在は月を1つずつしか移動できず、離れた年月への移動が不便。年・月をドロップダウンで一気に選べるようにする。
3. **「相手の月を開く」ボタン**: 開始/終了カレンダー間で表示月を揃えやすくし、同じ月の指定を容易にする。

## 確定した要件（ブレストの回答）

### プロンプト/ネガティブの論理演算
- **UI**: プロンプト欄・ネガティブ欄はそれぞれ1つのテキスト入力のまま。欄内に記法を直接書く（`forest AND cabin OR sunset -blurry`）。
- **橋渡し方式**: DSLにフィールド論理式（`prompt:(...)`）を追加し、FTS5 の列スコープ式を活用する。ダイアログ欄もフィルタバーも同じ記法で一貫させる。
- **括弧の範囲**: フィールド値内のみ（`prompt:(...)` / `negative:(...)`）。トップレベルやフィールドをまたぐ括弧は非対応。
- **演算子の優先順位**: FTS5 標準（NOT > AND > OR）。括弧で上書き。スペース区切りは AND。フレーズは `"句"` で明示。
- **除外の扱い**: `-語` は肯定式から分離し、`-prompt:語` / `-prompt:(語 OR 語)` として外出しする。compile.rs の既存除外機構（`id NOT IN (... MATCH ...)`）に合流させる。
- **記法説明**: プロンプト欄の下に常時1行で表示（両欄共通なので1回）。

### 日付ピッカー
- **年月選択**: `react-day-picker` の `captionLayout="dropdown"`。年範囲は画像の最小〜最大日付（`imageDateInfo`）から算出。
- **月ジャンプボタン**: 開始カレンダーに「終了月を開く」、終了カレンダーに「開始月を開く」。押すと**相手が選択中の日付の月**へ自分の表示月をジャンプ。相手が未選択ならボタンは `disabled`。日付選択は変えず表示月だけ動かす。

## 記法仕様（ダイアログ欄・生クエリ共通の考え方）

ダイアログのプロンプト欄に書く内容と、生成される生クエリの対応:

```
欄入力:  forest AND cabin OR sunset -blurry
生クエリ: prompt:(forest AND cabin OR sunset) -prompt:blurry
```

| 記法     | 意味                       | 欄入力例            | 生クエリ例                          |
| -------- | -------------------------- | ------------------- | ----------------------------------- |
| スペース | AND（両方含む）            | `forest cabin`      | `prompt:(forest cabin)`             |
| `AND`    | AND（明示・大文字予約語）  | `forest AND cabin`  | `prompt:(forest AND cabin)`         |
| `OR`     | OR（どちらか・大文字予約語）| `forest OR cabin`   | `prompt:(forest OR cabin)`          |
| `-語`    | 除外                       | `-blurry`           | `-prompt:blurry`                    |
| `"句"`   | フレーズ                   | `"best quality"`    | `prompt:"best quality"`             |
| `( )`    | グループ化                 | `(a AND b) OR c`    | `prompt:((a AND b) OR c)`           |

- 単一語・演算子なしのケースは括弧を付けず正規化する（`forest` → `prompt:forest`）。
- `prompt:(...)` の括弧内は**純粋な肯定論理式のみ**。除外は括弧の外（`-prompt:...`）に置く。
- `AND`/`OR` は大文字のみを予約語とする（FTS5 に合わせる）。小文字 `and`/`or` は通常の検索語。

## 設計詳細

### 1. クエリDSL（バックエンド・`src-tauri/src/query/parse.rs` が主役）

- **`tokenize` に括弧バランス追跡を追加**: `field:(` の `(` 開始後、対応する `)` まで（ダブルクォート内の括弧は無視、ネスト対応）を1トークンとして取り込む。これにより `prompt:(forest AND cabin)` が空白で分割されず1トークンになる。
- **テキストフィールド値が `(...)` の場合**（`prompt`/`negative`/`model`/`filename` の `text_field_column` 対象）、中身を「ミニ式パーサ」で解釈し、FTS5 列スコープ式を組み立てる:
  - 例: `prompt:(forest AND cabin OR sunset)` → `positive : ("forest" AND "cabin" OR "sunset")`
- **ミニ式パーサ**（parse.rs 内に新規・純粋関数として切り出し、インラインテスト対象）:
  - 裸の語 → `fts_quote` で必ずダブルクォート（SQLインジェクション/FTS5構文エラー対策。CLAUDE.md の方針に沿う）
  - `AND`/`OR` → FTS5 演算子としてそのまま出力
  - `"句"` → フレーズ（クォート保持）
  - `( )` → ネストグループ（FTS5 の括弧へ）
  - 優先順位は FTS5 に委ねる（パーサは語・演算子・括弧を素直に転写する方針。独自の優先順位計算はしない）
- **除外（`-prompt:...`）**: 既存の field-exclusion 経路をそのまま使う。除外値が `(...)` の場合も同じミニ式パーサで `positive : (...)` を生成し、`excludes` に積む（compile.rs が `id NOT IN` で処理）。
- **`compile.rs` は無変更見込み**: parse.rs が完成済みの FTS5 式文字列を `fts_include`/`fts_exclude` に積み、compile.rs はそれを MATCH パラメータに渡すだけ。列名・値はすべてバインド/許可リスト経由のまま。
- **後方互換**: 括弧構文は新規追加であり、既存挙動を変えない。
  - `prompt:foo`（単一語）→ `positive : "foo"`（不変）
  - `prompt:"a b"`（クォートフレーズ）→ `positive : "a b"`（不変）
  - `prompt:foo bar`（クォートなしスペース・括弧なし）→ 従来どおり `positive : "foo"` ＋ 裸の `bar`（不変）

### 2. フロントのトークン処理（`src/util/queryTokens.ts`）

- **`tokenizeQuery` に同じ括弧バランス追跡を追加**（parse.rs と同仕様の二重実装方針を踏襲）。`prompt:(...)` を1トークンとして扱い、`upsertField` 等の既存フィールド操作が壊れないようにする。
- フロントの責務は**「ダイアログ欄入力 ⇄ クエリ文字列」の変換のみ**。FTS5 式の構築はしない（バックエンドの責務）。
- **欄入力 → クエリ**（新規ヘルパ）:
  - 欄入力をミニトークナイズし、肯定項と除外項（`-`始まり）に分離。
  - 肯定項 → `prompt:(肯定式)`（単一語・演算子なしなら `prompt:語`）。
  - 除外項 → `-prompt:(除外式)`（単一語なら `-prompt:語`）。
  - `upsertField` を拡張、または同等の「フィールドの肯定/除外トークンをまとめて差し替える」関数を用意する。
- **クエリ → 欄入力**（逆変換・新規ヘルパ）:
  - クエリ中の `prompt:(...)` / `prompt:語` と `-prompt:(...)` / `-prompt:語` を収集し、欄入力 `肯定式 -除外語` の形へ復元。
  - `extractField` を括弧値・除外トークン対応に拡張する。

### 3. フィルタダイアログUI（`src/components/FilterDialog.tsx`）

- プロンプト欄・ネガティブ欄の入出力を、上記フロントヘルパ経由に変更（現状の `extractField`/`upsertField` 直結を置き換え）。
- プロンプト欄の直下に記法ヘルプを常時1行表示: `AND=両方  OR=どちらか  -=除外  "句"=フレーズ  ()=グループ`。スタイルは既存の補助テキスト（`.muted` 系）に合わせる。

### 4. 日付ピッカー 年月ドロップダウン（`src/components/FilterDialog.tsx`）

- 2つの `<DayPicker>` を `captionLayout="dropdown"` にする。
- 年範囲は `dateInfo`（`imageDateInfo(results)`）の min/max から算出。データが無い場合は当年を含む妥当な範囲にフォールバックする。
- `react-day-picker` v10 の年月制御プロパティ（`startMonth`/`endMonth` 等）の正確な名称は実装計画段階で確認する。

### 5. 「相手の月を開く」ボタン（`src/components/FilterDialog.tsx`）

- 現状の `defaultMonth`（非制御）を `month` + `onMonthChange`（制御）へ変更。開始用・終了用の表示月をそれぞれ state で持つ。
- 開始カレンダー下に「終了月を開く」、終了カレンダー下に「開始月を開く」ボタンを追加。
- クリック時、相手側で選択中の日付（`createdTo` / `createdFrom`）の月へ自分の表示月 state を設定する。
- 相手が未選択（空文字）のときはボタンを `disabled`。
- ボタンは表示月のみを変更し、選択日（`createdFrom`/`createdTo`）は変更しない。

### 6. テスト

- **`parse.rs`（インラインテスト追加）**:
  - `prompt:(forest AND cabin)` → `positive : ("forest" AND "cabin")`
  - OR・ネスト括弧・フレーズ混在のミニ式変換
  - `-prompt:(blurry OR lowres)` の除外側変換（`excludes` への積み込み）
  - 後方互換: `prompt:foo` / `prompt:"a b"` / `prompt:foo bar` が従来と同一であること
  - 不正括弧（閉じ忘れ等）の頑健な処理
- **`queryTokens.test.ts`（追加）**:
  - 括弧トークンの保持（`upsertField` 等で壊れない）
  - 欄入力 ⇄ クエリの round-trip（肯定式＋除外）
  - 単一語の括弧なし正規化
- **`FilterDialog.test.tsx`（追加）**:
  - プロンプト欄に論理式を入力 → 期待する生クエリが生成される
  - 年月ドロップダウンが描画される
  - 「相手の月を開く」ボタン: 相手選択時に表示月が変わる／相手未選択時は `disabled`
- 純粋ロジック（ミニ式パース・欄入力⇄クエリ変換）は UI/IO から関数として切り出してテストする（プロジェクトのテスト指向に沿う）。
- カレンダーの実描画・ドロップダウン操作感など jsdom で検証しづらい部分は `npm run tauri dev` で手動確認する。

## 影響範囲

- 変更:
  - `src-tauri/src/query/parse.rs` — `tokenize` の括弧追跡、テキストフィールド値のミニ式パース、ミニ式→FTS5式変換。
  - `src/util/queryTokens.ts` — `tokenizeQuery` の括弧追跡、`extractField`/`upsertField` の括弧・除外対応、欄入力⇄クエリ変換ヘルパ。
  - `src/components/FilterDialog.tsx` — プロンプト/ネガティブ欄の入出力差し替え、記法ヘルプ行、年月ドロップダウン、表示月の制御化と月ジャンプボタン。
  - `src/App.css`（必要に応じて） — 記法ヘルプ行・月ジャンプボタンのスタイル。
- 新規/追記テスト:
  - `src-tauri/src/query/parse.rs`（インライン）、`src/util/queryTokens.test.ts`、`src/components/FilterDialog.test.tsx`。
- `compile.rs` は無変更見込み（実装時に最終確認）。

## 非対象（スコープ外）

- フィールドをまたぐトップレベル括弧（`(prompt:x OR model:y)`）。DSL パーサの全面改修は行わない。
- 括弧内への除外混在（`prompt:(A OR -B)`）。除外は常に括弧の外。
- `prompt:`/`negative:` 以外のテキストフィールド（`model:`/`filename:`）への論理式 UI 提供（DSL レベルでは同経路で動くが、専用 UI は今回作らない）。
- スペース区切りをフレーズ扱いに戻す等の旧挙動オプション。

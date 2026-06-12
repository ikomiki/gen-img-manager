# タグ＆レーティング分析機能 設計

- 日付: 2026-06-12
- 対象: プロンプトを分解した「タグ」のDB化と、タグ頻度・レーティング相関の分析機能
- 方針: マイグレーション v5 で `tags` / `image_tags` を追加し、スキャン時＋起動時backfillで紐付け。分析はSQLite **View** で表現し、スコープ（全体／フィルタ範囲）と分析パラメータを専用テーブルで切り替える。

## 目的・要件

AI生成画像のプロンプト（A1111 positive/negative、ComfyUI のテキスト）をカンマ区切りで「タグ」に分解して保存し、以下を可能にする。

1. **頻度一覧** — タグの発生回数（出現画像数）の一覧。アプリ全体と、現在のフィルタ範囲の両方。
2. **特定タグのレーティング分析** — 選んだタグについて「タグがある場合／ない場合」のレーティング別件数と平均。
3. **高評価／低評価の原因タグ割り出し** — レーティングと相関するタグを統計的に頑健な形で抽出。
4. レーティング分析まわりは可能な限り **SQLite View** で実装し、GUI に依らず SQLite 直接でも分析できるようにする。

### 横断ルール
- **Negative から参照されたタグは分析から除外**（**出現単位**）。`kind=negative` の出現を数えないだけで、同じタグが positive/未分類に出ればその分は計上する。分析対象 = `kind ∈ {prompt, unclassified}`。
- **ユーザー編集の除外リスト**（masterpiece 等のクオリティタグ）を全分析に一律適用。ただし「除外リストを無効化」トグルで一時的にOFFにできる。
- レーティング分析は **評価済み（rating 非NULL）画像のみ** を対象とし、件数しきい値も評価済み件数で判定する。レーティングは整数 0–5（NULL=未評価）。

### 今回スコープ外（別プロジェクト）
- 画像グリッドのタグ絞り込み（`tag:` 検索DSL、タグクリックでグリッド絞り込み）。
- タグのエイリアス辞書／正準化辞書。

## 前提（既存実装の確認結果）

- `images` に `positive` / `negative`（生プロンプトテキスト）と `source_tool`（`a1111`/`comfyui`/`unknown`）。
- **A1111**: `positive`/`negative` がきれいに分離される。
- **ComfyUI**: 正負の区別がグラフ構造依存で信頼できないため全テキストが `positive` に結合される（`negative` は常に None）。→ 本機能の「未分類(unclassified)」に対応。
- レーティングは XMP サイドカー／手動由来で `clamp(0,5)`、NULL=未評価。再スキャンでも手動レーティングは保持される。
- スキャンは「並列フェーズで parse → writer フェーズで逐次 `upsert`」。`upsert` は path 一意の UPSERT で id 不変。
- 検索DSLは `query::parse` → `query::compile`（`where_sql` + バインド値）。`image_query` 側で `visible=1` ディレクトリ条件を付与。
- マイグレーションは `MIGRATIONS` 配列（index+1 = `user_version`、追記のみ・並び替え禁止）。現在 v4。

## タグ抽出ルール（`extract_tags`）

`src-tauri/src/parser/tags.rs` の純粋関数 `extract_tags(positive: Option<&str>, negative: Option<&str>, source_tool: &str) -> Vec<(String /*name*/, TagKind)>` として実装し、網羅的にユニットテストする。スキャン時と backfill で**同一関数**を共用する。

正規化（カンマ分割した各要素に対して）:
1. `trim` → 小文字化 → アンダースコア `_` を半角スペースへ統一。
2. `()` / `[]` による強調・減衰記法を剥がして素のタグ名にする（例 `(masterpiece:1.3)`→`masterpiece`、`(detailed)`→`detailed`、`[blurry]`→`blurry`）。
3. **数値重みが負（< 0）** の要素は `kind=negative` に振り替える（例 `(tag:-1)` は positive 欄にあっても negative 扱い）。重み ≥ 0 はその欄の kind を維持。
4. LoRA `<lora:name:w>` は重みを符号化してタグ名にする：`<lora:name:+>`（w ≥ 0）/ `<lora:name:->`（w < 0）。負重み LoRA は `kind=negative`。
5. `BREAK` キーワードは除外。空トークンは除外。
6. 1画像内は `(image, tag, kind)` で一意（重複は1つに畳む）。
7. エイリアス辞書は使わない。

kind の出所:
- `a1111`: `positive` 欄 → `prompt`、`negative` 欄 → `negative`。
- `comfyui`: `positive` 欄 → `unclassified`。
- `unknown`: タグ対象テキストなし（生成しない）。
- 上記いずれの欄でも、負重み要素はルール3/4により `negative` へ振り替わる。

## データモデル（マイグレーション v5・追記のみ）

```sql
-- 正準タグ（正規化済みの一意名）
CREATE TABLE tags (
  id   INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

-- 画像→タグ。kind は出現元。同一画像で prompt と negative の両方に出れば2行。
CREATE TABLE image_tags (
  image_id INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,
  tag_id   INTEGER NOT NULL REFERENCES tags(id)   ON DELETE CASCADE,
  kind     TEXT NOT NULL,                 -- 'prompt' | 'negative' | 'unclassified'
  PRIMARY KEY (image_id, tag_id, kind)
);
CREATE INDEX idx_image_tags_tag   ON image_tags(tag_id, kind);
CREATE INDEX idx_image_tags_image ON image_tags(image_id);

-- 分析パラメータ（1行のみ。View が参照する → SQLite 直叩きでも同条件を再現できる）
CREATE TABLE analysis_params (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  apply_exclusion INTEGER NOT NULL DEFAULT 1,  -- 除外リスト適用 ON/OFF（トグル）
  min_rated_count INTEGER NOT NULL DEFAULT 10, -- 原因分析の最小評価済み件数
  prior_weight    REAL    NOT NULL DEFAULT 10  -- ベイズ平均の事前重み m
);
INSERT INTO analysis_params(id) VALUES (1);

-- 除外タグ（正規化名。デフォルト seed、UI で編集）
CREATE TABLE analysis_excluded_tags ( name TEXT PRIMARY KEY );

-- 分析スコープ。空＝全可視画像、満たせばその集合がフィルタ範囲。
CREATE TABLE analysis_scope ( image_id INTEGER PRIMARY KEY );
```

### 除外リストのデフォルト seed（正規化名で投入）
`masterpiece`, `best quality`, `worst quality`, `low quality`, `normal quality`, `high quality`, `lowres`, `highres`, `absurdres`, `ultra detailed`, `very detailed`, `8k`, `4k`, `score 9`, `score 8 up`, `score 7 up`, `score 6 up`, `score 5 up`, `score 4 up`

> 注: `_`→空白統一の正規化により `score_9` は `score 9` として保存・照合される。除外リストも**正規化名**で保持する。UI で追加/削除できる。

### 補足（決定事項）
- 孤児タグ（紐付け0件）は放置（頻度はJOINで算出するため0件タグは一覧に出ない）。GC不要。
- 画像削除時は FK `ON DELETE CASCADE` で `image_tags` も消える。

## 分析 View（スコープ対応・パラメータはテーブル参照）

`analysis_scope` と `analysis_params`、`analysis_excluded_tags` を入力に、すべての分析を View で表現する。「スコープが空なら全可視画像」という規約で、同じ View が**全体**と**フィルタ範囲**の両方に対応する。

```sql
-- スコープ内の可視・非missing画像（空スコープ＝全可視）
CREATE VIEW analysis_images AS
SELECT i.id, i.rating FROM images i
WHERE i.missing = 0
  AND i.directory_id IN (SELECT id FROM directories WHERE visible = 1)
  AND (NOT EXISTS(SELECT 1 FROM analysis_scope)
       OR i.id IN (SELECT image_id FROM analysis_scope));

-- 分析対象の出現（negative は出現単位で除外、除外リストは params 連動）
CREATE VIEW analysis_tag_occurrence AS
SELECT it.image_id, it.tag_id, t.name, ai.rating
FROM image_tags it
JOIN tags t             ON t.id  = it.tag_id
JOIN analysis_images ai ON ai.id = it.image_id
WHERE it.kind IN ('prompt','unclassified')
  AND ((SELECT apply_exclusion FROM analysis_params) = 0
       OR t.name NOT IN (SELECT name FROM analysis_excluded_tags));

-- 頻度一覧（全体/フィルタ両対応）
CREATE VIEW tag_frequency AS
SELECT tag_id, name, COUNT(DISTINCT image_id) AS image_count
FROM analysis_tag_occurrence GROUP BY tag_id, name;

-- スコープ全体の平均（縮約の基準）
CREATE VIEW analysis_rating_baseline AS
SELECT AVG(rating) AS mean_rating FROM analysis_images WHERE rating IS NOT NULL;

-- 高/低原因（縮約平均でランキング）
CREATE VIEW tag_rating_lift AS
SELECT tag_id, name,
  SUM(CASE WHEN rating IS NOT NULL THEN 1 ELSE 0 END) AS rated_count,
  AVG(rating) AS raw_avg,
  ( SUM(CASE WHEN rating IS NOT NULL THEN 1 ELSE 0 END) * AVG(rating)
    + (SELECT prior_weight FROM analysis_params)
      * (SELECT mean_rating FROM analysis_rating_baseline) )
  / ( SUM(CASE WHEN rating IS NOT NULL THEN 1 ELSE 0 END)
      + (SELECT prior_weight FROM analysis_params) ) AS adjusted_avg,
  (SELECT mean_rating FROM analysis_rating_baseline) AS overall_avg
FROM analysis_tag_occurrence GROUP BY tag_id, name
HAVING rated_count >= (SELECT min_rated_count FROM analysis_params);

-- 特定タグ分析「ある側」のレーティング別件数
CREATE VIEW tag_rating_distribution AS
SELECT tag_id, name, rating, COUNT(DISTINCT image_id) AS cnt
FROM analysis_tag_occurrence GROUP BY tag_id, name, rating;

-- スコープ全体のレーティング別件数
CREATE VIEW scope_rating_distribution AS
SELECT rating, COUNT(*) AS cnt FROM analysis_images GROUP BY rating;
```

### 各分析の算出
- **頻度一覧**: `tag_frequency` をソート/ページング/名前フィルタして表示（カウント = 出現画像数。1画像内重複は畳まれているため出現単位＝画像単位）。
- **特定タグ分析**: 「ある側」= `tag_rating_distribution WHERE tag_id = ?`。「ない側」= `scope_rating_distribution − ある側`（Rust/GUI で rating バケットごとに差分）。分布は未評価(NULL)＋実在する 0–5 値を動的バケット表示、平均は評価済みのみ。「ある側」に negative にしか出ないタグの画像は含まれない（出現単位規約の帰結）。
- **高/低原因**: `tag_rating_lift` を `adjusted_avg` 降順=高評価原因／昇順=低評価原因で表示。`raw_avg`・`rated_count`・`overall_avg`・差分（`adjusted_avg − overall_avg`）を併記。縮約平均により少数サンプルは自動的に全体平均へ引き戻され、しきい値ギリの幸運なタグが上位を独占しない。

> 移植性のため `FILTER (WHERE ...)` ではなく `SUM(CASE WHEN ...)` / `AVG`（NULL自動無視）を用いる。

## スキャン／backfill 統合

### スキャン時の紐付け
- 並列フェーズの `process_one` が `extract_tags` を呼び、結果（`Vec<(name, kind)>`）を `FileOutcome::Upsert`（`NewImage` に同梱 or 併設フィールド）へ載せる。DBには触れない。
- writer フェーズで `images::upsert` が返した `image_id` に対し、`image_tags` を**全削除→再挿入**（タグは get-or-create）。`Skip`（未変更）は触れない。

### 既存ライブラリの backfill（起動時一括）
- settings に `tags_backfilled` フラグが無ければ、起動時（マイグレーション適用後、`lib.rs` setup 内）に全画像の `positive`/`negative`/`source_tool` 列から `extract_tags` で `image_tags` を一括生成する（ファイルI/O不要）。完了後フラグを立てる。
- 件数が多い場合のみ進捗を表示（既存のスキャン進捗 emit と同様の仕組みを流用可）。

### `src-tauri/src/db/tags.rs`
- `get_or_create_tag(conn, name) -> tag_id`
- `replace_image_tags(conn, image_id, &[(name, kind)])`（既存削除→挿入）
- `backfill_all(conn, on_progress)`

## コマンド／API

`src-tauri/src/commands/analysis.rs`（`lib.rs` の `invoke_handler` に登録）→ `src/api/analysis.ts` の薄いラッパ経由でフロントから呼ぶ。

各分析コマンドは引数で **スコープ指定**（全体 | クエリ文字列）と **分析パラメータ**（`apply_exclusion` / `min_rated_count` / `prior_weight`）を受け取り、**ロック内で** `analysis_scope` と `analysis_params` を設定してから View を読み取り、結果を返す（自己完結・原子的）。スコープのクエリは既存 `query::compile` を再利用し、`visible=1` ディレクトリ条件も付与して `analysis_scope` を満たす。

- `tag_frequency(scope, params, sort, limit, offset, name_filter)`
- `tag_rating_analysis(scope, params, tag_id)` — ある/ない分布＋平均
- `rating_lift(scope, params, direction /* high|low */, limit)`
- 除外リスト: `list_excluded_tags()` / `add_excluded_tag(name)` / `remove_excluded_tag(name)`（追加時は正規化して保存）

## フロントエンド

- **新ストア** `src/store/useAnalysisStore.ts`（zustand）: スコープモード（全体／フィルタ範囲）、分析パラメータ、除外無効化トグル、現在タブ、各結果。既存3ストアと同じ分離方針を踏襲した4つ目のストア。
- **メニュー統合**: ネイティブメニューに「分析」を追加 → Rust が `menu-action` を emit → `App.tsx` がメイン内容領域を `AnalysisView` に切替（既存の `view_menu` チェック同期方式を踏襲）。
- **コンポーネント**（`src/components/`）:
  - `AnalysisView` — タブ容器。上部にスコープ「全体 / フィルタ範囲」トグルと「除外リストを無効化」トグル。
  - `TagFrequencyTable` — ソート（件数/名前）・名前フィルタ・ページング。行クリックで特定タグ分析へドリルダウン。
  - `TagRatingAnalysis` — 選択タグの「ある／ない」レーティング別件数＋平均。
  - `RatingCauseTable` — 高/低原因タグ（`adjusted_avg` ソート、`raw_avg`/`rated_count`/差分併記）。
  - `ExcludedTagsEditor` — 除外リストの追加/削除。
- スコープは現在のクエリ（`useQueryStore`）を流用し、トグルで全体／フィルタ範囲を切り替える。

## 実装フェーズ（plan 化の単位）

1. マイグレーション v5（`tags`/`image_tags`/`analysis_params`/`analysis_excluded_tags`/`analysis_scope` ＋ 全 View ＋ seed）＋インラインテスト。
2. `parser/tags.rs::extract_tags` 純粋関数＋網羅ユニットテスト（正規化・負重み・LoRA符号化・kind 振り分け）。
3. `db/tags.rs`（get-or-create / replace_image_tags / backfill_all）＋テスト。
4. スキャン統合（`process_one` がタグ算出、writer が紐付け）＋テスト。
5. 起動時 backfill（`tags_backfilled` フラグ）。
6. 分析コマンド（スコープ/パラメータ設定＋View読取）＋テスト。
7. フロント `api/analysis.ts` ＋ `useAnalysisStore`。
8. フロント UI（頻度一覧→ドリルダウン→原因分析、除外エディタ）。
9. メニュー統合（`menu.rs` / `view_menu` 同期）。

## テスト指向

- `extract_tags` は UI/IO から独立した純粋関数として網羅テスト（正規化の各ルール、負重み振替、LoRA符号化、ComfyUI→unclassified、エッジケース）。
- View のロジックはマイグレーション後のインメモリDBに既知データを投入して検証（頻度カウント、negative除外の出現単位、除外リスト連動、縮約平均の数値、スコープ空＝全体／満たしたときの絞り込み）。
- 分析コマンドはスコープ/パラメータ設定の原子性と、クエリ→`analysis_scope` 充填の整合を検証。

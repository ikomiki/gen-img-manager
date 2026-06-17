# SQLite: ベイズ平滑化によるタグレーティング分析

## 問題

タグの出現頻度が少ないとき（例: 3件）の平均レーティングは統計的に不安定で、偶然が大きく影響する。単純な `AVG(rating)` では希少タグが誤って高/低評価タグとして表示される。

## 解決策: ベイズ平滑化（Prior-weighted average）

```sql
-- tag_rating_lift ビュー（src-tauri/src/db/migrations.rs v5）
CREATE VIEW tag_rating_lift AS
SELECT * FROM (
    SELECT tag_id, name,
        COUNT(DISTINCT CASE WHEN rating IS NOT NULL THEN image_id END) AS rated_count,
        AVG(rating) AS raw_avg,
        -- ベイズ平滑化: 少数サンプルは全体平均へ引き寄せる
        ( rated_count * AVG(rating)
          + prior_weight * overall_avg )
        / ( rated_count + prior_weight ) AS adjusted_avg,
        overall_avg
    FROM analysis_tag_occurrence GROUP BY tag_id, name
)
WHERE rated_count >= min_rated_count;  -- 最低件数フィルタ
```

`prior_weight`（デフォルト 10）のサンプル数分だけ全体平均に引き寄せる。

- `rated_count = 3`, `prior_weight = 10`: 実サンプルの重みは 3/(3+10) ≈ 23%
- `rated_count = 50`, `prior_weight = 10`: 実サンプルの重みは 50/(50+10) ≈ 83%

## パラメータ管理

```sql
CREATE TABLE analysis_params (
    id              INTEGER PRIMARY KEY CHECK (id = 1),  -- 常に1行
    apply_exclusion INTEGER NOT NULL DEFAULT 1,
    min_rated_count INTEGER NOT NULL DEFAULT 10,
    prior_weight    REAL    NOT NULL DEFAULT 10
);
INSERT INTO analysis_params(id) VALUES (1);
```

ビュー内でサブクエリ `(SELECT prior_weight FROM analysis_params)` で参照するため、パラメータ変更が即座にビュー結果に反映される。

## 除外タグ

品質系ワード（`masterpiece`, `best quality` 等）はタグ頻度・レーティングの分析から除外する。

```sql
CREATE TABLE analysis_excluded_tags ( name TEXT PRIMARY KEY );
```

## ポイント

- ベイズ平滑化は「証拠が少ないほど事前分布（全体平均）に従う」という直感的な動作をする
- `prior_weight` を大きくするほど保守的（全体平均に近づく）になる
- サブクエリでパラメータを参照するビューは、パラメータ更新が自動的に反映されるため UI からリアルタイム調整できる

## 参照

`src-tauri/src/db/migrations.rs`（v5 の `tag_rating_lift` ビュー）, `src-tauri/src/db/analysis.rs`

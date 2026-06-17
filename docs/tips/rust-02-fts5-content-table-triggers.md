# Rust/SQLite: FTS5 コンテンツテーブルとトリガーによる自動同期

## 概要

`content='images'` オプションで FTS5 仮想テーブルを本体テーブルに紐づけ、INSERT/UPDATE/DELETE トリガーで自動同期する。全文検索インデックスを本体テーブルと二重管理する手間をなくす。

## DDL

```sql
CREATE VIRTUAL TABLE images_fts USING fts5(
    raw_parameters, positive, negative, model, filename,
    content='images',       -- コンテンツテーブル
    content_rowid='id'      -- rowid の対応列
);

-- INSERT 後に FTS へ追加
CREATE TRIGGER images_ai AFTER INSERT ON images BEGIN
    INSERT INTO images_fts(rowid, raw_parameters, positive, negative, model, filename)
    VALUES (new.id, new.raw_parameters, new.positive, new.negative, new.model, new.filename);
END;

-- DELETE 後に FTS から削除
CREATE TRIGGER images_ad AFTER DELETE ON images BEGIN
    INSERT INTO images_fts(images_fts, rowid, raw_parameters, positive, negative, model, filename)
    VALUES ('delete', old.id, old.raw_parameters, old.positive, old.negative, old.model, old.filename);
END;

-- UPDATE 後は削除→追加（差分更新は不可）
CREATE TRIGGER images_au AFTER UPDATE ON images BEGIN
    INSERT INTO images_fts(images_fts, rowid, ...)
    VALUES ('delete', old.id, old.raw_parameters, ...);
    INSERT INTO images_fts(rowid, ...)
    VALUES (new.id, new.raw_parameters, ...);
END;
```

## 検索クエリ

```sql
-- content_rowid='id' なので rowid = images.id
SELECT * FROM images
WHERE id IN (SELECT rowid FROM images_fts WHERE images_fts MATCH ?)
```

## 除外

```sql
WHERE id NOT IN (SELECT rowid FROM images_fts WHERE images_fts MATCH ?)
```

## FTS5 の MATCH 構文

- スペース区切りは暗黙 AND
- 演算子は大文字: `AND`, `OR`
- 列スコープ: `positive : "forest"` （列名 + スペース + `:` + スペース + 値）
- フレーズ: `"best quality"` （ダブルクォート）
- ダブルクォート内のダブルクォートは `""` でエスケープ

## ポイント

- UPDATE 時は delete → insert の 2 ステップが必須（FTS5 は差分更新不可）
- `content='...'` テーブルは FTS インデックスのみ保持し、実データは本体テーブルから読む（ストレージ削減）
- ビュー（`analysis_tag_occurrence` 等）を FTS 対象にはできない。本体テーブルのみ

## 参照

`src-tauri/src/db/migrations.rs`（FTS5 DDL とトリガー）, `src-tauri/src/query/compile.rs`（MATCH クエリ生成）

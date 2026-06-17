# Rust: サムネイルのファイル名に FNV-1a ハッシュを使う

## 問題

サムネイルのファイル名を元のパスから導出するとき、パスを直接使うとディレクトリ区切りや特殊文字で問題が起きる。連番 ID だと元パスとの対応が DB 依存になる。

## 解決策: パスの FNV-1a 64bit ハッシュ

```rust
// src-tauri/src/thumbnail.rs

fn thumb_filename(src: &Path) -> String {
    let s = src.to_string_lossy();
    let mut hash: u64 = 0xcbf29ce484222325;  // FNV offset basis
    for b in s.as_bytes() {
        hash ^= *b as u64;
        hash = hash.wrapping_mul(0x100000001b3);  // FNV prime
    }
    format!("{hash:016x}.webp")
}
```

## ポイント

- FNV-1a は実装が数行で済み、外部クレートが不要
- 同じパスからは常に同じファイル名が得られるため、再スキャン時に既存サムネイルを再利用できる（`thumb_path` が既に存在すれば生成をスキップ）
- 衝突率は実用範囲では無視できる（64bit = 1.8×10¹⁹ 通り）
- `{hash:016x}` で 16 桁のゼロ埋め 16 進数にする（ファイル名長を一定にする）

## WebP エンコーディング

```rust
// 16bit/グレースケール等も含め必ず 8bit RGBA に正規化する
// （webp クレートの Encoder は RGB8/RGBA8 以外でパニックする）
let rgba = thumb.into_rgba8();
let encoder = webp::Encoder::from_rgba(rgba.as_raw(), THUMB_SIZE, THUMB_SIZE);
let data = encoder.encode(THUMB_QUALITY);
```

## 中央クロップ

```rust
const THUMB_SIZE: u32 = 512;

let (w, h) = img.dimensions();
let side = w.min(h);
let x = (w - side) / 2;
let y = (h - side) / 2;
let square = img.crop_imm(x, y, side, side);
let thumb = square.resize_exact(THUMB_SIZE, THUMB_SIZE, FilterType::Lanczos3);
```

## 参照

`src-tauri/src/thumbnail.rs`

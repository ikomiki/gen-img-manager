use std::path::PathBuf;

/// `rust_embed` の derive は対象フォルダが無いとコンパイル時に失敗する。
/// `web/dist` は .gitignore 対象でクローン直後には存在しないため、
/// 案内文だけの index.html を置いてビルドを通す。ここで失敗させると
/// `cargo test --workspace` が JS のビルド無しに一切動かなくなる。
fn main() {
    let dist = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../web/dist");
    let index = dist.join("index.html");

    println!("cargo::rerun-if-changed=../../web/dist");

    if index.exists() {
        return;
    }

    println!(
        "cargo::warning=web/dist が見つかりません。`pnpm -C web build` を実行すると web ビューアが同梱されます。"
    );
    if let Err(e) = std::fs::create_dir_all(&dist) {
        panic!("{} を作れません: {e}", dist.display());
    }
    let placeholder = "<!doctype html><html lang=\"ja\"><head><meta charset=\"utf-8\">\
<title>gen-img-manager</title></head><body>\
<p>web フロントがビルドされていません。<code>pnpm -C web build</code> を実行してから \
<code>cargo build --release -p gim-server</code> をやり直してください。</p>\
</body></html>\n";
    if let Err(e) = std::fs::write(&index, placeholder) {
        panic!("{} を書けません: {e}", index.display());
    }
}

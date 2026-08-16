use clap::Parser;
use std::path::PathBuf;

#[derive(Parser, Debug)]
#[command(name = "gim-server", about = "gen-img-manager の LAN 向け web サーバ")]
pub struct Args {
    /// 待受アドレス
    #[arg(long, default_value = "0.0.0.0")]
    pub host: String,

    /// 待受ポート
    #[arg(long, default_value_t = 5180)]
    pub port: u16,

    /// library.db と thumbnails/ を含むディレクトリ
    #[arg(long)]
    pub data_dir: Option<PathBuf>,
}

/// macOS のアプリデータディレクトリ。Tauri の identifier と一致させる必要がある。
const BUNDLE_ID: &str = "com.technonet.genimgmanager";

impl Args {
    pub fn resolved_data_dir(&self) -> Option<PathBuf> {
        if let Some(d) = &self.data_dir {
            return Some(d.clone());
        }
        let home = std::env::var_os("HOME")?;
        Some(
            PathBuf::from(home)
                .join("Library")
                .join("Application Support")
                .join(BUNDLE_ID),
        )
    }
}

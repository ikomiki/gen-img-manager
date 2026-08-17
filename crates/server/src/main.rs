mod cli;
mod dirscope;
mod dto;
mod error;
mod extract;
mod fileserve;
mod hostcheck;
mod logging;
mod resize;
mod routes;
mod state;
mod webui;
#[cfg(test)]
mod test_support;

use clap::Parser;
use state::AppState;
use std::net::{IpAddr, UdpSocket};

/// 表示用の LAN アドレス。UDP の connect はパケットを送らないので、
/// 経路表からこのホストの送信元アドレスを引くだけの用途に使える。
fn lan_ip() -> Option<IpAddr> {
    let sock = UdpSocket::bind("0.0.0.0:0").ok()?;
    sock.connect("8.8.8.8:80").ok()?;
    sock.local_addr().ok().map(|a| a.ip())
}

#[tokio::main]
async fn main() {
    let args = cli::Args::parse();

    let Some(data_dir) = args.resolved_data_dir() else {
        eprintln!("データディレクトリを決められません。--data-dir を指定してください。");
        std::process::exit(1);
    };
    let state = AppState::new(data_dir.clone()).with_allowed_hosts(args.allow_host.clone());

    if let Err(e) = gim_core::db::open_read_only(&state.db_path) {
        eprintln!("{} を開けません: {e}", state.db_path.display());
        eprintln!("デスクトップ版を一度起動してから、もう一度実行してください。");
        std::process::exit(1);
    }
    if let Err(e) = std::fs::create_dir_all(&state.cache_dir) {
        eprintln!("{} を作れません: {e}", state.cache_dir.display());
        std::process::exit(1);
    }
    resize::sweep_on_startup(&state.cache_dir);

    let addr = format!("{}:{}", args.host, args.port);
    let listener = match tokio::net::TcpListener::bind(&addr).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("{addr} で待受できません: {e}");
            std::process::exit(1);
        }
    };

    match lan_ip() {
        Some(ip) => println!("http://{ip}:{} で待受中", args.port),
        None => println!("ポート {} で待受中", args.port),
    }
    println!("データディレクトリ: {}", data_dir.display());

    if let Err(e) = axum::serve(listener, routes::router(state)).await {
        eprintln!("サーバが停止しました: {e}");
        std::process::exit(1);
    }
}

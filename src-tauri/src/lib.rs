mod backfill;
mod commands;
mod db;
mod fs_guard;
mod menu;
mod models;
mod parser;
mod query;
mod scanner;
mod thumbnail;

use tauri::Emitter;
use tauri::Manager;

/// ウィンドウサイズ保存のスロットル用に直近保存時刻を持つ。
/// リサイズ中の高頻度な SQLite 書き込み（WAL+synchronous=FULL の fsync）を抑える。
#[cfg(desktop)]
struct WinSaveThrottle(std::sync::Mutex<Option<std::time::Instant>>);

const WIN_W_KEY: &str = "win_width";
const WIN_H_KEY: &str = "win_height";
const WIN_X_KEY: &str = "win_x";
const WIN_Y_KEY: &str = "win_y";

/// メインウィンドウの位置・サイズを論理ポイントで保存する。
/// window-state プラグインは物理ピクセルで保存・復元するが、macOS の HiDPI／混在DPIの
/// マルチモニタで物理⇔論理変換がズレ、サイズが約2倍に拡大したり位置が左右にずれる。
/// 論理ポイントは macOS ネイティブの座標系（NSWindow の points）で、モニタ間で一貫するため、
/// 位置・サイズは自前で論理ポイント管理する。
/// throttle=true（リサイズ/移動の連続発火）時は一定間隔に間引き、false（クローズ時）は即時保存する。
#[cfg(desktop)]
fn persist_window_geometry<R: tauri::Runtime>(window: &tauri::Window<R>, throttle: bool) {
    if window.label() != "main" {
        return;
    }
    // 最大化/フルスクリーン中は通常時の位置・サイズを汚さない。
    if window.is_maximized().unwrap_or(false) || window.is_fullscreen().unwrap_or(false) {
        return;
    }
    if throttle {
        if let Some(t) = window.try_state::<WinSaveThrottle>() {
            let mut last = t.0.lock().unwrap();
            let now = std::time::Instant::now();
            if let Some(prev) = *last {
                if now.duration_since(prev) < std::time::Duration::from_millis(250) {
                    return;
                }
            }
            *last = Some(now);
        }
    }
    let scale = window.scale_factor().unwrap_or(1.0);
    let size = match window.inner_size() {
        Ok(s) => s.to_logical::<u32>(scale),
        Err(_) => return,
    };
    if size.width == 0 || size.height == 0 {
        return;
    }
    let pos = match window.outer_position() {
        Ok(p) => p.to_logical::<i32>(scale),
        Err(_) => return,
    };
    if let Some(db) = window.try_state::<db::Db>() {
        if let Ok(conn) = db.0.lock() {
            let _ = db::settings::set(&conn, WIN_W_KEY, &size.width.to_string());
            let _ = db::settings::set(&conn, WIN_H_KEY, &size.height.to_string());
            let _ = db::settings::set(&conn, WIN_X_KEY, &pos.x.to_string());
            let _ = db::settings::set(&conn, WIN_Y_KEY, &pos.y.to_string());
        }
    }
}

/// 論理ポイント空間で、ウィンドウ矩形がいずれかのモニタと重なるか判定する。
/// 各モニタの物理境界をそのモニタ自身のスケールで論理化すれば、混在DPIでも一貫した
/// ポイント空間（macOS のグローバル座標）として扱える。
#[cfg(desktop)]
fn window_rect_visible(win: &tauri::WebviewWindow, x: i32, y: i32, w: u32, h: u32) -> bool {
    let monitors = match win.available_monitors() {
        Ok(m) if !m.is_empty() => m,
        _ => return true, // 判定不能なら復元を許可する
    };
    let (wx, wy, ww, wh) = (x as f64, y as f64, w as f64, h as f64);
    for m in monitors {
        let s = m.scale_factor();
        let mp = m.position().to_logical::<f64>(s);
        let ms = m.size().to_logical::<f64>(s);
        let overlap =
            wx < mp.x + ms.width && wx + ww > mp.x && wy < mp.y + ms.height && wy + wh > mp.y;
        if overlap {
            return true;
        }
    }
    false
}

/// 保存済みの論理位置・サイズをメインウィンドウへ復元する（最大化/フルスクリーン時は適用しない）。
/// サイズは現在モニタの論理解像度を上限にクランプし、位置はいずれかのモニタ上に収まる場合のみ復元する
/// （切断されたモニタ上の座標で画面外に開くのを防ぐ）。`set_*` は HiDPI 回避のため必ず Logical で行う。
#[cfg(desktop)]
fn restore_window_geometry(win: &tauri::WebviewWindow, conn: &rusqlite::Connection) {
    if win.is_maximized().unwrap_or(false) || win.is_fullscreen().unwrap_or(false) {
        return;
    }
    let read_u = |k: &str| db::settings::get(conn, k).ok().flatten().and_then(|s| s.parse::<u32>().ok());
    let read_i = |k: &str| db::settings::get(conn, k).ok().flatten().and_then(|s| s.parse::<i32>().ok());
    let (Some(mut w), Some(mut h)) = (read_u(WIN_W_KEY), read_u(WIN_H_KEY)) else {
        return;
    };
    if w == 0 || h == 0 {
        return;
    }
    // サイズ: 現在モニタの論理解像度を上限にクランプ。
    let monitor = match win.current_monitor() {
        Ok(Some(m)) => Some(m),
        _ => win.primary_monitor().ok().flatten(),
    };
    if let Some(monitor) = monitor {
        let scale = win.scale_factor().unwrap_or(1.0);
        let mon = monitor.size().to_logical::<u32>(scale);
        if mon.width > 0 {
            w = w.min(mon.width);
        }
        if mon.height > 0 {
            h = h.min(mon.height);
        }
    }
    // 先にサイズ、次に位置を適用して最終位置を確定させる。
    let _ = win.set_size(tauri::LogicalSize::new(w, h));
    if let (Some(x), Some(y)) = (read_i(WIN_X_KEY), read_i(WIN_Y_KEY)) {
        if window_rect_visible(win, x, y, w, h) {
            let _ = win.set_position(tauri::LogicalPosition::new(x, y));
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default().plugin(tauri_plugin_dialog::init());
    // ウィンドウ状態（最大化・フルスクリーン）の保存/復元はプラグインに任せる。
    // ビルダーチェーンで登録する: 設定ファイル定義の main ウィンドウは setup クロージャより
    // 前に生成され、その生成時に同期発火する on_window_ready を取りこぼさないため。
    // setup 内で app.handle().plugin(...) すると復元が機能しない。
    // POSITION/SIZE はあえて除外する: プラグインは物理ピクセルで保存・復元するが、macOS の
    // HiDPI／混在DPIマルチモニタで物理⇔論理変換がズレ、サイズが約2倍になったり位置が左右にずれる。
    // 位置・サイズは下の自前処理（persist_window_geometry / restore_window_geometry）が
    // 論理ポイント（NSWindow ネイティブ座標）で保存・復元する。
    #[cfg(desktop)]
    {
        builder = builder.plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::MAXIMIZED
                        | tauri_plugin_window_state::StateFlags::FULLSCREEN,
                )
                .with_denylist(&["slideshow"])
                .build(),
        );
    }
    builder
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let conn = db::open(&dir.join("library.db"))?;
            // 既存画像のタグ後付け（一度だけ）。DBを manage する前に所有権を持ったまま実行する。
            backfill::run_if_needed(&conn).map_err(|e| format!("backfill failed: {e}"))?;
            app.manage(db::Db(std::sync::Arc::new(std::sync::Mutex::new(conn))));
            // サムネイルディレクトリを作成し、asset protocol で読めるよう許可する。
            let thumb_dir = dir.join("thumbnails");
            std::fs::create_dir_all(&thumb_dir)?;
            app.asset_protocol_scope().allow_directory(&thumb_dir, true)?;
            // 既存の記憶対象ディレクトリ配下の原画像も asset protocol で表示できるよう許可する。
            {
                let db_state = app.state::<db::Db>();
                let conn = db_state.0.lock().unwrap();
                if let Ok(dirs) = db::directories::list(&conn) {
                    for d in dirs {
                        let _ = app
                            .asset_protocol_scope()
                            .allow_directory(std::path::Path::new(&d.path), d.recursive);
                    }
                }
            }
            let (app_menu, view_menu) = menu::build(app.handle())?;
            app.set_menu(app_menu)?;
            app.manage(crate::commands::slideshow::SlideshowState::default());
            app.manage(view_menu);
            // メインウィンドウの位置・サイズを論理ポイントで復元する（モニタ内へクランプ済み）。
            #[cfg(desktop)]
            {
                app.manage(WinSaveThrottle(std::sync::Mutex::new(None)));
                if let Some(win) = app.get_webview_window("main") {
                    let db_state = app.state::<db::Db>();
                    let conn = db_state.0.lock().unwrap();
                    restore_window_geometry(&win, &conn);
                }
            }
            Ok(())
        })
        .on_menu_event(|app, event| {
            let _ = app.emit("menu-action", event.id().0.clone());
        })
        .on_window_event(|window, event| {
            // 位置・サイズはプラグインに任せず自前で論理ポイント保存する（HiDPI/混在DPIのズレ回避）。
            #[cfg(desktop)]
            match event {
                tauri::WindowEvent::Resized(_) | tauri::WindowEvent::Moved(_) => {
                    persist_window_geometry(window, true)
                }
                tauri::WindowEvent::CloseRequested { .. } => persist_window_geometry(window, false),
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::directories::add_directory,
            commands::directories::list_directories,
            commands::directories::remove_directory,
            commands::directories::set_directory_visible,
            commands::scan::scan_directory,
            commands::scan::scan_all,
            commands::scan::rebuild_directory,
            commands::scan::rebuild_all,
            commands::query::query_images,
            commands::query::count_query,
            commands::query::get_image_detail,
            commands::query::set_rating,
            commands::prefs::add_filter_history,
            commands::prefs::list_filter_history,
            commands::prefs::get_setting,
            commands::prefs::set_setting,
            commands::view_menu::sync_zoom_menu,
            commands::view_menu::sync_filename_menu,
            commands::view_menu::sync_slideshow_menu,
            commands::view_menu::sync_rating_mode_menu,
            commands::view_menu::sync_unrated_only_menu,
            commands::view_menu::sync_xmp_auto_menu,
            commands::view_menu::sync_current_filename_menu,
            commands::view_menu::sync_current_position_menu,
            commands::view_menu::sync_current_rating_menu,
            commands::slideshow::start_slideshow,
            commands::slideshow::get_slideshow_payload,
            commands::fs::reveal_in_finder,
            commands::fs::delete_image,
            commands::fs::write_xmp_rating,
            commands::analysis::analysis_tag_frequency,
            commands::analysis::analysis_rating_lift,
            commands::analysis::analysis_tag_rating,
            commands::analysis::analysis_list_excluded,
            commands::analysis::analysis_add_excluded,
            commands::analysis::analysis_remove_excluded,
            commands::analysis::analysis_set_excluded,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let conn = db::open(&dir.join("library.db"))?;
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
            Ok(())
        })
        .on_menu_event(|app, event| {
            let _ = app.emit("menu-action", event.id().0.clone());
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
            commands::slideshow::start_slideshow,
            commands::slideshow::get_slideshow_payload,
            commands::fs::reveal_in_finder,
            commands::fs::delete_image,
            commands::fs::write_xmp_rating,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

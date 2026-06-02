mod commands;
mod db;
mod fs_guard;
mod models;
mod parser;
mod query;
mod scanner;
mod thumbnail;

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
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::directories::add_directory,
            commands::directories::list_directories,
            commands::directories::remove_directory,
            commands::scan::scan_directory,
            commands::scan::scan_all,
            commands::scan::rebuild_directory,
            commands::scan::rebuild_all,
            commands::scan::count_images,
            commands::query::query_images,
            commands::query::count_query,
            commands::query::get_image_detail,
            commands::prefs::add_filter_history,
            commands::prefs::list_filter_history,
            commands::prefs::get_setting,
            commands::prefs::set_setting,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

use crate::menu::ViewMenu;
use tauri::State;

/// フロントのズームモード変更をネイティブメニューのチェックへ反映する。
#[tauri::command]
pub fn sync_zoom_menu(menu: State<ViewMenu>, mode: String) {
    menu.sync_zoom(&mode);
}

/// フロントのファイル名表示トグルをネイティブメニューのチェックへ反映する。
#[tauri::command]
pub fn sync_filename_menu(menu: State<ViewMenu>, on: bool) {
    menu.sync_filename(on);
}

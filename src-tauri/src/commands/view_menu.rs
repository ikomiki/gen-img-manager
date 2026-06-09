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

/// スライドショーの表示モード変更をネイティブメニューのチェックへ反映する。
#[tauri::command]
pub fn sync_slideshow_menu(menu: State<ViewMenu>, fullscreen: bool) {
    menu.sync_slideshow(fullscreen);
}

#[tauri::command]
pub fn sync_rating_mode_menu(menu: State<ViewMenu>, on: bool) {
    menu.sync_rating_mode(on);
}
#[tauri::command]
pub fn sync_unrated_only_menu(menu: State<ViewMenu>, on: bool) {
    menu.sync_unrated_only(on);
}
#[tauri::command]
pub fn sync_xmp_auto_menu(menu: State<ViewMenu>, on: bool) {
    menu.sync_xmp_auto(on);
}
#[tauri::command]
pub fn sync_current_filename_menu(menu: State<ViewMenu>, on: bool) {
    menu.sync_current_filename(on);
}
#[tauri::command]
pub fn sync_current_position_menu(menu: State<ViewMenu>, on: bool) {
    menu.sync_current_position(on);
}

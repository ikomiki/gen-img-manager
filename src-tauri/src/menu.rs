use tauri::menu::{CheckMenuItem, Menu, SubmenuBuilder};
use tauri::{AppHandle, Wry};

/// 「表示」メニューのチェック項目ハンドルを保持し、フロントの状態と同期する。
pub struct ViewMenu {
    pub zoom_fit: CheckMenuItem<Wry>,
    pub zoom_actual: CheckMenuItem<Wry>,
    pub zoom_fill: CheckMenuItem<Wry>,
    pub zoom_custom: CheckMenuItem<Wry>,
    pub show_filename: CheckMenuItem<Wry>,
    pub slideshow_windowed: CheckMenuItem<Wry>,
    pub slideshow_fullscreen: CheckMenuItem<Wry>,
}

/// アプリメニューを構築し、ViewMenu（チェック項目ハンドル）を返す。
pub fn build(app: &AppHandle) -> tauri::Result<(Menu<Wry>, ViewMenu)> {
    let zoom_fit = CheckMenuItem::with_id(app, "zoom_fit", "全体フィット", true, true, None::<&str>)?;
    let zoom_actual = CheckMenuItem::with_id(app, "zoom_actual", "等倍", true, false, None::<&str>)?;
    let zoom_fill = CheckMenuItem::with_id(app, "zoom_fill", "Fill", true, false, None::<&str>)?;
    let zoom_custom = CheckMenuItem::with_id(app, "zoom_custom", "任意倍率", true, false, None::<&str>)?;
    let show_filename =
        CheckMenuItem::with_id(app, "toggle_filename", "ファイル名を表示", true, true, None::<&str>)?;
    let slideshow_windowed =
        CheckMenuItem::with_id(app, "slideshow_windowed", "ウィンドウ全体", true, true, None::<&str>)?;
    let slideshow_fullscreen =
        CheckMenuItem::with_id(app, "slideshow_fullscreen", "フルスクリーン", true, false, None::<&str>)?;

    let zoom_submenu = SubmenuBuilder::new(app, "ズーム")
        .item(&zoom_fit)
        .item(&zoom_actual)
        .item(&zoom_fill)
        .item(&zoom_custom)
        .build()?;

    let slideshow_submenu = SubmenuBuilder::new(app, "スライドショー")
        .item(&slideshow_windowed)
        .item(&slideshow_fullscreen)
        .build()?;

    let view_submenu = SubmenuBuilder::new(app, "表示")
        .item(&zoom_submenu)
        .item(&slideshow_submenu)
        .separator()
        .item(&show_filename)
        .build()?;

    // macOS既定メニュー（アプリ名/Quit・編集/コピー&ペースト・Window等）を保持し、
    // 「表示」メニューを追加する。
    let menu = Menu::default(app)?;
    menu.append(&view_submenu)?;

    Ok((
        menu,
        ViewMenu {
            zoom_fit,
            zoom_actual,
            zoom_fill,
            zoom_custom,
            show_filename,
            slideshow_windowed,
            slideshow_fullscreen,
        },
    ))
}

impl ViewMenu {
    /// フロントのズームモードに合わせてチェックを排他更新する。
    pub fn sync_zoom(&self, mode: &str) {
        let items = [
            (&self.zoom_fit, "fit"),
            (&self.zoom_actual, "actual"),
            (&self.zoom_fill, "fill"),
            (&self.zoom_custom, "custom"),
        ];
        for (item, name) in items {
            if let Err(e) = item.set_checked(mode == name) {
                eprintln!("[menu] zoom set_checked({name}) failed: {e}");
            }
        }
    }

    pub fn sync_filename(&self, on: bool) {
        if let Err(e) = self.show_filename.set_checked(on) {
            eprintln!("[menu] filename set_checked failed: {e}");
        }
    }

    /// スライドショーの表示モード（ウィンドウ全体 / フルスクリーン）を排他更新する。
    pub fn sync_slideshow(&self, fullscreen: bool) {
        if let Err(e) = self.slideshow_windowed.set_checked(!fullscreen) {
            eprintln!("[menu] slideshow_windowed set_checked failed: {e}");
        }
        if let Err(e) = self.slideshow_fullscreen.set_checked(fullscreen) {
            eprintln!("[menu] slideshow_fullscreen set_checked failed: {e}");
        }
    }
}

use tauri::menu::{
    CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, SubmenuBuilder, HELP_SUBMENU_ID,
    WINDOW_SUBMENU_ID,
};
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
    pub rating_mode: CheckMenuItem<Wry>,
    pub unrated_only: CheckMenuItem<Wry>,
    pub xmp_auto: CheckMenuItem<Wry>,
    pub show_current_filename: CheckMenuItem<Wry>,
    pub show_current_position: CheckMenuItem<Wry>,
    pub show_current_rating: CheckMenuItem<Wry>,
}

/// アプリメニューを構築し、ViewMenu（チェック項目ハンドル）を返す。
pub fn build(app: &AppHandle) -> tauri::Result<(Menu<Wry>, ViewMenu)> {
    let zoom_fit = CheckMenuItem::with_id(app, "zoom_fit", "全体フィット", true, true, None::<&str>)?;
    let zoom_actual = CheckMenuItem::with_id(app, "zoom_actual", "等倍", true, false, None::<&str>)?;
    let zoom_fill = CheckMenuItem::with_id(app, "zoom_fill", "Fill", true, false, None::<&str>)?;
    let zoom_custom = CheckMenuItem::with_id(app, "zoom_custom", "任意倍率", true, false, None::<&str>)?;
    let show_filename =
        CheckMenuItem::with_id(app, "toggle_filename", "一覧のファイル名を表示", true, true, None::<&str>)?;
    let slideshow_windowed =
        CheckMenuItem::with_id(app, "slideshow_windowed", "ウィンドウ全体", true, true, None::<&str>)?;
    let slideshow_fullscreen =
        CheckMenuItem::with_id(app, "slideshow_fullscreen", "フルスクリーン", true, false, None::<&str>)?;

    let rating_mode =
        CheckMenuItem::with_id(app, "rating_mode", "レーティング入力モード", true, false, None::<&str>)?;
    // 入力モードOFFの初期状態では未入力のみ表示は無効化する。
    let unrated_only =
        CheckMenuItem::with_id(app, "unrated_only", "レーティング後に未入力へ送る", false, false, None::<&str>)?;
    let xmp_auto =
        CheckMenuItem::with_id(app, "xmp_auto", "XMPへ自動書き出し", true, false, None::<&str>)?;
    let show_current_filename = CheckMenuItem::with_id(
        app, "show_current_filename", "現在のファイル名を表示", true, false, None::<&str>,
    )?;
    let show_current_position = CheckMenuItem::with_id(
        app, "show_current_position", "現在のファイル位置を表示", true, false, None::<&str>,
    )?;
    let show_current_rating = CheckMenuItem::with_id(
        app, "show_current_rating", "現在のレーティングを表示", true, false, None::<&str>,
    )?;
    let open_analysis =
        MenuItem::with_id(app, "open_analysis", "分析", true, Some("CmdOrCtrl+Shift+A"))?;

    let rating_submenu = SubmenuBuilder::new(app, "レーティング")
        .item(&rating_mode)
        .item(&unrated_only)
        .separator()
        .item(&xmp_auto)
        .build()?;

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

    // 標準「フルスクリーン」（ウィンドウ全画面・Ctrl+Cmd+F）を表示メニューの最下部へ結合する。
    // スライドショー内の「フルスクリーン」（自動送り全画面）とは別物。
    let fullscreen = PredefinedMenuItem::fullscreen(app, Some("フルスクリーン"))?;

    let view_submenu = SubmenuBuilder::new(app, "表示")
        .item(&zoom_submenu)
        .item(&slideshow_submenu)
        .separator()
        .item(&show_filename)
        .item(&show_current_filename)
        .item(&show_current_position)
        .item(&show_current_rating)
        .separator()
        .item(&open_analysis)
        .separator()
        .item(&fullscreen)
        .build()?;

    // macOS標準メニューを日本語ラベルで手組みする（既定の Menu::default は英語固定のため）。
    // アプリ名/About/Hide/Quit は製品名（package_info().name）を用いる。
    let app_name = app.package_info().name.clone();
    let about_text = format!("{app_name}について");
    let hide_text = format!("{app_name}を隠す");
    let quit_text = format!("{app_name}を終了");

    let app_submenu = SubmenuBuilder::new(app, &app_name)
        .item(&PredefinedMenuItem::about(app, Some(&about_text), None)?)
        .separator()
        .item(&PredefinedMenuItem::services(app, Some("サービス"))?)
        .separator()
        .item(&PredefinedMenuItem::hide(app, Some(&hide_text))?)
        .item(&PredefinedMenuItem::hide_others(app, Some("ほかを隠す"))?)
        .item(&PredefinedMenuItem::show_all(app, Some("すべてを表示"))?)
        .separator()
        .item(&PredefinedMenuItem::quit(app, Some(&quit_text))?)
        .build()?;

    let file_submenu = SubmenuBuilder::new(app, "ファイル")
        .item(&PredefinedMenuItem::close_window(app, Some("ウィンドウを閉じる"))?)
        .build()?;

    let edit_submenu = SubmenuBuilder::new(app, "編集")
        .item(&PredefinedMenuItem::undo(app, Some("取り消す"))?)
        .item(&PredefinedMenuItem::redo(app, Some("やり直す"))?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, Some("カット"))?)
        .item(&PredefinedMenuItem::copy(app, Some("コピー"))?)
        .item(&PredefinedMenuItem::paste(app, Some("ペースト"))?)
        .item(&PredefinedMenuItem::select_all(app, Some("すべてを選択"))?)
        .build()?;

    // Window/Help は Tauri の特別IDで作り、macOSのウィンドウメニュー/ヘルプ検索連携を維持する。
    let window_submenu = SubmenuBuilder::with_id(app, WINDOW_SUBMENU_ID, "ウィンドウ")
        .item(&PredefinedMenuItem::minimize(app, Some("最小化"))?)
        .item(&PredefinedMenuItem::maximize(app, Some("拡大/縮小"))?)
        .separator()
        .item(&PredefinedMenuItem::close_window(app, Some("閉じる"))?)
        .build()?;

    // ヘルプは空のまま（macOSがヘルプ検索フィールドを自動付与する）。
    let help_submenu = SubmenuBuilder::with_id(app, HELP_SUBMENU_ID, "ヘルプ").build()?;

    // 並び順: [アプリ名] ファイル 編集 表示 レーティング ウィンドウ ヘルプ
    // レーティングは Window/Help より左に配置する。
    let menu = Menu::with_items(
        app,
        &[
            &app_submenu,
            &file_submenu,
            &edit_submenu,
            &view_submenu,
            &rating_submenu,
            &window_submenu,
            &help_submenu,
        ],
    )?;

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
            rating_mode,
            unrated_only,
            xmp_auto,
            show_current_filename,
            show_current_position,
            show_current_rating,
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

    pub fn sync_rating_mode(&self, on: bool) {
        let _ = self.rating_mode.set_checked(on);
        // 入力モードOFF時は未入力のみ表示をグレアウト（無効化）する。
        let _ = self.unrated_only.set_enabled(on);
    }
    pub fn sync_unrated_only(&self, on: bool) {
        let _ = self.unrated_only.set_checked(on);
    }
    pub fn sync_xmp_auto(&self, on: bool) {
        let _ = self.xmp_auto.set_checked(on);
    }
    pub fn sync_current_filename(&self, on: bool) {
        let _ = self.show_current_filename.set_checked(on);
    }
    pub fn sync_current_position(&self, on: bool) {
        let _ = self.show_current_position.set_checked(on);
    }
    pub fn sync_current_rating(&self, on: bool) {
        let _ = self.show_current_rating.set_checked(on);
    }
}

use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};

/// スライドショーへ渡すスナップショット（画像パス列と開始位置）。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SlideshowPayload {
    pub paths: Vec<String>,
    pub ids: Vec<i64>,
    pub start_index: usize,
}

/// 専用ウィンドウへ受け渡すスナップショットを保持する管理状態。
pub struct SlideshowState(pub Mutex<Option<SlideshowPayload>>);

impl Default for SlideshowState {
    fn default() -> Self {
        SlideshowState(Mutex::new(None))
    }
}

/// スナップショットを保存する（純ロジック・テスト対象）。
pub fn set_payload(state: &SlideshowState, payload: SlideshowPayload) {
    *state.0.lock().unwrap() = Some(payload);
}

/// 保存済みスナップショットを取得する（純ロジック・テスト対象）。
pub fn get_payload(state: &SlideshowState) -> Option<SlideshowPayload> {
    state.0.lock().unwrap().clone()
}

/// スナップショットを保存し、スライドショー専用ウィンドウを生成（または前面化）する。
#[tauri::command]
pub fn start_slideshow(
    app: AppHandle,
    state: State<SlideshowState>,
    paths: Vec<String>,
    ids: Vec<i64>,
    start_index: usize,
) -> Result<(), String> {
    set_payload(&state, SlideshowPayload { paths, ids, start_index });
    if let Some(w) = app.get_webview_window("slideshow") {
        w.set_focus().map_err(|e| e.to_string())?;
    } else {
        WebviewWindowBuilder::new(
            &app,
            "slideshow",
            WebviewUrl::App("index.html#slideshow".into()),
        )
        .title("スライドショー")
        .inner_size(1000.0, 700.0)
        .build()
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// スライドショーウィンドウがマウント時に取得するスナップショット。
#[tauri::command]
pub fn get_slideshow_payload(state: State<SlideshowState>) -> Option<SlideshowPayload> {
    get_payload(&state)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn get_payload_is_none_initially() {
        let state = SlideshowState::default();
        assert_eq!(get_payload(&state), None);
    }

    #[test]
    fn set_then_get_roundtrip_and_overwrite() {
        let state = SlideshowState::default();
        set_payload(
            &state,
            SlideshowPayload { paths: vec!["/a.png".into(), "/b.png".into()], ids: vec![1, 2], start_index: 1 },
        );
        assert_eq!(
            get_payload(&state),
            Some(SlideshowPayload { paths: vec!["/a.png".into(), "/b.png".into()], ids: vec![1, 2], start_index: 1 })
        );
        set_payload(&state, SlideshowPayload { paths: vec!["/c.png".into()], ids: vec![3], start_index: 0 });
        assert_eq!(
            get_payload(&state),
            Some(SlideshowPayload { paths: vec!["/c.png".into()], ids: vec![3], start_index: 0 })
        );
    }
}

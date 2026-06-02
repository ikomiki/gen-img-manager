import { invoke } from "@tauri-apps/api/core";
import type { SlideshowPayload } from "../types";

/** 現在のリストのスナップショットを保存し、スライドショーウィンドウを起動する。 */
export const startSlideshow = (paths: string[], startIndex: number) =>
  invoke<void>("start_slideshow", { paths, startIndex });

/** スライドショーウィンドウがマウント時に取得するスナップショット。 */
export const getSlideshowPayload = () =>
  invoke<SlideshowPayload | null>("get_slideshow_payload");

/** スライドショーの表示モード（フルスクリーン）をネイティブメニューへ同期する。 */
export const syncSlideshowMenu = (fullscreen: boolean) =>
  invoke<void>("sync_slideshow_menu", { fullscreen });

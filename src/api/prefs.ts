import { invoke } from "@tauri-apps/api/core";

export const addFilterHistory = (query: string) =>
  invoke<void>("add_filter_history", { query });
export const listFilterHistory = () => invoke<string[]>("list_filter_history");
export const getSetting = (key: string) => invoke<string | null>("get_setting", { key });
export const setSetting = (key: string, value: string) =>
  invoke<void>("set_setting", { key, value });

export const syncZoomMenu = (mode: string) => invoke<void>("sync_zoom_menu", { mode });
export const syncFilenameMenu = (on: boolean) => invoke<void>("sync_filename_menu", { on });
export const syncSlideshowMenu = (fullscreen: boolean) =>
  invoke<void>("sync_slideshow_menu", { fullscreen });
export const syncRatingModeMenu = (on: boolean) =>
  invoke<void>("sync_rating_mode_menu", { on });
export const syncUnratedOnlyMenu = (on: boolean) =>
  invoke<void>("sync_unrated_only_menu", { on });
export const syncXmpAutoMenu = (on: boolean) =>
  invoke<void>("sync_xmp_auto_menu", { on });
export const syncCurrentFilenameMenu = (on: boolean) =>
  invoke<void>("sync_current_filename_menu", { on });
export const syncCurrentPositionMenu = (on: boolean) =>
  invoke<void>("sync_current_position_menu", { on });

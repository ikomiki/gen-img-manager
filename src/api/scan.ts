import { invoke } from "@tauri-apps/api/core";

export const scanDirectory = (id: number) => invoke<void>("scan_directory", { id });
export const scanAll = () => invoke<void>("scan_all");
export const rebuildDirectory = (id: number) => invoke<void>("rebuild_directory", { id });
export const rebuildAll = () => invoke<void>("rebuild_all");

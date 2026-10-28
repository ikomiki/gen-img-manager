import { invoke } from "@tauri-apps/api/core";

export const scanDirectory = (id: number, force = false) => invoke<void>("scan_directory", { id, force });
export const scanAll = (force = false) => invoke<void>("scan_all", { force });
export const rebuildDirectory = (id: number) => invoke<void>("rebuild_directory", { id });
export const rebuildAll = () => invoke<void>("rebuild_all");

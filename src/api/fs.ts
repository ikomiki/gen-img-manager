// src/api/fs.ts
import { invoke } from "@tauri-apps/api/core";

/** 画像をゴミ箱へ移動し、DBで missing 扱いにする。 */
export const deleteImage = (id: number, path: string) =>
  invoke<void>("delete_image", { id, path });

// src/api/fs.ts
import { invoke } from "@tauri-apps/api/core";

/** 画像をゴミ箱へ移動し、DBで missing 扱いにする。 */
export const deleteImage = (id: number, path: string) =>
  invoke<void>("delete_image", { id, path });

/** 画像に対応する .xmp サイドカーへ Rating を書き出す（null でクリア）。 */
export const writeXmpRating = (path: string, rating: number | null) =>
  invoke<void>("write_xmp_rating", { path, rating });

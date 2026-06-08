import { invoke } from "@tauri-apps/api/core";
import type { ImageRow, ImageDetail, SortKey, SortDir } from "../types";

export const queryImages = (
  query: string,
  sort: SortKey,
  dir: SortDir,
  limit: number,
  offset: number,
) => invoke<ImageRow[]>("query_images", { query, sort, dir, limit, offset });

export const countQuery = (query: string) => invoke<number>("count_query", { query });

export const getImageDetail = (id: number) =>
  invoke<ImageDetail | null>("get_image_detail", { id });

export const setRating = (id: number, rating: number | null) =>
  invoke<void>("set_rating", { id, rating });

export const revealInFinder = (path: string) =>
  invoke<void>("reveal_in_finder", { path });

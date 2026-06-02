import { invoke } from "@tauri-apps/api/core";
import type { ImageRow, SortKey, SortDir } from "../types";

export const queryImages = (
  query: string,
  sort: SortKey,
  dir: SortDir,
  limit: number,
  offset: number,
) => invoke<ImageRow[]>("query_images", { query, sort, dir, limit, offset });

export const countQuery = (query: string) => invoke<number>("count_query", { query });

import { getJson, dirsParam } from "./client";
import type { SortKey, SortDir } from "@gim/shared/types";

/** サーバの ImageDto。ファイルシステム上のパスは含まれない。 */
export interface ImageDto {
  id: number;
  filename: string;
  width: number;
  height: number;
  rating: number | null;
  created_at: number | null;
  modified_at: number | null;
  source_tool: string;
  model: string | null;
}

export interface ListParams {
  q: string;
  sort: SortKey;
  dir: SortDir;
  dirs: number[] | null;
  limit?: number;
  offset?: number;
}

function toQuery(p: ListParams): Record<string, string | undefined> {
  return {
    q: p.q || undefined,
    sort: p.sort,
    dir: p.dir,
    dirs: dirsParam(p.dirs),
    limit: p.limit?.toString(),
    offset: p.offset?.toString(),
  };
}

export const listImages = (p: ListParams) => getJson<ImageDto[]>("/api/images", toQuery(p));

export const countImages = (p: ListParams) =>
  getJson<{ total: number }>("/api/images/count", toQuery(p));

export const listImageIds = (p: ListParams) => getJson<number[]>("/api/images/ids", toQuery(p));

export const thumbUrl = (id: number) => `/api/thumb/${id}`;

export const imageUrl = (id: number, w?: number) =>
  w === undefined ? `/api/image/${id}` : `/api/image/${id}?w=${w}`;

/** サーバの ImageDetailDto。情報パネルが表示する列だけ。 */
export interface ImageDetailDto {
  id: number;
  filename: string;
  width: number;
  height: number;
  rating: number | null;
  source_tool: string;
  model: string | null;
  sampler: string | null;
  steps: number | null;
  cfg: number | null;
  seed: number | null;
  positive: string | null;
  negative: string | null;
  raw_parameters: string | null;
}

export const getImageDetail = (id: number) => getJson<ImageDetailDto>(`/api/images/${id}`);

export interface Directory {
  id: number;
  path: string;
  label: string;
  is_online: boolean;
  last_scanned_at: number | null;
  recursive: boolean;
  visible: boolean;
  image_count: number;
}

export interface ImageRow {
  id: number;
  path: string;
  filename: string;
  thumb_path: string | null;
  width: number;
  height: number;
  pixels: number;
  rating: number | null;
  created_at: number | null;
  modified_at: number | null;
  source_tool: string;
  model: string | null;
}

export type SortKey = "filename" | "created" | "modified";
export type SortDir = "asc" | "desc";

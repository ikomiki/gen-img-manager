export interface Directory {
  id: number;
  path: string;
  label: string;
  is_online: boolean;
  last_scanned_at: number | null;
  recursive: boolean;
}

export interface ScanProgress {
  directory_id: number;
  processed: number;
  total: number;
  current: string;
}

export interface ScanDone {
  directory_id: number;
  success: boolean;
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

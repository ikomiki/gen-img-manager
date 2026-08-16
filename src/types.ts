export type { Directory, ImageRow, SortKey, SortDir } from "@gim/shared/types";

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

export interface ImageDetail {
  id: number;
  path: string;
  filename: string;
  width: number;
  height: number;
  pixels: number;
  size: number;
  rating: number | null;
  created_at: number | null;
  modified_at: number | null;
  format: string;
  source_tool: string;
  raw_parameters: string | null;
  positive: string | null;
  negative: string | null;
  model: string | null;
  sampler: string | null;
  steps: number | null;
  seed: number | null;
  cfg: number | null;
  comfy_workflow: string | null;
}

export type ZoomMode = "fit" | "actual" | "fill" | "custom";

export interface SlideshowPayload {
  paths: string[];
  ids: number[];
  ratings: (number | null)[];
  start_index: number;
}

export interface TagFreq {
  tag_id: number;
  name: string;
  image_count: number;
}

export interface LiftRow {
  tag_id: number;
  name: string;
  rated_count: number;
  raw_avg: number | null;
  adjusted_avg: number | null;
  overall_avg: number | null;
}

export interface RatingBucket {
  rating: number | null;
  cnt: number;
}

export interface TagRatingAnalysis {
  has: RatingBucket[];
  without: RatingBucket[];
  has_avg: number | null;
  without_avg: number | null;
}

export interface AnalysisParams {
  applyExclusion: boolean;
  minRatedCount: number;
  priorWeight: number;
}

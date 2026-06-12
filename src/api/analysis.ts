import { invoke } from "@tauri-apps/api/core";
import type { TagFreq, LiftRow, TagRatingAnalysis, AnalysisParams } from "../types";

/** scope が undefined のとき全体、文字列のときフィルタ範囲（クエリ）。 */
export const tagFrequency = (
  scope: string | undefined,
  p: AnalysisParams,
  nameFilter: string | undefined,
  sort: "count" | "name",
  limit: number,
  offset: number,
) =>
  invoke<TagFreq[]>("analysis_tag_frequency", {
    scope: scope ?? null,
    applyExclusion: p.applyExclusion,
    minRatedCount: p.minRatedCount,
    priorWeight: p.priorWeight,
    nameFilter: nameFilter ?? null,
    sort,
    limit,
    offset,
  });

export const ratingLift = (
  scope: string | undefined,
  p: AnalysisParams,
  direction: "high" | "low",
  limit: number,
) =>
  invoke<LiftRow[]>("analysis_rating_lift", {
    scope: scope ?? null,
    applyExclusion: p.applyExclusion,
    minRatedCount: p.minRatedCount,
    priorWeight: p.priorWeight,
    direction,
    limit,
  });

export const tagRating = (scope: string | undefined, p: AnalysisParams, tagId: number) =>
  invoke<TagRatingAnalysis>("analysis_tag_rating", {
    scope: scope ?? null,
    applyExclusion: p.applyExclusion,
    minRatedCount: p.minRatedCount,
    priorWeight: p.priorWeight,
    tagId,
  });

export const listExcluded = () => invoke<string[]>("analysis_list_excluded");
export const addExcluded = (name: string) => invoke<void>("analysis_add_excluded", { name });
export const removeExcluded = (name: string) =>
  invoke<void>("analysis_remove_excluded", { name });

import type { SortKey, SortDir } from "@gim/shared/types";

export interface SlideshowPrefs {
  intervalSec: number;
  loop: boolean;
  shuffle: boolean;
}

/**
 * `shrink` は等倍を超えて拡大しない（小さい画像は小さいまま中央に置く）。
 * `always` は小さい画像も表示領域に収まるまで拡大する。
 */
export type ZoomMode = "shrink" | "always";

export interface ViewerPrefs {
  zoomMode: ZoomMode;
}

export interface Prefs {
  query: string;
  sort: SortKey;
  dir: SortDir;
  /** null=未指定（サーバの visible に従う）／[]=0件／配列=指定ID。 */
  dirs: number[] | null;
  history: string[];
  slideshow: SlideshowPrefs;
  viewer: ViewerPrefs;
}

/** 自由入力にすると 0 秒や負値の検証が要るうえ、スマホでの入力が面倒。 */
export const INTERVAL_CHOICES: readonly number[] = [3, 5, 10, 30];

const SORT_KEYS: readonly string[] = ["filename", "created", "modified"];
const SORT_DIRS: readonly string[] = ["asc", "desc"];
const ZOOM_MODES: readonly string[] = ["shrink", "always"];

export const DEFAULT_PREFS: Prefs = {
  query: "",
  sort: "created",
  dir: "desc",
  dirs: null,
  history: [],
  slideshow: { intervalSec: 5, loop: true, shuffle: false },
  viewer: { zoomMode: "shrink" },
};

export const HISTORY_MAX = 50;

const KEY = "gim.web.prefs";

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
}

function asNumberArrayOrNull(v: unknown): number[] | null {
  if (v === null) return null;
  if (!Array.isArray(v)) return null;
  return v.every((x) => typeof x === "number" && Number.isFinite(x)) ? (v as number[]) : null;
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : [];
}

function asBool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function asOneOf<T extends string>(v: unknown, allowed: readonly string[], fallback: T): T {
  return typeof v === "string" && allowed.includes(v) ? (v as T) : fallback;
}

/**
 * 保存内容をフィールド単位で検証して `Prefs` を組み立てる。
 * 型が違う値をそのまま通すと、`dirs: "abc"` のようなゴミが実行時エラーになって
 * 「読み込みに失敗しました」に化ける。既知のキーだけを組み立てるので、
 * 混入した未知のキーは次の保存で消える。
 */
export function sanitizePrefs(raw: unknown): Prefs {
  const r = asRecord(raw);
  const s = asRecord(r.slideshow);
  const intervalSec = typeof s.intervalSec === "number" && INTERVAL_CHOICES.includes(s.intervalSec)
    ? s.intervalSec
    : DEFAULT_PREFS.slideshow.intervalSec;

  return {
    query: typeof r.query === "string" ? r.query : DEFAULT_PREFS.query,
    sort: asOneOf<SortKey>(r.sort, SORT_KEYS, DEFAULT_PREFS.sort),
    dir: asOneOf<SortDir>(r.dir, SORT_DIRS, DEFAULT_PREFS.dir),
    dirs: asNumberArrayOrNull(r.dirs),
    history: asStringArray(r.history),
    slideshow: {
      intervalSec,
      loop: asBool(s.loop, DEFAULT_PREFS.slideshow.loop),
      shuffle: asBool(s.shuffle, DEFAULT_PREFS.slideshow.shuffle),
    },
    viewer: {
      zoomMode: asOneOf<ZoomMode>(
        asRecord(r.viewer).zoomMode,
        ZOOM_MODES,
        DEFAULT_PREFS.viewer.zoomMode,
      ),
    },
  };
}

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return sanitizePrefs(undefined);
    return sanitizePrefs(JSON.parse(raw));
  } catch {
    return sanitizePrefs(undefined);
  }
}

export function savePrefs(patch: Partial<Prefs>): void {
  const next = { ...loadPrefs(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // プライベートブラウジング等で書けなくても、閲覧そのものは続けられるべき。
  }
}

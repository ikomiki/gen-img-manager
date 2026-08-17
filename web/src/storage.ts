import type { SortKey, SortDir } from "@gim/shared/types";

export interface Prefs {
  query: string;
  sort: SortKey;
  dir: SortDir;
  /** null=未指定（サーバの visible に従う）／[]=0件／配列=指定ID。 */
  dirs: number[] | null;
  history: string[];
}

export const DEFAULT_PREFS: Prefs = {
  query: "",
  sort: "created",
  dir: "desc",
  dirs: null,
  history: [],
};

export const HISTORY_MAX = 50;

const KEY = "gim.web.prefs";

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    // 既定値で補うので、保存形式が増えても古い保存内容で壊れない。
    return { ...DEFAULT_PREFS, ...parsed };
  } catch {
    return { ...DEFAULT_PREFS };
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

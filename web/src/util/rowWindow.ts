import type { ImageDto } from "../api/images";

/** 一度に取る行数。1件ずつ取ると、飛ばし見のたびに往復が増える。 */
export const WINDOW_SIZE = 40;

/**
 * index を含む窓の先頭 offset。窓を整列させないと、隣の位置へ動くたびに
 * ずれた窓を取り直して同じ行を何度も引くことになる。
 */
export function windowOffsetFor(index: number, size = WINDOW_SIZE): number {
  return Math.floor(index / size) * size;
}

export interface RowWindow {
  /** sort 順インデックスの行。まだ無ければ undefined。 */
  get(index: number): ImageDto | undefined;
  /** index を含む窓を取りにいく。取得済み・取得中なら何もしない。 */
  ensure(index: number): void;
  clear(): void;
}

/**
 * sort 順インデックスから行を引くキャッシュ。`results` に無い位置の行を、
 * 必要になった窓だけ取ってくる。
 *
 * `onChange` は行が増えた／捨てられたときに呼ぶ。React 側の再描画の契機で、
 * このモジュール自身は React に依存しない。
 */
export function createRowWindow(
  fetchPage: (offset: number, limit: number) => Promise<ImageDto[]>,
  onChange: () => void,
  size = WINDOW_SIZE,
): RowWindow {
  const rows = new Map<number, ImageDto>();
  const inflight = new Set<number>();
  let generation = 0;

  return {
    get: (index) => rows.get(index),

    ensure: (index) => {
      if (index < 0 || rows.has(index)) return;
      const offset = windowOffsetFor(index, size);
      if (inflight.has(offset)) return;
      inflight.add(offset);
      const gen = generation;
      void fetchPage(offset, size)
        .then((page) => {
          // clear() はクエリが変わったときに呼ばれる。前のクエリの行を書き戻すと、
          // 別の画像のファイル名を出してしまう。
          if (gen !== generation) return;
          page.forEach((r, i) => rows.set(offset + i, r));
          onChange();
        })
        .catch(() => {
          // 行が取れなくても画像そのものは ID から表示できる。
          // onChange を呼ばないのは、失敗のたびに再描画→再取得で回り続けないため。
        })
        .finally(() => {
          inflight.delete(offset);
        });
    },

    clear: () => {
      generation += 1;
      rows.clear();
      inflight.clear();
      onChange();
    },
  };
}

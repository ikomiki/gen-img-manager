import type { ImageDto } from "../api/images";

/** 一度にまとめて取る行数。再生順の先をこの枚数ぶん先読みする。 */
export const ROW_BATCH = 40;

export interface RowCache {
  /** 画像 ID の行。まだ無ければ undefined。 */
  get(id: number): ImageDto | undefined;
  /**
   * `wanted` は再生順に並んだ ID 列。先頭 `near` 件に未取得があるときだけ、
   * `wanted` 全体の未取得分を 1 回の要求でまとめて取る。
   * 先頭が揃っていれば先の方が欠けていても取りにいかないので、
   * 1 枚送るたびに要求が出ることはなく、おおよそ `wanted.length - near` 枚に 1 回で済む。
   */
  ensure(wanted: number[], near: number): void;
  clear(): void;
}

/**
 * 画像 ID から行を引くキャッシュ。`results` に無い画像の行を、次に出す数十枚ぶんだけ
 * ID 指定でまとめて取ってくる。sort 順の offset ではなく ID で引くのは、
 * シャッフル再生では隣の画像の sort 順位置が毎回離れていて、
 * offset 窓では 1 枚ごとに別の窓を取り直すことになるため。
 *
 * `onChange` は行が増えた／捨てられたときに呼ぶ。React 側の再描画の契機で、
 * このモジュール自身は React に依存しない。
 */
export function createRowCache(
  fetchRows: (ids: number[]) => Promise<ImageDto[]>,
  onChange: () => void,
): RowCache {
  const rows = new Map<number, ImageDto>();
  const inflight = new Set<number>();
  let generation = 0;
  const missing = (id: number) => !rows.has(id) && !inflight.has(id);

  return {
    get: (id) => rows.get(id),

    ensure: (wanted, near) => {
      if (!wanted.slice(0, near).some(missing)) return;
      const ids = [...new Set(wanted.filter(missing))];
      ids.forEach((id) => inflight.add(id));
      const gen = generation;
      void fetchRows(ids)
        .then((page) => {
          // clear() はクエリが変わったときに呼ばれる。前の世代の行を書き戻すと、
          // 別の画像のファイル名を出してしまう。
          if (gen !== generation) return;
          page.forEach((r) => rows.set(r.id, r));
          onChange();
        })
        .catch(() => {
          // 行が取れなくても画像そのものは ID から表示できる。
          // onChange を呼ばないのは、失敗のたびに再描画→再取得で回り続けないため。
        })
        .finally(() => {
          ids.forEach((id) => inflight.delete(id));
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

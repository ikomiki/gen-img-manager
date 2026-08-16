/** 決定的な疑似乱数生成器（mulberry32）。テスト容易性のため seed を取る。 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 再生順序（results のインデックス列）を作る。
 * random=false なら昇順、true なら Fisher–Yates で重複なしシャッフル。
 */
export function buildOrder(length: number, random: boolean, rand: () => number): number[] {
  const order = Array.from({ length }, (_, i) => i);
  if (!random) return order;
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

export interface StepResult {
  /** 次の order 上の位置。 */
  pos: number;
  /** 末尾→先頭（または先頭→末尾）に折り返したか（random 時は再シャッフルの契機）。 */
  wrapped: boolean;
  /** 自動再生を停止すべきか（非ループで末尾に到達 or 空リスト）。 */
  stop: boolean;
}

/**
 * order 上の位置を delta（+1 次へ / -1 前へ）方向に進める。
 * ループ時は端で折り返す。非ループ時は前方端で停止、後方端で据え置き。
 */
export function step(pos: number, length: number, loop: boolean, delta: 1 | -1): StepResult {
  if (length <= 0) return { pos: 0, wrapped: false, stop: true };
  const next = pos + delta;
  if (next >= length) {
    return loop ? { pos: 0, wrapped: true, stop: false } : { pos: length - 1, wrapped: false, stop: true };
  }
  if (next < 0) {
    return loop ? { pos: length - 1, wrapped: true, stop: false } : { pos: 0, wrapped: false, stop: false };
  }
  return { pos: next, wrapped: false, stop: false };
}

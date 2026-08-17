export interface Preloader {
  preload(url: string): void;
}

/**
 * 同じ URL を二重に読みにいかない小さな仕組み。
 * サーバは同一画像への同時リクエストを single-flight していないので、
 * 重複を投げるとリサイズが2回走る。送り戻しの往復で投げ直さない程度に覚えておく。
 */
export function createPreloader(
  makeImage: () => HTMLImageElement = () => new Image(),
  max = 20,
): Preloader {
  // Set は挿入順を保つので、先頭が最も古い。
  const seen = new Set<string>();

  return {
    preload(url) {
      if (seen.has(url)) return;
      if (seen.size >= max) {
        const oldest = seen.values().next().value;
        if (oldest !== undefined) seen.delete(oldest);
      }
      seen.add(url);
      makeImage().src = url;
    },
  };
}

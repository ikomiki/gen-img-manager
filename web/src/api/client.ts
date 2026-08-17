export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/**
 * `dirs` の3状態をここに閉じ込める。
 * null=未指定（サーバの visible に従う）／[]=0件／配列=指定ID。
 */
export function dirsParam(dirs: number[] | null): string | undefined {
  return dirs === null ? undefined : dirs.join(",");
}

/**
 * undefined のキーを落としてクエリ文字列を作る。
 * URLSearchParams に undefined を渡すと文字列 "undefined" になるため、
 * キーを足すかどうかの判定をここで必ず経由させる。
 */
export function buildQuery(params: Record<string, string | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) sp.set(k, v);
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export async function getJson<T>(
  path: string,
  params: Record<string, string | undefined> = {},
): Promise<T> {
  const res = await fetch(`${path}${buildQuery(params)}`);
  if (!res.ok) {
    // サーバは全エラーを {"error": ...} で返すが、経路によっては届かないこともある。
    const message = await res
      .json()
      .then((b: unknown) =>
        typeof b === "object" && b !== null && "error" in b ? String(b.error) : res.statusText,
      )
      .catch(() => res.statusText);
    throw new ApiError(res.status, message);
  }
  return (await res.json()) as T;
}

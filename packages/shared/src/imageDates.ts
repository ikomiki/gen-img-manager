/** epoch 秒（ローカルTZ解釈）を "YYYY-MM-DD" に。 */
export function epochToLocalDate(tsSec: number): string {
  return dateToLocalString(new Date(tsSec * 1000));
}

/** Date をローカルの "YYYY-MM-DD" に。 */
export function dateToLocalString(d: Date): string {
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** "YYYY-MM-DD" をローカル深夜0時の Date に。 */
export function localDateToDate(s: string): Date {
  const [y, m, d] = s.split("-").map((x) => parseInt(x, 10));
  return new Date(y, m - 1, d);
}

export interface ImageDateInfo {
  /** 画像が存在するローカル日付（"YYYY-MM-DD"）の集合。 */
  dates: Set<string>;
  /** 最小日付（"YYYY-MM-DD"）。該当なしは null。 */
  min: string | null;
  /** 最大日付（"YYYY-MM-DD"）。該当なしは null。 */
  max: string | null;
}

/** created_at（epoch秒, null可）の配列から日付集合と最小/最大を算出する。 */
export function imageDateInfo(rows: { created_at: number | null }[]): ImageDateInfo {
  const dates = new Set<string>();
  let minTs: number | null = null;
  let maxTs: number | null = null;
  for (const r of rows) {
    if (r.created_at == null) continue;
    dates.add(epochToLocalDate(r.created_at));
    if (minTs == null || r.created_at < minTs) minTs = r.created_at;
    if (maxTs == null || r.created_at > maxTs) maxTs = r.created_at;
  }
  return {
    dates,
    min: minTs == null ? null : epochToLocalDate(minTs),
    max: maxTs == null ? null : epochToLocalDate(maxTs),
  };
}

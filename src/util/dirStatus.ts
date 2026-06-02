/** 件数を「1,234枚」のように整形する。 */
export function formatCount(n: number): string {
  return `${n.toLocaleString()}枚`;
}

/** Unix 秒を「YYYY-MM-DD HH:MM」（ローカルタイム）に整形する。 */
export function formatScanTimestamp(tsSec: number): string {
  const d = new Date(tsSec * 1000);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export interface DirStatusInput {
  /** スキャン中の進捗。スキャン中でなければ省略。 */
  scanning?: { processed: number; total: number };
  isOnline: boolean;
  /** ディレクトリの実件数（未ロードなら undefined）。 */
  count: number | undefined;
  /** 最終スキャン時刻（Unix秒）。未スキャンなら null。 */
  lastScannedAt: number | null;
}

/**
 * ディレクトリ行の2行目テキストを決める。優先順位:
 * スキャン中 > オフライン > 未スキャン > 件数+最終スキャン日時。
 */
export function dirStatusLine(s: DirStatusInput): string {
  if (s.scanning) {
    return `スキャン中 ${s.scanning.processed.toLocaleString()} / ${s.scanning.total.toLocaleString()}`;
  }
  if (!s.isOnline) return "オフライン";
  if (s.lastScannedAt == null) return "未スキャン";
  return `${formatCount(s.count ?? 0)} · 最終 ${formatScanTimestamp(s.lastScannedAt)}`;
}

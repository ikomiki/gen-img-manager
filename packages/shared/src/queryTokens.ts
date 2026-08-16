/**
 * クエリ文字列のトークン読み書きユーティリティ。
 * バックエンド (src-tauri/src/query/parse.rs) のトークナイザと同仕様:
 * - 空白区切り。ダブルクォートで囲んだ部分は1トークン（クォートは外す）。
 * - フィールド判定はクォート前の素のリード部 (lead) のコロンで行う
 *   （"foo:bar" のようにクォート内コロンはフィールド扱いしない）。
 */
export interface RawToken {
  /** クォートを外した全文（例 prompt:a b）。負号は除去済み。 */
  text: string;
  /** クォートが1度でも出現したか。 */
  quoted: boolean;
  /** 最初のクォートより前の素のリード部（例 "prompt:"）。負号は除去済み。 */
  lead: string;
  /** 先頭が '-' の除外トークンか。 */
  negate: boolean;
}

export function tokenizeQuery(input: string): RawToken[] {
  const tokens: RawToken[] = [];
  let cur = "";
  let lead = "";
  let inQuote = false;
  let quoted = false;
  // フィールド値括弧の状態。parenDepth>0 の間は空白で区切らずクォートも外さない。
  let parenDepth = 0;
  let parenInQuote = false;

  const flush = () => {
    if (cur !== "" || quoted) {
      const negate = lead.startsWith("-");
      const text = negate ? cur.slice(1) : cur;
      const leadStripped = negate ? lead.slice(1) : lead;
      // 負号のみ（本体が空）のトークンは捨てる。
      if (text !== "" || quoted) {
        tokens.push({ text, quoted, lead: leadStripped, negate });
      }
    }
    cur = "";
    lead = "";
    quoted = false;
  };

  for (const c of input) {
    if (parenDepth > 0) {
      cur += c;
      if (c === '"') {
        parenInQuote = !parenInQuote;
      } else if (!parenInQuote) {
        if (c === "(") parenDepth++;
        else if (c === ")") {
          parenDepth--;
          if (parenDepth === 0) parenInQuote = false;
        }
      }
      continue;
    }
    if (c === '"') {
      if (inQuote) {
        inQuote = false;
      } else {
        inQuote = true;
        quoted = true;
      }
    } else if (c === "(" && !inQuote && !quoted && cur.endsWith(":") && cur.length > 1) {
      cur += "(";
      parenDepth = 1;
      parenInQuote = false;
    } else if (/\s/.test(c) && !inQuote) {
      flush();
    } else {
      cur += c;
      if (!quoted) lead += c;
    }
  }
  flush();
  return tokens;
}

/** 非除外の field トークンの値（最初の1件）を返す。無ければ null。 */
export function extractField(query: string, field: string): string | null {
  for (const t of tokenizeQuery(query)) {
    if (t.negate) continue;
    const colon = t.lead.indexOf(":");
    if (colon < 0) continue;
    if (t.lead.slice(0, colon) === field) {
      return t.text.slice(colon + 1);
    }
  }
  return null;
}

/** RawToken を元のクエリ片へ復元する。 */
export function serializeToken(t: RawToken): string {
  const sign = t.negate ? "-" : "";
  if (t.quoted) {
    const valuePart = t.text.slice(t.lead.length);
    return `${sign}${t.lead}"${valuePart}"`;
  }
  return `${sign}${t.text}`;
}

/** field:value を生成（空白を含む値はクォート）。 */
function serializeField(field: string, value: string): string {
  const needsQuote = /\s/.test(value);
  return needsQuote ? `${field}:"${value}"` : `${field}:${value}`;
}

/**
 * 非除外の field トークンを除去し、value があれば末尾に追加する。
 * それ以外のトークン（素の語・OR・除外・他フィールド）は順序を保って温存する。
 */
export function upsertField(query: string, field: string, value: string | null): string {
  const kept: string[] = [];
  for (const t of tokenizeQuery(query)) {
    const colon = t.lead.indexOf(":");
    const isManaged = !t.negate && colon >= 0 && t.lead.slice(0, colon) === field;
    if (isManaged) continue;
    kept.push(serializeToken(t));
  }
  if (value != null && value !== "") {
    kept.push(serializeField(field, value));
  }
  return kept.join(" ").trim();
}

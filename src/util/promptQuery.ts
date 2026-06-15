/**
 * フィルタダイアログのプロンプト/ネガティブ欄の入力と、クエリ内の
 * `field:(...)` / `-field:...` トークンを相互変換する純粋関数群。
 *
 * 欄入力の記法: スペース=AND / AND・OR（大文字）/ -語=除外 / "句"=フレーズ / ()=グループ。
 * 除外（トップレベルの -語）は肯定式から分離し、-field:... として書き出す。
 * 括弧の中身（肯定式）の FTS5 変換はバックエンド（parse.rs）が行うため、ここでは触らない。
 */
import { tokenizeQuery, serializeToken, type RawToken } from "./queryTokens";

/** 欄入力をトップレベルの空白/括弧で分割し、各要素を返す（クォート・括弧内の空白は保持）。 */
function topLevelTokens(input: string): string[] {
  const out: string[] = [];
  let cur = "";
  let depth = 0;
  let inQuote = false;
  for (const c of input) {
    if (c === '"') {
      inQuote = !inQuote;
      cur += c;
    } else if (inQuote) {
      cur += c;
    } else if (c === "(") {
      depth++;
      cur += c;
    } else if (c === ")") {
      if (depth > 0) depth--;
      cur += c;
    } else if (/\s/.test(c) && depth === 0) {
      if (cur !== "") out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  if (cur !== "") out.push(cur);
  return out;
}

/** 欄入力を肯定式と除外語に分離する。 */
export function splitPromptInput(input: string): { positive: string; excludes: string[] } {
  const tokens = topLevelTokens(input.trim());
  const positive: string[] = [];
  const excludes: string[] = [];
  for (const t of tokens) {
    if (t === "-") continue; // 裸の '-' は無視（不正トークン化を防ぐ）
    if (t.startsWith("-") && t.length > 1) {
      excludes.push(t.slice(1));
    } else {
      positive.push(t);
    }
  }
  return { positive: positive.join(" "), excludes };
}

/** 肯定式が単一の裸の語（演算子・括弧・空白・クォートなし）か。 */
function isBareWord(expr: string): boolean {
  return expr !== "" && !/[\s()"]/.test(expr) && expr !== "AND" && expr !== "OR" && expr !== "NOT";
}

/** field の肯定トークンを生成（単一語は括弧なし、複雑な式は括弧で包む）。 */
function buildPositiveToken(field: string, positive: string): string | null {
  if (positive === "") return null;
  if (isBareWord(positive)) return `${field}:${positive}`;
  return `${field}:(${positive})`;
}

/** field の除外トークンを生成（単一は -field:word、複数は -field:(a OR b)）。 */
function buildExcludeToken(field: string, excludes: string[]): string | null {
  if (excludes.length === 0) return null;
  if (excludes.length === 1 && isBareWord(excludes[0])) return `-${field}:${excludes[0]}`;
  return `-${field}:(${excludes.join(" OR ")})`;
}

/** クエリ内の field の肯定/除外トークンを差し替えて返す。他トークンは順序を保って温存。 */
export function applyPromptField(query: string, field: string, input: string): string {
  const kept: string[] = [];
  for (const t of tokenizeQuery(query)) {
    const colon = t.lead.indexOf(":");
    const isField = colon >= 0 && t.lead.slice(0, colon) === field;
    if (isField) continue; // 肯定・除外どちらの field トークンも除去
    kept.push(serializeToken(t));
  }
  const { positive, excludes } = splitPromptInput(input);
  const pos = buildPositiveToken(field, positive);
  const neg = buildExcludeToken(field, excludes);
  if (pos) kept.push(pos);
  if (neg) kept.push(neg);
  return kept.join(" ").trim();
}

/** field トークンの値部分（colon 以降）を取り出す。 */
function fieldValue(t: RawToken): string {
  const colon = t.lead.indexOf(":");
  return t.text.slice(colon + 1);
}

/**
 * `(a OR b)` 形式の括弧式を ["a","b"] へ分解（トップレベルの語のみ）。
 * 否定グループは OR 結合前提のため、演算子 AND/OR/NOT は除外語化しない（best-effort）。
 */
function splitOrGroup(value: string): string[] {
  const inner = value.slice(1, -1); // 外側括弧を外す
  return topLevelTokens(inner).filter((t) => t !== "OR" && t !== "AND" && t !== "NOT");
}

/** クエリから field の肯定/除外をまとめて欄表示文字列へ復元する。 */
export function promptFieldToInput(query: string, field: string): string {
  let positive = "";
  const excludes: string[] = [];
  for (const t of tokenizeQuery(query)) {
    const colon = t.lead.indexOf(":");
    if (colon < 0 || t.lead.slice(0, colon) !== field) continue;
    const value = fieldValue(t);
    if (t.negate) {
      if (value.startsWith("(")) excludes.push(...splitOrGroup(value));
      else excludes.push(value);
    } else {
      if (value.startsWith("(")) positive = value.slice(1, -1);
      else if (t.quoted) positive = `"${value}"`;
      else positive = value;
    }
  }
  const parts: string[] = [];
  if (positive) parts.push(positive);
  for (const e of excludes) parts.push(`-${e}`);
  return parts.join(" ");
}

#!/usr/bin/env node
/**
 * アプリのバージョンを全ファイルで一括更新する単一の入口。
 *
 *   npm run bump -- patch          # 0.1.0 -> 0.1.1
 *   npm run bump -- minor          # 0.1.0 -> 0.2.0
 *   npm run bump -- major          # 0.1.0 -> 1.0.0
 *   npm run bump -- 1.2.3          # 明示指定
 *   npm run bump -- patch --dry-run  # 書き込まず内容だけ表示
 *
 * 対象ファイル:
 *   - package.json                 (npm パッケージ版)
 *   - src-tauri/tauri.conf.json    (Tauri アプリ版・正)
 *   - src-tauri/Cargo.toml         ([package] 版)
 *   - Cargo.lock                   (自身のパッケージブロック版・workspace ルート)
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { planBump, VERSION_FILES } from "./version-core.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** 正規表現メタ文字をエスケープする。 @param {string} s */
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * 単一ファイル内の対象 version を読み取り／置換するためのハンドラを作る。
 * pattern は (前置き)(version)(後置き) の3グループを持つ。
 * @param {string} relPath
 * @param {RegExp} pattern
 */
function fileTarget(relPath, pattern) {
  const absPath = join(ROOT, relPath);
  return {
    file: relPath,
    /** @returns {string | null} */
    read() {
      const content = readFileSync(absPath, "utf8");
      const m = content.match(pattern);
      return m ? m[2] : null;
    },
    /** @param {string} next */
    write(next) {
      const content = readFileSync(absPath, "utf8");
      if (!pattern.test(content)) {
        throw new Error(`${relPath} の version 行が見つかりませんでした`);
      }
      writeFileSync(absPath, content.replace(pattern, `$1${next}$3`));
    },
  };
}

// Cargo.lock の自身のパッケージ名を Cargo.toml から取得する。
const cargoToml = readFileSync(join(ROOT, "src-tauri/Cargo.toml"), "utf8");
const nameMatch = cargoToml.match(/\[package\][^[]*?\bname\s*=\s*"([^"]*)"/);
if (!nameMatch) {
  console.error("src-tauri/Cargo.toml の [package] name を読み取れませんでした");
  process.exit(1);
}
const pkgName = nameMatch[1];

const JSON_VERSION = /("version"\s*:\s*")([^"]*)(")/;
const CARGO_TOML_VERSION = /(\[package\][^[]*?\bversion\s*=\s*")([^"]*)(")/;
const CARGO_LOCK_VERSION = new RegExp(
  `(\\[\\[package\\]\\]\\nname = "${escapeRe(pkgName)}"\\nversion = ")([^"]*)(")`,
);

/** @type {Record<string, RegExp>} */
const PATTERN_BY_FILE = {
  "package.json": JSON_VERSION,
  "src-tauri/tauri.conf.json": JSON_VERSION,
  "src-tauri/Cargo.toml": CARGO_TOML_VERSION,
  "Cargo.lock": CARGO_LOCK_VERSION,
};

const targets = VERSION_FILES.map((f) => fileTarget(f, PATTERN_BY_FILE[f]));

function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const arg = argv.find((a) => !a.startsWith("-"));

  const entries = targets.map((t) => ({ file: t.file, version: t.read() }));

  let plan;
  try {
    plan = planBump({ entries, arg });
  } catch (err) {
    console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
    return;
  }

  if (plan.noop) {
    console.log(`既に ${plan.target} です。変更はありません。`);
    return;
  }

  const prefix = dryRun ? "[dry-run] " : "";
  const from = plan.drift ? "(不一致)" : plan.current;
  console.log(`${prefix}バージョン更新: ${from} -> ${plan.target}`);
  if (plan.drift) {
    console.log("  ※ ファイル間でバージョンが不一致だったため、全て目標値へ揃えます。");
  }

  for (const t of targets) {
    const before = entries.find((e) => e.file === t.file)?.version ?? "(不明)";
    console.log(`  ${t.file}: ${before} -> ${plan.target}`);
    if (!dryRun) t.write(plan.target);
  }

  console.log(dryRun ? "[dry-run] 書き込みは行っていません。" : "✓ 完了しました。");
}

main();

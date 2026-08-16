// @ts-check
/**
 * バージョン操作の純粋ロジック（副作用なし）。
 * ファイルI/Oは bump-version.mjs 側が担当し、ここは計算・検証・判定のみ。
 */

/** @typedef {"major" | "minor" | "patch"} ReleaseType */
/** @typedef {{ file: string, version: string | null }} VersionEntry */

/** サポートするリリース種別。 */
export const RELEASE_TYPES = /** @type {const} */ (["major", "minor", "patch"]);

/**
 * バージョンを保持するファイル（プロジェクトルート起点の相対パス）。
 * Cargo.lock は Cargo workspace のルートにある。
 */
export const VERSION_FILES = /** @type {const} */ ([
  "package.json",
  "src-tauri/tauri.conf.json",
  "src-tauri/Cargo.toml",
  "Cargo.lock",
]);

// 厳密な x.y.z（各桁は0、または先頭ゼロなしの整数）。プレリリースは対象外。
const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/**
 * 厳密な x.y.z 形式かどうか。
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidVersion(value) {
  return typeof value === "string" && SEMVER_RE.test(value);
}

/**
 * バージョン文字列を {major, minor, patch} に分解する。不正なら例外。
 * @param {string} value
 * @returns {{ major: number, minor: number, patch: number }}
 */
export function parseVersion(value) {
  const m = typeof value === "string" ? value.match(SEMVER_RE) : null;
  if (!m) {
    throw new Error(`不正なバージョン文字列です: ${JSON.stringify(value)}`);
  }
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

/**
 * @param {unknown} value
 * @returns {value is ReleaseType}
 */
export function isReleaseType(value) {
  return RELEASE_TYPES.includes(/** @type {ReleaseType} */ (value));
}

/**
 * 現在バージョンをリリース種別に従って繰り上げる。
 * @param {string} current
 * @param {ReleaseType} releaseType
 * @returns {string}
 */
export function bumpVersion(current, releaseType) {
  if (!isReleaseType(releaseType)) {
    throw new Error(
      `不正なリリース種別です: ${JSON.stringify(releaseType)} (有効: ${RELEASE_TYPES.join(", ")})`,
    );
  }
  const { major, minor, patch } = parseVersion(current);
  switch (releaseType) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
  }
}

/**
 * 複数ファイルのバージョンが揃っているかを判定する。
 * @param {VersionEntry[]} entries
 * @returns {{ inSync: boolean, current: string | null, entries: VersionEntry[] }}
 */
export function analyzeVersions(entries) {
  const versions = entries.map((e) => e.version);
  const first = versions[0];
  const inSync = versions.length > 0 && versions.every((v) => v === first);
  return { inSync, current: inSync ? /** @type {string} */ (first) : null, entries };
}

/**
 * 読み取り済みのファイル値と引数から、バンプ計画を立てる。
 *
 * - 引数がリリース種別(patch/minor/major)で、ファイル値が不一致(ドリフト)なら中断。
 * - 引数が明示バージョンなら、ドリフトの有無に関わらずその値へ収束。
 * - すべて整合済みで目標値と同一なら no-op。
 *
 * @param {{ entries: VersionEntry[], arg: string | undefined }} params
 * @returns {{ target: string, current: string | null, drift: boolean, noop: boolean }}
 */
export function planBump({ entries, arg }) {
  if (arg === undefined || arg === null || arg === "") {
    throw new Error(
      `バージョン指定が必要です。patch / minor / major または x.y.z を渡してください。`,
    );
  }

  // 全ファイルの値が厳密な semver として読めているか検証する。
  const invalid = entries.filter((e) => !isValidVersion(e.version));
  if (invalid.length > 0) {
    const detail = invalid
      .map((e) => `${e.file}: ${e.version === null ? "(読み取り不可)" : JSON.stringify(e.version)}`)
      .join(", ");
    throw new Error(`バージョンを読み取れないファイルがあります -> ${detail}`);
  }

  const { inSync, current } = analyzeVersions(entries);

  if (isReleaseType(arg)) {
    if (!inSync) {
      const detail = entries.map((e) => `${e.file}: ${e.version}`).join("\n  ");
      throw new Error(
        `各ファイルのバージョンが一致していないため、キーワード(${arg})では計算できません。\n` +
          `  ${detail}\n` +
          `明示バージョン(例: x.y.z)を指定して揃え直してください。`,
      );
    }
    return {
      target: bumpVersion(/** @type {string} */ (current), arg),
      current,
      drift: false,
      noop: false,
    };
  }

  if (!isValidVersion(arg)) {
    throw new Error(
      `不正なバージョン指定です: ${JSON.stringify(arg)} (patch / minor / major または x.y.z)`,
    );
  }

  return {
    target: arg,
    current,
    drift: !inSync,
    noop: inSync && current === arg,
  };
}

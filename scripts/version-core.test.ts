import { describe, it, expect } from "vitest";
import {
  isValidVersion,
  parseVersion,
  bumpVersion,
  analyzeVersions,
  planBump,
  VERSION_FILES,
} from "./version-core.mjs";

describe("isValidVersion", () => {
  it("厳密な x.y.z（数値のみ）を受理する", () => {
    expect(isValidVersion("0.1.0")).toBe(true);
    expect(isValidVersion("1.2.3")).toBe(true);
    expect(isValidVersion("10.20.30")).toBe(true);
    expect(isValidVersion("0.0.0")).toBe(true);
  });

  it("不正な形式を拒否する", () => {
    expect(isValidVersion("0.1")).toBe(false);
    expect(isValidVersion("1.2.3.4")).toBe(false);
    expect(isValidVersion("v1.2.3")).toBe(false);
    expect(isValidVersion("1.2.3-beta")).toBe(false);
    expect(isValidVersion("01.2.3")).toBe(false); // 先頭ゼロは不可
    expect(isValidVersion("1.2.x")).toBe(false);
    expect(isValidVersion("")).toBe(false);
    expect(isValidVersion("abc")).toBe(false);
  });
});

describe("parseVersion", () => {
  it("major/minor/patch に分解する", () => {
    expect(parseVersion("0.1.0")).toEqual({ major: 0, minor: 1, patch: 0 });
    expect(parseVersion("10.20.30")).toEqual({ major: 10, minor: 20, patch: 30 });
  });

  it("不正な値は例外を投げる", () => {
    expect(() => parseVersion("1.2")).toThrow();
    expect(() => parseVersion("1.2.3-beta")).toThrow();
  });
});

describe("bumpVersion", () => {
  it("patch は最後の桁を増やす", () => {
    expect(bumpVersion("0.1.0", "patch")).toBe("0.1.1");
    expect(bumpVersion("0.1.9", "patch")).toBe("0.1.10");
  });

  it("minor は patch を0に戻す", () => {
    expect(bumpVersion("0.1.5", "minor")).toBe("0.2.0");
  });

  it("major は minor/patch を0に戻す", () => {
    expect(bumpVersion("1.2.3", "major")).toBe("2.0.0");
  });

  it("不正なリリース種別は例外", () => {
    // @ts-expect-error 不正な種別を意図的に渡して検証する
    expect(() => bumpVersion("0.1.0", "huge")).toThrow();
  });

  it("不正な現在バージョンは例外", () => {
    expect(() => bumpVersion("0.1", "patch")).toThrow();
  });
});

describe("analyzeVersions", () => {
  it("全て一致なら inSync=true・current を返す", () => {
    const result = analyzeVersions([
      { file: "package.json", version: "0.1.0" },
      { file: "Cargo.toml", version: "0.1.0" },
    ]);
    expect(result.inSync).toBe(true);
    expect(result.current).toBe("0.1.0");
  });

  it("不一致なら inSync=false・current=null", () => {
    const result = analyzeVersions([
      { file: "package.json", version: "0.1.0" },
      { file: "Cargo.toml", version: "0.1.1" },
    ]);
    expect(result.inSync).toBe(false);
    expect(result.current).toBeNull();
  });
});

const entries = (v: string) => [
  { file: "package.json", version: v },
  { file: "src-tauri/tauri.conf.json", version: v },
  { file: "src-tauri/Cargo.toml", version: v },
  { file: "src-tauri/Cargo.lock", version: v },
];

describe("planBump", () => {
  it("キーワード＋整合状態：現在値から計算する", () => {
    const plan = planBump({ entries: entries("0.1.0"), arg: "patch" });
    expect(plan.current).toBe("0.1.0");
    expect(plan.target).toBe("0.1.1");
    expect(plan.drift).toBe(false);
    expect(plan.noop).toBe(false);
  });

  it("キーワード＋ドリフト：中断（例外）し各ファイル値を含む", () => {
    const mixed = [
      { file: "package.json", version: "0.1.0" },
      { file: "src-tauri/Cargo.toml", version: "0.2.0" },
    ];
    expect(() => planBump({ entries: mixed, arg: "patch" })).toThrow(/0\.2\.0/);
  });

  it("明示バージョン＋整合・異なる値：その値を目標にする", () => {
    const plan = planBump({ entries: entries("0.1.0"), arg: "0.1.1" });
    expect(plan.target).toBe("0.1.1");
    expect(plan.noop).toBe(false);
    expect(plan.drift).toBe(false);
  });

  it("明示バージョン＋整合・同一値：no-op", () => {
    const plan = planBump({ entries: entries("0.1.1"), arg: "0.1.1" });
    expect(plan.target).toBe("0.1.1");
    expect(plan.noop).toBe(true);
  });

  it("明示バージョン＋ドリフト：目標値へ収束（drift=true・書込あり）", () => {
    const mixed = [
      { file: "package.json", version: "0.1.0" },
      { file: "src-tauri/Cargo.toml", version: "0.1.1" },
    ];
    const plan = planBump({ entries: mixed, arg: "0.1.1" });
    expect(plan.target).toBe("0.1.1");
    expect(plan.drift).toBe(true);
    expect(plan.noop).toBe(false);
  });

  it("不正な明示バージョンは例外", () => {
    expect(() => planBump({ entries: entries("0.1.0"), arg: "1.2" })).toThrow();
  });

  it("キーワードでもバージョンでもない引数は例外", () => {
    expect(() => planBump({ entries: entries("0.1.0"), arg: "bogus" })).toThrow();
  });

  it("引数が無い場合は例外", () => {
    expect(() => planBump({ entries: entries("0.1.0"), arg: undefined })).toThrow();
  });

  it("読み取れなかった（不正な）ファイル値があれば例外でファイル名を示す", () => {
    const bad = [
      { file: "package.json", version: "0.1.0" },
      { file: "src-tauri/Cargo.toml", version: null },
    ];
    expect(() => planBump({ entries: bad, arg: "patch" })).toThrow(/Cargo\.toml/);
  });
});

describe("VERSION_FILES", () => {
  it("バージョンを持つ4ファイルを順に列挙する", () => {
    expect([...VERSION_FILES]).toEqual([
      "package.json",
      "src-tauri/tauri.conf.json",
      "src-tauri/Cargo.toml",
      "Cargo.lock",
    ]);
  });

  it("Cargo.lock は workspace ルートを指す", () => {
    expect(VERSION_FILES).not.toContain("src-tauri/Cargo.lock");
  });
});

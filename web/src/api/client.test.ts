import { describe, it, expect, vi, afterEach } from "vitest";
import { getJson, ApiError, buildQuery, dirsParam } from "./client";

afterEach(() => vi.unstubAllGlobals());

function stubFetch(status: number, body: unknown, contentType = "application/json") {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": contentType },
      }),
    ),
  );
}

describe("dirsParam", () => {
  it("null はキーを送らない意味の undefined を返す", () => {
    expect(dirsParam(null)).toBeUndefined();
  });

  it("空配列は空文字列（0件の意味）", () => {
    expect(dirsParam([])).toBe("");
  });

  it("配列はカンマ区切り", () => {
    expect(dirsParam([1, 3])).toBe("1,3");
  });
});

describe("buildQuery", () => {
  it("undefined のキーは落とす", () => {
    expect(buildQuery({ a: "1", b: undefined })).toBe("?a=1");
  });

  it("空文字列のキーは残す", () => {
    expect(buildQuery({ dirs: "" })).toBe("?dirs=");
  });

  it("すべて undefined なら空文字列", () => {
    expect(buildQuery({ a: undefined })).toBe("");
  });

  it("値をエスケープする", () => {
    expect(buildQuery({ q: "a b&c" })).toBe("?q=a+b%26c");
  });
});

describe("getJson", () => {
  it("成功時は本文を返す", async () => {
    stubFetch(200, { total: 3 });
    await expect(getJson("/api/images/count")).resolves.toEqual({ total: 3 });
  });

  it("エラー時は error キーを message にした ApiError を投げる", async () => {
    stubFetch(400, { error: "limit は 1〜1000 で指定してください: 0" });
    await expect(getJson("/api/images")).rejects.toMatchObject({
      status: 400,
      message: "limit は 1〜1000 で指定してください: 0",
    });
  });

  it("JSON でないエラー本文でも ApiError になる", async () => {
    stubFetch(500, "boom", "text/plain");
    const err = await getJson("/api/images").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    // getJson<T> の T が推論不能で unknown になり、Promise<T | TResult> が unknown に
    // 潰れて tsc が err を unknown 扱いするため、アサーション後はキャストが必要。
    expect((err as ApiError).status).toBe(500);
  });
});

import { describe, it, expect, vi } from "vitest";
import { createRowCache } from "./rowCache";
import type { ImageDto } from "../api/images";

function row(id: number): ImageDto {
  return {
    id,
    filename: `${id}.png`,
    width: 100,
    height: 100,
    rating: null,
    created_at: null,
    modified_at: null,
    source_tool: "a1111",
    model: null,
  };
}

/** 要求された ID の行を返す偽の取得。呼ばれた ID 列を記録する。 */
function fakeFetch() {
  const calls: number[][] = [];
  const fn = (ids: number[]) => {
    calls.push(ids);
    return Promise.resolve(ids.map(row));
  };
  return { fn, calls };
}

const range = (from: number, count: number) => Array.from({ length: count }, (_, i) => from + i);

describe("createRowCache", () => {
  it("取得前は undefined、取得後は行を返す", async () => {
    const { fn } = fakeFetch();
    const onChange = vi.fn();
    const c = createRowCache(fn, onChange);

    expect(c.get(7)).toBeUndefined();
    c.ensure([7, 8, 9], 1);
    await vi.waitFor(() => expect(onChange).toHaveBeenCalled());

    expect(c.get(7)?.id).toBe(7);
    expect(c.get(9)?.id).toBe(9);
  });

  it("先頭 near 件に未取得があれば wanted 全体の未取得分を 1 回で取る", async () => {
    const { fn, calls } = fakeFetch();
    const c = createRowCache(fn, () => {});
    c.ensure(range(100, 40), 3);
    await vi.waitFor(() => expect(calls).toEqual([range(100, 40)]));
  });

  it("先頭 near 件が揃っていれば、先が欠けていても取りにいかない", async () => {
    const { fn, calls } = fakeFetch();
    const c = createRowCache(fn, () => {});
    c.ensure(range(0, 40), 3);
    await vi.waitFor(() => expect(c.get(39)).toBeDefined());

    // 1 枚送った: 先頭 3 件（1..3）は取得済み、末尾 40 は未取得。
    c.ensure(range(1, 40), 3);
    expect(calls).toHaveLength(1);

    // 先頭 3 件に未取得（40）が入って初めて、残りをまとめて取る。
    c.ensure(range(38, 40), 3);
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]).toEqual(range(40, 38));
  });

  it("取得中の ID は二重に取りにいかない", async () => {
    const { fn, calls } = fakeFetch();
    const c = createRowCache(fn, () => {});
    c.ensure([1, 2, 3], 1);
    // 先頭が取得中なら要求しない。
    c.ensure([2, 3, 4], 1);
    // 先頭が未取得なら要求するが、取得中の 2・3 は含めない。
    c.ensure([4, 2, 3], 1);
    await vi.waitFor(() => expect(c.get(4)).toBeDefined());
    expect(calls).toEqual([[1, 2, 3], [4]]);
  });

  it("空の wanted では取りにいかない", () => {
    const { fn, calls } = fakeFetch();
    createRowCache(fn, () => {}).ensure([], 3);
    expect(calls).toEqual([]);
  });

  it("取得に失敗しても投げず、次の ensure で取り直せる", async () => {
    const calls: number[][] = [];
    let fail = true;
    const fn = (ids: number[]) => {
      calls.push(ids);
      if (fail) return Promise.reject(new Error("network"));
      return Promise.resolve(ids.map(row));
    };
    const c = createRowCache(fn, () => {});

    c.ensure([0], 1);
    await vi.waitFor(() => expect(calls).toEqual([[0]]));
    expect(c.get(0)).toBeUndefined();

    fail = false;
    // 失敗の後片付け（inflight の解除）はマイクロタスクで走る。何回目のティックで
    // 済むかはプロミスの連なり方に依るので、取り直せるようになるまで ensure を試す。
    await vi.waitFor(() => {
      c.ensure([0], 1);
      expect(calls).toEqual([[0], [0]]);
    });
    await vi.waitFor(() => expect(c.get(0)?.id).toBe(0));
  });

  it("clear で取得済みの行を捨てる", async () => {
    const { fn } = fakeFetch();
    const onChange = vi.fn();
    const c = createRowCache(fn, onChange);
    c.ensure([0], 1);
    await vi.waitFor(() => expect(c.get(0)).toBeDefined());

    c.clear();

    expect(c.get(0)).toBeUndefined();
    expect(onChange).toHaveBeenCalled();
  });

  it("clear より前に始まった取得は、後で解決しても入らない", async () => {
    let resolvePage: (rows: ImageDto[]) => void = () => {};
    const fn = () => new Promise<ImageDto[]>((r) => { resolvePage = r; });
    const onChange = vi.fn();
    const c = createRowCache(fn, onChange);

    c.ensure([0], 1);
    c.clear();
    onChange.mockClear();
    resolvePage([row(0)]);
    await Promise.resolve();
    await Promise.resolve();

    expect(c.get(0)).toBeUndefined();
    expect(onChange).not.toHaveBeenCalled();
  });
});

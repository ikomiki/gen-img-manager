import { describe, it, expect, vi } from "vitest";
import { createRowWindow, windowOffsetFor, WINDOW_SIZE } from "./rowWindow";
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

/** offset から limit 件を返す偽の取得。呼ばれた offset を記録する。 */
function fakeFetch() {
  const calls: number[] = [];
  const fn = (offset: number, limit: number) => {
    calls.push(offset);
    return Promise.resolve(Array.from({ length: limit }, (_, i) => row(offset + i)));
  };
  return { fn, calls };
}

describe("windowOffsetFor", () => {
  it("窓の先頭へ整列する", () => {
    expect(windowOffsetFor(0, 40)).toBe(0);
    expect(windowOffsetFor(39, 40)).toBe(0);
    expect(windowOffsetFor(40, 40)).toBe(40);
    expect(windowOffsetFor(5231, 40)).toBe(5200);
  });

  it("既定の窓幅を使う", () => {
    expect(windowOffsetFor(WINDOW_SIZE)).toBe(WINDOW_SIZE);
  });
});

describe("createRowWindow", () => {
  it("取得前は undefined、取得後は行を返す", async () => {
    const { fn } = fakeFetch();
    const onChange = vi.fn();
    const w = createRowWindow(fn, onChange, 40);

    expect(w.get(5231)).toBeUndefined();
    w.ensure(5231);
    await vi.waitFor(() => expect(onChange).toHaveBeenCalled());

    expect(w.get(5231)?.id).toBe(5231);
    // 窓の先頭も入っている
    expect(w.get(5200)?.id).toBe(5200);
  });

  it("窓の先頭へ整列した offset で取りにいく", async () => {
    const { fn, calls } = fakeFetch();
    const w = createRowWindow(fn, () => {}, 40);
    w.ensure(5231);
    await vi.waitFor(() => expect(calls).toEqual([5200]));
  });

  it("同じ窓を二重に取りにいかない", async () => {
    const { fn, calls } = fakeFetch();
    const w = createRowWindow(fn, () => {}, 40);
    w.ensure(5231);
    w.ensure(5232);
    w.ensure(5200);
    await vi.waitFor(() => expect(calls).toEqual([5200]));
  });

  it("取得済みの位置では取りにいかない", async () => {
    const { fn, calls } = fakeFetch();
    const w = createRowWindow(fn, () => {}, 40);
    w.ensure(0);
    await vi.waitFor(() => expect(w.get(0)).toBeDefined());
    w.ensure(0);
    expect(calls).toEqual([0]);
  });

  it("負の位置は取りにいかない", () => {
    const { fn, calls } = fakeFetch();
    const w = createRowWindow(fn, () => {}, 40);
    w.ensure(-1);
    expect(calls).toEqual([]);
  });

  it("取得に失敗しても投げず、次の ensure で取り直せる", async () => {
    const calls: number[] = [];
    let fail = true;
    const fn = (offset: number, limit: number) => {
      calls.push(offset);
      if (fail) return Promise.reject(new Error("network"));
      return Promise.resolve(Array.from({ length: limit }, (_, i) => row(offset + i)));
    };
    const w = createRowWindow(fn, () => {}, 40);

    w.ensure(0);
    await vi.waitFor(() => expect(calls).toEqual([0]));
    expect(w.get(0)).toBeUndefined();

    fail = false;
    // 失敗の後片付け（inflight の解除）はマイクロタスクで走る。何回目のティックで
    // 済むかはプロミスの連なり方に依るので、取り直せるようになるまで ensure を試す。
    await vi.waitFor(() => {
      w.ensure(0);
      expect(calls).toEqual([0, 0]);
    });
    await vi.waitFor(() => expect(w.get(0)?.id).toBe(0));
  });

  it("clear で取得済みの行を捨てる", async () => {
    const { fn } = fakeFetch();
    const onChange = vi.fn();
    const w = createRowWindow(fn, onChange, 40);
    w.ensure(0);
    await vi.waitFor(() => expect(w.get(0)).toBeDefined());

    w.clear();

    expect(w.get(0)).toBeUndefined();
    expect(onChange).toHaveBeenCalled();
  });
});

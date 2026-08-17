import { describe, it, expect } from "vitest";
import { createPreloader } from "./preloader";

function fakeImageFactory() {
  const created: { src: string }[] = [];
  const make = () => {
    const img = { src: "" } as HTMLImageElement;
    created.push(img);
    return img;
  };
  return { make, created };
}

describe("createPreloader", () => {
  it("URL ごとに1回だけ読み込む", () => {
    const f = fakeImageFactory();
    const p = createPreloader(f.make);

    p.preload("/api/image/1?w=1280");
    p.preload("/api/image/1?w=1280");
    p.preload("/api/image/2?w=1280");

    expect(f.created.map((i) => i.src)).toEqual([
      "/api/image/1?w=1280",
      "/api/image/2?w=1280",
    ]);
  });

  it("幅が違えば別の URL として読み込む", () => {
    const f = fakeImageFactory();
    const p = createPreloader(f.make);

    p.preload("/api/image/1?w=640");
    p.preload("/api/image/1?w=1280");

    expect(f.created).toHaveLength(2);
  });

  it("上限を超えたら古いものから忘れる", () => {
    const f = fakeImageFactory();
    const p = createPreloader(f.make, 2);

    p.preload("a");
    p.preload("b");
    p.preload("c"); // ここで a を忘れる
    p.preload("a"); // 忘れているので読み直す

    expect(f.created.map((i) => i.src)).toEqual(["a", "b", "c", "a"]);
  });

  it("覚えている間は読み直さない", () => {
    const f = fakeImageFactory();
    const p = createPreloader(f.make, 3);

    p.preload("a");
    p.preload("b");
    p.preload("a");

    expect(f.created).toHaveLength(2);
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import { useViewerStore } from "./useViewerStore";

beforeEach(() => {
  localStorage.clear();
  useViewerStore.setState({
    open: false,
    order: [],
    pos: 0,
    scale: 1,
    chromeVisible: true,
    playing: false,
    intervalSec: 5,
    loop: true,
    shuffle: false,
  });
});

describe("openAt", () => {
  it("シャッフル無しなら恒等順序で、指定した位置を開く", () => {
    useViewerStore.getState().openAt(3, 10);
    const s = useViewerStore.getState();
    expect(s.open).toBe(true);
    expect(s.order).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(s.pos).toBe(3);
    expect(s.scale).toBe(1);
  });

  it("シャッフル時も、開いた画像が最初に表示される", () => {
    useViewerStore.setState({ shuffle: true });
    useViewerStore.getState().openAt(7, 20, 12345);
    const s = useViewerStore.getState();
    expect(s.order).toHaveLength(20);
    expect(new Set(s.order).size).toBe(20);
    expect(s.order[s.pos]).toBe(7);
  });

  it("空の一覧では開かない", () => {
    useViewerStore.getState().openAt(0, 0);
    expect(useViewerStore.getState().open).toBe(false);
  });
});

describe("go", () => {
  it("次へ進む", () => {
    useViewerStore.getState().openAt(0, 5);
    useViewerStore.getState().go(1);
    expect(useViewerStore.getState().pos).toBe(1);
  });

  it("前へ戻る", () => {
    useViewerStore.getState().openAt(2, 5);
    useViewerStore.getState().go(-1);
    expect(useViewerStore.getState().pos).toBe(1);
  });

  it("ループ時は末尾から先頭へ折り返す", () => {
    useViewerStore.setState({ loop: true });
    useViewerStore.getState().openAt(4, 5);
    useViewerStore.getState().go(1);
    expect(useViewerStore.getState().pos).toBe(0);
  });

  it("非ループで末尾に達したら再生を止める", () => {
    useViewerStore.setState({ loop: false });
    useViewerStore.getState().openAt(4, 5);
    useViewerStore.setState({ playing: true });
    useViewerStore.getState().go(1);
    const s = useViewerStore.getState();
    expect(s.pos).toBe(4);
    expect(s.playing).toBe(false);
  });

  it("送ると拡大は解除される", () => {
    useViewerStore.getState().openAt(0, 5);
    useViewerStore.getState().setScale(3);
    useViewerStore.getState().go(1);
    expect(useViewerStore.getState().scale).toBe(1);
  });
});

describe("syncLength", () => {
  it("件数が変わらなければ何もしない", () => {
    useViewerStore.getState().openAt(2, 5);
    const before = useViewerStore.getState().order;
    useViewerStore.getState().syncLength(5);
    expect(useViewerStore.getState().order).toBe(before);
  });

  it("件数が増えても、見ている画像を見失わない", () => {
    useViewerStore.getState().openAt(3, 5);
    expect(useViewerStore.getState().order[useViewerStore.getState().pos]).toBe(3);

    useViewerStore.getState().syncLength(200);
    const s = useViewerStore.getState();
    expect(s.order).toHaveLength(200);
    expect(s.order[s.pos]).toBe(3);
  });

  it("件数が減って見ていた画像が消えたら先頭へ寄せる", () => {
    useViewerStore.getState().openAt(8, 10);
    useViewerStore.getState().syncLength(3);
    const s = useViewerStore.getState();
    expect(s.order).toHaveLength(3);
    expect(s.pos).toBe(0);
  });

  it("0 件になったら閉じる", () => {
    useViewerStore.getState().openAt(1, 5);
    useViewerStore.getState().syncLength(0);
    expect(useViewerStore.getState().open).toBe(false);
  });

  it("シャッフル中に件数が増えても、既に見た並びは崩さず増えた分だけ末尾に足す", () => {
    useViewerStore.setState({ shuffle: true });
    useViewerStore.getState().openAt(3, 5, 1);
    const before = [...useViewerStore.getState().order];
    const posBefore = useViewerStore.getState().pos;

    useViewerStore.getState().syncLength(8);
    const s = useViewerStore.getState();

    // (a) 先頭側（既存部分）の並びは変わらない。
    expect(s.order.slice(0, 5)).toEqual(before);
    // (b) pos は動かない。
    expect(s.pos).toBe(posBefore);
    // (c) 0..newLength-1 の重複なしの全順列になっている。
    expect([...s.order].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
});

describe("スライドショー設定", () => {
  it("localStorage へ保存する", () => {
    useViewerStore.getState().setIntervalSec(30);
    useViewerStore.getState().setLoop(false);
    useViewerStore.getState().setShuffle(true, 999);

    const saved = JSON.parse(localStorage.getItem("gim.web.prefs")!);
    expect(saved.slideshow).toEqual({ intervalSec: 30, loop: false, shuffle: true });
  });

  it("シャッフルを切り替えると順序を作り直すが、見ている画像は変わらない", () => {
    useViewerStore.getState().openAt(4, 30);
    useViewerStore.getState().setShuffle(true, 42);

    const s = useViewerStore.getState();
    expect(s.order).toHaveLength(30);
    expect(s.order[s.pos]).toBe(4);
  });

  it("initPrefs で保存済みの設定を読む", () => {
    localStorage.setItem(
      "gim.web.prefs",
      JSON.stringify({ slideshow: { intervalSec: 10, loop: false, shuffle: true } }),
    );
    useViewerStore.getState().initPrefs();
    const s = useViewerStore.getState();
    expect(s.intervalSec).toBe(10);
    expect(s.loop).toBe(false);
    expect(s.shuffle).toBe(true);
  });
});

describe("close", () => {
  it("閉じると再生も止まる", () => {
    useViewerStore.getState().openAt(0, 5);
    useViewerStore.setState({ playing: true });
    useViewerStore.getState().close();
    const s = useViewerStore.getState();
    expect(s.open).toBe(false);
    expect(s.playing).toBe(false);
  });
});

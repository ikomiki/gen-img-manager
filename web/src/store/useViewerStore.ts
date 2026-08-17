import { create } from "zustand";
import { buildOrder, mulberry32, step } from "@gim/shared/playlist";
import { loadPrefs, savePrefs } from "../storage";

interface ViewerState {
  open: boolean;
  /** results 上のインデックス列。シャッフル時は並びが変わる。 */
  order: number[];
  /** order 上の位置。表示中の画像は results[order[pos]]。 */
  pos: number;
  scale: number;
  /** 上下のバーを出すか。画像をタップするたびに切り替わる。 */
  chromeVisible: boolean;
  playing: boolean;
  intervalSec: number;
  loop: boolean;
  shuffle: boolean;
  /** 検索結果全体の画像ID列（sort 順）。空なら未取得で、order は results の長さに留まる。 */
  ids: number[];
  /** ids を取った時点の useQueryStore.seq。クエリが変わったら取り直す目印。 */
  idsSeq: number | null;

  initPrefs: () => void;
  openAt: (index: number, length: number, seed?: number) => void;
  close: () => void;
  go: (delta: 1 | -1) => void;
  syncLength: (length: number) => void;
  setIds: (ids: number[], seq: number, seed?: number) => void;
  /** クエリが変わって sort 順インデックスの意味が変わったときに ids を捨てる。 */
  invalidateIds: () => void;
  setScale: (s: number) => void;
  toggleChrome: () => void;
  play: () => void;
  pause: () => void;
  setIntervalSec: (sec: number) => void;
  setLoop: (v: boolean) => void;
  setShuffle: (v: boolean, seed?: number) => void;
}

function makeOrder(length: number, shuffle: boolean, seed: number): number[] {
  return buildOrder(length, shuffle, mulberry32(seed));
}

export const useViewerStore = create<ViewerState>((set, get) => ({
  open: false,
  order: [],
  pos: 0,
  scale: 1,
  chromeVisible: true,
  playing: false,
  intervalSec: 5,
  loop: true,
  shuffle: false,
  ids: [],
  idsSeq: null,

  initPrefs: () => {
    const { slideshow } = loadPrefs();
    set({
      intervalSec: slideshow.intervalSec,
      loop: slideshow.loop,
      shuffle: slideshow.shuffle,
    });
  },

  openAt: (index, length, seed = Date.now()) => {
    if (length <= 0) return;
    const order = makeOrder(length, get().shuffle, seed);
    const pos = Math.max(0, order.indexOf(index));
    set({ open: true, order, pos, scale: 1, chromeVisible: true });
  },

  close: () => set({ open: false, playing: false, scale: 1 }),

  go: (delta) => {
    const { pos, order, loop } = get();
    const r = step(pos, order.length, loop, delta);
    // 送ったら拡大は解除する。拡大したまま次へ行くと、
    // どこを見ているのか分からない状態で切り替わる。
    set({ pos: r.pos, scale: 1 });
    if (r.stop) set({ playing: false });
  },

  syncLength: (length) => {
    const { order, pos, shuffle } = get();
    if (length === order.length) return;
    if (length <= 0) {
      set({ open: false, playing: false, order: [], pos: 0 });
      return;
    }
    if (length > order.length) {
      // 全体を作り直すと、シャッフル時はいま見ている画像が新しい並びの
      // 一様ランダムな位置へ移動し、そこから末尾まで既視の画像を反復してしまう。
      // 既存の並びは保ったまま、増えた分だけをシャッフルして末尾に足す。
      const added = buildOrder(length - order.length, shuffle, mulberry32(Date.now())).map(
        (i) => order.length + i,
      );
      set({ order: [...order, ...added] });
      return;
    }
    const current = order[pos];
    const next = makeOrder(length, shuffle, Date.now());
    const nextPos = current === undefined ? 0 : Math.max(0, next.indexOf(current));
    set({ order: next, pos: nextPos });
  },

  setIds: (ids, seq, seed = Date.now()) => {
    if (ids.length === 0) {
      // 0件は「本当に0件」か「取れなかった」。どちらでも並びは触らず、
      // results の範囲で送る従来の経路に落とす。0件での閉じ処理は syncLength が担う。
      set({ ids, idsSeq: seq });
      return;
    }
    const { order, pos, shuffle } = get();
    // 増分を末尾に足すのではなく作り直す。シャッフル時に増分追加だと
    // 「先頭200件のシャッフル → 残り全部」という偏った並びになる。
    // 作り直しても、いま見ている画像（sort順インデックス）はそのまま見せ続ける。
    const current = order[pos] ?? 0;
    const next = makeOrder(ids.length, shuffle, seed);
    set({ ids, idsSeq: seq, order: next, pos: Math.max(0, next.indexOf(current)) });
  },

  // order と pos は触らない。ここで並びを壊すと、取り直しが終わるまで
  // 表示が飛ぶ。ids を空にしておけば、その間は results の範囲で読まれる。
  invalidateIds: () => set({ ids: [], idsSeq: null }),

  setScale: (s) => set({ scale: s }),

  toggleChrome: () => set({ chromeVisible: !get().chromeVisible }),

  play: () => set({ playing: true }),

  pause: () => set({ playing: false }),

  setIntervalSec: (sec) => {
    set({ intervalSec: sec });
    const { loop, shuffle } = get();
    savePrefs({ slideshow: { intervalSec: sec, loop, shuffle } });
  },

  setLoop: (v) => {
    set({ loop: v });
    const { intervalSec, shuffle } = get();
    savePrefs({ slideshow: { intervalSec, loop: v, shuffle } });
  },

  setShuffle: (v, seed = Date.now()) => {
    const { order, pos, intervalSec, loop } = get();
    set({ shuffle: v });
    savePrefs({ slideshow: { intervalSec, loop, shuffle: v } });
    if (order.length === 0) return;
    // 並びを作り直しても、いま見ている画像はそのまま見せ続ける。
    const current = order[pos];
    const next = makeOrder(order.length, v, seed);
    set({ order: next, pos: Math.max(0, next.indexOf(current)) });
  },
}));

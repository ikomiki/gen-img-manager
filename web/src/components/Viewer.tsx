import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryStore } from "../store/useQueryStore";
import { useViewerStore } from "../store/useViewerStore";
import { imageUrl, listImageIds, listImages } from "../api/images";
import { containedLongEdge, pickWidth } from "../util/pickWidth";
import { createPreloader } from "../util/preloader";
import { createRowWindow, WINDOW_SIZE } from "../util/rowWindow";
import { useSlideshowTimer } from "../hooks/useSlideshowTimer";
import { useViewerKeys } from "../hooks/useViewerKeys";
import { buttonStyle } from "../ui";
import { ZoomableImage } from "./ZoomableImage";
import { SlideshowSheet } from "./SlideshowSheet";

/** 末尾からこの枚数以内に来たら次のページを取りにいく（全件ID が取れていないときの退避）。 */
const LOAD_MORE_MARGIN = 5;
/** 何枚先まで先読みするか。 */
const PRELOAD_AHEAD = 2;

export function Viewer() {
  const open = useViewerStore((s) => s.open);
  const order = useViewerStore((s) => s.order);
  const pos = useViewerStore((s) => s.pos);
  const ids = useViewerStore((s) => s.ids);
  const idsSeq = useViewerStore((s) => s.idsSeq);
  const setIds = useViewerStore((s) => s.setIds);
  const invalidateIds = useViewerStore((s) => s.invalidateIds);
  const chromeVisible = useViewerStore((s) => s.chromeVisible);
  const close = useViewerStore((s) => s.close);
  const go = useViewerStore((s) => s.go);
  const toggleChrome = useViewerStore((s) => s.toggleChrome);
  const syncLength = useViewerStore((s) => s.syncLength);
  const playing = useViewerStore((s) => s.playing);
  const pause = useViewerStore((s) => s.pause);

  const results = useQueryStore((s) => s.results);
  const exhausted = useQueryStore((s) => s.exhausted);
  const loadMore = useQueryStore((s) => s.loadMore);
  const seq = useQueryStore((s) => s.seq);

  const [slideshowOpen, setSlideshowOpen] = useState(false);
  const [loadedPos, setLoadedPos] = useState<number | null>(null);
  // 行キャッシュが増えたことを描画へ伝えるためだけの世代。
  const [rowsVersion, setRowsVersion] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  useViewerKeys({ enabled: open && !slideshowOpen, rootRef });
  useSlideshowTimer(loadedPos === pos);

  const preloader = useMemo(() => createPreloader(), []);

  const rowWindow = useMemo(
    () =>
      createRowWindow(
        (offset, limit) => {
          const { query, sort, dir, dirs } = useQueryStore.getState();
          return listImages({ q: query, sort, dir, dirs, limit, offset });
        },
        () => setRowsVersion((v) => v + 1),
        WINDOW_SIZE,
      ),
    [],
  );

  // クエリが変わると sort 順インデックスの意味が変わるので、行キャッシュも ids も無効。
  // ids を残したままにすると、取り直しが終わるまで古い ID で別の画像を出してしまう。
  // このフックを行取得（rowWindow.ensure）の effect より前に置くのは、同じフラッシュ内で
  // 行キャッシュを先に捨てておくことで、捨てられる世代のために /api/images を
  // 1本余分に使わずに済むため。
  useEffect(() => {
    rowWindow.clear();
    invalidateIds();
  }, [seq, rowWindow, invalidateIds]);

  // 開いたら検索結果全体のID列を取る。シャッフルを全件へ広げるのはこれが要る。
  useEffect(() => {
    if (!open || idsSeq === seq) return;
    let alive = true;
    const { query, sort, dir, dirs } = useQueryStore.getState();
    void listImageIds({ q: query, sort, dir, dirs })
      .then((list) => {
        if (alive) setIds(list, seq);
      })
      .catch(() => {
        // 取れなければ読み込み済みの範囲で送る（下の loadMore が退避経路）。
      });
    return () => {
      alive = false;
    };
  }, [open, idsSeq, seq, setIds]);

  // 同じクエリで開き直したとき、openAt が order を results の長さで作り直している。
  // ids はそのまま使えるので、取り直さずに並びだけ全件へ広げる。syncLength に
  // 広げさせないのは、増分追加だと先頭200件とそれ以降で偏った並びになるため。
  useEffect(() => {
    if (!open || idsSeq !== seq || ids.length === 0) return;
    if (order.length === ids.length) return;
    setIds(ids, seq);
  }, [open, ids, idsSeq, seq, order.length, setIds]);

  // 全件ID があればそれが再生対象。無い間は読み込み済みの範囲。
  const playlistLength = ids.length > 0 ? ids.length : results.length;
  useEffect(() => {
    syncLength(playlistLength);
  }, [playlistLength, syncLength]);

  // 全件ID が取れなかったときだけ、末尾に近づいたら次のページを取る。
  useEffect(() => {
    if (!open || exhausted || ids.length > 0) return;
    if (pos >= order.length - LOAD_MORE_MARGIN) void loadMore();
  }, [open, exhausted, ids.length, pos, order.length, loadMore]);

  const sortedIndex = order[pos];
  const row =
    sortedIndex === undefined ? undefined : (results[sortedIndex] ?? rowWindow.get(sortedIndex));
  const id = sortedIndex === undefined ? undefined : (ids[sortedIndex] ?? results[sortedIndex]?.id);

  // 表示中と先読み分の行を取りにいく。results にある位置は取りにいかない
  // （行キャッシュは results とは別なので、確認しないと同じ行を二重に取る）。
  useEffect(() => {
    if (!open) return;
    const ensure = (si: number | undefined) => {
      if (si === undefined || results[si]) return;
      rowWindow.ensure(si);
    };
    ensure(sortedIndex);
    for (let i = 1; i <= PRELOAD_AHEAD; i++) ensure(order[pos + i]);
  }, [open, sortedIndex, order, pos, results, rowWindow]);

  // 画像の先読み。表示中と同じ幅を要求しないと別のキャッシュエントリになって無駄になる。
  useEffect(() => {
    if (!open) return;
    for (let i = 1; i <= PRELOAD_AHEAD; i++) {
      const si = order[pos + i];
      if (si === undefined) continue;
      const nid = ids[si] ?? results[si]?.id;
      if (nid === undefined) continue;
      const r = results[si] ?? rowWindow.get(si);
      preloader.preload(imageUrl(nid, widthFor(r)));
    }
  }, [open, order, pos, ids, results, preloader, rowWindow, rowsVersion]);

  if (!open || id === undefined) return null;

  const src = imageUrl(id, widthFor(row));
  const filename = row?.filename ?? "";

  return (
    <div
      ref={rootRef}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 20,
        background: "var(--bg-media)",
        display: "flex",
        flexDirection: "column",
        // 画像を送るたびに文字選択が走ると、長押しで選択ハンドルが出て邪魔になる。
        userSelect: "none",
        WebkitUserSelect: "none",
      }}
    >
      {chromeVisible && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "env(safe-area-inset-top, 0px) 12px 8px",
            background: "var(--surface)",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <button type="button" aria-label="閉じる" onClick={close} style={buttonStyle}>
            閉じる
          </button>
          <span style={{ color: "var(--text-dim)", fontSize: 13 }}>
            {`${pos + 1} / ${order.length}`}
          </span>
          <span
            style={{
              flex: 1,
              color: "var(--text-dim)",
              fontSize: 13,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {filename}
          </span>
        </div>
      )}

      <ZoomableImage
        src={src}
        alt={filename}
        onTap={toggleChrome}
        onSwipe={(a) => go(a === "next" ? 1 : -1)}
        onSettled={() => setLoadedPos(pos)}
      />

      {chromeVisible && (
        <div
          style={{
            display: "flex",
            gap: 8,
            padding: "8px 12px",
            paddingBottom: "calc(8px + env(safe-area-inset-bottom, 0px))",
            background: "var(--surface)",
            borderTop: "1px solid var(--border)",
          }}
        >
          <button
            type="button"
            aria-label="前へ"
            onClick={() => go(-1)}
            style={{ ...buttonStyle, flex: 1 }}
          >
            ‹
          </button>
          <button
            type="button"
            aria-label={playing ? "停止" : "スライドショー"}
            onClick={() => (playing ? pause() : setSlideshowOpen(true))}
            style={{ ...buttonStyle, flex: 1 }}
          >
            {playing ? "■" : "▶"}
          </button>
          <button
            type="button"
            aria-label="次へ"
            onClick={() => go(1)}
            style={{ ...buttonStyle, flex: 1 }}
          >
            ›
          </button>
        </div>
      )}

      <SlideshowSheet open={slideshowOpen} onClose={() => setSlideshowOpen(false)} />
    </div>
  );
}

/**
 * 要求する w を決める。行がまだ届いていない位置では、画像の寸法が分からない。
 * プレースホルダで待たせないのは、行の取得が失敗してもスライドショーが止まらないように
 * するため。ビューポートの短辺から見積もるのは、収めた画像の長辺は必ず短辺以上になるため
 * （長辺から見積もると行到着後より大きい tier を先取りしてしまい、同じ画像を2つの URL で
 * 二重に落としたり、サーバがリサイズを諦めて原寸を返したりする）。代償として、行が
 * 結局取れなかった位置は少し粗いままになる。
 */
function widthFor(row: { width: number; height: number } | undefined): number {
  const dpr = window.devicePixelRatio || 1;
  const viewShortEdge = Math.min(window.innerWidth, window.innerHeight);
  if (!row) return pickWidth(viewShortEdge, dpr);
  return pickWidth(containedLongEdge(row.width, row.height, window.innerWidth, window.innerHeight), dpr);
}

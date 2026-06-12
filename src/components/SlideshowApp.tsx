import { useCallback, useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { getSlideshowPayload, syncSlideshowMenu } from "../api/slideshow";
import { getSetting, setSetting } from "../api/prefs";
import { setRating as setRatingApi } from "../api/images";
import { writeXmpRating } from "../api/fs";
import { buildOrder, mulberry32, step } from "../util/playlist";
import { hasPrimaryModifier, isFullscreenToggleKey } from "../util/platform";
import { SlideshowControls } from "./SlideshowControls";
import { useSlideTimer } from "../hooks/useSlideTimer";
import "../SlideshowApp.css";

export function SlideshowApp() {
  const [paths, setPaths] = useState<string[]>([]);
  const [ids, setIds] = useState<number[]>([]);
  const [order, setOrder] = useState<number[]>([]);
  const [pos, setPos] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [intervalSec, setIntervalSec] = useState(5);
  const [loop, setLoop] = useState(true);
  const [random, setRandom] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [showFilename, setShowFilename] = useState(false);
  const [showPosition, setShowPosition] = useState(false);
  const [xmpAuto, setXmpAuto] = useState(false);

  // 最新値を副作用から参照するための ref ミラー。
  const posRef = useRef(0);
  const orderRef = useRef<number[]>([]);
  const loopRef = useRef(true);
  const randomRef = useRef(false);
  const fullscreenRef = useRef(false);
  const errorsRef = useRef(0);
  const toastTimer = useRef<number | null>(null);
  const ratingBusy = useRef(false);

  useEffect(() => { posRef.current = pos; }, [pos]);
  useEffect(() => { orderRef.current = order; }, [order]);
  useEffect(() => { loopRef.current = loop; }, [loop]);
  useEffect(() => { randomRef.current = random; }, [random]);
  useEffect(() => { fullscreenRef.current = fullscreen; }, [fullscreen]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2000);
  }, []);

  // 初期化: スナップショットと設定を読み込み、再生順序を組む。
  useEffect(() => {
    void (async () => {
      const [payload, iv, lp, rnd, sf, sp, xa] = await Promise.all([
        getSlideshowPayload(),
        getSetting("slideshow_interval"),
        getSetting("slideshow_loop"),
        getSetting("slideshow_random"),
        getSetting("show_current_filename"),
        getSetting("show_current_position"),
        getSetting("xmp_auto"),
      ]);
      const sec = iv ? Math.max(1, Number(iv) || 5) : 5;
      const lpOn = lp === null ? true : lp !== "false";
      const rndOn = rnd === null ? false : rnd === "true";
      setIntervalSec(sec);
      setLoop(lpOn);
      setRandom(rndOn);
      setShowFilename(sf === "true");
      setShowPosition(sp === "true");
      setXmpAuto(xa === "true");

      const p = payload?.paths ?? [];
      const startImg = Math.min(payload?.start_index ?? 0, Math.max(p.length - 1, 0));
      const ord = buildOrder(p.length, rndOn, mulberry32(p.length + startImg + 1));
      let startPos = startImg;
      if (rndOn && p.length > 0) {
        // 開始画像を先頭に持ってくる。
        const i = ord.indexOf(startImg);
        if (i > 0) {
          ord.splice(i, 1);
          ord.unshift(startImg);
        }
        startPos = 0;
      }
      setPaths(p);
      setIds(payload?.ids ?? []);
      setOrder(ord);
      setPos(startPos);
      setReady(true);
    })();
  }, []);

  // delta 方向に進める（自動・手動共通）。
  const advance = useCallback((delta: 1 | -1) => {
    const len = orderRef.current.length;
    if (len === 0) return;
    const r = step(posRef.current, len, loopRef.current, delta);
    if (r.stop) {
      setPlaying(false);
      return;
    }
    if (r.wrapped && randomRef.current && delta === 1) {
      setOrder(buildOrder(len, true, mulberry32(Date.now())));
    }
    setPos(r.pos);
  }, []);

  // 自動再生タイマー。rAF 駆動 + keep-alive 描画でイベント処理を妨げない
  // （設計理由は useSlideTimer のコメント参照）。表示中の画像の読み込み完了
  // （onImgLoad → markLoaded）から間隔を数える。
  const onElapsed = useCallback(() => advance(1), [advance]);
  const { keepAliveRef, markLoaded } = useSlideTimer(
    ready && playing && order.length > 0,
    intervalSec * 1000,
    pos,
    onElapsed,
  );

  // 次の1枚をプリロード（デコード済みで保持）。
  useEffect(() => {
    if (order.length === 0) return;
    const peek = step(pos, order.length, loop, 1).pos;
    const nextPath = paths[order[peek]];
    if (nextPath) {
      const img = new Image();
      img.src = convertFileSrc(nextPath);
    }
  }, [pos, order, paths, loop]);

  // フルスクリーン切替。
  const toggleFullscreen = useCallback(async (on: boolean) => {
    try {
      await getCurrentWindow().setFullscreen(on);
      setFullscreen(on);
      await syncSlideshowMenu(on);
    } catch (e) {
      console.error("setFullscreen failed:", e);
    }
  }, []);

  // 現在表示中の画像にレーティングを適用（DB + XMP）。一覧へは即時反映しない。
  const applyRating = useCallback(
    async (rating: number | null) => {
      if (ratingBusy.current) return;
      const ord = orderRef.current;
      const imgIndex = ord[posRef.current];
      const id = ids[imgIndex];
      const path = paths[imgIndex];
      if (id == null) return;
      ratingBusy.current = true;
      try {
        await setRatingApi(id, rating);
        if (xmpAuto && path) {
          try {
            await writeXmpRating(path, rating);
          } catch (e) {
            console.error("XMP書き出しに失敗しました:", e);
            showToast("XMPの書き出しに失敗しました");
            return; // DB は成功済み。XMP 失敗を見せるため成功トーストで上書きしない。
          }
        }
        showToast(rating === null ? "レーティングをクリア" : `★${rating} を設定`);
      } catch (e) {
        console.error("レーティング設定に失敗しました:", e);
        showToast("レーティング設定に失敗しました");
      } finally {
        ratingBusy.current = false;
      }
    },
    [ids, paths, xmpAuto, showToast],
  );

  // キーボード操作。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isFullscreenToggleKey(e)) {
        e.preventDefault();
        void toggleFullscreen(!fullscreenRef.current);
        return;
      }
      const ae = document.activeElement;
      const typing =
        ae instanceof HTMLElement &&
        (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.isContentEditable);
      // Cmd/Ctrl 併用のキー（Cmd+C による選択テキストのコピー等）は標準動作へ委ねる。
      if (hasPrimaryModifier(e)) return;
      switch (e.key) {
        case "ArrowRight":
          e.preventDefault();
          advance(1);
          break;
        case "ArrowLeft":
          e.preventDefault();
          advance(-1);
          break;
        case " ":
          e.preventDefault();
          setPlaying((p) => !p);
          break;
        case "Escape":
          e.preventDefault();
          void getCurrentWindow().close();
          break;
        case "Home":
          e.preventDefault();
          if (orderRef.current.length > 0) setPos(0);
          break;
        case "End":
          e.preventDefault();
          if (orderRef.current.length > 0) setPos(orderRef.current.length - 1);
          break;
        case "0":
        case "1":
        case "2":
        case "3":
        case "4":
        case "5":
          if (typing) break;
          e.preventDefault();
          void applyRating(e.key === "0" ? null : Number(e.key));
          break;
        case "c":
        case "C": {
          if (typing) break;
          e.preventDefault();
          const cur = orderRef.current.length > 0 ? paths[orderRef.current[posRef.current]] : undefined;
          if (cur) {
            void navigator.clipboard
              .writeText(cur)
              .catch((err) => console.error("パスのコピーに失敗しました:", err));
            showToast("パスをコピーしました");
          }
          break;
        }
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [advance, toggleFullscreen, applyRating, paths, showToast]);

  // メニュー「表示 ▸ スライドショー」連携。
  useEffect(() => {
    const un = listen<string>("menu-action", (e) => {
      if (e.payload === "slideshow_fullscreen") void toggleFullscreen(true);
      else if (e.payload === "slideshow_windowed") void toggleFullscreen(false);
      else if (e.payload === "show_current_filename") setShowFilename((v) => !v);
      else if (e.payload === "show_current_position") setShowPosition((v) => !v);
    });
    return () => {
      un.then((f) => f());
    };
  }, [toggleFullscreen]);

  // 設定変更ハンドラ（永続化）。
  const onIntervalChange = (sec: number) => {
    setIntervalSec(sec);
    void setSetting("slideshow_interval", String(sec));
  };
  const onToggleLoop = () => {
    const next = !loop;
    setLoop(next);
    void setSetting("slideshow_loop", String(next));
  };
  const onToggleRandom = () => {
    const next = !random;
    setRandom(next);
    void setSetting("slideshow_random", String(next));
    // 現在の画像を起点に順序を組み直す。
    const curImg = orderRef.current[posRef.current] ?? 0;
    const ord = buildOrder(paths.length, next, mulberry32(Date.now()));
    if (next && paths.length > 0) {
      const i = ord.indexOf(curImg);
      if (i > 0) {
        ord.splice(i, 1);
        ord.unshift(curImg);
      }
      setOrder(ord);
      setPos(0);
    } else {
      setOrder(ord);
      setPos(curImg);
    }
  };

  // 画像読み込み失敗時は通知してスキップ（全滅なら停止）。
  const onImgError = () => {
    errorsRef.current += 1;
    showToast("画像を表示できないためスキップしました");
    if (errorsRef.current >= Math.max(order.length, 1)) {
      setPlaying(false);
      return;
    }
    advance(1);
  };
  const onImgLoad = () => {
    errorsRef.current = 0;
    markLoaded();
  };

  const currentPath = order.length > 0 ? paths[order[pos]] : undefined;

  return (
    <div className="ss-root">
      <div className="ss-stage">
        {currentPath ? (
          <img
            className="ss-img"
            src={convertFileSrc(currentPath)}
            alt=""
            onError={onImgError}
            onLoad={onImgLoad}
          />
        ) : (
          <div className="ss-empty">{ready ? "表示する画像がありません" : "読み込み中…"}</div>
        )}
      </div>
      {showFilename && currentPath && (
        <div className="ss-filename">{currentPath.split(/[\\/]/).pop()}</div>
      )}
      {showPosition && (
        <div className="ss-position">
          {order.length === 0 ? 0 : pos + 1} / {order.length}
        </div>
      )}
      {toast && <div className="ss-toast">{toast}</div>}
      <div ref={keepAliveRef} className="ss-keepalive" aria-hidden="true" />
      <SlideshowControls
        playing={playing}
        intervalSec={intervalSec}
        loop={loop}
        random={random}
        fullscreen={fullscreen}
        position={pos}
        total={order.length}
        onTogglePlay={() => setPlaying((p) => !p)}
        onIntervalChange={onIntervalChange}
        onToggleLoop={onToggleLoop}
        onToggleRandom={onToggleRandom}
        onToggleFullscreen={() => void toggleFullscreen(!fullscreen)}
        onPrev={() => advance(-1)}
        onNext={() => advance(1)}
        onClose={() => void getCurrentWindow().close()}
      />
    </div>
  );
}

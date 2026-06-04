import { useCallback, useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { getSlideshowPayload, syncSlideshowMenu } from "../api/slideshow";
import { getSetting, setSetting } from "../api/prefs";
import { buildOrder, mulberry32, step } from "../util/playlist";
import { SlideshowControls } from "./SlideshowControls";
import "../SlideshowApp.css";

export function SlideshowApp() {
  const [paths, setPaths] = useState<string[]>([]);
  const [order, setOrder] = useState<number[]>([]);
  const [pos, setPos] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [intervalSec, setIntervalSec] = useState(5);
  const [loop, setLoop] = useState(true);
  const [random, setRandom] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // 最新値を副作用から参照するための ref ミラー。
  const posRef = useRef(0);
  const orderRef = useRef<number[]>([]);
  const loopRef = useRef(true);
  const randomRef = useRef(false);
  const errorsRef = useRef(0);
  const toastTimer = useRef<number | null>(null);

  useEffect(() => { posRef.current = pos; }, [pos]);
  useEffect(() => { orderRef.current = order; }, [order]);
  useEffect(() => { loopRef.current = loop; }, [loop]);
  useEffect(() => { randomRef.current = random; }, [random]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2000);
  }, []);

  // 初期化: スナップショットと設定を読み込み、再生順序を組む。
  useEffect(() => {
    void (async () => {
      const [payload, iv, lp, rnd] = await Promise.all([
        getSlideshowPayload(),
        getSetting("slideshow_interval"),
        getSetting("slideshow_loop"),
        getSetting("slideshow_random"),
      ]);
      const sec = iv ? Math.max(1, Number(iv) || 5) : 5;
      const lpOn = lp === null ? true : lp !== "false";
      const rndOn = rnd === null ? false : rnd === "true";
      setIntervalSec(sec);
      setLoop(lpOn);
      setRandom(rndOn);

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

  // 自動再生タイマー。playing / 間隔 / 現在位置の変化で貼り直す。
  useEffect(() => {
    if (!ready || !playing || order.length === 0) return;
    const id = window.setTimeout(() => advance(1), intervalSec * 1000);
    return () => window.clearTimeout(id);
  }, [ready, playing, intervalSec, pos, order, advance]);

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

  // キーボード操作。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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
          {
            const len = orderRef.current.length;
            if (len > 0) setPos(len - 1);
          }
          break;
        case "F11":
          e.preventDefault();
          void getCurrentWindow()
            .isFullscreen()
            .then((on) => toggleFullscreen(!on))
            .catch((err) => console.error("setFullscreen failed:", err));
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [advance, toggleFullscreen]);

  // メニュー「表示 ▸ スライドショー」連携。
  useEffect(() => {
    const un = listen<string>("menu-action", (e) => {
      if (e.payload === "slideshow_fullscreen") void toggleFullscreen(true);
      else if (e.payload === "slideshow_windowed") void toggleFullscreen(false);
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
      {toast && <div className="ss-toast">{toast}</div>}
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

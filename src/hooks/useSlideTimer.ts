import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

// 保険の setTimeout を rAF 期限よりどれだけ遅らせるか。
// 通常は rAF 経路が先に発火し、rAF が止められている時だけ保険が働く。
const BACKUP_GRACE_MS = 250;

// スライドショーの自動送りタイマー。
//
// カウントは「表示中の画像の読み込み完了」（markLoaded の呼び出し）から始める。
// 読み込みが遅い画像が表示時間を削られたり、読み込み前に送られて
// スキップされたりするのを防ぐ。epoch（表示中の画像を表す値＝現在位置など）が
// 変わると読み込み待ちに戻り、次に markLoaded が呼ばれるまで始動しない。
//
// 設計原則: 「OS のイベント処理に影響を与えないこと」を最優先にする。
// - 進行判定は requestAnimationFrame（描画クロック）上で performance.now() の
//   絶対期限と比較するだけ。フレームあたりの仕事は数値比較1回と
//   keep-alive 要素のサブピクセル移動のみで、イベントループを塞がない。
// - rAF をマウント中ずっと回し、毎フレーム keep-alive 要素（不可視の 1px）を
//   動かすことで、WKWebView の描画パイプライン（display link／コンポジット／
//   UI プロセスとの IPC）を常にアクティブに保つ。これが止まると macOS が
//   プロセスをアイドル扱いし、入力イベントが次の活動（＝画像切替）まで
//   配送されない症状が出る。JS タイマー単体のハートビート（空 setInterval）
//   では防げないことを実機で確認済み。
// - rAF が止められた場合（ウィンドウ最小化・完全遮蔽など）の保険として通常の
//   setTimeout も併走させ、どちらか先に期限へ達した方が一度だけ onElapsed を
//   呼ぶ（重複発火は期限 ref の null クリアで防ぐ）。
//
// 返り値: keepAliveRef はスライドショー画面に配置する keep-alive 要素へ、
// markLoaded は表示中の画像の onLoad へ繋ぐ。
export function useSlideTimer(
  active: boolean,
  delayMs: number,
  epoch: number,
  onElapsed: () => void,
): { keepAliveRef: RefObject<HTMLDivElement | null>; markLoaded: () => void } {
  const keepAliveRef = useRef<HTMLDivElement | null>(null);

  // コールバック識別子の変化でタイマーを張り直さないよう ref 経由で参照。
  const onElapsedRef = useRef(onElapsed);
  useEffect(() => {
    onElapsedRef.current = onElapsed;
  }, [onElapsed]);

  // どの画像（epoch 値）まで読み込み完了したか。null は未読み込み。
  const [loadedFor, setLoadedFor] = useState<number | null>(null);
  const markLoaded = useCallback(() => setLoadedFor(epoch), [epoch]);

  // 発火期限（performance.now() 基準の絶対時刻）。null は「期限なし／発火済み」。
  const deadlineRef = useRef<number | null>(null);

  // 期限の設定と保険タイマー。表示中の画像が読み込み完了済みのときだけ数える。
  useEffect(() => {
    if (!active || loadedFor !== epoch) {
      deadlineRef.current = null;
      return;
    }
    deadlineRef.current = performance.now() + delayMs;
    const id = window.setTimeout(() => {
      if (deadlineRef.current === null) return;
      deadlineRef.current = null;
      onElapsedRef.current();
    }, delayMs + BACKUP_GRACE_MS);
    return () => {
      deadlineRef.current = null;
      window.clearTimeout(id);
    };
  }, [active, delayMs, epoch, loadedFor]);

  // 常時 rAF ループ（再生状態に依らずマウント中ずっと回す。
  // 一時停止中の解除操作も即応させるため）。
  useEffect(() => {
    let raf = 0;
    let flip = false;
    let lastFrame = performance.now();
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      // keep-alive: 不可視レイヤーをサブピクセル移動して描画活動を継続させる。
      const el = keepAliveRef.current;
      if (el) {
        flip = !flip;
        el.style.transform = flip ? "translateY(0.25px)" : "translateY(0)";
      }
      // 診断: 描画ループが長く止まっていたら開発者コンソールへ記録する。
      // 症状再発時に「rAF ごと止められている」か切り分ける手掛かりになる。
      if (import.meta.env.DEV && now - lastFrame > 1000) {
        console.warn(
          `[slideshow] 描画ループが ${Math.round(now - lastFrame)}ms 停止していました`,
        );
      }
      lastFrame = now;
      if (deadlineRef.current !== null && now >= deadlineRef.current) {
        deadlineRef.current = null;
        onElapsedRef.current();
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return { keepAliveRef, markLoaded };
}

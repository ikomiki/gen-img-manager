import { useEffect, useRef, useState } from "react";
import { distance, isTap, pinchScale, swipeAction, type SwipeAction } from "../util/gesture";
import { useViewerStore } from "../store/useViewerStore";

interface Props {
  src: string;
  alt: string;
  /** 拡大していないときの1本指の短い操作。 */
  onTap: () => void;
  /** 拡大していないときの1本指の横方向の払い。 */
  onSwipe: (action: Exclude<SwipeAction, "none">) => void;
  /** 画像の読み込みが終わった。スライドショーの計時開始に使う。 */
  onLoaded?: () => void;
}

interface Point {
  x: number;
  y: number;
}

export function ZoomableImage({ src, alt, onTap, onSwipe, onLoaded }: Props) {
  const scale = useViewerStore((s) => s.scale);
  const setScale = useViewerStore((s) => s.setScale);

  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });

  // 押されている指。pointerId をキーに現在位置を持つ。
  const pointers = useRef(new Map<number, Point>());
  const startAt = useRef(0);
  const startPoint = useRef<Point>({ x: 0, y: 0 });
  const startOffset = useRef<Point>({ x: 0, y: 0 });
  const pinchStart = useRef<{ dist: number; scale: number } | null>(null);
  // このジェスチャ中に2本指になった（ピンチした）かどうか。最後の1本を離した瞬間に
  // タップ・スワイプとして拾わないようにする判定に使う。
  const hadPinch = useRef(false);

  // 拡大を解いたのに画像が画面外にいる状態を作らない。
  useEffect(() => {
    if (scale === 1) setOffset({ x: 0, y: 0 });
  }, [scale]);

  // 別の画像に切り替わったら位置を戻す。
  useEffect(() => {
    setOffset({ x: 0, y: 0 });
  }, [src]);

  const twoPoints = (): [Point, Point] | null => {
    const pts = [...pointers.current.values()];
    return pts.length >= 2 ? [pts[0], pts[1]] : null;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    const pair = twoPoints();
    if (pair) {
      hadPinch.current = true;
      pinchStart.current = {
        dist: distance(pair[0].x, pair[0].y, pair[1].x, pair[1].y),
        scale,
      };
      return;
    }
    startAt.current = performance.now();
    startPoint.current = { x: e.clientX, y: e.clientY };
    startOffset.current = offset;
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    const pair = twoPoints();
    if (pair && pinchStart.current) {
      const d = distance(pair[0].x, pair[0].y, pair[1].x, pair[1].y);
      setScale(pinchScale(pinchStart.current.dist, d, pinchStart.current.scale));
      return;
    }
    // 拡大中の1本指はパン。拡大していないときは指を離すまで判断を保留する。
    if (scale > 1 && pointers.current.size === 1) {
      setOffset({
        x: startOffset.current.x + (e.clientX - startPoint.current.x),
        y: startOffset.current.y + (e.clientY - startPoint.current.y),
      });
    }
  };

  const endPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    const wasPinching = pointers.current.size >= 2;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchStart.current = null;

    if (wasPinching) {
      // 2本指のどちらかが離れて1本指になった。残った指の「今の位置」を新しい起点にし直さないと、
      // ピンチ中に動いた分だけパンの位置が飛ぶ（起点が2本指になる前の値のまま残ってしまうため）。
      const remaining = [...pointers.current.values()][0];
      if (remaining) {
        startAt.current = performance.now();
        startPoint.current = remaining;
        startOffset.current = offset;
      }
      return;
    }

    const pinchedThisGesture = hadPinch.current;
    hadPinch.current = false;

    if (scale > 1) return; // パンの終わり。送りもタップも起こさない。
    // ピンチで縮めて戻しただけの操作が、最後の1本を離した瞬間に送り・タップとして拾われないようにする。
    if (pinchedThisGesture) return;

    const dx = e.clientX - startPoint.current.x;
    const dy = e.clientY - startPoint.current.y;
    const dt = performance.now() - startAt.current;

    const action = swipeAction(dx, dy, dt);
    if (action !== "none") {
      onSwipe(action);
      return;
    }
    if (isTap(dx, dy, dt)) onTap();
  };

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
      style={{
        flex: 1,
        minHeight: 0,
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        // ブラウザ自身のパン・ズームを止めて、こちらの判定に一本化する。
        touchAction: "none",
      }}
    >
      <img
        src={src}
        alt={alt}
        decoding="async"
        onLoad={onLoaded}
        draggable={false}
        style={{
          maxWidth: "100%",
          maxHeight: "100%",
          objectFit: "contain",
          display: "block",
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
          // 拡大中に補間で滑らせると指の動きから遅れて気持ち悪い。
          transition: "none",
        }}
      />
    </div>
  );
}

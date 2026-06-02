interface Props {
  playing: boolean;
  intervalSec: number;
  loop: boolean;
  random: boolean;
  fullscreen: boolean;
  position: number;
  total: number;
  onTogglePlay: () => void;
  onIntervalChange: (sec: number) => void;
  onToggleLoop: () => void;
  onToggleRandom: () => void;
  onToggleFullscreen: () => void;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
}

export function SlideshowControls(props: Props) {
  return (
    <div className="ss-controls">
      <button onClick={props.onClose} aria-label="閉じる">
        ✕
      </button>
      <button onClick={props.onPrev} aria-label="前へ">
        ‹
      </button>
      <button onClick={props.onTogglePlay} aria-label={props.playing ? "一時停止" : "再生"}>
        {props.playing ? "⏸" : "▶"}
      </button>
      <button onClick={props.onNext} aria-label="次へ">
        ›
      </button>
      <span className="ss-pos">
        {props.total === 0 ? 0 : props.position + 1} / {props.total}
      </span>
      <label className="ss-field">
        間隔
        <input
          type="number"
          min={1}
          max={600}
          value={props.intervalSec}
          onChange={(e) => props.onIntervalChange(Math.max(1, Number(e.target.value) || 1))}
          aria-label="表示間隔（秒）"
        />
        秒
      </label>
      <label className="ss-field">
        <input type="checkbox" checked={props.loop} onChange={props.onToggleLoop} />
        ループ
      </label>
      <label className="ss-field">
        <input type="checkbox" checked={props.random} onChange={props.onToggleRandom} />
        ランダム
      </label>
      <button onClick={props.onToggleFullscreen} aria-pressed={props.fullscreen}>
        {props.fullscreen ? "ウィンドウ" : "全画面"}
      </button>
    </div>
  );
}

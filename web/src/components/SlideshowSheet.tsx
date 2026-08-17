import { useViewerStore } from "../store/useViewerStore";
import { INTERVAL_CHOICES } from "../storage";
import { Sheet } from "./Sheet";
import { buttonStyle } from "../ui";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function SlideshowSheet({ open, onClose }: Props) {
  const intervalSec = useViewerStore((s) => s.intervalSec);
  const loop = useViewerStore((s) => s.loop);
  const shuffle = useViewerStore((s) => s.shuffle);
  const setIntervalSec = useViewerStore((s) => s.setIntervalSec);
  const setLoop = useViewerStore((s) => s.setLoop);
  const setShuffle = useViewerStore((s) => s.setShuffle);
  const play = useViewerStore((s) => s.play);
  const toggleChrome = useViewerStore((s) => s.toggleChrome);
  const chromeVisible = useViewerStore((s) => s.chromeVisible);

  const start = () => {
    play();
    // 再生中は画面いっぱいで見たいのでバーを畳む。タップで戻せる。
    if (chromeVisible) toggleChrome();
    onClose();
  };

  return (
    <Sheet open={open} title="スライドショー" onClose={onClose}>
      <div style={{ fontSize: 13, color: "var(--text-dim)", marginBottom: 6 }}>間隔</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
        {INTERVAL_CHOICES.map((sec) => (
          <label key={sec} style={chipStyle(intervalSec === sec)}>
            <input
              aria-label={`${sec}秒`}
              type="radio"
              name="slideshow-interval"
              checked={intervalSec === sec}
              onChange={() => setIntervalSec(sec)}
              style={{ marginRight: 6 }}
            />
            {sec}秒
          </label>
        ))}
      </div>

      <label style={{ ...rowStyle }}>
        <input
          aria-label="繰り返す"
          type="checkbox"
          checked={loop}
          onChange={() => setLoop(!loop)}
        />
        <span>繰り返す</span>
      </label>

      <label style={{ ...rowStyle }}>
        <input
          aria-label="順番をシャッフル"
          type="checkbox"
          checked={shuffle}
          onChange={() => setShuffle(!shuffle)}
        />
        <span>順番をシャッフル</span>
      </label>

      <button
        type="button"
        onClick={start}
        style={{ ...buttonStyle, width: "100%", marginTop: 20, background: "var(--accent)" }}
      >
        再生
      </button>
    </Sheet>
  );
}

const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  minHeight: "var(--tap)",
  cursor: "pointer",
};

function chipStyle(active: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    minHeight: "var(--tap)",
    padding: "0 12px",
    background: active ? "var(--accent)" : "var(--surface-raised)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    cursor: "pointer",
  };
}

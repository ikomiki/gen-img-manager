import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useLibraryStore } from "./store/useLibraryStore";
import { useQueryStore } from "./store/useQueryStore";
import { useViewerStore } from "./store/useViewerStore";
import { DirectoryPanel } from "./components/DirectoryPanel";
import { FilterBar } from "./components/FilterBar";
import { ImageGridPanel } from "./components/ImageGridPanel";
import { ImageViewer } from "./components/ImageViewer";
import type { ZoomMode } from "./types";
import "./App.css";

function App() {
  const loadDirectories = useLibraryStore((s) => s.loadDirectories);
  const loadSettings = useQueryStore((s) => s.loadSettings);
  const loadHistory = useQueryStore((s) => s.loadHistory);
  const runQuery = useQueryStore((s) => s.runQuery);
  const showFilename = useQueryStore((s) => s.showFilename);
  const toggleShowFilename = useQueryStore((s) => s.toggleShowFilename);
  const setZoomMode = useViewerStore((s) => s.setZoomMode);
  const loadZoom = useViewerStore((s) => s.loadZoom);

  const [dirWidth, setDirWidth] = useState(220);

  // ディレクトリパネルの幅をドラッグでリサイズする。
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = dirWidth;
    const onMove = (ev: MouseEvent) => {
      setDirWidth(Math.min(500, Math.max(120, startW + ev.clientX - startX)));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  useEffect(() => {
    void (async () => {
      await loadDirectories();
      await loadSettings();
      await loadZoom();
      await loadHistory();
      await runQuery();
    })();
  }, [loadDirectories, loadSettings, loadZoom, loadHistory, runQuery]);

  useEffect(() => {
    const un = listen<string>("menu-action", (e) => {
      const id = e.payload;
      if (id === "toggle_filename") {
        void toggleShowFilename();
      } else if (id.startsWith("zoom_")) {
        const mode = id.replace("zoom_", "") as ZoomMode;
        setZoomMode(mode);
      }
    });
    return () => {
      un.then((f) => f());
    };
  }, [toggleShowFilename, setZoomMode]);

  return (
    <div
      className="app-shell"
      style={{ gridTemplateColumns: `${dirWidth}px 5px 1fr` }}
    >
      <header className="filter-bar-slot">
        <FilterBar />
        <button
          className="filename-toggle"
          onClick={() => void toggleShowFilename()}
          aria-pressed={showFilename}
        >
          ファイル名{showFilename ? "：表示" : "：非表示"}
        </button>
      </header>
      <DirectoryPanel />
      <div
        className="dir-resizer"
        onMouseDown={startResize}
        role="separator"
        aria-orientation="vertical"
        aria-label="ディレクトリ幅を変更"
      />
      <main className="image-grid-slot">
        <ImageGridPanel />
      </main>
      <ImageViewer />
    </div>
  );
}

export default App;

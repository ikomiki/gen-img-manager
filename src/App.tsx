import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useLibraryStore } from "./store/useLibraryStore";
import { useQueryStore } from "./store/useQueryStore";
import { useViewerStore } from "./store/useViewerStore";
import { DirectoryPanel } from "./components/DirectoryPanel";
import { FilterBar } from "./components/FilterBar";
import { ImageGridPanel } from "./components/ImageGridPanel";
import { ImageViewer } from "./components/ImageViewer";
import { HelpOverlay } from "./components/HelpOverlay";
import { Toast } from "./components/Toast";
import { AnalysisView } from "./components/AnalysisView";
import { useAnalysisStore } from "./store/useAnalysisStore";
import type { ZoomMode } from "./types";
import "./App.css";

function App() {
  const loadDirectories = useLibraryStore((s) => s.loadDirectories);
  const loadSettings = useQueryStore((s) => s.loadSettings);
  const loadHistory = useQueryStore((s) => s.loadHistory);
  const runQuery = useQueryStore((s) => s.runQuery);
  const toggleShowFilename = useQueryStore((s) => s.toggleShowFilename);
  const toggleRatingMode = useQueryStore((s) => s.toggleRatingMode);
  const toggleUnratedOnly = useQueryStore((s) => s.toggleUnratedOnly);
  const toggleXmpAutoExport = useQueryStore((s) => s.toggleXmpAutoExport);
  const toggleShowCurrentFilename = useQueryStore((s) => s.toggleShowCurrentFilename);
  const toggleShowCurrentPosition = useQueryStore((s) => s.toggleShowCurrentPosition);
  const toggleShowCurrentRating = useQueryStore((s) => s.toggleShowCurrentRating);
  const dirCollapsed = useQueryStore((s) => s.dirCollapsed);
  const toggleDirCollapsed = useQueryStore((s) => s.toggleDirCollapsed);
  const helpOpen = useQueryStore((s) => s.helpOpen);
  const toggleHelp = useQueryStore((s) => s.toggleHelp);
  const closeHelp = useQueryStore((s) => s.closeHelp);
  const setZoomMode = useViewerStore((s) => s.setZoomMode);
  const loadZoom = useViewerStore((s) => s.loadZoom);
  const viewerOpen = useViewerStore((s) => s.isOpen);
  const analysisOpen = useAnalysisStore((s) => s.open);

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
      } else if (id === "rating_mode") {
        void toggleRatingMode();
      } else if (id === "unrated_only") {
        void toggleUnratedOnly();
      } else if (id === "xmp_auto") {
        void toggleXmpAutoExport();
      } else if (id === "show_current_filename") {
        void toggleShowCurrentFilename();
      } else if (id === "show_current_position") {
        void toggleShowCurrentPosition();
      } else if (id === "show_current_rating") {
        void toggleShowCurrentRating();
      } else if (id === "open_analysis") {
        useAnalysisStore.getState().toggleOpen();
      } else if (id.startsWith("zoom_")) {
        const mode = id.replace("zoom_", "") as ZoomMode;
        setZoomMode(mode);
      }
    });
    return () => {
      un.then((f) => f());
    };
  }, [toggleShowFilename, setZoomMode, toggleRatingMode, toggleUnratedOnly, toggleXmpAutoExport, toggleShowCurrentFilename, toggleShowCurrentPosition, toggleShowCurrentRating]);

  // グローバルキー: B で左パネル折りたたみ、? でヘルプ、Esc でヘルプを閉じる。
  // ビューア表示中は B/? を無効化する（ImageGridPanel と同様）。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (helpOpen && e.key === "Escape") {
        e.preventDefault();
        closeHelp();
        return;
      }
      if (viewerOpen) return;
      const ae = document.activeElement;
      const typing =
        ae instanceof HTMLElement &&
        (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.isContentEditable);
      if (typing) return;
      if (e.key === "b" || e.key === "B") {
        e.preventDefault();
        void toggleDirCollapsed();
      } else if (e.key === "?") {
        e.preventDefault();
        toggleHelp();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [helpOpen, viewerOpen, toggleDirCollapsed, toggleHelp, closeHelp]);

  return (
    <div
      className="app-shell"
      style={{
        gridTemplateColumns: dirCollapsed ? "0px 0px 1fr" : `${dirWidth}px 5px 1fr`,
      }}
    >
      <header className="filter-bar-slot">
        <FilterBar />
      </header>
      {!dirCollapsed && <DirectoryPanel />}
      {!dirCollapsed && (
        <div
          className="dir-resizer"
          onMouseDown={startResize}
          role="separator"
          aria-orientation="vertical"
          aria-label="ディレクトリ幅を変更"
        />
      )}
      <main className="image-grid-slot">
        {analysisOpen ? <AnalysisView /> : <ImageGridPanel />}
      </main>
      <ImageViewer />
      <Toast />
      {helpOpen && <HelpOverlay onClose={closeHelp} />}
    </div>
  );
}

export default App;

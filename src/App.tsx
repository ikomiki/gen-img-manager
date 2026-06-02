import { useEffect } from "react";
import { useLibraryStore } from "./store/useLibraryStore";
import { useQueryStore } from "./store/useQueryStore";
import { DirectoryPanel } from "./components/DirectoryPanel";
import { FilterBar } from "./components/FilterBar";
import { ImageGridPanel } from "./components/ImageGridPanel";
import "./App.css";

function App() {
  const loadDirectories = useLibraryStore((s) => s.loadDirectories);
  const loadSettings = useQueryStore((s) => s.loadSettings);
  const loadHistory = useQueryStore((s) => s.loadHistory);
  const runQuery = useQueryStore((s) => s.runQuery);
  const showFilename = useQueryStore((s) => s.showFilename);
  const toggleShowFilename = useQueryStore((s) => s.toggleShowFilename);

  useEffect(() => {
    void (async () => {
      await loadDirectories();
      await loadSettings();
      await loadHistory();
      await runQuery();
    })();
  }, [loadDirectories, loadSettings, loadHistory, runQuery]);

  return (
    <div className="app-shell">
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
      <main className="image-grid-slot">
        <ImageGridPanel />
      </main>
    </div>
  );
}

export default App;

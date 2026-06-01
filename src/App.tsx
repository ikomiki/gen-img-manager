import { useEffect } from "react";
import { useLibraryStore } from "./store/useLibraryStore";
import { DirectoryPanel } from "./components/DirectoryPanel";
import { FilterBar } from "./components/FilterBar";
import { ImageGridPanel } from "./components/ImageGridPanel";
import "./App.css";

function App() {
  const loadDirectories = useLibraryStore((s) => s.loadDirectories);

  useEffect(() => {
    loadDirectories();
  }, [loadDirectories]);

  return (
    <div className="app-shell">
      <header className="filter-bar-slot">
        <FilterBar />
      </header>
      <DirectoryPanel />
      <main className="image-grid-slot">
        <ImageGridPanel />
      </main>
    </div>
  );
}

export default App;

import { useEffect, useState } from "react";
import { useQueryStore } from "./store/useQueryStore";
import { ImageGrid } from "./components/ImageGrid";
import { FilterBar } from "./components/FilterBar";
import { FilterSheet } from "./components/FilterSheet";
import { DirectorySheet } from "./components/DirectorySheet";
import { Viewer } from "./components/Viewer";
import { useViewerStore } from "./store/useViewerStore";

export function App() {
  const init = useQueryStore((s) => s.init);
  const initViewerPrefs = useViewerStore((s) => s.initPrefs);
  const [filterOpen, setFilterOpen] = useState(false);
  const [directoriesOpen, setDirectoriesOpen] = useState(false);

  useEffect(() => {
    initViewerPrefs();
    void init();
  }, [init, initViewerPrefs]);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <FilterBar onOpenFilter={() => setFilterOpen(true)} onOpenDirectories={() => setDirectoriesOpen(true)} />
      <ImageGrid />
      <FilterSheet open={filterOpen} onClose={() => setFilterOpen(false)} />
      <DirectorySheet open={directoriesOpen} onClose={() => setDirectoriesOpen(false)} />
      <Viewer />
    </div>
  );
}

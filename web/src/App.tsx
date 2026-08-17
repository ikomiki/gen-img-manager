import { useEffect, useState } from "react";
import { useQueryStore } from "./store/useQueryStore";
import { ImageGrid } from "./components/ImageGrid";
import { FilterBar } from "./components/FilterBar";
import { FilterSheet } from "./components/FilterSheet";
import { DirectorySheet } from "./components/DirectorySheet";

export function App() {
  const init = useQueryStore((s) => s.init);
  const [filterOpen, setFilterOpen] = useState(false);
  const [directoriesOpen, setDirectoriesOpen] = useState(false);

  useEffect(() => {
    void init();
  }, [init]);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <FilterBar onOpenFilter={() => setFilterOpen(true)} onOpenDirectories={() => setDirectoriesOpen(true)} />
      <ImageGrid />
      <FilterSheet open={filterOpen} onClose={() => setFilterOpen(false)} />
      <DirectorySheet open={directoriesOpen} onClose={() => setDirectoriesOpen(false)} />
    </div>
  );
}

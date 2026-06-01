import { open } from "@tauri-apps/plugin-dialog";
import { useLibraryStore } from "../store/useLibraryStore";

export function DirectoryPanel() {
  const directories = useLibraryStore((s) => s.directories);
  const addDirectory = useLibraryStore((s) => s.addDirectory);
  const removeDirectory = useLibraryStore((s) => s.removeDirectory);

  const handleAdd = async () => {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (typeof selected === "string") {
        await addDirectory(selected, true);
      }
    } catch (e) {
      console.error("ディレクトリの追加に失敗しました:", e);
    }
  };

  const handleRemove = async (id: number) => {
    try {
      await removeDirectory(id);
    } catch (e) {
      console.error("ディレクトリの削除に失敗しました:", e);
    }
  };

  return (
    <aside className="directory-panel">
      <div className="panel-header">
        <h2>ディレクトリ</h2>
        <button onClick={handleAdd}>＋ 追加</button>
      </div>
      <ul className="directory-list">
        {directories.map((d) => (
          <li key={d.id} className="directory-item">
            <span className="dir-label" title={d.path}>
              {d.label}
            </span>
            {!d.is_online && <span className="offline-badge">⦿offline</span>}
            <button className="remove-btn" onClick={() => handleRemove(d.id)}>
              ×
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}

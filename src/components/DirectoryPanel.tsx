import { useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { useLibraryStore } from "../store/useLibraryStore";
import type { ScanProgress, ScanDone } from "../types";
import * as scanApi from "../api/scan";

export function DirectoryPanel() {
  const directories = useLibraryStore((s) => s.directories);
  const addDirectory = useLibraryStore((s) => s.addDirectory);
  const removeDirectory = useLibraryStore((s) => s.removeDirectory);
  const scanning = useLibraryStore((s) => s.scanning);
  const imageCounts = useLibraryStore((s) => s.imageCounts);
  const setScanProgress = useLibraryStore((s) => s.setScanProgress);
  const clearScanProgress = useLibraryStore((s) => s.clearScanProgress);
  const setImageCount = useLibraryStore((s) => s.setImageCount);

  // バックエンドの進捗/完了イベントを購読。
  useEffect(() => {
    const unlistenProgress = listen<ScanProgress>("scan-progress", (e) => {
      setScanProgress(e.payload);
    });
    const unlistenDone = listen<ScanDone>("scan-done", async (e) => {
      const { directory_id: id, success } = e.payload;
      clearScanProgress(id);
      if (!success) {
        console.error("スキャンに失敗しました（directory_id):", id);
      }
      try {
        setImageCount(id, await scanApi.countImages(id));
      } catch (err) {
        console.error("count_images failed:", err);
      }
    });
    return () => {
      unlistenProgress.then((f) => f());
      unlistenDone.then((f) => f());
    };
  }, [setScanProgress, clearScanProgress, setImageCount]);

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

  const handleScan = async (id: number) => {
    try {
      await scanApi.scanDirectory(id);
    } catch (e) {
      console.error("スキャンの開始に失敗しました:", e);
    }
  };

  const handleScanAll = async () => {
    try {
      await scanApi.scanAll();
    } catch (e) {
      console.error("全スキャンの開始に失敗しました:", e);
    }
  };

  return (
    <aside className="directory-panel">
      <div className="panel-header">
        <h2>ディレクトリ</h2>
        <button onClick={handleAdd}>＋ 追加</button>
      </div>
      <button className="scan-all-btn" onClick={handleScanAll}>
        全スキャン
      </button>
      <ul className="directory-list">
        {directories.map((d) => {
          const prog = scanning[d.id];
          return (
            <li key={d.id} className="directory-item">
              <span className="dir-label" title={d.path}>
                {d.label}
              </span>
              {!d.is_online && <span className="offline-badge">⦿offline</span>}
              {prog ? (
                <span className="scan-progress">
                  {prog.processed}/{prog.total}
                </span>
              ) : (
                <span className="image-count">{imageCounts[d.id] ?? ""}</span>
              )}
              <button className="scan-btn" onClick={() => handleScan(d.id)}>
                ⟳
              </button>
              <button className="remove-btn" onClick={() => handleRemove(d.id)}>
                ×
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

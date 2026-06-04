import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { useLibraryStore } from "../store/useLibraryStore";
import { useQueryStore } from "../store/useQueryStore";
import type { ScanProgress, ScanDone, Directory } from "../types";
import { ConfirmDialog } from "./ConfirmDialog";
import * as scanApi from "../api/scan";
import { dirStatusLine } from "../util/dirStatus";

function EyeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

export function DirectoryPanel() {
  const directories = useLibraryStore((s) => s.directories);
  const addDirectory = useLibraryStore((s) => s.addDirectory);
  const removeDirectory = useLibraryStore((s) => s.removeDirectory);
  const scanning = useLibraryStore((s) => s.scanning);
  const setScanProgress = useLibraryStore((s) => s.setScanProgress);
  const clearScanProgress = useLibraryStore((s) => s.clearScanProgress);
  const loadDirectories = useLibraryStore((s) => s.loadDirectories);
  const setDirectoryVisible = useLibraryStore((s) => s.setDirectoryVisible);
  const runQuery = useQueryStore((s) => s.runQuery);

  const [pendingDelete, setPendingDelete] = useState<Directory | null>(null);
  const [deleting, setDeleting] = useState(false);

  // バックエンドの進捗/完了イベントを購読。
  useEffect(() => {
    const unlistenProgress = listen<ScanProgress>("scan-progress", (e) => {
      setScanProgress(e.payload);
    });
    const unlistenDone = listen<ScanDone>("scan-done", async (e) => {
      const { directory_id: id, success } = e.payload;
      clearScanProgress(id);
      if (!success) {
        console.error("スキャンに失敗しました（directory_id）:", id);
      }
      // 件数・last_scanned_at・is_online を一括で最新化する。
      try {
        await loadDirectories();
      } catch (err) {
        console.error("loadDirectories failed:", err);
      }
      // スキャン完了で新しい画像が入った可能性があるため一覧も更新。
      void runQuery();
    });
    return () => {
      unlistenProgress.then((f) => f());
      unlistenDone.then((f) => f());
    };
  }, [setScanProgress, clearScanProgress, loadDirectories, runQuery]);

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

  const handleRemove = (d: Directory) => {
    setPendingDelete(d);
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await removeDirectory(pendingDelete.id);
      setPendingDelete(null);
    } catch (e) {
      console.error("ディレクトリの削除に失敗しました:", e);
    } finally {
      setDeleting(false);
    }
  };

  const handleScan = async (id: number) => {
    // ボタン押下と同時に「スキャン中」を表示する（最初の進捗イベントを待たない）。
    setScanProgress({ directory_id: id, processed: 0, total: 0, current: "" });
    try {
      await scanApi.scanDirectory(id);
    } catch (e) {
      console.error("スキャンの開始に失敗しました:", e);
      clearScanProgress(id);
    }
  };

  const handleScanAll = async () => {
    // 全ディレクトリを即「スキャン中」にする（バックエンドは順次処理）。
    for (const d of directories) {
      setScanProgress({ directory_id: d.id, processed: 0, total: 0, current: "" });
    }
    try {
      await scanApi.scanAll();
    } catch (e) {
      console.error("全スキャンの開始に失敗しました:", e);
      for (const d of directories) {
        clearScanProgress(d.id);
      }
    }
  };

  const handleToggleVisible = async (id: number, current: boolean) => {
    try {
      await setDirectoryVisible(id, !current);
      void runQuery();
    } catch (e) {
      console.error("表示切り替えに失敗しました:", e);
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
          const status = dirStatusLine({
            scanning: prog ? { processed: prog.processed, total: prog.total } : undefined,
            isOnline: d.is_online,
            count: d.image_count,
            lastScannedAt: d.last_scanned_at,
          });
          return (
            <li key={d.id} className={`directory-item${d.visible ? "" : " hidden-dir"}`}>
              <button
                className="eye-btn"
                onClick={() => handleToggleVisible(d.id, d.visible)}
                aria-pressed={d.visible}
                aria-label={d.visible ? "表示中（クリックで非表示にする）" : "非表示中（クリックで表示する）"}
                title={d.visible ? "表示中（クリックで非表示にする）" : "非表示中（クリックで表示する）"}
              >
                {d.visible ? <EyeIcon /> : <EyeOffIcon />}
              </button>
              <div className="dir-main">
                <div className="dir-row1">
                  <span className="dir-label" title={d.path}>
                    {d.label}
                  </span>
                  <button className="scan-btn" aria-label="スキャン" onClick={() => handleScan(d.id)}>
                    ⟳
                  </button>
                  <button className="remove-btn" aria-label="削除" onClick={() => handleRemove(d)}>
                    ×
                  </button>
                </div>
                <div className="dir-row2">{status}</div>
              </div>
            </li>
          );
        })}
      </ul>
      {pendingDelete && (
        <ConfirmDialog
          title="ディレクトリを削除しますか?"
          confirmLabel="削除する"
          busy={deleting}
          onConfirm={() => void confirmDelete()}
          onCancel={() => setPendingDelete(null)}
          body={
            <>
              <p>
                <code>{pendingDelete.label}</code>（{pendingDelete.path}）をライブラリから削除します。
              </p>
              <p>
                このディレクトリの画像メタデータ・サムネイルがデータベースから削除されます。
                <strong>ディスク上の元画像ファイルは削除されません。</strong>
              </p>
            </>
          }
        />
      )}
    </aside>
  );
}

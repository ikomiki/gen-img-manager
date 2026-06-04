# キーボードショートカット拡張 PhaseA 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 既存機能への新しいキーボードショートカット（Z/Home/End/PageUp/PageDown/I/F11/B/?）を追加し、画像ファイラーとしての操作性を底上げする（バックエンド変更を伴わない範囲）。

**Architecture:** 純粋なロジック（ズームモード循環・インデックス移動）を `src/util/` のテスト可能な小関数へ切り出し、各コンポーネントの `keydown` ハンドラと Zustand ストアから呼び出す。UI トグル状態（左パネル折りたたみ・ヘルプ表示）は既存の `useQueryStore` に追加し、`showFilename` と同じ永続化パターンを踏襲する。Tauri ウィンドウ API を使うフルスクリーンのみ副作用としてコンポーネント側に置く。

**Tech Stack:** React 19 / TypeScript / Zustand / Vitest / Tauri 2（`@tauri-apps/api/window`）

---

## 対象範囲（PhaseA のみ）

| キー | 動作 | 対象画面 |
|------|------|----------|
| `Z` | ズームモード循環 fit→actual→fill | ImageViewer（1/2/3 を置換） |
| `Home` / `End` | 先頭 / 末尾の画像 | ImageViewer・ImageGridPanel・SlideshowApp |
| `PageUp` / `PageDown` | ページ単位の選択移動 | ImageGridPanel |
| `I` | 情報パネル開閉 | ImageViewer |
| `F11` | フルスクリーン切替 | ImageViewer・SlideshowApp |
| `B` | 左 DirectoryPanel 折りたたみ | メイン画面（グローバル） |
| `?` | ヘルプオーバーレイ | メイン画面（グローバル） |

PhaseB（削除・レーティング・お気に入り・コピー＝バックエンド要）は本計画には含めない。

## 既存実装の前提（破壊しないこと）

- `ImageViewer.tsx` の `keydown`（72-119行）: `Escape`/`Enter`/`Arrow`/`Space`/`+`/`-` は維持。`1`/`2`/`3`（104-112行）を **削除して Z に置換**する。
- `ImageGridPanel.tsx` の `keydown`（63-102行）: 矢印・Enter は維持。
- `SlideshowApp.tsx` の `keydown`（123-148行）: 既存 4 キーは維持。`toggleFullscreen`（112-120行）を再利用する。
- `App.tsx`: `dirWidth`（23行）リサイズは維持。`gridTemplateColumns`（69行）に折りたたみ分岐を足す。
- ストア永続化は `setSetting(key, value)` / `getSetting(key)`（`src/api/prefs.ts`）経由。

## ファイル構成

- 新規: `src/util/zoomCycle.ts` … ズームモード循環の純関数
- 新規: `src/util/gridNav.ts` … インデックスのクランプ移動の純関数
- 新規: `src/components/HelpOverlay.tsx` … ショートカット一覧オーバーレイ
- 変更: `src/store/useViewerStore.ts` … `first` / `last` / `cycleZoom` 追加
- 変更: `src/store/useQueryStore.ts` … `dirCollapsed` / `helpOpen` 状態とトグル追加
- 変更: `src/components/ImageViewer.tsx` … Z / Home / End / I / F11 のキー処理
- 変更: `src/components/ImageGridPanel.tsx` … Home / End / PageUp / PageDown のキー処理
- 変更: `src/components/SlideshowApp.tsx` … Home / End / F11 のキー処理
- 変更: `src/App.tsx` … 左パネル折りたたみ表示と B / ? のグローバルキー、HelpOverlay 描画
- 変更: `src/App.css` … ヘルプオーバーレイのスタイル

---

## Task 1: ズームモード循環（Z キー）

**Files:**
- Create: `src/util/zoomCycle.ts`
- Test: `src/util/zoomCycle.test.ts`
- Modify: `src/store/useViewerStore.ts`
- Test: `src/store/useViewerStore.test.ts`
- Modify: `src/components/ImageViewer.tsx:104-112`（1/2/3 を Z に置換）

- [ ] **Step 1: 純関数のテストを書く（失敗する）**

Create `src/util/zoomCycle.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { nextZoomMode } from "./zoomCycle";

describe("nextZoomMode", () => {
  it("cycles fit -> actual -> fill -> fit", () => {
    expect(nextZoomMode("fit")).toBe("actual");
    expect(nextZoomMode("actual")).toBe("fill");
    expect(nextZoomMode("fill")).toBe("fit");
  });

  it("returns fit when current is outside the cycle (custom)", () => {
    expect(nextZoomMode("custom")).toBe("fit");
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npx vitest run src/util/zoomCycle.test.ts`
Expected: FAIL（`nextZoomMode` が存在しない / モジュール解決エラー）

- [ ] **Step 3: 純関数を実装**

Create `src/util/zoomCycle.ts`:

```ts
import type { ZoomMode } from "../types";

/** Z キーで循環するズームモードの並び順。custom は循環対象外。 */
const CYCLE: ZoomMode[] = ["fit", "actual", "fill"];

/** 現在のズームモードから次のモードを返す。custom など循環外は fit に戻す。 */
export function nextZoomMode(current: ZoomMode): ZoomMode {
  const i = CYCLE.indexOf(current);
  if (i < 0) return "fit";
  return CYCLE[(i + 1) % CYCLE.length];
}
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `npx vitest run src/util/zoomCycle.test.ts`
Expected: PASS

- [ ] **Step 5: ストアに `cycleZoom` を追加するテストを書く（失敗する）**

`src/store/useViewerStore.test.ts` の `describe("useViewerStore", ...)` 内（81行 `toggleMeta` テストの後あたり）に追加:

```ts
  it("cycleZoom advances fit -> actual -> fill -> fit", () => {
    useViewerStore.setState({ zoomMode: "fit", scale: 1 });
    useViewerStore.getState().cycleZoom();
    expect(useViewerStore.getState().zoomMode).toBe("actual");
    useViewerStore.getState().cycleZoom();
    expect(useViewerStore.getState().zoomMode).toBe("fill");
    useViewerStore.getState().cycleZoom();
    expect(useViewerStore.getState().zoomMode).toBe("fit");
  });
```

- [ ] **Step 6: テストを実行して失敗を確認**

Run: `npx vitest run src/store/useViewerStore.test.ts`
Expected: FAIL（`cycleZoom is not a function`）

- [ ] **Step 7: ストアに `cycleZoom` を実装**

`src/store/useViewerStore.ts` の import に追加（5行 `parseZoom` の import 行の下）:

```ts
import { nextZoomMode } from "../util/zoomCycle";
```

インターフェース `ViewerState` に追加（29行 `toggleMeta: () => void;` の下）:

```ts
  cycleZoom: () => void;
```

実装に追加（77行 `toggleMeta: () => set(...)` の下）:

```ts
  cycleZoom: () => get().setZoomMode(nextZoomMode(get().zoomMode)),
```

- [ ] **Step 8: テストを実行して成功を確認**

Run: `npx vitest run src/store/useViewerStore.test.ts`
Expected: PASS

- [ ] **Step 9: ImageViewer のキーバインドを 1/2/3 から Z に置換**

`src/components/ImageViewer.tsx`:

(a) ストアから `cycleZoom` を取得する。28行 `const toggleMeta = useViewerStore((s) => s.toggleMeta);` の下に追加:

```ts
  const cycleZoom = useViewerStore((s) => s.cycleZoom);
```

(b) `setZoomMode` のキーバインドを置換。104-112行の以下を:

```ts
        case "1":
          setZoomMode("fit");
          break;
        case "2":
          setZoomMode("actual");
          break;
        case "3":
          setZoomMode("fill");
          break;
```

次に置き換える:

```ts
        case "z":
        case "Z":
          cycleZoom();
          break;
```

(c) `useEffect` の依存配列（119行）から `setZoomMode` を外し `cycleZoom` を加える:

```ts
  }, [isOpen, index, close, next, prev, select, zoomBy, cycleZoom]);
```

注: ツールバーのズームボタン（146-154行）は `setZoomMode` を引き続き使うため、`setZoomMode` の取得（26行）は残す。

- [ ] **Step 10: 型チェックと全テスト**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS（型エラーなし、全テスト緑）

- [ ] **Step 11: コミット**

```bash
git add src/util/zoomCycle.ts src/util/zoomCycle.test.ts src/store/useViewerStore.ts src/store/useViewerStore.test.ts src/components/ImageViewer.tsx
git commit -m "feat(viewer): cycle zoom modes with Z key (replaces 1/2/3)"
```

---

## Task 2: ビューアの先頭/末尾移動（Home / End）

**Files:**
- Modify: `src/store/useViewerStore.ts`
- Test: `src/store/useViewerStore.test.ts`
- Modify: `src/components/ImageViewer.tsx`

- [ ] **Step 1: ストアの `first`/`last` のテストを書く（失敗する）**

`src/store/useViewerStore.test.ts` の Task 1 で足した `cycleZoom` テストの下に追加:

```ts
  it("first jumps to index 0", () => {
    useViewerStore.setState({ index: 2 });
    useViewerStore.getState().first();
    expect(useViewerStore.getState().index).toBe(0);
  });

  it("last jumps to the final result index", () => {
    // beforeEach は results を 3 件 [row(1),row(2),row(3)] に設定済み。
    useViewerStore.setState({ index: 0 });
    useViewerStore.getState().last();
    expect(useViewerStore.getState().index).toBe(2);
  });
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npx vitest run src/store/useViewerStore.test.ts`
Expected: FAIL（`first is not a function`）

- [ ] **Step 3: ストアに `first`/`last` を実装**

`src/store/useViewerStore.ts`:

インターフェース `ViewerState` に追加（Task 1 で足した `cycleZoom: () => void;` の下）:

```ts
  first: () => void;
  last: () => void;
```

実装に追加（Task 1 で足した `cycleZoom: ...` の下）:

```ts
  first: () => set({ index: 0 }),
  last: () => set({ index: Math.max(resultsLength() - 1, 0) }),
```

注: `resultsLength()` は同ファイル 34-36 行で定義済みのヘルパー。

- [ ] **Step 4: テストを実行して成功を確認**

Run: `npx vitest run src/store/useViewerStore.test.ts`
Expected: PASS

- [ ] **Step 5: ImageViewer に Home/End のキーバインドを追加**

`src/components/ImageViewer.tsx`:

(a) ストアから取得を追加。Task 1(a) で足した `cycleZoom` の下:

```ts
  const first = useViewerStore((s) => s.first);
  const last = useViewerStore((s) => s.last);
```

(b) `keydown` の `switch` に `case "ArrowLeft":`（94-96行）の下へ追加:

```ts
        case "Home":
          e.preventDefault();
          first();
          break;
        case "End":
          e.preventDefault();
          last();
          break;
```

(c) 依存配列（119行）に `first, last` を追加:

```ts
  }, [isOpen, index, close, next, prev, select, zoomBy, cycleZoom, first, last]);
```

- [ ] **Step 6: 型チェックと全テスト**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS

- [ ] **Step 7: コミット**

```bash
git add src/store/useViewerStore.ts src/store/useViewerStore.test.ts src/components/ImageViewer.tsx
git commit -m "feat(viewer): jump to first/last image with Home/End"
```

---

## Task 3: グリッドの先頭/末尾・ページ送り（Home / End / PageUp / PageDown）

**Files:**
- Create: `src/util/gridNav.ts`
- Test: `src/util/gridNav.test.ts`
- Modify: `src/components/ImageGridPanel.tsx`

- [ ] **Step 1: 純関数のテストを書く（失敗する）**

Create `src/util/gridNav.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { moveIndex } from "./gridNav";

describe("moveIndex", () => {
  it("moves by delta within bounds", () => {
    expect(moveIndex(2, 10, 3)).toBe(5);
    expect(moveIndex(5, 10, -2)).toBe(3);
  });

  it("clamps to [0, len-1]", () => {
    expect(moveIndex(8, 10, 5)).toBe(9);
    expect(moveIndex(1, 10, -5)).toBe(0);
  });

  it("returns 0 for empty list", () => {
    expect(moveIndex(0, 0, 1)).toBe(0);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npx vitest run src/util/gridNav.test.ts`
Expected: FAIL（`moveIndex` 未定義）

- [ ] **Step 3: 純関数を実装**

Create `src/util/gridNav.ts`:

```ts
/** cur を delta だけ移動し [0, len-1] にクランプする。len<=0 のときは 0。 */
export function moveIndex(cur: number, len: number, delta: number): number {
  if (len <= 0) return 0;
  return Math.min(len - 1, Math.max(0, cur + delta));
}
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `npx vitest run src/util/gridNav.test.ts`
Expected: PASS

- [ ] **Step 5: ImageGridPanel に Home/End/PageUp/PageDown を追加**

`src/components/ImageGridPanel.tsx`:

(a) import を追加（5行 `useViewerStore` の import の下）:

```ts
import { moveIndex } from "../util/gridNav";
```

(b) `keydown` ハンドラ内の `switch` 直前（72行 `let nextIndex: number | null = null;` の下）で 1 ページ分の移動量を計算する:

```ts
      // 1 ページ＝表示中の行数 × 列数。コンテナ高さから可視行数を見積もる。
      const visibleRows = Math.max(
        1,
        Math.floor((parentRef.current?.clientHeight ?? rowHeight) / rowHeight),
      );
      const pageDelta = visibleRows * columns;
```

(c) `switch` に新しい `case` を追加。`case "ArrowUp":`（84-86行）の下に挿入:

```ts
        case "Home":
          nextIndex = 0;
          break;
        case "End":
          nextIndex = len - 1;
          break;
        case "PageDown":
          nextIndex = moveIndex(cur, len, pageDelta);
          break;
        case "PageUp":
          nextIndex = moveIndex(cur, len, -pageDelta);
          break;
```

(d) `useEffect` の依存配列（102行）に `rowHeight` を追加（`pageDelta` 計算で参照するため）:

```ts
  }, [viewerOpen, results, selectedIndex, columns, rowHeight, selectImage, openViewer, rowVirtualizer]);
```

注: `nextIndex` 確定後の `selectImage(nextIndex)` と `rowVirtualizer.scrollToIndex(...)`（95-98行）は既存処理がそのまま流用される。

- [ ] **Step 6: 型チェックと全テスト**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS

- [ ] **Step 7: コミット**

```bash
git add src/util/gridNav.ts src/util/gridNav.test.ts src/components/ImageGridPanel.tsx
git commit -m "feat(grid): Home/End and PageUp/PageDown navigation"
```

---

## Task 4: ビューアの情報パネル切替（I）とフルスクリーン（F11）

**Files:**
- Modify: `src/components/ImageViewer.tsx`

注: ここはどちらも副作用（ストアの `toggleMeta` / Tauri ウィンドウ API）で、純関数の単体テストは設けない。型チェックと手動確認で検証する。

- [ ] **Step 1: Tauri ウィンドウ API を import**

`src/components/ImageViewer.tsx` の import に追加（2行 `convertFileSrc` の import の下）:

```ts
import { getCurrentWindow } from "@tauri-apps/api/window";
```

- [ ] **Step 2: I（情報パネル）と F11（フルスクリーン）のキー処理を追加**

`keydown` の `switch` に追加（Task 2 で足した `End` の `case` の下）:

```ts
        case "i":
        case "I":
          e.preventDefault();
          toggleMeta();
          break;
        case "F11": {
          e.preventDefault();
          const w = getCurrentWindow();
          void w
            .isFullscreen()
            .then((on) => w.setFullscreen(!on))
            .catch((err) => console.error("setFullscreen failed:", err));
          break;
        }
```

注: `toggleMeta` は既に 28 行で取得済み。依存配列には副作用関数（`getCurrentWindow`）はモジュール関数のため追加不要。`toggleMeta` は安定参照だが明示するため依存配列に加える:

```ts
  }, [isOpen, index, close, next, prev, select, zoomBy, cycleZoom, first, last, toggleMeta]);
```

- [ ] **Step 3: ビューアを閉じるときフルスクリーンを解除（後始末）**

`keydown` の `case "Escape":` の `close();`（81行）の直前に、フルスクリーン解除をベストエフォートで追加する。81行付近を以下に置き換える:

```ts
        case "Escape":
          // オーバーレイ表示中は ESC を消費し、OS（macOSネイティブ全画面など）へ伝播させない。
          e.preventDefault();
          e.stopPropagation();
          void getCurrentWindow()
            .setFullscreen(false)
            .catch(() => {});
          close();
          break;
```

注: 一覧へ戻る `Enter`（83-88行）でも同様に閉じるが、Enter からの離脱でフルスクリーンを残すと一覧が全画面のままになるため、`Enter` の `close();`（87行）直前にも同じ解除を入れる:

```ts
        case "Enter":
          e.preventDefault();
          void getCurrentWindow()
            .setFullscreen(false)
            .catch(() => {});
          select(index);
          close();
          break;
```

- [ ] **Step 4: 型チェックと全テスト**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS

- [ ] **Step 5: 手動確認**

Run: `npm run tauri dev`
確認: 一覧で画像をダブルクリック→ビューア表示→`I` で右情報パネルが開閉、`F11` で全画面ON/OFF、`Esc`/`Enter` で閉じると全画面が解除されて一覧へ戻る。

- [ ] **Step 6: コミット**

```bash
git add src/components/ImageViewer.tsx
git commit -m "feat(viewer): toggle info panel with I and fullscreen with F11"
```

---

## Task 5: スライドショーの先頭/末尾（Home / End）とフルスクリーン（F11）

**Files:**
- Modify: `src/components/SlideshowApp.tsx`

注: `pos` は `order` 配列上の位置。先頭は `0`、末尾は `order.length - 1`。最新の order 長は `orderRef.current`（25,32行）で参照する。

- [ ] **Step 1: keydown に Home/End/F11 を追加**

`src/components/SlideshowApp.tsx` の `keydown` の `switch`（125-144行）、`case "Escape":` ブロックの下（141行 `break;` の後）に追加:

```ts
        case "Home":
          e.preventDefault();
          if (orderRef.current.length > 0) setPos(0);
          break;
        case "End":
          e.preventDefault();
          {
            const len = orderRef.current.length;
            if (len > 0) setPos(len - 1);
          }
          break;
        case "F11":
          e.preventDefault();
          void getCurrentWindow()
            .isFullscreen()
            .then((on) => toggleFullscreen(!on))
            .catch((err) => console.error("setFullscreen failed:", err));
          break;
```

- [ ] **Step 2: 依存配列に `toggleFullscreen` を追加**

`keydown` の `useEffect` 依存配列（148行）を更新:

```ts
  }, [advance, toggleFullscreen]);
```

注: `getCurrentWindow`（3行）と `toggleFullscreen`（112-120行）は既存。`setPos` は React の安定 setter のため依存追加不要。

- [ ] **Step 3: 型チェックと全テスト**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS

- [ ] **Step 4: 手動確認**

Run: `npm run tauri dev`
確認: FilterBar の「スライドショー▶」で起動→`Home`/`End` で先頭・末尾へジャンプ、`F11` で全画面切替（既存のフルスクリーンボタンと整合）。

- [ ] **Step 5: コミット**

```bash
git add src/components/SlideshowApp.tsx
git commit -m "feat(slideshow): Home/End jump and F11 fullscreen toggle"
```

---

## Task 6: 左 DirectoryPanel の折りたたみ（B）

**Files:**
- Modify: `src/store/useQueryStore.ts`
- Test: `src/store/useQueryStore.test.ts`
- Modify: `src/App.tsx`

- [ ] **Step 1: ストアの `toggleDirCollapsed` と永続化のテストを書く（失敗する）**

`src/store/useQueryStore.test.ts`:

(a) `beforeEach` の `setState`（17-20行）に初期値を追加。`showFilename: true,` の行を以下に置換:

```ts
    results: [], total: 0, history: [], showFilename: true,
    dirCollapsed: false, helpOpen: false,
```

(b) `describe` 末尾（100行 `loadSettings restores...` テストの後）に追加:

```ts
  it("toggleDirCollapsed flips and persists", async () => {
    vi.mocked(prefsApi.setSetting).mockResolvedValue(undefined as unknown as void);
    await useQueryStore.getState().toggleDirCollapsed();
    expect(useQueryStore.getState().dirCollapsed).toBe(true);
    expect(prefsApi.setSetting).toHaveBeenCalledWith("dir_collapsed", "true");
  });

  it("loadSettings restores persisted dir_collapsed", async () => {
    vi.mocked(prefsApi.getSetting).mockImplementation(async (key: string) => {
      if (key === "dir_collapsed") return "true";
      return null;
    });
    await useQueryStore.getState().loadSettings();
    expect(useQueryStore.getState().dirCollapsed).toBe(true);
  });
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npx vitest run src/store/useQueryStore.test.ts`
Expected: FAIL（`toggleDirCollapsed is not a function`）

- [ ] **Step 3: ストアに `dirCollapsed` / `helpOpen` 状態とトグルを実装**

`src/store/useQueryStore.ts`:

(a) インターフェース `QueryState` に追加（13行 `showFilename: boolean;` の下）:

```ts
  dirCollapsed: boolean;
  helpOpen: boolean;
```

(b) インターフェースのメソッド宣言に追加（19行 `toggleShowFilename: () => Promise<void>;` の下）:

```ts
  toggleDirCollapsed: () => Promise<void>;
  toggleHelp: () => void;
  closeHelp: () => void;
```

(c) ストア初期値に追加（30行 `showFilename: true,` の下）:

```ts
  dirCollapsed: false,
  helpOpen: false,
```

(d) アクション実装を追加（63行 `toggleShowFilename: async () => {...},` の閉じ括弧の下）:

```ts
  toggleDirCollapsed: async () => {
    const next = !get().dirCollapsed;
    set({ dirCollapsed: next });
    await prefsApi.setSetting("dir_collapsed", String(next));
  },
  toggleHelp: () => set({ helpOpen: !get().helpOpen }),
  closeHelp: () => set({ helpOpen: false }),
```

(e) `loadSettings` で `dir_collapsed` を復元する。`loadSettings` の `Promise.all`（65-69行）の取得キーに追加し、復元処理を足す。65-69行を以下に置換:

```ts
    const [sortRaw, showRaw, queryRaw, dirCollapsedRaw] = await Promise.all([
      prefsApi.getSetting("sort"),
      prefsApi.getSetting("show_filename"),
      prefsApi.getSetting("filter_query"),
      prefsApi.getSetting("dir_collapsed"),
    ]);
```

そして `if (queryRaw !== null) { set({ query: queryRaw }); }`（79-81行）の下に追加:

```ts
    if (dirCollapsedRaw !== null) {
      set({ dirCollapsed: dirCollapsedRaw === "true" });
    }
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `npx vitest run src/store/useQueryStore.test.ts`
Expected: PASS

- [ ] **Step 5: App で折りたたみ表示と B キーを実装**

`src/App.tsx`:

(a) ストアから取得を追加（19行 `toggleShowFilename` の下）:

```ts
  const dirCollapsed = useQueryStore((s) => s.dirCollapsed);
  const toggleDirCollapsed = useQueryStore((s) => s.toggleDirCollapsed);
```

(b) グローバルキーの `useEffect` を追加（既存の `menu-action` 用 `useEffect`（51-64行）の下）:

```ts
  // グローバルキー: B で左パネル折りたたみ。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ae = document.activeElement;
      const typing =
        ae instanceof HTMLElement &&
        (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.isContentEditable);
      if (typing) return;
      if (e.key === "b" || e.key === "B") {
        e.preventDefault();
        void toggleDirCollapsed();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleDirCollapsed]);
```

(c) `gridTemplateColumns` を折りたたみ分岐に変更（69行）。`style={{ gridTemplateColumns: `${dirWidth}px 5px 1fr` }}` を以下に置換:

```tsx
      style={{
        gridTemplateColumns: dirCollapsed ? "0px 0px 1fr" : `${dirWidth}px 5px 1fr`,
      }}
```

(d) 折りたたみ時は `DirectoryPanel` とリサイザを描画しない。81-88行の `<DirectoryPanel />` とリサイザ `<div className="dir-resizer" ... />` を以下に置換:

```tsx
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
```

- [ ] **Step 6: 型チェックと全テスト**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS

- [ ] **Step 7: 手動確認**

Run: `npm run tauri dev`
確認: 検索欄にフォーカスがない状態で `B` を押すと左 DirectoryPanel が消えて一覧が全幅になり、再度 `B` で戻る。アプリ再起動後も折りたたみ状態が復元される。検索欄入力中は `B` がタイプとして入力される（トグルしない）。

- [ ] **Step 8: コミット**

```bash
git add src/store/useQueryStore.ts src/store/useQueryStore.test.ts src/App.tsx
git commit -m "feat(layout): collapse left directory panel with B key (persisted)"
```

---

## Task 7: ヘルプオーバーレイ（?）

**Files:**
- Create: `src/components/HelpOverlay.tsx`
- Modify: `src/App.tsx`
- Modify: `src/App.css`

注: `helpOpen` / `toggleHelp` / `closeHelp` は Task 6 で `useQueryStore` に実装済み。

- [ ] **Step 1: HelpOverlay コンポーネントを作成**

Create `src/components/HelpOverlay.tsx`:

```tsx
interface Props {
  onClose: () => void;
}

interface Row {
  keys: string;
  desc: string;
}

const SECTIONS: { title: string; rows: Row[] }[] = [
  {
    title: "一覧（グリッド）",
    rows: [
      { keys: "← → ↑ ↓", desc: "選択を移動" },
      { keys: "Home / End", desc: "先頭 / 末尾の画像" },
      { keys: "PageUp / PageDown", desc: "ページ単位で移動" },
      { keys: "Enter", desc: "ビューアで開く" },
    ],
  },
  {
    title: "ビューア",
    rows: [
      { keys: "← / → / Space", desc: "前へ / 次へ" },
      { keys: "Home / End", desc: "先頭 / 末尾の画像" },
      { keys: "+ / -", desc: "ズームイン / アウト" },
      { keys: "Z", desc: "ズームモード循環（fit→actual→fill）" },
      { keys: "I", desc: "情報パネルの開閉" },
      { keys: "F11", desc: "フルスクリーン切替" },
      { keys: "Enter", desc: "選択して一覧へ戻る" },
      { keys: "Esc", desc: "閉じる" },
    ],
  },
  {
    title: "スライドショー",
    rows: [
      { keys: "← / →", desc: "前へ / 次へ" },
      { keys: "Space", desc: "再生 / 一時停止" },
      { keys: "Home / End", desc: "先頭 / 末尾の画像" },
      { keys: "F11", desc: "フルスクリーン切替" },
      { keys: "Esc", desc: "閉じる" },
    ],
  },
  {
    title: "全体",
    rows: [
      { keys: "B", desc: "左ディレクトリパネルの開閉" },
      { keys: "?", desc: "このヘルプの表示 / 非表示" },
    ],
  },
];

export function HelpOverlay({ onClose }: Props) {
  return (
    <div className="help-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="help-panel" onClick={(e) => e.stopPropagation()}>
        <div className="help-header">
          <h2>キーボードショートカット</h2>
          <button onClick={onClose} aria-label="閉じる">
            ✕
          </button>
        </div>
        <div className="help-body">
          {SECTIONS.map((sec) => (
            <section key={sec.title} className="help-section">
              <h3>{sec.title}</h3>
              <table>
                <tbody>
                  {sec.rows.map((r) => (
                    <tr key={r.keys}>
                      <td className="help-keys">{r.keys}</td>
                      <td className="help-desc">{r.desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: App に ? キーと描画を追加**

`src/App.tsx`:

(a) import を追加（9行 `ImageViewer` の import の下）:

```ts
import { HelpOverlay } from "./components/HelpOverlay";
```

(b) ストアから取得を追加（Task 6(a) の `toggleDirCollapsed` の下）:

```ts
  const helpOpen = useQueryStore((s) => s.helpOpen);
  const toggleHelp = useQueryStore((s) => s.toggleHelp);
  const closeHelp = useQueryStore((s) => s.closeHelp);
```

(c) Task 6(b) で作ったグローバルキー `useEffect` を拡張して `?` と `Esc`（ヘルプ表示中のみ）を処理する。Task 6(b) の `useEffect` 全体を以下に置換:

```ts
  // グローバルキー: B で左パネル折りたたみ、? でヘルプ、Esc でヘルプを閉じる。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (helpOpen && e.key === "Escape") {
        e.preventDefault();
        closeHelp();
        return;
      }
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
  }, [helpOpen, toggleDirCollapsed, toggleHelp, closeHelp]);
```

(d) `<ImageViewer />`（92行）の下に描画を追加:

```tsx
      {helpOpen && <HelpOverlay onClose={closeHelp} />}
```

- [ ] **Step 3: ヘルプオーバーレイの CSS を追加**

`src/App.css` の末尾に追加:

```css
.help-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.help-panel {
  background: #fff;
  border-radius: 8px;
  max-width: 640px;
  width: 90%;
  max-height: 80vh;
  overflow-y: auto;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
}
.help-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid #eee;
}
.help-header h2 {
  margin: 0;
  font-size: 16px;
}
.help-body {
  padding: 8px 16px 16px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 24px;
}
.help-section h3 {
  font-size: 13px;
  color: #555;
  margin: 12px 0 4px;
}
.help-section table {
  width: 100%;
  border-collapse: collapse;
}
.help-keys {
  white-space: nowrap;
  font-family: ui-monospace, monospace;
  font-size: 12px;
  color: #1a4d8f;
  padding: 2px 8px 2px 0;
  vertical-align: top;
}
.help-desc {
  font-size: 12px;
  padding: 2px 0;
}
```

- [ ] **Step 4: 型チェックと全テスト**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS

- [ ] **Step 5: 手動確認**

Run: `npm run tauri dev`
確認: 検索欄以外にフォーカスがある状態で `?` を押すとショートカット一覧が表示され、`?`／`Esc`／背景クリック／✕ で閉じる。

- [ ] **Step 6: コミット**

```bash
git add src/components/HelpOverlay.tsx src/App.tsx src/App.css
git commit -m "feat(help): keyboard shortcut help overlay toggled with ?"
```

---

## 完了確認（全タスク後）

- [ ] **全テスト・型チェック・ビルド**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: 全 PASS、ビルド成功

- [ ] **総合手動確認**

Run: `npm run tauri dev`
確認項目:
1. グリッド: `Home`/`End`/`PageUp`/`PageDown` で選択が想定通り移動しスクロール追従する。
2. ビューア: `Z` でズームモードが循環、`1/2/3` は無反応（置換済み）、`I` で情報パネル開閉、`Home`/`End` で先頭末尾、`F11` で全画面、閉じると全画面解除。
3. スライドショー: `Home`/`End`/`F11` が機能する。
4. `B` で左パネル開閉（再起動後も復元）、検索欄入力中は誤作動しない。
5. `?` でヘルプ表示、内容が実装したキーマップと一致している。

---

## Self-Review

**1. Spec coverage（PhaseA 7 項目）:**
- Z ズーム循環 → Task 1 ✅
- Home/End（ビューア）→ Task 2 ✅ / （グリッド）→ Task 3 ✅ / （スライドショー）→ Task 5 ✅
- PageUp/Down（グリッド）→ Task 3 ✅
- I 情報パネル → Task 4 ✅
- F11（ビューア）→ Task 4 ✅ / （スライドショー）→ Task 5 ✅
- B 左パネル折りたたみ → Task 6 ✅
- ? ヘルプ → Task 7 ✅

**2. Placeholder scan:** プレースホルダなし。各ステップに実コードを記載。

**3. Type consistency:**
- `nextZoomMode(current: ZoomMode): ZoomMode` … Task 1 定義、Task 1 ストアで使用。一致。
- `cycleZoom` / `first` / `last` … `ViewerState` に宣言し ImageViewer で参照。一致。
- `moveIndex(cur, len, delta)` … Task 3 定義・使用。一致。
- `dirCollapsed` / `helpOpen` / `toggleDirCollapsed` / `toggleHelp` / `closeHelp` … `QueryState` に宣言、Task 6/7 で参照。一致。
- 永続化キー `"dir_collapsed"` … Task 6 の save と load で同一文字列。一致。

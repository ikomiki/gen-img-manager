# web ビューア 計画4: ビューアとスライドショー 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** LAN 内のブラウザ（スマホ・タブレット・PC）で、一覧からタップした画像を全画面で見て、スワイプで送り、ピンチで拡大し、スライドショーで流せるようにする。

**Architecture:** 一覧の上に全画面のオーバーレイとして `Viewer` を重ねる（ルーティングは持たない）。現在位置とスライドショー設定は新しい zustand ストア `useViewerStore` に置き、再生順序は `@gim/shared/playlist` の `buildOrder` / `step` に委ねる。ジェスチャ判定・表示幅の選択・プリロードの重複制御は純粋関数へ切り出し、コンポーネントは配線だけを持つ。

**Tech Stack:** React 19 / TypeScript 5.8 / Vite 7 / zustand 5 / vitest 4 / Pointer Events / Fullscreen API

**Spec:** `docs/superpowers/specs/2026-08-16-web-viewer-design.md`

**前の計画:** `docs/superpowers/plans/2026-08-17-web-viewer-3-frontend-list.md`（末尾の「計画4への申し送り」に、ブランチ全体レビューで挙がった項目が入っている。この計画はそのうち UI 側を引き受ける）

## Global Constraints

- **`library.db` に一切書き込まない。** サーバの接続は `gim_core::db::open_read_only` 経由のみ
- **web の状態はすべてクライアント側に持つ。** サーバはステートレス。履歴・ソート・ディレクトリ選択・最後のクエリ・スライドショー設定は localStorage
- **デスクトップ版（`src/`・`src-tauri/`）の振る舞いを変えない。** この計画は `src/` を一切変更しない
- `crates/server` と `web` の `version` は `"0.0.0"` 固定。`npm run bump` の対象に含めない
- パッケージマネージャは **pnpm**。`npm install` は使えない（`workspace:*` を解決できない）。`package-lock.json` は残骸なので触らない
- コードコメントは非自明な WHY のみ。WHAT・変更履歴・タスク ID は書かない
- コミットメッセージは Conventional Commits のプリフィックスを英語、要約と本文を日本語で書く
- **色は `web/src/theme.css` の CSS 変数経由でのみ使う**（`--bg` `--bg-media` `--surface` `--surface-raised` `--border` `--text` `--text-dim` `--accent` `--tap`）。既存の例外は `Sheet.tsx` の暗幕 `rgba(0, 0, 0, 0.5)` の1箇所だけ。この計画ではビューアの暗幕として `--bg-media` を使うので新しい例外は作らない
- **ボタン・入力欄のスタイルは `web/src/ui.ts` の `buttonStyle` / `inputStyle` から取る。** 各コンポーネントで再定義しない（計画3で4箇所に分裂したのを集約した経緯がある）
- **シートの確定モデルは「即時反映」に統一する（ユーザ決定済み）。** 「適用」ボタンを持つシートを新しく作らない
- モバイル作法: タップ対象は最小 44×44 px（`var(--tap)`）、`env(safe-area-inset-*)` を尊重する、ホバー前提の UI を作らない
- **zustand v5 のセレクタは必ず個別形式**（`useStore((s) => s.x)`）。オブジェクトを返すセレクタは毎レンダリングで新しい参照が返り無限再レンダリングになる（v5 はフック第2引数の等値比較関数を廃止している）
- ロジックは UI/IO から純粋関数へ切り出してテストする。フロント固有は `web/src/util/*`、デスクトップ版と共有するものは `packages/shared/src/*`

## この計画のスコープ

含む: フィルタシートの即時反映化、シートのキーボード操作とアクセシビリティ、`/` でのクエリ入力フォーカス、`Prefs` の検証、ビューア（全画面・前後送り・UI 切替・ピンチズーム・スワイプ）、スライドショー（順序生成・タイマー・プリロード・設定）、PC のキーボード操作。

含まない: `rust-embed` による単一バイナリ化、API の `Router::nest("/api", …)` 化、ユーザ向け HTML ドキュメント、サーバ側のエラー詳細の非公開化、`ApiQuery<T>` 抽出器（すべて計画5）。

この計画の完了時点で、スマホのブラウザで一覧から画像をタップすると全画面で開き、スワイプで送れ、ピンチで拡大でき、スライドショーが回る状態になる。まだ `npm run web:dev` と `cargo run -p gim-server` の2プロセスが要る（単一バイナリ化は計画5）。

## 既存コードの前提（実測済み・確認不要）

### `@gim/shared` の実シグネチャ

```ts
// @gim/shared/playlist
export function mulberry32(seed: number): () => number;
export function buildOrder(length: number, random: boolean, rand: () => number): number[];
export interface StepResult { pos: number; wrapped: boolean; stop: boolean; }
export function step(pos: number, length: number, loop: boolean, delta: 1 | -1): StepResult;

// @gim/shared/gridNav
export function moveIndex(cur: number, len: number, delta: number): number;

// @gim/shared/types
export type SortKey = "filename" | "created" | "modified";
export type SortDir = "asc" | "desc";
```

`step` の挙動: 非ループで末尾に到達すると `{ pos: length-1, wrapped: false, stop: true }`、非ループで先頭より前は `{ pos: 0, wrapped: false, stop: false }`。ループ時は端で折り返し `wrapped: true`。空リストは `{ pos: 0, wrapped: false, stop: true }`。

### `web/src/` の現状

```
web/src/api/client.ts      getJson / buildQuery / dirsParam / ApiError
web/src/api/images.ts      ImageDto / ListParams / listImages / countImages / listImageIds
                           / thumbUrl(id) / imageUrl(id, w?)
web/src/api/directories.ts DirectoryDto / listDirectories
web/src/storage.ts         Prefs / DEFAULT_PREFS / HISTORY_MAX / loadPrefs / savePrefs
web/src/ui.ts              buttonStyle / inputStyle
web/src/theme.css          CSS 変数
web/src/util/gridLayout.ts gridLayout(width, minCell, gap) -> { columns, cell }
web/src/store/useQueryStore.ts
web/src/components/        ImageGrid / FilterBar / HistoryList / Sheet / FilterSheet / DirectorySheet
web/src/App.tsx
```

`useQueryStore` の状態: `query` `sort` `dir` `dirs` `results` `total` `loading` `exhausted` `error` `seq` `history`。アクション: `init` `setQuery` `commitQuery` `setSort` `setDirs` `runQuery` `loadMore`。

`seq` はクエリの世代番号で、`runQuery` が冒頭で進め、`runQuery` と `loadMore` が応答を反映する直前に `get().seq !== seq` なら早期 return する（古い応答が新しい結果を上書きするのを防ぐ）。**この仕組みを壊さないこと。**

`storage.ts` の `Prefs` は `{ query, sort, dir, dirs, history }`。localStorage のキーは `"gim.web.prefs"` の単一 blob。

`Sheet` の署名: `<Sheet open={boolean} title={string} onClose={() => void}>{children}</Sheet>`。暗幕 + `role="dialog"` + `aria-label={title}` + sticky ヘッダ + 「閉じる」ボタン + `paddingBottom: env(safe-area-inset-bottom)`。

### サーバ API の注意点

- `imageUrl(id, w)` の `w` は **幅ではなく長辺の上限**。サーバは `img.resize(w, w, Lanczos3)` で長辺を `w` に収める
- サーバが受け付ける `w` は 640 / 1280 / 1920 / 2560 にスナップされる（それ以外を渡すと切り上げ、2560 超は 2560）
- **同一画像への同時リクエストはサーバ側で single-flight されていない。** 先読みの重複制御はクライアント側に置く
- 応答は `Cache-Control: public, max-age=31536000, immutable` と ETag 付き

### やってはいけないこと

- **デスクトップ版の `src/hooks/useSlideTimer.ts` を web へ持ち込まないこと。** あれは WKWebView が描画パイプラインを止めると入力イベントが配送されなくなる macOS 固有の症状への対策（rAF を回し続けて keep-alive 要素を毎フレーム動かす）で、通常のブラウザには不要な複雑さ。web 側は素の `setTimeout` でよい。ただし**「表示中の画像が読み込み終わってから計時を始める」という設計はそのまま踏襲する**（読み込みの遅い画像が表示時間を削られたり、読み込み前に送られたりするのを防ぐため）
- `src/` 配下のファイルを変更しないこと

---

## ファイル構成

### 新規作成

| ファイル | 責務 |
|---|---|
| `web/src/util/keys.ts` | キー判定の純粋関数（修飾キー完全一致・入力欄にフォーカス中かの判定） |
| `web/src/util/keys.test.ts` | 同テスト |
| `web/src/util/pickWidth.ts` | 表示サイズと devicePixelRatio から要求する `w` を選ぶ |
| `web/src/util/pickWidth.test.ts` | 同テスト |
| `web/src/util/gesture.ts` | スワイプ方向の判定・ピンチ倍率の計算・2点間距離 |
| `web/src/util/gesture.test.ts` | 同テスト |
| `web/src/util/preloader.ts` | 同一 URL への重複プリロードを避ける小さな仕組み |
| `web/src/util/preloader.test.ts` | 同テスト |
| `web/src/store/useViewerStore.ts` | ビューアの位置・再生順序・ズーム・スライドショー設定 |
| `web/src/store/useViewerStore.test.ts` | 同テスト |
| `web/src/components/Viewer.tsx` | 全画面オーバーレイ。上下のバー、前後送り、閉じる |
| `web/src/components/Viewer.test.tsx` | 同テスト |
| `web/src/components/ZoomableImage.tsx` | 画像本体。ピンチズーム・パン・スワイプ送り |
| `web/src/components/SlideshowSheet.tsx` | 間隔・ループ・シャッフルの設定シート |

### 変更

| ファイル | 変更内容 |
|---|---|
| `web/src/store/useQueryStore.ts` | `runQueryDebounced` を足す（フィルタシートの自由入力用） |
| `web/src/components/FilterSheet.tsx` | 「適用」を廃止し即時反映へ。閉じたときに履歴へ1件記録 |
| `web/src/components/Sheet.tsx` | Escape で閉じる・`aria-modal`・スクロールの封じ込め |
| `web/src/components/FilterBar.tsx` | `/` でクエリ入力へフォーカス |
| `web/src/components/ImageGrid.tsx` | サムネイルをタップするとビューアを開く |
| `web/src/storage.ts` | `Prefs` に `slideshow` を足す。`sanitizePrefs` で検証する |
| `web/src/App.tsx` | `Viewer` を重ねる |
| `web/src/theme.css` | ビューア用に最小限の追加（`user-select` の抑止など） |

---

## Task 1: フィルタシートを即時反映へ統一する

**Files:**
- Modify: `web/src/store/useQueryStore.ts`, `web/src/store/useQueryStore.test.ts`, `web/src/components/FilterSheet.tsx`, `web/src/components/FilterSheet.test.tsx`

**Interfaces:**
- Consumes: 既存の `useQueryStore`
- Produces:
  - `useQueryStore` に `runQueryDebounced: () => void`（既定 400ms）
  - `FilterSheet` から「適用」ボタンが消え、入力すると検索が走る

### 決定事項

計画3のブランチ全体レビューで「2つのシートで確定の作法が違う」と指摘され、**両方とも即時反映に揃える**とユーザが決定した。`DirectorySheet` はすでに即時反映なので、変えるのは `FilterSheet` だけ。

**自由入力（プロンプト・幅・高さ・モデル・生成ツール）はデバウンスする。** 17,000 件のライブラリに打鍵ごとにクエリを投げると実機で重い。**離散的な操作（レーティングのチップ・日付・クリア）は即座に投げる**（そこで待たせる理由がない）。

**履歴への記録はシートを閉じたときに1回だけ行う。** チップを1つ押すたびに履歴が増えると使い物にならない。シート操作中は `runQuery`（履歴に残さない）、閉じるときに `commitQuery`（履歴に残す）。

- [ ] **Step 1: ストアのデバウンスの失敗するテストを書く**

`web/src/store/useQueryStore.test.ts` の末尾に追加する。

```ts
describe("runQueryDebounced", () => {
  it("連続して呼んでも検索は1回だけ走る", async () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(imagesApi, "listImages").mockResolvedValue([]);
    vi.spyOn(imagesApi, "countImages").mockResolvedValue({ total: 0 });

    useQueryStore.getState().runQueryDebounced();
    useQueryStore.getState().runQueryDebounced();
    useQueryStore.getState().runQueryDebounced();
    expect(spy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(500);
    expect(spy).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("間隔を空ければそれぞれ走る", async () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(imagesApi, "listImages").mockResolvedValue([]);
    vi.spyOn(imagesApi, "countImages").mockResolvedValue({ total: 0 });

    useQueryStore.getState().runQueryDebounced();
    await vi.advanceTimersByTimeAsync(500);
    useQueryStore.getState().runQueryDebounced();
    await vi.advanceTimersByTimeAsync(500);

    expect(spy).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npx vitest run web/src/store/useQueryStore.test.ts -t runQueryDebounced`
Expected: FAIL。`runQueryDebounced is not a function`

- [ ] **Step 3: ストアにデバウンスを足す**

`web/src/store/useQueryStore.ts` の `PAGE_SIZE` の下に定数とタイマーを置く。

```ts
export const PAGE_SIZE = 200;

/** 自由入力からの検索を遅らせる時間。17,000件へ打鍵ごとに投げないため。 */
const DEBOUNCE_MS = 400;

// タイマーの識別子はストアの状態ではない（描画に関係しない）ので、
// 再レンダリングを誘発しないようモジュールスコープに置く。
let debounceTimer: ReturnType<typeof setTimeout> | undefined;
```

`QueryState` の宣言に1行足す。

```ts
  runQuery: () => Promise<void>;
  runQueryDebounced: () => void;
  loadMore: () => Promise<void>;
```

`runQuery` の実装の直後に足す。

```ts
  runQueryDebounced: () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      void get().runQuery();
    }, DEBOUNCE_MS);
  },
```

- [ ] **Step 4: テストを実行して通ることを確認する**

Run: `npx vitest run web/src/store/useQueryStore.test.ts`
Expected: PASS（既存 + 新規2件）

- [ ] **Step 5: フィルタシートの失敗するテストを書く**

`web/src/components/FilterSheet.test.tsx` の `describe("FilterSheet", ...)` の中で、既存の「適用で検索が走る」テストを次の3件に**置き換える**（他の5件はそのまま残す）。

```ts
  it("レーティングを選ぶと即座に検索が走る", async () => {
    render(<FilterSheet open onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText("レーティング 5"));
    await vi.waitFor(() => expect(imagesApi.listImages).toHaveBeenCalled());
  });

  it("自由入力はすぐには検索せず、少し待ってから走る", async () => {
    vi.useFakeTimers();
    render(<FilterSheet open onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("幅"), { target: { value: ">=1024" } });

    expect(imagesApi.listImages).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    expect(imagesApi.listImages).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("閉じるときに履歴へ記録する", async () => {
    const onClose = vi.fn();
    useQueryStore.setState({ query: "rating:>=5", history: [] });
    const { rerender } = render(<FilterSheet open onClose={onClose} />);

    rerender(<FilterSheet open={false} onClose={onClose} />);
    await vi.waitFor(() => expect(useQueryStore.getState().history).toEqual(["rating:>=5"]));
  });
```

`beforeEach` に `history: []` を足す（現在は `query: ""` だけを書いている）。

```ts
  useQueryStore.setState({ query: "", history: [] });
```

- [ ] **Step 6: テストを実行して失敗を確認する**

Run: `npx vitest run web/src/components/FilterSheet.test.tsx`
Expected: FAIL。「適用」ボタンがまだ存在し、入力しても検索が走らない

- [ ] **Step 7: フィルタシートを即時反映へ変える**

`web/src/components/FilterSheet.tsx` を次のように変える。

import に `useEffect` と `useRef` を足す。

```tsx
import { useEffect, useRef } from "react";
```

ストアから取るものを増やす。

```tsx
  const query = useQueryStore((s) => s.query);
  const setQuery = useQueryStore((s) => s.setQuery);
  const commitQuery = useQueryStore((s) => s.commitQuery);
  const runQuery = useQueryStore((s) => s.runQuery);
  const runQueryDebounced = useQueryStore((s) => s.runQueryDebounced);
```

`setField` と `toggleRating` と `clearFields` を、書き込みの直後に検索を促す形へ変える。**`setField` は自由入力用なのでデバウンス、`toggleRating` と `clearFields` は即座**。

```tsx
  /** 自由入力の欄。打鍵ごとにクエリ文字列は直すが、検索は落ち着いてから投げる。 */
  const setField = (field: string, value: string) => {
    setQuery(upsertField(query, field, value.trim() === "" ? null : value.trim()));
    runQueryDebounced();
  };

  const toggleRating = (v: RatingValue) => {
    const next = new Set(ratings);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    setQuery(upsertField(query, "rating", buildRatingToken(next)));
    void runQuery();
  };

  const clearFields = () => {
    const withoutStructured = STRUCTURED.reduce((q, f) => upsertField(q, f, null), query);
    setQuery(applyPromptField(withoutStructured, "prompt", ""));
    void runQuery();
  };
```

プロンプト欄の `onChange` も自由入力なのでデバウンスさせる。

```tsx
        <input
          aria-label="プロンプト"
          type="text"
          value={promptFieldToInput(query, "prompt")}
          placeholder="forest -blurry"
          onChange={(e) => {
            setQuery(applyPromptField(query, "prompt", e.target.value));
            runQueryDebounced();
          }}
          style={{ ...inputStyle, width: "100%" }}
        />
```

日付欄は離散操作なので即座にする。

```tsx
          onChange={(e) => {
            setQuery(upsertField(query, "created", e.target.value === "" ? null : `>=${e.target.value}`));
            void runQuery();
          }}
```

`apply` 関数を削除し、閉じたときに履歴へ記録する effect を足す。

```tsx
  // シート操作中の検索は履歴に残さない（チップ1つで1件増えると使い物にならない）。
  // 閉じた時点の文字列だけを1件記録する。
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !open) void commitQuery();
    wasOpen.current = open;
  }, [open, commitQuery]);
```

ボタンの並びを「クリア」だけにする。

```tsx
      <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
        <button type="button" onClick={clearFields} style={{ ...buttonStyle, flex: 1 }}>
          クリア
        </button>
      </div>
```

- [ ] **Step 8: テストを実行して通ることを確認する**

Run: `npx vitest run web/src/components/FilterSheet.test.tsx`
Expected: PASS（7件）

- [ ] **Step 9: 全テストと型チェック**

Run: `npm test && npx tsc --noEmit && pnpm -C web exec tsc --noEmit`
Expected: すべて PASS

- [ ] **Step 10: コミット**

```bash
git add web
git commit -m "$(cat <<'EOF'
feat(web): 絞り込みシートを即時反映に統一する

自由入力はデバウンス、レーティングや日付の離散操作は即座に検索する。
履歴にはシートを閉じた時点の文字列を1件だけ残す。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: シートのキーボード操作と `/` フォーカス

**Files:**
- Create: `web/src/util/keys.ts`, `web/src/util/keys.test.ts`
- Modify: `web/src/components/Sheet.tsx`, `web/src/components/FilterBar.tsx`, `web/src/components/FilterBar.test.tsx`

**Interfaces:**
- Consumes: なし
- Produces:
  - `web/src/util/keys.ts`: `isPlainKey(e, key): boolean`、`isTypingTarget(t): boolean`
  - `Sheet` が Escape で閉じ、`aria-modal="true"` を持ち、スクロールが背後へ伝播しない
  - `/` でクエリ入力へフォーカスが移る

### 決定事項

spec 177行目は「PC ブラウザではキーボードも効かせる（←→ で送り、Space で再生/停止、F でフルスクリーン、`/` でクエリ入力へフォーカス）。修飾キーは完全一致で判定する」と書いている。このうち `/` は一覧画面の機能なので計画3が引き受けるべきだったが漏れた。ここで拾う。

**修飾キーは完全一致で判定する。** CLAUDE.md が明示している通り、「Cmd を含む」程度の緩い判定は、より多くの修飾キーを伴う別ショートカットを巻き込む。判定は純粋関数へ切り出してテストする（デスクトップ版の `src/util/platform.ts` の `isSelectAllKey` と同じ方針）。

- [ ] **Step 1: 失敗するテストを書く**

`web/src/util/keys.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isPlainKey, isTypingTarget } from "./keys";

function ev(key: string, mods: Partial<Record<"ctrlKey" | "metaKey" | "shiftKey" | "altKey", boolean>> = {}) {
  return { key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods } as KeyboardEvent;
}

describe("isPlainKey", () => {
  it("修飾キー無しで一致する", () => {
    expect(isPlainKey(ev("/"), "/")).toBe(true);
    expect(isPlainKey(ev("Escape"), "Escape")).toBe(true);
  });

  it("キーが違えば false", () => {
    expect(isPlainKey(ev("a"), "/")).toBe(false);
  });

  it("修飾キーが1つでも押されていれば false", () => {
    expect(isPlainKey(ev("/", { ctrlKey: true }), "/")).toBe(false);
    expect(isPlainKey(ev("/", { metaKey: true }), "/")).toBe(false);
    expect(isPlainKey(ev("/", { shiftKey: true }), "/")).toBe(false);
    expect(isPlainKey(ev("/", { altKey: true }), "/")).toBe(false);
  });
});

describe("isTypingTarget", () => {
  it("input と textarea は入力中とみなす", () => {
    expect(isTypingTarget(document.createElement("input"))).toBe(true);
    expect(isTypingTarget(document.createElement("textarea"))).toBe(true);
  });

  it("select も入力中とみなす", () => {
    expect(isTypingTarget(document.createElement("select"))).toBe(true);
  });

  it("div は入力中ではない", () => {
    expect(isTypingTarget(document.createElement("div"))).toBe(false);
  });

  it("contenteditable な要素は入力中とみなす", () => {
    const d = document.createElement("div");
    d.setAttribute("contenteditable", "true");
    expect(isTypingTarget(d)).toBe(true);
  });

  it("null は入力中ではない", () => {
    expect(isTypingTarget(null)).toBe(false);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npx vitest run web/src/util/keys.test.ts`
Expected: FAIL。`./keys` が存在しない

- [ ] **Step 3: 実装する**

`web/src/util/keys.ts`:

```ts
/**
 * 修飾キーが1つも押されていない状態でのキー一致。
 * 「Cmd を含む」程度の緩い判定は、より多くの修飾キーを伴う別ショートカットを
 * 巻き込んで preventDefault してしまうため、完全一致で判定する。
 */
export function isPlainKey(
  e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">,
  key: string,
): boolean {
  return e.key === key && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey;
}

/** 文字入力中の要素にフォーカスがあるか。ショートカットを横取りしない判断に使う。 */
export function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable;
}
```

- [ ] **Step 4: テストを実行して通ることを確認する**

Run: `npx vitest run web/src/util/keys.test.ts`
Expected: PASS（9件）

- [ ] **Step 5: `Sheet` に Escape・`aria-modal`・スクロールの封じ込めを足す**

`web/src/components/Sheet.tsx` を変える。import に `useEffect` を足す。

```tsx
import { useEffect, type ReactNode } from "react";
import { isPlainKey } from "../util/keys";
```

`if (!open) return null;` の**前に** effect を置く（フックは早期 return より前に呼ぶ必要がある）。

```tsx
export function Sheet({ open, title, onClose, children }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (isPlainKey(e, "Escape")) onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;
```

`role="dialog"` の要素に `aria-modal` と `overscrollBehavior` を足す。

```tsx
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxHeight: "85vh",
          overflowY: "auto",
          // シート内のスクロールが端で背後のグリッドへ連鎖しないようにする。
          overscrollBehavior: "contain",
          background: "var(--surface)",
          borderRadius: "12px 12px 0 0",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
```

- [ ] **Step 6: `FilterBar` に `/` フォーカスの失敗するテストを書く**

`web/src/components/FilterBar.test.tsx` の `describe("FilterBar", ...)` に追加する。

```ts
  it("/ でクエリ入力へフォーカスする", () => {
    render(<FilterBar onOpenFilter={() => {}} onOpenDirectories={() => {}} />);
    const input = screen.getByPlaceholderText("検索");
    expect(document.activeElement).not.toBe(input);

    fireEvent.keyDown(document, { key: "/" });
    expect(document.activeElement).toBe(input);
  });

  it("入力中の / は横取りしない", () => {
    render(<FilterBar onOpenFilter={() => {}} onOpenDirectories={() => {}} />);
    const input = screen.getByPlaceholderText("検索");
    input.focus();

    // 入力欄にフォーカスがある状態の / は、文字入力としてそのまま通す。
    const e = new KeyboardEvent("keydown", { key: "/", bubbles: true, cancelable: true });
    input.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
  });

  it("修飾キー付きの / は無視する", () => {
    render(<FilterBar onOpenFilter={() => {}} onOpenDirectories={() => {}} />);
    const input = screen.getByPlaceholderText("検索");

    fireEvent.keyDown(document, { key: "/", metaKey: true });
    expect(document.activeElement).not.toBe(input);
  });
```

- [ ] **Step 7: テストを実行して失敗を確認する**

Run: `npx vitest run web/src/components/FilterBar.test.tsx`
Expected: FAIL。`/` を押してもフォーカスが移らない

- [ ] **Step 8: `FilterBar` に実装する**

import を足す。

```tsx
import { useEffect, useRef, useState } from "react";
import { isPlainKey, isTypingTarget } from "../util/keys";
```

コンポーネント内に ref と effect を足す。

```tsx
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!isPlainKey(e, "/") || isTypingTarget(e.target)) return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);
```

検索入力欄に `ref={inputRef}` を足す。

```tsx
        <input
          ref={inputRef}
          type="search"
          aria-label="検索"
          ...
```

- [ ] **Step 9: テストを実行して通ることを確認する**

Run: `npx vitest run web/src/components/FilterBar.test.tsx web/src/components/FilterSheet.test.tsx`
Expected: PASS

- [ ] **Step 10: 全テストと型チェック**

Run: `npm test && npx tsc --noEmit && pnpm -C web exec tsc --noEmit`
Expected: すべて PASS

- [ ] **Step 11: コミット**

```bash
git add web
git commit -m "$(cat <<'EOF'
feat(web): シートのEscape閉じと / でのクエリ入力フォーカスを追加

修飾キーは完全一致で判定し、入力中のキーは横取りしない。
シート内のスクロールは背後のグリッドへ連鎖させない。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: ビューアが使う純粋関数

**Files:**
- Create: `web/src/util/pickWidth.ts`, `web/src/util/pickWidth.test.ts`, `web/src/util/gesture.ts`, `web/src/util/gesture.test.ts`, `web/src/util/preloader.ts`, `web/src/util/preloader.test.ts`

**Interfaces:**
- Consumes: なし
- Produces:
  - `pickWidth.ts`: `ALLOWED_WIDTHS: readonly number[]`、`pickWidth(longEdgeCssPx: number, dpr: number): number`、`containedLongEdge(imgW, imgH, viewW, viewH): number`
  - `gesture.ts`: `type SwipeAction = "prev" | "next" | "none"`、`swipeAction(dx: number, dy: number, dtMs: number): SwipeAction`、`isTap(dx: number, dy: number, dtMs: number): boolean`、`distance(ax, ay, bx, by): number`、`pinchScale(startDist: number, dist: number, startScale: number): number`、`MAX_SCALE: number`
  - `preloader.ts`: `interface Preloader { preload(url: string): void }`、`createPreloader(makeImage?, max?): Preloader`

### 決定事項

**`w` は長辺の上限。** サーバは `img.resize(w, w, Lanczos3)` で長辺を `w` に収めるので、クライアントは「画面上で画像の長辺が何 CSS ピクセルになるか × devicePixelRatio」を要求する。上限は 2560（サーバが受け付ける最大値）。

**スワイプ判定の閾値**: 横移動 50px 以上、縦移動が横移動の 0.6 倍未満（斜めをスクロールと誤認しない）、800ms 以内。ゆっくり長く引きずるのはパンなので送らない。

**ピンチの倍率**: 1.0〜6.0 に収める。1.0 未満に縮められると画面から画像が消える。6 倍あればスマホで細部を見るには足りる。

**プリロードは URL 単位で重複を排除する。** サーバは同一画像への同時リクエストを single-flight していないので、同じ URL を2回投げるとリサイズが2回走る。直近 20 件を覚えておけば送り戻しの往復で二重に投げることはない。

- [ ] **Step 1: `pickWidth` の失敗するテストを書く**

`web/src/util/pickWidth.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { pickWidth, containedLongEdge, ALLOWED_WIDTHS } from "./pickWidth";

describe("pickWidth", () => {
  it("要求以上で最小の許可値を返す", () => {
    expect(pickWidth(100, 1)).toBe(640);
    expect(pickWidth(640, 1)).toBe(640);
    expect(pickWidth(641, 1)).toBe(1280);
  });

  it("devicePixelRatio を掛ける", () => {
    // スマホ縦 390px 幅・dpr 3 → 1170 を要求 → 1280 へ切り上げ
    expect(pickWidth(390, 3)).toBe(1280);
    // 同じ幅でも dpr 1 なら 640 で足りる
    expect(pickWidth(390, 1)).toBe(640);
  });

  it("2560 を超えたら 2560 に丸める", () => {
    // 1440px 幅・dpr 2 → 2880 を要求するが、サーバの上限は 2560
    expect(pickWidth(1440, 2)).toBe(2560);
    expect(pickWidth(4000, 3)).toBe(2560);
  });

  it("0 や負でも最小値を返す（レイアウト前の測定値を渡されても壊れない）", () => {
    expect(pickWidth(0, 2)).toBe(640);
    expect(pickWidth(-10, 2)).toBe(640);
  });

  it("許可値はサーバの ALLOWED_WIDTHS と同じ並び", () => {
    expect(ALLOWED_WIDTHS).toEqual([640, 1280, 1920, 2560]);
  });
});

describe("containedLongEdge", () => {
  it("横長の画像が横長の画面に収まるとき、画面幅が長辺になる", () => {
    // 3000x2000 を 1500x1000 に収める → 1500x1000。長辺は 1500
    expect(containedLongEdge(3000, 2000, 1500, 1000)).toBe(1500);
  });

  it("縦長の画像を横長の画面に収めると、画面の高さが長辺になる", () => {
    // 1000x3000 を 1500x900 に収める → 300x900。長辺は 900
    expect(containedLongEdge(1000, 3000, 1500, 900)).toBe(900);
  });

  it("画面より小さい画像でも、収める倍率で計算する（等倍で止めない）", () => {
    // 表示は拡大されるので、要求する解像度も拡大後の長辺で決める
    expect(containedLongEdge(100, 100, 800, 600)).toBe(600);
  });

  it("画像サイズが未知（0）なら画面の長辺を返す", () => {
    expect(containedLongEdge(0, 0, 1500, 900)).toBe(1500);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npx vitest run web/src/util/pickWidth.test.ts`
Expected: FAIL。`./pickWidth` が存在しない

- [ ] **Step 3: `pickWidth` を実装する**

`web/src/util/pickWidth.ts`:

```ts
/** サーバ（crates/server/src/resize.rs）が受け付ける値と一致させる。 */
export const ALLOWED_WIDTHS: readonly number[] = [640, 1280, 1920, 2560];

const MAX = ALLOWED_WIDTHS[ALLOWED_WIDTHS.length - 1];

/**
 * 要求する `w` を選ぶ。サーバの `w` は幅ではなく**長辺の上限**なので、
 * 渡すのは「画面上で画像の長辺が何 CSS ピクセルになるか」。
 */
export function pickWidth(longEdgeCssPx: number, dpr: number): number {
  const want = Math.min(Math.max(longEdgeCssPx, 0) * dpr, MAX);
  return ALLOWED_WIDTHS.find((w) => w >= want) ?? MAX;
}

/**
 * 画像を画面に「収めて」表示したときの長辺の CSS ピクセル数。
 * 画像サイズが分かる前（naturalWidth が 0）は画面の長辺で近似する。
 */
export function containedLongEdge(
  imgW: number,
  imgH: number,
  viewW: number,
  viewH: number,
): number {
  if (imgW <= 0 || imgH <= 0) return Math.max(viewW, viewH);
  const scale = Math.min(viewW / imgW, viewH / imgH);
  return Math.max(imgW * scale, imgH * scale);
}
```

- [ ] **Step 4: テストを実行して通ることを確認する**

Run: `npx vitest run web/src/util/pickWidth.test.ts`
Expected: PASS（9件）

- [ ] **Step 5: `gesture` の失敗するテストを書く**

`web/src/util/gesture.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { swipeAction, isTap, distance, pinchScale, MAX_SCALE } from "./gesture";

describe("swipeAction", () => {
  it("左へ十分引けば次へ", () => {
    expect(swipeAction(-120, 5, 200)).toBe("next");
  });

  it("右へ十分引けば前へ", () => {
    expect(swipeAction(120, 5, 200)).toBe("prev");
  });

  it("横移動が足りなければ送らない", () => {
    expect(swipeAction(-30, 0, 200)).toBe("none");
  });

  it("縦に流れていたら送らない（スクロールとの誤認を避ける）", () => {
    expect(swipeAction(-120, 100, 200)).toBe("none");
  });

  it("ゆっくり引きずったら送らない（パンとの誤認を避ける）", () => {
    expect(swipeAction(-120, 5, 2000)).toBe("none");
  });

  it("境界: ちょうど 50px は送る", () => {
    expect(swipeAction(-50, 0, 100)).toBe("next");
    expect(swipeAction(-49, 0, 100)).toBe("none");
  });
});

describe("isTap", () => {
  it("ほとんど動かず短ければタップ", () => {
    expect(isTap(2, 3, 120)).toBe(true);
    expect(isTap(0, 0, 0)).toBe(true);
  });

  it("動きすぎたらタップではない", () => {
    expect(isTap(20, 0, 120)).toBe(false);
    expect(isTap(0, 20, 120)).toBe(false);
  });

  it("長押しはタップではない", () => {
    expect(isTap(0, 0, 900)).toBe(false);
  });

  it("境界: 10px 未満・300ms 未満", () => {
    expect(isTap(9, 9, 299)).toBe(true);
    expect(isTap(10, 0, 100)).toBe(false);
    expect(isTap(0, 0, 300)).toBe(false);
  });
});

describe("distance", () => {
  it("2点間の距離を返す", () => {
    expect(distance(0, 0, 3, 4)).toBe(5);
  });

  it("同じ点なら 0", () => {
    expect(distance(7, 7, 7, 7)).toBe(0);
  });
});

describe("pinchScale", () => {
  it("指を広げると拡大する", () => {
    expect(pinchScale(100, 200, 1)).toBe(2);
  });

  it("指を縮めると縮小する", () => {
    expect(pinchScale(200, 100, 2)).toBe(1);
  });

  it("1 未満には縮まない", () => {
    expect(pinchScale(200, 10, 1)).toBe(1);
  });

  it("上限を超えない", () => {
    expect(pinchScale(10, 10000, 1)).toBe(MAX_SCALE);
  });

  it("開始距離が 0 なら倍率を変えない（測定できていない）", () => {
    expect(pinchScale(0, 100, 1.5)).toBe(1.5);
  });
});
```

- [ ] **Step 6: テストを実行して失敗を確認する**

Run: `npx vitest run web/src/util/gesture.test.ts`
Expected: FAIL。`./gesture` が存在しない

- [ ] **Step 7: `gesture` を実装する**

`web/src/util/gesture.ts`:

```ts
export type SwipeAction = "prev" | "next" | "none";

/** これ未満の横移動は送りとみなさない。 */
const MIN_DISTANCE = 50;
/** 縦移動が横移動のこの割合以上なら、スクロールの意図とみなして送らない。 */
const MAX_OFF_AXIS_RATIO = 0.6;
/** これより長くかかった動きはパンとみなして送らない。 */
const MAX_DURATION_MS = 800;

export const MAX_SCALE = 6;

/** 指の移動量から送り方向を決める。dx が負（左へ引いた）なら次の画像。 */
export function swipeAction(dx: number, dy: number, dtMs: number): SwipeAction {
  if (dtMs > MAX_DURATION_MS) return "none";
  const ax = Math.abs(dx);
  if (ax < MIN_DISTANCE) return "none";
  if (Math.abs(dy) >= ax * MAX_OFF_AXIS_RATIO) return "none";
  return dx < 0 ? "next" : "prev";
}

/** これ未満の移動と時間で指を離したらタップ（＝UI の表示切替）とみなす。 */
const TAP_SLOP = 10;
const TAP_DURATION_MS = 300;

export function isTap(dx: number, dy: number, dtMs: number): boolean {
  return Math.abs(dx) < TAP_SLOP && Math.abs(dy) < TAP_SLOP && dtMs < TAP_DURATION_MS;
}

export function distance(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(bx - ax, by - ay);
}

/**
 * 2本指の距離の比から倍率を出す。1 未満に縮むと画像が画面から消えるので下限を 1 に置く。
 * 開始距離が 0 のときは、まだ測れていないので倍率を変えない。
 */
export function pinchScale(startDist: number, dist: number, startScale: number): number {
  if (startDist <= 0) return startScale;
  const next = startScale * (dist / startDist);
  return Math.min(MAX_SCALE, Math.max(1, next));
}
```

- [ ] **Step 8: テストを実行して通ることを確認する**

Run: `npx vitest run web/src/util/gesture.test.ts`
Expected: PASS（17件）

- [ ] **Step 9: `preloader` の失敗するテストを書く**

`web/src/util/preloader.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createPreloader } from "./preloader";

function fakeImageFactory() {
  const created: { src: string }[] = [];
  const make = () => {
    const img = { src: "" } as HTMLImageElement;
    created.push(img);
    return img;
  };
  return { make, created };
}

describe("createPreloader", () => {
  it("URL ごとに1回だけ読み込む", () => {
    const f = fakeImageFactory();
    const p = createPreloader(f.make);

    p.preload("/api/image/1?w=1280");
    p.preload("/api/image/1?w=1280");
    p.preload("/api/image/2?w=1280");

    expect(f.created.map((i) => i.src)).toEqual([
      "/api/image/1?w=1280",
      "/api/image/2?w=1280",
    ]);
  });

  it("幅が違えば別の URL として読み込む", () => {
    const f = fakeImageFactory();
    const p = createPreloader(f.make);

    p.preload("/api/image/1?w=640");
    p.preload("/api/image/1?w=1280");

    expect(f.created).toHaveLength(2);
  });

  it("上限を超えたら古いものから忘れる", () => {
    const f = fakeImageFactory();
    const p = createPreloader(f.make, 2);

    p.preload("a");
    p.preload("b");
    p.preload("c"); // ここで a を忘れる
    p.preload("a"); // 忘れているので読み直す

    expect(f.created.map((i) => i.src)).toEqual(["a", "b", "c", "a"]);
  });

  it("覚えている間は読み直さない", () => {
    const f = fakeImageFactory();
    const p = createPreloader(f.make, 3);

    p.preload("a");
    p.preload("b");
    p.preload("a");

    expect(f.created).toHaveLength(2);
  });
});
```

- [ ] **Step 10: テストを実行して失敗を確認する**

Run: `npx vitest run web/src/util/preloader.test.ts`
Expected: FAIL。`./preloader` が存在しない

- [ ] **Step 11: `preloader` を実装する**

`web/src/util/preloader.ts`:

```ts
export interface Preloader {
  preload(url: string): void;
}

/**
 * 同じ URL を二重に読みにいかない小さな仕組み。
 * サーバは同一画像への同時リクエストを single-flight していないので、
 * 重複を投げるとリサイズが2回走る。送り戻しの往復で投げ直さない程度に覚えておく。
 */
export function createPreloader(
  makeImage: () => HTMLImageElement = () => new Image(),
  max = 20,
): Preloader {
  // Set は挿入順を保つので、先頭が最も古い。
  const seen = new Set<string>();

  return {
    preload(url) {
      if (seen.has(url)) return;
      if (seen.size >= max) {
        const oldest = seen.values().next().value;
        if (oldest !== undefined) seen.delete(oldest);
      }
      seen.add(url);
      makeImage().src = url;
    },
  };
}
```

- [ ] **Step 12: テストを実行して通ることを確認する**

Run: `npx vitest run web/src/util/`
Expected: PASS（gridLayout の既存分 + pickWidth 9 + gesture 17 + preloader 4）

- [ ] **Step 13: 全テストと型チェック**

Run: `npm test && npx tsc --noEmit && pnpm -C web exec tsc --noEmit`
Expected: すべて PASS

- [ ] **Step 14: コミット**

```bash
git add web
git commit -m "$(cat <<'EOF'
feat(web): ビューア用の純粋関数を追加

表示幅の選択（サーバの w は長辺の上限）・スワイプとピンチの判定・
プリロードの重複排除を、UIから切り離してテストする。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `Prefs` の検証とスライドショー設定の永続化

**Files:**
- Modify: `web/src/storage.ts`, `web/src/storage.test.ts`

**Interfaces:**
- Consumes: なし
- Produces:
  - `interface SlideshowPrefs { intervalSec: number; loop: boolean; shuffle: boolean }`
  - `Prefs` に `slideshow: SlideshowPrefs` が加わる
  - `INTERVAL_CHOICES: readonly number[]`（`[3, 5, 10, 30]`）
  - `sanitizePrefs(raw: unknown): Prefs`

### 決定事項

計画3のブランチ全体レビューで「`JSON.parse(raw) as Partial<Prefs>` は検証ではない」と指摘された。壊れた localStorage（`dirs: "abc"` など）が素通りして `dirsParam` で TypeError になり、「読み込みに失敗しました」に化ける。**フィールド単位で型を確かめ、おかしければ既定値へ落とす。**

同時に、未知のキーを取り込んで書き戻す挙動もここで止める。`sanitizePrefs` が既知のキーだけを組み立てるので、混入したゴミは次の保存で消える。

**スライドショーの間隔は選択肢から選ばせる**（3 / 5 / 10 / 30 秒）。自由入力にすると 0 秒や負値の検証が要るうえ、スマホでの入力が面倒。

- [ ] **Step 1: 失敗するテストを書く**

`web/src/storage.test.ts` に追加する（既存の5件はそのまま残す）。

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { loadPrefs, savePrefs, sanitizePrefs, DEFAULT_PREFS, INTERVAL_CHOICES } from "./storage";

describe("sanitizePrefs", () => {
  it("何も無ければ既定値", () => {
    expect(sanitizePrefs(undefined)).toEqual(DEFAULT_PREFS);
    expect(sanitizePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(sanitizePrefs("文字列")).toEqual(DEFAULT_PREFS);
  });

  it("正しい値はそのまま通す", () => {
    const p = sanitizePrefs({
      query: "rating:5",
      sort: "filename",
      dir: "asc",
      dirs: [1, 2],
      history: ["a", "b"],
      slideshow: { intervalSec: 10, loop: false, shuffle: true },
    });
    expect(p.query).toBe("rating:5");
    expect(p.sort).toBe("filename");
    expect(p.dir).toBe("asc");
    expect(p.dirs).toEqual([1, 2]);
    expect(p.history).toEqual(["a", "b"]);
    expect(p.slideshow).toEqual({ intervalSec: 10, loop: false, shuffle: true });
  });

  it("知らない sort / dir は既定値へ落とす", () => {
    expect(sanitizePrefs({ sort: "bogus" }).sort).toBe(DEFAULT_PREFS.sort);
    expect(sanitizePrefs({ dir: "sideways" }).dir).toBe(DEFAULT_PREFS.dir);
  });

  it("dirs は null と数値配列だけを受け付ける", () => {
    expect(sanitizePrefs({ dirs: null }).dirs).toBeNull();
    expect(sanitizePrefs({ dirs: [] }).dirs).toEqual([]);
    expect(sanitizePrefs({ dirs: "abc" }).dirs).toBeNull();
    expect(sanitizePrefs({ dirs: [1, "x", 3] }).dirs).toBeNull();
    expect(sanitizePrefs({ dirs: [1, NaN] }).dirs).toBeNull();
  });

  it("history は文字列配列だけを受け付ける", () => {
    expect(sanitizePrefs({ history: ["a"] }).history).toEqual(["a"]);
    expect(sanitizePrefs({ history: "a" }).history).toEqual([]);
    expect(sanitizePrefs({ history: [1, 2] }).history).toEqual([]);
  });

  it("間隔は選択肢に無ければ既定値へ落とす", () => {
    expect(sanitizePrefs({ slideshow: { intervalSec: 7 } }).slideshow.intervalSec).toBe(
      DEFAULT_PREFS.slideshow.intervalSec,
    );
    expect(sanitizePrefs({ slideshow: { intervalSec: 0 } }).slideshow.intervalSec).toBe(
      DEFAULT_PREFS.slideshow.intervalSec,
    );
    expect(sanitizePrefs({ slideshow: { intervalSec: 30 } }).slideshow.intervalSec).toBe(30);
  });

  it("知らないキーは落とす", () => {
    const p = sanitizePrefs({ query: "x", bogus: 1 });
    expect(p.query).toBe("x");
    expect("bogus" in p).toBe(false);
  });

  it("間隔の選択肢", () => {
    expect(INTERVAL_CHOICES).toEqual([3, 5, 10, 30]);
  });
});

describe("loadPrefs（検証つき）", () => {
  beforeEach(() => localStorage.clear());

  it("壊れた値が入っていても既定値へ落ちる", () => {
    localStorage.setItem("gim.web.prefs", JSON.stringify({ dirs: "abc", sort: "bogus" }));
    const p = loadPrefs();
    expect(p.dirs).toBeNull();
    expect(p.sort).toBe(DEFAULT_PREFS.sort);
  });

  it("保存すると知らないキーが消える", () => {
    localStorage.setItem("gim.web.prefs", JSON.stringify({ query: "x", bogus: 1 }));
    savePrefs({ sort: "filename" });
    const raw = JSON.parse(localStorage.getItem("gim.web.prefs")!);
    expect(raw.query).toBe("x");
    expect(raw.sort).toBe("filename");
    expect("bogus" in raw).toBe(false);
  });

  it("スライドショー設定を読み書きできる", () => {
    savePrefs({ slideshow: { intervalSec: 30, loop: false, shuffle: true } });
    expect(loadPrefs().slideshow).toEqual({ intervalSec: 30, loop: false, shuffle: true });
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npx vitest run web/src/storage.test.ts`
Expected: FAIL。`sanitizePrefs` と `INTERVAL_CHOICES` が存在しない

- [ ] **Step 3: 実装する**

`web/src/storage.ts` を次の内容にする。

```ts
import type { SortKey, SortDir } from "@gim/shared/types";

export interface SlideshowPrefs {
  intervalSec: number;
  loop: boolean;
  shuffle: boolean;
}

export interface Prefs {
  query: string;
  sort: SortKey;
  dir: SortDir;
  /** null=未指定（サーバの visible に従う）／[]=0件／配列=指定ID。 */
  dirs: number[] | null;
  history: string[];
  slideshow: SlideshowPrefs;
}

/** 自由入力にすると 0 秒や負値の検証が要るうえ、スマホでの入力が面倒。 */
export const INTERVAL_CHOICES: readonly number[] = [3, 5, 10, 30];

const SORT_KEYS: readonly string[] = ["filename", "created", "modified"];
const SORT_DIRS: readonly string[] = ["asc", "desc"];

export const DEFAULT_PREFS: Prefs = {
  query: "",
  sort: "created",
  dir: "desc",
  dirs: null,
  history: [],
  slideshow: { intervalSec: 5, loop: true, shuffle: false },
};

export const HISTORY_MAX = 50;

const KEY = "gim.web.prefs";

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
}

function asNumberArrayOrNull(v: unknown): number[] | null {
  if (v === null) return null;
  if (!Array.isArray(v)) return null;
  return v.every((x) => typeof x === "number" && Number.isFinite(x)) ? (v as number[]) : null;
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : [];
}

function asBool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

/**
 * 保存内容をフィールド単位で検証して `Prefs` を組み立てる。
 * 型が違う値をそのまま通すと、`dirs: "abc"` のようなゴミが実行時エラーになって
 * 「読み込みに失敗しました」に化ける。既知のキーだけを組み立てるので、
 * 混入した未知のキーは次の保存で消える。
 */
export function sanitizePrefs(raw: unknown): Prefs {
  const r = asRecord(raw);
  const s = asRecord(r.slideshow);
  const intervalSec = typeof s.intervalSec === "number" && INTERVAL_CHOICES.includes(s.intervalSec)
    ? s.intervalSec
    : DEFAULT_PREFS.slideshow.intervalSec;

  return {
    query: typeof r.query === "string" ? r.query : DEFAULT_PREFS.query,
    sort: SORT_KEYS.includes(r.sort as string) ? (r.sort as SortKey) : DEFAULT_PREFS.sort,
    dir: SORT_DIRS.includes(r.dir as string) ? (r.dir as SortDir) : DEFAULT_PREFS.dir,
    dirs: asNumberArrayOrNull(r.dirs),
    history: asStringArray(r.history),
    slideshow: {
      intervalSec,
      loop: asBool(s.loop, DEFAULT_PREFS.slideshow.loop),
      shuffle: asBool(s.shuffle, DEFAULT_PREFS.slideshow.shuffle),
    },
  };
}

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return sanitizePrefs(undefined);
    return sanitizePrefs(JSON.parse(raw));
  } catch {
    return sanitizePrefs(undefined);
  }
}

export function savePrefs(patch: Partial<Prefs>): void {
  const next = { ...loadPrefs(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // プライベートブラウジング等で書けなくても、閲覧そのものは続けられるべき。
  }
}
```

`sanitizePrefs(undefined)` は毎回新しいオブジェクトを返すので、`{ ...DEFAULT_PREFS }` のような複製は要らない（`DEFAULT_PREFS` 自体が呼び出し側へ漏れない）。

- [ ] **Step 4: テストを実行して通ることを確認する**

Run: `npx vitest run web/src/storage.test.ts`
Expected: PASS（既存5件 + 新規12件）

- [ ] **Step 5: 全テストと型チェック**

Run: `npm test && npx tsc --noEmit && pnpm -C web exec tsc --noEmit`
Expected: すべて PASS。`Prefs` にフィールドが増えたが、`DEFAULT_PREFS` を通す既存のテストは影響を受けないはず。もし `toEqual(DEFAULT_PREFS)` を使うテストが落ちたら、それは既定値の比較なので通るはずであり、落ちたなら実装側の誤り

- [ ] **Step 6: コミット**

```bash
git add web
git commit -m "$(cat <<'EOF'
feat(web): 保存内容をフィールド単位で検証しスライドショー設定を足す

型が違う値を通すと実行時エラーになって「読み込みに失敗しました」に
化けるため、既知のキーだけを組み立て直す。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `useViewerStore`

**Files:**
- Create: `web/src/store/useViewerStore.ts`, `web/src/store/useViewerStore.test.ts`

**Interfaces:**
- Consumes: Task 4 の `loadPrefs` / `savePrefs` / `SlideshowPrefs`、`@gim/shared/playlist`
- Produces: `useViewerStore`（下記の状態とアクション）

### 決定事項

**位置は常に「再生順序 `order` 上の位置 `pos`」で持つ。** シャッフルしていないときの `order` は恒等列（`[0,1,2,…]`）なので `order[pos] === pos` になり、通常の送りもスライドショーも同じ経路を通る。ビューア用とスライドショー用で位置の持ち方を分けると、切り替えのたびに同期が要って壊れる。

表示中の画像は `results[order[pos]]`。

**`results` が伸びたら順序を作り直す。** 無限スクロールで `loadMore` が走ると `results.length` が増えるので、`syncLength` で作り直し、いま見ている画像のインデックスを新しい順序の中から探して `pos` を合わせる。

**シャッフルの種は呼び出し側から渡せるようにする。** 既定は `Date.now()`。テストで固定できないと順序が毎回変わって検証できない。

**非ループで末尾に到達したら再生を止める。** `step` の `stop` がそれを教えてくれる。

- [ ] **Step 1: 失敗するテストを書く**

`web/src/store/useViewerStore.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { useViewerStore } from "./useViewerStore";

beforeEach(() => {
  localStorage.clear();
  useViewerStore.setState({
    open: false,
    order: [],
    pos: 0,
    scale: 1,
    chromeVisible: true,
    playing: false,
    intervalSec: 5,
    loop: true,
    shuffle: false,
  });
});

describe("openAt", () => {
  it("シャッフル無しなら恒等順序で、指定した位置を開く", () => {
    useViewerStore.getState().openAt(3, 10);
    const s = useViewerStore.getState();
    expect(s.open).toBe(true);
    expect(s.order).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(s.pos).toBe(3);
    expect(s.scale).toBe(1);
  });

  it("シャッフル時も、開いた画像が最初に表示される", () => {
    useViewerStore.setState({ shuffle: true });
    useViewerStore.getState().openAt(7, 20, 12345);
    const s = useViewerStore.getState();
    expect(s.order).toHaveLength(20);
    expect(new Set(s.order).size).toBe(20);
    expect(s.order[s.pos]).toBe(7);
  });

  it("空の一覧では開かない", () => {
    useViewerStore.getState().openAt(0, 0);
    expect(useViewerStore.getState().open).toBe(false);
  });
});

describe("go", () => {
  it("次へ進む", () => {
    useViewerStore.getState().openAt(0, 5);
    useViewerStore.getState().go(1);
    expect(useViewerStore.getState().pos).toBe(1);
  });

  it("前へ戻る", () => {
    useViewerStore.getState().openAt(2, 5);
    useViewerStore.getState().go(-1);
    expect(useViewerStore.getState().pos).toBe(1);
  });

  it("ループ時は末尾から先頭へ折り返す", () => {
    useViewerStore.setState({ loop: true });
    useViewerStore.getState().openAt(4, 5);
    useViewerStore.getState().go(1);
    expect(useViewerStore.getState().pos).toBe(0);
  });

  it("非ループで末尾に達したら再生を止める", () => {
    useViewerStore.setState({ loop: false });
    useViewerStore.getState().openAt(4, 5);
    useViewerStore.setState({ playing: true });
    useViewerStore.getState().go(1);
    const s = useViewerStore.getState();
    expect(s.pos).toBe(4);
    expect(s.playing).toBe(false);
  });

  it("送ると拡大は解除される", () => {
    useViewerStore.getState().openAt(0, 5);
    useViewerStore.getState().setScale(3);
    useViewerStore.getState().go(1);
    expect(useViewerStore.getState().scale).toBe(1);
  });
});

describe("syncLength", () => {
  it("件数が変わらなければ何もしない", () => {
    useViewerStore.getState().openAt(2, 5);
    const before = useViewerStore.getState().order;
    useViewerStore.getState().syncLength(5);
    expect(useViewerStore.getState().order).toBe(before);
  });

  it("件数が増えても、見ている画像を見失わない", () => {
    useViewerStore.getState().openAt(3, 5);
    expect(useViewerStore.getState().order[useViewerStore.getState().pos]).toBe(3);

    useViewerStore.getState().syncLength(200);
    const s = useViewerStore.getState();
    expect(s.order).toHaveLength(200);
    expect(s.order[s.pos]).toBe(3);
  });

  it("件数が減って見ていた画像が消えたら先頭へ寄せる", () => {
    useViewerStore.getState().openAt(8, 10);
    useViewerStore.getState().syncLength(3);
    const s = useViewerStore.getState();
    expect(s.order).toHaveLength(3);
    expect(s.pos).toBe(0);
  });

  it("0 件になったら閉じる", () => {
    useViewerStore.getState().openAt(1, 5);
    useViewerStore.getState().syncLength(0);
    expect(useViewerStore.getState().open).toBe(false);
  });
});

describe("スライドショー設定", () => {
  it("localStorage へ保存する", () => {
    useViewerStore.getState().setIntervalSec(30);
    useViewerStore.getState().setLoop(false);
    useViewerStore.getState().setShuffle(true, 999);

    const saved = JSON.parse(localStorage.getItem("gim.web.prefs")!);
    expect(saved.slideshow).toEqual({ intervalSec: 30, loop: false, shuffle: true });
  });

  it("シャッフルを切り替えると順序を作り直すが、見ている画像は変わらない", () => {
    useViewerStore.getState().openAt(4, 30);
    useViewerStore.getState().setShuffle(true, 42);

    const s = useViewerStore.getState();
    expect(s.order).toHaveLength(30);
    expect(s.order[s.pos]).toBe(4);
  });

  it("initPrefs で保存済みの設定を読む", () => {
    localStorage.setItem(
      "gim.web.prefs",
      JSON.stringify({ slideshow: { intervalSec: 10, loop: false, shuffle: true } }),
    );
    useViewerStore.getState().initPrefs();
    const s = useViewerStore.getState();
    expect(s.intervalSec).toBe(10);
    expect(s.loop).toBe(false);
    expect(s.shuffle).toBe(true);
  });
});

describe("close", () => {
  it("閉じると再生も止まる", () => {
    useViewerStore.getState().openAt(0, 5);
    useViewerStore.setState({ playing: true });
    useViewerStore.getState().close();
    const s = useViewerStore.getState();
    expect(s.open).toBe(false);
    expect(s.playing).toBe(false);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npx vitest run web/src/store/useViewerStore.test.ts`
Expected: FAIL。`./useViewerStore` が存在しない

- [ ] **Step 3: 実装する**

`web/src/store/useViewerStore.ts`:

```ts
import { create } from "zustand";
import { buildOrder, mulberry32, step } from "@gim/shared/playlist";
import { loadPrefs, savePrefs } from "../storage";

interface ViewerState {
  open: boolean;
  /** results 上のインデックス列。シャッフル時は並びが変わる。 */
  order: number[];
  /** order 上の位置。表示中の画像は results[order[pos]]。 */
  pos: number;
  scale: number;
  /** 上下のバーを出すか。画像をタップするたびに切り替わる。 */
  chromeVisible: boolean;
  playing: boolean;
  intervalSec: number;
  loop: boolean;
  shuffle: boolean;

  initPrefs: () => void;
  openAt: (index: number, length: number, seed?: number) => void;
  close: () => void;
  go: (delta: 1 | -1) => void;
  syncLength: (length: number) => void;
  setScale: (s: number) => void;
  toggleChrome: () => void;
  play: () => void;
  pause: () => void;
  setIntervalSec: (sec: number) => void;
  setLoop: (v: boolean) => void;
  setShuffle: (v: boolean, seed?: number) => void;
}

function makeOrder(length: number, shuffle: boolean, seed: number): number[] {
  return buildOrder(length, shuffle, mulberry32(seed));
}

export const useViewerStore = create<ViewerState>((set, get) => ({
  open: false,
  order: [],
  pos: 0,
  scale: 1,
  chromeVisible: true,
  playing: false,
  intervalSec: 5,
  loop: true,
  shuffle: false,

  initPrefs: () => {
    const { slideshow } = loadPrefs();
    set({
      intervalSec: slideshow.intervalSec,
      loop: slideshow.loop,
      shuffle: slideshow.shuffle,
    });
  },

  openAt: (index, length, seed = Date.now()) => {
    if (length <= 0) return;
    const order = makeOrder(length, get().shuffle, seed);
    const pos = Math.max(0, order.indexOf(index));
    set({ open: true, order, pos, scale: 1, chromeVisible: true });
  },

  close: () => set({ open: false, playing: false, scale: 1 }),

  go: (delta) => {
    const { pos, order, loop } = get();
    const r = step(pos, order.length, loop, delta);
    // 送ったら拡大は解除する。拡大したまま次へ行くと、
    // どこを見ているのか分からない状態で切り替わる。
    set({ pos: r.pos, scale: 1 });
    if (r.stop) set({ playing: false });
  },

  syncLength: (length) => {
    const { order, pos, shuffle } = get();
    if (length === order.length) return;
    if (length <= 0) {
      set({ open: false, playing: false, order: [], pos: 0 });
      return;
    }
    const current = order[pos];
    const next = makeOrder(length, shuffle, Date.now());
    const nextPos = current === undefined ? 0 : Math.max(0, next.indexOf(current));
    set({ order: next, pos: nextPos });
  },

  setScale: (s) => set({ scale: s }),

  toggleChrome: () => set({ chromeVisible: !get().chromeVisible }),

  play: () => set({ playing: true }),

  pause: () => set({ playing: false }),

  setIntervalSec: (sec) => {
    set({ intervalSec: sec });
    const { loop, shuffle } = get();
    savePrefs({ slideshow: { intervalSec: sec, loop, shuffle } });
  },

  setLoop: (v) => {
    set({ loop: v });
    const { intervalSec, shuffle } = get();
    savePrefs({ slideshow: { intervalSec, loop: v, shuffle } });
  },

  setShuffle: (v, seed = Date.now()) => {
    const { order, pos, intervalSec, loop } = get();
    set({ shuffle: v });
    savePrefs({ slideshow: { intervalSec, loop, shuffle: v } });
    if (order.length === 0) return;
    // 並びを作り直しても、いま見ている画像はそのまま見せ続ける。
    const current = order[pos];
    const next = makeOrder(order.length, v, seed);
    set({ order: next, pos: Math.max(0, next.indexOf(current)) });
  },
}));
```

- [ ] **Step 4: テストを実行して通ることを確認する**

Run: `npx vitest run web/src/store/useViewerStore.test.ts`
Expected: PASS（17件）

- [ ] **Step 5: 全テストと型チェック**

Run: `npm test && npx tsc --noEmit && pnpm -C web exec tsc --noEmit`
Expected: すべて PASS

- [ ] **Step 6: コミット**

```bash
git add web
git commit -m "$(cat <<'EOF'
feat(web): ビューアの位置と再生設定を持つストアを追加

位置は常に再生順序上の位置で持ち、通常の送りとスライドショーで
同じ経路を通す。件数が増えても見ている画像を見失わない。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: ビューアの骨格

**Files:**
- Create: `web/src/components/Viewer.tsx`, `web/src/components/Viewer.test.tsx`
- Modify: `web/src/components/ImageGrid.tsx`, `web/src/components/ImageGrid.test.tsx`, `web/src/App.tsx`, `web/src/theme.css`

**Interfaces:**
- Consumes: Task 3 の `pickWidth` / `containedLongEdge` / `createPreloader`、Task 5 の `useViewerStore`
- Produces: `<Viewer />`（props 無し。ストアだけを見る）

### 決定事項

**ビューアは props を取らない。** 開閉も位置も `useViewerStore` にあるので、`App` は `<Viewer />` を置くだけ。閉じているときは `null` を返す。

**サムネイルは `<button>` で包む。** `<img>` の `onClick` だけだとキーボードで到達できず、タップ対象としても曖昧になる。

**画像は2枚先まで先読みする。** spec が「次の2枚を `new Image()` でプリロード」と定めている。先読みも同じ `w` を要求しないと別のキャッシュエントリになって無駄になるので、要求幅の計算を共有する。

**要求する `w` は画面サイズと画像サイズから決める。** サーバの `w` は長辺の上限なので、`containedLongEdge` で「収めて表示したときの長辺」を出し、`pickWidth` で許可値へ丸める。画像サイズが分かる前（`naturalWidth` が 0）は画面の長辺で近似するので、最初に少し大きめを取ることがあるが、`ImageDto` が `width` / `height` を持っているのでそちらを使えば初回から正確に決まる。

このタスクではまだピンチもスワイプも入れない（Task 7）。送りはボタンで行う。

- [ ] **Step 1: 失敗するテストを書く**

`web/src/components/Viewer.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { Viewer } from "./Viewer";
import { useViewerStore } from "../store/useViewerStore";
import { useQueryStore } from "../store/useQueryStore";
import * as imagesApi from "../api/images";

function rows(from: number, count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: from + i,
    filename: `f${from + i}.png`,
    width: 832,
    height: 1216,
    rating: null,
    created_at: 1000,
    modified_at: 1000,
    source_tool: "a1111",
    model: null,
  }));
}

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(imagesApi, "listImages").mockResolvedValue([]);
  vi.spyOn(imagesApi, "countImages").mockResolvedValue({ total: 0 });
  useQueryStore.setState({ results: rows(1, 5), total: 5, exhausted: true, loading: false });
  useViewerStore.setState({
    open: false,
    order: [],
    pos: 0,
    scale: 1,
    chromeVisible: true,
    playing: false,
    intervalSec: 5,
    loop: true,
    shuffle: false,
  });
});

afterEach(() => vi.restoreAllMocks());

describe("Viewer", () => {
  it("閉じているときは何も描かない", () => {
    const { container } = render(<Viewer />);
    expect(container.firstChild).toBeNull();
  });

  it("開くと画像とファイル名と位置を出す", () => {
    useViewerStore.getState().openAt(2, 5);
    render(<Viewer />);

    expect(screen.getByAltText("f3.png")).toBeTruthy();
    expect(screen.getByText("3 / 5")).toBeTruthy();
  });

  it("次へボタンで送る", () => {
    useViewerStore.getState().openAt(0, 5);
    render(<Viewer />);

    fireEvent.click(screen.getByLabelText("次へ"));
    expect(useViewerStore.getState().pos).toBe(1);
    expect(screen.getByAltText("f2.png")).toBeTruthy();
  });

  it("前へボタンで戻る", () => {
    useViewerStore.getState().openAt(2, 5);
    render(<Viewer />);

    fireEvent.click(screen.getByLabelText("前へ"));
    expect(useViewerStore.getState().pos).toBe(1);
  });

  it("閉じるボタンで閉じる", () => {
    useViewerStore.getState().openAt(0, 5);
    render(<Viewer />);

    fireEvent.click(screen.getByLabelText("閉じる"));
    expect(useViewerStore.getState().open).toBe(false);
  });

  it("画像をタップするとバーの表示が切り替わる", () => {
    useViewerStore.getState().openAt(0, 5);
    render(<Viewer />);

    expect(useViewerStore.getState().chromeVisible).toBe(true);
    fireEvent.click(screen.getByAltText("f1.png"));
    expect(useViewerStore.getState().chromeVisible).toBe(false);
  });

  it("結果が変わったら順序を合わせ直す", () => {
    useViewerStore.getState().openAt(0, 5);
    render(<Viewer />);

    // 描画後にストアを書き換えると React の更新が走るので act で包む。
    // 包まないと「An update to Viewer inside a test was not wrapped in act(...)」の
    // 警告が出て、テスト出力が汚れる。
    act(() => {
      useQueryStore.setState({ results: rows(1, 12), total: 12 });
    });
    expect(useViewerStore.getState().order).toHaveLength(12);
  });

  it("末尾に近づいたら追加読み込みを促す", async () => {
    const spy = vi.spyOn(imagesApi, "listImages").mockResolvedValue([]);
    useQueryStore.setState({ results: rows(1, 10), total: 100, exhausted: false });
    useViewerStore.getState().openAt(8, 10);
    render(<Viewer />);

    await vi.waitFor(() => expect(spy).toHaveBeenCalled());
  });
});
```

`web/src/components/ImageGrid.test.tsx` に追加する。

```tsx
  it("サムネイルを押すとビューアが開く", () => {
    useQueryStore.setState({ results: rows(1, 3), total: 3, exhausted: true, error: null });
    render(<ImageGrid />);

    fireEvent.click(screen.getAllByRole("button")[0]);
    expect(useViewerStore.getState().open).toBe(true);
    expect(useViewerStore.getState().order[useViewerStore.getState().pos]).toBe(0);
  });
```

（`useViewerStore` の import と、`beforeEach` での `useViewerStore.setState({ open: false, order: [], pos: 0 })` を足すこと。`rows` は既存のテストにあるヘルパを使う。無ければ `Viewer.test.tsx` と同じものを定義する。）

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npx vitest run web/src/components/Viewer.test.tsx`
Expected: FAIL。`./Viewer` が存在しない

- [ ] **Step 3: `Viewer` を実装する**

`web/src/components/Viewer.tsx`:

```tsx
import { useEffect, useMemo } from "react";
import { useQueryStore } from "../store/useQueryStore";
import { useViewerStore } from "../store/useViewerStore";
import { imageUrl } from "../api/images";
import { containedLongEdge, pickWidth } from "../util/pickWidth";
import { createPreloader } from "../util/preloader";
import { buttonStyle } from "../ui";

/** 末尾からこの枚数以内に来たら次のページを取りにいく。 */
const LOAD_MORE_MARGIN = 5;
/** 何枚先まで先読みするか。 */
const PRELOAD_AHEAD = 2;

export function Viewer() {
  const open = useViewerStore((s) => s.open);
  const order = useViewerStore((s) => s.order);
  const pos = useViewerStore((s) => s.pos);
  const chromeVisible = useViewerStore((s) => s.chromeVisible);
  const close = useViewerStore((s) => s.close);
  const go = useViewerStore((s) => s.go);
  const toggleChrome = useViewerStore((s) => s.toggleChrome);
  const syncLength = useViewerStore((s) => s.syncLength);

  const results = useQueryStore((s) => s.results);
  const exhausted = useQueryStore((s) => s.exhausted);
  const loadMore = useQueryStore((s) => s.loadMore);

  const preloader = useMemo(() => createPreloader(), []);

  // 一覧が伸び縮みしたら再生順序を作り直す。
  useEffect(() => {
    syncLength(results.length);
  }, [results.length, syncLength]);

  // 末尾に近づいたら次のページを取る。ビューアだけで 17,000 枚を送れるように。
  useEffect(() => {
    if (!open || exhausted) return;
    if (pos >= order.length - LOAD_MORE_MARGIN) void loadMore();
  }, [open, exhausted, pos, order.length, loadMore]);

  const image = open ? results[order[pos]] : undefined;

  // 先読み。表示中と同じ幅を要求しないと別のキャッシュエントリになって無駄になる。
  useEffect(() => {
    if (!open) return;
    for (let i = 1; i <= PRELOAD_AHEAD; i++) {
      const next = results[order[pos + i]];
      if (next) preloader.preload(imageUrl(next.id, widthFor(next.width, next.height)));
    }
  }, [open, order, pos, results, preloader]);

  if (!open || !image) return null;

  const src = imageUrl(image.id, widthFor(image.width, image.height));

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 20,
        background: "var(--bg-media)",
        display: "flex",
        flexDirection: "column",
        // 画像を送るたびに文字選択が走ると、長押しで選択ハンドルが出て邪魔になる。
        userSelect: "none",
        WebkitUserSelect: "none",
      }}
    >
      {chromeVisible && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "env(safe-area-inset-top, 0px) 12px 8px",
            background: "var(--surface)",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <button type="button" aria-label="閉じる" onClick={close} style={buttonStyle}>
            閉じる
          </button>
          <span style={{ color: "var(--text-dim)", fontSize: 13 }}>
            {`${pos + 1} / ${order.length}`}
          </span>
          <span
            style={{
              flex: 1,
              color: "var(--text-dim)",
              fontSize: 13,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {image.filename}
          </span>
        </div>
      )}

      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
        }}
      >
        <img
          src={src}
          alt={image.filename}
          onClick={toggleChrome}
          decoding="async"
          style={{
            maxWidth: "100%",
            maxHeight: "100%",
            objectFit: "contain",
            display: "block",
          }}
        />
      </div>

      {chromeVisible && (
        <div
          style={{
            display: "flex",
            gap: 8,
            padding: "8px 12px",
            paddingBottom: "calc(8px + env(safe-area-inset-bottom, 0px))",
            background: "var(--surface)",
            borderTop: "1px solid var(--border)",
          }}
        >
          <button
            type="button"
            aria-label="前へ"
            onClick={() => go(-1)}
            style={{ ...buttonStyle, flex: 1 }}
          >
            ‹
          </button>
          <button
            type="button"
            aria-label="次へ"
            onClick={() => go(1)}
            style={{ ...buttonStyle, flex: 1 }}
          >
            ›
          </button>
        </div>
      )}
    </div>
  );
}

/** 画面に収めて表示したときの長辺から、要求する w を決める。 */
function widthFor(imgW: number, imgH: number): number {
  const longEdge = containedLongEdge(imgW, imgH, window.innerWidth, window.innerHeight);
  return pickWidth(longEdge, window.devicePixelRatio || 1);
}
```

- [ ] **Step 4: `ImageGrid` からビューアを開けるようにする**

`web/src/components/ImageGrid.tsx` の import に足す。

```tsx
import { useViewerStore } from "../store/useViewerStore";
```

コンポーネント内でアクションを取る。

```tsx
  const openAt = useViewerStore((s) => s.openAt);
```

サムネイルの `<img>` を `<button>` で包む。`rowItems.map` の中身を次のように変える。

```tsx
              {rowItems.map((img, i) => (
                <button
                  key={img.id}
                  type="button"
                  onClick={() => openAt(start + i, results.length)}
                  style={{
                    padding: 0,
                    border: "none",
                    background: "none",
                    cursor: "pointer",
                    display: "block",
                    lineHeight: 0,
                  }}
                >
                  <img
                    src={thumbUrl(img.id)}
                    alt={img.filename}
                    loading="lazy"
                    decoding="async"
                    style={{
                      width: "100%",
                      aspectRatio: "1 / 1",
                      objectFit: "cover",
                      display: "block",
                      background: "var(--surface)",
                    }}
                  />
                </button>
              ))}
```

`start` は既存の `const start = vrow.index * columns;` をそのまま使う。

- [ ] **Step 5: `App` にビューアを重ねる**

`web/src/App.tsx` に import と要素を足す。ビューアは全画面のオーバーレイなので、シートと同じく末尾に置く。あわせて起動時にスライドショー設定を読む。

```tsx
import { Viewer } from "./components/Viewer";
import { useViewerStore } from "./store/useViewerStore";
```

```tsx
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
```

- [ ] **Step 6: テストを実行して通ることを確認する**

Run: `npx vitest run web/src/components/`
Expected: PASS（Viewer 8件 + ImageGrid の既存 + 新規1件 + 他）

`Viewer.test.tsx` は jsdom で動くので `window.innerWidth` は 1024、`devicePixelRatio` は 1 になる。画像は 832x1216 なので `containedLongEdge(832, 1216, 1024, 768) = 768` → `pickWidth(768, 1) = 1280`。テストは `src` の中身を主張していないので、この値に依存しない。

- [ ] **Step 7: 全テストと型チェック**

Run: `npm test && npx tsc --noEmit && pnpm -C web exec tsc --noEmit`
Expected: すべて PASS

- [ ] **Step 8: 実ブラウザで確認する**

```bash
SCRATCH=/private/tmp/claude-501/-Users-ikomiki-workspace-gen-img-manager/8f950c77-754c-4f61-89cf-177cd1c0192e/scratchpad
cargo build -p gim-server
./target/debug/gim-server --port 5180 > "$SCRATCH/t6-server.log" 2>&1 &
SPID=$!
pnpm -C web dev > "$SCRATCH/t6-web.log" 2>&1 &
sleep 8
curl -s -o /dev/null -w "devserver: %{http_code}\n" http://127.0.0.1:5181/
kill $SPID 2>/dev/null
lsof -ti tcp:5181 | xargs kill 2>/dev/null
sleep 1
lsof -ti tcp:5180 -ti tcp:5181   # 何も出なければ後片付け完了
grep "api/image/" "$SCRATCH/t6-server.log" | head
```

**`cargo run -p gim-server &` を使わないこと。** `$!` が cargo の PID になり、kill してもサーバの子プロセスが孤立して生き残る（過去に事故が起きている）。一時ファイルは `/tmp` ではなく `$SCRATCH` を使うこと。

ブラウザでの目視（サムネイルをタップして全画面で開く、送りボタンで進む、タップでバーが消える）はコントローラが引き取る。**目視部分が未実施であることをレポートに明記すること。**

- [ ] **Step 9: コミット**

```bash
git add web
git commit -m "$(cat <<'EOF'
feat(web): 全画面ビューアを追加

一覧の上にオーバーレイとして重ね、送りボタンで前後に移動する。
末尾に近づくと追加読み込みを促し、次の2枚を先読みする。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: ピンチズームとスワイプ送り

**Files:**
- Create: `web/src/components/ZoomableImage.tsx`, `web/src/components/ZoomableImage.test.tsx`
- Modify: `web/src/components/Viewer.tsx`

**Interfaces:**
- Consumes: Task 3 の `swipeAction` / `isTap` / `distance` / `pinchScale`、Task 5 の `useViewerStore`
- Produces: `<ZoomableImage src alt onTap onSwipe onLoaded? />`

```tsx
interface Props {
  src: string;
  alt: string;
  /** 拡大していないときの1本指の短い操作。 */
  onTap: () => void;
  /** 拡大していないときの1本指の横方向の払い。 */
  onSwipe: (action: "prev" | "next") => void;
  /** 画像の読み込みが終わった。Task 8 のスライドショーが計時開始に使う。 */
  onLoaded?: () => void;
}
```

`onLoaded` はこのタスクでは誰も渡さないが、Task 8 で使うので今のうちに口だけ開けておく（`<img>` の `onLoad` に繋ぐだけなので、後から足すより配線が1箇所で済む）。

### 決定事項

**Pointer Events で統一する。** `touch*` と `mouse*` を別々に扱うと PC とスマホでコードが二重になる。コンテナに `touchAction: "none"` を置いてブラウザ自身のパン・ズームを止め、こちらで判定する。

**拡大していないとき（`scale === 1`）だけスワイプで送る。** 拡大中の1本指はパン。拡大したままスワイプで送れると、拡大して細部を見ている最中に指を滑らせただけで画像が飛ぶ。

**ズームは `transform: scale()` と `translate()` で行う。** 画像要素自体のサイズは変えないので、レイアウトが再計算されず滑らかに動く。

**倍率が 1 に戻ったら位置もリセットする。** 拡大を解いたのに画像が画面外にいる状態を作らない。

**`ZoomableImage` は倍率をストアに書き戻す。** `Viewer` の送りボタンや `go` が倍率を 1 に戻すので、ストアが唯一の正である必要がある。位置（`translate`）はビューアの外に持ち出す意味がないのでコンポーネントのローカル状態に置く。

- [ ] **Step 1: 失敗するテストを書く**

`web/src/components/ZoomableImage.test.tsx`:

jsdom には Pointer Events の実装が無いので、`PointerEvent` を投げる代わりに React の合成イベントを `fireEvent.pointerDown` 等で発火させ、必要なプロパティを手で渡す。`setPointerCapture` / `releasePointerCapture` も無いのでスタブする。

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ZoomableImage } from "./ZoomableImage";
import { useViewerStore } from "../store/useViewerStore";

beforeEach(() => {
  useViewerStore.setState({ scale: 1 });
  // jsdom は Pointer Capture を実装していない。
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});

function renderImage(overrides: Partial<Parameters<typeof ZoomableImage>[0]> = {}) {
  const onTap = vi.fn();
  const onSwipe = vi.fn();
  render(<ZoomableImage src="/api/image/1?w=1280" alt="a.png" onTap={onTap} onSwipe={onSwipe} {...overrides} />);
  return { onTap, onSwipe, el: screen.getByAltText("a.png").parentElement! };
}

describe("ZoomableImage", () => {
  it("短く触れて離すとタップになる", () => {
    const { onTap, onSwipe, el } = renderImage();

    fireEvent.pointerDown(el, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(el, { pointerId: 1, clientX: 102, clientY: 101 });

    expect(onTap).toHaveBeenCalledTimes(1);
    expect(onSwipe).not.toHaveBeenCalled();
  });

  it("左へ払うと次へ", () => {
    const { onTap, onSwipe, el } = renderImage();

    fireEvent.pointerDown(el, { pointerId: 1, clientX: 300, clientY: 100 });
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 150, clientY: 105 });
    fireEvent.pointerUp(el, { pointerId: 1, clientX: 150, clientY: 105 });

    expect(onSwipe).toHaveBeenCalledWith("next");
    expect(onTap).not.toHaveBeenCalled();
  });

  it("右へ払うと前へ", () => {
    const { onSwipe, el } = renderImage();

    fireEvent.pointerDown(el, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 250, clientY: 105 });
    fireEvent.pointerUp(el, { pointerId: 1, clientX: 250, clientY: 105 });

    expect(onSwipe).toHaveBeenCalledWith("prev");
  });

  it("縦に流れた払いは送らない", () => {
    const { onSwipe, el } = renderImage();

    fireEvent.pointerDown(el, { pointerId: 1, clientX: 300, clientY: 100 });
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 150, clientY: 300 });
    fireEvent.pointerUp(el, { pointerId: 1, clientX: 150, clientY: 300 });

    expect(onSwipe).not.toHaveBeenCalled();
  });

  it("2本指を広げると拡大する", () => {
    const { el } = renderImage();

    fireEvent.pointerDown(el, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerDown(el, { pointerId: 2, clientX: 200, clientY: 100 });
    fireEvent.pointerMove(el, { pointerId: 2, clientX: 300, clientY: 100 });

    expect(useViewerStore.getState().scale).toBeCloseTo(2, 5);
  });

  it("拡大中は横に払っても送らない（パンとして扱う）", () => {
    useViewerStore.setState({ scale: 3 });
    const { onSwipe, el } = renderImage();

    fireEvent.pointerDown(el, { pointerId: 1, clientX: 300, clientY: 100 });
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 150, clientY: 100 });
    fireEvent.pointerUp(el, { pointerId: 1, clientX: 150, clientY: 100 });

    expect(onSwipe).not.toHaveBeenCalled();
  });

  it("倍率がストアに反映される", () => {
    useViewerStore.setState({ scale: 2.5 });
    const { el } = renderImage();
    const img = el.querySelector("img")!;
    expect(img.style.transform).toContain("scale(2.5)");
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npx vitest run web/src/components/ZoomableImage.test.tsx`
Expected: FAIL。`./ZoomableImage` が存在しない

- [ ] **Step 3: 実装する**

`web/src/components/ZoomableImage.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import { distance, isTap, pinchScale, swipeAction, type SwipeAction } from "../util/gesture";
import { useViewerStore } from "../store/useViewerStore";

interface Props {
  src: string;
  alt: string;
  /** 拡大していないときの1本指の短い操作。 */
  onTap: () => void;
  /** 拡大していないときの1本指の横方向の払い。 */
  onSwipe: (action: Exclude<SwipeAction, "none">) => void;
  /** 画像の読み込みが終わった。スライドショーの計時開始に使う。 */
  onLoaded?: () => void;
}

interface Point {
  x: number;
  y: number;
}

export function ZoomableImage({ src, alt, onTap, onSwipe, onLoaded }: Props) {
  const scale = useViewerStore((s) => s.scale);
  const setScale = useViewerStore((s) => s.setScale);

  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });

  // 押されている指。pointerId をキーに現在位置を持つ。
  const pointers = useRef(new Map<number, Point>());
  const startAt = useRef(0);
  const startPoint = useRef<Point>({ x: 0, y: 0 });
  const startOffset = useRef<Point>({ x: 0, y: 0 });
  const pinchStart = useRef<{ dist: number; scale: number } | null>(null);

  // 拡大を解いたのに画像が画面外にいる状態を作らない。
  useEffect(() => {
    if (scale === 1) setOffset({ x: 0, y: 0 });
  }, [scale]);

  // 別の画像に切り替わったら位置を戻す。
  useEffect(() => {
    setOffset({ x: 0, y: 0 });
  }, [src]);

  const twoPoints = (): [Point, Point] | null => {
    const pts = [...pointers.current.values()];
    return pts.length >= 2 ? [pts[0], pts[1]] : null;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    const pair = twoPoints();
    if (pair) {
      pinchStart.current = {
        dist: distance(pair[0].x, pair[0].y, pair[1].x, pair[1].y),
        scale,
      };
      return;
    }
    startAt.current = performance.now();
    startPoint.current = { x: e.clientX, y: e.clientY };
    startOffset.current = offset;
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    const pair = twoPoints();
    if (pair && pinchStart.current) {
      const d = distance(pair[0].x, pair[0].y, pair[1].x, pair[1].y);
      setScale(pinchScale(pinchStart.current.dist, d, pinchStart.current.scale));
      return;
    }
    // 拡大中の1本指はパン。拡大していないときは指を離すまで判断を保留する。
    if (scale > 1 && pointers.current.size === 1) {
      setOffset({
        x: startOffset.current.x + (e.clientX - startPoint.current.x),
        y: startOffset.current.y + (e.clientY - startPoint.current.y),
      });
    }
  };

  const endPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    const wasPinching = pointers.current.size >= 2;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchStart.current = null;
    if (wasPinching) return;

    if (scale > 1) return; // パンの終わり。送りもタップも起こさない。

    const dx = e.clientX - startPoint.current.x;
    const dy = e.clientY - startPoint.current.y;
    const dt = performance.now() - startAt.current;

    const action = swipeAction(dx, dy, dt);
    if (action !== "none") {
      onSwipe(action);
      return;
    }
    if (isTap(dx, dy, dt)) onTap();
  };

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
      style={{
        flex: 1,
        minHeight: 0,
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        // ブラウザ自身のパン・ズームを止めて、こちらの判定に一本化する。
        touchAction: "none",
      }}
    >
      <img
        src={src}
        alt={alt}
        decoding="async"
        onLoad={onLoaded}
        draggable={false}
        style={{
          maxWidth: "100%",
          maxHeight: "100%",
          objectFit: "contain",
          display: "block",
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
          // 拡大中に補間で滑らせると指の動きから遅れて気持ち悪い。
          transition: "none",
        }}
      />
    </div>
  );
}
```

- [ ] **Step 4: テストを実行して通ることを確認する**

Run: `npx vitest run web/src/components/ZoomableImage.test.tsx`
Expected: PASS（7件）

- [ ] **Step 5: `Viewer` を `ZoomableImage` に差し替える**

`web/src/components/Viewer.tsx` の import を足す。

```tsx
import { ZoomableImage } from "./ZoomableImage";
```

画像を包んでいた `<div>` と `<img>` を丸ごと次に置き換える。

```tsx
      <ZoomableImage
        src={src}
        alt={image.filename}
        onTap={toggleChrome}
        onSwipe={(a) => go(a === "next" ? 1 : -1)}
      />
```

`Viewer.test.tsx` の「画像をタップするとバーの表示が切り替わる」テストは、`fireEvent.click` では `ZoomableImage` の `onTap` を通らなくなる。次に差し替える。

```tsx
  it("画像をタップするとバーの表示が切り替わる", () => {
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
    useViewerStore.getState().openAt(0, 5);
    render(<Viewer />);

    const area = screen.getByAltText("f1.png").parentElement!;
    expect(useViewerStore.getState().chromeVisible).toBe(true);
    fireEvent.pointerDown(area, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(area, { pointerId: 1, clientX: 11, clientY: 10 });
    expect(useViewerStore.getState().chromeVisible).toBe(false);
  });
```

**スワイプで送るテストを `Viewer.test.tsx` に1件足す**（`ZoomableImage` と `Viewer` の結線を検証するのはここでしかできない）。

```tsx
  it("左へ払うと次の画像へ送る", () => {
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
    useViewerStore.getState().openAt(0, 5);
    render(<Viewer />);

    const area = screen.getByAltText("f1.png").parentElement!;
    fireEvent.pointerDown(area, { pointerId: 1, clientX: 300, clientY: 100 });
    fireEvent.pointerMove(area, { pointerId: 1, clientX: 150, clientY: 105 });
    fireEvent.pointerUp(area, { pointerId: 1, clientX: 150, clientY: 105 });

    expect(useViewerStore.getState().pos).toBe(1);
  });
```

- [ ] **Step 6: テストを実行して通ることを確認する**

Run: `npx vitest run web/src/components/`
Expected: PASS

- [ ] **Step 7: 全テストと型チェック**

Run: `npm test && npx tsc --noEmit && pnpm -C web exec tsc --noEmit`
Expected: すべて PASS

- [ ] **Step 8: コミット**

```bash
git add web
git commit -m "$(cat <<'EOF'
feat(web): ビューアにピンチズームとスワイプ送りを追加

Pointer Events で一本化し、拡大していないときだけ払いで送る。
拡大中の1本指はパンとして扱い、指を滑らせただけで画像が飛ばないようにする。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: スライドショー

**Files:**
- Create: `web/src/components/SlideshowSheet.tsx`, `web/src/components/SlideshowSheet.test.tsx`
- Modify: `web/src/components/Viewer.tsx`, `web/src/components/Viewer.test.tsx`, `web/src/components/ZoomableImage.tsx`

**Interfaces:**
- Consumes: Task 4 の `INTERVAL_CHOICES`、Task 5 の `useViewerStore`、Task 7 の `ZoomableImage`（`onLoaded`）
- Produces: `<SlideshowSheet open onClose />`

### 決定事項

**計時は「表示中の画像の読み込みが終わってから」始める。** 切り替えた瞬間から数え始めると、読み込みの遅い画像は表示時間を削られ、極端な場合は表示される前に次へ送られる。デスクトップ版もこの設計になっている。`ZoomableImage` の `onLoaded` がその合図。

**素の `setTimeout` を使う。** デスクトップ版の `src/hooks/useSlideTimer.ts` は `requestAnimationFrame` を回し続けて keep-alive 要素を毎フレーム動かしているが、あれは WKWebView が描画を止めると入力イベントが配送されなくなる macOS 固有の症状への対策で、通常のブラウザには不要な複雑さ。**持ち込まないこと。**

**再生中はバーを隠す。** 画面いっぱいで見たいので、再生を始めたら `chromeVisible` を false にする。タップで戻せる。

**再生中の送りは `go(1)`。** 非ループで末尾に達すると `step` の `stop` が立ち、`go` が `playing` を false にするので、タイマー側で終端を判定する必要はない。

- [ ] **Step 1: 失敗するテストを書く**

`web/src/components/SlideshowSheet.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SlideshowSheet } from "./SlideshowSheet";
import { useViewerStore } from "../store/useViewerStore";

beforeEach(() => {
  localStorage.clear();
  useViewerStore.setState({
    open: true,
    order: [0, 1, 2],
    pos: 0,
    scale: 1,
    chromeVisible: true,
    playing: false,
    intervalSec: 5,
    loop: true,
    shuffle: false,
  });
});

describe("SlideshowSheet", () => {
  it("間隔の選択肢を出し、現在値が選ばれている", () => {
    render(<SlideshowSheet open onClose={() => {}} />);
    expect((screen.getByLabelText("5秒") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("30秒") as HTMLInputElement).checked).toBe(false);
  });

  it("間隔を選ぶと保存される", () => {
    render(<SlideshowSheet open onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText("30秒"));

    expect(useViewerStore.getState().intervalSec).toBe(30);
    expect(JSON.parse(localStorage.getItem("gim.web.prefs")!).slideshow.intervalSec).toBe(30);
  });

  it("ループとシャッフルを切り替えられる", () => {
    render(<SlideshowSheet open onClose={() => {}} />);

    fireEvent.click(screen.getByLabelText("繰り返す"));
    expect(useViewerStore.getState().loop).toBe(false);

    fireEvent.click(screen.getByLabelText("順番をシャッフル"));
    expect(useViewerStore.getState().shuffle).toBe(true);
  });

  it("再生を始めるとシートが閉じ、バーも隠れる", () => {
    let open = true;
    const onClose = () => { open = false; };
    render(<SlideshowSheet open onClose={onClose} />);

    fireEvent.click(screen.getByText("再生"));

    expect(useViewerStore.getState().playing).toBe(true);
    expect(useViewerStore.getState().chromeVisible).toBe(false);
    expect(open).toBe(false);
  });
});
```

`web/src/components/Viewer.test.tsx` に追加する。

```tsx
  it("再生中は、画像の読み込み完了から間隔だけ経つと次へ送る", async () => {
    vi.useFakeTimers();
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
    useViewerStore.getState().openAt(0, 5);
    useViewerStore.setState({ playing: true, intervalSec: 5 });
    render(<Viewer />);

    // 読み込みが終わるまでは数え始めない。
    await vi.advanceTimersByTimeAsync(10_000);
    expect(useViewerStore.getState().pos).toBe(0);

    fireEvent.load(screen.getByAltText("f1.png"));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(useViewerStore.getState().pos).toBe(1);

    vi.useRealTimers();
  });

  it("停止中は送らない", async () => {
    vi.useFakeTimers();
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
    useViewerStore.getState().openAt(0, 5);
    render(<Viewer />);

    fireEvent.load(screen.getByAltText("f1.png"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(useViewerStore.getState().pos).toBe(0);

    vi.useRealTimers();
  });
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npx vitest run web/src/components/SlideshowSheet.test.tsx web/src/components/Viewer.test.tsx`
Expected: FAIL。`./SlideshowSheet` が存在せず、自動送りも動かない

- [ ] **Step 3: `SlideshowSheet` を実装する**

`web/src/components/SlideshowSheet.tsx`:

```tsx
import { useViewerStore } from "../store/useViewerStore";
import { INTERVAL_CHOICES } from "../storage";
import { Sheet } from "./Sheet";
import { buttonStyle } from "../ui";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function SlideshowSheet({ open, onClose }: Props) {
  const intervalSec = useViewerStore((s) => s.intervalSec);
  const loop = useViewerStore((s) => s.loop);
  const shuffle = useViewerStore((s) => s.shuffle);
  const setIntervalSec = useViewerStore((s) => s.setIntervalSec);
  const setLoop = useViewerStore((s) => s.setLoop);
  const setShuffle = useViewerStore((s) => s.setShuffle);
  const play = useViewerStore((s) => s.play);
  const toggleChrome = useViewerStore((s) => s.toggleChrome);
  const chromeVisible = useViewerStore((s) => s.chromeVisible);

  const start = () => {
    play();
    // 再生中は画面いっぱいで見たいのでバーを畳む。タップで戻せる。
    if (chromeVisible) toggleChrome();
    onClose();
  };

  return (
    <Sheet open={open} title="スライドショー" onClose={onClose}>
      <div style={{ fontSize: 13, color: "var(--text-dim)", marginBottom: 6 }}>間隔</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
        {INTERVAL_CHOICES.map((sec) => (
          <label key={sec} style={chipStyle(intervalSec === sec)}>
            <input
              aria-label={`${sec}秒`}
              type="radio"
              name="slideshow-interval"
              checked={intervalSec === sec}
              onChange={() => setIntervalSec(sec)}
              style={{ marginRight: 6 }}
            />
            {sec}秒
          </label>
        ))}
      </div>

      <label style={{ ...rowStyle }}>
        <input
          aria-label="繰り返す"
          type="checkbox"
          checked={loop}
          onChange={() => setLoop(!loop)}
        />
        <span>繰り返す</span>
      </label>

      <label style={{ ...rowStyle }}>
        <input
          aria-label="順番をシャッフル"
          type="checkbox"
          checked={shuffle}
          onChange={() => setShuffle(!shuffle)}
        />
        <span>順番をシャッフル</span>
      </label>

      <button
        type="button"
        onClick={start}
        style={{ ...buttonStyle, width: "100%", marginTop: 20, background: "var(--accent)" }}
      >
        再生
      </button>
    </Sheet>
  );
}

const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  minHeight: "var(--tap)",
  cursor: "pointer",
};

function chipStyle(active: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    minHeight: "var(--tap)",
    padding: "0 12px",
    background: active ? "var(--accent)" : "var(--surface-raised)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    cursor: "pointer",
  };
}
```

- [ ] **Step 4: `Viewer` に自動送りと再生ボタンを足す**

`web/src/components/Viewer.tsx` の import と state を足す。

```tsx
import { useEffect, useMemo, useState } from "react";
import { SlideshowSheet } from "./SlideshowSheet";
```

コンポーネント内に足す。

```tsx
  const playing = useViewerStore((s) => s.playing);
  const pause = useViewerStore((s) => s.pause);
  const intervalSec = useViewerStore((s) => s.intervalSec);

  const [slideshowOpen, setSlideshowOpen] = useState(false);
  // 表示中の画像が読み込み終わったか。読み込み前から数え始めると、
  // 遅い画像が表示時間を削られたり表示前に送られたりする。
  const [loadedPos, setLoadedPos] = useState<number | null>(null);

  useEffect(() => {
    if (!playing || loadedPos !== pos) return;
    const id = setTimeout(() => go(1), intervalSec * 1000);
    return () => clearTimeout(id);
  }, [playing, loadedPos, pos, intervalSec, go]);
```

`ZoomableImage` に `onLoaded` を渡す。

```tsx
      <ZoomableImage
        src={src}
        alt={image.filename}
        onTap={toggleChrome}
        onSwipe={(a) => go(a === "next" ? 1 : -1)}
        onLoaded={() => setLoadedPos(pos)}
      />
```

下部のバーに再生／停止のボタンを足す。

```tsx
          <button
            type="button"
            aria-label="前へ"
            onClick={() => go(-1)}
            style={{ ...buttonStyle, flex: 1 }}
          >
            ‹
          </button>
          <button
            type="button"
            aria-label={playing ? "停止" : "スライドショー"}
            onClick={() => (playing ? pause() : setSlideshowOpen(true))}
            style={{ ...buttonStyle, flex: 1 }}
          >
            {playing ? "■" : "▶"}
          </button>
          <button
            type="button"
            aria-label="次へ"
            onClick={() => go(1)}
            style={{ ...buttonStyle, flex: 1 }}
          >
            ›
          </button>
```

シートを末尾に置く（`</div>` の直前）。

```tsx
      <SlideshowSheet open={slideshowOpen} onClose={() => setSlideshowOpen(false)} />
```

- [ ] **Step 5: テストを実行して通ることを確認する**

Run: `npx vitest run web/src/components/`
Expected: PASS（SlideshowSheet 4件 + Viewer 12件 + 他）

- [ ] **Step 6: 全テストと型チェック**

Run: `npm test && npx tsc --noEmit && pnpm -C web exec tsc --noEmit`
Expected: すべて PASS

- [ ] **Step 7: コミット**

```bash
git add web
git commit -m "$(cat <<'EOF'
feat(web): スライドショーを追加

計時は表示中の画像の読み込み完了から始める。読み込みの遅い画像が
表示時間を削られたり、表示される前に送られたりするのを防ぐ。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: PC のキーボード操作と仕上げ

**Files:**
- Create: `web/src/components/Viewer.keyboard.test.tsx`
- Modify: `web/src/components/Viewer.tsx`

**Interfaces:**
- Consumes: Task 2 の `isPlainKey` / `isTypingTarget`、Task 5 の `useViewerStore`
- Produces: ビューアが開いている間、`←` `→` `Space` `F` `Escape` を受け付ける

### 決定事項

spec 177行目の「←→ で送り、Space で再生/停止、F でフルスクリーン」を実装する。`Escape` でビューアを閉じる。**修飾キーは完全一致で判定し、入力欄にフォーカスがあるときは横取りしない。**

**キーの購読はビューアが開いている間だけ。** 閉じているときに `←→` を奪うと、一覧のスクロールや入力欄のカーソル移動を壊す。

**`F` は Fullscreen API を叩く。** iOS Safari は要素の `requestFullscreen` を実装していないので、呼べないときは何もしない（例外で落とさない）。スマホではブラウザ UI を隠す手段が限られるため、この機能は PC 向けと割り切る。

`Space` はページスクロールの既定動作を持つので `preventDefault` する。

- [ ] **Step 1: 失敗するテストを書く**

`web/src/components/Viewer.keyboard.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Viewer } from "./Viewer";
import { useViewerStore } from "../store/useViewerStore";
import { useQueryStore } from "../store/useQueryStore";
import * as imagesApi from "../api/images";

function rows(from: number, count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: from + i,
    filename: `f${from + i}.png`,
    width: 832,
    height: 1216,
    rating: null,
    created_at: 1000,
    modified_at: 1000,
    source_tool: "a1111",
    model: null,
  }));
}

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(imagesApi, "listImages").mockResolvedValue([]);
  vi.spyOn(imagesApi, "countImages").mockResolvedValue({ total: 0 });
  useQueryStore.setState({ results: rows(1, 5), total: 5, exhausted: true, loading: false });
  useViewerStore.setState({
    open: false,
    order: [],
    pos: 0,
    scale: 1,
    chromeVisible: true,
    playing: false,
    intervalSec: 5,
    loop: true,
    shuffle: false,
  });
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});

afterEach(() => vi.restoreAllMocks());

describe("Viewer のキーボード操作", () => {
  it("→ で次へ、← で前へ", () => {
    useViewerStore.getState().openAt(2, 5);
    render(<Viewer />);

    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(useViewerStore.getState().pos).toBe(3);

    fireEvent.keyDown(document, { key: "ArrowLeft" });
    expect(useViewerStore.getState().pos).toBe(2);
  });

  it("Space で再生と停止を切り替える", () => {
    useViewerStore.getState().openAt(0, 5);
    render(<Viewer />);

    fireEvent.keyDown(document, { key: " " });
    expect(useViewerStore.getState().playing).toBe(true);

    fireEvent.keyDown(document, { key: " " });
    expect(useViewerStore.getState().playing).toBe(false);
  });

  it("Escape で閉じる", () => {
    useViewerStore.getState().openAt(0, 5);
    render(<Viewer />);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(useViewerStore.getState().open).toBe(false);
  });

  it("修飾キー付きは無視する", () => {
    useViewerStore.getState().openAt(2, 5);
    render(<Viewer />);

    fireEvent.keyDown(document, { key: "ArrowRight", metaKey: true });
    fireEvent.keyDown(document, { key: "ArrowRight", shiftKey: true });
    expect(useViewerStore.getState().pos).toBe(2);
  });

  it("閉じているときはキーを奪わない", () => {
    render(<Viewer />);
    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(useViewerStore.getState().open).toBe(false);
    expect(useViewerStore.getState().pos).toBe(0);
  });

  it("F はフルスクリーンを試みるが、使えない環境でも落ちない", () => {
    useViewerStore.getState().openAt(0, 5);
    render(<Viewer />);

    // jsdom は Fullscreen API を実装していない。例外にならないことだけを見る。
    expect(() => fireEvent.keyDown(document, { key: "f" })).not.toThrow();
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npx vitest run web/src/components/Viewer.keyboard.test.tsx`
Expected: FAIL。キーを押しても何も起きない

- [ ] **Step 3: 実装する**

`web/src/components/Viewer.tsx` の import に足す。

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { isPlainKey, isTypingTarget } from "../util/keys";
```

`play` と `pause` の両方を取る（`playing` はすでに取っている）。

```tsx
  const play = useViewerStore((s) => s.play);
```

ルート要素に ref を付けるため、コンポーネント内に置く。

```tsx
  const rootRef = useRef<HTMLDivElement>(null);
```

キーの購読を足す。**フックは早期 return より前に呼ぶ必要があるので、`if (!open || !image) return null;` より上に置くこと。**

```tsx
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (isPlainKey(e, "ArrowRight")) {
        e.preventDefault();
        go(1);
      } else if (isPlainKey(e, "ArrowLeft")) {
        e.preventDefault();
        go(-1);
      } else if (isPlainKey(e, " ")) {
        // Space はページスクロールの既定動作を持つ。
        e.preventDefault();
        if (useViewerStore.getState().playing) pause();
        else play();
      } else if (isPlainKey(e, "Escape")) {
        e.preventDefault();
        close();
      } else if (isPlainKey(e, "f")) {
        e.preventDefault();
        toggleFullscreen(rootRef.current);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, go, pause, play, close]);
```

ルートの `<div>` に `ref={rootRef}` を足す。

ファイル末尾に補助関数を足す。

```tsx
/** iOS Safari は要素のフルスクリーンを実装していない。使えない環境では何もしない。 */
function toggleFullscreen(el: HTMLElement | null): void {
  if (!el) return;
  try {
    if (document.fullscreenElement) void document.exitFullscreen?.();
    else void el.requestFullscreen?.();
  } catch {
    // フルスクリーンに入れなくても閲覧そのものは続けられる。
  }
}
```

`playing` を effect の依存に入れず `useViewerStore.getState().playing` で読むのは、`playing` が変わるたびにリスナを張り直さないため。

- [ ] **Step 4: テストを実行して通ることを確認する**

Run: `npx vitest run web/src/components/Viewer.keyboard.test.tsx`
Expected: PASS（6件）

- [ ] **Step 5: 全テストと型チェックとビルド**

Run: `npm test && npx tsc --noEmit && pnpm -C web exec tsc --noEmit && pnpm -C web build && cargo test --workspace`
Expected: すべて PASS

- [ ] **Step 6: 実ライブラリで確認する**

```bash
SCRATCH=/private/tmp/claude-501/-Users-ikomiki-workspace-gen-img-manager/8f950c77-754c-4f61-89cf-177cd1c0192e/scratchpad
cargo build -p gim-server
./target/debug/gim-server --port 5180 > "$SCRATCH/t9-server.log" 2>&1 &
SPID=$!
pnpm -C web dev > "$SCRATCH/t9-web.log" 2>&1 &
sleep 8
curl -s -o /dev/null -w "devserver: %{http_code}\n" http://127.0.0.1:5181/
curl -s -o /dev/null -w "image: %{http_code} %{content_type} %{size_download}B\n" \
  "http://127.0.0.1:5181/api/image/7764?w=1280"
kill $SPID 2>/dev/null
lsof -ti tcp:5181 | xargs kill 2>/dev/null
sleep 1
lsof -ti tcp:5180 -ti tcp:5181   # 何も出なければ後片付け完了
echo "=== サーバログ ==="; cat "$SCRATCH/t9-server.log"
```

**`cargo run -p gim-server &` を使わないこと。** 一時ファイルは `/tmp` ではなく `$SCRATCH` を使うこと。

ブラウザでの目視（サムネイルをタップして開く、スワイプで送る、ピンチで拡大、スライドショーの再生）はコントローラが実ブラウザで引き取る。**目視部分が未実施であることをレポートに明記すること。**

- [ ] **Step 7: コミット**

```bash
git add web
git commit -m "$(cat <<'EOF'
feat(web): ビューアのキーボード操作を追加

←→ で送り、Space で再生と停止、F でフルスクリーン、Escape で閉じる。
修飾キーは完全一致で判定し、入力中は横取りしない。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## 完了条件

- `cargo test --workspace` が緑（src-tauri 64 + gim-core 135 + gim-server 53）
- `npm test` が緑（計画3終了時点の 331 件 + この計画の新規分）
- `npx tsc --noEmit` と `pnpm -C web exec tsc --noEmit` が緑
- `pnpm -C web build` と `npm run build` が成功する
- `cargo clippy -p gim-server --all-targets` が `gim-server` 自身の警告ゼロ（`gim-core` の `type_complexity` 1件は計画1からの持ち越しでスコープ外）
- **スマホの実機で** `http://<LAN IP>:5181/` を開き、サムネイルをタップすると全画面で開き、左右のスワイプで送れ、ピンチで拡大でき、スライドショーが回る
- PC のブラウザで `←→` `Space` `F` `Escape` と `/` が効く
- デスクトップ版（`npm run tauri dev`）が従来通り動く。`src/` は1行も変更されていない

## 計画5への申し送り

計画3のブランチ全体レビューから引き継いだもののうち、この計画で扱わなかった項目:

- **`routes/mod.rs` の `.fallback(not_found)` は `rust-embed` の SPA fallback と正面衝突する。** API を `Router::nest("/api", …)` へ寄せるタスクを、埋め込みタスクより先に置くこと
- `rust-embed` による `web/dist` の埋め込みと `build.rs` での存在確認。埋め込み後は `gim-server` 単体で `http://<LAN IP>:5180/` を開けば一覧が出る状態にする
- **ドキュメントは独立したタスクとして置くこと**（計画2で漏れて最終レビューで指摘された）。`docs/usage.html` と同じトーンで web ビューア向けの HTML を1枚書き、README の docs 一覧と構成の概要に加える。**`docs/CLAUDE.md` はトーンの基準として `docs/master-import-usage.html` と `docs/index.html` を挙げているが、このリポジトリにはどちらも存在しない**（別プロジェクトから持ち込まれた記述）。実際の基準は `docs/usage.html` なので、`docs/CLAUDE.md` の該当箇所も直すこと
- `state.rs` / `fileserve.rs` / `resize.rs` の7箇所が `ApiError::Internal(format!("…{e}"))` で生のエラー文字列を応答本文に載せている。`error.rs` の `From<rusqlite::Error>` と同じ扱いへ揃える
- `images.rs` / `media.rs` の `Result<Query<T>, QueryRejection>` + `let Query(params) = params?;` の反復は、`#[derive(FromRequest)]` の `ApiQuery<T>` を1つ作れば揃う
- `hostcheck.rs` の `extract_hostname` は、閉じ括弧が無い／`]` の後に余分な文字が続く異常な `Host`（例: `[127.0.0.1]evil.example.com:5180`）を IP リテラルとして通す。`Host` はブラウザが script から設定できない forbidden header なので DNS リバインディングの脅威モデルでは到達不能だが、判定関数としては塞いでおく
- `ImageGrid.test.tsx` が `beforeEach` で `HTMLElement.prototype.offsetHeight` を `defineProperty` しており、`vi.restoreAllMocks()` では戻らない。他のテストファイルへ漏れうる
- `"check": "tsc --noEmit && pnpm -C web exec tsc --noEmit && vitest run"` のような入口を1つ用意する
- `FilterSheet` の `created` 欄は、範囲指定（`2026-01-01..2026-06-30`）が入っていると `type="date"` の欄が無言で空になる。「複雑な条件が設定されています」程度の注記があると事故が減る
- spec 186行目は localStorage を `gim.web.*` の個別キーに分けて保存すると書いているが、実装は `gim.web.prefs` の単一 blob。**spec 側を実装に合わせて直す**
- `tsconfig` の project references 化（`web/` が増えて単一 tsconfig では管理しきれなくなったら）


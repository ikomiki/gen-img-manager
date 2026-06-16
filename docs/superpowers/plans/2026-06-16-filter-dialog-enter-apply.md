# フィルタダイアログ Enter＝適用 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 詳細フィルタダイアログのテキスト/数値入力欄で Enter を押すと「適用」ボタン押下と同じ挙動になる（IME 変換確定の Enter は除外）。

**Architecture:** Enter 判定は純粋関数 `isApplyEnter` に切り出して vitest で網羅。`FilterDialog` のコンテナ `div` に `onKeyDown` を 1 箇所追加し、判定が true のとき既存の `apply()` を呼ぶ。select / DayPicker / 各 `<button>` 上の Enter はネイティブ挙動を維持。

**Tech Stack:** React 19 + TypeScript, vitest, @testing-library/react

---

## File Structure

- Create: `src/util/dialogKeys.ts` — Enter→適用 判定の純粋関数。1 つの責務。
- Create: `src/util/dialogKeys.test.ts` — 上記の vitest。
- Modify: `src/components/FilterDialog.tsx` — コンテナ div に `onKeyDown` を追加。
- Modify: `src/components/FilterDialog.test.tsx` — Enter 結合テストを追加。

---

### Task 1: Enter 判定の純粋関数 `isApplyEnter`

**Files:**
- Create: `src/util/dialogKeys.ts`
- Test: `src/util/dialogKeys.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`src/util/dialogKeys.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isApplyEnter } from "./dialogKeys";

const base = { key: "Enter", isComposing: false, keyCode: 13, tagName: "INPUT", inputType: "text" };

describe("isApplyEnter", () => {
  it("テキスト入力欄での Enter は true", () => {
    expect(isApplyEnter(base)).toBe(true);
  });

  it("数値入力欄での Enter は true", () => {
    expect(isApplyEnter({ ...base, inputType: "number" })).toBe(true);
  });

  it("IME 変換確定中（isComposing）は false", () => {
    expect(isApplyEnter({ ...base, isComposing: true })).toBe(false);
  });

  it("IME 変換確定中（keyCode 229）は false", () => {
    expect(isApplyEnter({ ...base, keyCode: 229 })).toBe(false);
  });

  it("Enter 以外のキーは false", () => {
    expect(isApplyEnter({ ...base, key: "a" })).toBe(false);
  });

  it("select 上の Enter は false", () => {
    expect(isApplyEnter({ ...base, tagName: "SELECT", inputType: "" })).toBe(false);
  });

  it("button 上の Enter は false", () => {
    expect(isApplyEnter({ ...base, tagName: "BUTTON", inputType: "" })).toBe(false);
  });

  it("text/number 以外の input（checkbox 等）は false", () => {
    expect(isApplyEnter({ ...base, inputType: "checkbox" })).toBe(false);
  });
});
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `npx vitest run src/util/dialogKeys.test.ts`
Expected: FAIL（`isApplyEnter` が存在しない）

- [ ] **Step 3: 最小実装を書く**

`src/util/dialogKeys.ts`:

```ts
/** isApplyEnter の入力。KeyboardEvent から必要な値だけ抜き出した形。 */
export interface ApplyEnterInput {
  /** KeyboardEvent.key。 */
  key: string;
  /** 変換確定途中か（KeyboardEvent.isComposing / nativeEvent.isComposing）。 */
  isComposing: boolean;
  /** KeyboardEvent.keyCode。IME 変換中は多くの環境で 229。 */
  keyCode: number;
  /** イベント発生元要素の tagName（大文字、例 "INPUT"）。 */
  tagName: string;
  /** 発生元が <input> のときの type 属性。それ以外は ""。 */
  inputType: string;
}

/**
 * フィルタダイアログで Enter を「適用」とみなすか。
 * テキスト/数値入力欄での Enter のみ true。IME 変換確定の Enter（isComposing / keyCode 229）は除外。
 * select・DayPicker・各 <button> 上の Enter はネイティブ挙動を維持するため false。
 */
export function isApplyEnter(e: ApplyEnterInput): boolean {
  if (e.key !== "Enter") return false;
  if (e.isComposing || e.keyCode === 229) return false;
  if (e.tagName !== "INPUT") return false;
  return e.inputType === "text" || e.inputType === "number";
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/util/dialogKeys.test.ts`
Expected: PASS（8 件）

- [ ] **Step 5: コミット**

```bash
git add src/util/dialogKeys.ts src/util/dialogKeys.test.ts
git commit -m "feat(filter): フィルタダイアログのEnter適用判定の純粋関数を追加"
```

---

### Task 2: `FilterDialog` に Enter→適用 を配線

**Files:**
- Modify: `src/components/FilterDialog.tsx`（import 追加、コンテナ div に `onKeyDown`）
- Test: `src/components/FilterDialog.test.tsx`（結合テスト追加）

- [ ] **Step 1: 失敗するテストを書く**

`src/components/FilterDialog.test.tsx` の `describe("FilterDialog", () => {` 内末尾（`});` の直前）に追加:

```ts
  it("テキスト入力欄での Enter で適用される", () => {
    const setQuery = vi.fn();
    const onClose = vi.fn();
    useQueryStore.setState({ setQuery, runQuery: vi.fn().mockResolvedValue(undefined) });
    render(<FilterDialog onClose={onClose} />);
    const input = screen.getByLabelText("プロンプト");
    fireEvent.change(input, { target: { value: "forest" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(setQuery).toHaveBeenCalled();
  });

  it("IME 変換確定中の Enter では適用しない", () => {
    const setQuery = vi.fn();
    useQueryStore.setState({ setQuery, runQuery: vi.fn().mockResolvedValue(undefined) });
    render(<FilterDialog onClose={() => {}} />);
    const input = screen.getByLabelText("プロンプト");
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(setQuery).not.toHaveBeenCalled();
  });

  it("レーティング下限 select 上の Enter では適用しない", () => {
    const setQuery = vi.fn();
    useQueryStore.setState({ setQuery, runQuery: vi.fn().mockResolvedValue(undefined) });
    render(<FilterDialog onClose={() => {}} />);
    fireEvent.keyDown(screen.getByLabelText("レーティング下限"), { key: "Enter" });
    expect(setQuery).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `npx vitest run src/components/FilterDialog.test.tsx -t "Enter"`
Expected: FAIL（「テキスト入力欄での Enter で適用される」が setQuery 未呼び出しで落ちる）

- [ ] **Step 3: import を追加**

`src/components/FilterDialog.tsx` の import 群（`ratingFilter` の import の後ろ）に追加:

```ts
import { isApplyEnter } from "../util/dialogKeys";
```

- [ ] **Step 4: コンテナ div に `onKeyDown` を追加**

`src/components/FilterDialog.tsx` の `apply` 関数（`const apply = async () => { ... };`）の直後に、ハンドラを定義:

```tsx
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    const inputType = t instanceof HTMLInputElement ? t.type : "";
    if (
      isApplyEnter({
        key: e.key,
        isComposing: e.nativeEvent.isComposing,
        keyCode: e.nativeEvent.keyCode,
        tagName: t.tagName,
        inputType,
      })
    ) {
      e.preventDefault();
      void apply();
    }
  };
```

続いて、ダイアログ本体の要素にハンドラを付ける。次の行を:

```tsx
      <div className="dialog filter-dialog">
```

このように変更:

```tsx
      <div className="dialog filter-dialog" onKeyDown={onKeyDown}>
```

- [ ] **Step 5: テストが通ることを確認**

Run: `npx vitest run src/components/FilterDialog.test.tsx`
Expected: PASS（既存 + 追加 3 件すべて）

- [ ] **Step 6: 型チェックとコミット**

Run: `npx tsc --noEmit`
Expected: エラーなし

```bash
git add src/components/FilterDialog.tsx src/components/FilterDialog.test.tsx
git commit -m "feat(filter): 詳細フィルタダイアログでEnterを適用ボタンと同等に扱う"
```

---

## Self-Review メモ

- **Spec coverage**: 機能B の「テキスト/数値入力欄のみ」「IME 除外」「select・DayPicker・button 除外」は Task 1 の純粋関数と Task 2 の配線で網羅。
- **手動確認（任意）**: `npm run tauri dev` で詳細フィルタを開き、プロンプト欄に日本語を入力して変換確定の Enter で閉じないこと、確定後の Enter で適用されることを確認。

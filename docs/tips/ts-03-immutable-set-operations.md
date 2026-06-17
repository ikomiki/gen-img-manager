# TypeScript: 非破壊 Set 操作による複数選択管理

## 問題

`Set<number>` を直接変更すると Zustand のストアが変化を検知できず再レンダリングが起きない。

## 解決策

選択集合の操作は**非破壊の純粋関数**として切り出す。

```ts
// src/util/selection.ts

/** anchor..index（両端含む）の範囲選択 */
export function rangeSet(anchor: number, index: number): Set<number> {
  const lo = Math.min(anchor, index);
  const hi = Math.max(anchor, index);
  const out = new Set<number>();
  for (let i = lo; i <= hi; i++) out.add(i);
  return out;
}

/** Cmd/Ctrl+クリックによるトグル（非破壊） */
export function toggleInSet(set: Set<number>, index: number): Set<number> {
  const next = new Set(set);  // 必ずコピー
  if (next.has(index)) next.delete(index);
  else next.add(index);
  return next;
}

/** 全選択 */
export function allIndices(count: number): Set<number> {
  const out = new Set<number>();
  for (let i = 0; i < count; i++) out.add(i);
  return out;
}

/** 一括削除後のアクティブ位置（削除後の末尾へクランプ） */
export function clampAfterDelete(removedMinIndex: number, remaining: number): number {
  if (remaining <= 0) return -1;
  return Math.min(removedMinIndex, remaining - 1);
}
```

## Zustand での使い方

```ts
// useViewerStore.ts
selectRange: (index) =>
  set((s) => ({
    selection: rangeSet(s.anchorIndex < 0 ? index : s.anchorIndex, index),
    selectedIndex: index,
  })),
```

## ポイント

- `new Set(set)` でコピーしてから変更し、新しい参照を返す
- 純粋関数化で vitest テストが容易になる（DOM 不要）
- `anchorIndex` をストアに持つことで Shift+クリックの範囲選択起点を管理する

## 参照

`src/util/selection.ts`, `src/util/selection.test.ts`, `src/store/useViewerStore.ts`

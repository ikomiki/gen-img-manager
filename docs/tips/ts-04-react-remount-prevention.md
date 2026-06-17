# React: 早期 return による DOM 再マウント問題と ResizeObserver

## 問題

`ResizeObserver` でコンテナ幅を監視する仮想スクロールグリッドで、条件によって早期 return でコンポーネントを切り替えると、React がツリー上の位置の変化を「別のコンポーネント」と判断して再マウントする。再マウントにより `ResizeObserver` が旧要素を監視し続け、新要素は幅 0 のまま更新されず、グリッドが**真っ白になる**。

```tsx
// 悪い例: width === 0 のとき別の JSX ツリーを返す
if (width === 0) {
  return <div className="image-grid" ref={parentRef} />;  // ← 別ツリー
}
return (
  <>
    {selection.size >= 1 && <SelectionBar />}  {/* ← これが増減するとずれる */}
    <div className="image-grid" ref={parentRef}>
      {/* ... */}
    </div>
  </>
);
```

`<SelectionBar>` の有無で `.image-grid` のツリー上の位置（兄弟順序）が変わるため、React は異なる要素と判断してアンマウント→再マウントする。

## 解決策

**`.image-grid` を常に同じ位置に置き、中身だけ条件分岐する**。

```tsx
// 良い例: .image-grid は常にルートに置く
return (
  <>
    {selection.size >= 1 && <SelectionBar />}
    <div className="image-grid" ref={parentRef}>
      {width > 0 && results.length === 0 && (
        <p className="placeholder-note">該当する画像がありません</p>
      )}
      {width > 0 && results.length > 0 && (
        <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
          {/* 仮想アイテム */}
        </div>
      )}
    </div>
  </>
);
```

## ポイント

- `ref` を付けた要素（ResizeObserver の対象）が再マウントされると observer は切れる
- 早期 return のパターンは「ツリーが単純化される」利点があるが、条件次第で兄弟ノードの位置がずれて再マウントを誘発する
- `key` prop を使って意図的に再マウントを制御する方法もあるが、今回は逆に「再マウントさせない」のが正解
- テストでは `jsdom` に `ResizeObserver` がないのでモックが必要（`MockResizeObserver` + `roCallbacks` パターン）

## 参照

`src/components/ImageGridPanel.tsx`, `src/components/ImageGridPanel.test.tsx`

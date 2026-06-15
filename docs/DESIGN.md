# 技術ドキュメント用デザインシステム仕様書 (Technical Documentation Design System Specifications)

> 本書は、技術ドキュメントおよびテクニカルリファレンスへの適用を目的とした、落ち着いた可読性の高いデザインシステムの仕様書です。
> 特定のプラットフォームに依存しない汎用的な設計とし、カラーパレットの彩度を低く抑えることで、長時間の読書でも疲労しにくいクリーンなインターフェースを定義します。
> 開発効率を高めるため、全面的に CSS Custom Properties（CSS変数）を採用した現代的な構成へと刷新しています。

---

## 1. Visual Theme & Atmosphere

- **デザイン方針**: 徹底したミニマリズムと余白の最適化。情報の認知的負荷を減らし、技術ドキュメントとしての正確性と可読性を最優先に設計します。
- **密度**: 本文の `line-height` は `1.8` とし、ゆったりとした十分な行間を確保します。文字とコードが混在する段落でもストレスのない読書体験を提供します。
- **キーワード**: ローサチュレーション（低彩度）、インテリジェント、プロダクティブ、ハイ・レジビリティ、洗練
- **特徴**: テキスト色にはコントラストを和らげるスレート調の不透明度（opacity）ベースの色、または十分にコントラスト比を確保した低彩度のダークカラーを採用します。文字詰め（`palt`）は行わず、等幅的な文字送り（`normal`）を維持することで、コード表現との一貫性を保ちます。

---

## 2. Color Palette & Roles

全体的に彩度（Saturation）を低く抑え、目に優しいスレート（泥灰岩）ブルーおよびクールグレーを基調としています。

### Primary（主要アクセントカラー）

- **Muted Slate Blue** (`#4a607a`): 知的で落ち着いたトーンのメインカラー。リンク、主要なCTA、重要なインターフェース要素に使用します。
- **Muted Slate Blue Dark** (`#35475b`): ホバー時、またはアクティブ状態を明示する際のプライマリカラー。

### Semantic（意図・状態を示す色）

- **Subdued Danger** (`#b84a56`): エラー、削除、警告度：高
- **Subdued Warning** (`#c48427`): 警告、注意喚起、保留
- **Subdued Success** (`#48856b`): 成功、完了、同期

### Neutral（基調色・ニュートラル）

- **Text Primary** (`rgba(15, 23, 42, 0.85)`): 本文テキスト。純黒を避け、わずかに青みを含んだ深いスレート色。
- **Text Secondary** (`rgba(15, 23, 42, 0.60)`): 補足テキスト、ラベル、メタデータ。
- **Text Disabled** (`rgba(15, 23, 42, 0.38)`): 無効状態のテキスト。
- **Border** (`#cfd8dc`): 区切り線、入力欄の枠、表の境界線。
- **Background** (`#f8fafc`): ページ全体の背景。完全な白を避け、眩しさを軽減。
- **Surface** (`#eff2f5`): コードブロック背景、カード背景、サイドナビゲーション。

---

## 3. Typography Rules

### 3.1 和文フォント
- **ゴシック体**: Hiragino Kaku Gothic ProN, Hiragino Sans, Meiryo, sans-serif

### 3.2 欧文フォント
- **サンセリフ**: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif
- **等幅（コード用）**: JetBrains Mono, SFMono-Regular, Consolas, Menlo, monospace

### 3.3 CSS Custom Properties & font-family 指定

```css
:root {
  --font-sans: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Hiragino Kaku Gothic ProN", "Hiragino Sans", Meiryo, sans-serif;
  --font-mono: "JetBrains Mono", "SFMono-Regular", Consolas, Menlo, monospace;
}

/* 本文 */
body {
  font-family: var(--font-sans);
}

/* コードブロック・インラインコード */
code, pre {
  font-family: var(--font-mono);
}
```

**フォールバック・実装の考え方**:
- 視認性の高い現代的な欧文フォント（Interなど）およびシステムフォントを先頭に配置。
- 和文フォント（ヒラギノ角ゴ等）で確実に日本語をカバー。
- 特殊な約物半角化フォントは使用せず、等幅感を維持することで記号の視認性を担保（約物は全角幅のまま表示）。

### 3.4 文字サイズ・ウェイト階層

| Role | Font | Size | Weight | Line Height | Letter Spacing | 備考 |
|------|------|------|--------|-------------|----------------|------|
| Title (h1) | Sans | 28px | 700 | 42px (1.5) | -0.02em | ドキュメントのタイトル |
| Heading 1 (h2) | Sans | 22px | 700 | 33px (1.5) | -0.01em | 大見出し（章） |
| Heading 2 (h3) | Sans | 18px | 600 | 27px (1.5) | 0 | 中見出し（節） |
| Body | Sans | 16px | 400 | 28.8px (1.8) | 0 | 本文（もっとも重要） |
| Label / Meta | Sans | 14px | 500 | 21px (1.5) | 0.01em | タグ、サイドバー項目 |
| Caption | Sans | 12px | 400 | 18px (1.5) | 0.02em | 注記、図表のキャプション |
| Code | Mono | 14px | 400 | 21px (1.5) | 0 | プログラム、設定値 |

### 3.5 行間・字間
- **本文の行間 (line-height)**: `1.8` — コードや数式が混じっても上下の行が衝突せず、流れるように読めるバランス。
- **見出しの行間**: `1.5` — 複数行に及んだ場合も締まりのあるレイアウトを保つ。
- **本文の字間 (letter-spacing)**: `normal`（または `0`）— 意図的な字詰めは行いません。

### 3.6 禁則処理・改行ルール
```css
word-break: break-word;
overflow-wrap: break-word;
```

### 3.7 OpenType 機能
```css
font-feature-settings: normal; /* palt（自動文字詰め）は適用しない */
```
技術文書における記号や空白のセマンティクスを保護するため、文字詰めを行わず一律の字送りを推奨します。

---

## 4. Component Stylings

コンポーネントの実装には、必ず設計された CSS Custom Properties を使用してください。

```css
:root {
  --color-primary: #4a607a;
  --color-primary-dark: #35475b;
  --color-border: #cfd8dc;
  --color-bg: #f8fafc;
  --color-surface: #eff2f5;
  --radius-md: 6px;
  --radius-lg: 8px;
  --transition-base: all 0.2s ease;
}
```

### Buttons

**Primary Button**
- Background: `var(--color-primary)`
- Text: `#ffffff`
- Padding: 8px 20px
- Border Radius: `var(--radius-md)`
- Font Size: 14px
- Font Weight: 600
- Transition: `var(--transition-base)`

**Secondary Button**
- Background: `transparent`
- Text: `var(--color-primary)`
- Border: `1px solid var(--color-primary)`
- Padding: 8px 20px
- Border Radius: `var(--radius-md)`

### Inputs

- Background: `#ffffff`
- Border: `1px solid var(--color-border)`
- Border (focus): `1px solid var(--color-primary)`
- Box Shadow (focus): `0 0 0 3px rgba(74, 96, 122, 0.15)`
- Border Radius: `var(--radius-md)`
- Padding: 8px 12px
- Font Size: 15px

### Cards / Panels

- Background: `#ffffff`
- Border: `1px solid var(--color-border)`
- Border Radius: `var(--radius-lg)`
- Padding: 24px
- Shadow: なし（フラットデザイン。ホバー時のみ極めて薄い影を付与）

---

## 5. Layout Principles

### Spacing Scale

| Token | Value | 用途 |
|-------|-------|------|
| space-xs | 4px | インライン要素の隙間 |
| space-sm | 8px | ボタン内のパディング、ラベルの間隔 |
| space-md | 16px | コンポーネント内の要素間、段落間 |
| space-lg | 24px | カードのパディング、ブロック間の余白 |
| space-xl | 42px | セクション間の余白 |
| space-xxl| 64px | 章レベルの大きな区切り |

### Container
- Max Width: `780px`（快適な読書のための1行あたりの最大文字数を考慮した記事本文幅）
- Layout Max Width: `1200px`（左右にサイドバーを含めた全体幅）

---

## 6. Depth & Elevation

| Level | Shadow | 用途 |
|-------|--------|------|
| elevation-0 | none | フラット（デフォルトのコンテンツ・カード） |
| elevation-1 | `0 2px 8px rgba(15, 23, 42, 0.05)` | ホバー時のカード、軽度な浮き出し |
| elevation-2 | `0 4px 16px rgba(15, 23, 42, 0.08)` | ツールチップ、ドロップダウンメニュー |
| elevation-3 | `0 12px 32px rgba(15, 23, 42, 0.12)` | モーダルウィンドウ、ダイアログ |

---

## 7. Do's and Don'ts

### Do（推奨）
- 拡張性と保守性を高めるため、色や余白の指定には必ず **CSS Custom Properties** を使用する。
- 読者の視線誘導をスムーズにするため、本文の `line-height: 1.8` を厳守する。
- 画面の眩しさを抑えコントラストを適正化するために、背景には純白ではなく `#f8fafc` などのオフホワイトを使用する。
- コードブロック内には、識別しやすい等幅フォント（`JetBrains Mono` など）を指定する。

### Don't（禁止）
- 彩度の高い鮮やかな原色（純粋な青、赤、緑など）をアクセントに使用しない。
- 視認性を著しく下げるため、日本語本文の `line-height` を `1.4` 以下に設定しない。
- 記号や欧米文字の正確な配置を崩す恐れがあるため、本文全体に文字詰め（`palt`）を強制適用しない。
- 認知的ノイズとなるため、過度なグラデーションや、大きく目立つドロップシャドウを多用しない。

---

## 8. Responsive Behavior

### Breakpoints

| Name | Width | 説明 |
|------|-------|------|
| Mobile | ≤ 640px | スマートフォン（シングルカラム、1カラム全面） |
| Tablet | ≤ 1024px | タブレット（サイドバー折りたたみ、または2カラム構成） |
| Desktop | > 1024px | デスクトップ（固定サイドナビゲーション ＋ メインコンテンツ） |

### フォントサイズ・余白の動的調整
- モバイル環境では本文サイズを最小でも `15px` に留め、大見出し（h1）を `24px` 程度に縮小して画面内に収めます。
- 画面幅に応じて、コンテナの左右パディングを `16px` (Mobile) から `24px` (Desktop) へと可変させます。

---

## 9. Agent Prompt Guide

### クイックリファレンス（AI実装用）

```css
/* AI実装時にコピー＆ペーストして使用するベース変数群 */
:root {
  --primary: #4a607a;
  --primary-hover: #35475b;
  --text-main: rgba(15, 23, 42, 0.85);
  --text-muted: rgba(15, 23, 42, 0.60);
  --bg-main: #f8fafc;
  --bg-surface: #eff2f5;
  --border-color: #cfd8dc;
  --font-sans: "Inter", -apple-system, sans-serif;
  --font-mono: "JetBrains Mono", monospace;
  --line-height-body: 1.8;
}
```

### プロンプト例

```
上記の技術ドキュメント用デザインシステム仕様に従って、APIリファレンスページのHTML/CSSテンプレートを作成してください。
- カラーはすべてCSS変数（--primary: #4a607a, --bg-main: #f8fafcなど）を用いて定義してください。
- 本文のフォントは可読性の高いサンセリフ、行間は line-height: 1.8 とし、等幅のコードブロックと美しく混植されるようにしてください。
- 彩度を抑えた、落ち着いたテクニカルドキュメントの雰囲気を表現してください。
```
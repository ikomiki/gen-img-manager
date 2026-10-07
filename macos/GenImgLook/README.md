# GenImgLook

AI 生成 PNG の画像とメタデータ（Prompt / Negative / モデル等・XMP レーティング）を表示する、Quick Look 風の macOS ビューアアプリです。Prompt / Negative をコピーできます。

## 必要なもの

- macOS 14 以上、Xcode
- xcodegen（`brew install xcodegen`）

## ビルドとテスト

```bash
cd macos/GenImgLook
xcodegen generate
xcodebuild -project GenImgLook.xcodeproj -scheme GenImgLook -destination 'platform=macOS' -derivedDataPath build test
xcodebuild -project GenImgLook.xcodeproj -scheme GenImgLook -configuration Release -derivedDataPath build build
```

## インストール

```bash
mkdir -p ~/Applications
rm -rf ~/Applications/GenImgLook.app
cp -R build/Build/Products/Release/GenImgLook.app ~/Applications/
```

Finder で PNG を右クリック →「このアプリケーションで開く」→ GenImgLook で開きます。「情報を見る」の「このアプリケーションで開く」で既定にもできます。

macOS 標準の Quick Look は PNG を自前で表示するため、Quick Look 拡張は提供していません。

## 使い方

- 右のサイドパネルにファイル名・サイズ・ツール・モデル・サンプラー・Steps・CFG・Seed・レーティングを表示します。
- Prompt / Negative（Prompt が無い場合は Parameters）の「コピー」でクリップボードにコピーし、「最大化」でパネル全体に表示します。
- レーティングは `画像.png.xmp`、無ければ `画像.xmp` の `xmp:Rating` から読みます（表示のみ）。
- パネルはツールバーのボタンで開閉します。開閉状態は記憶されます。
- Space または Esc でウィンドウを閉じます。
- ツールバーから共有、「プレビューで開く」ができます。

## 制限

- 対象は PNG のみです。
- ad-hoc 署名のローカルビルドを前提にしています。他の Mac への配布は想定していません。

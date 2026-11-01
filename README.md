<p align="center"><img src="icon.png" width="96" alt=""></p>

<h1 align="center">スクショくん / Snappy</h1>

<p align="center">どんなに長いページも、丸ごと 1 つの PDF に。<br>
Save any web page, however long, as one PDF.</p>

<p align="center">
<a href="https://satoru.net/app/screenshot-kun/">紹介ページ</a> ·
<a href="https://satoru.net/app/screenshot-kun/?lang=en">Website (English)</a> ·
<a href="https://satoru.net/app/screenshot-kun/privacy.html">プライバシーポリシー / Privacy</a> ·
<a href="LICENSE">MIT License</a>
</p>

---

## 日本語

ボタンひとつで、ページを上から下まで自動でスクロールして撮り、PDF・HTML・画像で保存できる Chrome 拡張機能です。画面の一部だけを撮ったり、録画や印刷をしたりもできます。

### できること
- **ページ全体**：上から下まで自動でスクロールして全部撮影
- **表示部分**：いま見えているところだけを撮影
- **選択範囲**：マウスでドラッグして囲んだところを撮影
- **録画**：画面の動きを動画（MP4 / WebM）で保存。範囲を選んで録ることも
- **印刷**：撮ったものを紙の大きさ（A4・レター）に分けて印刷
- **すぐ確認**：保存が終わると、その場で大きく表示
- **履歴**：保存したものをサムネ付きで一覧（オフにもできます）

### 特長
- 何万ピクセルもあるページでも、全体を 1 枚の巨大画像にせず 1 ページずつ処理するので最後まで保存できます
- 初期設定は劣化なし。画面のピクセルを 1 対 1 でつなぎ、表示倍率 125%・150% でもぼやけません
- 文字の途中で切れないよう、すき間の位置でページを区切ります
- 大きくなったら自動で複数のファイルに分けて保存します
- 日本語・英語に対応（ブラウザの言語に合わせて自動で切り替え）

### 入れ方
Chrome ウェブストアは審査中です。それまでは次の方法で入れられます。

1. [紹介ページ](https://satoru.net/app/screenshot-kun/) から zip をダウンロード（またはこのリポジトリを clone）
2. Chrome で `chrome://extensions` を開き、「デベロッパー モード」をオン
3. zip をその画面にドラッグ＆ドロップ（clone した場合は「パッケージ化されていない拡張機能を読み込む」でこのフォルダを選ぶ）

---

## English

A Chrome extension that scrolls a page from top to bottom for you and saves the whole thing as a PDF, HTML file or image — in one click. It can also capture just part of the screen, record video, and print.

### Features
- **Whole page** — scrolls automatically and captures everything
- **Visible area** — captures what you see right now
- **Selected area** — captures the area you drag out
- **Record** — saves the screen (and sound) as video, for the whole tab or an area
- **Print** — splits the capture into A4 / Letter pages and prints
- **Instant preview** — the result opens right away
- **History** — browse your captures with thumbnails (can be turned off)

### Install
The Chrome Web Store listing is under review. Until then:

1. Download the zip from the [website](https://satoru.net/app/screenshot-kun/?lang=en) (or clone this repository)
2. Open `chrome://extensions` and turn on “Developer mode”
3. Drag and drop the zip onto the page (or “Load unpacked” and choose this folder)

---

## しくみ / How it works

| ファイル / File | 役割 / Role |
|---|---|
| `manifest.json` | Manifest V3 |
| `background.js` | サービスワーカー。スクロールしながら `captureVisibleTab` で撮影、録画の開始・停止、保存と履歴 / Service worker: scroll & capture, recording control, saving and history |
| `offscreen.js` | 撮影した画面を 1 ページ分ずつ貼り合わせて圧縮し、PDF（自前で生成）・HTML・画像・zip にまとめる。録画は `MediaRecorder` / Builds PDF (hand-written writer), HTML, images and zip; records video with `MediaRecorder` |
| `popup.html` / `popup.js` | ポップアップと設定 / Popup and settings |
| `history.html` / `history.js` | 保存の履歴とライトボックス / History page and lightbox |
| `print.html` / `print.js` | 印刷用ページ / Print page |
| `store.js` | 履歴（`chrome.storage.local`）からの読み出し / Reading saved items |
| `i18n.js` / `_locales/` | 日本語・英語 / Japanese & English |

外部のライブラリやサーバーは使っていません。撮影・録画・ファイルの作成はすべてブラウザの中で行い、データを外部に送ることはありません。
No external libraries or servers are used. Everything runs locally in the browser, and no data is sent anywhere.

## ライセンス / License

[MIT](LICENSE) © 2026 [satoru.net](https://satoru.net/) · [@satorunet](https://x.com/satorunet)

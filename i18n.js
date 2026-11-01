// スクショくん — 表示言語（日本語 / 英語）
// 日本語の文字列をそのままキーにして、英語のときだけ置き換える。
// 言語は設定 lang（'auto' / 'ja' / 'en'）。auto はブラウザの言語が日本語なら日本語、それ以外は英語。

const EN = {
  // 共通
  'スクショくん': 'Snappy',
  '履歴': 'History', '画像': 'Image', '動画': 'Video', '印刷': 'Print', '設定': 'Settings', '中止': 'Cancel',
  '保存': 'Download', 'ダウンロード': 'Download', '削除': 'Delete', '開く': 'Open', 'すべて': 'All',
  'ページ全体': 'Whole page', '表示部分': 'Visible area', '選択範囲': 'Selected area', '部品': 'Element',
  '録画・表示部分': 'Video · visible area', '録画・範囲': 'Video · area', '・印刷用': ' · for print',
  'レター': 'Letter', 'A4 縦': 'A4 portrait', '縦長（A4 の 2 倍）': 'Tall (2 × A4)',
  '準備中…': 'Getting ready…', '中止しました': 'Cancelled', 'エラー: {0}': 'Error: {0}', '保存しています…': 'Saving…',
  '読み込み中…': 'Loading…', '(無題)': '(untitled)', '（その {0}）': ' (part {0})',
  // ポップアップ
  '保存の履歴を開く': 'Open saved history', '保存の履歴を開く（いまは履歴に残さない設定です）': 'Open saved history (history is turned off)',
  '静止画で保存': 'Save as image', '動画で保存': 'Save as video',
  '自動でスクロールしてページの最初から最後まで': 'Scrolls automatically from the top to the bottom of the page',
  'スクロール': 'Scrolls', '自動スクロール': 'Auto-scroll', 'いま画面に見えている部分': 'What you see on screen now', '見えている所': 'On screen',
  'ページ上をドラッグして範囲を選ぶ': 'Drag on the page to choose an area', 'ドラッグ': 'Drag',
  'マウスを乗せた部品（要素）を自動で選び、クリックで保存': 'Hover to pick a part of the page, click to save it', 'クリック': 'Click',
  '表示部分を録画': 'Record visible', 'タブの画面と音': 'Screen + sound', '範囲を録画': 'Record area', 'ドラッグで指定': 'Drag to choose',
  '録画を停止して保存': 'Stop and save',
  '履歴に残す': 'Keep history', '（履歴機能）': '',
  '保存先': 'Save to', 'ダウンロード ＋ 履歴': 'Downloads + history', 'ダウンロードだけ': 'Downloads only', '履歴だけ': 'History only',
  '画質': 'Quality', '劣化なし（おすすめ）': 'Lossless (recommended)', '高画質（少し軽い）': 'High (a bit smaller)', '軽量（ファイルを小さく）': 'Light (smallest files)',
  '解像度': 'Resolution', '画面そのまま（おすすめ）': 'Same as screen (recommended)', '1x（軽い）': '1x (smaller)',
  'PDF の 1 ページの形': 'PDF page shape',
  'ページの切れ目を余白に合わせる': 'Break pages at blank space', '固定ヘッダーは 1 枚目だけ写す': 'Show sticky headers on the first shot only',
  'スクロール後の待ち (ms)': 'Wait after scrolling (ms)', '最下部の読み込み待ち (ms)': 'Wait at the bottom (ms)', '最大の長さ (px, 0=無制限)': 'Max length (px, 0 = no limit)',
  '無限スクロールのページは「最大の長さ」で止めてください。': 'For endless pages, set a max length to stop.',
  '1 ファイルの上限（超えたら自動で分割）': 'Max file size (split automatically)', '録画でタブの音も録る': 'Record tab sound', '毎回保存先を選ぶ': 'Ask where to save each time',
  'ショートカット Alt+Shift+P：ページ全体を保存（録画中は停止）': 'Shortcut Alt+Shift+P: save the whole page (stops recording if recording)',
  '保存したらその場で表示': 'Show right after saving',
  '言語': 'Language', '自動（ブラウザに合わせる）': 'Auto (match browser)',
  'A4 などのページに分けた PDF。PDF ビューアでスクロールして読めます。': 'A PDF split into A4-sized pages. Scroll through it in any PDF viewer.',
  '撮影した画像（WebP）を縦に並べた 1 つの HTML。どのブラウザでも開けます。': 'One HTML file with the captured images (WebP) stacked. Opens in any browser.',
  '画像ファイル（WebP・PNG・JPEG は設定で選べます）。長いページは何枚かに分けて zip にまとめます。': 'Image file (choose WebP, PNG or JPEG in Settings). Long pages are split into several images in a zip.',
  '画像の形式': 'Image format', 'WebP（小さい・おすすめ）': 'WebP (small, recommended)', 'PNG（どこでも開ける）': 'PNG (opens anywhere)', 'JPEG（小さい・少し劣化）': 'JPEG (small, slight loss)',
  'A4 などの紙の大きさに区切った印刷用ページを開いて、印刷画面を出します。': 'Opens a print page split into paper-sized sheets and shows the print dialog.',
  '録画中': 'Recording', 'このページは録画できません：{0}': 'This page can’t be recorded: {0}', '録画の準備中…': 'Preparing to record…',
  // 撮影の進み具合・結果
  'このページ（{0}:）は撮影できません': 'This page ({0}:) can’t be captured',
  '保存したい部品をクリックしてください（↑ 親の要素・↓ 戻る・Esc 中止）': 'Click the part you want to save (↑ parent · ↓ back · Esc cancel)',
  '撮影中のタブに戻ると再開します': 'Go back to the tab being captured to continue',
  '上限サイズに達したので {0} つ目のファイルを保存中…': 'Size limit reached — saving file #{0}…',
  '撮影中 {0} / {1} px（{2} ページ完成{3}）': 'Capturing {0} / {1} px (pages done: {2}{3})', '・{0} ファイル保存済み': ' · files saved: {0}',
  '最下部で追加の読み込みを待っています…': 'Waiting for more content at the bottom…',
  '{0} を作成中…': 'Creating {0}…',
  '（部品 {0}×{1} px、{2} 回撮影）': ' (element {0}×{1} px, shots: {2})', '（{0} px、{1} 回撮影）': ' ({0} px, shots: {1})',
  '印刷用ページを開きました（履歴にも保存・計 {0}）': 'Opened the print page (also saved to history, {0} total)', '印刷用ページを開きました（計 {0}）': 'Opened the print page ({0} total)',
  'HTML（画像 {0} 枚）': 'HTML (images: {0})', '画像 1 枚': '1 image', '画像 {0} 枚': 'images: {0}', 'PDF {0} ページ': 'PDF ({0} pg)',
  '{0}を {1} ファイルに自動分割': '{0}, split into {1} files', '保存しました：{0}・計 {1}': 'Saved: {0} · {1} total',
  'ページ上をドラッグして範囲を選んでください（Esc で中止）': 'Drag on the page to choose an area (Esc to cancel)',
  '撮影中…': 'Capturing…', '保存中…': 'Saving…', '（{0} {1}×{2} px）': ' ({0} {1}×{2} px)',
  '録画を始められませんでした（タブの録画の許可がありません）': 'Couldn’t start recording (no permission to record this tab)',
  '録画中（{0}・{1}）': 'Recording ({0} · {1})',
  '保存しました：動画 {0}分{1}秒・{2}{3}・計 {4}': 'Saved: video {0}m {1}s · {2}{3} · {4} total', '・{0} ファイルに自動分割': ' · split into {0} files',
  // ページ上に出す表示
  'ドラッグして範囲を選択 ・ Esc で中止': 'Drag to choose an area · Esc to cancel',
  '録画中 {0}': 'Recording {0}', '■ 停止して保存': '■ Stop and save',
  '保存したい部品を<b>クリック</b> ・ <b>↑</b> 親の要素 ・ <b>↓</b> 戻る ・ <b>Esc</b> 中止': '<b>Click</b> the part to save · <b>↑</b> parent · <b>↓</b> back · <b>Esc</b> cancel',
  '{0} に スクショくん で保存': 'Saved with Snappy on {0}',
  '撮影できた画像がありません': 'Nothing was captured',
  // 履歴
  '履歴 — スクショくん': 'History — Snappy', '保存の履歴': 'Saved history', 'タイトル・URL で絞り込み': 'Filter by title or URL',
  '一覧': 'List', '☰ 一覧': '☰ List', 'サムネイル': 'Thumbnails', '▦ サムネ': '▦ Thumbnails', '選択を解除': 'Clear selection',
  '画面に合わせる／幅に合わせる（F）': 'Fit to screen / fit to width (F)', '全体表示': 'Fit to screen', '幅に合わせる': 'Fit to width',
  '新しいタブで開く': 'Open in new tab', '閉じる（Esc）': 'Close (Esc)', '前へ（←）': 'Previous (←)', '次へ（→）': 'Next (→)',
  '{0} 件・{1} 使用中': 'Items: {0} · {1} used', '条件に合うものがありません': 'Nothing matches',
  'まだ何も保存されていません。<br>ポップアップの「保存先」を「ダウンロード ＋ 履歴」か「履歴だけ」にして保存すると、ここに並びます。':
    'Nothing saved yet.<br>Captures appear here when “Save to” is set to “Downloads + history” or “History only”.',
  '保存日': 'Saved', 'タイトル・URL': 'Title · URL', '形式': 'Format', 'サイズ': 'Size', '{0} 件選択中': '{0} selected',
  '保存中…（{0}）': 'Saving… ({0})', '{0} 件をダウンロードフォルダに保存しました': 'Saved to Downloads: {0}',
  '印刷できるのは画像（PNG・JPEG・WebP・zip）の項目です。PDF は開いてから印刷してください': 'Only image items (PNG, JPEG, WebP, zip) can be printed here. Open a PDF to print it.',
  '画像以外の {0} 件は除きました': 'Skipped non-image items: {0}',
  '{0} 件を履歴から削除します。元に戻せません。よろしいですか？': 'Delete from history ({0})? This can’t be undone.',
  '{0} 件を削除しました': 'Deleted: {0}',
  // 印刷
  '印刷 — スクショくん': 'Print — Snappy', '印刷用ページ': 'Print page', '用紙': 'Paper', '印刷する': 'Print',
  '{0} 件・{1} 枚（{2}）': 'Items: {0} · sheets: {1} ({2})', '印刷できる画像がありません': 'No images to print'
};

let LANG = 'ja';

function resolveLang(v) {
  if (v === 'ja' || v === 'en') return v;
  const l = ((self.navigator && navigator.language) || '').toLowerCase();
  return l.startsWith('ja') ? 'ja' : 'en';
}

async function initLang() {
  try { const { lang = 'auto' } = await chrome.storage.local.get('lang'); LANG = resolveLang(lang); } catch (e) { LANG = resolveLang('auto'); }
  return LANG;
}

// t('撮影中 {0} / {1} px', a, b)
function t(ja, ...args) {
  let s = LANG === 'en' && EN[ja] !== undefined ? EN[ja] : ja;
  args.forEach((v, i) => { s = s.split('{' + i + '}').join(String(v)); });
  return s;
}

// HTML の文字・title などを、日本語と完全に一致するものだけ置き換える
function applyI18n(root) {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = LANG;
  if (LANG !== 'en') return;
  root = root || document;
  const tr = s => { const k = s.trim(); return k && EN[k] !== undefined ? s.replace(k, EN[k]) : s; };
  const w = document.createTreeWalker(root === document ? document.documentElement : root, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const p = n.parentNode && n.parentNode.nodeName;
    if (p === 'SCRIPT' || p === 'STYLE') continue;
    const v = tr(n.nodeValue);
    if (v !== n.nodeValue) n.nodeValue = v;
  }
  (root === document ? document : root).querySelectorAll('[title],[placeholder],[alt],[aria-label]').forEach(el => {
    for (const a of ['title', 'placeholder', 'alt', 'aria-label']) if (el.hasAttribute(a)) el.setAttribute(a, tr(el.getAttribute(a)));
  });
  if (document.title) document.title = tr(document.title);
}

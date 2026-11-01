// スクショくん — 印刷用ページ
// 履歴の画像を、用紙の縦横比で区切って 1 枚ずつのシートに並べる。
// 各シートは元の画像を切り抜いて見せるだけなので、劣化もしないしメモリもほとんど使わない。

const $ = id => document.getElementById(id);
const q = new URLSearchParams(location.search);
const ids = (q.get('ids') || '').split(',').filter(Boolean);
// 余白 8mm を除いた印刷範囲の幅・高さ（mm）
const PAPER = { a4: { w: 194, h: 281, css: 'A4' }, letter: { w: 199.9, h: 263.4, css: 'letter' } };
const HEAD_MM = 9; // 各項目の 1 枚目の上に入れる見出しの高さ
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const p2 = n => String(n).padStart(2, '0');
const when = t => { const d = new Date(t); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`; };

let sources = []; // { item, blob, url, W, H, bmp }

// 画像の [y0, y1) 付近で、色のそろった行（余白）を探して切れ目にする
function findCut(bmp, W, y0, y1) {
  const band = Math.max(8, Math.floor((y1 - y0) * 0.2)), top = y1 - band;
  const c = new OffscreenCanvas(W, band), g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, top, W, band, 0, 0, W, band);
  const d = g.getImageData(0, 0, W, band).data, step = Math.max(1, Math.floor(W / 400)), n = Math.ceil(W / step);
  const ok = r => {
    const o = r * W * 4, R = d[o], G = d[o + 1], B = d[o + 2];
    let bad = 0;
    for (let x = 0; x < W; x += step) { const i = o + x * 4; if (Math.abs(d[i] - R) + Math.abs(d[i + 1] - G) + Math.abs(d[i + 2] - B) > 30) bad++; }
    return bad <= n * 0.004;
  };
  for (let r = band - 1; r >= 0; r--) {
    if (!ok(r)) continue;
    let t = r;
    while (t > 0 && ok(t - 1)) t--;
    if (r - t >= 2 || r === band - 1) return top + Math.floor((t + r + 1) / 2);
    r = t;
  }
  return y1;
}

async function load() {
  const { albumIndex = [], page } = await chrome.storage.local.get(['albumIndex', 'page']);
  if (page === 'letter') $('paper').value = 'letter';
  const items = ids.map(id => albumIndex.find(x => x.id === id)).filter(Boolean);
  for (const item of items) {
    const blob = await blobOf(item);
    if (item.temp) await dropTemp(item); // 履歴オフで一時保存したものは、読み込んだらすぐ消す
    const parts = item.ext === 'zip' ? (await unzipStored(blob)).map(x => x.blob) : [blob];
    for (const b of parts) {
      if (!/^image\//.test(b.type)) continue;
      const bmp = await createImageBitmap(b);
      sources.push({ item, url: URL.createObjectURL(b), W: bmp.width, H: bmp.height, bmp, first: b === parts[0] });
    }
  }
  render();
}

function render() {
  const P = PAPER[$('paper').value] || PAPER.a4;
  $('pagecss').textContent = `@page{size:${P.css} portrait;margin:8mm} .hd{height:${HEAD_MM}mm}`;
  const doc = $('doc');
  doc.innerHTML = '';
  let sheets = 0;
  for (const s of sources) {
    const ratio = P.h / P.w;
    let y = 0, firstSheet = s.first;
    while (y < s.H - 0.5) {
      const avail = ((firstSheet ? P.h - HEAD_MM : P.h) - 1.5) / P.w; // 見出しのぶん 1 枚目は短く・1.5mm の余裕
      let y1 = Math.min(s.H, y + Math.floor(s.W * avail));
      if (y1 < s.H) y1 = findCut(s.bmp, s.W, y, y1);
      if (y1 <= y) y1 = Math.min(s.H, y + Math.floor(s.W * avail));
      const h = y1 - y;
      const sheet = document.createElement('div');
      sheet.className = 'sheet';
      sheet.style.width = P.w + 'mm';
      sheet.innerHTML = (firstSheet ? `<div class="hd"><b>${esc(s.item.title || '')}</b>　${esc(s.item.url)}　${when(s.item.date)}</div>` : '') +
        // シートの高さ = 幅 × h/W、画像の高さ = 幅 × H/W なので、上へずらす量はシートの高さの y/h 倍
        `<div class="pg" style="aspect-ratio:${s.W}/${h}"><img src="${s.url}" alt="" style="top:${(-y / h * 100).toFixed(5)}%"></div>`;
      doc.appendChild(sheet);
      sheets++;
      y = y1; firstSheet = false;
    }
  }
  $('info').textContent = sources.length ? t('{0} 件・{1} 枚（{2}）', ids.length, sheets, $('paper').value === 'letter' ? t('レター') : 'A4') : t('印刷できる画像がありません');
  return sheets;
}

$('paper').onchange = () => render();
$('go').onclick = () => print();

initLang().then(() => { applyI18n(); return load(); }).then(async () => {
  await Promise.all([...document.images].map(i => i.decode().catch(() => {})));
  if (q.get('auto') === '1' && sources.length) setTimeout(() => print(), 300);
});

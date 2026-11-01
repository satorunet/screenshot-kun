// スクショくん — 保存の履歴ページ
// chrome.storage.local（unlimitedStorage）に保存したファイルを一覧し、開く・ダウンロード・削除する。

const $ = id => document.getElementById(id);
const KIND = { pdf: 'pdf', html: 'html', jpg: 'img', png: 'img', webp: 'img', zip: 'img', mp4: 'video', webm: 'video' };
const KLABEL = { pdf: 'PDF', html: 'HTML', img: '画像', video: '動画' }; // 表示時に t() を通す
const MODE = { full: 'ページ全体', visible: '表示部分', area: '選択範囲', element: '部品', 'video-visible': '録画・表示部分', 'video-area': '録画・範囲' };

let items = [], view = 'list', kind = '', sortKey = 'date', sortDir = -1;
const sel = new Set();
const thumbs = new Map();

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const size = b => b >= 1073741824 ? (b / 1073741824).toFixed(2) + ' GB' : b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
const p2 = n => String(n).padStart(2, '0');
const day = t => { const d = new Date(t); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };
const hm = t => { const d = new Date(t); return `${p2(d.getHours())}:${p2(d.getMinutes())}`; };
const dur = s => s ? `${Math.floor(s / 60)}:${p2(Math.round(s % 60))}` : '';
const host = u => { try { return new URL(u).host; } catch (e) { return u; } };

function toast(t) { const e = $('toast'); e.textContent = t; e.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => e.classList.remove('on'), 2200); }

async function load() {
  const { albumIndex = [] } = await chrome.storage.local.get('albumIndex');
  items = albumIndex.filter(i => !i.temp); // 印刷のための一時保存は出さない
  for (const id of [...sel]) if (!items.some(i => i.id === id)) sel.delete(id);
  let used = 0;
  try { used = await chrome.storage.local.getBytesInUse(null); } catch (e) {}
  $('stat').textContent = t('{0} 件・{1} 使用中', items.length, size(used));
  render();
}

function filtered() {
  const q = $('q').value.trim().toLowerCase();
  let a = items.filter(i => (!kind || KIND[i.ext] === kind) && (!q || (i.title + ' ' + i.url).toLowerCase().includes(q)));
  const key = { date: i => i.date, url: i => i.url.toLowerCase(), kind: i => KIND[i.ext] + i.ext, size: i => i.bytes, title: i => i.title.toLowerCase() }[sortKey];
  a.sort((x, y) => { const p = key(x), q2 = key(y); return (p < q2 ? -1 : p > q2 ? 1 : 0) * sortDir || (y.date - x.date); });
  return a;
}

function badge(i) {
  const k = KIND[i.ext] || 'img';
  return `<span class="badge b-${k}">${t(KLABEL[k])}${i.ext === 'zip' ? ' (zip)' : ''}</span>`;
}

function thumbHtml(i) {
  const t = thumbs.get(i.id);
  return `<span class="thumb" data-open="${i.id}" data-thumb="${i.id}" style="${t ? `background-image:url('${t}')` : ''}">${i.dur ? `<span class="dur">${dur(i.dur)}</span>` : ''}</span>`;
}

function titleOf(i) { return (i.title || host(i.url) || t('(無題)')) + (i.part ? t('（その {0}）', i.part) : ''); }

function render() {
  const a = filtered();
  const m = $('main');
  if (!a.length) {
    m.innerHTML = `<div class="empty">${items.length ? t('条件に合うものがありません') : t('まだ何も保存されていません。<br>ポップアップの「保存先」を「ダウンロード ＋ 履歴」か「履歴だけ」にして保存すると、ここに並びます。')}</div>`;
    updBar(); return;
  }
  const ar = k => sortKey === k ? `<span class="ar">${sortDir > 0 ? '▲' : '▼'}</span>` : '';
  if (view === 'list') {
    m.innerHTML = `<table><thead><tr>
      <th><input type="checkbox" id="all"></th><th class="hide-s"></th>
      <th class="s" data-s="date">${t('保存日')}${ar('date')}</th>
      <th class="s" data-s="url">${t('タイトル・URL')}${ar('url')}</th>
      <th class="s" data-s="kind">${t('形式')}${ar('kind')}</th>
      <th class="s hide-s" data-s="size">${t('サイズ')}${ar('size')}</th><th></th></tr></thead><tbody>${a.map(i => `
      <tr class="item${sel.has(i.id) ? ' sel' : ''}" data-id="${i.id}">
        <td><input type="checkbox" class="cb" data-id="${i.id}" ${sel.has(i.id) ? 'checked' : ''}></td>
        <td class="th hide-s">${thumbHtml(i)}</td>
        <td class="date">${day(i.date)}<small>${hm(i.date)}</small></td>
        <td><span class="ttl" data-open="${i.id}" title="${esc(titleOf(i))}">${esc(titleOf(i))}</span><a class="url" href="${esc(i.url)}" target="_blank" rel="noopener noreferrer" title="${esc(i.url)}">${esc(i.url)}</a></td>
        <td>${badge(i)}<span class="mode">${t(MODE[i.mode] || '')}${i.print ? t('・印刷用') : ''}${i.w ? ` ${i.w}×${i.h}` : ''}</span></td>
        <td class="size hide-s">${size(i.bytes)}</td>
        <td class="act"><button data-open="${i.id}">${t('開く')}</button><button data-dl="${i.id}">${t('保存')}</button>${KIND[i.ext] === 'img' ? `<button data-pr="${i.id}">${t('印刷')}</button>` : ''}<button class="del" data-del="${i.id}">${t('削除')}</button></td>
      </tr>`).join('')}</tbody></table>`;
    const all = $('all');
    all.checked = a.every(i => sel.has(i.id));
    all.onchange = () => { a.forEach(i => all.checked ? sel.add(i.id) : sel.delete(i.id)); render(); };
    m.querySelectorAll('th.s').forEach(th => th.onclick = () => {
      const k = th.dataset.s;
      if (sortKey === k) sortDir = -sortDir; else { sortKey = k; sortDir = k === 'date' || k === 'size' ? -1 : 1; }
      render();
    });
  } else {
    m.innerHTML = `<div class="grid">${a.map(i => `
      <div class="card${sel.has(i.id) ? ' sel' : ''}" data-id="${i.id}">
        ${thumbHtml(i)}<input type="checkbox" class="cb" data-id="${i.id}" ${sel.has(i.id) ? 'checked' : ''}>${badge(i)}
        <div class="meta"><span class="ttl" data-open="${i.id}" title="${esc(titleOf(i))}">${esc(titleOf(i))}</span>
        <a class="url" href="${esc(i.url)}" target="_blank" rel="noopener noreferrer">${esc(host(i.url))}</a>
        <span class="date">${day(i.date)} ${hm(i.date)}・${size(i.bytes)}・${t(MODE[i.mode] || '')}</span>
        <div class="act" style="margin-top:6px"><button data-open="${i.id}">${t('開く')}</button><button data-dl="${i.id}">${t('保存')}</button>${KIND[i.ext] === 'img' ? `<button data-pr="${i.id}">${t('印刷')}</button>` : ''}<button class="del" data-del="${i.id}">${t('削除')}</button></div></div>
      </div>`).join('')}</div>`;
  }
  m.querySelectorAll('.cb').forEach(c => c.onchange = () => { c.checked ? sel.add(c.dataset.id) : sel.delete(c.dataset.id); render(); });
  m.querySelectorAll('[data-open]').forEach(e => e.onclick = ev => { if (e.tagName !== 'BUTTON' && ev.target.closest('.cb')) return; openItem(e.dataset.open); });
  m.querySelectorAll('[data-dl]').forEach(e => e.onclick = () => download([e.dataset.dl]));
  m.querySelectorAll('[data-del]').forEach(e => e.onclick = () => remove([e.dataset.del]));
  m.querySelectorAll('[data-pr]').forEach(e => e.onclick = () => printItems([e.dataset.pr]));
  lazyThumbs();
  updBar();
}

function updBar() {
  $('bar').classList.toggle('on', sel.size > 0);
  $('selN').textContent = t('{0} 件選択中', sel.size);
}

// サムネイルは見えたものから読み込む
const io = new IntersectionObserver(async ents => {
  const ids = ents.filter(e => e.isIntersecting).map(e => { io.unobserve(e.target); return e.target.dataset.thumb; }).filter(id => !thumbs.has(id));
  if (!ids.length) return;
  const r = await chrome.storage.local.get(ids.map(id => 't:' + id));
  for (const id of ids) {
    const t = r['t:' + id] || '';
    thumbs.set(id, t);
    if (t) document.querySelectorAll(`[data-thumb="${id}"]`).forEach(el => { el.style.backgroundImage = `url('${t}')`; });
  }
}, { rootMargin: '300px' });
function lazyThumbs() { document.querySelectorAll('[data-thumb]').forEach(el => { if (!thumbs.has(el.dataset.thumb)) io.observe(el); }); }

function fname(i) {
  const d = new Date(i.date);
  const ts = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}`;
  let t = (i.title || host(i.url) || 'page').replace(/[\\/:*?"<>|~\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80);
  return `${t}-${ts}${i.part ? '_' + p2(i.part) : ''}.${i.ext}`;
}

// ---- ライトボックス（画像・動画・PDF・HTML をこのページの上で見る） ----
let lbIdx = -1, lbList = [], lbUrls = [], lbFit = false;

function lbClear() { lbUrls.forEach(u => URL.revokeObjectURL(u)); lbUrls = []; $('lbBody').innerHTML = ''; }
function lbClose() { lbClear(); $('lb').classList.remove('on'); lbIdx = -1; document.body.style.overflow = ''; }

async function openItem(id) {
  lbList = filtered();
  lbIdx = lbList.findIndex(x => x.id === id);
  if (lbIdx < 0) return;
  $('lb').classList.add('on');
  document.body.style.overflow = 'hidden';
  await lbShow();
}

async function lbShow() {
  const i = lbList[lbIdx]; if (!i) return;
  lbClear();
  const body = $('lbBody');
  body.className = 'lbbody';
  $('lbT').textContent = titleOf(i);
  $('lbS').innerHTML = `${t(KLABEL[KIND[i.ext]] || '')}・${t(MODE[i.mode] || '')}・${day(i.date)} ${hm(i.date)}・${size(i.bytes)}・<a href="${esc(i.url)}" target="_blank" rel="noopener noreferrer">${esc(i.url)}</a>　(${lbIdx + 1} / ${lbList.length})`;
  $('lbPrev').style.visibility = lbIdx > 0 ? 'visible' : 'hidden';
  $('lbNext').style.visibility = lbIdx < lbList.length - 1 ? 'visible' : 'hidden';
  $('lbFit').style.display = KIND[i.ext] === 'img' ? '' : 'none';
  body.innerHTML = `<div class="lbload">${t('読み込み中…')}</div>`;
  const want = lbIdx;
  const blob = await blobOf(i);
  if (want !== lbIdx) return; // 読み込み中に別の項目に移った
  const mk = b => { const u = URL.createObjectURL(b); lbUrls.push(u); return u; };
  const k = KIND[i.ext];
  if (k === 'video') {
    body.classList.add('center');
    body.innerHTML = `<video src="${mk(blob)}" controls autoplay playsinline></video>`;
  } else if (k === 'img') {
    const imgs = i.ext === 'zip' ? await unzipStored(blob) : [{ blob }];
    body.innerHTML = `<div class="stack" style="--mw:${i.w ? i.w + 'px' : '100%'}">${imgs.map(x => `<img src="${mk(x.blob)}" alt="">`).join('')}</div>`;
    lbApplyFit();
  } else if (i.ext === 'pdf') {
    body.innerHTML = `<iframe src="${mk(blob)}"></iframe>`;
  } else {
    body.innerHTML = `<iframe sandbox="allow-popups" src="${mk(blob)}"></iframe>`;
  }
}

function lbApplyFit() {
  const body = $('lbBody'), i = lbList[lbIdx];
  const single = i && i.ext !== 'zip';
  body.classList.toggle('fit', lbFit && single);
  body.classList.toggle('center', lbFit && single);
  $('lbFit').textContent = lbFit ? t('幅に合わせる') : t('全体表示');
}

function lbMove(d) { const n = lbIdx + d; if (n >= 0 && n < lbList.length) { lbIdx = n; lbShow(); } }

async function openInTab(i) {
  if (i.ext === 'zip') return download([i.id]);
  const url = URL.createObjectURL(await blobOf(i));
  chrome.tabs.create({ url });
  setTimeout(() => URL.revokeObjectURL(url), 10 * 60 * 1000);
}

$('lbX').onclick = lbClose;
$('lbPrev').onclick = () => lbMove(-1);
$('lbNext').onclick = () => lbMove(1);
$('lbFit').onclick = () => { lbFit = !lbFit; lbApplyFit(); };
$('lbTab').onclick = () => { const i = lbList[lbIdx]; if (i) openInTab(i); };
$('lbDl').onclick = () => { const i = lbList[lbIdx]; if (i) download([i.id]); };
$('lbBody').onclick = e => { if (e.target === $('lbBody')) lbClose(); };
addEventListener('keydown', e => {
  if (lbIdx < 0) return;
  if (e.key === 'Escape') lbClose();
  else if (e.key === 'ArrowLeft') lbMove(-1);
  else if (e.key === 'ArrowRight') lbMove(1);
  else if (e.key === 'f' || e.key === 'F') { lbFit = !lbFit; lbApplyFit(); }
});

async function download(ids) {
  for (const id of ids) {
    const i = items.find(x => x.id === id) || lbList.find(x => x.id === id); if (!i) continue; // 一時保存の項目はライトボックス側にある
    toast(t('保存中…（{0}）', fname(i)));
    const url = URL.createObjectURL(await blobOf(i));
    await chrome.downloads.download({ url, filename: fname(i), conflictAction: 'uniquify' });
    setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
  }
  toast(t('{0} 件をダウンロードフォルダに保存しました', ids.length));
}

// 選んだ項目（画像のもの）を 1 つの印刷用ページにまとめて開く
function printItems(ids) {
  const ok = ids.filter(id => { const i = items.find(x => x.id === id); return i && KIND[i.ext] === 'img'; });
  if (!ok.length) return toast(t('印刷できるのは画像（PNG・JPEG・WebP・zip）の項目です。PDF は開いてから印刷してください'));
  if (ok.length < ids.length) toast(t('画像以外の {0} 件は除きました', ids.length - ok.length));
  chrome.tabs.create({ url: 'print.html?auto=1&ids=' + ok.join(',') });
}

async function remove(ids) {
  if (!confirm(t('{0} 件を履歴から削除します。元に戻せません。よろしいですか？', ids.length))) return;
  const { albumIndex = [] } = await chrome.storage.local.get('albumIndex');
  const keys = [];
  for (const id of ids) {
    const i = albumIndex.find(x => x.id === id); if (!i) continue;
    keys.push('t:' + id);
    for (let n = 0; n < i.chunks; n++) keys.push(`a:${id}:${n}`);
  }
  await chrome.storage.local.set({ albumIndex: albumIndex.filter(x => !ids.includes(x.id)) });
  await chrome.storage.local.remove(keys);
  ids.forEach(id => { sel.delete(id); thumbs.delete(id); });
  toast(t('{0} 件を削除しました', ids.length));
  load();
}

$('q').oninput = render;
$('kinds').onclick = e => { const b = e.target.closest('button'); if (!b) return; kind = b.dataset.k; $('kinds').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); render(); };
document.querySelector('.view').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  view = b.dataset.v; document.querySelectorAll('.view button').forEach(x => x.classList.toggle('on', x === b));
  try { localStorage.setItem('view', view); } catch (er) {}
  render();
};
$('bDl').onclick = () => download([...sel]);
$('bPr').onclick = () => printItems([...sel]);
$('bDel').onclick = () => remove([...sel]);
$('bNone').onclick = () => { sel.clear(); render(); };
chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && ch.albumIndex) load(); });

initLang().then(async () => {
  applyI18n();
  await load();
  // ?open=<id>：保存した直後に、その項目をライトボックスで開く
  const openId = new URLSearchParams(location.search).get('open');
  if (openId) {
    const { albumIndex = [] } = await chrome.storage.local.get('albumIndex');
    const it = albumIndex.find(x => x.id === openId);
    if (it) {
      lbList = it.temp ? [it] : filtered();
      lbIdx = Math.max(0, lbList.findIndex(x => x.id === openId));
      $('lb').classList.add('on');
      document.body.style.overflow = 'hidden';
      await lbShow();
      if (it.temp) await dropTemp(it); // 表示用の一時保存は、読み込んだら消す（中身はこのページが持っている）
    }
    history.replaceState(null, '', location.pathname);
  }
});
try { const v = localStorage.getItem('view'); if (v === 'grid' || v === 'list') { view = v; document.querySelectorAll('.view button').forEach(x => x.classList.toggle('on', x.dataset.v === v)); } } catch (e) {}

// スクショくん — service worker
// ページをスクロールしながら 1 画面ずつ撮影し、offscreen ドキュメントで
// ページ単位に JPEG 圧縮 → PDF / HTML / 画像（1 枚 or zip）にまとめて保存する。
// ほかに「表示部分だけ」「選択範囲」の撮影と、タブの録画（表示部分・選択範囲）ができる。全体を 1 枚の画像にしないので
// どんなに長いページでもメモリを使い切らない。

importScripts('i18n.js');

const DEF = {
  format: 'pdf',     // pdf / html / image
  imgq: 'lossless',  // 画質：lossless（劣化なし）/ high / small
  imgfmt: 'webp',    // 画像で保存するときの形式：webp / png / jpg
  res: 'device',     // 出力解像度：device（画面そのまま・1 対 1）/ '1' / '1.5' / '2'（以前の scale は使わない）
  page: 'a4',        // a4 / letter / long（A4 の 2 倍の長さ）
  delay: 600,        // スクロール後の待ち時間 ms（遅延読み込み対策）
  bottomWait: 1500,  // 最下部で追加読み込みを待つ時間 ms
  hideFixed: true,   // 2 枚目以降は固定ヘッダーなどを隠す
  smartCut: true,    // ページの切れ目を余白の行に合わせる
  maxHeight: 0,      // 最大の長さ（CSS px）0 = 無制限
  splitMB: 1024,     // 1 ファイルの上限 MB。超えたら自動で次のファイルに分ける
  audio: true,       // 録画でタブの音も録る
  dest: 'both',      // 保存先：download / album / both
  history: true,     // 履歴機能のオン・オフ（オフなら保存はダウンロードだけ）
  preview: true,     // 保存したらその場で（履歴ページで）表示する
  saveAs: false      // 毎回保存先を聞く
};

let job = null;
let last = null;
const sleep = ms => new Promise(r => setTimeout(r, ms));

chrome.runtime.onMessage.addListener((m, sender, send) => {
  if (m.target !== 'bg') return;
  if (m.type === 'start') { start(m.tabId, m.mode || 'full'); send({ ok: true }); }
  else if (m.type === 'cancel') { if (job) job.cancel = true; send({ ok: true }); }
  else if (m.type === 'video') { startVideo(m.tabId, m.mode, m.streamId); send({ ok: true }); }
  else if (m.type === 'stopVideo') { stopVideo(); send({ ok: true }); }
  else if (m.type === 'vpart') { saveVideoPart(m.part).then(() => send({ ok: true }), e => send({ error: String(e) })); return true; }
  else if (m.type === 'vended') { stopVideo(); send({ ok: true }); }
  else if (m.type === 'status') {
    chrome.storage.session.get('rec').then(({ rec }) => {
      if (rec) send({ recording: true, startedAt: rec.startedAt, text: rec.text || t('録画中') });
      else send(job ? { running: true, progress: job.progress, text: job.text } : { running: false, last });
    });
    return true;
  }
});

// 録画中にページを移動・再読み込みしたら、操作バーと赤枠を出し直す
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (info.status !== 'complete') return;
  const { rec } = await chrome.storage.session.get('rec');
  if (rec && rec.tabId === tabId && rec.rect) { await initLang(); exec(tabId, showRecUi, [rec.rect, rec.startedAt, recLabels()]).catch(() => {}); }
});

// 表示用の一時保存が残っていたら消す（ブラウザを閉じたときなど）
async function cleanTemp() {
  const { albumIndex = [] } = await chrome.storage.local.get('albumIndex');
  const old = albumIndex.filter(i => i.temp && Date.now() - i.date > 10 * 60 * 1000);
  if (!old.length) return;
  const keys = [];
  old.forEach(i => { keys.push('t:' + i.id); for (let n = 0; n < i.chunks; n++) keys.push(`a:${i.id}:${n}`); });
  await chrome.storage.local.set({ albumIndex: albumIndex.filter(i => !old.includes(i)) });
  await chrome.storage.local.remove(keys);
}
chrome.runtime.onStartup.addListener(cleanTemp);
chrome.runtime.onInstalled.addListener(cleanTemp);

chrome.commands.onCommand.addListener(async cmd => {
  if (cmd !== 'capture') return;
  const { rec } = await chrome.storage.session.get('rec');
  if (rec) return stopVideo(); // 録画中なら停止
  const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (t) start(t.id, 'full');
});

function update(p, text) {
  if (!job) return;
  job.progress = p; job.text = text;
  chrome.action.setBadgeBackgroundColor({ color: '#1d9bf0' });
  chrome.action.setBadgeText({ text: p >= 0 ? Math.min(99, Math.floor(p * 100)) + '%' : '…' });
  chrome.runtime.sendMessage({ target: 'popup', type: 'progress', progress: p, text }).catch(() => {});
}

async function exec(tabId, func, args = []) {
  const [r] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  return r && r.result;
}

async function off(msg) {
  const r = await chrome.runtime.sendMessage({ target: 'offscreen', ...msg });
  if (!r) throw new Error('offscreen から応答がありません');
  if (r.error) throw new Error(r.error);
  return r;
}

async function ensureOffscreen() {
  const ctx = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (ctx.length) return;
  await chrome.offscreen.createDocument({
    url: 'offscreen.html', reasons: ['BLOBS', 'USER_MEDIA'],
    justification: '撮影した画像を圧縮してファイルにまとめるため・タブを録画するため'
  });
}

async function closeOffscreen() {
  try { await chrome.offscreen.closeDocument(); } catch (e) {}
}

async function start(tabId, mode = 'full') {
  if (job) return;
  if ((await chrome.storage.session.get('rec')).rec) return; // 録画中は撮影しない
  const o = { ...DEF, ...(await chrome.storage.local.get(DEF)) };
  o.delay = Math.max(550, +o.delay || 600); // captureVisibleTab は毎秒 2 回まで
  await initLang();
  job = { cancel: false, progress: 0, text: t('準備中…'), tabId };
  update(-1, t('準備中…'));
  let msg;
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!/^(https?|file):/.test(tab.url || '')) throw new Error(t('このページ（{0}:）は撮影できません', (tab.url || '').split(':')[0]));
    msg = mode === 'full' ? await run(tab, o, mode) : await runShot(tab, o, mode === 'area' ? 'area' : 'visible');
  } catch (e) {
    msg = t('エラー: {0}', e && e.message || e);
  } finally {
    try { await exec(tabId, restorePage); } catch (e) {}
  }
  last = msg;
  chrome.action.setBadgeText({ text: msg.startsWith(t('エラー: {0}', '')) || msg === t('中止しました') ? '!' : '✓' });
  setTimeout(() => chrome.action.setBadgeText({ text: '' }), 8000);
  chrome.runtime.sendMessage({ target: 'popup', type: 'done', text: msg }).catch(() => {});
  job = null;
}

async function run(tab, o, mode = 'full') {
  const tabId = tab.id;
  const info = await exec(tabId, preparePage);
  await closeOffscreen();
  await ensureOffscreen();
  await off({ type: 'begin', opts: o, title: info.title, url: info.url });
  const { save, saved } = makeSaver(o, baseName(info.title), { title: info.title, url: info.url, mode, tabId });

  let done = 0, pos = 0, first = true, stuck = 0, lastCap = 0, shots = 0;
  for (;;) {
    if (job.cancel) { await closeOffscreen(); return t('中止しました'); }

    // 撮影中に別のタブを開いたら戻るまで待つ
    for (;;) {
      const t = await chrome.tabs.get(tabId);
      if (t.active) break;
      update(job.progress, t('撮影中のタブに戻ると再開します'));
      await sleep(500);
      if (job.cancel) { await closeOffscreen(); return t('中止しました'); }
    }

    if (!first && o.hideFixed) await exec(tabId, hideFixed);
    await exec(tabId, scrollToPos, [pos]);
    await sleep(o.delay);
    const r = await exec(tabId, measure);
    const wait = 550 - (Date.now() - lastCap);
    if (wait > 0) await sleep(wait);
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' }); // 劣化なしで受け取る
    lastCap = Date.now(); shots++;
    first = false;

    const rect = r.rect, sy = r.y;
    const from = Math.max(0, done - r.y);
    let take = Math.min(r.rect.h - from, r.total - done);
    if (o.maxHeight > 0) take = Math.min(take, o.maxHeight - done);
    if (take > 0.5) {
      const a = await off({ type: 'add', dataUrl, rect, vw: r.vw, srcTop: from, h: take, docTop: done, scrollY: sy });
      done += take; stuck = 0;
      const tot = o.maxHeight > 0 ? Math.min(o.maxHeight, r.total) : r.total;
      if (a.part) {
        update(done / tot, t('上限サイズに達したので {0} つ目のファイルを保存中…', a.part.no));
        await save(a.part, false);
      }
      update(done / tot, t('撮影中 {0} / {1} px（{2} ページ完成{3}）', Math.round(done).toLocaleString(), Math.round(tot).toLocaleString(), a.pages, saved.length ? t('・{0} ファイル保存済み', saved.length) : ''));
    } else stuck++;

    if (o.maxHeight > 0 && done >= o.maxHeight - 0.5) break;
    if (done >= r.total - 0.5) {
      // 最下部：遅延読み込み・無限スクロールで伸びるか少し待つ
      update(0.99, t('最下部で追加の読み込みを待っています…'));
      await sleep(o.bottomWait);
      const m = await exec(tabId, measure);
      if (m.total > r.total + 2) { pos = done; continue; }
      break;
    }
    if (stuck >= 3) break;
    pos = done;
  }

  update(0.995, t('{0} を作成中…', { pdf: 'PDF', html: 'HTML', image: t('画像'), print: t('印刷') }[o.format] || 'PDF'));
  const res = await off({ type: 'finish' });
  if (res.last) await save(res.last, true);
  await closeOffscreen();
  return summary(o, saved, res.total) + t('（{0} px、{1} 回撮影）', Math.round(done).toLocaleString(), shots);
}

function recLabels() {
  return { rec: t('録画中 {0}'), stop: t('■ 停止して保存'), saving: t('保存しています…') };
}

function makeSaver(o, base, meta) {
  const saved = [];
  const save = async (r, final) => {
    const split = saved.length > 0 || !final;
    const name = `${base}${split ? '_' + String(r.no).padStart(2, '0') : ''}.${r.ext}`;
    const id = await deliver(o.history === false ? 'download' : o.dest, r, name, !!o.saveAs && saved.length === 0,
      { ...meta, part: split ? r.no : 0, print: o.format === 'print', temp: o.history === false }, o.preview !== false && !saved.length);
    await off({ type: 'revoke', url: r.url }).catch(() => {});
    r.itemId = id;
    saved.push(r);
    if (final && o.preview !== false && o.format !== 'print' && saved[0].itemId) await showSaved(saved[0].itemId, meta.tabId);
  };
  return { save, saved };
}

// 保存したものを、履歴ページのライトボックスでその場に表示する（撮影したタブのすぐ右に開く）
async function showSaved(id, tabId) {
  let index;
  try { if (tabId) index = (await chrome.tabs.get(tabId)).index + 1; } catch (e) {}
  await chrome.tabs.create({ url: 'history.html?open=' + id, index });
}

// 保存先の設定に従って、ダウンロードフォルダ・アルバムに保存する
// 戻り値：履歴（または表示用の一時保存）に入れた項目の id
async function deliver(dest, r, name, saveAs, meta, wantPreview) {
  if (meta.print) {
    // 印刷：履歴に入れてから、A4 に区切った印刷用ページを開く（履歴オフのときは一時保存で、印刷用ページが読み込んだら消す）
    const item = await albumAdd(r, meta);
    await chrome.tabs.create({ url: 'print.html?auto=1&ids=' + item.id });
    return null;
  }
  if (dest !== 'album') {
    const id = await chrome.downloads.download({ url: r.url, filename: name, saveAs, conflictAction: 'uniquify' });
    await waitDownload(id);
  }
  if (dest === 'album' || dest === 'both') return (await albumAdd(r, meta)).id;
  // 履歴に残さないときも、その場で表示するために一時保存する（表示したら消す）
  if (wantPreview) return (await albumAdd(r, { ...meta, temp: true })).id;
  return null;
}

/* ---------- アルバム（chrome.storage.local・unlimitedStorage） ----------
   albumIndex: [{ id, date, title, url, ext, mime, bytes, chunks, mode, part, w, h }]
   t:<id>     : サムネイル（data URL）
   a:<id>:<n> : ファイル本体を 8MB ごとに base64 にしたもの */

const MIME = { pdf: 'application/pdf', html: 'text/html', jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', zip: 'application/zip', mp4: 'video/mp4', webm: 'video/webm' };
const CHUNK = 8 * 1024 * 1024;
let albumLock = Promise.resolve();

function b64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}

function albumAdd(r, meta) {
  const job2 = albumLock.then(async () => {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    const res = await fetch(r.url);
    const reader = res.body.getReader();
    let buf = new Uint8Array(CHUNK), fill = 0, n = 0, total = 0;
    const put = async u8 => { await chrome.storage.local.set({ [`a:${id}:${n}`]: b64(u8) }); n++; };
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      let off = 0;
      while (off < value.length) {
        const k = Math.min(CHUNK - fill, value.length - off);
        buf.set(value.subarray(off, off + k), fill); fill += k; off += k; total += k;
        if (fill === CHUNK) { await put(buf); buf = new Uint8Array(CHUNK); fill = 0; }
      }
    }
    if (fill > 0 || n === 0) await put(buf.subarray(0, fill));
    if (r.thumb) await chrome.storage.local.set({ [`t:${id}`]: r.thumb });
    const item = { id, date: Date.now(), title: meta.title || '', url: meta.url || '', ext: r.ext, mime: MIME[r.ext] || 'application/octet-stream',
      bytes: total, chunks: n, mode: meta.mode || 'full', part: meta.part || 0, w: r.w || 0, h: r.h || 0, dur: r.dur || 0, print: !!meta.print, temp: !!meta.temp };
    const { albumIndex = [] } = await chrome.storage.local.get('albumIndex');
    albumIndex.push(item);
    await chrome.storage.local.set({ albumIndex });
    chrome.runtime.sendMessage({ target: 'album', type: 'added', item }).catch(() => {});
    return item;
  });
  albumLock = job2.catch(() => {});
  return job2;
}

// 撮影画像（data URL）の一部から、幅 320px のサムネイルを作る
async function makeThumb(dataUrl, rect, vw) {
  try {
    const img = await createImageBitmap(await (await fetch(dataUrl)).blob());
    const k = img.width / vw;
    const sw = rect.w * k, sh = Math.min(rect.h * k, sw * 1.25);
    const W = 320, H = Math.max(1, Math.round(W * sh / sw));
    const c = new OffscreenCanvas(W, H);
    c.getContext('2d').drawImage(img, rect.x * k, rect.y * k, sw, sh, 0, 0, W, H);
    const blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.7 });
    const u8 = new Uint8Array(await blob.arrayBuffer());
    return 'data:image/jpeg;base64,' + b64(u8);
  } catch (e) { return ''; }
}

function fmtSize(bytes) {
  return bytes >= 1073741824 ? (bytes / 1073741824).toFixed(2) + ' GB' : (bytes / 1048576).toFixed(1) + ' MB';
}

function summary(o, saved, n) {
  const bytes = saved.reduce((a, r) => a + r.bytes, 0);
  if (o.format === 'print') return o.history === false ? t('印刷用ページを開きました（計 {0}）', fmtSize(bytes)) : t('印刷用ページを開きました（履歴にも保存・計 {0}）', fmtSize(bytes));
  let what = o.format === 'html' ? t('HTML（画像 {0} 枚）', n)
    : o.format === 'image' ? (saved.length === 1 && saved[0].ext !== 'zip' ? t('画像 1 枚') : t('画像 {0} 枚', n))
    : t('PDF {0} ページ', n);
  if (saved.length > 1) what = t('{0}を {1} ファイルに自動分割', what, saved.length);
  return t('保存しました：{0}・計 {1}', what, fmtSize(bytes));
}

// 表示部分だけ・選択範囲を 1 回の撮影で保存する
async function runShot(tab, o, mode) {
  const tabId = tab.id;
  let rect = null;
  if (mode === 'area') {
    update(-1, t('ページ上をドラッグして範囲を選んでください（Esc で中止）'));
    rect = await exec(tabId, selectArea, [t('ドラッグして範囲を選択 ・ Esc で中止')]);
    if (!rect) return t('中止しました');
    await sleep(200); // 選択の枠が消えてから撮る
  }
  const v = await exec(tabId, viewportInfo);
  if (!rect) rect = v.rect;
  await closeOffscreen();
  await ensureOffscreen();
  await off({ type: 'begin', opts: o, title: v.title, url: v.url });
  update(0.5, t('撮影中…'));
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  await off({ type: 'add', dataUrl, rect, vw: v.vw, srcTop: 0, h: rect.h, docTop: 0, scrollY: 0 });
  update(0.9, t('保存中…'));
  const { save, saved } = makeSaver(o, baseName(v.title), { title: v.title, url: v.url, mode, tabId });
  const res = await off({ type: 'finish' });
  if (res.last) await save(res.last, true);
  await closeOffscreen();
  return summary(o, saved, res.total) + t('（{0} {1}×{2} px）', t(mode === 'area' ? '選択範囲' : '表示部分'), Math.round(rect.w), Math.round(rect.h));
}

/* ---------- 録画 ---------- */

let stopping = false;

async function startVideo(tabId, mode, streamId) {
  if (job || (await chrome.storage.session.get('rec')).rec) return;
  const o = { ...DEF, ...(await chrome.storage.local.get(DEF)) };
  await initLang();
  const say = text => chrome.runtime.sendMessage({ target: 'popup', type: 'done', text }).catch(() => {});
  try {
    if (!streamId) throw new Error(t('録画を始められませんでした（タブの録画の許可がありません）'));
    const v = await exec(tabId, viewportInfo);
    await closeOffscreen();
    await ensureOffscreen();
    await off({ type: 'vbegin', streamId, audio: !!o.audio, vw: v.vw, vh: v.vh, dpr: v.dpr, splitMB: o.splitMB });
    let rect = null;
    if (mode === 'area') {
      chrome.action.setBadgeBackgroundColor({ color: '#1d9bf0' });
      chrome.action.setBadgeText({ text: '…' });
      rect = await exec(tabId, selectArea, [t('ドラッグして範囲を選択 ・ Esc で中止')]);
      if (!rect) { await off({ type: 'vcancel' }).catch(() => {}); await closeOffscreen(); chrome.action.setBadgeText({ text: '' }); last = t('中止しました'); return; }
      await sleep(200);
    } else {
      // 表示部分：上に操作バーを置くので、その下を録画範囲にする（バーと赤枠は録画に映らない）
      rect = await exec(tabId, visibleRecRect);
    }
    let thumb = '';
    try {
      const tab = await chrome.tabs.get(tabId);
      thumb = await makeThumb(await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 80 }), rect || v.rect, v.vw);
    } catch (e) {}
    const r = await off({ type: 'vstart', rect, vw: v.vw });
    const rec = { tabId, base: baseName(v.title), startedAt: Date.now(), saveAs: !!o.saveAs, parts: 0, bytes: 0, mime: r.mime,
      dest: o.history === false ? 'download' : o.dest, preview: o.preview !== false, firstId: null, title: v.title, url: v.url, mode, thumb, partStart: Date.now(), rect,
      text: t('録画中（{0}・{1}）', t(mode === 'area' ? '選択範囲' : '表示部分'), r.ext.toUpperCase()) };
    await chrome.storage.session.set({ rec });
    await exec(tabId, showRecUi, [rect, rec.startedAt, recLabels()]).catch(() => {});
    chrome.action.setBadgeBackgroundColor({ color: '#e0245e' });
    chrome.action.setBadgeText({ text: 'REC' });
    chrome.runtime.sendMessage({ target: 'popup', type: 'recording', startedAt: rec.startedAt, text: rec.text }).catch(() => {});
  } catch (e) {
    await off({ type: 'vcancel' }).catch(() => {});
    await closeOffscreen();
    chrome.action.setBadgeText({ text: '!' });
    last = t('エラー: {0}', e && e.message || e);
    say(last);
  }
}

async function saveVideoName(rec, r, final) {
  const split = rec.parts > 0 || !final;
  return `${rec.base}${split ? '_' + String(r.no).padStart(2, '0') : ''}.${r.ext}`;
}

async function saveVideoPart(part) {
  const { rec } = await chrome.storage.session.get('rec');
  if (!rec) return;
  part.thumb = rec.thumb; part.dur = (Date.now() - rec.partStart) / 1000;
  const pid = await deliver(rec.dest, part, await saveVideoName(rec, part, false), rec.saveAs && rec.parts === 0,
    { title: rec.title, url: rec.url, mode: 'video-' + rec.mode, part: part.no }, rec.preview && !rec.firstId);
  if (!rec.firstId) rec.firstId = pid;
  await off({ type: 'revoke', url: part.url }).catch(() => {});
  rec.parts++; rec.bytes += part.bytes; rec.partStart = Date.now();
  await chrome.storage.session.set({ rec });
}

async function stopVideo() {
  if (stopping) return;
  const { rec } = await chrome.storage.session.get('rec');
  if (!rec) return;
  stopping = true;
  await initLang();
  try {
    chrome.action.setBadgeText({ text: '…' });
    exec(rec.tabId, hideRecUi).catch(() => {});
    const r = await off({ type: 'vstop' });
    const { rec: cur } = await chrome.storage.session.get('rec');
    r.thumb = cur.thumb; r.dur = (Date.now() - cur.partStart) / 1000;
    const vid = await deliver(cur.dest, r, await saveVideoName(cur, r, true), cur.saveAs && cur.parts === 0,
      { title: cur.title, url: cur.url, mode: 'video-' + cur.mode, part: cur.parts ? r.no : 0 }, cur.preview && !cur.firstId);
    await off({ type: 'revoke', url: r.url }).catch(() => {});
    if (cur.preview && (cur.firstId || vid)) await showSaved(cur.firstId || vid, cur.tabId);
    const files = cur.parts + 1, sec = Math.round((Date.now() - cur.startedAt) / 1000);
    last = t('保存しました：動画 {0}分{1}秒・{2}{3}・計 {4}', Math.floor(sec / 60), sec % 60, r.ext.toUpperCase(), files > 1 ? t('・{0} ファイルに自動分割', files) : '', fmtSize(cur.bytes + r.bytes));
    chrome.action.setBadgeText({ text: '✓' });
  } catch (e) {
    last = t('エラー: {0}', e && e.message || e);
    chrome.action.setBadgeText({ text: '!' });
  } finally {
    await chrome.storage.session.remove('rec');
    await closeOffscreen();
    stopping = false;
    setTimeout(() => chrome.action.setBadgeText({ text: '' }), 8000);
    chrome.runtime.sendMessage({ target: 'popup', type: 'done', text: last }).catch(() => {});
  }
}

function waitDownload(id) {
  return new Promise(resolve => {
    const f = d => {
      if (d.id === id && d.state && d.state.current !== 'in_progress') {
        chrome.downloads.onChanged.removeListener(f); resolve();
      }
    };
    chrome.downloads.onChanged.addListener(f);
    setTimeout(() => { chrome.downloads.onChanged.removeListener(f); resolve(); }, 10 * 60 * 1000);
  });
}

function baseName(title) {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  const ts = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  let t = (title || 'page').replace(/[\\/:*?"<>|~\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
  if (t.length > 80) t = t.slice(0, 80);
  return `${t || 'page'}-${ts}`;
}

/* ---------- 以下はページ内で実行される関数（自己完結であること） ---------- */

function preparePage() {
  const old = window.__lpp;
  if (old && old.restore) old.restore();
  const S = window.__lpp = { hidden: [], hiddenSet: new WeakSet() };
  const se = document.scrollingElement || document.documentElement;
  let el = null;
  if (se.scrollHeight <= innerHeight + 5) {
    // ページ自体はスクロールしない → 中の一番大きなスクロール領域を探す
    let best = null, bs = 0;
    for (const e of document.querySelectorAll('body *')) {
      if (e.scrollHeight - e.clientHeight < 50 || e.clientHeight < innerHeight * 0.3) continue;
      const oy = getComputedStyle(e).overflowY;
      if (oy !== 'auto' && oy !== 'scroll' && oy !== 'overlay') continue;
      const a = e.clientWidth * e.clientHeight;
      if (a > bs) { bs = a; best = e; }
    }
    el = best;
  }
  S.el = el;
  S.orig = el ? el.scrollTop : scrollY;
  S.origX = scrollX;
  const de = document.documentElement;
  S.sb = de.style.scrollBehavior; de.style.scrollBehavior = 'auto';
  if (el) { S.esb = el.style.scrollBehavior; el.style.scrollBehavior = 'auto'; }
  S.restore = () => {
    for (const [e, v, p] of S.hidden) { if (v) e.style.setProperty('visibility', v, p); else e.style.removeProperty('visibility'); }
    S.hidden = [];
    de.style.scrollBehavior = S.sb;
    if (el) { el.style.scrollBehavior = S.esb; el.scrollTop = S.orig; } else window.scrollTo(S.origX, S.orig);
  };
  return { title: document.title, url: location.href, mode: el ? 'element' : 'window' };
}

function scrollToPos(pos) {
  const S = window.__lpp;
  if (S.el) S.el.scrollTop = pos; else window.scrollTo(S.origX || 0, pos);
  return true;
}

function measure() {
  const S = window.__lpp;
  const de = document.documentElement;
  let out;
  if (S.el) {
    const e = S.el, b = e.getBoundingClientRect();
    const top = b.top + e.clientTop, left = b.left + e.clientLeft;
    const y0 = Math.max(0, top), y1 = Math.min(innerHeight, top + e.clientHeight);
    out = { y: e.scrollTop + (y0 - top), total: e.scrollHeight,
      rect: { x: Math.max(0, left), y: y0, w: Math.min(e.clientWidth, innerWidth - Math.max(0, left)), h: y1 - y0 }, vw: innerWidth };
  } else {
    const se = document.scrollingElement || de;
    const total = Math.max(se.scrollHeight, document.body ? document.body.scrollHeight : 0);
    out = { y: scrollY, total, rect: { x: 0, y: 0, w: de.clientWidth || innerWidth, h: de.clientHeight || innerHeight }, vw: innerWidth };
  }
  return out;
}

function hideFixed() {
  const S = window.__lpp;
  const w = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_ELEMENT);
  for (let n = w.currentNode; n; n = w.nextNode()) {
    if (S.hiddenSet.has(n) || n === S.el) continue;
    const cs = getComputedStyle(n);
    if ((cs.position === 'fixed' || cs.position === 'sticky') && cs.visibility !== 'hidden') {
      if (S.el && n.contains(S.el)) continue; // スクロール領域を含む枠は隠さない
      S.hidden.push([n, n.style.getPropertyValue('visibility'), n.style.getPropertyPriority('visibility')]);
      S.hiddenSet.add(n);
      n.style.setProperty('visibility', 'hidden', 'important');
    }
  }
  return true;
}

function restorePage() {
  const S = window.__lpp;
  if (S && S.restore) S.restore();
  delete window.__lpp;
  return true;
}

function viewportInfo() {
  const de = document.documentElement;
  return { rect: { x: 0, y: 0, w: de.clientWidth || innerWidth, h: de.clientHeight || innerHeight },
    vw: innerWidth, vh: innerHeight, dpr: devicePixelRatio, title: document.title, url: location.href };
}

// ページ上でドラッグして範囲を選ぶ。{x,y,w,h}（表示領域の CSS px）か null を返す
function selectArea(hintText) {
  return new Promise(resolve => {
    const host = document.createElement('div');
    host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647';
    const sh = host.attachShadow({ mode: 'closed' });
    sh.innerHTML = `<style>
      .l{position:fixed;inset:0;cursor:crosshair;background:rgba(0,0,0,.25)}
      .b{position:fixed;border:2px solid #1d9bf0;box-shadow:0 0 0 99999px rgba(0,0,0,.35);display:none;pointer-events:none}
      .h{position:fixed;left:50%;top:16px;transform:translateX(-50%);background:#0f1419;color:#fff;font:14px/1.4 system-ui,sans-serif;padding:8px 14px;border-radius:999px;pointer-events:none;white-space:nowrap}
      .s{position:fixed;background:#1d9bf0;color:#fff;font:12px system-ui,sans-serif;padding:2px 6px;border-radius:4px;pointer-events:none;display:none}
    </style><div class="l"></div><div class="b"></div><div class="s"></div><div class="h"></div>`;
    sh.querySelector('.h').textContent = hintText || 'ドラッグして範囲を選択 ・ Esc で中止';
    const l = sh.querySelector('.l'), bx = sh.querySelector('.b'), sz = sh.querySelector('.s'), hint = sh.querySelector('.h');
    let sx = 0, sy = 0, drag = false, r = null;
    const done = v => {
      removeEventListener('keydown', key, true);
      host.remove();
      requestAnimationFrame(() => requestAnimationFrame(() => resolve(v)));
    };
    const key = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null); } };
    addEventListener('keydown', key, true);
    l.addEventListener('mousedown', e => { e.preventDefault(); drag = true; sx = e.clientX; sy = e.clientY; hint.style.display = 'none'; l.style.background = 'transparent'; });
    l.addEventListener('mousemove', e => {
      if (!drag) return;
      const x = Math.min(sx, e.clientX), y = Math.min(sy, e.clientY), w = Math.abs(e.clientX - sx), h = Math.abs(e.clientY - sy);
      r = { x, y, w, h };
      Object.assign(bx.style, { display: 'block', left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
      Object.assign(sz.style, { display: 'block', left: x + 'px', top: Math.max(0, y - 22) + 'px' });
      sz.textContent = `${Math.round(w)} × ${Math.round(h)}`;
    });
    l.addEventListener('mouseup', () => {
      drag = false;
      if (!r || r.w < 8 || r.h < 8) { r = null; bx.style.display = sz.style.display = 'none'; hint.style.display = ''; l.style.background = ''; return; }
      done(r); // 枠は撮影前に消えるので、選んだ範囲そのまま
    });
    document.documentElement.appendChild(host);
  });
}

function visibleRecRect() {
  const de = document.documentElement;
  const cw = de.clientWidth || innerWidth, ch = de.clientHeight || innerHeight;
  return { x: 4, y: 52, w: cw - 8, h: ch - 56 };
}

// 録画中の表示：録画範囲の外側に赤い点線、範囲の外に「停止して保存」のバー
function showRecUi(rect, startedAt, L) {
  L = L || { rec: '録画中 {0}', stop: '■ 停止して保存', saving: '保存しています…' };
  const old = document.getElementById('__lpp_rec');
  if (old) old.remove();
  clearInterval(window.__lppRecTimer);
  const host = document.createElement('div');
  host.id = '__lpp_rec';
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none';
  const sh = host.attachShadow({ mode: 'open' });
  sh.innerHTML = `<style>
    .b{position:fixed;border:2px dashed #e0245e;box-sizing:border-box;pointer-events:none}
    .bar{position:fixed;display:flex;align-items:center;gap:10px;background:#0f1419;color:#fff;font:13px/1 system-ui,-apple-system,"Hiragino Sans","Yu Gothic UI",sans-serif;padding:5px 5px 5px 12px;border-radius:999px;pointer-events:auto;box-shadow:0 2px 12px rgba(0,0,0,.35);white-space:nowrap}
    .dot{width:10px;height:10px;border-radius:50%;background:#e0245e;animation:bl 1s infinite}
    @keyframes bl{50%{opacity:.2}}
    .t{font-variant-numeric:tabular-nums}
    button{font:inherit;font-weight:700;border:0;border-radius:999px;background:#e0245e;color:#fff;padding:7px 14px;cursor:pointer}
    button:disabled{opacity:.6;cursor:default}
  </style><div class="b"></div><div class="bar"><span class="dot"></span><span class="t"></span><button></button></div>`;
  const b = sh.querySelector('.b'), bar = sh.querySelector('.bar'), t = sh.querySelector('.t'), btn = sh.querySelector('button');
  Object.assign(b.style, { left: (rect.x - 3) + 'px', top: (rect.y - 3) + 'px', width: (rect.w + 6) + 'px', height: (rect.h + 6) + 'px' });
  t.textContent = L.rec.replace('{0}', '0:00'); btn.textContent = L.stop; // 幅を測る前に文字を入れる
  document.documentElement.appendChild(host);
  const bw = bar.offsetWidth, bh = bar.offsetHeight;
  // バーは録画範囲の外（上、だめなら下）に置く
  let top = rect.y - 3 - bh - 6;
  if (top < 4) { top = rect.y + rect.h + 3 + 6; if (top + bh > innerHeight - 4) top = 4; }
  const left = Math.min(Math.max(4, rect.x + rect.w - bw), innerWidth - bw - 4);
  bar.style.top = top + 'px'; bar.style.left = left + 'px';
  const tick = () => { const s = Math.floor((Date.now() - startedAt) / 1000); t.textContent = L.rec.replace('{0}', `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`); };
  btn.textContent = L.stop;
  tick(); window.__lppRecTimer = setInterval(tick, 500);
  btn.onclick = () => {
    btn.disabled = true; btn.textContent = L.saving;
    chrome.runtime.sendMessage({ target: 'bg', type: 'stopVideo' });
  };
  return true;
}

function hideRecUi() {
  clearInterval(window.__lppRecTimer);
  const el = document.getElementById('__lpp_rec');
  if (el) el.remove();
  return true;
}


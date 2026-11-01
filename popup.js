const DEF = { format: 'pdf', imgq: 'lossless', imgfmt: 'webp', res: 'device', page: 'a4', delay: 600, bottomWait: 1500, hideFixed: true, smartCut: true, maxHeight: 0, splitMB: 1024, audio: true, dest: 'both', history: true, preview: true, lang: 'auto', saveAs: false };
const $ = id => document.getElementById(id);

const FMT = {
  pdf: 'A4 などのページに分けた PDF。PDF ビューアでスクロールして読めます。',
  html: '撮影した画像（WebP）を縦に並べた 1 つの HTML。どのブラウザでも開けます。',
  image: '画像ファイル（WebP・PNG・JPEG は設定で選べます）。長いページは何枚かに分けて zip にまとめます。',
  print: 'A4 などの紙の大きさに区切った印刷用ページを開いて、印刷画面を出します。'
};
function fmtUi(f) {
  $('fmtNote').textContent = t(FMT[f] || FMT.pdf);
  $('pageRow').classList.toggle('off', f !== 'pdf' && f !== 'print');
  $('page').disabled = f !== 'pdf' && f !== 'print';
}
document.querySelectorAll('input[name=format]').forEach(r => r.addEventListener('change', () => {
  chrome.storage.local.set({ format: r.value }); fmtUi(r.value);
}));

async function load() {
  const o = await chrome.storage.local.get(DEF);
  const r = document.querySelector(`input[name=format][value="${o.format}"]`) || document.querySelector('input[name=format][value=pdf]');
  r.checked = true; fmtUi(r.value);
  for (const k of Object.keys(DEF)) {
    if (k === 'format') continue;
    const el = $(k);
    if (el.type === 'checkbox') el.checked = !!o[k]; else el.value = o[k];
  }
  histUi();
}
function save() {
  const o = {};
  for (const k of Object.keys(DEF)) {
    if (k === 'format') continue;
    const el = $(k);
    o[k] = el.type === 'checkbox' ? el.checked : (typeof DEF[k] === 'number' ? +el.value : el.value);
  }
  chrome.storage.local.set(o);
}
document.querySelectorAll('#opt input,#opt select').forEach(e => e.addEventListener('input', save));
// 履歴オフのときは保存先を選べない（ダウンロードだけ）
function histUi() {
  const on = $('history').checked;
  $('destRow').classList.toggle('off', !on);
  $('dest').disabled = !on;
  $('album').title = on ? t('保存の履歴を開く') : t('保存の履歴を開く（いまは履歴に残さない設定です）');
}
$('history').addEventListener('input', histUi);
$('album').onclick = () => chrome.tabs.create({ url: 'history.html' });

let timer = null;
function setButtons(disabled) { document.querySelectorAll('.btns button').forEach(b => { b.disabled = disabled; }); }
function show(running, p, text) {
  setButtons(running);
  $('prog').classList.toggle('hide', !running);
  $('bar').classList.toggle('ind', running && (p == null || p < 0));
  if (p != null && p >= 0) $('fill').style.width = Math.round(p * 100) + '%';
  if (text) $('msg').textContent = text;
}
function showRec(startedAt, text) {
  setButtons(true);
  $('recbox').classList.add('on');
  $('rectext').textContent = text || t('録画中');
  $('msg').textContent = '';
  clearInterval(timer);
  const tick = () => { const s = Math.floor((Date.now() - startedAt) / 1000); $('clock').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  tick(); timer = setInterval(tick, 500);
}
function hideRec() { clearInterval(timer); $('recbox').classList.remove('on'); }

async function activeTab() { const [t] = await chrome.tabs.query({ active: true, currentWindow: true }); return t; }

document.querySelectorAll('.btns.still button').forEach(b => b.onclick = async () => {
  const t = await activeTab(); if (!t) return;
  const mode = b.dataset.mode;
  chrome.runtime.sendMessage({ target: 'bg', type: 'start', tabId: t.id, mode });
  if (mode === 'area') window.close(); // ページ上で範囲を選べるように閉じる
  else show(true, -1, t('準備中…'));
});

document.querySelectorAll('.btns.video button').forEach(b => b.onclick = async () => {
  const t = await activeTab(); if (!t) return;
  const mode = b.dataset.vmode;
  let streamId = null;
  try { streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: t.id }); }
  catch (e) { $('msg').textContent = t('このページは録画できません：{0}', e.message || e); return; }
  chrome.runtime.sendMessage({ target: 'bg', type: 'video', tabId: t.id, mode, streamId });
  if (mode === 'area') window.close();
  else { setButtons(true); $('msg').textContent = t('録画の準備中…'); }
});

$('stop').onclick = () => { $('stop').disabled = true; $('rectext').textContent = t('保存しています…'); chrome.runtime.sendMessage({ target: 'bg', type: 'stopVideo' }); };
$('cancel').onclick = () => chrome.runtime.sendMessage({ target: 'bg', type: 'cancel' });

chrome.runtime.onMessage.addListener(m => {
  if (m.target !== 'popup') return;
  if (m.type === 'progress') show(true, m.progress, m.text);
  if (m.type === 'recording') showRec(m.startedAt, m.text);
  if (m.type === 'done') { hideRec(); $('stop').disabled = false; show(false, null, m.text); }
});

initLang().then(() => { applyI18n(); load(); });
// 言語を変えたらポップアップを開き直す
$('lang').addEventListener('change', () => setTimeout(() => location.reload(), 150));
chrome.runtime.sendMessage({ target: 'bg', type: 'status' }).then(s => {
  if (!s) return;
  if (s.recording) showRec(s.startedAt, s.text);
  else if (s.running) show(true, s.progress, s.text);
  else if (s.last) $('msg').textContent = s.last;
});

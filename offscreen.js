// スクショくん — offscreen ドキュメント
// 撮影した画面の切れ端を 1 ページ分のキャンバスに貼り、いっぱいになったら
// JPEG に圧縮して保持する。最後に PDF / HTML / 画像（1 枚 or zip）にまとめる。

const RATIO = { a4: 1.41421, letter: 1.29412, long: 2.82843 };
let st = null;

chrome.runtime.onMessage.addListener((m, sender, send) => {
  if (m.target !== 'offscreen') return;
  handle(m).then(send, e => send({ error: String(e && e.message || e) }));
  return true;
});

async function handle(m) {
  switch (m.type) {
    case 'begin': {
      await initLang();
      // 1 ファイルの上限（バイト）。形式ごとの仕組み上の上限（zip 4GB・PDF の位置表 10GB）より小さく抑える
      const lim = Math.min((+m.opts.splitMB || 1024) * 1048576, 3.5 * 1073741824);
      st = { o: m.opts, pages: [], bytes: 0, limit: lim, W: 0, PH: 0, s: 0, curH: 0, title: m.title || '', url: m.url || '', part: 0, total: 0 };
      return {};
    }
    case 'add': return add(m);
    case 'finish': return finish(m);
    case 'revoke': URL.revokeObjectURL(m.url); return {};
    case 'vbegin': return vbegin(m);
    case 'vstart': return vstart(m);
    case 'vstop': return vstop();
    case 'vcancel': vclean(); return {};
  }
  return {};
}

function newCanvas() {
  st.cv = new OffscreenCanvas(st.W, st.PH);
  st.ctx = st.cv.getContext('2d', { willReadFrequently: true });
  st.ctx.fillStyle = '#fff';
  st.ctx.fillRect(0, 0, st.W, st.PH);
  st.ctx.imageSmoothingQuality = 'high';
  st.curH = 0;
}

async function add(m) {
  const img = await createImageBitmap(await (await fetch(m.dataUrl)).blob());
  const k = img.width / m.vw; // 撮影画像の画素 / CSS px（画面の倍率）
  const sx = Math.round(m.rect.x * k), sw = Math.min(img.width - sx, Math.round(m.rect.w * k));
  if (!st.W) {
    const want = st.o.res === 'device' || !st.o.res ? k : parseFloat(st.o.res) || k;
    st.s = Math.min(want, k);
    st.k = k;
    st.one = Math.abs(st.s - k) < 1e-6; // 1 対 1（拡大・縮小なし）
    st.W = st.one ? sw : Math.round(m.rect.w * st.s);
    if (st.o.format === 'html' || st.o.format === 'image' || st.o.format === 'print') {
      // HTML・画像は A4 などで区切らず、縦長の大きな塊にする（キャンバス・WebP の上限内）
      st.PH = Math.max(st.W, Math.min(16000, Math.floor(120e6 / st.W)));
    } else {
      st.PH = Math.round(st.W * (RATIO[st.o.page] || RATIO.a4));
    }
    newCanvas();
  }
  // 画面のピクセル単位（整数）で、ページ内の位置を数える。前回の続きの行から始めるので、重なりもすき間もできない
  const aEnd = Math.round((m.docTop + m.h) * k);
  const aStart = st.devDone != null ? st.devDone : Math.round(m.docTop * k);
  let srcY = Math.round(m.rect.y * k) + aStart - Math.round(m.scrollY * k);
  let rows = Math.min(aEnd - aStart, img.height - srcY);
  if (srcY < 0) { rows += srcY; srcY = 0; }
  st.ctx.imageSmoothingEnabled = !st.one;
  while (rows > 0) {
    if (st.one) {
      const t = Math.min(rows, st.PH - st.curH);
      st.ctx.drawImage(img, sx, srcY, sw, t, 0, st.curH, st.W, t);
      st.curH += t; srcY += t; rows -= t;
    } else {
      const r = st.s / k;
      const t = Math.min(rows, Math.max(1, Math.floor((st.PH - st.curH) / r)));
      const dh = Math.max(1, Math.min(st.PH - st.curH, Math.round(t * r)));
      st.ctx.drawImage(img, sx, srcY, sw, t, 0, st.curH, st.W, dh);
      st.curH += dh; srcY += t; rows -= t;
    }
    if (st.curH >= st.PH) await flush(false);
  }
  st.devDone = aEnd;
  img.close();
  // 上限に達したらここまでを 1 ファイルにして先に保存してもらう（保存後はメモリから消える）
  if (st.bytes >= st.limit || st.pages.length >= 60000) {
    const part = await buildOut();
    return { pages: st.total, part };
  }
  return { pages: st.total };
}

// ページ下側 25% の中から、色がそろった（文字や画像を切らない）行を探す
function findCut() {
  const H = st.curH, W = st.W;
  const band = Math.floor(H * 0.25), y0 = H - band;
  const d = st.ctx.getImageData(0, y0, W, band).data;
  const step = Math.max(1, Math.floor(W / 400));
  const n = Math.ceil(W / step);
  const bad = new Int32Array(band);
  for (let r = 0; r < band; r++) {
    const o = r * W * 4, R = d[o], G = d[o + 1], B = d[o + 2];
    let b = 0;
    for (let x = 0; x < W; x += step) {
      const i = o + x * 4;
      if (Math.abs(d[i] - R) + Math.abs(d[i + 1] - G) + Math.abs(d[i + 2] - B) > 30) b++;
    }
    bad[r] = b;
  }
  // 下から探して、最初に見つかったそろった行の連続部分の真ん中で切る
  const ok = r => bad[r] <= n * 0.004;
  for (let r = band - 1; r >= 0; r--) {
    if (!ok(r)) continue;
    let top = r;
    while (top > 0 && ok(top - 1)) top--;
    if (r - top >= 2 || r === band - 1) return y0 + Math.floor((top + r + 1) / 2);
    r = top;
  }
  return H; // 見つからなければそのまま切る
}

async function flush(final) {
  let cut = st.curH;
  if (!final && st.o.smartCut) cut = findCut();
  if (cut < 1) cut = st.curH;
  const out = new OffscreenCanvas(st.W, cut);
  const octx = out.getContext('2d', { willReadFrequently: true });
  octx.drawImage(st.cv, 0, 0, st.W, cut, 0, 0, st.W, cut);
  const pg = { w: st.W, h: cut, k: st.s };
  const q = st.o.imgq || 'lossless';
  if (st.o.format === 'pdf' || !st.o.format) {
    if (q === 'lossless') {
      const px = octx.getImageData(0, 0, st.W, cut).data;
      const ix = await flateIndexed(px, st.W, cut); // 256 色以下なら色の一覧＋番号で記録（劣化なしで小さい）
      if (ix) { pg.blob = ix.blob; pg.palette = ix.palette; pg.flate = true; }
      else { pg.blob = await flateRGB(px, st.W, cut); pg.flate = true; }
    }
    else pg.blob = await out.convertToBlob({ type: 'image/jpeg', quality: q === 'high' ? 0.92 : 0.75 });
  } else {
    // WebP：品質 1.0 は劣化なし（可逆）になる
    if (st.o.format === 'html') {
      // HTML の中の画像は WebP（小さい。品質 1.0 は劣化なし）
      pg.blob = await out.convertToBlob({ type: 'image/webp', quality: q === 'lossless' ? 1 : q === 'high' ? 0.92 : 0.8 });
    } else {
      // 画像・印刷：設定の形式（WebP / PNG / JPEG）。WebP は品質 1.0 で劣化なし、PNG はいつも劣化なし
      const f = st.o.imgfmt || 'webp';
      if (f === 'png') pg.blob = await out.convertToBlob({ type: 'image/png' });
      else if (f === 'jpg') pg.blob = await out.convertToBlob({ type: 'image/jpeg', quality: q === 'lossless' ? 0.95 : q === 'high' ? 0.92 : 0.8 });
      else pg.blob = await out.convertToBlob({ type: 'image/webp', quality: q === 'lossless' ? 1 : q === 'high' ? 0.92 : 0.8 });
    }
  }
  if (!st.pages.length) pg.thumb = await thumbOf(out);
  st.pages.push(pg);
  const jpg = pg.blob;
  st.bytes += st.o.format === 'html' ? jpg.size * 1.34 + 64 : jpg.size + 400; // HTML は base64 で約 1.34 倍
  st.total++;
  const rest = st.curH - cut, old = st.cv;
  newCanvas();
  if (rest > 0) {
    st.ctx.drawImage(old, 0, cut, st.W, rest, 0, 0, st.W, rest);
    st.curH = rest;
  }
}

// たまっているページを 1 ファイルにまとめ、ページの保持を空にする
async function buildOut() {
  const pages = st.pages, f = st.o.format, cssW = Math.round(st.W / st.s);
  st.part++;
  const tag = st.part > 1 || st.bytes >= st.limit ? t('（その {0}）', st.part) : '';
  const first = st.total - pages.length; // 通し番号（画像の名前用）
  let out, ext;
  if (f === 'html') { out = await buildHtml(pages, st.title + tag, st.url, cssW); ext = 'html'; }
  else if (f === 'image' || f === 'print') {
    const ie = { 'image/webp': 'webp', 'image/png': 'png' }[pages[0].blob.type] || 'jpg';
    if (pages.length === 1) { out = pages[0].blob; ext = ie; }
    else { out = await buildZip(pages.map((p, i) => ({ name: `${String(first + i + 1).padStart(4, '0')}.${ie}`, blob: p.blob }))); ext = 'zip'; }
  } else { out = buildPdf(pages, st.title + tag, st.url); ext = 'pdf'; }
  const thumb = pages[0].thumb || '';
  st.pages = []; st.bytes = 0;
  return { url: URL.createObjectURL(out), pages: pages.length, bytes: out.size, ext, no: st.part, thumb,
    w: Math.round(st.W / st.s), h: Math.round(pages.reduce((a, p) => a + p.h, 0) / st.s) };
}

// 最初のページの上の方から、幅 320px のサムネイルを作る
async function thumbOf(img) {
  try {
    const sh = Math.min(img.height, img.width * 1.25);
    const W = 320, H = Math.max(1, Math.round(W * sh / img.width));
    const c = new OffscreenCanvas(W, H);
    c.getContext('2d').drawImage(img, 0, 0, img.width, sh, 0, 0, W, H);
    return await toDataUrl(await c.convertToBlob({ type: 'image/jpeg', quality: 0.7 }));
  } catch (e) { return ''; }
}

async function finish(m) {
  if (!st || !st.W) throw new Error(t('撮影できた画像がありません'));
  if (st.curH > 0) await flush(true);
  const res = st.pages.length ? await buildOut() : null;
  const total = st.total;
  st = null;
  return { last: res, total };
}

function pdfText(s) {
  let h = 'FEFF';
  for (let i = 0; i < s.length; i++) h += s.charCodeAt(i).toString(16).padStart(4, '0');
  return '<' + h.toUpperCase() + '>';
}

function buildPdf(pages, title, url) {
  const parts = [];
  let off = 0;
  const xref = [];
  const push = x => { parts.push(x); off += typeof x === 'string' ? x.length : (x.size !== undefined ? x.size : x.byteLength); };
  const obj = (id, body) => { xref[id] = off; push(`${id} 0 obj\n${body}\nendobj\n`); };

  push('%PDF-1.4\n');
  push(new Uint8Array([37, 226, 227, 207, 211, 10]));
  const n = pages.length;
  obj(1, '<< /Type /Catalog /Pages 2 0 R /PageLayout /OneColumn >>');
  obj(2, `<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + 3 * i} 0 R`).join(' ')}] /Count ${n} >>`);
  const d = new Date(), p = v => String(v).padStart(2, '0');
  const date = `D:${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  obj(3, `<< /Title ${pdfText(title)} /Subject ${pdfText(url)} /Producer ${pdfText(t('スクショくん'))} /CreationDate (${date}) >>`);
  pages.forEach((pg, i) => {
    const W = +(pg.w / (pg.k || 1) * 0.75).toFixed(2), H = +(pg.h / (pg.k || 1) * 0.75).toFixed(2); // 100% 表示で画面と 1 対 1
    obj(4 + 3 * i, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 ${6 + 3 * i} 0 R >> >> /Contents ${5 + 3 * i} 0 R >>`);
    const c = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`;
    obj(5 + 3 * i, `<< /Length ${c.length} >>\nstream\n${c}\nendstream`);
    xref[6 + 3 * i] = off;
    const filt = !pg.flate ? '/Filter /DCTDecode'
      : `/Filter /FlateDecode /DecodeParms << /Predictor 15 /Colors ${pg.palette ? 1 : 3} /BitsPerComponent 8 /Columns ${pg.w} >>`;
    const cs = pg.palette ? `[/Indexed /DeviceRGB ${pg.palette.length / 3 - 1} <${Array.from(pg.palette, v => v.toString(16).padStart(2, '0')).join('')}>]` : '/DeviceRGB';
    push(`${6 + 3 * i} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${pg.w} /Height ${pg.h} /ColorSpace ${cs} /BitsPerComponent 8 ${filt} /Length ${pg.blob.size} >>\nstream\n`);
    push(pg.blob);
    push('\nendstream\nendobj\n');
  });
  const size = 4 + 3 * n;
  const xo = off;
  let x = `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let i = 1; i < size; i++) x += String(xref[i]).padStart(10, '0') + ' 00000 n \n';
  push(x);
  push(`trailer\n<< /Size ${size} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xo}\n%%EOF\n`);
  return new Blob(parts, { type: 'application/pdf' });
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function toDataUrl(blob) {
  return new Promise((ok, ng) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = ng; r.readAsDataURL(blob); });
}

// 撮影画像を縦に並べた 1 ファイルの HTML（外部ファイルなしでどのブラウザでも開ける）
async function buildHtml(pages, title, url, cssW) {
  const d = new Date(), p = v => String(v).padStart(2, '0');
  const when = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  const parts = [`<!doctype html>
<html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title || url)}</title>
<style>
body{margin:0;background:#e9ecef;font:14px/1.6 system-ui,-apple-system,"Hiragino Sans","Yu Gothic UI",sans-serif;color:#333}
.info{max-width:${cssW}px;margin:0 auto;padding:12px 12px 10px;word-break:break-all}
.info b{font-size:15px}.info a{color:#0b62c4}.info small{color:#666}
.pg{max-width:${cssW}px;margin:0 auto 24px;background:#fff;box-shadow:0 2px 12px rgba(0,0,0,.15)}
.pg img{display:block;width:100%;height:auto}
@media (prefers-color-scheme:dark){body{background:#202124;color:#ddd}.info a{color:#8ab4f8}.info small{color:#aaa}}
</style></head><body>
<div class="info"><b>${esc(title)}</b><br><a href="${esc(url)}">${esc(url)}</a><br><small>${esc(t('{0} に スクショくん で保存', when))}</small></div>
<div class="pg">
`];
  for (const pg of pages) {
    parts.push(`<img src="${await toDataUrl(pg.blob)}" width="${pg.w}" height="${pg.h}" alt="">\n`);
  }
  parts.push('</div>\n</body></html>\n');
  return new Blob(parts, { type: 'text/html' });
}

// 無圧縮（store）の zip。中身はすでに JPEG なので圧縮しなくてよい
let CRC_T = null;
function crc32(u8) {
  if (!CRC_T) {
    CRC_T = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC_T[n] = c >>> 0; }
  }
  let c = 0xFFFFFFFF;
  for (let i = 0; i < u8.length; i++) c = CRC_T[(c ^ u8[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

async function buildZip(files) {
  const parts = [], central = [];
  let off = 0;
  const d = new Date();
  const dosT = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const dosD = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const f of files) {
    const data = new Uint8Array(await f.blob.arrayBuffer());
    const crc = crc32(data), name = new TextEncoder().encode(f.name), n = data.length;
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
    h.setUint16(10, dosT, true); h.setUint16(12, dosD, true); h.setUint32(14, crc, true);
    h.setUint32(18, n, true); h.setUint32(22, n, true); h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
    parts.push(h.buffer, name, f.blob);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
    c.setUint16(10, 0, true); c.setUint16(12, dosT, true); c.setUint16(14, dosD, true); c.setUint32(16, crc, true);
    c.setUint32(20, n, true); c.setUint32(24, n, true); c.setUint16(28, name.length, true);
    c.setUint32(42, off, true);
    central.push(c.buffer, name);
    off += 30 + name.length + n;
  }
  const cdSize = central.reduce((a, b) => a + b.byteLength, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
  e.setUint32(12, cdSize, true); e.setUint32(16, off, true);
  return new Blob([...parts, ...central, e.buffer], { type: 'application/zip' });
}

/* ---------- 録画（タブの映像を MediaRecorder で記録） ---------- */

let V = null;

async function vbegin(m) {
  const W = Math.round(m.vw * m.dpr), H = Math.round(m.vh * m.dpr);
  const src = { chromeMediaSource: 'tab', chromeMediaSourceId: m.streamId };
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: m.audio ? { mandatory: src } : false,
    video: { mandatory: { ...src, maxWidth: W, maxHeight: H, minWidth: W, minHeight: H, maxFrameRate: 30 } }
  });
  let ac = null;
  if (m.audio && stream.getAudioTracks().length) {
    // 録画中もタブの音が聞こえるように、音をそのまま流し直す
    ac = new AudioContext();
    ac.createMediaStreamSource(stream).connect(ac.destination);
  }
  V = { stream, ac, m, chunks: [], bytes: 0, part: 0, limit: Math.min((+m.splitMB || 1024) * 1048576, 3.5 * 1073741824), extra: [] };
  stream.getVideoTracks()[0].addEventListener('ended', () => {
    if (V && !V.stopping) chrome.runtime.sendMessage({ target: 'bg', type: 'vended' }).catch(() => {});
  });
  return {};
}

function pickMime() {
  for (const t of ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'])
    if (MediaRecorder.isTypeSupported(t)) return t;
  return '';
}

// 範囲だけを切り出した映像トラックを作る
function cropTrack(track, rect, vw) {
  if (typeof MediaStreamTrackProcessor === 'function' && typeof MediaStreamTrackGenerator === 'function') {
    try {
      const proc = new MediaStreamTrackProcessor({ track });
      const gen = new MediaStreamTrackGenerator({ kind: 'video' });
      const ev = n => Math.max(0, Math.floor(n / 2) * 2);
      let oc = null, og = null;
      proc.readable.pipeThrough(new TransformStream({
        transform(frame, ctl) {
          const k = frame.displayWidth / vw;
          const x = ev(rect.x * k), y = ev(rect.y * k);
          const w = Math.min(ev(rect.w * k), ev(frame.codedWidth - x)), h = Math.min(ev(rect.h * k), ev(frame.codedHeight - y));
          try {
            // フレームの必要な部分だけをキャンバスに描き、新しいフレームにする
            if (!oc || oc.width !== w || oc.height !== h) { oc = new OffscreenCanvas(w, h); og = oc.getContext('2d'); }
            og.drawImage(frame, x, y, w, h, 0, 0, w, h);
            ctl.enqueue(new VideoFrame(oc, { timestamp: frame.timestamp }));
          } catch (e) { /* 変換できないフレームは捨てる */ }
          frame.close();
        }
      })).pipeTo(gen.writable).catch(() => {});
      return gen;
    } catch (e) { /* 下の方法に切り替える */ }
  }
  // 予備：video 要素からキャンバスに描いて切り出す
  const vid = document.createElement('video');
  vid.muted = true; vid.srcObject = new MediaStream([track]); vid.play();
  const cv = document.createElement('canvas');
  const ctx = cv.getContext('2d');
  const draw = () => {
    if (!V || V.stopping) return;
    if (vid.videoWidth) {
      const k = vid.videoWidth / vw;
      if (!cv.width) { cv.width = Math.round(rect.w * k); cv.height = Math.round(rect.h * k); }
      ctx.drawImage(vid, rect.x * k, rect.y * k, rect.w * k, rect.h * k, 0, 0, cv.width, cv.height);
    }
    vid.requestVideoFrameCallback ? vid.requestVideoFrameCallback(draw) : setTimeout(draw, 33);
  };
  draw();
  V.extra.push(vid);
  return cv.captureStream(30).getVideoTracks()[0];
}

async function vstart(m) {
  let out = V.stream;
  if (m.rect) {
    const vt = cropTrack(V.stream.getVideoTracks()[0], m.rect, m.vw);
    out = new MediaStream([vt, ...V.stream.getAudioTracks()]);
  }
  V.out = out;
  V.mime = pickMime();
  V.ext = V.mime.startsWith('video/mp4') ? 'mp4' : 'webm';
  newRecorder();
  return { mime: V.mime, ext: V.ext };
}

function newRecorder() {
  const r = new MediaRecorder(V.out, { mimeType: V.mime, videoBitsPerSecond: 6e6 });
  V.rec = r; V.chunks = []; V.bytes = 0;
  r.ondataavailable = e => {
    if (!e.data || !e.data.size) return;
    V.chunks.push(e.data); V.bytes += e.data.size;
    if (V.bytes >= V.limit && !V.rotating && !V.stopping) rotate();
  };
  r.start(1000);
}

function stopRec() {
  return new Promise(ok => {
    const r = V.rec;
    r.onstop = () => ok(new Blob(V.chunks, { type: V.mime.split(';')[0] || 'video/webm' }));
    r.stop();
  });
}

// 上限に達したら、ここまでを 1 ファイルにして保存し、録画を続ける
async function rotate() {
  V.rotating = true;
  const blob = await stopRec();
  newRecorder();
  V.part++;
  const part = { url: URL.createObjectURL(blob), ext: V.ext, bytes: blob.size, no: V.part };
  V.rotating = false;
  await chrome.runtime.sendMessage({ target: 'bg', type: 'vpart', part }).catch(() => {});
}

async function vstop() {
  if (!V || !V.rec) throw new Error('録画していません');
  V.stopping = true;
  while (V.rotating) await new Promise(r => setTimeout(r, 100));
  const blob = await stopRec();
  const res = { url: URL.createObjectURL(blob), ext: V.ext, bytes: blob.size, no: V.part + 1 };
  vclean();
  return res;
}

function vclean() {
  if (!V) return;
  V.stopping = true;
  V.stream.getTracks().forEach(t => t.stop());
  if (V.out) V.out.getTracks().forEach(t => t.stop());
  if (V.ac) V.ac.close().catch(() => {});
  V.extra.forEach(v => { v.srcObject = null; });
  V = null;
}

// 劣化なし PDF 用：RGB の画素を PNG と同じ行フィルタ（Sub/Up/Paeth から行ごとに選ぶ）で並べ、deflate 圧縮する
async function flateRGB(px, W, H) {
  const rl = W * 3, raw = new Uint8Array((rl + 1) * H);
  let prev = new Uint8Array(rl), cur = new Uint8Array(rl);
  const cand = [new Uint8Array(rl), new Uint8Array(rl), new Uint8Array(rl)];
  for (let y = 0; y < H; y++) {
    for (let x = 0, i = y * W * 4, j = 0; x < W; x++, i += 4, j += 3) { cur[j] = px[i]; cur[j + 1] = px[i + 1]; cur[j + 2] = px[i + 2]; }
    const sums = [0, 0, 0];
    for (let j = 0; j < rl; j++) {
      const a = j >= 3 ? cur[j - 3] : 0, b = prev[j], c = j >= 3 ? prev[j - 3] : 0, v = cur[j];
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      const s0 = (v - a) & 255, s1 = (v - b) & 255, s2 = (v - pr) & 255;
      cand[0][j] = s0; cand[1][j] = s1; cand[2][j] = s2;
      sums[0] += s0 < 128 ? s0 : 256 - s0; sums[1] += s1 < 128 ? s1 : 256 - s1; sums[2] += s2 < 128 ? s2 : 256 - s2;
    }
    const k = sums[0] <= sums[1] && sums[0] <= sums[2] ? 0 : sums[1] <= sums[2] ? 1 : 2;
    const o = y * (rl + 1);
    raw[o] = k + 1; // 1=Sub 2=Up 4=Paeth
    if (k === 2) raw[o] = 4;
    raw.set(cand[k], o + 1);
    const t = prev; prev = cur; cur = t;
  }
  return await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'))).blob();
}

// 256 色以下の画像は、色の一覧（パレット）と 1 画素 1 バイトの番号で記録する。超えたら null
async function flateIndexed(px, W, H) {
  const map = new Map(), pal = [];
  const idx = new Uint8Array(W * H);
  for (let i = 0, j = 0; j < idx.length; i += 4, j++) {
    const c = (px[i] << 16) | (px[i + 1] << 8) | px[i + 2];
    let n = map.get(c);
    if (n === undefined) {
      if (pal.length >= 256) return null;
      n = pal.length; map.set(c, n); pal.push(c);
    }
    idx[j] = n;
  }
  // 行ごとに None と Up のうち小さくなりそうな方を選ぶ（PNG 予測子）
  const rl = W, raw = new Uint8Array((rl + 1) * H), up = new Uint8Array(rl);
  for (let y = 0; y < H; y++) {
    const row = idx.subarray(y * W, y * W + W), o = y * (rl + 1);
    let s0 = 0, s1 = 0;
    if (y) for (let x = 0; x < W; x++) { const d = (row[x] - idx[(y - 1) * W + x]) & 255; up[x] = d; s1 += d ? 1 : 0; s0 += row[x] ? 1 : 0; }
    if (y && s1 < s0) { raw[o] = 2; raw.set(up, o + 1); } else { raw[o] = 0; raw.set(row, o + 1); }
  }
  const palette = new Uint8Array(pal.length * 3);
  pal.forEach((c, i) => { palette[i * 3] = c >> 16; palette[i * 3 + 1] = (c >> 8) & 255; palette[i * 3 + 2] = c & 255; });
  const blob = await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'))).blob();
  return { blob, palette };
}

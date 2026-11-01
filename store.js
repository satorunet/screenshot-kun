// スクショくん — 履歴（chrome.storage.local）からファイルを読み出す共通処理

const blobCache = new Map(); // 一時保存を消したあとも、このページでは開けるように覚えておく

async function dropTemp(item) {
  const { albumIndex = [] } = await chrome.storage.local.get('albumIndex');
  await chrome.storage.local.set({ albumIndex: albumIndex.filter(x => x.id !== item.id) });
  const keys = ['t:' + item.id];
  for (let n = 0; n < item.chunks; n++) keys.push(`a:${item.id}:${n}`);
  await chrome.storage.local.remove(keys);
}

async function blobOf(i) {
  if (blobCache.has(i.id)) return blobCache.get(i.id);
  const b = await blobOfStore(i);
  if (i.temp) blobCache.set(i.id, b);
  return b;
}

async function blobOfStore(i) {
  const keys = Array.from({ length: i.chunks }, (_, n) => `a:${i.id}:${n}`);
  const parts = [];
  for (let n = 0; n < keys.length; n += 4) { // 少しずつ読む（巨大なファイルでも止まらないように）
    const r = await chrome.storage.local.get(keys.slice(n, n + 4));
    for (const k of keys.slice(n, n + 4)) {
      const s = atob(r[k] || '');
      const u8 = new Uint8Array(s.length);
      for (let j = 0; j < s.length; j++) u8[j] = s.charCodeAt(j);
      parts.push(u8);
    }
  }
  return new Blob(parts, { type: i.mime });
}


// 自分で作った無圧縮 zip から中身を取り出す
async function unzipStored(blob) {
  const u8 = new Uint8Array(await blob.arrayBuffer()), dv = new DataView(u8.buffer);
  const out = [];
  let p = 0;
  while (p + 30 <= u8.length && dv.getUint32(p, true) === 0x04034b50) {
    const size = dv.getUint32(p + 18, true), nl = dv.getUint16(p + 26, true), xl = dv.getUint16(p + 28, true);
    const name = new TextDecoder().decode(u8.subarray(p + 30, p + 30 + nl));
    const s = p + 30 + nl + xl;
    out.push({ name, blob: new Blob([u8.subarray(s, s + size)], { type: name.endsWith('.webp') ? 'image/webp' : name.endsWith('.png') ? 'image/png' : 'image/jpeg' }) });
    p = s + size;
  }
  return out;
}


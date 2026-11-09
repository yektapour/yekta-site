/* Yekta Light — tiny dependency-free PNG encoder (works in UXP, browsers, Electron, Node).
   UXP has no full Canvas, so every pixel image is produced here and shown through <img src="data:...">. */
(function (L) {
  'use strict';
  const CRC = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    CRC[n] = c >>> 0;
  }
  function crc32(b, s, e) {
    let c = 0xffffffff;
    for (let i = s; i < e; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  function u32(b, o, v) {
    b[o] = (v >>> 24) & 255; b[o + 1] = (v >>> 16) & 255; b[o + 2] = (v >>> 8) & 255; b[o + 3] = v & 255;
  }

  function encode(w, h, rgba) {
    const rowLen = w * 4 + 1, raw = rowLen * h;
    const nBlocks = Math.max(1, Math.ceil(raw / 65535));
    const zlen = 2 + raw + nBlocks * 5 + 4;
    const out = new Uint8Array(8 + 25 + 12 + zlen + 12);
    out.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
    let p = 8;
    // IHDR
    u32(out, p, 13); out.set([73, 72, 68, 82], p + 4);
    u32(out, p + 8, w); u32(out, p + 12, h);
    out.set([8, 6, 0, 0, 0], p + 16);
    u32(out, p + 21, crc32(out, p + 4, p + 21)); p += 25;
    // IDAT
    u32(out, p, zlen); out.set([73, 68, 65, 84], p + 4);
    const ds = p + 4; p += 8;
    out[p++] = 0x78; out[p++] = 0x01;
    let a = 1, b = 0, left = raw, x = 0, y = 0, src = 0;
    while (left > 0) {
      const n = Math.min(65535, left); left -= n;
      out[p++] = left === 0 ? 1 : 0;
      out[p++] = n & 255; out[p++] = n >>> 8; out[p++] = ~n & 255; out[p++] = (~n >>> 8) & 255;
      for (let i = 0; i < n; i++) {
        let v;
        if (x === 0) v = 0; else v = rgba[src++];
        if (++x === rowLen) { x = 0; y++; }
        out[p++] = v;
        a += v; if (a >= 65521) a -= 65521;
        b += a; if (b >= 65521) b -= 65521;
      }
    }
    u32(out, p, ((b << 16) | a) >>> 0); p += 4;
    u32(out, p, crc32(out, ds, p)); p += 4;
    // IEND
    u32(out, p, 0); out.set([73, 69, 78, 68], p + 4); u32(out, p + 8, crc32(out, p + 4, p + 8)); p += 12;
    return out;
  }

  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const PAIR = new Array(4096);
  for (let i = 0; i < 4096; i++) PAIR[i] = A[i >> 6] + A[i & 63];
  function base64(u) {
    const parts = []; let s = '';
    const n = u.length - (u.length % 3);
    for (let i = 0; i < n; i += 3) {
      const v = (u[i] << 16) | (u[i + 1] << 8) | u[i + 2];
      s += PAIR[v >> 12] + PAIR[v & 4095];
      if (s.length > 16384) { parts.push(s); s = ''; }
    }
    const r = u.length - n;
    if (r === 1) { const v = u[n] << 16; s += PAIR[v >> 12] + '=='; }
    else if (r === 2) { const v = (u[n] << 16) | (u[n + 1] << 8); s += PAIR[v >> 12] + A[(v >> 6) & 63] + '='; }
    parts.push(s);
    return parts.join('');
  }

  L.png = {
    encode,
    base64,
    dataURL: (w, h, rgba) => 'data:image/png;base64,' + base64(encode(w, h, rgba)),
  };
})((window.Yekta = window.Yekta || {}));

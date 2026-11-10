// Minimaler QR-Code-Generator (Byte-Modus, Fehlerkorrektur M, Version 1–6).
// Reicht locker für eine Adresse wie http://192.168.178.23:3000/
(function (root) {
  const ECC = [-1, 10, 16, 26, 18, 24, 16];
  const BLOCKS = [-1, 1, 1, 1, 2, 2, 4];

  function gfMul(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x; }
    return z & 0xff;
  }
  function rsDivisor(degree) {
    const r = new Array(degree).fill(0); r[degree - 1] = 1; let root = 1;
    for (let i = 0; i < degree; i++) {
      for (let j = 0; j < r.length; j++) { r[j] = gfMul(r[j], root); if (j + 1 < r.length) r[j] ^= r[j + 1]; }
      root = gfMul(root, 0x02);
    }
    return r;
  }
  function rsRemainder(data, div) {
    const r = div.map(() => 0);
    for (const b of data) { const f = b ^ r.shift(); r.push(0); div.forEach((c, i) => { r[i] ^= gfMul(c, f); }); }
    return r;
  }
  function rawModules(ver) {
    let r = (16 * ver + 128) * ver + 64;
    if (ver >= 2) { const n = Math.floor(ver / 7) + 2; r -= (25 * n - 10) * n - 55; }
    return r;
  }
  const dataCodewords = ver => Math.floor(rawModules(ver) / 8) - ECC[ver] * BLOCKS[ver];

  function encode(text) {
    const bytes = Array.from(new TextEncoder().encode(text));
    let ver = 1;
    while (ver <= 6 && 4 + 8 + bytes.length * 8 > dataCodewords(ver) * 8) ver++;
    if (ver > 6) throw new Error('Text zu lang für QR');
    const cap = dataCodewords(ver) * 8;
    const bits = [];
    const put = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); };
    put(4, 4); put(bytes.length, 8); bytes.forEach(b => put(b, 8));
    put(0, Math.min(4, cap - bits.length));
    put(0, (8 - bits.length % 8) % 8);
    for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) put(pad, 8);
    const data = [];
    for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));

    // Fehlerkorrektur + Verschachtelung
    const nb = BLOCKS[ver], el = ECC[ver], raw = Math.floor(rawModules(ver) / 8);
    const nShort = nb - raw % nb, shortLen = Math.floor(raw / nb), div = rsDivisor(el);
    const blocks = [];
    for (let i = 0, k = 0; i < nb; i++) {
      const d = data.slice(k, k + shortLen - el + (i < nShort ? 0 : 1)); k += d.length;
      const e = rsRemainder(d, div); if (i < nShort) d.push(0); blocks.push(d.concat(e));
    }
    const all = [];
    for (let i = 0; i < blocks[0].length; i++)
      blocks.forEach((b, j) => { if (i !== shortLen - el || j >= nShort) all.push(b[i]); });

    const size = ver * 4 + 17;
    const m = Array.from({ length: size }, () => new Array(size).fill(false));
    const fn = Array.from({ length: size }, () => new Array(size).fill(false));
    const setF = (x, y, d) => { m[y][x] = d; fn[y][x] = true; };

    for (let i = 0; i < size; i++) { setF(6, i, i % 2 === 0); setF(i, 6, i % 2 === 0); }
    [[3, 3], [size - 4, 3], [3, size - 4]].forEach(([x, y]) => {
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy)), xx = x + dx, yy = y + dy;
        if (xx >= 0 && xx < size && yy >= 0 && yy < size) setF(xx, yy, dist !== 2 && dist !== 4);
      }
    });
    if (ver >= 2) {
      const n = Math.floor(ver / 7) + 2, step = Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2, pos = [6];
      for (let p = size - 7; pos.length < n; p -= step) pos.splice(1, 0, p);
      pos.forEach((px, i) => pos.forEach((py, j) => {
        if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) return;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setF(px + dx, py + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }));
    }
    const drawFormat = mask => {
      const d = (0 << 3) | mask; // ECC-Level M = 00
      let r = d; for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
      const b = ((d << 10) | r) ^ 0x5412, bit = i => ((b >>> i) & 1) === 1;
      for (let i = 0; i <= 5; i++) setF(8, i, bit(i));
      setF(8, 7, bit(6)); setF(8, 8, bit(7)); setF(7, 8, bit(8));
      for (let i = 9; i < 15; i++) setF(14 - i, 8, bit(i));
      for (let i = 0; i < 8; i++) setF(size - 1 - i, 8, bit(i));
      for (let i = 8; i < 15; i++) setF(8, size - 15 + i, bit(i));
      setF(8, size - 8, true);
    };
    drawFormat(0);

    let i = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let v = 0; v < size; v++) for (let j = 0; j < 2; j++) {
        const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - v : v;
        if (!fn[y][x] && i < all.length * 8) { m[y][x] = ((all[i >>> 3] >>> (7 - (i & 7))) & 1) === 1; i++; }
      }
    }

    const maskFn = [
      (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, x => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
      (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => (x * y) % 2 + (x * y) % 3 === 0,
      (x, y) => ((x * y) % 2 + (x * y) % 3) % 2 === 0, (x, y) => ((x + y) % 2 + (x * y) % 3) % 2 === 0,
    ];
    const applyMask = k => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && maskFn[k](x, y)) m[y][x] = !m[y][x]; };
    const penalty = () => {
      let p = 0, dark = 0;
      for (let a = 0; a < size; a++) {
        let rr = 1, rc = 1;
        for (let b = 1; b < size; b++) {
          if (m[a][b] === m[a][b - 1]) { rr++; if (rr === 5) p += 3; else if (rr > 5) p++; } else rr = 1;
          if (m[b][a] === m[b - 1][a]) { rc++; if (rc === 5) p += 3; else if (rc > 5) p++; } else rc = 1;
        }
      }
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        if (m[y][x]) dark++;
        if (x < size - 1 && y < size - 1 && m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) p += 3;
      }
      return p + Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
    };
    let best = 0, bestP = Infinity;
    for (let k = 0; k < 8; k++) { applyMask(k); drawFormat(k); const pn = penalty(); if (pn < bestP) { bestP = pn; best = k; } applyMask(k); }
    applyMask(best); drawFormat(best);
    return m;
  }

  function toSvg(text, opts = {}) {
    const m = encode(text), q = 4, n = m.length + q * 2;
    let d = '';
    m.forEach((row, y) => row.forEach((on, x) => { if (on) d += `M${x + q},${y + q}h1v1h-1z`; }));
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges">` +
      `<rect width="${n}" height="${n}" fill="${opts.light || '#fff'}"/><path d="${d}" fill="${opts.dark || '#000'}"/></svg>`;
  }

  const api = { encode, toSvg };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.QR = api;
})(this);

/* End-to-end validation of our QR encoder, independent of any other encoder.
 *
 * Decodes each generated matrix the way a scanner does: read format info,
 * un-apply the mask, walk the zig-zag, de-interleave the blocks, verify every
 * Reed-Solomon syndrome is zero, then parse the byte-mode payload back to text.
 *
 * This is a stronger guarantee than matching another library, because mask
 * choice is a free optimisation - a differently-masked QR is still valid.
 */
const fs = require('fs');
const path = '/Users/yashbhake/Desktop/IDFC/docs/Onboarding/ppt/presentation/assets/qr.js';
const src = fs.readFileSync(path, 'utf8').replace(
  'global.QR = { matrix: qrMatrix, toCanvas: qrToCanvas };',
  'global.QR = { matrix: qrMatrix, toCanvas: qrToCanvas, _build:buildMatrix, _cw:buildCodewords, _utf8:toUtf8, _ver:pickVersion, _V:VERSIONS, _REM:REMAINDER, _EXP:EXP, _LOG:LOG };'
);
const mod = { exports: {} };
new Function('module', 'exports', src)(mod, mod.exports);
const QR = globalThis.QR;

const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => (r * c) % 2 + (r * c) % 3 === 0,
  (r, c) => ((r * c) % 2 + (r * c) % 3) % 2 === 0,
  (r, c) => ((r + c) % 2 + (r * c) % 3) % 2 === 0,
];

const gmul = (a, b) => (a === 0 || b === 0) ? 0 : QR._EXP[QR._LOG[a] + QR._LOG[b]];

function decode(m) {
  const size = m.length;
  const version = (size - 17) / 4;

  // --- format info (copy 1), MSB first
  const copy1 = [[8,0],[8,1],[8,2],[8,3],[8,4],[8,5],[8,7],[8,8],[7,8],[5,8],[4,8],[3,8],[2,8],[1,8],[0,8]];
  let fmt = 0;
  copy1.forEach(([r, c], i) => { if (m[r][c]) fmt |= 1 << (14 - i); });
  const unmasked = fmt ^ 0b101010000010010;
  const dataBits = unmasked >> 10;
  const ecLevel = dataBits >> 3;
  const mask = dataBits & 7;
  if (ecLevel !== 0b00) throw new Error(`format says EC level bits ${ecLevel.toString(2)}, expected 00 (M)`);

  // --- reserved map: rebuild function patterns for this version
  const spec = QR._V[version];
  const built = QR._build(new Array(spec[0] + spec[1] * spec[2].reduce((a, g) => a + g[0], 0)).fill(0), version);
  const reserved = built.reserved;

  // --- un-apply mask
  const u = m.map(row => row.slice());
  for (let r = 0; r < size; r++)
    for (let c = 0; c < size; c++)
      if (!reserved[r][c] && MASKS[mask](r, c)) u[r][c] = !u[r][c];

  // --- walk the zig-zag, same order as the encoder
  const bits = [];
  let up = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (let n = 0; n < size; n++) {
      const row = up ? size - 1 - n : n;
      for (let s = 0; s < 2; s++) {
        const cc = col - s;
        if (reserved[row][cc]) continue;
        bits.push(u[row][cc] ? 1 : 0);
      }
    }
    up = !up;
  }

  const totalCw = spec[0] + spec[1] * spec[2].reduce((a, g) => a + g[0], 0);
  const cw = [];
  for (let i = 0; i + 8 <= bits.length && cw.length < totalCw; i += 8) {
    let v = 0;
    for (let k = 0; k < 8; k++) v = (v << 1) | bits[i + k];
    cw.push(v);
  }

  // --- de-interleave back into blocks
  const ecLen = spec[1];
  const layout = [];
  spec[2].forEach(g => { for (let n = 0; n < g[0]; n++) layout.push(g[1]); });
  const nBlocks = layout.length;
  const dataBlocks = layout.map(len => new Array(len));
  const ecBlocks = Array.from({ length: nBlocks }, () => new Array(ecLen));

  let p = 0;
  const maxData = Math.max(...layout);
  for (let c = 0; c < maxData; c++)
    for (let b = 0; b < nBlocks; b++)
      if (c < layout[b]) dataBlocks[b][c] = cw[p++];
  for (let e = 0; e < ecLen; e++)
    for (let b = 0; b < nBlocks; b++) ecBlocks[b][e] = cw[p++];

  // --- every RS syndrome must be zero
  for (let b = 0; b < nBlocks; b++) {
    const full = dataBlocks[b].concat(ecBlocks[b]);
    for (let s = 0; s < ecLen; s++) {
      let acc = 0;
      const x = QR._EXP[s];
      for (let i = 0; i < full.length; i++) acc = gmul(acc, x) ^ full[i];
      if (acc !== 0) throw new Error(`RS syndrome ${s} non-zero in block ${b} (corrupt codewords)`);
    }
  }

  // --- parse the payload
  const flat = [];
  dataBlocks.forEach(blk => blk.forEach(byte => flat.push(byte)));
  const bs = [];
  flat.forEach(byte => { for (let i = 7; i >= 0; i--) bs.push((byte >> i) & 1); });
  let idx = 0;
  const take = (n) => { let v = 0; for (let i = 0; i < n; i++) v = (v << 1) | bs[idx++]; return v; };

  const mode = take(4);
  if (mode !== 0b0100) throw new Error(`mode ${mode.toString(2)}, expected 0100 (byte)`);
  const count = take(version < 10 ? 8 : 16);
  const out = [];
  for (let i = 0; i < count; i++) out.push(take(8));
  return new TextDecoder().decode(Uint8Array.from(out));
}

/* ---------------------------------------------------------------- run */

const fixed = [
  'https://yashbhake.github.io/astro/respond.html?q=reading',
  'https://yashbhake.github.io/astrology-deck/respond.html?q=word1',
  'https://example.github.io/some-longer-repo-name/respond.html?q=guess&s=live',
  'HELLO', 'https://a.io/r?q=1',
  'नमस्ते world', 'x'.repeat(14), 'y'.repeat(15), 'z'.repeat(84),
  'w'.repeat(85), 'q'.repeat(122), 'q'.repeat(152), 'q'.repeat(180), 'q'.repeat(213),
];

let n = 0;
const check = (text) => {
  const got = decode(QR.matrix(text));
  if (got !== text) throw new Error(`round-trip mismatch:\n  in  ${JSON.stringify(text)}\n  out ${JSON.stringify(got)}`);
  n++;
};

for (const t of fixed) {
  try {
    check(t);
    const size = QR.matrix(t).length;
    console.log(`  ok  v${String((size - 17) / 4).padStart(2)}  ${JSON.stringify(t.length > 40 ? t.slice(0, 40) + '…' : t)}`);
  } catch (e) { console.error(`FAIL ${JSON.stringify(t.slice(0, 40))}: ${e.message}`); process.exit(1); }
}

const alpha = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~:/?#[]@!$&()*+,;=';
for (let i = 0; i < 600; i++) {
  const len = 1 + Math.floor(Math.random() * 213);
  let s = '';
  for (let k = 0; k < len; k++) s += alpha[Math.floor(Math.random() * alpha.length)];
  try { check(s); } catch (e) { console.error(`FAIL fuzz len=${len}: ${e.message}`); process.exit(1); }
}

console.log(`\nPASS ${n} strings encoded and decoded back byte-for-byte.`);
console.log('Format info, mask, zig-zag, block de-interleaving and all Reed-Solomon');
console.log('syndromes verified. Versions 1-10, EC level M.');

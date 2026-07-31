/* qr.js, minimal QR encoder. Byte mode, error-correction level M, versions 1–10.
 *
 * Self-contained on purpose: the QR codes are the one thing that MUST work on
 * the day, so there is no CDN and no library to fail on venue WiFi.
 *
 * qrMatrix(text) -> array of arrays of booleans (true = dark module)
 */
(function (global) {
  "use strict";

  // data codewords available per version at EC level M, and the block layout
  // [ totalDataCodewords, ecCodewordsPerBlock, [ [blockCount, dataPerBlock], ... ] ]
  var VERSIONS = {
    1:  [16,  10, [[1, 16]]],
    2:  [28,  16, [[1, 28]]],
    3:  [44,  26, [[1, 44]]],
    4:  [64,  18, [[2, 32]]],
    5:  [86,  24, [[2, 43]]],
    6:  [108, 16, [[4, 27]]],
    7:  [124, 18, [[4, 31]]],
    8:  [154, 22, [[2, 38], [2, 39]]],
    9:  [182, 22, [[3, 36], [2, 37]]],
    10: [216, 26, [[4, 43], [1, 44]]]
  };

  // alignment-pattern centre coordinates per version
  var ALIGN = {
    1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
    6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50]
  };

  // remainder bits appended after the final codeword
  var REMAINDER = { 1: 0, 2: 7, 3: 7, 4: 7, 5: 7, 6: 7, 7: 0, 8: 0, 9: 0, 10: 0 };

  /* ---------------------------------------------------------- GF(256) */

  var EXP = new Uint8Array(512), LOG = new Uint8Array(256);
  (function () {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;          // primitive polynomial
    }
    for (var j = 255; j < 512; j++) EXP[j] = EXP[j - 255];
  })();

  function gmul(a, b) {
    if (a === 0 || b === 0) return 0;
    return EXP[LOG[a] + LOG[b]];
  }

  // generator polynomial of degree `deg`
  function rsGenerator(deg) {
    var poly = [1];
    for (var i = 0; i < deg; i++) {
      var next = new Array(poly.length + 1).fill(0);
      for (var j = 0; j < poly.length; j++) {
        next[j] ^= poly[j];
        next[j + 1] ^= gmul(poly[j], EXP[i]);
      }
      poly = next;
    }
    return poly;
  }

  function rsEncode(data, ecLen) {
    var gen = rsGenerator(ecLen);
    var rem = new Array(ecLen).fill(0);
    for (var i = 0; i < data.length; i++) {
      var factor = data[i] ^ rem[0];
      rem.shift();
      rem.push(0);
      for (var j = 0; j < ecLen; j++) rem[j] ^= gmul(gen[j + 1], factor);
    }
    return rem;
  }

  /* ---------------------------------------------------- bitstream */

  function toUtf8(str) {
    var out = [], enc = new TextEncoder().encode(str);
    for (var i = 0; i < enc.length; i++) out.push(enc[i]);
    return out;
  }

  function pickVersion(byteLen) {
    for (var v = 1; v <= 10; v++) {
      var capacity = VERSIONS[v][0];
      var countBits = v < 10 ? 8 : 16;                 // byte mode: 8 bits for v1–9, 16 for v10+
      var needBits = 4 + countBits + byteLen * 8;
      if (Math.ceil(needBits / 8) <= capacity) return v;
    }
    throw new Error("QR: text too long for version 10 (" + byteLen + " bytes)");
  }

  function buildCodewords(bytes, version) {
    var spec = VERSIONS[version];
    var totalData = spec[0], ecLen = spec[1], groups = spec[2];
    var countBits = version < 10 ? 8 : 16;

    var bits = [];
    var pushBits = function (val, len) {
      for (var i = len - 1; i >= 0; i--) bits.push((val >> i) & 1);
    };

    pushBits(0b0100, 4);                    // byte mode
    pushBits(bytes.length, countBits);
    for (var i = 0; i < bytes.length; i++) pushBits(bytes[i], 8);

    // terminator, then pad to a byte boundary
    var capBits = totalData * 8;
    for (var t = 0; t < 4 && bits.length < capBits; t++) bits.push(0);
    while (bits.length % 8 !== 0) bits.push(0);

    var dataCw = [];
    for (var b = 0; b < bits.length; b += 8) {
      var v = 0;
      for (var k = 0; k < 8; k++) v = (v << 1) | bits[b + k];
      dataCw.push(v);
    }
    // alternating pad bytes
    var pads = [0xec, 0x11], p = 0;
    while (dataCw.length < totalData) dataCw.push(pads[p++ % 2]);

    // split into blocks
    var blocks = [], offset = 0;
    groups.forEach(function (g) {
      for (var n = 0; n < g[0]; n++) {
        blocks.push(dataCw.slice(offset, offset + g[1]));
        offset += g[1];
      }
    });

    var ecBlocks = blocks.map(function (blk) { return rsEncode(blk, ecLen); });

    // interleave data, then interleave EC
    var out = [];
    var maxData = Math.max.apply(null, blocks.map(function (b) { return b.length; }));
    for (var c = 0; c < maxData; c++) {
      for (var bi = 0; bi < blocks.length; bi++) {
        if (c < blocks[bi].length) out.push(blocks[bi][c]);
      }
    }
    for (var e = 0; e < ecLen; e++) {
      for (var bj = 0; bj < ecBlocks.length; bj++) out.push(ecBlocks[bj][e]);
    }
    return out;
  }

  /* ------------------------------------------------------- matrix */

  // 6 version bits + 12 BCH bits (generator 0x1F25), used from version 7 up
  function versionBits(version) {
    var v = version << 12;
    for (var i = 5; i >= 0; i--) {
      if ((v >> (i + 12)) & 1) v ^= 0x1f25 << i;
    }
    return (version << 12) | v;
  }

  function buildMatrix(codewords, version) {
    var size = version * 4 + 17;
    var m = [], reserved = [];
    for (var i = 0; i < size; i++) {
      m.push(new Array(size).fill(null));
      reserved.push(new Array(size).fill(false));
    }

    function setFn(r, c, val) {
      if (r < 0 || c < 0 || r >= size || c >= size) return;
      m[r][c] = val;
      reserved[r][c] = true;
    }

    // finder patterns + separators
    [[0, 0], [0, size - 7], [size - 7, 0]].forEach(function (pos) {
      var r0 = pos[0], c0 = pos[1];
      for (var r = -1; r <= 7; r++) {
        for (var c = -1; c <= 7; c++) {
          var rr = r0 + r, cc = c0 + c;
          if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
          var inRing = (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
                       (c >= 0 && c <= 6 && (r === 0 || r === 6));
          var inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
          setFn(rr, cc, inRing || inCore);
        }
      }
    });

    // timing patterns
    for (var t = 8; t < size - 8; t++) {
      setFn(6, t, t % 2 === 0);
      setFn(t, 6, t % 2 === 0);
    }

    // alignment patterns
    var centres = ALIGN[version];
    for (var a = 0; a < centres.length; a++) {
      for (var b = 0; b < centres.length; b++) {
        var ar = centres[a], ac = centres[b];
        // skip the three that collide with finder patterns
        if ((ar <= 8 && ac <= 8) || (ar <= 8 && ac >= size - 9) || (ar >= size - 9 && ac <= 8)) continue;
        for (var dr = -2; dr <= 2; dr++) {
          for (var dc = -2; dc <= 2; dc++) {
            var ring = Math.max(Math.abs(dr), Math.abs(dc));
            setFn(ar + dr, ac + dc, ring !== 1);
          }
        }
      }
    }

    // dark module
    setFn(size - 8, 8, true);

    // version information (versions 7+): 18 bits, written unmasked into two
    // 6x3 blocks beside the top-right and bottom-left finders
    if (version >= 7) {
      var vbits = versionBits(version);
      for (var vi = 0; vi < 18; vi++) {
        var vb = ((vbits >> vi) & 1) === 1;
        setFn(size - 11 + (vi % 3), Math.floor(vi / 3), vb);
        setFn(Math.floor(vi / 3), size - 11 + (vi % 3), vb);
      }
    }

    // reserve format-info areas (values written after masking)
    for (var f = 0; f <= 8; f++) {
      if (f !== 6) { reserved[8][f] = true; reserved[f][8] = true; }
    }
    for (var g = 0; g < 8; g++) {
      reserved[8][size - 1 - g] = true;
      reserved[size - 1 - g][8] = true;
    }

    // place data in the zig-zag
    var bitIdx = 0;
    var totalBits = codewords.length * 8 + REMAINDER[version];
    var getBit = function (i) {
      if (i >= codewords.length * 8) return 0;             // remainder bits
      return (codewords[i >> 3] >> (7 - (i & 7))) & 1;
    };

    var up = true;
    for (var col = size - 1; col > 0; col -= 2) {
      if (col === 6) col--;                                  // skip the timing column
      for (var n = 0; n < size; n++) {
        var row = up ? size - 1 - n : n;
        for (var s = 0; s < 2; s++) {
          var cc2 = col - s;
          if (reserved[row][cc2]) continue;
          m[row][cc2] = bitIdx < totalBits ? getBit(bitIdx) === 1 : false;
          bitIdx++;
        }
      }
      up = !up;
    }

    return { m: m, reserved: reserved, size: size };
  }

  var MASKS = [
    function (r, c) { return (r + c) % 2 === 0; },
    function (r)    { return r % 2 === 0; },
    function (r, c) { return c % 3 === 0; },
    function (r, c) { return (r + c) % 3 === 0; },
    function (r, c) { return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0; },
    function (r, c) { return (r * c) % 2 + (r * c) % 3 === 0; },
    function (r, c) { return ((r * c) % 2 + (r * c) % 3) % 2 === 0; },
    function (r, c) { return ((r + c) % 2 + (r * c) % 3) % 2 === 0; }
  ];

  function applyMask(base, reserved, size, maskIdx) {
    var out = base.map(function (row) { return row.slice(); });
    for (var r = 0; r < size; r++) {
      for (var c = 0; c < size; c++) {
        if (!reserved[r][c] && MASKS[maskIdx](r, c)) out[r][c] = !out[r][c];
      }
    }
    return out;
  }

  // format info: 5 data bits (EC level + mask) -> BCH(15,5), XOR 0x5412
  function formatBits(maskIdx) {
    var data = (0b00 << 3) | maskIdx;                       // 00 = EC level M
    var v = data << 10;
    for (var i = 4; i >= 0; i--) {
      if ((v >> (i + 10)) & 1) v ^= 0b10100110111 << i;
    }
    return ((data << 10) | v) ^ 0b101010000010010;
  }

  function placeFormat(m, size, maskIdx) {
    var bits = formatBits(maskIdx);
    // bit 14 is the MSB and is written first in both copies
    var bit = function (i) { return ((bits >> (14 - i)) & 1) === 1; };

    var copy1 = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
                 [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]];
    // 7 modules up the right of the bottom-left finder, then 8 along the top-right
    // ((size-8, 8) is the dark module and is not part of the format string)
    var copy2 = [[size - 1, 8], [size - 2, 8], [size - 3, 8], [size - 4, 8],
                 [size - 5, 8], [size - 6, 8], [size - 7, 8],
                 [8, size - 8], [8, size - 7], [8, size - 6], [8, size - 5],
                 [8, size - 4], [8, size - 3], [8, size - 2], [8, size - 1]];

    for (var i = 0; i < 15; i++) {
      m[copy1[i][0]][copy1[i][1]] = bit(i);
      m[copy2[i][0]][copy2[i][1]] = bit(i);
    }
    m[size - 8][8] = true;                                   // dark module
  }

  /* ------------------------------------------------- mask penalty */

  function penalty(m, size) {
    var score = 0, r, c, i;

    // rule 1: runs of 5+ same-colour modules in a row/column
    for (r = 0; r < size; r++) {
      var runH = 1, runV = 1;
      for (c = 1; c < size; c++) {
        runH = m[r][c] === m[r][c - 1] ? runH + 1 : 1;
        if (runH === 5) score += 3; else if (runH > 5) score += 1;
        runV = m[c][r] === m[c - 1][r] ? runV + 1 : 1;
        if (runV === 5) score += 3; else if (runV > 5) score += 1;
      }
    }

    // rule 2: 2x2 blocks of the same colour
    for (r = 0; r < size - 1; r++) {
      for (c = 0; c < size - 1; c++) {
        var v = m[r][c];
        if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) score += 3;
      }
    }

    // rule 3: finder-like 1:1:3:1:1 patterns with 4 light modules either side
    var pat1 = [true, false, true, true, true, false, true, false, false, false, false];
    var pat2 = [false, false, false, false, true, false, true, true, true, false, true];
    var matches = function (get, len) {
      var n = 0;
      for (var s = 0; s + 11 <= len; s++) {
        var ok1 = true, ok2 = true;
        for (var q = 0; q < 11; q++) {
          var val = get(s + q);
          if (val !== pat1[q]) ok1 = false;
          if (val !== pat2[q]) ok2 = false;
        }
        if (ok1) n++;
        if (ok2) n++;
      }
      return n;
    };
    for (i = 0; i < size; i++) {
      (function (idx) {
        score += 40 * matches(function (k) { return m[idx][k]; }, size);
        score += 40 * matches(function (k) { return m[k][idx]; }, size);
      })(i);
    }

    // rule 4: deviation from 50% dark
    var dark = 0;
    for (r = 0; r < size; r++) for (c = 0; c < size; c++) if (m[r][c]) dark++;
    var pct = dark * 100 / (size * size);
    score += Math.floor(Math.abs(pct - 50) / 5) * 10;

    return score;
  }

  /* ---------------------------------------------------------- api */

  function qrMatrix(text) {
    var bytes = toUtf8(text);
    var version = pickVersion(bytes.length);
    var codewords = buildCodewords(bytes, version);
    var built = buildMatrix(codewords, version);

    var best = null, bestScore = Infinity;
    for (var mi = 0; mi < 8; mi++) {
      var cand = applyMask(built.m, built.reserved, built.size, mi);
      placeFormat(cand, built.size, mi);
      var sc = penalty(cand, built.size);
      if (sc < bestScore) { bestScore = sc; best = cand; }
    }
    return best;
  }

  /** Render into an existing <canvas>. `quiet` is the margin in modules. */
  function qrToCanvas(canvas, text, opts) {
    opts = opts || {};
    var quiet = opts.quiet == null ? 3 : opts.quiet;
    var dark = opts.dark || "#000000";
    var light = opts.light || "#ffffff";
    var m = qrMatrix(text);
    var n = m.length;
    var total = n + quiet * 2;
    var px = Math.max(1, Math.floor((opts.size || 512) / total));
    var dim = px * total;

    canvas.width = dim;
    canvas.height = dim;
    var ctx = canvas.getContext("2d");
    ctx.fillStyle = light;
    ctx.fillRect(0, 0, dim, dim);
    ctx.fillStyle = dark;
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        if (m[r][c]) ctx.fillRect((c + quiet) * px, (r + quiet) * px, px, px);
      }
    }
    return canvas;
  }

  global.QR = { matrix: qrMatrix, toCanvas: qrToCanvas };

  if (typeof module !== "undefined" && module.exports) module.exports = global.QR;
})(typeof window !== "undefined" ? window : globalThis);

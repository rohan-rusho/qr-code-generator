"use strict";

/* ==========================================================================
   Minimal QR Code encoder — byte mode, error correction level M,
   versions 1–10, written from scratch (ISO/IEC 18004).
   No dependencies, no network. Exposes: QRCode.encode(text) -> { version, size, modules }
   modules is a 2D array of booleans (true = dark).
   ========================================================================== */

var QRCode = (function () {

  /* ---- tables for error correction level M, versions 1–10 ---- */
  var ECC_PER_BLOCK   = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
  var NUM_BLOCKS      = [-1,  1,  1,  1,  2,  2,  4,  4,  4,  5,  5];
  var TOTAL_CODEWORDS = [-1, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346];
  var REMAINDER_BITS  = [-1, 0, 7, 7, 7, 7, 7, 0, 0, 0, 0];
  var ALIGNMENT_POS   = [
    [],
    [],
    [6, 18],
    [6, 22],
    [6, 26],
    [6, 30],
    [6, 34],
    [6, 22, 38],
    [6, 24, 42],
    [6, 26, 46],
    [6, 28, 50]
  ];

  /* ---- Galois field GF(256), primitive polynomial 0x11D ---- */
  var EXP = new Array(512);
  var LOG = new Array(256);
  (function initGalois() {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11D;
    }
    for (var j = 255; j < 512; j++) EXP[j] = EXP[j - 255];
  })();

  function gfMul(a, b) {
    if (a === 0 || b === 0) return 0;
    return EXP[LOG[a] + LOG[b]];
  }

  function reedSolomonDivisor(degree) {
    // Generator polynomial: product of (x - 2^i) for i in 0..degree-1.
    var result = new Array(degree).fill(0);
    result[degree - 1] = 1;
    var root = 1;
    for (var i = 0; i < degree; i++) {
      for (var j = 0; j < result.length; j++) {
        result[j] = gfMul(result[j], root);
        if (j + 1 < result.length) result[j] ^= result[j + 1];
      }
      root = gfMul(root, 2);
    }
    return result;
  }

  function reedSolomonRemainder(data, divisor) {
    var result = new Array(divisor.length).fill(0);
    for (var i = 0; i < data.length; i++) {
      var factor = data[i] ^ result.shift();
      result.push(0);
      for (var j = 0; j < divisor.length; j++) {
        result[j] ^= gfMul(divisor[j], factor);
      }
    }
    return result;
  }

  /* ---- bit helpers ---- */
  function BitBuffer() {
    this.bits = [];
  }
  BitBuffer.prototype.put = function (value, length) {
    for (var i = length - 1; i >= 0; i--) {
      this.bits.push((value >>> i) & 1);
    }
  };
  BitBuffer.prototype.putBytes = function (bytes) {
    for (var i = 0; i < bytes.length; i++) this.put(bytes[i], 8);
  };
  BitBuffer.prototype.toBytes = function () {
    var bytes = [];
    for (var i = 0; i < this.bits.length; i += 8) {
      var b = 0;
      for (var j = 0; j < 8 && i + j < this.bits.length; j++) {
        b = (b << 1) | this.bits[i + j];
      }
      b <<= (8 - Math.min(8, this.bits.length - i));
      bytes.push(b);
    }
    return bytes;
  };

  function utf8Bytes(text) {
    if (typeof TextEncoder !== "undefined") {
      return Array.prototype.slice.call(new TextEncoder().encode(text));
    }
    // Manual UTF-8 fallback.
    var bytes = [];
    for (var i = 0; i < text.length; i++) {
      var c = text.charCodeAt(i);
      if (c < 0x80) {
        bytes.push(c);
      } else if (c < 0x800) {
        bytes.push(0xC0 | (c >> 6), 0x80 | (c & 0x3F));
      } else if (c >= 0xD800 && c < 0xDC00 && i + 1 < text.length) {
        var c2 = text.charCodeAt(++i);
        var cp = 0x10000 + ((c - 0xD800) << 10) + (c2 - 0xDC00);
        bytes.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3F), 0x80 | ((cp >> 6) & 0x3F), 0x80 | (cp & 0x3F));
      } else {
        bytes.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F));
      }
    }
    return bytes;
  }

  function dataCodewordsForVersion(version) {
    return TOTAL_CODEWORDS[version] - ECC_PER_BLOCK[version] * NUM_BLOCKS[version];
  }

  function pickVersion(dataLen) {
    for (var v = 1; v <= 10; v++) {
      var countBits = v < 10 ? 8 : 16;
      var capacityBits = dataCodewordsForVersion(v) * 8;
      if (4 + countBits + dataLen * 8 <= capacityBits) return v;
    }
    return -1;
  }

  function buildDataCodewords(version, dataBytes) {
    var dataCodewords = dataCodewordsForVersion(version);
    var countBits = version < 10 ? 8 : 16;
    var buf = new BitBuffer();
    buf.put(4, 4); // byte mode
    buf.put(dataBytes.length, countBits);
    buf.putBytes(dataBytes);
    // Terminator (up to 4 zero bits).
    var capacityBits = dataCodewords * 8;
    var terminator = Math.min(4, capacityBits - buf.bits.length);
    for (var i = 0; i < terminator; i++) buf.bits.push(0);
    // Pad to a byte boundary.
    while (buf.bits.length % 8 !== 0) buf.bits.push(0);
    // Pad bytes 0xEC, 0x11 alternating.
    var bytes = buf.toBytes();
    var pad = 0xEC;
    while (bytes.length < dataCodewords) {
      bytes.push(pad);
      pad = pad === 0xEC ? 0x11 : 0xEC;
    }
    return bytes;
  }

  function interleave(version, dataBytes) {
    var numBlocks = NUM_BLOCKS[version];
    var ecLen = ECC_PER_BLOCK[version];
    var totalData = dataBytes.length;
    var shortLen = Math.floor(totalData / numBlocks);
    var numLong = totalData - shortLen * numBlocks; // blocks with one extra data codeword
    var divisor = reedSolomonDivisor(ecLen);

    var blocks = [];
    var offset = 0;
    for (var b = 0; b < numBlocks; b++) {
      var len = shortLen + (b >= numBlocks - numLong ? 1 : 0);
      var block = dataBytes.slice(offset, offset + len);
      offset += len;
      blocks.push({ data: block, ecc: reedSolomonRemainder(block, divisor) });
    }

    var result = [];
    var maxDataLen = shortLen + (numLong > 0 ? 1 : 0);
    for (var i = 0; i < maxDataLen; i++) {
      for (var j = 0; j < blocks.length; j++) {
        if (i < blocks[j].data.length) result.push(blocks[j].data[i]);
      }
    }
    for (var k = 0; k < ecLen; k++) {
      for (var m = 0; m < blocks.length; m++) {
        result.push(blocks[m].ecc[k]);
      }
    }
    return result;
  }

  /* ---- format / version info (BCH) ---- */
  function getFormatBits(mask) {
    var data = mask; // EC level M = 00, so data is just the 3 mask bits
    var rem = data;
    for (var i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >> 9) * 0x537);
    return ((data << 10) | rem) ^ 0x5412;
  }

  function getVersionBits(version) {
    var rem = version;
    for (var i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >> 11) * 0x1F25);
    return (version << 12) | rem;
  }

  function getBit(value, i) {
    return ((value >>> i) & 1) !== 0;
  }

  /* ---- matrix construction ---- */
  function buildMatrix(version, codewords) {
    var size = version * 4 + 17;
    var modules = [];
    var isFunction = [];
    for (var y = 0; y < size; y++) {
      modules.push(new Array(size).fill(false));
      isFunction.push(new Array(size).fill(false));
    }

    function setFunction(x, y, dark) {
      modules[y][x] = dark;
      isFunction[y][x] = true;
    }

    // Timing patterns (drawn first; finders overwrite the overlap).
    for (var i = 0; i < size; i++) {
      setFunction(6, i, i % 2 === 0);
      setFunction(i, 6, i % 2 === 0);
    }

    // Finder patterns + separators.
    var centers = [[3, 3], [size - 4, 3], [3, size - 4]];
    centers.forEach(function (c) {
      for (var dy = -4; dy <= 4; dy++) {
        for (var dx = -4; dx <= 4; dx++) {
          var dist = Math.max(Math.abs(dx), Math.abs(dy));
          var xx = c[0] + dx, yy = c[1] + dy;
          if (xx >= 0 && yy >= 0 && xx < size && yy < size) {
            setFunction(xx, yy, dist !== 2 && dist !== 4);
          }
        }
      }
    });

    // Alignment patterns.
    var pos = ALIGNMENT_POS[version];
    for (var a = 0; a < pos.length; a++) {
      for (var b = 0; b < pos.length; b++) {
        // Skip the three corners that already hold finders.
        if ((a === 0 && b === 0) || (a === 0 && b === pos.length - 1) || (a === pos.length - 1 && b === 0)) continue;
        var cx = pos[a], cy = pos[b];
        for (var dy2 = -2; dy2 <= 2; dy2++) {
          for (var dx2 = -2; dx2 <= 2; dx2++) {
            setFunction(cx + dx2, cy + dy2, Math.max(Math.abs(dx2), Math.abs(dy2)) !== 1);
          }
        }
      }
    }

    // Reserve format info areas (values filled in after masking).
    for (var f = 0; f < 9; f++) {
      if (f !== 6) { setFunction(8, f, false); setFunction(f, 8, false); }
    }
    for (var g = 0; g < 8; g++) {
      setFunction(size - 1 - g, 8, false);
      setFunction(8, size - 1 - g, false);
    }
    setFunction(size - 8, 8, true); // dark module
    // Reserve version info areas.
    if (version >= 7) {
      for (var v = 0; v < 18; v++) {
        var vx = size - 11 + (v % 3);
        var vy = Math.floor(v / 3);
        setFunction(vx, vy, false);
        setFunction(vy, vx, false);
      }
    }

    // Data placement (zigzag, bottom-right, skipping column 6).
    var allBits = [];
    codewords.forEach(function (byte) {
      for (var bit = 7; bit >= 0; bit--) allBits.push((byte >>> bit) & 1);
    });
    for (var r = 0; r < REMAINDER_BITS[version]; r++) allBits.push(0);

    var i = 0;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert++) {
        for (var j = 0; j < 2; j++) {
          var x = right - j;
          var upward = ((right + 1) & 2) === 0;
          var y = upward ? size - 1 - vert : vert;
          if (!isFunction[y][x] && i < allBits.length) {
            modules[y][x] = allBits[i] === 1;
            i++;
          }
        }
      }
    }

    return { modules: modules, isFunction: isFunction, size: size };
  }

  /* ---- masking ---- */
  function maskBit(mask, r, c) {
    switch (mask) {
      case 0: return (r + c) % 2 === 0;
      case 1: return r % 2 === 0;
      case 2: return c % 3 === 0;
      case 3: return (r + c) % 3 === 0;
      case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
      case 5: return (r * c) % 2 + (r * c) % 3 === 0;
      case 6: return ((r * c) % 2 + (r * c) % 3) % 2 === 0;
      case 7: return ((r + c) % 2 + (r * c) % 3) % 2 === 0;
      default: return false;
    }
  }

  function penaltyScore(modules, size) {
    var penalty = 0;
    var dark = 0;

    // Rule 1: runs of 5+ same-colour modules in rows and columns.
    function scoreRuns(get) {
      for (var line = 0; line < size; line++) {
        var runColor = get(line, 0);
        var runLen = 1;
        for (var p = 1; p <= size; p++) {
          var color = p < size ? get(line, p) : !runColor;
          if (color === runColor) {
            runLen++;
          } else {
            if (runLen >= 5) penalty += 3 + (runLen - 5);
            runColor = color;
            runLen = 1;
          }
        }
      }
    }
    scoreRuns(function (line, p) { return modules[line][p]; });
    scoreRuns(function (line, p) { return modules[p][line]; });

    // Rule 2: 2x2 blocks of the same colour.
    for (var y = 0; y < size - 1; y++) {
      for (var x = 0; x < size - 1; x++) {
        var v = modules[y][x];
        if (v === modules[y][x + 1] && v === modules[y + 1][x] && v === modules[y + 1][x + 1]) penalty += 3;
      }
    }

    // Rule 3: finder-like patterns (1011101 with 4 light modules on either side).
    function scoreFinderLike(get) {
      for (var line = 0; line < size; line++) {
        for (var p = 0; p + 11 <= size; p++) {
          var bits = 0;
          for (var k = 0; k < 11; k++) bits = (bits << 1) | (get(line, p + k) ? 1 : 0);
          if (bits === 0x05D || bits === 0x5D0) penalty += 40;
        }
      }
    }
    scoreFinderLike(function (line, p) { return modules[line][p]; });
    scoreFinderLike(function (line, p) { return modules[p][line]; });

    // Rule 4: dark-module balance.
    for (var y2 = 0; y2 < size; y2++) {
      for (var x2 = 0; x2 < size; x2++) if (modules[y2][x2]) dark++;
    }
    var total = size * size;
    var k = Math.floor(Math.abs(dark * 100 / total - 50) / 5);
    penalty += k * 10;

    return penalty;
  }

  function drawFormatBits(matrix, mask) {
    var size = matrix.size;
    var modules = matrix.modules;
    var bits = getFormatBits(mask);
    for (var i = 0; i <= 5; i++) modules[i][8] = getBit(bits, i);
    modules[7][8] = getBit(bits, 6);
    modules[8][8] = getBit(bits, 7);
    modules[8][7] = getBit(bits, 8);
    for (var j = 9; j < 15; j++) modules[8][14 - j] = getBit(bits, j);
    for (var a = 0; a < 8; a++) modules[8][size - 1 - a] = getBit(bits, a);
    for (var b = 8; b < 15; b++) modules[size - 15 + b][8] = getBit(bits, b);
    modules[size - 8][8] = true; // dark module
  }

  function drawVersionBits(matrix, version) {
    if (version < 7) return;
    var size = matrix.size;
    var bits = getVersionBits(version);
    for (var i = 0; i < 18; i++) {
      var bit = getBit(bits, i);
      var a = size - 11 + (i % 3);
      var b = Math.floor(i / 3);
      matrix.modules[b][a] = bit;
      matrix.modules[a][b] = bit;
    }
  }

  /* ---- public API ---- */
  function encode(text) {
    var dataBytes = utf8Bytes(text);
    var version = pickVersion(dataBytes.length);
    if (version < 0) throw new Error("Text too long — max about 213 bytes at error correction level M.");
    var dataCodewords = buildDataCodewords(version, dataBytes);
    var allCodewords = interleave(version, dataCodewords);
    var matrix = buildMatrix(version, allCodewords);

    // Try every mask, keep the lowest penalty.
    var bestMask = 0;
    var bestPenalty = Infinity;
    var bestModules = null;
    for (var mask = 0; mask < 8; mask++) {
      var trial = matrix.modules.map(function (row) { return row.slice(); });
      for (var y = 0; y < matrix.size; y++) {
        for (var x = 0; x < matrix.size; x++) {
          if (!matrix.isFunction[y][x] && maskBit(mask, y, x)) trial[y][x] = !trial[y][x];
        }
      }
      var score = penaltyScore(trial, matrix.size);
      if (score < bestPenalty) {
        bestPenalty = score;
        bestMask = mask;
        bestModules = trial;
      }
    }

    matrix.modules = bestModules;
    drawFormatBits(matrix, bestMask);
    drawVersionBits(matrix, version);

    return { version: version, size: matrix.size, modules: matrix.modules, mask: bestMask };
  }

  return { encode: encode, MAX_BYTES: 213 };
})();

if (typeof module !== "undefined" && module.exports) module.exports = QRCode;

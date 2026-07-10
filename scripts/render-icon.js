'use strict';
// Renders the app mark (dark disc + coral/amber rings) as a large PNG.
// electron-builder needs a >=512px source to produce the macOS .icns, and the
// committed icons only go up to 256px. Drawing code is duplicated from
// main.js (crc32/pngChunk/encodePng and the ring geometry) on purpose: main.js
// requires electron at the top, so it can't be require()d from a plain node
// build script without refactoring the app for the sake of a dev tool.
//
// Usage: node scripts/render-icon.js  -> writes icon-512.png in the repo root.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  const table = crc32.table || (crc32.table = (() => {
    const t = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })());
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(pixels, size) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// Static brand sweeps, eyeballed to match icon.png / icon-256.png.
function drawMark(size) {
  const SS = 4, N = SS * SS;
  const BG = [0x14, 0x18, 0x1f];
  const CORAL = [0xe2, 0x79, 0x5a], AMBER = [0xe8, 0xa8, 0x4a];
  const cx = size / 2, cy = size / 2;
  const rings = [
    { r: size * 0.36, sweep: 0.80 * 360, col: CORAL },   // outer, ~80%
    { r: size * 0.235, sweep: 0.55 * 360, col: AMBER },  // inner, ~55%
  ];
  const strokeW = size * 0.11;

  const inCircleBg = (x, y) => Math.hypot(x - cx, y - cy) <= size * 0.5;
  const inArc = (x, y, r, w, startDeg, sweepDeg) => {
    const dx = x - cx, dy = y - cy, dist = Math.hypot(dx, dy), halfW = w / 2;
    if (Math.abs(dist - r) <= halfW) {
      const ang = ((Math.atan2(dy, dx) * 180 / Math.PI) + 360) % 360;
      const rel = (ang - (((startDeg % 360) + 360) % 360) + 360) % 360;
      if (rel <= sweepDeg) return true;
    }
    for (const deg of [startDeg, startDeg + sweepDeg]) {
      const a = (deg * Math.PI) / 180;
      if (Math.hypot(x - (cx + r * Math.cos(a)), y - (cy + r * Math.sin(a))) <= halfW) return true;
    }
    return false;
  };

  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bg = 0, p0 = 0, p1 = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS, py = y + (sy + 0.5) / SS;
          if (inCircleBg(px, py)) bg++;
          if (inArc(px, py, rings[0].r, strokeW, -90, rings[0].sweep)) p0++;
          if (inArc(px, py, rings[1].r, strokeW, -90, rings[1].sweep)) p1++;
        }
      }
      let rgb = BG.slice();
      const blend = (col, a) => { rgb = [0, 1, 2].map((i) => Math.round(col[i] * a + rgb[i] * (1 - a))); };
      if (p0) blend(rings[0].col, p0 / N);
      if (p1) blend(rings[1].col, p1 / N);
      const idx = (y * size + x) * 4;
      pixels[idx] = rgb[0]; pixels[idx + 1] = rgb[1]; pixels[idx + 2] = rgb[2];
      pixels[idx + 3] = Math.round((bg / N) * 255);
    }
  }
  return encodePng(pixels, size);
}

const out = path.join(__dirname, '..', 'icon-512.png');
fs.writeFileSync(out, drawMark(512));
console.log(`wrote ${out}`);

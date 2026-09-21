// Render CHR (pattern) memory as a 16x32-tile debug image (2 pages side by side),
// plus optional glyph grid. Usage: node chrview.js <chr.bin> <out.png> [paletteIdx]
const fs = require('fs');
const zlib = require('zlib');

function crc32(buf) {
  let c, table = [];
  for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); table[n] = c >>> 0; }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF];
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function writePNG(file, pix, w, h) { // pix: Buffer RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    pix.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]));
}

const chr = fs.readFileSync(process.argv[2]);
const out = process.argv[3];
const cols = 32, rows = 16; // 512 tiles
const scale = 2, grid = 1;
const W = cols * (8 * scale + grid) + grid, H = rows * (8 * scale + grid) + grid;
const pix = Buffer.alloc(W * H * 4, 0x20);
for (let t = 0; t < 512; t++) {
  const tx = t % cols, ty = (t / cols) | 0;
  for (let y = 0; y < 8; y++) {
    const lo = chr[t * 16 + y], hi = chr[t * 16 + y + 8];
    for (let x = 0; x < 8; x++) {
      const v = ((lo >> (7 - x)) & 1) | (((hi >> (7 - x)) & 1) << 1);
      const g = [0x20, 0x66, 0xBB, 0xFF][v];
      for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) {
        const px = grid + tx * (8 * scale + grid) + x * scale + sx;
        const py = grid + ty * (8 * scale + grid) + y * scale + sy;
        const o = (py * W + px) * 4;
        pix[o] = g; pix[o + 1] = g; pix[o + 2] = g; pix[o + 3] = 255;
      }
    }
  }
}
writePNG(out, pix, W, H);
console.log('wrote', out);

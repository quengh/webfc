// Round-2 ground-truth test: synthetic mapper-2 + CHR-RAM scene, compare the
// PPU pipeline output pixel-by-pixel against an independent reference render.
const fs = require('fs');
const zlib = require('zlib');
const NES = require('/tmp/nes-emu/js/nes.js');

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
function writePNG(file, pix /*Buffer RGBA*/, w, h) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    pix.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  fs.writeFileSync(file, png);
}

// ---- synthetic iNES: mapper 2, 1x16KB PRG, 0 CHR (CHR RAM) ----
const rom = new Uint8Array(16 + 0x4000);
rom[0] = 0x4E; rom[1] = 0x45; rom[2] = 0x53; rom[3] = 0x1A;
rom[4] = 1; rom[5] = 0; rom[6] = 0x20; rom[7] = 0; // mapper 2, horizontal mirror
rom[16 + 0x3FFC] = 0x00; rom[16 + 0x3FFD] = 0x80;

const nes = new NES();
nes.loadROM(rom);
const ppu = nes.ppu;

// ---- ground-truth data: pixel value of tile t at (x,y) = (t + x + 2*y) & 3 ----
// fill CHR RAM accordingly (plane0 bit0, plane1 bit1, x=0 at bit7)
function tilePix(t, x, y) { return (t + x + 2 * y) & 3; }
for (let t = 0; t < 256; t++) {
  for (let y = 0; y < 8; y++) {
    let lo = 0, hi = 0;
    for (let x = 0; x < 8; x++) {
      const v = tilePix(t, x, y);
      lo |= (v & 1) << (7 - x);
      hi |= ((v >> 1) & 1) << (7 - x);
    }
    nes.cart.writeCHR(t * 16 + y, lo);
    nes.cart.writeCHR(t * 16 + 8 + y, hi);
  }
}
// nametable: tile index = (ty*32+tx) & 0xFF ; attribute: quadrant value = (qx ^ qy) & 3
const NT0 = 0x2000, AT0 = 0x23C0;
const nt = new Uint8Array(32 * 30), at = new Uint8Array(64);
for (let ty = 0; ty < 30; ty++) for (let tx = 0; tx < 32; tx++) {
  nt[ty * 32 + tx] = (ty * 32 + tx) & 0xFF;
  ppu.vramWrite(NT0 + ty * 32 + tx, nt[ty * 32 + tx]);
}
for (let qy = 0; qy < 8; qy++) for (let qx = 0; qx < 8; qx++) {
  const q00 = ((qx >> 0) ^ (qy >> 0)) & 3; // value for TL quadrant of this attribute cell
  // attribute cell covers 4 quadrants (2x2 of 16x16): give each quadrant a distinct value
  const b = (((qx * 2 + 0) ^ (qy * 2 + 0)) & 3) | ((((qx * 2 + 1) ^ (qy * 2 + 0)) & 3) << 2) |
            ((((qx * 2 + 0) ^ (qy * 2 + 1)) & 3) << 4) | ((((qx * 2 + 1) ^ (qy * 2 + 1)) & 3) << 6);
  at[qy * 8 + qx] = b;
  ppu.vramWrite(AT0 + qy * 8 + qx, b);
}
// palette RAM: unique color per entry (entry i -> color i), backdrop = 0x0F
for (let i = 0; i < 32; i++) ppu.vramWrite(0x3F00 + i, i & 0x3F);
ppu.vramWrite(0x3F00, 0x0F);

// ---- independent reference ----
function attrQuadrant(ax, ay) {
  const b = at[(ay >> 1) * 8 + (ax >> 1)];
  const shift = (((ay & 1) << 1) | (ax & 1)) * 2;
  return (b >> shift) & 3;
}
function refColor(x, y) {
  const tx = (x >> 3) & 31, ty = (y >> 3) % 30;
  const t = nt[ty * 32 + tx];
  const v = tilePix(t, x & 7, y & 7);
  if (v === 0) return 0x0F; // backdrop
  const pal = attrQuadrant(x >> 4, y >> 4);
  return ((pal << 2) | v) & 0x3F;
}

// ---- run one frame ----
ppu.reset();
ppu.ctrl = 0x00;      // BG pattern table $0000, increment 1
ppu.mask = 0x0A;      // show BG + left column
ppu.t = 0; ppu.v = 0; ppu.fineX = 0; ppu.w = 0;
ppu.scanline = 261; ppu.dot = 0;
ppu.frameDone = false;
let guard = 0;
while (!ppu.frameDone && guard++ < 400000) ppu.tick();

// ---- compare: rebuild color index from fb is impossible (rgb mapped), so
// re-run reference into RGB via ppu.rgb and diff RGB ----
const fb = ppu.fb;
let mismatches = [];
for (let y = 0; y < 240; y++) {
  for (let x = 0; x < 256; x++) {
    const want = ppu.rgb[refColor(x, y)];
    if (fb[y * 256 + x] !== want) mismatches.push([x, y]);
  }
}
console.log('mismatched pixels:', mismatches.length, '/ 61440');
if (mismatches.length) {
  // characterize the shift/pairing error: for row 20 find dx such that fb[x]==ref[x+dx]
  const y = 20;
  for (let dx = -8; dx <= 8; dx++) {
    let ok = 0;
    for (let x = 16; x < 240; x++) {
      const rx = x + dx; if (rx < 0 || rx > 255) continue;
      if (fb[y * 256 + x] === ppu.rgb[refColor(rx, y)]) ok++;
    }
    if (ok > 150) console.log('row20: fb[x] == ref[x' + (dx >= 0 ? '+' : '') + dx + '] for', ok, 'of 224');
  }
  // classify: is the pattern pixel right but palette wrong?
  let patOkPalWrong = 0, patWrong = 0;
  for (const [x, y] of mismatches.slice(0, 5000)) {
    const tx = (x >> 3) & 31, ty = (y >> 3) % 30;
    const t = nt[ty * 32 + tx];
    const v = tilePix(t, x & 7, y & 7);
    const wantIdx = v === 0 ? 0x0F : ((attrQuadrant(x >> 4, y >> 4) << 2) | v) & 0x3F;
    // find which palette index would produce the actual color
    const actual = fb[y * 256 + x];
    let found = -1;
    for (let i = 0; i < 64; i++) if (ppu.rgb[i] === actual) { found = i; break; }
    const wantPal = wantIdx >> 2, wantPix = wantIdx & 3;
    if (found >= 0 && (found & 3) === wantPix && wantPix !== 0) patOkPalWrong++;
    else patWrong++;
  }
  console.log('of sampled mismatches: palette-wrong-but-pattern-ok =', patOkPalWrong, ', pattern-wrong =', patWrong);
  console.log('first mismatches:', JSON.stringify(mismatches.slice(0, 12)));
}

// dumps for eyeballing
const exp = Buffer.alloc(256 * 240 * 4);
for (let y = 0; y < 240; y++) for (let x = 0; x < 256; x++) {
  const c = ppu.rgb[refColor(x, y)], o = (y * 256 + x) * 4;
  exp[o] = c & 0xFF; exp[o + 1] = (c >> 8) & 0xFF; exp[o + 2] = (c >> 16) & 0xFF; exp[o + 3] = 0xFF;
}
const got = Buffer.alloc(256 * 240 * 4);
for (let i = 0; i < 256 * 240; i++) {
  const c = fb[i], o = i * 4;
  got[o] = c & 0xFF; got[o + 1] = (c >> 8) & 0xFF; got[o + 2] = (c >> 16) & 0xFF; got[o + 3] = 0xFF;
}
writePNG('/tmp/nes-emu/test/r2-expected.png', exp, 256, 240);
writePNG('/tmp/nes-emu/test/r2-actual.png', got, 256, 240);
console.log('wrote r2-expected.png / r2-actual.png');

// Headless dump harness: run a ROM in Node, dump framebuffer PNG + memory.
// Usage: node dump.js <rom> <frames> <outprefix>
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');
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
function writePNG(file, fb /*Uint32 0xAABBGGRR*/, w, h) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const p = fb[y * w + x];
      const o = y * (w * 4 + 1) + 1 + x * 4;
      raw[o] = p & 0xFF; raw[o + 1] = (p >> 8) & 0xFF; raw[o + 2] = (p >> 16) & 0xFF; raw[o + 3] = 0xFF;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  fs.writeFileSync(file, png);
}

const [romPath, framesStr, prefix] = process.argv.slice(2);
const frames = parseInt(framesStr || '120', 10);
const rom = new Uint8Array(fs.readFileSync(romPath));
const nes = new NES(44100);
const info = nes.loadROM(rom);
console.log('cart info:', JSON.stringify(info));

for (let i = 0; i < frames; i++) nes.runFrame();

writePNG(prefix + '-fb.png', nes.ppu.fb, 256, 240);

// dump CHR (pattern RAM/ROM as PPU sees it)
const chr = nes.cart._chr();
fs.writeFileSync(prefix + '-chr.bin', Buffer.from(chr));
// nametables (mirrored view of 2KB vram)
fs.writeFileSync(prefix + '-vram.bin', Buffer.from(nes.ppu.vram));
fs.writeFileSync(prefix + '-palette.bin', Buffer.from(nes.ppu.palette));
fs.writeFileSync(prefix + '-oam.bin', Buffer.from(nes.ppu.oam));
console.log('frames run:', nes.ppu.frame, 'uxBank:', nes.cart.uxBank, 'chrBank:', nes.cart.chrBank, 'ctrl:', nes.ppu.ctrl.toString(16), 'mask:', nes.ppu.mask.toString(16));
console.log('wrote', prefix + '-fb.png');

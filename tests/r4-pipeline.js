// R4 probe: run real ROMs headlessly (node), dump PNGs at key points.
'use strict';
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
function writePNG(file, pix, w, h) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    pix.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

function dumpFB(nes, outName) {
  const got = Buffer.alloc(256 * 240 * 4);
  let nonBlack = 0;
  for (let i = 0; i < 256 * 240; i++) {
    const c = nes.ppu.fb[i], o = i * 4;
    if ((c & 0xFFFFFF) !== 0) nonBlack++;
    got[o] = c & 0xFF; got[o + 1] = (c >> 8) & 0xFF; got[o + 2] = (c >> 16) & 0xFF; got[o + 3] = 0xFF;
  }
  writePNG(outName, got, 256, 240);
  console.log('dump', outName, 'nonBlack', nonBlack, 'frame', nes.ppu.frame);
}

function press(nes, name, holdFrames, gapFrames) {
  nes.setButton(1, name, true);
  for (let f = 0; f < holdFrames; f++) nes.runFrame();
  nes.setButton(1, name, false);
  for (let f = 0; f < gapFrames; f++) nes.runFrame();
}

function hold(nes, name, frames) {
  nes.setButton(1, name, true);
  for (let f = 0; f < frames; f++) nes.runFrame();
  nes.setButton(1, name, false);
}

const OUT = '/tmp/nes-emu/test/';

// ---- args-driven scenario ----
const [, , romPath, scenario] = process.argv;
const rom = new Uint8Array(fs.readFileSync(romPath));
const nes = new NES(44100);
nes.loadROM(rom);
console.log('loaded', romPath, JSON.stringify(nes.cart.info()));

if (scenario === 'probe') {
  const marks = [60, 120, 180, 240, 300, 420, 600, 900];
  let last = 0;
  const tag = process.argv[4] || 'p';
  for (const m of marks) {
    for (let f = last; f < m; f++) nes.runFrame();
    last = m;
    dumpFB(nes, `${OUT}r4p-${tag}-${String(m).padStart(4, '0')}.png`);
  }
} else if (scenario === 'contra') {
  // boot -> title -> Start -> game
  for (let f = 0; f < 300; f++) nes.runFrame();
  dumpFB(nes, `${OUT}r4p-contra-boot300.png`);
  for (let f = 0; f < 300; f++) nes.runFrame();
  dumpFB(nes, `${OUT}r4-contra-title.png`);       // target: title w/ 2 soldiers
  press(nes, 'START', 8, 120);
  dumpFB(nes, `${OUT}r4p-contra-afterstart.png`);
  // maybe mode select -> confirm with Start/A
  press(nes, 'START', 8, 120);
  dumpFB(nes, `${OUT}r4p-contra-afterstart2.png`);
  hold(nes, 'RIGHT', 240);
  dumpFB(nes, `${OUT}r4-contra-game.png`);        // target: level gameplay
} else if (scenario === 'mario') {
  for (let f = 0; f < 300; f++) nes.runFrame();
  dumpFB(nes, `${OUT}r4-mario-title.png`);
  press(nes, 'START', 8, 30);
  // wait for level start, press start again if needed
  for (let f = 0; f < 60; f++) nes.runFrame();
  dumpFB(nes, `${OUT}r4p-mario-afterstart.png`);
  for (let f = 0; f < 240; f++) nes.runFrame();
  hold(nes, 'RIGHT', 200);
  dumpFB(nes, `${OUT}r4-mario-game.png`);         // target: 1-1
} else {
  console.log('usage: r4-pipeline.js rom scenario [tag]');
}

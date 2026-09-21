// Round-3 ground-truth test: synthetic sprite pipeline scenes, compared
// pixel-by-pixel against an independent reference model (NESdev semantics).
// Scene A: mapper-2 CHR-RAM, 8x8 + 8x16 sprites, flips, banks, priority,
//          8-per-line cap, composed "figure" grids at off-grid origins.
// Scene B: MMC1 CHR-ROM, 4KB windows, 8x16 sprite pairs crossing windows.
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
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  fs.writeFileSync(file, png);
}

// ---------- scene A: mapper 2 + CHR RAM ----------
function sceneA() {
  const rom = new Uint8Array(16 + 0x4000);
  rom[0] = 0x4E; rom[1] = 0x45; rom[2] = 0x53; rom[3] = 0x1A;
  rom[4] = 1; rom[5] = 0; rom[6] = 0x20;
  rom[16 + 0x3FFC] = 0x00; rom[16 + 0x3FFD] = 0x80;
  const nes = new NES();
  nes.loadROM(rom);
  const ppu = nes.ppu;
  const chr = new Uint8Array(0x2000);          // ground-truth pattern memory
  const bgPix = (t, x, y) => (t + x + 2 * y) & 3;
  const spPix = (t, x, y) => (t * 3 + x + y) & 3;

  for (let t = 0; t < 256; t++) {
    for (let y = 0; y < 8; y++) {
      let blo = 0, bhi = 0, slo = 0, shi = 0;
      for (let x = 0; x < 8; x++) {
        const bv = bgPix(t, x, y); blo |= (bv & 1) << (7 - x); bhi |= ((bv >> 1) & 1) << (7 - x);
        const sv = spPix(t, x, y); slo |= (sv & 1) << (7 - x); shi |= ((sv >> 1) & 1) << (7 - x);
      }
      // bg tiles live at $0000+t*16, sprite tiles at $1000+t*16 (different banks!)
      chr[0x0000 + t * 16 + y] = blo; chr[0x0000 + t * 16 + 8 + y] = bhi;
      chr[0x1000 + t * 16 + y] = slo; chr[0x1000 + t * 16 + 8 + y] = shi;
    }
  }
  for (let i = 0; i < 0x2000; i++) nes.cart.writeCHR(i, chr[i]);

  // nametable: tile index = (ty*32+tx)&0xFF ; attribute = quadrant (qx^qy)&3
  const NT0 = 0x2000, AT0 = 0x23C0;
  for (let ty = 0; ty < 30; ty++) for (let tx = 0; tx < 32; tx++)
    ppu.vramWrite(NT0 + ty * 32 + tx, (ty * 32 + tx) & 0xFF);
  for (let qy = 0; qy < 8; qy++) for (let qx = 0; qx < 8; qx++) {
    const b = (((qx * 2) ^ (qy * 2)) & 3) | ((((qx * 2 + 1) ^ (qy * 2)) & 3) << 2) |
              ((((qx * 2) ^ (qy * 2 + 1)) & 3) << 4) | ((((qx * 2 + 1) ^ (qy * 2 + 1)) & 3) << 6);
    ppu.vramWrite(AT0 + qy * 8 + qx, b);
  }
  for (let i = 0; i < 32; i++) ppu.vramWrite(0x3F00 + i, i & 0x3F);
  ppu.vramWrite(0x3F00, 0x0F);

  // ---- OAM: torture ----
  // sprites[y*4+0..3] = Y, tile, attr, X ; index = order
  const oam = new Uint8Array(256).fill(0xF8);
  let n = 0;
  function put(y, tile, attr, x) {
    oam[n * 4] = y; oam[n * 4 + 1] = tile; oam[n * 4 + 2] = attr; oam[n * 4 + 3] = x; n++;
  }
  // (1) composed 3x3 figure of 8x8 sprites at odd origin (25,17), tiles 0x40..0x48
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++)
    put(17 + r * 8, 0x40 + r * 3 + c, 0, 25 + c * 8);
  // (2) same figure hflipped+vflipped mixed at (141,17): row0 hflip, row1 vflip, row2 both
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++)
    put(17 + r * 8, 0x40 + r * 3 + c, (r === 1 ? 0x80 : r === 2 ? 0xC0 : 0x40), 141 + c * 8);
  // (3) 8x16 figure 2x2 pairs at (37,121): tiles 0x50(top-left pair).. crossing banks via LSB
  //     pair tiles: 0x50/0x51 top row (bank0), 0x53/0x52 ... use LSB to force bank 1 on right col
  put(121, 0x50, 0x00, 37);        // pair 0x50/0x51 bank 0
  put(121, 0x53, 0x00, 45);        // pair 0x52/0x53 bank 1 (LSB=1)
  put(137, 0x54, 0x00, 37);        // pair 0x54/0x55 bank 0
  put(137, 0x57, 0x40, 45);        // pair 0x56/0x57 bank 1 + hflip
  // (4) 8x16 vflipped pair at (150,121)
  put(121, 0x58, 0x80, 150);       // pair 0x58/0x59 bank 0, vflip
  // (5) priority: opaque sprite (low index) overlapping bg-opaque area, plus
  //     behind-bg sprite at (200,60) and front sprite over it at (203,63)
  put(60, 0x60, 0x20, 200);        // behind bg (bit5)
  put(63, 0x61, 0x00, 203);        // in front, lower... wait later index -> loses
  // (6) 8-per-line cap: 10 sprites on line y=180..187, x=8*k (only first 8 show)
  for (let k = 0; k < 10; k++) put(180, 0x70 + k, 1, 8 + k * 8);
  // (7) 8x8 in $1000 bank via ctrl bit3 (handled below)

  for (let i = 0; i < 256; i++) ppu.oam[i] = oam[i];

  // ---- PPU regs: 8x8 mode first frame... we test 8x16 in scene A2 ----
  // Use 8x16 mode? Mixed sizes impossible: run TWO frames and combine checks.
  const results = {};
  for (const mode of [0, 1]) { // 0: 8x8 sprites, 1: 8x16 sprites
    ppu.reset();
    ppu.ctrl = (mode ? 0x20 : 0x00) | 0x10; // bg pattern $1000?? no: bg tiles at $0000 -> bit4=0; sprites at $1000 -> bit3=1
    ppu.ctrl = (mode ? 0x20 : 0x00) | 0x08;
    ppu.mask = 0x1E;
    ppu.t = 0; ppu.v = 0; ppu.fineX = 0; ppu.w = 0;
    ppu.scanline = 261; ppu.dot = 0; ppu.frameDone = false;
    let guard = 0;
    while (!ppu.frameDone && guard++ < 400000) ppu.tick();

    // ---- independent reference ----
    const h = mode ? 16 : 8;
    function attrQuadrant(ax, ay) {
      const b = nes.ppu.vram[0x3C0 + (ay >> 1) * 8 + (ax >> 1)];
      const shift = (((ay & 1) << 1) | (ax & 1)) * 2;
      return (b >> shift) & 3;
    }
    function bgAt(x, y) {
      const t = (y >> 3) * 32 + (x >> 3) & 0xFF;
      const v = bgPix(t, x & 7, y & 7);
      return v; // 0 = transparent
    }
    function spFetch(addr) { return chr[addr & 0x1FFF]; }
    function spritePix(si, x, y) {
      const sy = oam[si * 4], tile = oam[si * 4 + 1], attr = oam[si * 4 + 2], sx = oam[si * 4 + 3];
      const row = y - sy - 1;                    // Y is top-minus-1
      if (row < 0 || row >= h) return -1;
      const dx = x - sx;
      if (dx < 0 || dx > 7) return -1;
      let r = (attr & 0x80) ? (h - 1 - row) : row;
      let addr;
      if (h === 16) {
        const bank = (tile & 1) ? 0x1000 : 0x0000;
        let t2 = tile & 0xFE;
        if (r >= 8) { t2++; r -= 8; }
        addr = bank | (t2 << 4) | r;
      } else {
        addr = ((ppu.ctrl & 0x08) ? 0x1000 : 0) | (tile << 4) | r;
      }
      const lo = spFetch(addr), hi = spFetch(addr + 8);
      let b = (attr & 0x40) ? dx : 7 - dx;
      return ((lo >> b) & 1) | (((hi >> b) & 1) << 1);
    }
    function refColor(x, y) {
      const bv = bgAt(x, y);
      const bp = bv ? ((attrQuadrant(x >> 4, y >> 4) << 2) | bv) : 0;
      // sprite: lowest OAM index with non-zero pixel wins (8 in-range/line cap)
      let sp = 0, spPal = 0, spPri = 0;
      let inRange = 0;
      for (let si = 0; si < 64; si++) {
        const row0 = y - oam[si * 4] - 1;
        if (row0 < 0 || row0 >= h) continue;
        if (inRange++ >= 8) break;               // 8 sprites per scanline
        const p = spritePix(si, x, y);
        if (p > 0) {
          sp = p; spPal = ((oam[si * 4 + 2] & 3) + 4) << 2; spPri = (oam[si * 4 + 2] & 0x20) ? 1 : 0;
          break;
        }
      }
      let palAddr;
      if (!bv && !sp) palAddr = 0x3F00;
      else if (!bv && sp) palAddr = 0x3F00 | spPal | sp;
      else if (bv && !sp) palAddr = 0x3F00 | bp;
      else palAddr = spPri ? (0x3F00 | bp) : (0x3F00 | spPal | sp);
      return nes.ppu.palette[(palAddr & 0x1F) - (((palAddr & 0x13) === 0x10) ? 0x10 : 0)] & 0x3F;
    }

    let mismatches = 0; const first = [];
    for (let y = 0; y < 240; y++) for (let x = 0; x < 256; x++) {
      const want = ppu.rgb[refColor(x, y)];
      if (ppu.fb[y * 256 + x] !== want) {
        mismatches++;
        if (first.length < 10) first.push([x, y]);
      }
    }
    results[mode ? '8x16' : '8x8'] = { mismatches, first };
    // dumps
    const got = Buffer.alloc(256 * 240 * 4);
    for (let i = 0; i < 256 * 240; i++) {
      const c = ppu.fb[i], o = i * 4;
      got[o] = c & 0xFF; got[o + 1] = (c >> 8) & 0xFF; got[o + 2] = (c >> 16) & 0xFF; got[o + 3] = 0xFF;
    }
    writePNG('/tmp/nes-emu/test/r3-sceneA-' + (mode ? '8x16' : '8x8') + '-got.png', got, 256, 240);
  }
  return results;
}

// ---------- scene B: MMC1 4KB CHR windows ----------
function sceneB() {
  const hdr = new Uint8Array(16);
  hdr[0] = 0x4E; hdr[1] = 0x45; hdr[2] = 0x53; hdr[3] = 0x1A;
  hdr[4] = 2; hdr[5] = 4; hdr[6] = 0x10; // mapper 1, 32KB CHR ROM
  const prg = new Uint8Array(0x8000);
  const chr = new Uint8Array(0x8000);
  // 8 x 4KB banks; pixel value encodes (bank, t, x, y)
  const bankPix = (bank, t, x, y) => ((bank * 5 + t * 3 + x + y) & 3);
  for (let bank = 0; bank < 8; bank++) {
    for (let t = 0; t < 64; t++) for (let y = 0; y < 8; y++) {
      let lo = 0, hi = 0;
      for (let x = 0; x < 8; x++) {
        const v = bankPix(bank, t, x, y);
        lo |= (v & 1) << (7 - x); hi |= ((v >> 1) & 1) << (7 - x);
      }
      chr[bank * 0x1000 + t * 16 + y] = lo;
      chr[bank * 0x1000 + t * 16 + 8 + y] = hi;
    }
  }
  const rom = new Uint8Array(16 + 0x8000 + 0x8000);
  rom.set(hdr, 0); rom.set(prg, 16); rom.set(chr, 16 + 0x8000);
  const nes = new NES();
  nes.loadROM(rom);
  const ppu = nes.ppu;

  function wr(a, v) { for (let i = 0; i < 5; i++) nes.cart.writePRG(a, (v >> i) & 1); }
  wr(0x8000, 0x1C);      // 4KB CHR mode, PRG mode 3
  wr(0xA000, 2);         // CHR0 = bank 2 at $0000
  wr(0xC000, 5);         // CHR1 = bank 5 at $1000

  for (let ty = 0; ty < 30; ty++) for (let tx = 0; tx < 32; tx++)
    ppu.vramWrite(0x2000 + ty * 32 + tx, (ty + tx) & 0x3F);
  for (let i = 0; i < 32; i++) ppu.vramWrite(0x3F00 + i, i & 0x3F);
  ppu.vramWrite(0x3F00, 0x0F);

  const oam = new Uint8Array(256).fill(0xF8);
  // 8x16 figure: left pair LSB=0 -> chr0 window (bank2), right pair LSB=1 -> chr1 (bank5)
  oam[0] = 60; oam[1] = 0x20; oam[2] = 0; oam[3] = 60;
  oam[4] = 60; oam[5] = 0x21; oam[6] = 0; oam[7] = 68;
  oam[8] = 76; oam[9] = 0x22; oam[10] = 0; oam[11] = 60;
  oam[12] = 76; oam[13] = 0x23; oam[14] = 0x40; oam[15] = 68;
  for (let i = 0; i < 256; i++) ppu.oam[i] = oam[i];

  ppu.reset();
  ppu.ctrl = 0x20 | 0x10;   // 8x16; bg pattern $1000 -> CHR1 window (bank 5)
  ppu.mask = 0x1E;
  ppu.t = 0; ppu.v = 0; ppu.fineX = 0; ppu.w = 0;
  ppu.scanline = 261; ppu.dot = 0; ppu.frameDone = false;
  let guard = 0;
  while (!ppu.frameDone && guard++ < 400000) ppu.tick();

  // reference: window mapping + bankPix
  function chrAt(addr) {
    // addr in 0..0x1FFF -> bank 2 for $0000, bank 5 for $1000
    const bank = addr < 0x1000 ? 2 : 5;
    return { bank, t: (addr & 0xFFF) >> 4, row: addr & 7, plane: (addr & 8) ? 1 : 0 };
  }
  function tilePixel(tile, row, bankSel, x) { // 2bpp pixel via bankPix
    let lo = 0, hi = 0;
    for (let i = 0; i < 8; i++) {
      const v = bankPix(bankSel, tile, i, row);
      lo |= (v & 1) << (7 - i); hi |= ((v >> 1) & 1) << (7 - i);
    }
    return ((lo >> (7 - x)) & 1) | (((hi >> (7 - x)) & 1) << 1);
  }
  function refColor(x, y) {
    // bg (tile indices as actually stored in NT0)
    const t = ppu.vram[(y >> 3) * 32 + (x >> 3)] & 0x3F;
    const bv = tilePixel(t, y & 7, 5, x & 7); // bg window = bank 5
    const bp = bv ? ((0 << 2) | bv) : 0;
    // sprites 8x16
    let sp = 0, spPal = 0;
    for (let si = 0; si < 4; si++) {
      const sy = oam[si * 4], tile = oam[si * 4 + 1], attr = oam[si * 4 + 2], sx = oam[si * 4 + 3];
      const row = y - sy - 1;
      if (row < 0 || row >= 16) continue;
      const dx = x - sx;
      if (dx < 0 || dx > 7) continue;
      let r = (attr & 0x80) ? 15 - row : row;
      let bankSel = (tile & 1) ? 5 : 2;   // LSB picks $0000/chr0 or $1000/chr1 window
      let t2 = tile & 0xFE;
      if (r >= 8) { t2++; r -= 8; }
      const p = tilePixel(t2, r, bankSel, (attr & 0x40) ? (7 - dx) : dx);
      if (p > 0) { sp = p; spPal = ((attr & 3) + 4) << 2; break; }
    }
    let palAddr;
    if (!bv && !sp) palAddr = 0x3F00;
    else if (!bv && sp) palAddr = 0x3F00 | spPal | sp;
    else if (bv && !sp) palAddr = 0x3F00 | bp;
    else palAddr = 0x3F00 | spPal | sp;
    return ppu.palette[(palAddr & 0x1F) - (((palAddr & 0x13) === 0x10) ? 0x10 : 0)] & 0x3F;
  }

  let mismatches = 0; const first = [];
  for (let y = 0; y < 240; y++) for (let x = 0; x < 256; x++) {
    const want = ppu.rgb[refColor(x, y)];
    if (ppu.fb[y * 256 + x] !== want) { mismatches++; if (first.length < 10) first.push([x, y]); }
  }
  return { mismatches, first };
}

const A = sceneA();
console.log('scene A 8x8 :', JSON.stringify(A['8x8']));
console.log('scene A 8x16:', JSON.stringify(A['8x16']));
console.log('scene B MMC1:', JSON.stringify(sceneB()));

/*
 * 2C02 PPU core. Dot-accurate background pipeline (loopy v/t/x/w registers,
 * shift-register fetches), per-scanline sprite evaluation (max 8, sprite
 * overflow approximated), per-pixel composition with sprite 0 hit at the
 * correct dot, NMI at (241,1), status-clear at (261,1), odd-frame dot skip.
 */
(function (global) {
  'use strict';

  var CTRL_NMI = 0x80, CTRL_16 = 0x20, CTRL_BG_PAT = 0x10, CTRL_SP_PAT = 0x08;
  var MASK_GRAY = 0x01, MASK_BG_L = 0x02, MASK_SP_L = 0x04,
      MASK_BG = 0x08, MASK_SP = 0x10;

  function PPU(bus) {
    this.bus = bus; // nes
    this.ctrl = 0; this.mask = 0; this.status = 0;
    this.oamAddr = 0;
    this.v = 0; this.t = 0; this.fineX = 0; this.w = 0;
    this.buffer = 0;

    this.vram = new Uint8Array(0x800);       // 2KB nametable RAM
    this.palette = new Uint8Array(0x20);
    this.oam = new Uint8Array(256);

    this.bgNextNT = 0; this.bgNextAT = 0; this.bgNextLo = 0; this.bgNextHi = 0;
    this.shPatLo = 0; this.shPatHi = 0; this.shAtLo = 0; this.shAtHi = 0;

    this.scanline = 261; this.dot = 0;
    this.frame = 0; this.odd = false;
    this.frameDone = false;

    this.fb = new Uint32Array(256 * 240);
    this.sprites = [];      // sprite slots for current scanline
    this.spriteZeroHere = false;

    this.nmiCallback = null;

    // NTSC palette (2C02 emphasis not modeled; RGB approximation)
    this.rgb = new Uint32Array(64);
    var pal = [
      0x666666,0x002A88,0x1412A7,0x3B00A4,0x5C007E,0x6E0040,0x6C0600,0x561D00,
      0x333500,0x0B4800,0x005200,0x004F08,0x00404D,0x000000,0x000000,0x000000,
      0xADADAD,0x155FD9,0x4240FF,0x7527FE,0xA01ACC,0xB71E7B,0xB53120,0x994E00,
      0x6B6D00,0x388700,0x0C9300,0x008F32,0x007C8D,0x000000,0x000000,0x000000,
      0xFFFEFF,0x64B0FF,0x9290FF,0xC676FF,0xF36AFF,0xFE6ECC,0xFE8170,0xEA9E22,
      0xBCBE00,0x88D800,0x5CE430,0x45E082,0x48CDDE,0x4F4F4F,0x000000,0x000000,
      0xFFFEFF,0xC0DFFF,0xD3D2FF,0xE8C8FF,0xFBC2FF,0xFEC4EA,0xFECCC5,0xF7D8A5,
      0xE4E594,0xCFEF96,0xBDF4AB,0xB3F3CC,0xB5EBF2,0xB8B8B8,0x000000,0x000000
    ];
    for (var i = 0; i < 64; i++) {
      var p = pal[i];
      this.rgb[i] = 0xFF000000 | ((p & 0xFF) << 16) | (p & 0xFF00) | ((p >> 16) & 0xFF);
    }
  }

  PPU.prototype.reset = function () {
    this.ctrl = 0; this.mask = 0; this.status = 0;
    this.oamAddr = 0; this.v = 0; this.t = 0; this.fineX = 0; this.w = 0;
    this.buffer = 0; this.scanline = 261; this.dot = 0; this.odd = false;
  };

  PPU.prototype.renderingEnabled = function () {
    return (this.mask & (MASK_BG | MASK_SP)) !== 0;
  };

  // ---- register interface ----
  PPU.prototype.readReg = function (reg) {
    switch (reg & 7) {
      case 2: {
        var r = (this.status & 0xE0) | (this.buffer & 0x1F);
        this.status &= ~0x80; // clear vblank
        this.w = 0;
        return r;
      }
      case 4: {
        var v = this.oam[this.oamAddr & 0xFF];
        return v;
      }
      case 7: {
        var addr = this.v & 0x3FFF;
        var out;
        if (addr >= 0x3F00) {
          out = this._palRead(addr);
          this.buffer = this.vramRead(addr & 0x2FFF); // nametable under palette
        } else {
          out = this.buffer;
          this.buffer = this.vramRead(addr);
        }
        this.v = (this.v + ((this.ctrl & 0x04) ? 32 : 1)) & 0x7FFF;
        return out;
      }
    }
    return 0;
  };

  PPU.prototype.writeReg = function (reg, val) {
    val &= 0xFF;
    switch (reg & 7) {
      case 0: {
        var prevNMI = (this.ctrl & CTRL_NMI) !== 0;
        this.ctrl = val;
        this.t = (this.t & 0xF3FF) | ((val & 0x03) << 10);
        // enabling NMI while vblank flag is set fires NMI immediately
        if (!prevNMI && (this.ctrl & CTRL_NMI) && (this.status & 0x80) && this.nmiCallback) {
          this.nmiCallback();
        }
        break;
      }
      case 1: this.mask = val; break;
      case 3: this.oamAddr = val; break;
      case 4:
        this.oam[this.oamAddr & 0xFF] = val;
        this.oamAddr = (this.oamAddr + 1) & 0xFF;
        break;
      case 5:
        if (this.w === 0) {
          this.fineX = val & 0x07;
          this.t = (this.t & 0xFFE0) | (val >> 3);
          this.w = 1;
        } else {
          this.t = (this.t & 0x8C1F) | ((val & 0x07) << 12) | ((val & 0xF8) << 2);
          this.w = 0;
        }
        break;
      case 6:
        if (this.w === 0) {
          this.t = (this.t & 0x00FF) | ((val & 0x3F) << 8);
          this.w = 1;
        } else {
          this.t = (this.t & 0xFF00) | val;
          this.v = this.t;
          this.w = 0;
        }
        break;
      case 7:
        this.vramWrite(this.v & 0x3FFF, val);
        this.v = (this.v + ((this.ctrl & 0x04) ? 32 : 1)) & 0x7FFF;
        break;
    }
  };

  // ---- memory mapping ----
  PPU.prototype._mirrorNT = function (addr) {
    addr &= 0x0FFF;
    var table = addr >> 10, off = addr & 0x03FF;
    var mode = this.bus.mirroring; // 0 horizontal, 1 vertical, 2 four, 3/4 single-screen page 0/1
    if (mode === 2) return (table * 0x400 + off) & 0x7FF;
    if (mode === 3) return off;
    if (mode === 4) return 0x400 + off;
    // horizontal: [A,A,B,B] ; vertical: [A,B,A,B]
    var mapH = [0, 0, 1, 1], mapV = [0, 1, 0, 1];
    var bank = (mode === 0 ? mapH : mapV)[table];
    return bank * 0x400 + off;
  };

  PPU.prototype.vramRead = function (addr) {
    addr &= 0x3FFF;
    if (addr >= 0x3F00) return this._palRead(addr);
    if (addr >= 0x2000) return this.vram[this._mirrorNT(addr)];
    return this.bus.cart.readCHR(addr);
  };
  PPU.prototype.vramWrite = function (addr, val) {
    addr &= 0x3FFF;
    if (addr >= 0x3F00) { this._palWrite(addr, val); return; }
    if (addr >= 0x2000) { this.vram[this._mirrorNT(addr)] = val; return; }
    this.bus.cart.writeCHR(addr, val);
  };

  PPU.prototype._palIdx = function (addr) {
    var i = addr & 0x1F;
    if (i >= 0x10 && (i & 0x03) === 0) i -= 0x10;
    return i;
  };
  PPU.prototype._palRead = function (addr) { return this.palette[this._palIdx(addr)] & 0x3F; };
  PPU.prototype._palWrite = function (addr, val) { this.palette[this._palIdx(addr)] = val & 0x3F; };

  // ---- loopy scroll helpers ----
  PPU.prototype._incX = function () {
    if ((this.v & 0x001F) === 31) {
      this.v &= ~0x001F;
      this.v ^= 0x0400;
    } else this.v++;
  };
  PPU.prototype._incY = function () {
    if ((this.v & 0x7000) !== 0x7000) this.v += 0x1000;
    else {
      this.v &= ~0x7000;
      var y = (this.v & 0x03E0) >> 5;
      if (y === 29) { y = 0; this.v ^= 0x0800; }
      else if (y === 31) y = 0;
      else y++;
      this.v = (this.v & ~0x03E0) | (y << 5);
    }
  };
  PPU.prototype._transferX = function () {
    this.v = (this.v & ~0x041F) | (this.t & 0x041F);
  };
  PPU.prototype._transferY = function () {
    this.v = (this.v & ~0x7BE0) | (this.t & 0x7BE0);
  };

  PPU.prototype._loadShifters = function () {
    this.shPatLo = ((this.shPatLo & 0xFF00) | this.bgNextLo) & 0xFFFF;
    this.shPatHi = ((this.shPatHi & 0xFF00) | this.bgNextHi) & 0xFFFF;
    // attribute shifters are 16-bit double-buffered like the pattern shifters:
    // load into the low byte while the current tile's bits live in the high byte
    this.shAtLo = ((this.shAtLo & 0xFF00) | ((this.bgNextAT & 0x01) ? 0xFF : 0x00)) & 0xFFFF;
    this.shAtHi = ((this.shAtHi & 0xFF00) | ((this.bgNextAT & 0x02) ? 0xFF : 0x00)) & 0xFFFF;
  };
  PPU.prototype._updateShifters = function () {
    this.shPatLo = (this.shPatLo << 1) & 0xFFFF;
    this.shPatHi = (this.shPatHi << 1) & 0xFFFF;
    this.shAtLo = (this.shAtLo << 1) & 0xFFFF;
    this.shAtHi = (this.shAtHi << 1) & 0xFFFF;
  };

  PPU.prototype._spriteHeight = function () {
    return (this.ctrl & CTRL_16) ? 16 : 8;
  };

  // sprite evaluation for the next scanline (approximate timing, correct results)
  PPU.prototype._evalSprites = function (line) {
    var h = this._spriteHeight();
    this.sprites = [];
    this.spriteZeroHere = false;
    var n = 0, overflow = false;
    for (var i = 0; i < 64; i++) {
      var y = this.oam[i * 4 + 0];
      // sprite Y is "top minus 1": OAM Y=0 displays on scanlines 1..h
      var row = line - y - 1;
      if (row < 0 || row >= h) continue;
      if (n >= 8) { overflow = true; break; }
      if (i === 0) this.spriteZeroHere = true;
      var tile = this.oam[i * 4 + 1];
      var attr = this.oam[i * 4 + 2];
      var sx = this.oam[i * 4 + 3];
      var r = (attr & 0x80) ? (h - 1 - row) : row;
      var addr;
      if (h === 16) {
        var bank = (tile & 0x01) ? 0x1000 : 0x0000;
        var t2 = tile & 0xFE;
        if (r >= 8) { t2++; r -= 8; }
        addr = bank | (t2 << 4) | r;
      } else {
        // 8x8: pattern table select is PPUCTRL bit 3
        var bank2 = (this.ctrl & CTRL_SP_PAT) ? 0x1000 : 0x0000;
        addr = bank2 | (tile << 4) | r;
      }
      var lo = this.bus.cart.readCHR(addr);
      var hi = this.bus.cart.readCHR(addr + 8);
      if (attr & 0x40) { // horizontal flip
        lo = ((lo & 0x55) << 1) | ((lo & 0xAA) >> 1);
        lo = ((lo & 0x33) << 2) | ((lo & 0xCC) >> 2);
        lo = ((lo & 0x0F) << 4) | ((lo & 0xF0) >> 4);
        hi = ((hi & 0x55) << 1) | ((hi & 0xAA) >> 1);
        hi = ((hi & 0x33) << 2) | ((hi & 0xCC) >> 2);
        hi = ((hi & 0x0F) << 4) | ((hi & 0xF0) >> 4);
      }
      this.sprites.push({ x: sx, lo: lo, hi: hi, attr: attr, zero: i === 0 });
      n++;
    }
    if (overflow) this.status |= 0x20;
  };

  PPU.prototype._renderPixel = function (x, y) {
    var bgPix = 0, bgPal = 0;
    var showBG = (this.mask & MASK_BG) && (x >= 8 || (this.mask & MASK_BG_L));
    if (showBG) {
      var bit = 0x8000 >> this.fineX;
      var p0 = (this.shPatLo & bit) ? 1 : 0;
      var p1 = (this.shPatHi & bit) ? 2 : 0;
      bgPix = p0 | p1;
      var ab = 0x8000 >> this.fineX;
      var a0 = (this.shAtLo & ab) ? 1 : 0;
      var a1 = (this.shAtHi & ab) ? 2 : 0;
      bgPal = a0 | a1;
    }

    var spPix = 0, spPal = 0, spPri = 0, spZero = false;
    var showSP = (this.mask & MASK_SP) && (x >= 8 || (this.mask & MASK_SP_L));
    if (showSP) {
      for (var i = 0; i < this.sprites.length; i++) {
        var s = this.sprites[i];
        var dx = x - s.x;
        if (dx < 0 || dx > 7) continue;
        var b = 7 - dx;
        var q0 = (s.lo >> b) & 1;
        var q1 = (s.hi >> b) & 1;
        var pix = q0 | (q1 << 1);
        if (pix === 0) continue;
        spPix = pix;
        spPal = (s.attr & 0x03) + 4;
        spPri = (s.attr & 0x20) ? 1 : 0;
        spZero = s.zero;
        break;
      }
    }

    // sprite 0 hit
    if (spZero && spPix && bgPix && x !== 255 && showBG && showSP) {
      this.status |= 0x40;
    }

    var palAddr;
    if (bgPix === 0 && spPix === 0) palAddr = 0x3F00;
    else if (bgPix === 0 && spPix) palAddr = 0x3F00 | (spPal << 2) | spPix;
    else if (bgPix && spPix === 0) palAddr = 0x3F00 | (bgPal << 2) | bgPix;
    else palAddr = spPri ? (0x3F00 | (bgPal << 2) | bgPix)
                         : (0x3F00 | (spPal << 2) | spPix);

    var color = this._palRead(palAddr);
    if (this.mask & MASK_GRAY) color &= 0x30;
    this.fb[y * 256 + x] = this.rgb[color & 0x3F];
  };

  PPU.prototype.tick = function () {
    var line = this.scanline, dot = this.dot;
    var visible = line < 240;
    var preRender = line === 261;
    var rendering = this.renderingEnabled();

    if ((visible || preRender) && rendering) {
      // background fetch pipeline (fetch window covers the next-line prefetch
      // through dot 337 so both prefetched tiles survive into the shifters)
      if ((dot >= 1 && dot <= 256) || (dot >= 321 && dot <= 337)) {
        if ((dot >= 2 && dot <= 257) || (dot >= 322 && dot <= 337)) this._updateShifters();
        switch ((dot - 1) & 7) {
          case 0:
            this._loadShifters();
            this.bgNextNT = this.vramRead(0x2000 | (this.v & 0x0FFF));
            break;
          case 2: {
            var a = this.vramRead(0x23C0 | (this.v & 0x0C00) | ((this.v >> 4) & 0x38) | ((this.v >> 2) & 0x07));
            if (this.v & 0x0040) a >>= 4;
            if (this.v & 0x0002) a >>= 2;
            this.bgNextAT = a & 0x03;
            break;
          }
          case 4: {
            var patBase = (this.ctrl & CTRL_BG_PAT) ? 0x1000 : 0x0000;
            var fineY = (this.v >> 12) & 7;
            this.bgNextLo = this.bus.cart.readCHR(patBase | (this.bgNextNT << 4) | fineY);
            break;
          }
          case 6: {
            patBase = (this.ctrl & CTRL_BG_PAT) ? 0x1000 : 0x0000;
            fineY = (this.v >> 12) & 7;
            this.bgNextHi = this.bus.cart.readCHR(patBase | (this.bgNextNT << 4) | fineY | 8);
            break;
          }
          case 7: this._incX(); break;
        }
      }
      if (dot === 256) this._incY();
      if (dot === 257) {
        this._loadShifters();
        this._transferX();
      }
      if (preRender && dot >= 280 && dot <= 304) this._transferY();
      if (dot === 338 || dot === 340) {
        this.bgNextNT = this.vramRead(0x2000 | (this.v & 0x0FFF));
      }
    }

    // sprite evaluation for next scanline
    if (dot === 257 && (visible || preRender)) {
      this._evalSprites(preRender ? 0 : line + 1);
    }
    if (dot === 257 && !rendering) {
      this.sprites = []; this.spriteZeroHere = false;
    }

    if (visible && dot >= 1 && dot <= 256) {
      this._renderPixel(dot - 1, line);
    }

    // vblank / status transitions
    if (line === 241 && dot === 1) {
      this.status |= 0x80;
      this.frameDone = true;
      if ((this.ctrl & CTRL_NMI) && this.nmiCallback) this.nmiCallback();
    }
    if (preRender && dot === 1) {
      this.status &= ~0xE0;
    }

    // advance
    this.dot++;
    if (this.dot > 340) {
      this.dot = 0;
      this.scanline++;
      if (this.scanline > 261) {
        this.scanline = 0;
        this.frame++;
        this.odd = !this.odd;
      }
    }
    // odd frame: skip dot 0 of pre-render when rendering (shortens one frame)
    if (preRender && this.dot === 340 && rendering && this.odd) {
      this.dot = 0;
      this.scanline = 0;
      this.frame++;
      this.odd = !this.odd;
    }
  };

  global.PPU = PPU;
  if (typeof module !== 'undefined' && module.exports) module.exports = PPU;
})(typeof window !== 'undefined' ? window : globalThis);

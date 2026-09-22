/*
 * iNES cartridge parsing + mappers.
 * Supported: Mapper 0 (NROM), 1 (MMC1, basic), 2 (UxROM), 3 (CNROM),
 *            7 (AxROM), 66 (GxROM). All get 8KB PRG-RAM at $6000-$7FFF
 *            (needed by blargg test ROMs which report status at $6000).
 */
(function (global) {
  'use strict';

  function Cart(rom) {
    if (!(rom instanceof Uint8Array)) rom = new Uint8Array(rom);
    if (rom.length < 16 || rom[0] !== 0x4E || rom[1] !== 0x45 || rom[2] !== 0x53 || rom[3] !== 0x1A) {
      throw new Error('Not an iNES ROM (missing NES<EOF> header)');
    }
    this.prgBanks = rom[4];       // 16KB units
    this.chrBanks = rom[5];       // 8KB units
    var f6 = rom[6], f7 = rom[7];
    this.mapper = (f6 >> 4) | (f7 & 0xF0);
    this.mirroring = (f6 & 0x01) ? 1 : 0;   // 1 = vertical, 0 = horizontal
    this.battery = (f6 & 0x02) !== 0;
    this.trainer = (f6 & 0x04) !== 0;
    this.fourScreen = (f6 & 0x08) !== 0;
    if (this.fourScreen) this.mirroring = 2;
    var nes2 = (f7 & 0x0C) === 0x08;

    var off = 16 + (this.trainer ? 512 : 0);
    var prgSize = this.prgBanks * 0x4000;
    var chrSize = this.chrBanks * 0x2000;
    this.prgROM = rom.subarray(off, off + prgSize);
    if (this.prgROM.length !== prgSize) throw new Error('ROM truncated (PRG)');
    var chrStart = off + prgSize;
    this.chrROM = chrSize ? rom.subarray(chrStart, chrStart + chrSize) : null;
    if (chrSize && (!this.chrROM || this.chrROM.length !== chrSize)) throw new Error('ROM truncated (CHR)');
    this.chrRAM = chrSize ? null : new Uint8Array(0x2000);   // CHR-RAM when no CHR-ROM
    this.prgRAM = new Uint8Array(0x2000);
    this.nes2 = nes2;

    this.prgBankOffset = [0, 0];  // mapper-specific
    this.chrBank = 0;
    // MMC1 state
    this.mmc1Shift = 0x10; this.mmc1Count = 0;
    this.mmc1Ctrl = 0x0C; this.mmc1Chr0 = 0; this.mmc1Chr1 = 0; this.mmc1Prg = 0;
    // UxROM bank
    this.uxBank = 0;
    // MMC3 state
    this.mmc3Sel = 0;        // $8000 bank select: bits 0-2 target, bit 6 PRG mode, bit 7 CHR A12 inversion
    this.mmc3Regs = [0, 0, 0, 0, 0, 0, 0, 0]; // R0-R5 CHR banks, R6/R7 PRG 8KB banks
    this.mmc3IRQLatch = 0;
    this.mmc3IRQCounter = 0;
    this.mmc3IRQReload = false;
    this.mmc3IRQEnable = false;
    this.irqPending = false; // level-triggered CPU IRQ line state
  }

  Cart.prototype.reset = function () {
    this.prgRAM.fill(0);
    if (this.chrRAM) this.chrRAM.fill(0);
  };

  Cart.prototype._chr = function () { return this.chrRAM ? this.chrRAM : this.chrROM; };

  Cart.prototype._chrOffset = function (addr) {
    // addr: 0..0x1FFF pattern address -> byte offset into CHR ROM/RAM
    var chr = this._chr();
    var total = chr.length;
    var off;
    if (this.mapper === 1) {
      // MMC1: two independently-banked 4KB windows ($0000=CHR0, $1000=CHR1),
      // or one 8KB window (CHR0 with bit 0 ignored) when ctrl bit 4 = 0
      var b;
      if ((this.mmc1Ctrl >> 4) & 1) {
        // 4KB mode: each window banked independently
        b = (addr < 0x1000) ? this.mmc1Chr0 : this.mmc1Chr1;
        off = b * 0x1000 + (addr & 0x0FFF);
      } else {
        // 8KB mode: one 8KB window, bank = CHR0 with bit 0 ignored
        b = this.mmc1Chr0 & 0xFE;
        off = b * 0x1000 + addr;
      }
    } else if (this.mapper === 4) {
      // MMC3 CHR: two 2KB windows (R0/R1) + four 1KB windows (R2-R5);
      // the 2KB pair lives at $0000, or at $1000 when A12 is inverted
      var r = this.mmc3Regs, a = addr & 0x1FFF;
      var inv = (this.mmc3Sel >> 7) & 1;
      if ((a < 0x1000) !== !!inv) {
        off = (r[(a >> 11) & 1] & 0xFE) * 0x400 + (a & 0x7FF);   // 2KB window
      } else {
        off = r[2 + ((a >> 10) & 3)] * 0x400 + (a & 0x3FF);       // 1KB windows
      }
    } else {
      var banks = total >> 13;              // 8KB banks (CNROM/GxROM/...)
      if (banks <= 1) return addr & (total - 1);
      off = (this.chrBank % banks) * 0x2000 + addr;
    }
    return total ? (off % total) : 0;
  };

  Cart.prototype.readCHR = function (addr) {
    addr &= 0x1FFF;
    return this._chr()[this._chrOffset(addr)];
  };
  Cart.prototype.writeCHR = function (addr, val) {
    if (!this.chrRAM) return;
    addr &= 0x1FFF;
    this.chrRAM[this._chrOffset(addr)] = val;
  };

  Cart.prototype._prgReadBase = function (offset) {
    return this.prgROM[offset % this.prgROM.length];
  };

  Cart.prototype.readPRG = function (addr) {
    if (addr >= 0x6000 && addr < 0x8000) return this.prgRAM[addr - 0x6000];
    if (addr < 0x8000) return 0;
    var prgLen = this.prgROM.length;
    switch (this.mapper) {
      case 0:
      case 3:
        return this._prgReadBase(addr - 0x8000);
      case 1: {
        // MMC1: 16KB or 32KB modes
        var mode = (this.mmc1Ctrl >> 2) & 3;
        var bank16 = this.mmc1Prg & 0x0F;
        if (mode === 0 || mode === 1) { // 32KB
          var b32 = (bank16 >> 1) & 7;
          return this._prgReadBase(b32 * 0x8000 + (addr - 0x8000));
        } else if (mode === 2) { // fix first bank at $8000
          if (addr < 0xC000) return this._prgReadBase(addr - 0x8000);
          return this._prgReadBase(bank16 * 0x4000 + (addr - 0xC000));
        } else { // fix last bank at $C000
          if (addr < 0xC000) return this._prgReadBase(bank16 * 0x4000 + (addr - 0x8000));
          return this._prgReadBase(prgLen - 0x4000 + (addr - 0xC000));
        }
      }
      case 2:
        if (addr < 0xC000) {
          var nb = this.prgROM.length / 0x4000;
          return this._prgReadBase((this.uxBank % nb) * 0x4000 + (addr - 0x8000));
        }
        return this._prgReadBase(prgLen - 0x4000 + (addr - 0xC000));
      case 4: {
        // MMC3: four 8KB windows at $8000/$A000/$C000/$E000.
        // Mode 0: R6, R7, second-to-last, last. Mode 1 swaps the first and third.
        var nb = prgLen >> 13;
        var slot = (addr - 0x8000) >> 13;
        var r6 = this.mmc3Regs[6] & 0x3F, r7 = this.mmc3Regs[7] & 0x3F;
        var secondLast = nb - 2, last = nb - 1;
        var b;
        if (this.mmc3Sel & 0x40) {
          b = slot === 0 ? secondLast : slot === 1 ? r7 : slot === 2 ? r6 : last;
        } else {
          b = slot === 0 ? r6 : slot === 1 ? r7 : slot === 2 ? secondLast : last;
        }
        return this._prgReadBase((b % nb) * 0x2000 + (addr & 0x1FFF));
      }
      case 7:
        return this._prgReadBase((addr - 0x8000) & 0x7FFF);
      case 66:
        return this._prgReadBase((this.prgBank & 3) * 0x8000 + (addr - 0x8000));
      default:
        return this._prgReadBase(addr - 0x8000);
    }
  };

  Cart.prototype.writePRG = function (addr, val) {
    if (addr >= 0x6000 && addr < 0x8000) { this.prgRAM[addr - 0x6000] = val; return; }
    if (addr < 0x8000) return;
    switch (this.mapper) {
      case 0:
      case 3:
        if (this.mapper === 3) this.chrBank = val & 3;
        break;
      case 1: {
        if (val & 0x80) {
          this.mmc1Ctrl |= 0x0C;
          this.mmc1Shift = 0x10; this.mmc1Count = 0;
          break;
        }
        this.mmc1Shift = ((val & 1) << 4) | (this.mmc1Shift >> 1);
        this.mmc1Count++;
        if (this.mmc1Count === 5) {
          var reg = (addr >> 13) & 3; // $8000-9FFF ctrl, $A000-BFFF chr0, ...
          if (reg === 0) {
            this.mmc1Ctrl = this.mmc1Shift & 0x1F;
            switch (this.mmc1Ctrl & 3) {
              case 0: this.mirroring = 3; break; // single-screen page 0
              case 1: this.mirroring = 4; break; // single-screen page 1
              case 2: this.mirroring = 1; break; // vertical
              case 3: this.mirroring = 0; break; // horizontal
            }
          } else if (reg === 1) this.mmc1Chr0 = this.mmc1Shift & 0x1F;
          else if (reg === 2) this.mmc1Chr1 = this.mmc1Shift & 0x1F;
          else this.mmc1Prg = this.mmc1Shift & 0x0F;
          this.mmc1Count = 0; this.mmc1Shift = 0x10;
        }
        break;
      }
      case 2:
        this.uxBank = val & 0x0F;
        break;
      case 4:
        // MMC3 registers are selected by address block + even/odd
        switch (addr & 0xE001) {
          case 0x8000: this.mmc3Sel = val; break;
          case 0x8001: this.mmc3Regs[this.mmc3Sel & 7] = val; break;
          case 0xA000:
            // bit 0: 0 = vertical, 1 = horizontal (ignored on four-screen boards)
            if (!this.fourScreen) this.mirroring = (val & 1) ? 0 : 1;
            break;
          case 0xA001: break; // PRG-RAM protect: RAM kept always writable
          case 0xC000: this.mmc3IRQLatch = val; break;
          case 0xC001: this.mmc3IRQCounter = 0; this.mmc3IRQReload = true; break;
          case 0xE000: this.irqPending = false; this.mmc3IRQEnable = false; break;
          case 0xE001: this.mmc3IRQEnable = true; break;
        }
        break;
      case 7:
        this.prgBank = (val >> 4) & 7;
        this.mirroring = (val & 0x10) ? 2 : 2; // AxROM single-screen; treat as 2 banks-independent
        this.mirroring = 0; // single screen: use horizontal map as approximation of single
        break;
      case 66:
        this.prgBank = (val >> 4) & 3;
        this.chrBank = val & 3;
        break;
    }
  };

  // MMC3 scanline IRQ counter. Real hardware clocks it on filtered PPU A12
  // rising edges (~once per rendered scanline); we clock it once per scanline
  // from the PPU, which is accurate enough for status-bar split games.
  Cart.prototype.clockScanline = function () {
    if (this.mapper !== 4) return;
    if (this.mmc3IRQReload || this.mmc3IRQCounter === 0) {
      this.mmc3IRQCounter = this.mmc3IRQLatch;
    } else {
      this.mmc3IRQCounter--;
    }
    this.mmc3IRQReload = false;
    if (this.mmc3IRQCounter === 0 && this.mmc3IRQEnable) this.irqPending = true;
  };

  Cart.prototype.info = function () {
    return {
      mapper: this.mapper,
      prgKB: this.prgROM.length >> 10,
      chrKB: (this.chrROM ? this.chrROM.length : this.chrRAM.length) >> 10,
      chrRAM: !!this.chrRAM,
      mirroring: this.mirroring,
      nes2: this.nes2
    };
  };

  global.Cart = Cart;
  if (typeof module !== 'undefined' && module.exports) module.exports = Cart;
})(typeof window !== 'undefined' ? window : globalThis);

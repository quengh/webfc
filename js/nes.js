/*
 * FC/NES machine: CPU/PPU/APU/bus/controllers glue, frame stepping,
 * save states (JSON-serializable), controller input.
 */
(function (global) {
  'use strict';

  var CPU6502 = (typeof require === 'function') ? require('./cpu.js') : global.CPU6502;
  var PPU = (typeof require === 'function') ? require('./ppu.js') : global.PPU;
  var APU = (typeof require === 'function') ? require('./apu.js') : global.APU;
  var Cart = (typeof require === 'function') ? require('./cart.js') : global.Cart;

  // button bit order for $4016 serial reads
  var BTN = { A: 0, B: 1, SELECT: 2, START: 3, UP: 4, DOWN: 5, LEFT: 6, RIGHT: 7 };

  function Joypad() {
    this.buttons = new Uint8Array(8);
    this.strobe = 0;
    this.shift = 0;
    this.idx = 0;
  }
  Joypad.prototype.write = function (v) {
    this.strobe = v & 1;
    if (this.strobe) this._latch();
  };
  Joypad.prototype._latch = function () {
    this.shift = 0;
    for (var i = 0; i < 8; i++) this.shift |= (this.buttons[i] ? 1 : 0) << i;
    this.idx = 0;
  };
  Joypad.prototype.read = function () {
    if (this.strobe) this._latch();
    var bit = (this.shift >> this.idx) & 1;
    if (this.idx < 8) this.idx++;
    return bit | 0x40; // open-bus upper bits approx
  };
  Joypad.prototype.set = function (name, pressed) {
    if (BTN[name] !== undefined) this.buttons[BTN[name]] = pressed ? 1 : 0;
  };

  function NES(sampleRate) {
    var self = this;
    this.ram = new Uint8Array(0x800);
    this.mirroring = 0;
    this.cart = null;
    this.pendingStall = 0;
    this.frameCounter = 0;

    var bus = {
      read: function (a) { return self.read(a); },
      write: function (a, v) { self.write(a, v); }
    };
    this.cpu = new CPU6502(bus);
    this.ppu = new PPU(this);
    this.apu = new APU(this, sampleRate || 44100);
    this.ppu.nmiCallback = function () { self.cpu.triggerNMI(); };
    this.ppu.onScanline = function () {
      if (self.cart && self.cart.clockScanline) self.cart.clockScanline();
    };

    this.pad1 = new Joypad();
    this.pad2 = new Joypad();

    this.audioEnabled = true;
  }

  NES.BTN = BTN;

  NES.prototype.loadROM = function (rom) {
    this.cart = new Cart(rom instanceof Uint8Array ? rom : new Uint8Array(rom));
    this.mirroring = this.cart.mirroring;
    this.ram.fill(0);
    this.ppu.reset();
    this.apu.reset();
    this.cpu.reset();
    // many ROMs assume a little settling time before first NMI use
    this.frameCounter = 0;
    return this.cart.info();
  };

  NES.prototype.mirror = function () {
    if (this.cart) this.mirroring = this.cart.mirroring;
  };

  NES.prototype.read = function (addr) {
    addr &= 0xFFFF;
    if (addr < 0x2000) return this.ram[addr & 0x07FF];
    if (addr < 0x4000) { this.mirror(); return this.ppu.readReg(addr & 7); }
    if (addr === 0x4015) return this.apu.read4015();
    if (addr === 0x4016) return this.pad1.read();
    if (addr === 0x4017) return this.pad2.read();
    if (addr >= 0x4020 && this.cart) return this.cart.readPRG(addr);
    return 0;
  };

  NES.prototype.write = function (addr, val) {
    addr &= 0xFFFF; val &= 0xFF;
    if (addr < 0x2000) { this.ram[addr & 0x07FF] = val; return; }
    if (addr < 0x4000) { this.mirror(); this.ppu.writeReg(addr & 7, val); return; }
    if (addr === 0x4014) {
      // OAM DMA: 256 bytes from page val to OAM, ~513 CPU cycles stall
      var base = val << 8;
      for (var i = 0; i < 256; i++) {
        this.ppu.oam[(this.ppu.oamAddr + i) & 0xFF] = this.read((base + i) & 0xFFFF);
      }
      this.pendingStall += 513 + (this.cpu.totalCycles & 1);
      return;
    }
    if (addr === 0x4016) { this.pad1.write(val); this.pad2.write(val); return; }
    if (addr < 0x4018) { this.apu.write(addr, val); return; }
    if (this.cart) this.cart.writePRG(addr, val);
  };

  // run one CPU instruction + corresponding PPU/APU cycles
  NES.prototype.stepInstruction = function () {
    var c = this.cpu.step();
    if (this.pendingStall) { c += this.pendingStall; this.pendingStall = 0; }
    for (var i = 0; i < c; i++) {
      this.ppu.tick(); this.ppu.tick(); this.ppu.tick();
      this.apu.tick();
    }
    // IRQ is level-triggered: asserted until the source acknowledges
    // ($4015 read / $4017 write for the APU frame IRQ, $E000 write for MMC3)
    this.cpu.setIRQ(this.apu.frameIRQ || (this.cart && this.cart.irqPending));
    return c;
  };

  NES.prototype.runCycles = function (n) {
    var done = 0;
    while (done < n) done += this.stepInstruction();
    return done;
  };

  NES.prototype.runFrame = function () {
    this.ppu.frameDone = false;
    var guard = 0;
    while (!this.ppu.frameDone && guard++ < 100000) {
      this.stepInstruction();
    }
    this.frameCounter++;
  };

  NES.prototype.setButton = function (pad, name, pressed) {
    var p = pad === 2 ? this.pad2 : this.pad1;
    p.set(name, pressed);
  };

  // ---- save states ----
  var SKIP = { bus: 1, nes: 1, prgROM: 1, chrROM: 1, rgb: 1, samples: 1, fb: 1 };

  function snapVal(v) {
    if (v === null || typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') return v;
    if (ArrayBuffer.isView(v)) {
      var a = new Array(v.length);
      for (var i = 0; i < v.length; i++) a[i] = v[i];
      return { __t: 'ta', v: a };
    }
    if (Array.isArray(v)) return v.map(snapVal);
    if (typeof v === 'object') {
      var o = {};
      for (var k in v) {
        if (SKIP[k]) continue;
        if (typeof v[k] === 'function') continue;
        o[k] = snapVal(v[k]);
      }
      return o;
    }
    return null;
  }

  function unsnapVal(target, sv) {
    if (sv === null || typeof sv !== 'object') return sv;
    if (sv.__t === 'ta') {
      var C = (target instanceof Uint32Array) ? Uint32Array : (target instanceof Int32Array) ? Int32Array : Uint8Array;
      return C.from(sv.v);
    }
    if (Array.isArray(sv)) return sv.map(function (x, i) { return unsnapVal(target ? target[i] : null, x); });
    var o = (target && typeof target === 'object' && !ArrayBuffer.isView(target)) ? target : {};
    for (var k in sv) {
      if (SKIP[k]) continue;
      o[k] = unsnapVal(o[k], sv[k]);
    }
    return o;
  }

  NES.prototype.saveState = function () {
    return snapVal({
      cpu: this.cpu, ppu: this.ppu, apu: this.apu,
      ram: this.ram, pad1: this.pad1, pad2: this.pad2,
      mirroring: this.mirroring,
      cart: {
        prgRAM: this.cart.prgRAM,
        chrRAM: this.cart.chrRAM,
        chrBank: this.cart.chrBank, uxBank: this.cart.uxBank,
        mmc1Shift: this.cart.mmc1Shift, mmc1Count: this.cart.mmc1Count,
        mmc1Ctrl: this.cart.mmc1Ctrl, mmc1Chr0: this.cart.mmc1Chr0,
        mmc1Chr1: this.cart.mmc1Chr1, mmc1Prg: this.cart.mmc1Prg,
        prgBank: this.cart.prgBank || 0,
        mmc3Sel: this.cart.mmc3Sel, mmc3Regs: this.cart.mmc3Regs.slice(),
        mmc3IRQLatch: this.cart.mmc3IRQLatch,
        mmc3IRQCounter: this.cart.mmc3IRQCounter,
        mmc3IRQReload: this.cart.mmc3IRQReload,
        mmc3IRQEnable: this.cart.mmc3IRQEnable,
        irqPending: this.cart.irqPending,
        mirroring: this.cart.mirroring
      }
    });
  };

  NES.prototype.loadState = function (state) {
    if (typeof state === 'string') state = JSON.parse(state);
    var cpu = unsnapVal(this.cpu, state.cpu);
    this.cpu.A = cpu.A; this.cpu.X = cpu.X; this.cpu.Y = cpu.Y;
    this.cpu.S = cpu.S; this.cpu.PC = cpu.PC; this.cpu.P = cpu.P;
    this.cpu.totalCycles = cpu.totalCycles; this.cpu.penalty = 0;
    this.cpu.nmiPending = !!cpu.nmiPending; this.cpu.irqLine = !!cpu.irqLine;

    var p = state.ppu;
    this.ppu.ctrl = p.ctrl; this.ppu.mask = p.mask; this.ppu.status = p.status;
    this.ppu.oamAddr = p.oamAddr; this.ppu.v = p.v; this.ppu.t = p.t;
    this.ppu.fineX = p.fineX; this.ppu.w = p.w; this.ppu.buffer = p.buffer;
    this.ppu.vram.set(unsnapVal(this.ppu.vram, p.vram));
    this.ppu.palette.set(unsnapVal(this.ppu.palette, p.palette));
    this.ppu.oam.set(unsnapVal(this.ppu.oam, p.oam));
    this.ppu.scanline = p.scanline; this.ppu.dot = p.dot; this.ppu.frame = p.frame;
    this.ppu.odd = !!p.odd;
    this.ppu.bgNextNT = p.bgNextNT; this.ppu.bgNextAT = p.bgNextAT;
    this.ppu.bgNextLo = p.bgNextLo; this.ppu.bgNextHi = p.bgNextHi;
    this.ppu.shPatLo = p.shPatLo; this.ppu.shPatHi = p.shPatHi;
    this.ppu.shAtLo = p.shAtLo; this.ppu.shAtHi = p.shAtHi;
    if (p.fb) this.ppu.fb.set(unsnapVal(this.ppu.fb, p.fb));

    var a = state.apu;
    var mapCh = function (dst, src) {
      for (var k in src) {
        if (k === '__t') continue;
        if (typeof src[k] !== 'object') dst[k] = src[k];
      }
    };
    mapCh(this.apu.pulse1, a.pulse1); mapCh(this.apu.pulse2, a.pulse2);
    mapCh(this.apu.tri, a.tri); mapCh(this.apu.noise, a.noise);
    this.apu.frameMode5 = !!a.frameMode5; this.apu.irqInhibit = !!a.irqInhibit;
    this.apu.frameIRQ = !!a.frameIRQ; this.apu.frameCycle = a.frameCycle;
    this.apu.cycle = a.cycle; this.apu.step = a.step;

    this.ram.set(unsnapVal(this.ram, state.ram));
    this.pad1.buttons.set(unsnapVal(this.pad1.buttons, state.pad1.buttons));
    this.pad2.buttons.set(unsnapVal(this.pad2.buttons, state.pad2.buttons));
    this.pad1.strobe = state.pad1.strobe; this.pad2.strobe = state.pad2.strobe;
    this.mirroring = state.mirroring;
    if (this.cart) {
      var c = state.cart;
      this.cart.prgRAM.set(unsnapVal(this.cart.prgRAM, c.prgRAM));
      if (this.cart.chrRAM && c.chrRAM) this.cart.chrRAM.set(unsnapVal(this.cart.chrRAM, c.chrRAM));
      this.cart.chrBank = c.chrBank; this.cart.uxBank = c.uxBank;
      this.cart.mmc1Shift = c.mmc1Shift; this.cart.mmc1Count = c.mmc1Count;
      this.cart.mmc1Ctrl = c.mmc1Ctrl; this.cart.mmc1Chr0 = c.mmc1Chr0;
      this.cart.mmc1Chr1 = c.mmc1Chr1; this.cart.mmc1Prg = c.mmc1Prg;
      this.cart.prgBank = c.prgBank;
      this.cart.mmc3Sel = c.mmc3Sel || 0;
      if (c.mmc3Regs) this.cart.mmc3Regs = c.mmc3Regs.slice();
      this.cart.mmc3IRQLatch = c.mmc3IRQLatch || 0;
      this.cart.mmc3IRQCounter = c.mmc3IRQCounter || 0;
      this.cart.mmc3IRQReload = !!c.mmc3IRQReload;
      this.cart.mmc3IRQEnable = !!c.mmc3IRQEnable;
      this.cart.irqPending = !!c.irqPending;
      this.cart.mirroring = c.mirroring;
    }
  };

  NES.prototype.serialize = function () { return JSON.stringify(this.saveState()); };

  global.NES = NES;
  if (typeof module !== 'undefined' && module.exports) module.exports = NES;
})(typeof window !== 'undefined' ? window : globalThis);

/*
 * 6502 (Ricoh 2A03) CPU core for web FC/NES emulator.
 * Official opcodes fully implemented, common unofficial opcodes implemented
 * (LAX/SAX/DCP/ISC/SLO/RLA/SRE/RRA/ANC/ALR/ARR/AXS/LAS/XAA/AHX/SHX/SHY/TAS/NOPs),
 * remaining unofficial opcodes behave as stable 2-cycle NOPs (JAM treated as NOP).
 * Cycle counts are accurate, including page-cross penalties and branch timing.
 *
 * Decimal mode flag exists but ADC/SBC ignore it (2A03 has no BCD) - correct for NES.
 */
(function (global) {
  'use strict';

  var FLAG_C = 0x01, FLAG_Z = 0x02, FLAG_I = 0x04, FLAG_D = 0x08,
      FLAG_B = 0x10, FLAG_U = 0x20, FLAG_V = 0x40, FLAG_N = 0x80;

  var IMP = 0, ACC = 1, IMM = 2, ZP = 3, ZPX = 4, ZPY = 5,
      ABS = 6, ABX = 7, ABY = 8, IND = 9, IZX = 10, IZY = 11, REL = 12;

  var OPS = new Array(256);
  (function () {
    for (var i = 0; i < 256; i++) OPS[i] = ['JAM', IMP, 2, 0];
    function d(op, name, mode, cyc, pen) { OPS[op] = [name, mode, cyc, pen || 0]; }
    d(0x00,'BRK',IMP,7); d(0x01,'ORA',IZX,6); d(0x03,'SLO',IZX,8);
    d(0x04,'NOP',ZP,3); d(0x05,'ORA',ZP,3); d(0x06,'ASL',ZP,5); d(0x07,'SLO',ZP,5);
    d(0x08,'PHP',IMP,3); d(0x09,'ORA',IMM,2); d(0x0A,'ASL',ACC,2); d(0x0B,'ANC',IMM,2);
    d(0x0C,'NOP',ABS,4); d(0x0D,'ORA',ABS,4); d(0x0E,'ASL',ABS,6); d(0x0F,'SLO',ABS,6);
    d(0x10,'BPL',REL,2,1); d(0x11,'ORA',IZY,5,1); d(0x13,'SLO',IZY,8); d(0x14,'NOP',ZPX,4);
    d(0x15,'ORA',ZPX,4); d(0x16,'ASL',ZPX,6); d(0x17,'SLO',ZPX,6);
    d(0x18,'CLC',IMP,2); d(0x19,'ORA',ABY,4,1); d(0x1A,'NOP',IMP,2); d(0x1B,'SLO',ABY,7);
    d(0x1C,'NOP',ABX,4,1); d(0x1D,'ORA',ABX,4,1); d(0x1E,'ASL',ABX,7); d(0x1F,'SLO',ABX,7);
    d(0x20,'JSR',ABS,6); d(0x21,'AND',IZX,6); d(0x23,'RLA',IZX,8); d(0x24,'BIT',ZP,3);
    d(0x25,'AND',ZP,3); d(0x26,'ROL',ZP,5); d(0x27,'RLA',ZP,5);
    d(0x28,'PLP',IMP,4); d(0x29,'AND',IMM,2); d(0x2A,'ROL',ACC,2); d(0x2B,'ANC',IMM,2);
    d(0x2C,'BIT',ABS,4); d(0x2D,'AND',ABS,4); d(0x2E,'ROL',ABS,6); d(0x2F,'RLA',ABS,6);
    d(0x30,'BMI',REL,2,1); d(0x31,'AND',IZY,5,1); d(0x33,'RLA',IZY,8); d(0x34,'NOP',ZPX,4);
    d(0x35,'AND',ZPX,4); d(0x36,'ROL',ZPX,6); d(0x37,'RLA',ZPX,6);
    d(0x38,'SEC',IMP,2); d(0x39,'AND',ABY,4,1); d(0x3A,'NOP',IMP,2); d(0x3B,'RLA',ABY,7);
    d(0x3C,'NOP',ABX,4,1); d(0x3D,'AND',ABX,4,1); d(0x3E,'ROL',ABX,7); d(0x3F,'RLA',ABX,7);
    d(0x40,'RTI',IMP,6); d(0x41,'EOR',IZX,6); d(0x43,'SRE',IZX,8); d(0x44,'NOP',ZP,3);
    d(0x45,'EOR',ZP,3); d(0x46,'LSR',ZP,5); d(0x47,'SRE',ZP,5);
    d(0x48,'PHA',IMP,3); d(0x49,'EOR',IMM,2); d(0x4A,'LSR',ACC,2); d(0x4B,'ALR',IMM,2);
    d(0x4C,'JMP',ABS,3); d(0x4D,'EOR',ABS,4); d(0x4E,'LSR',ABS,6); d(0x4F,'SRE',ABS,6);
    d(0x50,'BVC',REL,2,1); d(0x51,'EOR',IZY,5,1); d(0x53,'SRE',IZY,8); d(0x54,'NOP',ZPX,4);
    d(0x55,'EOR',ZPX,4); d(0x56,'LSR',ZPX,6); d(0x57,'SRE',ZPX,6);
    d(0x58,'CLI',IMP,2); d(0x59,'EOR',ABY,4,1); d(0x5A,'NOP',IMP,2); d(0x5B,'SRE',ABY,7);
    d(0x5C,'NOP',ABX,4,1); d(0x5D,'EOR',ABX,4,1); d(0x5E,'LSR',ABX,7); d(0x5F,'SRE',ABX,7);
    d(0x60,'RTS',IMP,6); d(0x61,'ADC',IZX,6); d(0x63,'RRA',IZX,8); d(0x64,'NOP',ZP,3);
    d(0x65,'ADC',ZP,3); d(0x66,'ROR',ZP,5); d(0x67,'RRA',ZP,5);
    d(0x68,'PLA',IMP,4); d(0x69,'ADC',IMM,2); d(0x6A,'ROR',ACC,2); d(0x6B,'ARR',IMM,2);
    d(0x6C,'JMP',IND,5); d(0x6D,'ADC',ABS,4); d(0x6E,'ROR',ABS,6); d(0x6F,'RRA',ABS,6);
    d(0x70,'BVS',REL,2,1); d(0x71,'ADC',IZY,5,1); d(0x73,'RRA',IZY,8); d(0x74,'NOP',ZPX,4);
    d(0x75,'ADC',ZPX,4); d(0x76,'ROR',ZPX,6); d(0x77,'RRA',ZPX,6);
    d(0x78,'SEI',IMP,2); d(0x79,'ADC',ABY,4,1); d(0x7A,'NOP',IMP,2); d(0x7B,'RRA',ABY,7);
    d(0x7C,'NOP',ABX,4,1); d(0x7D,'ADC',ABX,4,1); d(0x7E,'ROR',ABX,7); d(0x7F,'RRA',ABX,7);
    d(0x80,'NOP',IMM,2); d(0x81,'STA',IZX,6); d(0x82,'NOP',IMM,2); d(0x83,'SAX',IZX,6);
    d(0x84,'STY',ZP,3); d(0x85,'STA',ZP,3); d(0x86,'STX',ZP,3); d(0x87,'SAX',ZP,3);
    d(0x88,'DEY',IMP,2); d(0x89,'NOP',IMM,2); d(0x8A,'TXA',IMP,2); d(0x8B,'XAA',IMM,2);
    d(0x8C,'STY',ABS,4); d(0x8D,'STA',ABS,4); d(0x8E,'STX',ABS,4); d(0x8F,'SAX',ABS,4);
    d(0x90,'BCC',REL,2,1); d(0x91,'STA',IZY,6); d(0x93,'AHX',IZY,6); d(0x94,'STY',ZPX,4);
    d(0x95,'STA',ZPX,4); d(0x96,'STX',ZPY,4); d(0x97,'SAX',ZPY,4);
    d(0x98,'TYA',IMP,2); d(0x99,'STA',ABY,5); d(0x9A,'TXS',IMP,2); d(0x9B,'TAS',ABY,5);
    d(0x9C,'SHY',ABX,5); d(0x9D,'STA',ABX,5); d(0x9E,'SHX',ABY,5); d(0x9F,'AHX',ABY,5);
    d(0xA0,'LDY',IMM,2); d(0xA1,'LDA',IZX,6); d(0xA2,'LDX',IMM,2); d(0xA3,'LAX',IZX,6);
    d(0xA4,'LDY',ZP,3); d(0xA5,'LDA',ZP,3); d(0xA6,'LDX',ZP,3); d(0xA7,'LAX',ZP,3);
    d(0xA8,'TAY',IMP,2); d(0xA9,'LDA',IMM,2); d(0xAA,'TAX',IMP,2); d(0xAB,'LAX',IMM,2);
    d(0xAC,'LDY',ABS,4); d(0xAD,'LDA',ABS,4); d(0xAE,'LDX',ABS,4); d(0xAF,'LAX',ABS,4);
    d(0xB0,'BCS',REL,2,1); d(0xB1,'LDA',IZY,5,1); d(0xB3,'LAX',IZY,5,1); d(0xB4,'LDY',ZPX,4);
    d(0xB5,'LDA',ZPX,4); d(0xB6,'LDX',ZPY,4); d(0xB7,'LAX',ZPY,4);
    d(0xB8,'CLV',IMP,2); d(0xB9,'LDA',ABY,4,1); d(0xBA,'TSX',IMP,2); d(0xBB,'LAS',ABY,4,1);
    d(0xBC,'LDY',ABX,4,1); d(0xBD,'LDA',ABX,4,1); d(0xBE,'LDX',ABY,4,1); d(0xBF,'LAX',ABY,4,1);
    d(0xC0,'CPY',IMM,2); d(0xC1,'CMP',IZX,6); d(0xC2,'NOP',IMM,2); d(0xC3,'DCP',IZX,8);
    d(0xC4,'CPY',ZP,3); d(0xC5,'CMP',ZP,3); d(0xC6,'DEC',ZP,5); d(0xC7,'DCP',ZP,5);
    d(0xC8,'INY',IMP,2); d(0xC9,'CMP',IMM,2); d(0xCA,'DEX',IMP,2); d(0xCB,'AXS',IMM,2);
    d(0xCC,'CPY',ABS,4); d(0xCD,'CMP',ABS,4); d(0xCE,'DEC',ABS,6); d(0xCF,'DCP',ABS,6);
    d(0xD0,'BNE',REL,2,1); d(0xD1,'CMP',IZY,5,1); d(0xD3,'DCP',IZY,8); d(0xD4,'NOP',ZPX,4);
    d(0xD5,'CMP',ZPX,4); d(0xD6,'DEC',ZPX,6); d(0xD7,'DCP',ZPX,6);
    d(0xD8,'CLD',IMP,2); d(0xD9,'CMP',ABY,4,1); d(0xDA,'NOP',IMP,2); d(0xDB,'DCP',ABY,7);
    d(0xDC,'NOP',ABX,4,1); d(0xDD,'CMP',ABX,4,1); d(0xDE,'DEC',ABX,7); d(0xDF,'DCP',ABX,7);
    d(0xE0,'CPX',IMM,2); d(0xE1,'SBC',IZX,6); d(0xE2,'NOP',IMM,2); d(0xE3,'ISC',IZX,8);
    d(0xE4,'CPX',ZP,3); d(0xE5,'SBC',ZP,3); d(0xE6,'INC',ZP,5); d(0xE7,'ISC',ZP,5);
    d(0xE8,'INX',IMP,2); d(0xE9,'SBC',IMM,2); d(0xEA,'NOP',IMP,2); d(0xEB,'SBC',IMM,2);
    d(0xEC,'CPX',ABS,4); d(0xED,'SBC',ABS,4); d(0xEE,'INC',ABS,6); d(0xEF,'ISC',ABS,6);
    d(0xF0,'BEQ',REL,2,1); d(0xF1,'SBC',IZY,5,1); d(0xF3,'ISC',IZY,8); d(0xF4,'NOP',ZPX,4);
    d(0xF5,'SBC',ZPX,4); d(0xF6,'INC',ZPX,6); d(0xF7,'ISC',ZPX,6);
    d(0xF8,'SED',IMP,2); d(0xF9,'SBC',ABY,4,1); d(0xFA,'NOP',IMP,2); d(0xFB,'ISC',ABY,7);
    d(0xFC,'NOP',ABX,4,1); d(0xFD,'SBC',ABX,4,1); d(0xFE,'INC',ABX,7); d(0xFF,'ISC',ABX,7);
  })();

  function CPU6502(bus) {
    this.bus = bus;
    this.A = 0; this.X = 0; this.Y = 0; this.S = 0xFD;
    this.PC = 0;
    this.P = FLAG_U | FLAG_I;
    this.cycles = 0;
    this.totalCycles = 0;
    this.penalty = 0;
    this.nmiPending = false;
    this.irqLine = false;
    this.jammed = false;
  }
  CPU6502.FLAGS = { C: FLAG_C, Z: FLAG_Z, I: FLAG_I, D: FLAG_D, B: FLAG_B, U: FLAG_U, V: FLAG_V, N: FLAG_N };

  CPU6502.prototype.read = function (a) { return this.bus.read(a & 0xFFFF) & 0xFF; };
  CPU6502.prototype.write = function (a, v) { this.bus.write(a & 0xFFFF, v & 0xFF); };

  CPU6502.prototype.reset = function () {
    this.A = 0; this.X = 0; this.Y = 0; this.S = 0xFD;
    this.P = FLAG_U | FLAG_I;
    this.PC = this.read(0xFFFC) | (this.read(0xFFFD) << 8);
    this.cycles = 0;
    this.nmiPending = false;
  };

  CPU6502.prototype.triggerNMI = function () { this.nmiPending = true; };
  CPU6502.prototype.setIRQ = function (level) { this.irqLine = !!level; };

  CPU6502.prototype._zn = function (v) {
    this.P = (this.P & ~(FLAG_Z | FLAG_N)) | (v === 0 ? FLAG_Z : 0) | (v & FLAG_N);
  };
  CPU6502.prototype._setFlag = function (f, on) {
    if (on) this.P |= f; else this.P &= ~f;
    this.P |= FLAG_U;
  };
  CPU6502.prototype._push = function (v) {
    this.write(0x0100 + this.S, v & 0xFF);
    this.S = (this.S - 1) & 0xFF;
  };
  CPU6502.prototype._pop = function () {
    this.S = (this.S + 1) & 0xFF;
    return this.read(0x0100 + this.S);
  };

  CPU6502.prototype._interrupt = function (vector, brk) {
    this._push((this.PC >> 8) & 0xFF);
    this._push(this.PC & 0xFF);
    var p = (this.P & ~FLAG_B) | FLAG_U;
    if (brk) p |= FLAG_B;
    this._push(p);
    this.P |= FLAG_I;
    this.PC = this.read(vector) | (this.read(vector + 1) << 8);
    this.totalCycles += 7;
  };

  CPU6502.prototype._addr = function (mode, cls) {
    // cls: 1 = read op, 2 = write op, 3 = read-modify-write op
    // Hardware performs "dummy reads" at the intermediate (pre-fixup) address:
    //   read ops  -> only when indexing crosses a page
    //   write/RMW -> always
    // (verified against blargg instr_misc/03-dummy_reads)
    cls = cls || 1;
    var a = 0, lo, hi, base, zp;
    switch (mode) {
      case IMM:
        a = this.PC; this.PC = (this.PC + 1) & 0xFFFF; break;
      case ZP:
        a = this.read(this.PC); this.PC = (this.PC + 1) & 0xFFFF; break;
      case ZPX:
        a = (this.read(this.PC) + this.X) & 0xFF; this.PC = (this.PC + 1) & 0xFFFF; break;
      case ZPY:
        a = (this.read(this.PC) + this.Y) & 0xFF; this.PC = (this.PC + 1) & 0xFFFF; break;
      case ABS:
        lo = this.read(this.PC); hi = this.read(this.PC + 1);
        this.PC = (this.PC + 2) & 0xFFFF; a = (hi << 8) | lo; break;
      case ABX:
        lo = this.read(this.PC); hi = this.read(this.PC + 1);
        this.PC = (this.PC + 2) & 0xFFFF;
        base = (hi << 8) | lo; a = (base + this.X) & 0xFFFF;
        if ((base & 0xFF00) !== (a & 0xFF00)) this.penalty = 1;
        if (cls >= 2 || this.penalty) this.read((base & 0xFF00) | ((base + this.X) & 0xFF));
        break;
      case ABY:
        lo = this.read(this.PC); hi = this.read(this.PC + 1);
        this.PC = (this.PC + 2) & 0xFFFF;
        base = (hi << 8) | lo; a = (base + this.Y) & 0xFFFF;
        if ((base & 0xFF00) !== (a & 0xFF00)) this.penalty = 1;
        if (cls >= 2 || this.penalty) this.read((base & 0xFF00) | ((base + this.Y) & 0xFF));
        break;
      case IND:
        lo = this.read(this.PC); hi = this.read(this.PC + 1);
        this.PC = (this.PC + 2) & 0xFFFF;
        base = (hi << 8) | lo;
        a = this.read(base) | (this.read((base & 0xFF00) | ((base + 1) & 0xFF)) << 8);
        break;
      case IZX:
        zp = (this.read(this.PC) + this.X) & 0xFF; this.PC = (this.PC + 1) & 0xFFFF;
        lo = this.read(zp); hi = this.read((zp + 1) & 0xFF);
        a = (hi << 8) | lo; break;
      case IZY:
        zp = this.read(this.PC); this.PC = (this.PC + 1) & 0xFFFF;
        lo = this.read(zp); hi = this.read((zp + 1) & 0xFF);
        base = (hi << 8) | lo; a = (base + this.Y) & 0xFFFF;
        if ((base & 0xFF00) !== (a & 0xFF00)) this.penalty = 1;
        if (cls >= 2 || this.penalty) this.read((base & 0xFF00) | ((base + this.Y) & 0xFF));
        break;
    }
    return a & 0xFFFF;
  };

  CPU6502.prototype._cmp = function (reg, v) {
    var r = (reg - v) & 0xFF;
    this._setFlag(FLAG_C, reg >= v);
    this._zn(r);
    return r;
  };

  CPU6502.prototype._adc = function (v) {
    var a = this.A;
    var sum = a + v + (this.P & FLAG_C ? 1 : 0);
    this._setFlag(FLAG_C, sum > 0xFF);
    this._setFlag(FLAG_V, (~(a ^ v) & (a ^ sum) & 0x80) !== 0);
    this.A = sum & 0xFF;
    this._zn(this.A);
  };

  CPU6502.prototype._branch = function (cond) {
    var off = this.read(this.PC); this.PC = (this.PC + 1) & 0xFFFF;
    var cycles = 2;
    if (cond) {
      cycles += 1;
      if (off & 0x80) off -= 0x100;
      var oldPC = this.PC;
      this.PC = (this.PC + off) & 0xFFFF;
      if ((oldPC & 0xFF00) !== (this.PC & 0xFF00)) cycles += 1;
    }
    return cycles;
  };

  CPU6502.prototype.step = function () {
    var v, c, lo, hi;
    if (this.nmiPending) {
      this.nmiPending = false;
      this._interrupt(0xFFFA, false);
      return 7;
    }
    if (this.irqLine && !(this.P & FLAG_I)) {
      this._interrupt(0xFFFE, false);
      return 7;
    }
    var op = this.read(this.PC);
    this.PC = (this.PC + 1) & 0xFFFF;
    var info = OPS[op];
    var name = info[0], mode = info[1], cycles = info[2];
    this.penalty = 0;

    var addr = 0;
    var WRITES = { STA: 2, STX: 2, STY: 2, SAX: 2, AHX: 2, SHX: 2, SHY: 2, TAS: 2 };
    var RMWS = { ASL: 3, LSR: 3, ROL: 3, ROR: 3, INC: 3, DEC: 3,
                 SLO: 3, RLA: 3, SRE: 3, RRA: 3, DCP: 3, ISC: 3 };
    var cls = 1;
    if (WRITES[name]) cls = 2;
    else if (RMWS[name] && mode !== ACC) cls = 3;
    if (mode !== IMP && mode !== ACC && mode !== REL) addr = this._addr(mode, cls);

    switch (name) {
      // ---- read-modify-write accumulator ----
      case 'ASL':
        if (mode === ACC) {
          this._setFlag(FLAG_C, (this.A & 0x80) !== 0);
          this.A = (this.A << 1) & 0xFF; this._zn(this.A);
        } else {
          var v = this.read(addr);
          this._setFlag(FLAG_C, (v & 0x80) !== 0);
          v = (v << 1) & 0xFF; this._zn(v); this.write(addr, v);
        }
        break;
      case 'LSR':
        if (mode === ACC) {
          this._setFlag(FLAG_C, (this.A & 0x01) !== 0);
          this.A = (this.A >> 1) & 0xFF; this._zn(this.A);
        } else {
          v = this.read(addr);
          this._setFlag(FLAG_C, (v & 0x01) !== 0);
          v = (v >> 1) & 0xFF; this._zn(v); this.write(addr, v);
        }
        break;
      case 'ROL':
        if (mode === ACC) {
          var c = this.P & FLAG_C ? 1 : 0;
          this._setFlag(FLAG_C, (this.A & 0x80) !== 0);
          this.A = ((this.A << 1) | c) & 0xFF; this._zn(this.A);
        } else {
          v = this.read(addr); c = this.P & FLAG_C ? 1 : 0;
          this._setFlag(FLAG_C, (v & 0x80) !== 0);
          v = ((v << 1) | c) & 0xFF; this._zn(v); this.write(addr, v);
        }
        break;
      case 'ROR':
        if (mode === ACC) {
          c = this.P & FLAG_C ? 1 : 0;
          this._setFlag(FLAG_C, (this.A & 0x01) !== 0);
          this.A = ((this.A >> 1) | (c << 7)) & 0xFF; this._zn(this.A);
        } else {
          v = this.read(addr); c = this.P & FLAG_C ? 1 : 0;
          this._setFlag(FLAG_C, (v & 0x01) !== 0);
          v = ((v >> 1) | (c << 7)) & 0xFF; this._zn(v); this.write(addr, v);
        }
        break;
      case 'INC':
        v = (this.read(addr) + 1) & 0xFF; this._zn(v); this.write(addr, v); break;
      case 'DEC':
        v = (this.read(addr) - 1) & 0xFF; this._zn(v); this.write(addr, v); break;

      // ---- loads / alu reads ----
      case 'ORA': this.A = (this.A | this.read(addr)) & 0xFF; this._zn(this.A); break;
      case 'AND': this.A = (this.A & this.read(addr)) & 0xFF; this._zn(this.A); break;
      case 'EOR': this.A = (this.A ^ this.read(addr)) & 0xFF; this._zn(this.A); break;
      case 'ADC': this._adc(this.read(addr)); break;
      case 'SBC': this._adc(this.read(addr) ^ 0xFF); break;
      case 'LDA': this.A = this.read(addr); this._zn(this.A); break;
      case 'LDX': this.X = this.read(addr); this._zn(this.X); break;
      case 'LDY': this.Y = this.read(addr); this._zn(this.Y); break;
      case 'CMP': this._cmp(this.A, this.read(addr)); break;
      case 'CPX': this._cmp(this.X, this.read(addr)); break;
      case 'CPY': this._cmp(this.Y, this.read(addr)); break;
      case 'BIT':
        v = this.read(addr);
        this._setFlag(FLAG_Z, (this.A & v) === 0);
        this._setFlag(FLAG_V, (v & 0x40) !== 0);
        this._setFlag(FLAG_N, (v & 0x80) !== 0);
        break;
      case 'NOP':
        if (mode !== IMP && mode !== ACC) this.read(addr); // dummy read for multi-byte NOPs
        break;

      // ---- stores ----
      case 'STA': this.write(addr, this.A); break;
      case 'STX': this.write(addr, this.X); break;
      case 'STY': this.write(addr, this.Y); break;

      // ---- register / flag / stack (implied) ----
      case 'TAX': this.X = this.A; this._zn(this.X); break;
      case 'TAY': this.Y = this.A; this._zn(this.Y); break;
      case 'TXA': this.A = this.X; this._zn(this.A); break;
      case 'TYA': this.A = this.Y; this._zn(this.A); break;
      case 'TSX': this.X = this.S; this._zn(this.X); break;
      case 'TXS': this.S = this.X; break;
      case 'INX': this.X = (this.X + 1) & 0xFF; this._zn(this.X); break;
      case 'INY': this.Y = (this.Y + 1) & 0xFF; this._zn(this.Y); break;
      case 'DEX': this.X = (this.X - 1) & 0xFF; this._zn(this.X); break;
      case 'DEY': this.Y = (this.Y - 1) & 0xFF; this._zn(this.Y); break;
      case 'CLC': this._setFlag(FLAG_C, false); break;
      case 'SEC': this._setFlag(FLAG_C, true); break;
      case 'CLI': this._setFlag(FLAG_I, false); break;
      case 'SEI': this._setFlag(FLAG_I, true); break;
      case 'CLD': this._setFlag(FLAG_D, false); break;
      case 'SED': this._setFlag(FLAG_D, true); break;
      case 'CLV': this._setFlag(FLAG_V, false); break;
      case 'PHP':
        this._push(this.P | FLAG_B | FLAG_U); break;
      case 'PLP':
        this.P = (this._pop() & ~FLAG_B) | FLAG_U; break;
      case 'PHA': this._push(this.A); break;
      case 'PLA': this.A = this._pop(); this._zn(this.A); break;

      // ---- control flow ----
      case 'JMP': this.PC = addr; break;
      case 'JSR':
        var ret = (this.PC - 1) & 0xFFFF;
        this._push((ret >> 8) & 0xFF);
        this._push(ret & 0xFF);
        this.PC = addr;
        break;
      case 'RTS':
        lo = this._pop(); hi = this._pop();
        this.PC = (((hi << 8) | lo) + 1) & 0xFFFF;
        break;
      case 'RTI':
        this.P = (this._pop() & ~FLAG_B) | FLAG_U;
        lo = this._pop(); hi = this._pop();
        this.PC = (hi << 8) | lo;
        break;
      case 'BRK':
        this.PC = (this.PC + 1) & 0xFFFF;
        this._interrupt(0xFFFE, true);
        return 7;
      case 'BPL': cycles = this._branch(!(this.P & FLAG_N)); break;
      case 'BMI': cycles = this._branch(!!(this.P & FLAG_N)); break;
      case 'BVC': cycles = this._branch(!(this.P & FLAG_V)); break;
      case 'BVS': cycles = this._branch(!!(this.P & FLAG_V)); break;
      case 'BCC': cycles = this._branch(!(this.P & FLAG_C)); break;
      case 'BCS': cycles = this._branch(!!(this.P & FLAG_C)); break;
      case 'BNE': cycles = this._branch(!(this.P & FLAG_Z)); break;
      case 'BEQ': cycles = this._branch(!!(this.P & FLAG_Z)); break;

      // ---- unofficial ----
      case 'LAX': this.A = this.read(addr); this.X = this.A; this._zn(this.A); break;
      case 'SAX': this.write(addr, this.A & this.X); break;
      case 'DCP':
        v = (this.read(addr) - 1) & 0xFF; this.write(addr, v); this._cmp(this.A, v); break;
      case 'ISC':
        v = (this.read(addr) + 1) & 0xFF; this.write(addr, v); this._adc(v ^ 0xFF); break;
      case 'SLO':
        v = this.read(addr);
        this._setFlag(FLAG_C, (v & 0x80) !== 0);
        v = (v << 1) & 0xFF; this.write(addr, v);
        this.A = (this.A | v) & 0xFF; this._zn(this.A); break;
      case 'RLA':
        v = this.read(addr); c = this.P & FLAG_C ? 1 : 0;
        this._setFlag(FLAG_C, (v & 0x80) !== 0);
        v = ((v << 1) | c) & 0xFF; this.write(addr, v);
        this.A = (this.A & v) & 0xFF; this._zn(this.A); break;
      case 'SRE':
        v = this.read(addr);
        this._setFlag(FLAG_C, (v & 0x01) !== 0);
        v = (v >> 1) & 0xFF; this.write(addr, v);
        this.A = (this.A ^ v) & 0xFF; this._zn(this.A); break;
      case 'RRA':
        v = this.read(addr); c = this.P & FLAG_C ? 1 : 0;
        this._setFlag(FLAG_C, (v & 0x01) !== 0);
        v = ((v >> 1) | (c << 7)) & 0xFF; this.write(addr, v);
        this._adc(v); break;
      case 'ANC':
        this.A = (this.A & this.read(addr)) & 0xFF; this._zn(this.A);
        this._setFlag(FLAG_C, (this.A & 0x80) !== 0); break;
      case 'ALR':
        v = (this.A & this.read(addr)) & 0xFF;
        this._setFlag(FLAG_C, (v & 0x01) !== 0);
        this.A = (v >> 1) & 0xFF; this._zn(this.A); break;
      case 'ARR':
        v = (this.A & this.read(addr)) & 0xFF;
        var cin = this.P & FLAG_C ? 1 : 0;
        this.A = ((v >> 1) | (cin << 7)) & 0xFF; this._zn(this.A);
        this._setFlag(FLAG_C, (this.A & 0x40) !== 0);
        this._setFlag(FLAG_V, (((this.A >> 6) ^ (this.A >> 5)) & 1) !== 0);
        break;
      case 'AXS':
        v = this.read(addr);
        var t = (this.A & this.X) & 0xFF;
        this._setFlag(FLAG_C, t >= v);
        this.X = (t - v) & 0xFF; this._zn(this.X); break;
      case 'XAA':
        this.A = (this.X & this.read(addr)) & 0xFF; this._zn(this.A); break;
      case 'LAS':
        v = (this.read(addr) & this.S) & 0xFF;
        this.A = v; this.X = v; this.S = v; this._zn(v); break;
      case 'AHX':
        v = (this.A & this.X & (((addr >> 8) + 1) & 0xFF)) & 0xFF;
        this.write(addr, v); break;
      case 'SHX':
        v = (this.X & (((addr >> 8) + 1) & 0xFF)) & 0xFF;
        this.write(addr, v); break;
      case 'SHY':
        v = (this.Y & (((addr >> 8) + 1) & 0xFF)) & 0xFF;
        this.write(addr, v); break;
      case 'TAS':
        this.S = (this.A & this.X) & 0xFF;
        v = (this.S & (((addr >> 8) + 1) & 0xFF)) & 0xFF;
        this.write(addr, v); break;
      case 'JAM':
        // treat as 2-cycle NOP (keeps emulated machines running)
        break;
      default:
        break;
    }

    if (info[3] && this.penalty) cycles += 1;
    this.totalCycles += cycles;
    return cycles;
  };

  global.CPU6502 = CPU6502;
  if (typeof module !== 'undefined' && module.exports) module.exports = CPU6502;
})(typeof window !== 'undefined' ? window : globalThis);

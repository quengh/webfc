#!/usr/bin/env node
/*
 * Mapper 4 (MMC3) self-test on a synthetic in-memory iNES image.
 * No external ROM required. Covers:
 *   - PRG 8KB windows at $8000/$A000/$C000/$E000, both PRG modes, bank aliasing
 *   - CHR 2KB+1KB windows, both CHR modes (A12 inversion)
 *   - mirroring control via $A000 (and four-screen boards ignoring it)
 *   - IRQ counter semantics: reload, decrement, latch 0 firing, $E000/$E001
 *   - IRQ wiring through the NES bus to the CPU IRQ line
 *
 * Run: node tests/mapper4_selftest.js
 * Expected output: MAPPER4 SELF-TEST: ALL OK
 */
'use strict';
const Cart = require('../js/cart.js');
const NES = require('../js/nes.js');

// synthetic ROM: 64KB PRG (8 x 8KB banks) + 8KB CHR (8 x 1KB banks)
const PRG_BANKS = 8, CHR_BANKS = 8;
const prgByte = (bank, off) => (bank * 0x28 + off) & 0xFF;
const chrByte = (bank, off) => (bank * 0x11 + off) & 0xFF;

function makeRom(f6) {
  const rom = new Uint8Array(16 + PRG_BANKS * 0x2000 + CHR_BANKS * 0x400);
  rom.set([0x4E, 0x45, 0x53, 0x1A, PRG_BANKS >> 1, CHR_BANKS >> 3, f6, 0]);
  for (let b = 0; b < PRG_BANKS; b++)
    for (let i = 0; i < 0x2000; i++) rom[16 + b * 0x2000 + i] = prgByte(b, i);
  const chrOff = 16 + PRG_BANKS * 0x2000;
  for (let b = 0; b < CHR_BANKS; b++)
    for (let i = 0; i < 0x400; i++) rom[chrOff + b * 0x400 + i] = chrByte(b, i);
  return rom;
}

let n = 0;
function eq(actual, expected, msg) {
  n++;
  if (actual !== expected) {
    console.error('FAIL #' + n + ' ' + msg + ': got ' + actual + ', want ' + expected);
    process.exit(1);
  }
}

const cart = new Cart(makeRom(0x40));
const reg = (r, v) => { cart.writePRG(0x8000, r); cart.writePRG(0x8001, v); };

// ---- PRG banking ----
// power-on: mode 0 -> R6, R7, second-to-last, last
eq(cart.readPRG(0x8000), prgByte(0, 0), 'PRG default $8000 = R6 = bank 0');
eq(cart.readPRG(0x8123), prgByte(0, 0x123), 'PRG in-window offset preserved');
eq(cart.readPRG(0xA000), prgByte(0, 0), 'PRG default $A000 = R7 = bank 0');
eq(cart.readPRG(0xC000), prgByte(6, 0), 'PRG default $C000 = second-to-last bank');
eq(cart.readPRG(0xE123), prgByte(7, 0x123), 'PRG default $E000 = last bank');

reg(6, 3); reg(7, 5);
eq(cart.readPRG(0x8000), prgByte(3, 0), 'PRG R6 select');
eq(cart.readPRG(0xA000), prgByte(5, 0), 'PRG R7 select');
eq(cart.readPRG(0xC000), prgByte(6, 0), 'PRG fixed window unaffected');

// register writes alias across the whole block (select: even addr & 0xE001,
// data: odd addr & 0xE001)
cart.writePRG(0x9FFE, 6); cart.writePRG(0x9FFF, 4);
eq(cart.readPRG(0x8000), prgByte(4, 0), 'PRG bank select/data alias at $9FFE/9FFF');

// R6 wraps: 9 & 0x3F -> 9 % 8 = 1
reg(6, 9);
eq(cart.readPRG(0x8000), prgByte(1, 0), 'PRG bank wraps modulo count');

// PRG mode 1: first and third windows swap
reg(6, 3); cart.writePRG(0x8000, 0x46);
eq(cart.readPRG(0x8000), prgByte(6, 0), 'PRG mode 1 $8000 = second-to-last');
eq(cart.readPRG(0xA000), prgByte(5, 0), 'PRG mode 1 $A000 = R7');
eq(cart.readPRG(0xC000), prgByte(3, 0), 'PRG mode 1 $C000 = R6');
eq(cart.readPRG(0xE000), prgByte(7, 0), 'PRG mode 1 $E000 = last');
cart.writePRG(0x8000, 0x06); // back to mode 0

// ---- CHR banking ----
reg(0, 2); reg(1, 6); reg(2, 1); reg(3, 3); reg(4, 5); reg(5, 7);
// mode 0: 2KB windows R0/R1 at $0000/$0800, 1KB R2-R5 at $1000-$1FFF
eq(cart.readCHR(0x0000), chrByte(2, 0), 'CHR mode0 $0000 = R0 2KB (bank 2)');
eq(cart.readCHR(0x0400), chrByte(3, 0), 'CHR mode0 $0400 = second KB of R0 window');
eq(cart.readCHR(0x0800), chrByte(6, 0), 'CHR mode0 $0800 = R1 2KB (bank 6)');
eq(cart.readCHR(0x0C00), chrByte(7, 0), 'CHR mode0 $0C00 = second KB of R1 window');
eq(cart.readCHR(0x1000), chrByte(1, 0), 'CHR mode0 $1000 = R2');
eq(cart.readCHR(0x1234), chrByte(1, 0x234), 'CHR mode0 in-window offset preserved');
eq(cart.readCHR(0x1400), chrByte(3, 0), 'CHR mode0 $1400 = R3');
eq(cart.readCHR(0x1800), chrByte(5, 0), 'CHR mode0 $1800 = R4');
eq(cart.readCHR(0x1C00), chrByte(7, 0), 'CHR mode0 $1C00 = R5');

// 2KB banks are even-aligned: R0=3 aliases to bank 2
reg(0, 3);
eq(cart.readCHR(0x0000), chrByte(2, 0), 'CHR 2KB bank R0=3 aliases to 2');
reg(0, 2);

// mode 1 (A12 inversion): 2KB pair moves to $1000
cart.writePRG(0x8000, 0x86);
eq(cart.readCHR(0x0000), chrByte(1, 0), 'CHR mode1 $0000 = R2');
eq(cart.readCHR(0x0C00), chrByte(7, 0), 'CHR mode1 $0C00 = R5');
eq(cart.readCHR(0x1000), chrByte(2, 0), 'CHR mode1 $1000 = R0 2KB (bank 2)');
eq(cart.readCHR(0x1800), chrByte(6, 0), 'CHR mode1 $1800 = R1 2KB (bank 6)');
cart.writePRG(0x8000, 0x06);

// ---- mirroring ----
cart.writePRG(0xA000, 0);
eq(cart.mirroring, 1, 'mirror bit 0 -> vertical');
cart.writePRG(0xA000, 1);
eq(cart.mirroring, 0, 'mirror bit 1 -> horizontal');
const four = new Cart(makeRom(0x48));
eq(four.mirroring, 2, 'four-screen header -> four-screen mirroring');
four.writePRG(0xA000, 1);
eq(four.mirroring, 2, 'four-screen board ignores $A000');

// ---- IRQ counter ----
function newIRQ() {
  const c = new Cart(makeRom(0x40));
  return c;
}
// latch N -> IRQ fires on the (N+1)-th clock after reload
let c = newIRQ();
c.writePRG(0xC000, 5); c.writePRG(0xC001, 0); c.writePRG(0xE001, 0);
for (let i = 1; i <= 5; i++) {
  c.clockScanline();
  eq(c.irqPending, false, 'IRQ silent on clock ' + i + ' with latch 5');
}
c.clockScanline();
eq(c.irqPending, true, 'IRQ fires on clock 6 with latch 5');

// $E000 acknowledges and disables
c.writePRG(0xE000, 0);
eq(c.irqPending, false, '$E000 acknowledges IRQ');
c.writePRG(0xC001, 0);
for (let i = 0; i < 10; i++) c.clockScanline();
eq(c.irqPending, false, 'IRQ stays silent while disabled');

// latch 0 + reload: fires on every clock
c.writePRG(0xC000, 0); c.writePRG(0xC001, 0); c.writePRG(0xE001, 0);
for (let i = 0; i < 3; i++) {
  c.writePRG(0xE000, 0); c.writePRG(0xE001, 0);
  c.clockScanline();
  eq(c.irqPending, true, 'latch 0 fires every clock (#' + i + ')');
}

// reload flag applies to exactly one clock
c = newIRQ();
c.writePRG(0xC000, 2); c.writePRG(0xC001, 0); c.writePRG(0xE001, 0);
c.clockScanline(); // reload -> 2
c.writePRG(0xC001, 0);
eq(c.mmc3IRQCounter, 0, '$C001 clears the counter immediately');
c.clockScanline(); // reload again -> 2 (not decremented)
eq(c.mmc3IRQCounter, 2, 'reload flag forces reload on next clock');
c.clockScanline(); // 2 -> 1
c.clockScanline(); // 1 -> 0 -> IRQ
eq(c.irqPending, true, 'IRQ after decrement reaches 0');

// ---- IRQ wiring through the NES machine ----
const nes = new NES(44100);
const rom = makeRom(0x40);
// valid code path: IRQ vector -> $8000 (all 0x00 = BRK is fine, we only check arrival)
const prgEnd = 16 + PRG_BANKS * 0x2000;
rom[prgEnd - 4] = 0x00; rom[prgEnd - 3] = 0x80; // $FFFC/$FFFD reset -> $8000
rom[prgEnd - 2] = 0x00; rom[prgEnd - 1] = 0x80; // $FFFE/$FFFF IRQ/BRK -> $8000
nes.loadROM(rom);
nes.cart.writePRG(0xC000, 0); nes.cart.writePRG(0xC001, 0); nes.cart.writePRG(0xE001, 0);
nes.ppu.mask = 0x08; // enable background rendering so scanlines clock the IRQ counter
nes.runFrame();
eq(nes.cart.irqPending, true, 'machine: scanline clocks reach the IRQ counter');
eq(nes.cpu.irqLine, true, 'machine: MMC3 IRQ asserts the CPU IRQ line');
nes.cpu.P &= ~0x04; // clear I so the CPU services the level-triggered IRQ
nes.stepInstruction();
eq(nes.cpu.PC, 0x8000, 'machine: CPU vectors through $FFFE to the IRQ handler');

console.log('MAPPER4 SELF-TEST: ALL OK (' + n + ' checks)');

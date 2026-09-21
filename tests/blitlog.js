// Log (char, pen) sequence fed to the text engine.
const fs = require('fs');
const NES = require('/tmp/nes-emu/js/nes.js');
const rom = new Uint8Array(fs.readFileSync('/tmp/nes-emu/roms/240pee.nes'));
const nes = new NES(44100);
nes.loadROM(rom);
const cpu = nes.cpu;
const origStep = cpu.step.bind(cpu);
let on = false;
const blits = [];
const layouts = [];

// layout loop entry at $c3e1 with A=hi Y=lo X=pen -> string at ($00/$01)
cpu.step = function () {
  const pc = cpu.PC;
  if (pc === 0xc3e1 && cpu.totalCycles > 200000 && layouts.length < 6) {
    layouts.push({ cyc: cpu.totalCycles, ptr: (cpu.A << 8) | cpu.Y, pen: cpu.X });
  }
  if (pc === 0xc34a && cpu.totalCycles > 200000 && blits.length < 400) {
    // A=char X=pen; also read the string pointer state
    blits.push({ cyc: cpu.totalCycles, ch: cpu.A, pen: cpu.X });
  }
  return origStep();
};

for (let i = 0; i < 30 && blits.length < 400; i++) nes.runFrame();
console.log('layouts:', JSON.stringify(layouts.map(l => ({ ...l, ptr: '$' + l.ptr.toString(16) }))));
const line = blits.map(b => (b.ch >= 32 && b.ch < 127 ? String.fromCharCode(b.ch) : `{${b.ch.toString(16)}}`) + `@${b.pen}`).join(' ');
console.log('blits:', line);

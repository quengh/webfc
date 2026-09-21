// Single-step trace of the glyph blit routine.
const fs = require('fs');
const NES = require('/tmp/nes-emu/js/nes.js');
const rom = new Uint8Array(fs.readFileSync('/tmp/nes-emu/roms/240pee.nes'));
const nes = new NES(44100);
nes.loadROM(rom);

const cpu = nes.cpu;
const origStep = cpu.step.bind(cpu);
let tracing = false;
let traceBuf = [];
const events = [];
let done = false;

// log memory writes to stack-page buffer during trace
const origWrite = nes.write.bind(nes);
nes.write = function (a, v) {
  if (tracing && a >= 0x100 && a < 0x200) events.push(`   mem[$${a.toString(16)}] = $${v.toString(16)}`);
  return origWrite(a, v);
};
const origRead = nes.read.bind(nes);
nes.read = function (a) {
  return origRead(a);
};

cpu.step = function () {
  const pc = cpu.PC;
  if (!tracing && pc === 0xc34a && cpu.totalCycles > 295000 && traceBuf.length < 3) {
    tracing = true;
    events.push(`--- blit enter: A=$${cpu.A.toString(16)} X=$${cpu.X.toString(16)} Y=$${cpu.Y.toString(16)} C=${cpu.P & 1} S=$${cpu.S.toString(16)}`);
  }
  if (tracing) {
    events.push(`$${pc.toString(16).padStart(4,'0')} A=$${cpu.A.toString(16).padStart(2,'0')} X=$${cpu.X.toString(16).padStart(2,'0')} Y=$${cpu.Y.toString(16).padStart(2,'0')} P=${cpu.P.toString(2).padStart(8,'0')} S=$${cpu.S.toString(16)}`);
  }
  const r = origStep();
  if (tracing && cpu.PC === 0xc3a1) { // RTS end of blit
    tracing = false;
    traceBuf.push(1);
    events.push('--- blit exit');
  }
  return r;
};

for (let i = 0; i < 30 && traceBuf.length < 3; i++) nes.runFrame();
console.log(events.join('\n'));

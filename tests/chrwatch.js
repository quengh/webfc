// Watch CHR region $500-$FFF over time; report frames where it changes and by which PC.
const fs = require('fs');
const NES = require('/tmp/nes-emu/js/nes.js');
const rom = new Uint8Array(fs.readFileSync('/tmp/nes-emu/roms/240pee.nes'));
const nes = new NES(44100);
nes.loadROM(rom);

const cart = nes.cart;
const origWrite = cart.writeCHR.bind(cart);
const events = [];
let lastPC = 0;
nes.cpu.step = new Proxy(nes.cpu.step, {
  apply(target, thisArg, args) {
    lastPC = thisArg.PC;
    return Reflect.apply(target, thisArg, args);
  },
});
cart.writeCHR = function (addr, val) {
  if (addr >= 0x4e0 && addr <= 0x9ff) {
    events.push([nes.ppu.frame, lastPC, addr, val]);
  }
  return origWrite(addr, val);
};

for (let i = 0; i < 130; i++) nes.runFrame();

// summarize per frame+PC
const byFrame = new Map();
for (const [f, pc, addr, val] of events) {
  const k = f;
  if (!byFrame.has(k)) byFrame.set(k, new Map());
  const m = byFrame.get(k);
  if (!m.has(pc)) m.set(pc, { n: 0, lo: addr, hi: addr });
  const s = m.get(pc);
  s.n++; s.lo = Math.min(s.lo, addr); s.hi = Math.max(s.hi, addr);
}
for (const [f, m] of [...byFrame.entries()].sort((a, b) => a[0] - b[0])) {
  for (const [pc, s] of m) {
    console.log(`frame ${f} PC=$${pc.toString(16)} n=${s.n} $${s.lo.toString(16)}..$${s.hi.toString(16)}`);
  }
}
console.log('total region writes:', events.length);
fs.writeFileSync('region-writes.json', JSON.stringify(events));

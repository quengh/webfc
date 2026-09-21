// Trace CHR writes with CPU PC to find the uploader routine.
const fs = require('fs');
const NES = require('/tmp/nes-emu/js/nes.js');
const rom = new Uint8Array(fs.readFileSync(process.argv[2]));
const frames = parseInt(process.argv[3] || '30', 10);
const nes = new NES(44100);
nes.loadROM(rom);

const log = [];
const cart = nes.cart;
const origWrite = cart.writeCHR.bind(cart);
cart.writeCHR = function (addr, val) {
  if (log.length < 200000) {
    log.push([nes.cpu.totalCycles, nes.cpu.PC, addr, val, nes.cart.uxBank]);
  }
  return origWrite(addr, val);
};

for (let i = 0; i < frames; i++) nes.runFrame();

// summarize: group by PC
const byPC = new Map();
for (const [cyc, pc, addr, val, bank] of log) {
  const k = pc;
  if (!byPC.has(k)) byPC.set(k, { n: 0, first: cyc, addrMin: addr, addrMax: addr, bank });
  const s = byPC.get(k);
  s.n++; s.addrMin = Math.min(s.addrMin, addr); s.addrMax = Math.max(s.addrMax, addr);
}
const arr = [...byPC.entries()].sort((a, b) => a[1].first - b[1].first);
for (const [pc, s] of arr) {
  console.log(`PC=$${pc.toString(16).padStart(4, '0')} writes=${s.n} addr=$${s.addrMin.toString(16)}..$${s.addrMax.toString(16)} cyc=${s.first} bank=${s.bank}`);
}
console.log('total CHR writes:', log.length);
fs.writeFileSync('/tmp/nes-emu/test/chrwrites.json', JSON.stringify(log.slice(0, 200000)));

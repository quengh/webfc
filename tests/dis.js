// Minimal 6502 disassembler for tracing.
const MODES = {
  0:'imp',1:'acc',2:'imm',3:'zp',4:'zpx',5:'zpy',6:'abs',7:'abx',8:'aby',9:'ind',10:'izx',11:'izy',12:'rel'
};
// build opcode table from cpu.js OPS
const fs = require('fs');
const src = fs.readFileSync('/tmp/nes-emu/js/cpu.js', 'utf8');
const OPS = new Array(256).fill(null);
for (const m of src.matchAll(/d\((0x[0-9A-Fa-f]{2}),'([A-Z]{3})',([A-Z]{3}),(\d)/g)) {
  OPS[parseInt(m[1], 16)] = [m[2], m[3].toLowerCase()];
}
const MODELEN = { imp:1, acc:1, imm:2, zp:2, zpx:2, zpy:2, abs:3, abx:3, aby:3, ind:3, izx:2, izy:2, rel:2 };

function disasm(buf, base, start, end) {
  let pc = start;
  const out = [];
  while (pc < end) {
    const off = pc - base;
    const op = buf[off];
    const info = OPS[op] || ['???', 'imp'];
    const len = MODELEN[info[1]];
    const b = [...buf.slice(off, off + len)].map(x => x.toString(16).padStart(2, '0')).join(' ');
    let arg = '';
    const v = len >= 2 ? buf[off + 1] : 0;
    const w = len >= 3 ? (buf[off + 2] << 8 | v) : 0;
    switch (info[1]) {
      case 'imm': arg = `#$${v.toString(16)}`; break;
      case 'zp': arg = `$${v.toString(16).padStart(2,'0')}`; break;
      case 'zpx': arg = `$${v.toString(16).padStart(2,'0')},X`; break;
      case 'zpy': arg = `$${v.toString(16).padStart(2,'0')},Y`; break;
      case 'abs': arg = `$${w.toString(16).padStart(4,'0')}`; break;
      case 'abx': arg = `$${w.toString(16).padStart(4,'0')},X`; break;
      case 'aby': arg = `$${w.toString(16).padStart(4,'0')},Y`; break;
      case 'ind': arg = `($${w.toString(16).padStart(4,'0')})`; break;
      case 'izx': arg = `($${v.toString(16).padStart(2,'0')},X)`; break;
      case 'izy': arg = `($${v.toString(16).padStart(2,'0')}),Y`; break;
      case 'rel': arg = `$${((pc + 2 + (v < 128 ? v : v - 256)) & 0xffff).toString(16).padStart(4,'0')}`; break;
    }
    out.push(`${pc.toString(16).padStart(4,'0')}: ${b.padEnd(9)} ${info[0]} ${arg}`);
    pc += len;
  }
  return out.join('\n');
}
module.exports = { disasm };

if (require.main === module) {
  const [romPath, startS, endS] = process.argv.slice(2);
  const rom = fs.readFileSync(romPath);
  const start = parseInt(startS, 16), end = parseInt(endS, 16);
  // assume CPU addr = PRG offset for fixed bank $C000-$FFFF (64KB PRG: file offset 16 + addr)
  console.log(disasm(rom, -16, start, end));
}

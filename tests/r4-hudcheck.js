'use strict';
const fs = require('fs');
const NES = require('/tmp/nes-emu/js/nes.js');
const rom = new Uint8Array(fs.readFileSync('/tmp/nes-emu/roms/0001魂斗罗1.nes'));
const nes = new NES(44100); nes.loadROM(rom);

function dumpNTRows(tag, rows) {
  const v = nes.ppu.vram;
  for (const r of rows) {
    let line = [];
    for (let nt = 0; nt < 2; nt++) {
      const base = nt * 0x400 + r * 32;
      for (let x = 0; x < 32; x++) line.push(v[base + x].toString(16).padStart(2, '0'));
    }
    console.log(tag, 'row' + r, line.join(' '));
  }
}

// reach intro screen ("STAGE 1 JUNGLE")
nes.setButton(1, 'START', true); for (let f = 0; f < 8; f++) nes.runFrame(); nes.setButton(1, 'START', false);
for (let f = 0; f < 120; f++) nes.runFrame();
nes.setButton(1, 'START', true); for (let f = 0; f < 8; f++) nes.runFrame(); nes.setButton(1, 'START', false);
for (let f = 0; f < 120; f++) nes.runFrame();
console.log('== intro screen ==');
dumpNTRows('intro', [2,3,4,5,6,7]);
// into game
nes.setButton(1, 'RIGHT', true); for (let f = 0; f < 240; f++) nes.runFrame(); nes.setButton(1, 'RIGHT', false);
console.log('== in-game ==  scroll t=' + nes.ppu.t + ' v=' + nes.ppu.v + ' fineX=' + (nes.ppu.fineX || 0));
dumpNTRows('game', [0,1,2,3,4,5,6,7]);

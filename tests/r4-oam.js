'use strict';
const fs = require('fs');
const NES = require('/tmp/nes-emu/js/nes.js');
const rom = new Uint8Array(fs.readFileSync('/tmp/nes-emu/roms/0000超级玛丽.nes'));
const nes = new NES(44100); nes.loadROM(rom);
// exact r4-pipeline mario timeline: 300 frames -> START 8f +30 gap -> 60 -> 240 -> RIGHT 200
for (let f = 0; f < 300; f++) nes.runFrame();
nes.setButton(1, 'START', true); for (let f = 0; f < 8; f++) nes.runFrame(); nes.setButton(1, 'START', false);
for (let f = 0; f < 30; f++) nes.runFrame();
for (let f = 0; f < 60; f++) nes.runFrame();
for (let f = 0; f < 240; f++) nes.runFrame();
nes.setButton(1, 'RIGHT', true); for (let f = 0; f < 200; f++) nes.runFrame(); nes.setButton(1, 'RIGHT', false);
function dumpOAM(tag) {
  const oam = nes.ppu.oam;
  const list = [];
  for (let i = 0; i < 64; i++) {
    const y = oam[i * 4], t = oam[i * 4 + 1], a = oam[i * 4 + 2], x = oam[i * 4 + 3];
    if (y < 239) list.push(`spr${i}:y=${y},tile=0x${t.toString(16)},attr=0x${a.toString(16)},x=${x}`);
  }
  console.log(tag, 'frame', nes.ppu.frame, 'ctrl=0x' + nes.ppu.ctrl.toString(16), '|', list.join(' | '));
}
dumpOAM('game838');

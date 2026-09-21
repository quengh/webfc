#!/usr/bin/env node
// R3 focused runner: sprite pipeline oracles (reuse run_node_tests.js logic)
'use strict';
const fs = require('fs');
const path = require('path');
const NES = require('/tmp/nes-emu/js/nes.js');
const ROOT = '/tmp/nes-emu/roms/nes-test-roms-master';

function textAt(nes) {
  const ram = nes.cart.prgRAM;
  let s = '';
  for (let i = 4; i < 0x400; i++) {
    const c = ram[i];
    if (c === 0) { if (s.endsWith(' ')) break; if (s.length) s += ' '; if (s.length > 200) break; continue; }
    if (c >= 32 && c < 127) s += String.fromCharCode(c);
  }
  return s.trim();
}
function screenText(nes) {
  const lines = [];
  for (let base = 0; base < 0x800; base += 0x400) {
    for (let row = 0; row < 30; row++) {
      let s = '';
      for (let col = 0; col < 32; col++) {
        const t = nes.ppu.vram[base + row * 32 + col];
        s += (t >= 0x20 && t < 0x7f) ? String.fromCharCode(t) : ' ';
      }
      s = s.trim();
      if (s) lines.push(s);
    }
  }
  return lines.join(' | ');
}
function runBlargg(rel, maxSec) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) return { ok: null, text: 'MISSING' };
  const rom = new Uint8Array(fs.readFileSync(p));
  const nes = new NES(44100);
  nes.loadROM(rom);
  const maxFrames = (maxSec || 25) * 60;
  for (let f = 0; f < maxFrames; f++) {
    nes.runFrame();
    if (f % 30 !== 29) continue;
    const ram = nes.cart.prgRAM;
    const status = ram[0];
    const sig = (ram[1] === 0xDE && ram[2] === 0xB0 && ram[3] === 0x61) ||
                (ram[0] === 0xDE && ram[1] === 0xB0 && ram[2] === 0x61);
    const txt = textAt(nes);
    const scr = screenText(nes);
    const scrCode = (scr.match(/\$([0-9A-Fa-f]{2})\b/) || [])[1];
    const ready = status !== 0x80;
    const txtHit = ready && /passed|failed|error/i.test(txt + ' || ' + scr);
    if ((sig && ready) || txtHit || (ready && scrCode)) {
      const code = (ram[0] === 0xDE) ? ram[3] : status;
      const all = txt + ' || ' + scr;
      let ok;
      if (/passed/i.test(all)) ok = true;
      else if (/failed|error/i.test(all)) ok = false;
      else if (scrCode) ok = (parseInt(scrCode, 16) === 0);
      else ok = (code === 0);
      return { ok, code, text: all.replace(/\s*\|\s*/g, ' | ').slice(0, 200) };
    }
  }
  return { ok: null, text: 'TIMEOUT ' + (textAt(nes) + ' || ' + screenText(nes)).slice(0, 180) };
}

const tests = [];
for (const n of ['01.basics','02.alignment','03.corners','04.flip','05.left_clip','06.right_edge','07.screen_bottom','08.double_height','09.timing_basics','10.timing_order','11.edge_timing'])
  tests.push(['sprite_hit ' + n, 'sprite_hit_tests_2005.10.05/' + n + '.nes']);
for (const n of ['1.Basics','2.Details','3.Timing','4.Obscure','5.Emulator'])
  tests.push(['sprite_overflow ' + n, 'sprite_overflow_tests/' + n + '.nes']);
tests.push(['blargg sprite_ram', 'blargg_ppu_tests_2005.09.15b/sprite_ram.nes']);
tests.push(['oam_read', 'oam_read/oam_read.nes']);
tests.push(['oam_stress', 'oam_stress/oam_stress.nes']);
tests.push(['sprdma_and_dmc_dma', 'sprdma_and_dmc_dma/sprdma_and_dmc_dma.nes']);
tests.push(['sprdma_and_dmc_dma_512', 'sprdma_and_dmc_dma/sprdma_and_dmc_dma_512.nes']);

let fails = 0;
for (const [name, rel] of tests) {
  const r = runBlargg(rel);
  const mark = r.ok === true ? 'PASS' : r.ok === false ? 'FAIL' : ' ?  ';
  if (r.ok !== true) fails++;
  console.log(`${mark}  ${name}  ${r.text || ''}`);
}
console.log('failures/unknown:', fails, '/', tests.length);

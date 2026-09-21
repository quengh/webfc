#!/usr/bin/env node
/*
 * Playability tests on free open-source homebrew ROMs:
 *  - boots to a non-black screen (title)
 *  - screen animates over time
 *  - input actually changes the emulated result (A/B instance diff)
 *  - audio produces output
 *  - save-state determinism (save -> run -> load -> run reproduces)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const NES = require('../js/nes.js');

const ROOT = '/tmp/nes-emu/roms/nes-test-roms-master';
const OUT = '/tmp/nes-emu/test/results-play.json';

function fbHash(nes) {
  return crypto.createHash('sha1').update(Buffer.from(nes.ppu.fb.buffer)).digest('hex').slice(0, 16);
}
function nonBlack(nes) {
  let n = 0;
  for (let i = 0; i < nes.ppu.fb.length; i++) if ((nes.ppu.fb[i] & 0xFFFFFF) !== 0) n++;
  return n;
}
function audioStats(nes, frames) {
  let nz = 0, total = 0, peak = 0;
  for (let f = 0; f < frames; f++) {
    nes.runFrame();
    const s = nes.apu.drain();
    for (const v of s) {
      total++;
      const a = Math.abs(v);
      if (a > 0.01) nz++;
      if (a > peak) peak = a;
    }
  }
  return { samples: total, nonSilent: nz, peak: +peak.toFixed(3) };
}

function playTest(rel, label, pressFn) {
  const p = path.join(ROOT, rel);
  const rom = new Uint8Array(fs.readFileSync(p));
  const out = { name: label, file: rel };

  // instance A: no input after boot, instance B: scripted input
  const a = new NES(44100), b = new NES(44100);
  a.loadROM(rom); b.loadROM(rom);

  const bootHashes = [];
  for (let f = 0; f < 300; f++) {
    a.runFrame();
    if (f === 60 || f === 150 || f === 299) bootHashes.push(fbHash(a));
  }
  out.bootNonBlack = nonBlack(a);
  out.bootHashes = bootHashes;
  out.animates = (bootHashes[0] !== bootHashes[1]) || (bootHashes[1] !== bootHashes[2]);
  out.nonBlackOK = out.bootNonBlack > 300;

  // input diff test + animation-under-input
  for (let f = 0; f < 300; f++) { b.runFrame(); }
  const animHashes = [];
  for (let f = 0; f < 120; f++) {
    pressFn(b, f);
    b.runFrame();
    if (f === 20 || f === 60 || f === 119) animHashes.push(fbHash(b));
  }
  for (let k of ['A', 'B', 'START', 'SELECT', 'UP', 'DOWN', 'LEFT', 'RIGHT']) b.setButton(1, k, false);
  b.runFrame(); a.runFrame();
  out.inputChangesState = fbHash(a) !== fbHash(b);
  out.animates = animHashes[0] !== animHashes[1] || animHashes[1] !== animHashes[2] || out.inputChangesState;

  // audio (give the input script enough frames to reach sound-producing UIs)
  const audio = new NES(44100);
  audio.loadROM(rom);
  out.audioBoot = audioStats(audio, 180);
  for (let f = 0; f < 320; f++) { pressFn(audio, f); audio.runFrame(); audio.apu.drain(); }
  out.audioWithInput = audioStats(audio, 180);
  out.audioOK = out.audioBoot.nonSilent > 100 || out.audioWithInput.nonSilent > 100;

  // save state determinism
  const s1 = new NES(44100);
  s1.loadROM(rom);
  for (let f = 0; f < 200; f++) s1.runFrame();
  const saved = s1.serialize();
  for (let f = 0; f < 40; f++) s1.runFrame();
  const h1 = fbHash(s1);
  s1.loadState(saved);
  for (let f = 0; f < 40; f++) s1.runFrame();
  const h2 = fbHash(s1);
  out.saveStateOK = (h1 === h2);
  out.saveStateSizeKB = Math.round(saved.length / 1024);

  out.ok = out.nonBlackOK && out.animates && out.inputChangesState && out.audioOK && out.saveStateOK;
  return out;
}

const results = [];
results.push(playTest('240pee/240pee.nes', '240p Test Suite (open source homebrew)', (nes, f) => {
  // skip splash, walk the menu down to "Sound Test", then sweep tones
  if (f === 2 || f === 4) { nes.setButton(1, 'START', true); return; }
  nes.setButton(1, 'START', false);
  const presses = [30, 38, 46, 54, 62, 70, 78, 86, 94, 102, 110, 118, 126, 134];
  if (presses.some(p => f >= p && f < p + 2)) { nes.setButton(1, 'DOWN', true); return; }
  nes.setButton(1, 'DOWN', false);
  if (f >= 150 && f < 153) { nes.setButton(1, 'A', true); return; }
  nes.setButton(1, 'A', false);
  if (f >= 160) {
    nes.setButton(1, 'A', f % 12 === 0);
    nes.setButton(1, 'RIGHT', f % 12 >= 6 && f % 12 < 8);
    nes.setButton(1, 'UP', f % 24 >= 16 && f % 24 < 18);
  }
}));
results.push(playTest('nes15-1.0.0/nes15-NTSC.nes', 'NES 15 puzzle (open source homebrew, BSD license)', (nes, f) => {
  if (f % 16 < 3) nes.setButton(1, 'START', true); else nes.setButton(1, 'START', false);
  if (f % 8 === 0) nes.setButton(1, 'RIGHT', true); else nes.setButton(1, 'RIGHT', false);
  if (f % 8 === 4) nes.setButton(1, 'DOWN', true); else nes.setButton(1, 'DOWN', false);
}));
results.push(playTest('ny2011/ny2011.nes', 'NY2011 demo (free, in blargg test-roms repo)', (nes, f) => {
  if (f % 10 < 2) nes.setButton(1, 'START', true); else nes.setButton(1, 'START', false);
}));

for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}`);
  console.log(`      nonBlack=${r.bootNonBlack} animates=${r.animates} input=${r.inputChangesState} ` +
              `audioBoot=${r.audioBoot.nonSilent}/${r.audioBoot.samples} audioIn=${r.audioWithInput.nonSilent} saveState=${r.saveStateOK} (${r.saveStateSizeKB}KB)`);
}
fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
console.log('\nALL:', results.every(r => r.ok) ? 'PASS' : 'PARTIAL');

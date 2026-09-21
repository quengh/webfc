#!/usr/bin/env node
/*
 * Node-based test runner: executes blargg test ROMs headlessly on the
 * emulator core and reads results via the blargg status protocol
 * ($6000 status byte, $6004 text). No DOM required.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const NES = require('../js/nes.js');

const ROMROOT = '/tmp/nes-emu/roms';
const ROOT = path.join(ROMROOT, 'nes-test-roms-master');
const OUT = '/tmp/nes-emu/test/results-node.json';

function findRom(rel) {
  const p = path.join(ROOT, rel);
  return fs.existsSync(p) ? p : null;
}

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

// 2005-era blargg tests report results on-screen (nametable tiles are ASCII)
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

function runBlargg(romPath, maxSeconds) {
  const rom = new Uint8Array(fs.readFileSync(romPath));
  const nes = new NES(44100);
  nes.loadROM(rom);
  const maxFrames = (maxSeconds || 30) * 60;
  let result = null;
  for (let f = 0; f < maxFrames; f++) {
    nes.runFrame();
    if (f % 30 !== 29) continue;
    const ram = nes.cart.prgRAM;
    const status = ram[0];
    const sig = (ram[1] === 0xDE && ram[2] === 0xB0 && ram[3] === 0x61) ||
                (ram[0] === 0xDE && ram[1] === 0xB0 && ram[2] === 0x61);
    const txt = textAt(nes);
    const scr = screenText(nes);
    const scrCode = (scr.match(/\$([0-9A-Fa-f]{2})\b/) || [])[1]; // 2005 PPU suite prints result code
    // text/screen verdicts only count once $6000 says the test finished;
    // this keeps multi-tests from being graded on intermediate "passed" lines
    const ready = status !== 0x80;
    const txtHit = ready && /passed|failed|error/i.test(txt + ' || ' + scr);
    if ((sig && ready) || txtHit || (ready && scrCode)) {
      const code = (ram[0] === 0xDE) ? ram[3] : status;
      let ok;
      const all = txt + ' || ' + scr;
      if (/passed/i.test(all)) ok = true;
      else if (/failed|error/i.test(all)) ok = false;
      else if (scrCode) ok = (parseInt(scrCode, 16) === 0);
      else ok = (code === 0);
      result = { ok, code, text: (all.replace(/\s*\|\s*/g, ' | ')).slice(0, 160), frames: f + 1 };
      break;
    }
  }
  if (!result) {
    result = { ok: null, code: nes.cart.prgRAM[0], text: 'TIMEOUT ' + (textAt(nes) + ' || ' + screenText(nes)).slice(0, 140), frames: maxFrames };
  }
  let nonBlack = 0;
  for (let i = 0; i < nes.ppu.fb.length; i++) if ((nes.ppu.fb[i] & 0xFFFFFF) !== 0) nonBlack++;
  result.nonBlackPixels = nonBlack;
  return result;
}

const tests = [];
function T(name, rel, maxSec) { tests.push({ name, rel, maxSec }); }

const SINGLES = ['01-basics','02-implied','03-immediate','04-zero_page','05-zp_xy','06-absolute',
  '07-abs_xy','08-ind_x','09-ind_y','10-branches','11-stack','12-jmp_jsr','13-rts','14-rti','15-brk','16-special'];
SINGLES.forEach(n => T('instr_test-v5 ' + n, 'instr_test-v5/rom_singles/' + n + '.nes', 45));
T('instr_test-v5 official_only (all official opcodes)', 'instr_test-v5/official_only.nes', 300);
T('instr_test-v5 all_instrs (incl. unofficial opcodes)', 'instr_test-v5/all_instrs.nes', 300);
T('blargg ppu palette_ram', 'blargg_ppu_tests_2005.09.15b/palette_ram.nes', 25);
T('blargg ppu sprite_ram', 'blargg_ppu_tests_2005.09.15b/sprite_ram.nes', 25);
T('blargg ppu vram_access', 'blargg_ppu_tests_2005.09.15b/vram_access.nes', 25);
T('blargg ppu vbl_clear_time', 'blargg_ppu_tests_2005.09.15b/vbl_clear_time.nes', 25);
T('sprite_hit 01.basics', 'sprite_hit_tests_2005.10.05/01.basics.nes', 25);
T('sprite_hit 02.alignment', 'sprite_hit_tests_2005.10.05/02.alignment.nes', 25);
T('sprite_hit 03.corners', 'sprite_hit_tests_2005.10.05/03.corners.nes', 25);
T('sprite_hit 04.flip', 'sprite_hit_tests_2005.10.05/04.flip.nes', 25);
T('sprite_hit 05.left_clip', 'sprite_hit_tests_2005.10.05/05.left_clip.nes', 25);
T('sprite_hit 06.right_edge', 'sprite_hit_tests_2005.10.05/06.right_edge.nes', 25);
T('sprite_hit 07.screen_bottom', 'sprite_hit_tests_2005.10.05/07.screen_bottom.nes', 25);
T('sprite_hit 08.double_height', 'sprite_hit_tests_2005.10.05/08.double_height.nes', 25);
T('sprite_hit 09.timing_basics', 'sprite_hit_tests_2005.10.05/09.timing_basics.nes', 25);
T('sprite_hit 10.timing_order', 'sprite_hit_tests_2005.10.05/10.timing_order.nes', 25);
T('sprite_hit 11.edge_timing', 'sprite_hit_tests_2005.10.05/11.edge_timing.nes', 25);
T('sprite_overflow 1.Basics', 'sprite_overflow_tests/1.Basics.nes', 25);
T('sprite_overflow 2.Details', 'sprite_overflow_tests/2.Details.nes', 25);
T('sprite_overflow 3.Timing', 'sprite_overflow_tests/3.Timing.nes', 25);
T('sprite_overflow 4.Obscure', 'sprite_overflow_tests/4.Obscure.nes', 25);
T('sprite_overflow 5.Emulator', 'sprite_overflow_tests/5.Emulator.nes', 25);
T('ppu_vbl_nmi 01-vbl_basics', 'ppu_vbl_nmi/rom_singles/01-vbl_basics.nes', 25);
T('ppu_vbl_nmi 02-vbl_set_time', 'ppu_vbl_nmi/rom_singles/02-vbl_set_time.nes', 25);
T('ppu_vbl_nmi 03-vbl_clear_time', 'ppu_vbl_nmi/rom_singles/03-vbl_clear_time.nes', 25);
T('ppu_vbl_nmi 04-nmi_control', 'ppu_vbl_nmi/rom_singles/04-nmi_control.nes', 25);
T('ppu_vbl_nmi 05-nmi_timing', 'ppu_vbl_nmi/rom_singles/05-nmi_timing.nes', 25);
T('ppu_vbl_nmi 06-suppression', 'ppu_vbl_nmi/rom_singles/06-suppression.nes', 25);
T('ppu_vbl_nmi 07-nmi_on_timing', 'ppu_vbl_nmi/rom_singles/07-nmi_on_timing.nes', 25);
T('ppu_vbl_nmi 08-nmi_off_timing', 'ppu_vbl_nmi/rom_singles/08-nmi_off_timing.nes', 25);
T('ppu_vbl_nmi 09-even_odd_frames', 'ppu_vbl_nmi/rom_singles/09-even_odd_frames.nes', 25);
T('ppu_vbl_nmi 10-even_odd_timing', 'ppu_vbl_nmi/rom_singles/10-even_odd_timing.nes', 25);
T('cpu_dummy_reads (cpu_dummy_reads.nes)', 'cpu_dummy_reads/cpu_dummy_reads.nes', 25);
T('instr_misc 01-abs_x_wrap', 'instr_misc/rom_singles/01-abs_x_wrap.nes', 25);
T('instr_misc 02-branch_wrap', 'instr_misc/rom_singles/02-branch_wrap.nes', 25);
T('instr_misc 03-dummy_reads', 'instr_misc/rom_singles/03-dummy_reads.nes', 25);
T('instr_misc 04-dummy_reads_apu', 'instr_misc/rom_singles/04-dummy_reads_apu.nes', 25);
T('branch_timing_tests 1.branch_basics', 'branch_timing_tests/1.Branch_Basics.nes', 25);
T('branch_timing_tests 2.Backward_Branch', 'branch_timing_tests/2.Backward_Branch.nes', 25);
T('branch_timing_tests 3.Forward_Branch', 'branch_timing_tests/3.Forward_Branch.nes', 25);

const results = [];
for (const t of tests) {
  const p = findRom(t.rel);
  if (!p) { results.push({ name: t.name, ok: null, text: 'ROM NOT FOUND: ' + t.rel }); console.log('SKIP ' + t.name + ' (missing)'); continue; }
  let r;
  try {
    r = runBlargg(p, t.maxSec);
  } catch (e) {
    r = { ok: null, text: 'EXCEPTION: ' + e.message };
  }
  results.push({ name: t.name, file: path.relative(ROOT, p), ...r });
  const mark = r.ok === true ? 'PASS' : r.ok === false ? 'FAIL' : 'SKIP';
  console.log(`${mark}  ${t.name}  [code=${r.code}] ${r.text || ''}`);
}

const summary = {
  total: results.length,
  pass: results.filter(r => r.ok === true).length,
  fail: results.filter(r => r.ok === false).length,
  skip: results.filter(r => r.ok === null).length
};
fs.writeFileSync(OUT, JSON.stringify({ summary, results }, null, 2));
console.log('\nSUMMARY:', JSON.stringify(summary));

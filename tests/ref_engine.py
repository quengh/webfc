#!/usr/bin/env python3
"""Independent reference implementation of the 240pee text engine.
Composes text with real font/width tables, applies the blit transform and
flush order as disassembled, and compares to the emulator's CHR dump.
"""
import json, sys

rom = open('/tmp/nes-emu/roms/240pee.nes', 'rb').read()
prg = rom[16:16 + 0x10000]
chr_emu = open('/tmp/nes-emu/test/dbg-240pee-chr.bin', 'rb').read()

FONT = 0xEF00
WIDTHS = 0xF220

def font_rows(ch):
    a = FONT + (ch - 0x20) * 8
    return [prg[a + i] for i in range(8)]

def width(ch):
    return prg[WIDTHS + ch]

# (char, pen) blits captured from the engine (ground-truth input)
blit_log = json.load(open('/tmp/nes-emu/test/blitpairs.json'))

# compose: buffer[8*(pen>>3) + row] |= shifted glyph rows (verified semantics)
def compose(pairs):
    buf = bytearray(128)
    for ch, pen in pairs:
        s = pen & 7
        blk = pen & 0xF8
        for r in range(8):
            row = font_rows(ch)[r]
            if s == 0:
                buf[blk + r] |= row
            else:
                # rotate-left (8-s) through 9-bit (C=0), then split
                k = 8 - s
                val = row
                carry = 0
                for _ in range(k):
                    newcarry = (val >> 7) & 1
                    val = ((val << 1) | carry) & 0xFF
                    carry = newcarry
                # ROL once more with carry-in = CK (bit lost from chain)
                rot = ((val << 1) | carry) & 0xFF
                mask_low = (1 << k) - 1
                mask_high = (~mask_low) & 0xFF
                # hi byte: rot & mask_high ; lo byte: rot & mask_low -> to blk, hi -> blk+8
                buf[blk + r] |= rot & mask_low
                buf[blk + 8 + r] |= rot & mask_high
    return buf

# flush order (from disassembly): sources per 32-byte row-block:
FLUSH_GROUPS = [0, 2, 1, 3]  # $0100-07, $0110-17, $0108-0f, $0118-1f ...

def flush(buf):
    out = bytearray()
    for g in FLUSH_GROUPS:
        out += buf[g * 8:g * 8 + 8]
    return bytes(out)

buf = compose(blit_log)
line = flush(buf)

# The flushed 32 bytes should appear in CHR at some $500+ row; find best match.
best = None
for off in range(0x4c0, 0xc00):
    seg = chr_emu[off:off + 32]
    diff = sum(1 for a, b in zip(seg, line) if a != b)
    if best is None or diff < best[1]:
        best = (off, diff)
print('flush row vs CHR best match: offset $%03x  diff bytes = %d/32' % best)
print('reference:', line[:32].hex(' '))
print('emu      :', chr_emu[best[0]:best[0] + 32].hex(' '))

# Also render reference row as pixels (two planes)
def show_tilerow(data):
    for y in range(8):
        s = ''
        for g in range(4):
            p1, p2 = data[g * 8 + y], data[g * 8 + y + 8] if g < 2 else 0, 0
        # simpler: pair (group0,group2) and (group1,group3)
        for (ga, gb) in [(0, 2), (1, 3)]:
            p1 = data[ga * 8 + y]
            p2 = data[gb * 8 + y]
            for x in range(8):
                v = ((p1 >> (7 - x)) & 1) | (((p2 >> (7 - x)) & 1) << 1)
                s += ' .#@'[v]
        print('   |' + s + '|')
show_tilerow(line)

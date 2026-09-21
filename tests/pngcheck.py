#!/usr/bin/env python3
"""PNG pixel checker for headless Chrome screenshots.

Verifies: screenshot is non-black (game + CRT rendering), and two screenshots
taken at different frame budgets differ (animation is running).
Also reports mean luminance and unique-color count.
"""
import sys, zlib, struct

def decode_png(path):
    with open(path, 'rb') as f:
        data = f.read()
    assert data[:8] == b'\x89PNG\r\n\x1a\n', 'not a PNG'
    pos = 8
    idat = b''
    w = h = bitdepth = ctype = None
    while pos < len(data):
        length = struct.unpack('>I', data[pos:pos + 4])[0]
        tag = data[pos + 4:pos + 8]
        chunk = data[pos + 8:pos + 8 + length]
        if tag == b'IHDR':
            w, h, bitdepth, ctype = struct.unpack('>IIBB', chunk[:10])
        elif tag == b'IDAT':
            idat += chunk
        elif tag == b'IEND':
            break
        pos += 12 + length
    raw = zlib.decompress(idat)
    channels = {0: 1, 2: 3, 4: 2, 6: 4}[ctype]
    assert bitdepth == 8, 'only 8-bit supported'
    stride = w * channels
    out = bytearray(w * h * channels)
    prev = bytearray(stride)
    p = 0
    for y in range(h):
        f = raw[p]; p += 1
        line = bytearray(raw[p:p + stride]); p += stride
        if f == 1:
            for i in range(channels, stride):
                line[i] = (line[i] + line[i - channels]) & 0xFF
        elif f == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 0xFF
        elif f == 3:
            for i in range(stride):
                a = line[i - channels] if i >= channels else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 0xFF
        elif f == 4:
            for i in range(stride):
                a = line[i - channels] if i >= channels else 0
                b = prev[i]
                c = prev[i - channels] if i >= channels else 0
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 0xFF
        out[y * stride:(y + 1) * stride] = line
        prev = line
    return w, h, channels, bytes(out)

def stats(path):
    w, h, ch, px = decode_png(path)
    total = w * h
    lum_sum = 0
    nonblack = 0
    colors = set()
    for i in range(0, total, 7):  # sample every 7th pixel
        o = i * ch
        r, g, b = px[o], px[o + 1], px[o + 2]
        lum_sum += (r + g + b)
        if r | g | b:
            nonblack += 1
        colors.add((r >> 3, g >> 3, b >> 3))
    sampled = len(range(0, total, 7))
    return {
        'size': (w, h),
        'meanLum': round(lum_sum / (sampled * 3), 1),
        'nonBlackPct': round(100.0 * nonblack / sampled, 1),
        'uniqueColors': len(colors),
    }

def main():
    a, b, label = sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else 'shot'
    sa, sb = stats(a), stats(b)
    import hashlib
    ha = hashlib.md5(open(a, 'rb').read()).hexdigest()
    hb = hashlib.md5(open(b, 'rb').read()).hexdigest()
    differ = ha != hb
    ok = sa['nonBlackPct'] > 5 and sb['nonBlackPct'] > 5 and differ and sa['uniqueColors'] > 20
    print(('PASS' if ok else 'FAIL') + f"  [screenshot] {label}")
    print(f"      A: {sa}")
    print(f"      B: {sb}")
    print(f"      frames differ (animation): {differ}")
    if not ok:
        print(f"      md5 A={ha} B={hb}")
    sys.exit(0 if ok else 1)

if __name__ == '__main__':
    main()

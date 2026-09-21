#!/bin/bash
# Chrome headless test runner for WebFC.
# 1) harness.html runs ROMs headlessly and emits JSON results (incl. console error count)
# 2) real index.html is screenshotted twice (different frame budgets) -> PNG pixel check:
#    non-black + frames differ (animation) + CRT filter actually rendering
set -u
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
BASE="http://127.0.0.1:8848"
OUT=/tmp/nes-emu/test
PASS=0; FAIL=0

run_harness() {
  local rom="$1" label="$2" frames="${3:-240}"
  local url="$BASE/test/harness.html?rom=$(python3 - "$rom" "$frames" <<'EOF'
import sys, urllib.parse
print(urllib.parse.quote(sys.argv[1]) + "&frames=" + sys.argv[2])
EOF
)"
  "$CHROME" --headless=new --disable-gpu --enable-unsafe-swiftshader --hide-scrollbars \
    --window-size=900,900 --virtual-time-budget=30000 --dump-dom "$url" 2>"$OUT/chrome-console-$label.log" \
    | python3 -c "
import sys, re, json
html = sys.stdin.read()
m = re.search(r'<pre id=\"results\">(.*?)</pre>', html, re.S)
if not m:
    print(json.dumps({'ok': False, 'error': 'no results element'}))
    sys.exit(0)
raw = m.group(1)
import html as h
print(h.unescape(raw))
" > "$OUT/harness-$label.json"
  python3 - "$OUT/harness-$label.json" "$label" <<'EOF'
import json, sys
data = json.load(open(sys.argv[1]))
ok = data.get('ok', False)
errs = data.get('consoleErrors', [])
print(('PASS' if ok else 'FAIL') + '  [harness] ' + sys.argv[2])
for t in data.get('tests', []):
    print('      ' + t.get('name','?') + ': ok=' + str(t.get('ok')) + ' nonBlack=' + str(t.get('nonBlackPixels','-')) +
          ' animates=' + str(t.get('animates','-')) + ' input=' + str(t.get('inputChangesState','-')) +
          ' saveState=' + str(t.get('saveStateOK','-')) + (' crtPixels=' + str(t.get('pixelsNonBlack','-')) if 'pixelsNonBlack' in t else ''))
if errs:
    print('      consoleErrors: ' + json.dumps(errs)[:300])
if data.get('exception'):
    print('      exception: ' + str(data['exception'])[:300])
sys.exit(0 if ok else 1)
EOF
  return $?
}

screenshot_test() {
  local romfile="$1" label="$2" run1="$3" run2="$4"
  "$CHROME" --headless=new --disable-gpu --enable-unsafe-swiftshader --hide-scrollbars \
    --window-size=1100,1000 --virtual-time-budget=20000 \
    --screenshot="$OUT/shot-$label-a.png" "$BASE/index.html?rom=$romfile&run=$run1" 2>/dev/null
  "$CHROME" --headless=new --disable-gpu --enable-unsafe-swiftshader --hide-scrollbars \
    --window-size=1100,1000 --virtual-time-budget=20000 \
    --screenshot="$OUT/shot-$label-b.png" "$BASE/index.html?rom=$romfile&run=$run2" 2>/dev/null
  python3 "$OUT/pngcheck.py" "$OUT/shot-$label-a.png" "$OUT/shot-$label-b.png" "$label"
  return $?
}

echo "=== harness tests (Chrome headless) ==="
for spec in "../roms/nes-test-roms-master/240pee/240pee.nes|240p-test-suite" \
            "../roms/nes-test-roms-master/nes15-1.0.0/nes15-NTSC.nes|nes15" \
            "../roms/nes-test-roms-master/sprite_hit_tests_2005.10.05/01.basics.nes|blargg-spritehit"; do
  rom="${spec%%|*}"; label="${spec##*|}"
  if run_harness "$rom" "$label" 240; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); fi
done

echo "=== screenshot / CRT render tests ==="
if screenshot_test "240pee.nes" "240p" 120 480; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); fi
if screenshot_test "nes15-NTSC.nes" "nes15" 120 480; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); fi

echo "=== summary ==="
echo "PASS=$PASS FAIL=$FAIL"

/* WebFC front-end: input, audio, rendering, CRT filter, save states. */
(function () {
  'use strict';

  var nes = new NES(44100);
  var fbCanvas = document.getElementById('fb');
  var fbCtx = fbCanvas.getContext('2d');
  var img = fbCtx.createImageData(256, 240);
  var img32 = new Uint32Array(img.data.buffer);

  var screen = document.getElementById('screen');
  var crt = null;
  try { crt = new CRTFilter(screen); }
  catch (e) {
    console.warn('WebGL CRT filter unavailable, falling back to 2D upscale:', e.message);
  }
  if (!crt) {
    screen.getContext && (screen = screen); // 2D fallback below
    var fb2d = screen.getContext('2d');
    fb2d && (fb2d.imageSmoothingEnabled = false);
  }

  var running = false, romLoaded = false, romName = '';
  var frameSkip = 0;

  // ---------- audio ----------
  var audioCtx = null, audioNode = null;
  var audioQueue = [];
  var volume = 0.55, muted = false;
  function initAudio() {
    if (audioCtx) return;
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      nes.apu.sampleRate = audioCtx.sampleRate;
      audioNode = audioCtx.createScriptProcessor(2048, 0, 1);
      audioNode.onaudioprocess = function (ev) {
        var out = ev.outputBuffer.getChannelData(0);
        for (var i = 0; i < out.length; i++) {
          var s = audioQueue.length ? audioQueue.shift() : 0;
          out[i] = (muted ? 0 : s * volume * 1.4);
        }
      };
      audioNode.connect(audioCtx.destination);
    } catch (e) { console.warn('audio init failed', e); }
  }
  function unlockAudio() {
    initAudio();
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  }
  document.addEventListener('pointerdown', unlockAudio, { once: false });
  document.addEventListener('keydown', unlockAudio, { once: false });

  // ---------- input ----------
  var KEYMAP = {
    ArrowUp: 'UP', ArrowDown: 'DOWN', ArrowLeft: 'LEFT', ArrowRight: 'RIGHT',
    KeyW: 'UP', KeyS: 'DOWN', KeyA: 'LEFT', KeyD: 'RIGHT',
    KeyK: 'A', KeyJ: 'B', Enter: 'START', ShiftRight: 'SELECT'
  };
  // U/I = 连发 B/A（按住以约 12Hz 自动连打）
  var TURBOMAP = { KeyU: 'B', KeyI: 'A' };
  var turboHeld = { A: false, B: false };
  document.addEventListener('keydown', function (e) {
    var t = TURBOMAP[e.code];
    if (t) { turboHeld[t] = true; e.preventDefault(); return; }
    var b = KEYMAP[e.code];
    if (b) { nes.setButton(1, b, true); e.preventDefault(); }
  });
  document.addEventListener('keyup', function (e) {
    var t = TURBOMAP[e.code];
    if (t) { turboHeld[t] = false; nes.setButton(1, t, false); e.preventDefault(); return; }
    var b = KEYMAP[e.code];
    if (b) { nes.setButton(1, b, false); e.preventDefault(); }
  });
  setInterval(function () {
    if (!nes) return;
    var on = ((Date.now() / 40) | 0) % 2 === 0;
    if (turboHeld.B) nes.setButton(1, 'B', on);
    if (turboHeld.A) nes.setButton(1, 'A', on);
  }, 40);

  function pollGamepad() {
    if (!navigator.getGamepads) return;
    var pads = navigator.getGamepads();
    for (var i = 0; i < pads.length; i++) {
      var p = pads[i];
      if (!p) continue;
      var map = { UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15, A: 1, B: 0, START: 9, SELECT: 8 };
      for (var name in map) {
        var btn = p.buttons[map[name]];
        var pressed = btn && (btn.pressed || btn.value > 0.5);
        if (!pressed && p.axes && p.axes.length >= 2) {
          if (name === 'LEFT') pressed = p.axes[0] < -0.5;
          if (name === 'RIGHT') pressed = p.axes[0] > 0.5;
          if (name === 'UP') pressed = p.axes[1] < -0.5;
          if (name === 'DOWN') pressed = p.axes[1] > 0.5;
        }
        nes.setButton(1, name, !!pressed);
      }
      break; // only pad 1
    }
  }

  // virtual touch pad
  var touchPad = document.getElementById('touch-pad');
  if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
    touchPad.classList.remove('hidden');
  }
  Array.prototype.forEach.call(touchPad.querySelectorAll('button'), function (btn) {
    var name = btn.getAttribute('data-btn');
    var on = function (e) { e.preventDefault(); nes.setButton(1, name, true); };
    var off = function (e) { e.preventDefault(); nes.setButton(1, name, false); };
    btn.addEventListener('touchstart', on); btn.addEventListener('touchend', off);
    btn.addEventListener('touchcancel', off);
    btn.addEventListener('mousedown', on); btn.addEventListener('mouseup', off);
    btn.addEventListener('mouseleave', off);
  });

  // ---------- ROM loading ----------
  function hashName(s) {
    var h = 0;
    for (var i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return 'webfc-state-' + (h >>> 0).toString(16);
  }
  var stateKey = 'webfc-state-default';

  function loadROM(bytes, name) {
    try {
      var info = nes.loadROM(bytes);
    } catch (e) {
      alert('ROM 加载失败: ' + e.message);
      return;
    }
    romName = name || 'rom';
    stateKey = hashName(romName);
    romLoaded = true;
    running = true;
    document.getElementById('rom-name').textContent = romName;
    document.getElementById('mapper-info').textContent =
      'Mapper ' + info.mapper + ' · PRG ' + info.prgKB + 'KB · CHR ' + info.chrKB + 'KB' +
      (info.chrRAM ? '(RAM)' : '') + (info.mirroring === 1 ? ' · 垂直镜像' : ' · 水平镜像');
    document.getElementById('screen-wrap').classList.add('has-rom');
    document.getElementById('btn-pause').textContent = '暂停';
    // deterministic hook for headless tests: ?run=N runs N frames synchronously
    var qs = new URLSearchParams(location.search);
    var runN = parseInt(qs.get('run') || '0', 10);
    if (runN > 0) {
      running = false;
      // test hook: ?keys=BTN@start:len,BTN@start:len injects timed pad-1 presses
      var kscript = [];
      (qs.get('keys') || '').split(',').forEach(function (s) {
        var m = /^([A-Z]+)@(\d+):(\d+)$/.exec(s.trim());
        if (m) kscript.push({ btn: m[1], start: +m[2], len: +m[3] });
      });
      for (var i = 0; i < runN; i++) {
        var st = {};
        for (var ki = 0; ki < kscript.length; ki++) {
          var ks = kscript[ki];
          st[ks.btn] = !!st[ks.btn] || (i >= ks.start && i < ks.start + ks.len);
        }
        for (var kb in st) nes.setButton(1, kb, st[kb]);
        stepFrame();
      }
      draw();
    }
  }

  function handleFiles(files) {
    if (!files || !files.length) return;
    var f = files[0];
    var reader = new FileReader();
    reader.onload = function () {
      loadROM(new Uint8Array(reader.result), f.name.replace(/\.nes$/i, ''));
    };
    reader.readAsArrayBuffer(f);
  }

  document.getElementById('file-input').addEventListener('change', function (e) {
    handleFiles(e.target.files);
  });
  var wrap = document.getElementById('screen-wrap');
  ['dragenter', 'dragover'].forEach(function (ev) {
    wrap.addEventListener(ev, function (e) { e.preventDefault(); wrap.classList.add('dragover'); });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    wrap.addEventListener(ev, function (e) { e.preventDefault(); wrap.classList.remove('dragover'); });
  });
  wrap.addEventListener('drop', function (e) {
    if (e.dataTransfer && e.dataTransfer.files) handleFiles(e.dataTransfer.files);
  });

  // ROM lists: roms/index.json (bundled free ROMs) and optional roms/local.json
  // (user-supplied local ROMs, gitignored / never distributed)
  var auto = new URLSearchParams(location.search).get('rom');
  function addRomItem(ul, item) {
    var li = document.createElement('li');
    li.innerHTML = item.name + ' <span class="tag">' + item.tag + '</span>';
    li.title = item.license || '';
    li.addEventListener('click', function () {
      fetch('roms/' + item.file).then(function (r) { return r.arrayBuffer(); })
        .then(function (buf) { loadROM(new Uint8Array(buf), item.name); });
    });
    ul.appendChild(li);
    if (auto && item.file === auto) {
      fetch('roms/' + item.file).then(function (r) { return r.arrayBuffer(); })
        .then(function (buf) { loadROM(new Uint8Array(buf), item.name); });
    }
  }
  fetch('roms/index.json').then(function (r) { return r.json(); }).then(function (list) {
    var ul = document.getElementById('rom-list');
    list.forEach(function (item) { addRomItem(ul, item); });
  }).catch(function () {});
  fetch('roms/local.json').then(function (r) {
    if (!r.ok) throw new Error('no local.json');
    return r.json();
  }).then(function (list) {
    if (!list || !list.length) return;
    document.getElementById('local-roms').classList.remove('hidden');
    var ul = document.getElementById('local-rom-list');
    list.forEach(function (item) { addRomItem(ul, item); });
  }).catch(function () {});

  // test hook: ?romfile=<file in roms/> loads it directly (not shown in the built-in list)
  (function () {
    var rf = new URLSearchParams(location.search).get('romfile');
    if (!rf) return;
    fetch('roms/' + rf).then(function (r) { return r.arrayBuffer(); })
      .then(function (buf) { loadROM(new Uint8Array(buf), rf.replace(/\.nes$/i, '')); });
  })();

  // ---------- controls ----------
  var btnPause = document.getElementById('btn-pause');
  btnPause.addEventListener('click', function () {
    running = !running;
    btnPause.textContent = running ? '暂停' : '继续';
  });
  // proper reset: reload current ROM bytes
  var lastROMBytes = null;
  var origLoad = loadROM;
  loadROM = function (bytes, name) { lastROMBytes = bytes; origLoad(bytes, name); };
  document.getElementById('btn-reset').addEventListener('click', function () {
    if (romLoaded && lastROMBytes) { nes.loadROM(lastROMBytes); running = true; }
  });
  document.getElementById('btn-frame').addEventListener('click', function () {
    if (romLoaded) stepFrame();
  });
  document.getElementById('btn-save-state').addEventListener('click', function () {
    if (!romLoaded) return;
    try {
      localStorage.setItem(stateKey, nes.serialize());
      flash('状态已保存到 localStorage');
    } catch (e) { flash('保存失败: ' + e.message); }
  });
  document.getElementById('btn-load-state').addEventListener('click', function () {
    if (!romLoaded) return;
    var s = localStorage.getItem(stateKey);
    if (!s) { flash('没有已保存的状态'); return; }
    try { nes.loadState(s); flash('状态已恢复'); } catch (e) { flash('读取失败: ' + e.message); }
  });
  function flash(msg) {
    var el = document.getElementById('rom-name');
    var old = el.textContent;
    el.textContent = msg;
    setTimeout(function () { el.textContent = romName || old; }, 1500);
  }

  // ---------- CRT option bindings ----------
  var opts = { intensity: 1.0, scanline: 0.85, grille: 0.55, glow: 0.7, noise: 0.06, curvature: 1.0, flicker: 1.0 };
  var crtEnabled = true;
  document.getElementById('chk-crt').addEventListener('change', function (e) {
    crtEnabled = e.target.checked;
  });
  function effOpts() {
    var o = {};
    for (var k in opts) o[k] = opts[k];
    if (!crtEnabled) o.intensity = 0;
    return o;
  }
  function bindRange(id, key, scale) {
    var el = document.getElementById(id);
    el.addEventListener('input', function () {
      opts[key] = (el.value / 100) * (scale || 1);
    });
  }
  bindRange('rng-intensity', 'intensity', 1);
  bindRange('rng-scanline', 'scanline', 1);
  bindRange('rng-grille', 'grille', 1);
  bindRange('rng-glow', 'glow', 1);
  bindRange('rng-noise', 'noise', 1);
  bindRange('rng-curv', 'curvature', 1);

  var btnHd = document.getElementById('btn-mode-hd');
  var btnCrt = document.getElementById('btn-mode-crt');
  btnHd.addEventListener('click', function () {
    opts.intensity = 0;
    document.getElementById('rng-intensity').value = 0;
    btnHd.classList.add('active'); btnCrt.classList.remove('active');
  });
  btnCrt.addEventListener('click', function () {
    opts.intensity = document.getElementById('rng-intensity').value / 100 || 1;
    document.getElementById('rng-intensity').value = Math.round(opts.intensity * 100);
    btnCrt.classList.add('active'); btnHd.classList.remove('active');
  });

  document.getElementById('rng-volume').addEventListener('input', function (e) {
    volume = e.target.value / 100;
  });
  document.getElementById('chk-mute').addEventListener('change', function (e) {
    muted = e.target.checked;
  });

  // ---------- main loop ----------
  var fpsEl = document.getElementById('fps');
  var framesThisSecond = 0, lastFpsT = performance.now(), fpsShown = 0;
  var lastT = performance.now(), accum = 0;
  var FRAME_MS = 1000 / 60.0988; // NTSC
  var autosaveTimer = 0;

  function stepFrame() {
    nes.runFrame();
    var s = nes.apu.drain();
    if (s.length && audioQueue.length < 8192) {
      for (var i = 0; i < s.length; i++) audioQueue.push(s[i]);
    }
    // blit framebuffer
    img32.set(nes.ppu.fb);
    fbCtx.putImageData(img, 0, 0);
    framesThisSecond++;
  }

  function draw() {
    if (crt) {
      crt.upload(img.data);
      crt.render(performance.now() / 1000, effOpts());
    } else if (fb2d) {
      fb2d.imageSmoothingEnabled = false;
      fb2d.drawImage(fbCanvas, 0, 0, screen.width, screen.height);
    }
  }

  function loop(t) {
    requestAnimationFrame(loop);
    pollGamepad();
    var dt = t - lastT;
    lastT = t;
    if (dt > 100) dt = 100;
    if (running && romLoaded) {
      accum += dt;
      var steps = 0;
      while (accum >= FRAME_MS && steps < 3) {
        stepFrame();
        accum -= FRAME_MS;
        steps++;
      }
      if (steps === 3) accum = 0;
    }
    draw();

    if (t - lastFpsT >= 1000) {
      fpsShown = framesThisSecond;
      framesThisSecond = 0;
      lastFpsT = t;
      fpsEl.textContent = fpsShown + ' FPS';
    }

    if (romLoaded && document.getElementById('chk-autosave').checked) {
      autosaveTimer += dt;
      if (autosaveTimer > 5000) {
        autosaveTimer = 0;
        try { localStorage.setItem(stateKey, nes.serialize()); } catch (e) {}
      }
    }
  }
  requestAnimationFrame(loop);

  // expose for debugging / automation
  window.webfc = { nes: nes, loadROM: loadROM, opts: opts, isRunning: function(){return running && romLoaded;} };
})();

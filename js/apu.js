/*
 * 2A03 APU: 2 pulse channels (envelope, sweep, length), triangle
 * (linear counter), noise (LFSR). Frame counter 4/5-step with frame IRQ.
 * Non-linear mixer per NESdev wiki. Sample generation at the requested
 * output sample rate with simple accumulate-downsampling (good enough for
 * gameplay audio). DMC omitted (task scope: pulse x2 + triangle + noise).
 */
(function (global) {
  'use strict';

  var LENGTH_TABLE = [
    10,254,20,2,40,4,80,6,160,8,60,10,14,12,26,14,
    12,16,24,18,48,20,96,22,192,24,72,26,16,28,32,30
  ];
  var DUTY = [
    [0,1,0,0,0,0,0,0],
    [0,1,1,0,0,0,0,0],
    [0,1,1,1,1,0,0,0],
    [1,0,0,1,1,1,1,1]
  ];
  var TRI_SEQ = (function () {
    var a = [];
    for (var i = 15; i >= 0; i--) a.push(i);
    for (var j = 0; j <= 15; j++) a.push(j);
    return a;
  })();
  var NOISE_PERIODS = [4,8,16,32,64,96,128,160,202,254,380,508,762,1016,2034,4068];

  function Pulse(isPulse1) {
    this.enabled = false;
    this.duty = 0; this.seqPos = 0;
    this.timer = 0; this.timerLoad = 0;
    this.length = 0; this.lengthHalt = false;
    this.envLoop = false; this.constantVol = false; this.vol = 0;
    this.envStart = false; this.envDivider = 0; this.envDecay = 0;
    this.sweepEnabled = false; this.sweepPeriod = 0; this.sweepNegate = false;
    this.sweepShift = 0; this.sweepReload = false; this.sweepDivider = 0;
    this.isPulse1 = isPulse1;
  }
  Pulse.prototype.writeReg = function (r, v) {
    switch (r & 3) {
      case 0:
        this.duty = (v >> 6) & 3;
        this.lengthHalt = (v & 0x20) !== 0;
        this.envLoop = this.lengthHalt;
        this.constantVol = (v & 0x10) !== 0;
        this.vol = v & 0x0F;
        break;
      case 1:
        this.sweepEnabled = (v & 0x80) !== 0;
        this.sweepPeriod = (v >> 4) & 7;
        this.sweepNegate = (v & 0x08) !== 0;
        this.sweepShift = v & 7;
        this.sweepReload = true;
        break;
      case 2:
        this.timerLoad = (this.timerLoad & 0x700) | v;
        break;
      case 3:
        this.timerLoad = (this.timerLoad & 0xFF) | ((v & 7) << 8);
        if (this.enabled) this.length = LENGTH_TABLE[(v >> 3) & 0x1F];
        this.seqPos = 0;
        this.envStart = true;
        break;
    }
  };
  Pulse.prototype.sweepTarget = function () {
    var change = this.timerLoad >> this.sweepShift;
    if (this.sweepNegate) change = -change - (this.isPulse1 ? 1 : 0);
    return this.timerLoad + change;
  };
  Pulse.prototype.muted = function () {
    return this.timerLoad < 8 || this.sweepTarget() > 0x7FF;
  };
  Pulse.prototype.clockEnv = function () {
    if (this.envStart) {
      this.envStart = false;
      this.envDecay = 15;
      this.envDivider = this.vol;
    } else if (this.envDivider > 0) {
      this.envDivider--;
    } else {
      this.envDivider = this.vol;
      if (this.envDecay > 0) this.envDecay--;
      else if (this.envLoop) this.envDecay = 15;
    }
  };
  Pulse.prototype.clockSweep = function () {
    if (this.sweepDivider === 0 && this.sweepEnabled && this.sweepShift > 0 && !this.muted()) {
      this.timerLoad = this.sweepTarget() & 0x7FF;
    }
    if (this.sweepDivider === 0 || this.sweepReload) {
      this.sweepDivider = this.sweepPeriod;
      this.sweepReload = false;
    } else this.sweepDivider--;
  };
  Pulse.prototype.clockLength = function () {
    if (!this.lengthHalt && this.length > 0) this.length--;
  };
  Pulse.prototype.clockTimer = function () {
    if (this.timer === 0) {
      this.timer = this.timerLoad;
      this.seqPos = (this.seqPos + 1) & 7;
    } else this.timer--;
  };
  Pulse.prototype.output = function () {
    if (!this.enabled || this.length === 0 || this.muted()) return 0;
    if (!DUTY[this.duty][this.seqPos]) return 0;
    return this.constantVol ? this.vol : this.envDecay;
  };

  function Triangle() {
    this.enabled = false;
    this.timer = 0; this.timerLoad = 0;
    this.length = 0; this.lengthHalt = false;
    this.linReloadVal = 0; this.linReload = false; this.linCounter = 0;
    this.seqPos = 0;
  }
  Triangle.prototype.writeReg = function (r, v) {
    switch (r & 3) {
      case 0:
        this.lengthHalt = (v & 0x80) !== 0;
        this.linReloadVal = v & 0x7F;
        break;
      case 2:
        this.timerLoad = (this.timerLoad & 0x700) | v;
        break;
      case 3:
        this.timerLoad = (this.timerLoad & 0xFF) | ((v & 7) << 8);
        if (this.enabled) this.length = LENGTH_TABLE[(v >> 3) & 0x1F];
        this.linReload = true;
        break;
    }
  };
  Triangle.prototype.clockLinear = function () {
    if (this.linReload) this.linCounter = this.linReloadVal;
    else if (this.linCounter > 0) this.linCounter--;
    if (!this.lengthHalt) this.linReload = false;
  };
  Triangle.prototype.clockLength = function () {
    if (!this.lengthHalt && this.length > 0) this.length--;
  };
  Triangle.prototype.clockTimer = function () {
    if (this.timer === 0) {
      this.timer = this.timerLoad;
      if (this.length > 0 && this.linCounter > 0) this.seqPos = (this.seqPos + 1) % 32;
    } else this.timer--;
  };
  Triangle.prototype.output = function () {
    if (!this.enabled || this.length === 0 || this.linCounter === 0) return 0;
    return TRI_SEQ[this.seqPos];
  };

  function Noise() {
    this.enabled = false;
    this.length = 0; this.lengthHalt = false;
    this.constantVol = false; this.vol = 0;
    this.envStart = false; this.envDivider = 0; this.envDecay = 0;
    this.timer = 0; this.timerLoad = 0;
    this.mode = false;
    this.lfsr = 1;
  }
  Noise.prototype.writeReg = function (r, v) {
    switch (r & 3) {
      case 0:
        this.lengthHalt = (v & 0x20) !== 0;
        this.constantVol = (v & 0x10) !== 0;
        this.vol = v & 0x0F;
        break;
      case 2:
        this.mode = (v & 0x80) !== 0;
        this.timerLoad = NOISE_PERIODS[v & 0x0F];
        break;
      case 3:
        if (this.enabled) this.length = LENGTH_TABLE[(v >> 3) & 0x1F];
        this.envStart = true;
        break;
    }
  };
  Noise.prototype.clockEnv = function () {
    if (this.envStart) {
      this.envStart = false;
      this.envDecay = 15;
      this.envDivider = this.vol;
    } else if (this.envDivider > 0) this.envDivider--;
    else {
      this.envDivider = this.vol;
      if (this.envDecay > 0) this.envDecay--;
      else if (this.lengthHalt) this.envDecay = 15;
    }
  };
  Noise.prototype.clockLength = function () {
    if (!this.lengthHalt && this.length > 0) this.length--;
  };
  Noise.prototype.clockTimer = function () {
    if (this.timer === 0) {
      this.timer = this.timerLoad;
      var bit = this.lfsr & 1;
      var other = (this.lfsr >> (this.mode ? 6 : 1)) & 1;
      var fb = bit ^ other;
      this.lfsr = (this.lfsr >> 1) | (fb << 14);
    } else this.timer--;
  };
  Noise.prototype.output = function () {
    if (!this.enabled || this.length === 0 || (this.lfsr & 1)) return 0;
    return this.constantVol ? this.vol : this.envDecay;
  };

  function APU(bus, sampleRate) {
    this.bus = bus;
    this.pulse1 = new Pulse(true);
    this.pulse2 = new Pulse(false);
    this.tri = new Triangle();
    this.noise = new Noise();
    this.frameMode5 = false;
    this.irqInhibit = false;
    this.frameIRQ = false;
    this.frameCycle = 0;
    this.step = 0;
    this.cycle = 0;
    this.sampleRate = sampleRate || 44100;
    this.sampleAccum = 0;
    this.samples = [];         // pending mono float samples
    this.maxSamples = 8192;
  }

  APU.prototype.reset = function () {
    this.write(0x4015, 0);
    this.frameIRQ = false;
  };

  APU.prototype.write = function (addr, val) {
    val &= 0xFF;
    if (addr >= 0x4000 && addr <= 0x4003) this.pulse1.writeReg(addr, val);
    else if (addr >= 0x4004 && addr <= 0x4007) this.pulse2.writeReg(addr, val);
    else if (addr >= 0x4008 && addr <= 0x400B) this.tri.writeReg(addr, val);
    else if (addr >= 0x400C && addr <= 0x400F) this.noise.writeReg(addr, val);
    else if (addr === 0x4015) {
      this.pulse1.enabled = (val & 0x01) !== 0;
      this.pulse2.enabled = (val & 0x02) !== 0;
      this.tri.enabled = (val & 0x04) !== 0;
      this.noise.enabled = (val & 0x08) !== 0;
      if (!this.pulse1.enabled) this.pulse1.length = 0;
      if (!this.pulse2.enabled) this.pulse2.length = 0;
      if (!this.tri.enabled) this.tri.length = 0;
      if (!this.noise.enabled) this.noise.length = 0;
    } else if (addr === 0x4017) {
      this.frameMode5 = (val & 0x80) !== 0;
      this.irqInhibit = (val & 0x40) !== 0;
      if (this.irqInhibit) this.frameIRQ = false;
      this.frameCycle = 0;
      this.step = 0;
      if (this.frameMode5) {
        this.clockQuarter();
        this.clockHalf();
      }
    }
  };

  APU.prototype.read4015 = function () {
    var r = 0;
    if (this.pulse1.length > 0) r |= 0x01;
    if (this.pulse2.length > 0) r |= 0x02;
    if (this.tri.length > 0) r |= 0x04;
    if (this.noise.length > 0) r |= 0x08;
    if (this.frameIRQ) { r |= 0x40; this.frameIRQ = false; }
    return r;
  };

  APU.prototype.clockQuarter = function () {
    this.pulse1.clockEnv();
    this.pulse2.clockEnv();
    this.noise.clockEnv();
    this.tri.clockLinear();
  };
  APU.prototype.clockHalf = function () {
    this.pulse1.clockLength();
    this.pulse2.clockLength();
    this.tri.clockLength();
    this.noise.clockLength();
    this.pulse1.clockSweep();
    this.pulse2.clockSweep();
  };

  // advance one CPU cycle
  APU.prototype.tick = function () {
    this.cycle++;
    // frame sequencer (in CPU cycles)
    this.frameCycle++;
    var pts = this.frameMode5
      ? [7457, 14913, 22371, 37281]
      : [7457, 14913, 22371, 29829];
    var f = this.frameCycle;
    if (f === pts[0]) this.clockQuarter();
    else if (f === pts[1]) { this.clockQuarter(); this.clockHalf(); }
    else if (f === pts[2]) this.clockQuarter();
    else if (f === pts[3]) {
      if (!this.frameMode5) {
        this.clockQuarter(); this.clockHalf();
        if (!this.irqInhibit) this.frameIRQ = true;
      } else {
        this.clockQuarter(); this.clockHalf();
      }
    }
    var period = this.frameMode5 ? 37282 : 29830;
    if (this.frameCycle >= period) this.frameCycle = 0;

    // timers: triangle clocks every CPU cycle, pulse/noise every 2nd
    this.tri.clockTimer();
    if (this.cycle & 1) {
      this.pulse1.clockTimer();
      this.pulse2.clockTimer();
      this.noise.clockTimer();
    }

    // sampling
    this.sampleAccum += this.sampleRate / 1789773.0;
    if (this.sampleAccum >= 1.0) {
      this.sampleAccum -= 1.0;
      var p1 = this.pulse1.output();
      var p2 = this.pulse2.output();
      var t = this.tri.output();
      var n = this.noise.output();
      var pulseOut = (p1 + p2) === 0 ? 0 : 95.88 / (8128.0 / (p1 + p2) + 100.0);
      var tndIn = t / 8227.0 + n / 12241.0;
      var tnd = tndIn === 0 ? 0 : 159.79 / (1.0 / tndIn + 100.0);
      var s = pulseOut + tnd;
      if (this.samples.length < this.maxSamples) this.samples.push(s);
    }
  };

  APU.prototype.drain = function () {
    var s = this.samples;
    this.samples = [];
    return s;
  };

  global.APU = APU;
  if (typeof module !== 'undefined' && module.exports) module.exports = APU;
})(typeof window !== 'undefined' ? window : globalThis);

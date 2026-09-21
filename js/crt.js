/*
 * CRT WebGL post-processing filter.
 * Effects: barrel distortion (curvature), scanlines, aperture grille,
 * color bleed + phosphor glow (multi-tap bloom), vignette, film noise &
 * vertical flicker. `intensity` blends filter -> clean ("高清") output.
 */
(function (global) {
  'use strict';

  var VS = [
    'attribute vec2 aPos;',
    'varying vec2 vUV;',
    'void main(){ vUV = aPos*0.5+0.5; vUV.y = 1.0-vUV.y; gl_Position = vec4(aPos,0.0,1.0); }'
  ].join('\n');

  var FS = [
    'precision mediump float;',
    'varying vec2 vUV;',
    'uniform sampler2D uTex;',
    'uniform vec2 uRes;',
    'uniform float uTime;',
    'uniform float uIntensity;',   // 0 = clean/HD, 1 = full CRT
    'uniform float uCurvature;',
    'uniform float uScanline;',
    'uniform float uGrille;',
    'uniform float uNoise;',
    'uniform float uGlow;',
    'uniform float uFlicker;',

    'float rnd(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }',

    'vec2 curveUV(vec2 uv){',
    '  float c = uCurvature * uIntensity;',
    '  uv = uv*2.0-1.0;',
    '  vec2 off = abs(uv.yx)/vec2(5.2,4.2);',
    '  uv += uv*off*off*c;',
    '  return uv*0.5+0.5;',
    '}',

    'void main(){',
    '  vec2 uv = curveUV(vUV);',
    '  if (uv.x<0.0||uv.x>1.0||uv.y<0.0||uv.y>1.0){ gl_FragColor = vec4(0.0,0.0,0.0,1.0); return; }',
    '  vec2 px = 1.0/uRes;',
    '  float inten = uIntensity;',

    '  // color bleed: chroma smears horizontally like a shadow-mask tube',
    '  vec3 col;',
    '  vec3 cR = texture2D(uTex, uv + vec2(px.x*1.5*inten, 0.0)).rgb;',
    '  vec3 cL = texture2D(uTex, uv - vec2(px.x*1.5*inten, 0.0)).rgb;',
    '  vec3 cc = texture2D(uTex, uv).rgb;',
    '  col.r = mix(cc.r, (cc.r*2.0 + cR.r + cL.r)/4.0, inten);',
    '  col.g = mix(cc.g, (cc.g*2.0 + texture2D(uTex, uv+vec2(0.0,px.y*1.2*inten)).g + texture2D(uTex, uv-vec2(0.0,px.y*1.2*inten)).g)/4.0, inten);',
    '  col.b = mix(cc.b, (cc.b*2.0 + texture2D(uTex, uv-vec2(px.x*1.5*inten, 0.0)).b + texture2D(uTex, uv+vec2(px.x*1.5*inten, 0.0)).b)/4.0, inten);',

    '  // phosphor glow / bloom around bright pixels',
    '  vec3 bloom = vec3(0.0);',
    '  for (int i=-2;i<=2;i++){',
    '    for (int j=-2;j<=2;j++){',
    '      bloom += texture2D(uTex, uv + vec2(float(i),float(j))*px*2.2).rgb;',
    '    }',
    '  }',
    '  bloom /= 25.0;',
    '  vec3 bright = max(bloom - 0.35, 0.0);',
    '  col += bright * uGlow * inten * 1.6;',

    '  // aperture grille (RGB phosphor stripes)',
    '  float g = mod(gl_FragCoord.x, 3.0);',
    '  vec3 mask = vec3(1.0);',
    '  if (g < 1.0) mask = vec3(1.05, 0.62, 0.62);',
    '  else if (g < 2.0) mask = vec3(0.62, 1.05, 0.62);',
    '  else mask = vec3(0.62, 0.62, 1.05);',
    '  col *= mix(vec3(1.0), mask, uGrille*inten);',

    '  // scanlines',
    '  float sl = 0.5 + 0.5*cos(vUV.y*uRes.y*3.14159);',
    '  col *= mix(1.0, 0.72 + 0.28*sl, uScanline*inten);',

    '  // vignette',
    '  vec2 q = vUV*(1.0-vUV);',
    '  float vig = pow(q.x*q.y*15.0, 0.28 + 0.25*(1.0-inten));',
    '  col *= mix(1.0, clamp(vig,0.0,1.0), 0.55*inten);',

    '  // film noise + slight vertical flicker',
    '  float n = rnd(vUV*uRes.xy*0.5 + uTime*37.0);',
    '  col += (n-0.5) * uNoise * inten;',
    '  col *= 1.0 + uFlicker*inten*sin(uTime*97.0)*0.02;',

    '  // soft edge of the curved screen',
    '  gl_FragColor = vec4(clamp(col,0.0,1.0), 1.0);',
    '}'
  ].join('\n');

  function CRTFilter(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl', { antialias: false, preserveDrawingBuffer: true }) ||
              canvas.getContext('experimental-webgl', { antialias: false, preserveDrawingBuffer: true });
    if (!this.gl) throw new Error('WebGL unavailable');
    this.ok = this._init();
  }

  CRTFilter.prototype._compile = function (type, src) {
    var gl = this.gl;
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error('shader: ' + gl.getShaderInfoLog(s));
    }
    return s;
  };

  CRTFilter.prototype._init = function () {
    var gl = this.gl;
    var prog = gl.createProgram();
    gl.attachShader(prog, this._compile(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, this._compile(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error('link: ' + gl.getProgramInfoLog(prog));
    }
    this.prog = prog;
    gl.useProgram(prog);

    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    this.u = {};
    var names = ['uTex','uRes','uTime','uIntensity','uCurvature','uScanline','uGrille','uNoise','uGlow','uFlicker'];
    for (var i = 0; i < names.length; i++) this.u[names[i]] = gl.getUniformLocation(prog, names[i]);
    gl.uniform1i(this.u.uTex, 0);
    return true;
  };

  // pixelData: Uint8ClampedArray/Uint8Array RGBA 256x240
  CRTFilter.prototype.upload = function (pixelData) {
    var gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 240, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixelData);
  };

  CRTFilter.prototype.render = function (time, opts) {
    var gl = this.gl;
    opts = opts || {};
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.prog);
    gl.uniform2f(this.u.uRes, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.u.uTime, time || 0);
    gl.uniform1f(this.u.uIntensity, opts.intensity !== undefined ? opts.intensity : 1.0);
    gl.uniform1f(this.u.uCurvature, opts.curvature !== undefined ? opts.curvature : 1.0);
    gl.uniform1f(this.u.uScanline, opts.scanline !== undefined ? opts.scanline : 0.85);
    gl.uniform1f(this.u.uGrille, opts.grille !== undefined ? opts.grille : 0.55);
    gl.uniform1f(this.u.uNoise, opts.noise !== undefined ? opts.noise : 0.06);
    gl.uniform1f(this.u.uGlow, opts.glow !== undefined ? opts.glow : 0.7);
    gl.uniform1f(this.u.uFlicker, opts.flicker !== undefined ? opts.flicker : 1.0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };

  global.CRTFilter = CRTFilter;
})(typeof window !== 'undefined' ? window : globalThis);

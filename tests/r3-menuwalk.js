// Walk 240p Test Suite menu with k DOWNs then A, screenshot each entry
'use strict';
const fs = require('fs');
const zlib = require('zlib');
const NES = require('/tmp/nes-emu/js/nes.js');
function crc32(buf){let c,t=[];for(let n=0;n<256;n++){c=n;for(let k=0;k<8;k++)c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1);t[n]=c>>>0;}let f=0xFFFFFFFF;for(let i=0;i<buf.length;i++)f=(f>>>8)^t[(f^buf[i])&0xFF];return(f^0xFFFFFFFF)>>>0;}
function chunk(type,data){const l=Buffer.alloc(4);l.writeUInt32BE(data.length);const td=Buffer.concat([Buffer.from(type,'ascii'),data]);const c=Buffer.alloc(4);c.writeUInt32BE(crc32(td));return Buffer.concat([l,td,c]);}
function writePNG(file,pix,w,h){const raw=Buffer.alloc((w*4+1)*h);for(let y=0;y<h;y++){raw[y*(w*4+1)]=0;pix.copy(raw,y*(w*4+1)+1,y*w*4,(y+1)*w*4);}const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w,0);ihdr.writeUInt32BE(h,4);ihdr[8]=8;ihdr[9]=6;fs.writeFileSync(file,Buffer.concat([Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]));}
function shot(nes,file){const got=Buffer.alloc(256*240*4);for(let i=0;i<256*240;i++){const c=nes.ppu.fb[i],o=i*4;got[o]=c&0xFF;got[o+1]=(c>>8)&0xFF;got[o+2]=(c>>16)&0xFF;got[o+3]=0xFF;}writePNG(file,got,256,240);}

const rom = new Uint8Array(fs.readFileSync('/tmp/nes-emu/roms/240pee.nes'));
for (let k = 0; k <= 15; k++) {
  const nes = new NES(44100);
  nes.loadROM(rom);
  for (let f = 0; f < 200; f++) {
    if (f === 2 || f === 4) { nes.setButton(1, 'START', true); nes.runFrame(); continue; }
    nes.setButton(1, 'START', false);
    if (k > 0) {
      // k DOWN presses at frames 30,38,...
      const idx = Math.floor((f - 30) / 8);
      const inPress = f >= 30 && idx >= 0 && idx < k && (f - 30) % 8 < 2;
      nes.setButton(1, 'DOWN', inPress);
    }
    if (f === 150 || f === 151 || f === 152) { nes.setButton(1, 'A', true); nes.runFrame(); continue; }
    nes.setButton(1, 'A', false);
    nes.runFrame();
  }
  shot(nes, '/tmp/nes-emu/test/r3-menu-' + String(k).padStart(2, '0') + '.png');
}
console.log('done: r3-menu-00..15.png');

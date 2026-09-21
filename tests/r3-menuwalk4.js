'use strict';
const fs = require('fs');
const zlib = require('zlib');
const NES = require('/tmp/nes-emu/js/nes.js');
function crc32(buf){let c,t=[];for(let n=0;n<256;n++){c=n;for(let k=0;k<8;k++)c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1);t[n]=c>>>0;}let f=0xFFFFFFFF;for(let i=0;i<buf.length;i++)f=(f>>>8)^t[(f^buf[i])&0xFF];return(f^0xFFFFFFFF)>>>0;}
function chunk(ty,d){const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const td=Buffer.concat([Buffer.from(ty,'ascii'),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc32(td));return Buffer.concat([l,td,c]);}
function writePNG(file,pix,w,h){const raw=Buffer.alloc((w*4+1)*h);for(let y=0;y<h;y++){raw[y*(w*4+1)]=0;pix.copy(raw,y*(w*4+1)+1,y*w*4,(y+1)*w*4);}const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=6;fs.writeFileSync(file,Buffer.concat([Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]),chunk('IHDR',ih),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]));}
function shot(nes,file){const got=Buffer.alloc(256*240*4);for(let i=0;i<256*240;i++){const c=nes.ppu.fb[i],o=i*4;got[o]=c&0xFF;got[o+1]=(c>>8)&0xFF;got[o+2]=(c>>16)&0xFF;got[o+3]=0xFF;}writePNG(file,got,256,240);}
const rom = new Uint8Array(fs.readFileSync('/tmp/nes-emu/roms/240pee.nes'));
for (let k = 14; k <= 22; k++) {
  const nes = new NES(44100); nes.loadROM(rom);
  const aTime = 280 + 10 * k + 30;
  for (let f = 0; f < aTime + 120; f++) {
    nes.setButton(1, 'A', (f >= 240 && f < 246) || (f >= aTime && f < aTime + 4));
    const idx = Math.floor((f - 280) / 10);
    nes.setButton(1, 'DOWN', f >= 280 && idx < k && (f - 280) % 10 < 3);
    nes.runFrame();
  }
  shot(nes, '/tmp/nes-emu/test/r3-sp2-' + String(k).padStart(2, '0') + '.png');
}
console.log('done');

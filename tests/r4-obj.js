'use strict';
const fs = require('fs');
const zlib = require('zlib');
const NES = require('/tmp/nes-emu/js/nes.js');
function crc32(buf){let c,t=[];for(let n=0;n<256;n++){c=n;for(let k=0;k<8;k++)c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1);t[n]=c>>>0;}let crc=0xFFFFFFFF;for(let i=0;i<buf.length;i++)crc=(crc>>>8)^t[(crc^buf[i])&0xFF];return(crc^0xFFFFFFFF)>>>0;}
function chunk(type,data){const len=Buffer.alloc(4);len.writeUInt32BE(data.length);const td=Buffer.concat([Buffer.from(type,'ascii'),data]);const crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(td));return Buffer.concat([len,td,crc]);}
function writePNG(file,pix,w,h){const raw=Buffer.alloc((w*4+1)*h);for(let y=0;y<h;y++){raw[y*(w*4+1)]=0;pix.copy(raw,y*(w*4+1)+1,y*w*4,(y+1)*w*4);}const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w,0);ihdr.writeUInt32BE(h,4);ihdr[8]=8;ihdr[9]=6;fs.writeFileSync(file,Buffer.concat([Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]));}

const rom=new Uint8Array(fs.readFileSync('/tmp/nes-emu/roms/0000超级玛丽.nes'));
const nes=new NES(44100);nes.loadROM(rom);
for(let f=0;f<300;f++)nes.runFrame();
nes.setButton(1,'START',true);for(let f=0;f<8;f++)nes.runFrame();nes.setButton(1,'START',false);
for(let f=0;f<330;f++)nes.runFrame();
nes.setButton(1,'RIGHT',true);for(let f=0;f<200;f++)nes.runFrame();nes.setButton(1,'RIGHT',false);

// assemble sprites 1-8 (object1) and 52-57 (object2) with palette colors, 16x scale
function palColor(pi){const c=nes.ppu.palette[pi]&0x3F;return nes.ppu.rgb? (nes.ppu.rgb[c]&0xFFFFFF):0;}
const SCALE=12;
function obj(sprIdxs, paletteBase, w, h, out, ox) {
  for(const i of sprIdxs){
    const y=nes.ppu.oam[i*4], t=nes.ppu.oam[i*4+1], a=nes.ppu.oam[i*4+2], x=nes.ppu.oam[i*4+3];
    const x0=Math.min(...sprIdxs.map(j=>nes.ppu.oam[j*4+3]));
    const y0=Math.min(...sprIdxs.map(j=>nes.ppu.oam[j*4]));
    const pal=paletteBase+((a&3)*4);
    for(let py=0;py<8;py++){
      const row=(a&0x80)?(7-py):py;
      const lo=nes.cart.readCHR(t*16+row), hi=nes.cart.readCHR(t*16+row+8);
      for(let px=0;px<8;px++){
        const bit=(a&0x40)?px:(7-px);
        const ci=((lo>>bit)&1)|(((hi>>bit)&1)<<1);
        const rgb=ci===0?0x222222:palColor(pal+ci);
        const gx=x-x0+px, gy=y-y0+py;
        for(let s=0;s<SCALE;s++)for(let s2=0;s2<SCALE;s2++){
          const px2=ox+gx*SCALE+s, py2=gy*SCALE+s2;
          const o=(py2*(w)+px2)*4;
          out[o]=rgb&0xFF;out[o+1]=(rgb>>8)&0xFF;out[o+2]=(rgb>>16)&0xFF;out[o+3]=255;
        }
      }
    }
  }
}
// object1: 16x32 @ x112 y122 ; object2: 16x24 @ x120 y184
const W=16*SCALE*2+40, H=32*SCALE;
const out=Buffer.alloc(W*H*4, 30);
obj([1,2,3,4,5,6,7,8], 0x10, W, H, out, 0);
obj([52,53,54,55,56,57], 0x10, W, H, out, 16*SCALE+40);
writePNG('/tmp/nes-emu/test/r4p-objects.png', out, W, H);
console.log('done; sprite palette:', Array.from(nes.ppu.palette.slice(0x10,0x20)).map(v=>v.toString(16)).join(' '));

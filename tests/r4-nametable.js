// Dump nametables as decoded tile art at the "in-game" point to see what the game drew.
'use strict';
const fs = require('fs');
const zlib = require('zlib');
const NES = require('/tmp/nes-emu/js/nes.js');
function crc32(buf){let c,t=[];for(let n=0;n<256;n++){c=n;for(let k=0;k<8;k++)c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1);t[n]=c>>>0;}let crc=0xFFFFFFFF;for(let i=0;i<buf.length;i++)crc=(crc>>>8)^t[(crc^buf[i])&0xFF];return(crc^0xFFFFFFFF)>>>0;}
function chunk(type,data){const len=Buffer.alloc(4);len.writeUInt32BE(data.length);const td=Buffer.concat([Buffer.from(type,'ascii'),data]);const crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(td));return Buffer.concat([len,td,crc]);}
function writePNG(file,pix,w,h){const raw=Buffer.alloc((w*4+1)*h);for(let y=0;y<h;y++){raw[y*(w*4+1)]=0;pix.copy(raw,y*(w*4+1)+1,y*w*4,(y+1)*w*4);}const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w,0);ihdr.writeUInt32BE(h,4);ihdr[8]=8;ihdr[9]=6;fs.writeFileSync(file,Buffer.concat([Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]));}

const rom=new Uint8Array(fs.readFileSync('/tmp/nes-emu/roms/0001魂斗罗1.nes'));
const nes=new NES(44100);nes.loadROM(rom);
nes.setButton(1,'START',true);for(let f=0;f<8;f++)nes.runFrame();nes.setButton(1,'START',false);
for(let f=0;f<120;f++)nes.runFrame();
nes.setButton(1,'START',true);for(let f=0;f<8;f++)nes.runFrame();nes.setButton(1,'START',false);
for(let f=0;f<120;f++)nes.runFrame();
nes.setButton(1,'RIGHT',true);for(let f=0;f<240;f++)nes.runFrame();nes.setButton(1,'RIGHT',false);
console.log('scroll: fineX',nes.ppu.fineX??'-','t/v raw',nes.ppu.t,nes.ppu.v,'ctrl',nes.ppu.ctrl&&nes.ppu.ctrl.toString(16));

// decode both nametables with palette to 512x480 (nt0 | nt1)
const vram=nes.ppu.vram;
const pal=nes.ppu.pal||nes.ppu.palette;
const out=Buffer.alloc(512*240*4);
function palColor(i){const c=pal[i&0x1F]&0x3F;const rgb=nes.ppu.rgb?nes.ppu.rgb[c]:0;return rgb;}
for(let nt=0;nt<2;nt++){
  for(let ty=0;ty<30;ty++)for(let tx=0;tx<32;tx++){
    const base=nt*0x400;
    const tile=vram[base+ty*32+tx];
    const attrIdx=base+0x3C0+((ty>>2)*8)+(tx>>2);
    const attr=vram[attrIdx];
    const shift=((ty&2)<<1)|(tx&2);
    const pi=((attr>>shift)&3)*4;
    for(let py=0;py<8;py++){
      const patAddr=tile*16+py;
      const lo=nes.cart.readCHR(patAddr), hi=nes.cart.readCHR(patAddr+8);
      for(let px=0;px<8;px++){
        const bit=7-px;
        const ci=((lo>>bit)&1)|(((hi>>bit)&1)<<1);
        const x=nt*256+tx*8+px, y=ty*8+py;
        const o=(y*512+x)*4;
        const col=ci===0?palColor(0):palColor(pi+ci);
        out[o]=col&0xFF;out[o+1]=(col>>8)&0xFF;out[o+2]=(col>>16)&0xFF;out[o+3]=255;
      }
    }
  }
}
writePNG('/tmp/nes-emu/test/r4p-contra-nametables.png',out,512,240);
console.log('nametable dump done');

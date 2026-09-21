'use strict';
const fs = require('fs');
const zlib = require('zlib');
const Cart = require('/tmp/nes-emu/js/cart.js');
function crc32(buf){let c,t=[];for(let n=0;n<256;n++){c=n;for(let k=0;k<8;k++)c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1);t[n]=c>>>0;}let crc=0xFFFFFFFF;for(let i=0;i<buf.length;i++)crc=(crc>>>8)^t[(crc^buf[i])&0xFF];return(crc^0xFFFFFFFF)>>>0;}
function chunk(type,data){const len=Buffer.alloc(4);len.writeUInt32BE(data.length);const td=Buffer.concat([Buffer.from(type,'ascii'),data]);const crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(td));return Buffer.concat([len,td,crc]);}
function writePNG(file,pix,w,h){const raw=Buffer.alloc((w*4+1)*h);for(let y=0;y<h;y++){raw[y*(w*4+1)]=0;pix.copy(raw,y*(w*4+1)+1,y*w*4,(y+1)*w*4);}const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w,0);ihdr.writeUInt32BE(h,4);ihdr[8]=8;ihdr[9]=6;fs.writeFileSync(file,Buffer.concat([Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]));}

const rom=new Uint8Array(fs.readFileSync('/tmp/nes-emu/roms/0000超级玛丽.nes'));
const cart=new Cart(rom);
// tiles we care about: 0xfc,0x9e,0x9f,0x70-0x73 + neighbors 0x9c,0x9d,0xa0
const ids=[0x70,0x71,0x72,0x73,0x9c,0x9d,0x9e,0x9f,0xa0,0xa1,0xfa,0xfb,0xfc,0xfd];
const S=8, SCALE=8, cols=ids.length;
const out=Buffer.alloc(cols*S*SCALE * S*SCALE * 4);
for(let k=0;k<cols;k++){
  const tile=ids[k];
  for(let py=0;py<S;py++){
    const lo=cart.readCHR(tile*16+py), hi=cart.readCHR(tile*16+py+8);
    for(let px=0;px<S;px++){
      const bit=7-px;
      const ci=((lo>>bit)&1)|(((hi>>bit)&1)<<1);
      const g=[0x66,0xAA,0xDD,0xFF][ci]; // grayscale by pixel value
      for(let sy=0;sy<SCALE;sy++)for(let sx=0;sx<SCALE;sx++){
        const x=(k*S*SCALE)+(px*SCALE+sx), y=py*SCALE+sy;
        const o=(y*(cols*S*SCALE)+x)*4;
        out[o]=g;out[o+1]=g;out[o+2]=g;out[o+3]=255;
      }
    }
  }
}
writePNG('/tmp/nes-emu/test/r4p-tiles.png', out, cols*S*SCALE, S*SCALE);
console.log('tiles left-to-right:', ids.map(t=>'0x'+t.toString(16)).join(','));

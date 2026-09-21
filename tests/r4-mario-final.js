'use strict';
const fs = require('fs');
const zlib = require('zlib');
const NES = require('/tmp/nes-emu/js/nes.js');
function crc32(buf){let c,t=[];for(let n=0;n<256;n++){c=n;for(let k=0;k<8;k++)c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1);t[n]=c>>>0;}let crc=0xFFFFFFFF;for(let i=0;i<buf.length;i++)crc=(crc>>>8)^t[(crc^buf[i])&0xFF];return(crc^0xFFFFFFFF)>>>0;}
function chunk(type,data){const len=Buffer.alloc(4);len.writeUInt32BE(data.length);const td=Buffer.concat([Buffer.from(type,'ascii'),data]);const crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(td));return Buffer.concat([len,td,crc]);}
function writePNG(file,pix,w,h){const raw=Buffer.alloc((w*4+1)*h);for(let y=0;y<h;y++){raw[y*(w*4+1)]=0;pix.copy(raw,y*(w*4+1)+1,y*w*4,(y+1)*w*4);}const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w,0);ihdr.writeUInt32BE(h,4);ihdr[8]=8;ihdr[9]=6;fs.writeFileSync(file,Buffer.concat([Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]));}
const rom=new Uint8Array(fs.readFileSync('/tmp/nes-emu/roms/0000超级玛丽.nes'));
const nes=new NES(44100);nes.loadROM(rom);
const script=[{btn:'START',start:300,len:8},{btn:'RIGHT',start:640,len:150},{btn:'A',start:700,len:12}];
for(let i=0;i<790;i++){
  const st={};
  for(const s of script) st[s.btn]=!!st[s.btn]||(i>=s.start&&i<s.start+s.len);
  for(const b in st) nes.setButton(1,b,st[b]);
  nes.runFrame();
}
const got=Buffer.alloc(256*240*4);
for(let i=0;i<256*240;i++){const c=nes.ppu.fb[i],o=i*4;got[o]=c&0xFF;got[o+1]=(c>>8)&0xFF;got[o+2]=(c>>16)&0xFF;got[o+3]=0xFF;}
writePNG('/tmp/nes-emu/test/r4-mario-game.png',got,256,240);
console.log('mario final shot done, frame',nes.ppu.frame);

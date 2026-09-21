// Probe v2: record the palette address chosen per pixel (encodes bgPal/bgPix).
const NES = require('/tmp/nes-emu/js/nes.js');
const rom = new Uint8Array(16 + 0x4000);
rom[0]=0x4E;rom[1]=0x45;rom[2]=0x53;rom[3]=0x1A;rom[4]=1;rom[5]=0;rom[6]=0x20;rom[7]=0;
rom[16+0x3FFC]=0x00;rom[16+0x3FFD]=0x80;
const nes = new NES(); nes.loadROM(rom); const ppu = nes.ppu;

function tilePix(t,x,y){return (t+x+2*y)&3;}
for (let t=0;t<256;t++) for (let y=0;y<8;y++){
  let lo=0,hi=0;
  for (let x=0;x<8;x++){const v=tilePix(t,x,y);lo|=(v&1)<<(7-x);hi|=((v>>1)&1)<<(7-x);}
  nes.cart.writeCHR(t*16+y,lo); nes.cart.writeCHR(t*16+8+y,hi);
}
const nt=new Uint8Array(32*30), at=new Uint8Array(64);
for (let ty=0;ty<30;ty++) for (let tx=0;tx<32;tx++){
  nt[ty*32+tx]=(ty*32+tx)&0xFF; ppu.vramWrite(0x2000+ty*32+tx,nt[ty*32+tx]);
}
for (let qy=0;qy<8;qy++) for (let qx=0;qx<8;qx++){
  const b=(((qx*2+0)^(qy*2+0))&3)|((((qx*2+1)^(qy*2+0))&3)<<2)|((((qx*2+0)^(qy*2+1))&3)<<4)|((((qx*2+1)^(qy*2+1))&3)<<6);
  at[qy*8+qx]=b; ppu.vramWrite(0x23C0+qy*8+qx,b);
}
for (let i=0;i<32;i++) ppu.vramWrite(0x3F00+i,i&0x3F);
ppu.vramWrite(0x3F00,0x0F);

function attrQ(ax,ay){const b=at[(ay>>1)*8+(ax>>1)];const s=(((ay&1)<<1)|(ax&1))*2;return (b>>s)&3;}
function refPix(x,y){x=(x+43)&255;const t=nt[((y>>3)%30)*32+((x>>3)&31)];return tilePix(t,x&7,y&7);}
function refPal(x,y){return attrQ(((x+43)&255)>>4,y>>4);}

// record palette addresses in raster order
const rec = [];
const origPalRead = ppu._palRead.bind(ppu);
ppu._palRead = function (a) { rec.push(a); return origPalRead(a); };

ppu.reset(); ppu.ctrl=0; ppu.mask=0x0A; ppu.t=5; ppu.v=5; ppu.fineX=3; ppu.w=0;
ppu.scanline=261; ppu.dot=0; ppu.frameDone=false;
let g=0; while(!ppu.frameDone&&g++<400000) ppu.tick();

console.log('recorded palAddrs:', rec.length, '(61440 = one full frame)');
for (const y of [0,4,20,36]) {
  let sp='', sl='', el='', tp='', ep='';
  for (let x=0;x<64;x++){
    const a = rec[y*256+x];
    const gp=(a>>2)&3, gq=a&3;
    const rp=refPix(x,y), rl=refPal(x,y);
    const backdrop = (a===0x3F00||a===0x3F10);
    sp += (gq===rp)?'.':String(gq);
    tp += (rp===0)?'.':String(rp);
    sl += backdrop?'B':String(gp);
    el += String(rl);
  }
  console.log('y='+y+' pix got '+sp);
  console.log('y='+y+' pix ref '+tp);
  console.log('y='+y+' pal got '+sl);
  console.log('y='+y+' pal ref '+el);
}
// global stats
let palWrong=0, pixWrong=0, ok=0;
for (let y=0;y<240;y++) for (let x=0;x<256;x++){
  const a=rec[y*256+x];
  const gp=(a>>2)&3, gq=a&3;
  const rp=refPix(x,y), rl=refPal(x,y);
  if (rp===0) { if (a===0x3F00||a===0x3F10) ok++; else pixWrong++; continue; }
  if (gq!==rp) pixWrong++;
  else if (gp!==rl) palWrong++;
  else ok++;
}
console.log('ok:',ok,' pattern-wrong:',pixWrong,' pal-wrong-but-pattern-ok:',palWrong);

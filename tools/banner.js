#!/usr/bin/env node
// Широкий кадр камеры для шапки лендинга: та же камера и тот же мир, что в игре, только кадр W×H и поле зрения шире.
//   node tools/banner.js                      — набор вариантов ракурса в tools/out/banner-*.png (мелко, для выбора)
//   node tools/banner.js <вариант> [W] [H] [×] — один вариант в полный размер, × — увеличение пикселя (по умолчанию 1)
const fs=require('fs'), path=require('path'), zlib=require('zlib'); const {decodePNG}=require('./png.js');
const P=path.join(__dirname,'..','proto')+'/';
const src=['codebook.js','terrain.js','camera.js','world.js'].map(f=>fs.readFileSync(P+f,'utf8')).join('\n')+'\nreturn {sceneObjects, CAM, TER};';
const shims={ self:{location:{search:'?v=0'}}, importScripts(){}, postMessage(){}, setInterval(){return 1}, clearInterval(){}, setTimeout(){return 1}, onmessage:null, fetch(){ return Promise.reject(new Error('no fetch')); } };
const W_=new Function(...Object.keys(shims), src)(...Object.values(shims));
const atl=decodePNG(fs.readFileSync(P+'sprites.png')); const json=JSON.parse(fs.readFileSync(P+'sprites.json','utf8'));
const px=new Uint8Array(atl.w*atl.h*4); for(let i=0;i<atl.w*atl.h;i++){ px[i*4]=atl.gray[i]; px[i*4+3]=atl.alpha[i]; } W_.CAM.build(json,px);

// камера — второй миссионер (высота глаз 1,6 м), в кадре — идущие миссионеры
const cam=(x,y,gx,gy)=>({id:9,x,y,goal:{x:gx,y:gy},heading:Math.atan2(gy-y,gx-x),lightOn:true,charge:100,alive:true,items:[],sensors:{camera:true}});
const walker=(id,x,y,tx,ty,type='walk')=>({id,type,x,y,facing:Math.atan2(ty-y,tx-x)});
const V={
  a:{ u:cam(-16,-14,6,0), objs:[walker(1,-6,-8,14,0)] },                 // сзади-слева, миссионер идёт к люку
  b:{ u:cam(26,-16,0,6), objs:[walker(1,17,-6,-10,20), walker(2,10,-11,-20,10,252)] },   // от торца с люком, двое
  c:{ u:cam(-4,22,40,-14), objs:[walker(1,8,10,60,-30)] },               // с севера, миссионер уходит к мачте
  d:{ u:cam(20,18,-30,-20), objs:[walker(1,12,8,-20,-40)] },              // с северо-востока мимо платформы
  e:{ u:cam(-30,4,6,0), objs:[walker(1,-16,2,14,0)] },                   // строго сзади, дальний план
  f:{ u:cam(14,-24,-10,14), objs:[walker(1,6,-12,-6,10), walker(2,0,-16,-6,10,252)] },   // с юга под углом, двое
  g:{ u:cam(-6,22,40,-14), objs:[walker(1,1,16,60,-30)] },               // как c, миссионер в 7 м
  h:{ u:cam(22,20,-30,-20), objs:[walker(1,16,13,-20,-40)] },             // как d, миссионер в 8 м
  k:{ u:cam(23,19,-34,-16), objs:[walker(1,16.5,12.5,-20,-40)] },        // h, чуть левее: край без лишних фигур
  i:{ u:cam(-10,24,30,-6), objs:[walker(1,-3,17,60,-20), walker(2,20,4,60,-20)] },   // платформа в профиль, двое уходят к мачте
  j:{ u:cam(30,22,-24,-14), objs:[walker(1,22,16,-10,-30), walker(2,-2,-2,20,-20,252)] },   // от люка, один идёт к камере, второй у торца
};
const FOV=+(process.env.FOV||75);
function frame(v,W,H){ const objs=W_.sceneObjects(v.u).concat(v.objs); const big=W_.CAM.renderRaw(v.u,W*2,objs,{H:H*2,fov:FOV}); const out=new Uint8Array(W*H);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){ const i=(2*y)*W*2+2*x; out[y*W+x]=Math.max(0,Math.min(255,(big[i]+big[i+1]+big[i+W*2]+big[i+W*2+1])/4+(Math.random()-0.5)*8)); } return out; }
function png(file,buf,W,H,K=1){ const Wd=W*K, Hd=H*K; const raw=Buffer.alloc((Wd+1)*Hd); for(let y=0;y<Hd;y++){ raw[y*(Wd+1)]=0; for(let x=0;x<Wd;x++) raw[y*(Wd+1)+1+x]=buf[((y/K)|0)*W+((x/K)|0)]; }
  const crc=b=>{ let c=~0; for(const v of b){ c^=v; for(let i=0;i<8;i++) c=(c>>>1)^(0xEDB88320&-(c&1)); } return ~c>>>0; };
  const chunk=(t,d)=>{ const len=Buffer.alloc(4); len.writeUInt32BE(d.length); const td=Buffer.concat([Buffer.from(t),d]); const c=Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len,td,c]); };
  const ihdr=Buffer.alloc(13); ihdr.writeUInt32BE(Wd,0); ihdr.writeUInt32BE(Hd,4); ihdr[8]=8;
  fs.writeFileSync(file,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))])); console.log(file); }
fs.mkdirSync(path.join(__dirname,'out'),{recursive:true});
const [key,W=256,H=64,K=1]=process.argv.slice(2);
if(key&&V[key]) png(path.join(__dirname,'out',`banner-${key}.png`),frame(V[key],+W,+H),+W,+H,+K);
else { const w=256,h=64; const keys=Object.keys(V); const all=new Uint8Array(w*(h+6)*keys.length).fill(30); keys.forEach((k,n)=>{ const f=frame(V[k],w,h); console.log(' ',k); for(let y=0;y<h;y++) all.set(f.subarray(y*w,y*w+w),(n*(h+6)+y)*w); }); png(path.join(__dirname,'out','banner-all.png'),all,w,(h+6)*keys.length,3); }

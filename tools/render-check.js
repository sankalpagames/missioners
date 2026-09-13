#!/usr/bin/env node
// Headless-проверка камеры: грузит мир (codebook + terrain + camera + world) с шимами воркера и атлас из proto/sprites.png,
// рендерит набор сцен и склеивает в tools/out/render-check.png (кадры 64×64, увеличены ×4). Без браузера и канала.
//   node tools/render-check.js            — стандартный набор сцен
//   node tools/render-check.js 120 60 300 180   — один кадр из (120,60) в сторону (300,180)
const fs=require('fs'), path=require('path'), zlib=require('zlib'); const {decodePNG}=require('./png.js');
const P=path.join(__dirname,'..','proto')+'/';
const src=['level.js','codebook.js','terrain.js','camera.js','world.js'].map(f=>fs.readFileSync(P+f,'utf8')).join('\n')+
  '\nreturn {render, POIS, units, creature, objState, CAM, TER, dist};';
const shims={ self:{location:{search:'?v=0'}}, importScripts(){}, postMessage(){}, setInterval(){return 1}, clearInterval(){}, setTimeout(){return 1}, onmessage:null, fetch(){ return Promise.reject(new Error('no fetch')); } };
const W=new Function(...Object.keys(shims), src)(...Object.values(shims));
const atl=decodePNG(fs.readFileSync(P+'sprites.png')); const json=JSON.parse(fs.readFileSync(P+'sprites.json','utf8'));
const px=new Uint8Array(atl.w*atl.h*4); for(let i=0;i<atl.w*atl.h;i++){ px[i*4]=atl.gray[i]; px[i*4+3]=atl.alpha[i]; } W.CAM.build(json,px);

const look=(x,y,gx,gy,o={})=>({id:9,x,y,goal:{x:gx,y:gy},heading:Math.atan2(gy-y,gx-x),lightOn:true,charge:100,alive:true,items:[],sensors:{camera:true},...o});
const ap=(p,d,from={x:0,y:0})=>{ const dx=p.x-from.x, dy=p.y-from.y, L=Math.hypot(dx,dy); return look(p.x-dx/L*d,p.y-dy/L*d,p.x,p.y); };
const cp=(t,o)=>{ const p=W.TER.canyonPoint(t); return look(p.x,p.y,p.x+p.dir.x*20,p.y+p.dir.y*20,o); };
const P_=W.POIS; const argv=process.argv.slice(2).map(Number);
const scenes = argv.length===4 ? [['кадр',look(...argv)]] : [
  ['штабель 6 м', ap(P_[1],6)], ['шлюз 12 м', ap(P_[0],12,{x:60,y:0})], ['насыпи 20 м', ap(P_[3],20)], ['мачта 15 м', ap(P_[2],15)],
  ['обломки 25 м', ap(P_[4],25)], ['вход в расщелину 25 м', ap(P_[5],25)], ['расщелина 30 %', cp(0.3)], ['расщелина 93 %', cp(0.93)],
  ['скрытность 50 %', cp(0.5,{lightOn:false})], ['горизонт к гряде', look(120,60,300,180)], ['пустое поле', look(-50,-150,-100,-200)] ];
const SIZE=64, K=4; console.time('рендер'); const frames=scenes.map(([n,u])=>{ const f=W.render(u,SIZE); console.log(' ',n); return f; }); console.timeEnd('рендер');
const n=frames.length, Wd=SIZE*K*n+10*(n-1), H=SIZE*K; const out=new Uint8Array(Wd*H).fill(30);
frames.forEach((f,i)=>{ for(let y=0;y<H;y++)for(let x=0;x<SIZE*K;x++) out[y*Wd+x+i*(SIZE*K+10)]=f[((y/K)|0)*SIZE+((x/K)|0)]; });
const raw=Buffer.alloc((Wd+1)*H); for(let y=0;y<H;y++){ raw[y*(Wd+1)]=0; for(let x=0;x<Wd;x++) raw[y*(Wd+1)+1+x]=out[y*Wd+x]; }
const crc=(b)=>{ let c=~0; for(const v of b){ c^=v; for(let i=0;i<8;i++) c=(c>>>1)^(0xEDB88320&-(c&1)); } return ~c>>>0; };
const chunk=(t,d)=>{ const len=Buffer.alloc(4); len.writeUInt32BE(d.length); const td=Buffer.concat([Buffer.from(t),d]); const c=Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len,td,c]); };
const ihdr=Buffer.alloc(13); ihdr.writeUInt32BE(Wd,0); ihdr.writeUInt32BE(H,4); ihdr[8]=8;
fs.mkdirSync(path.join(__dirname,'out'),{recursive:true}); const outPath=path.join(__dirname,'out','render-check.png');
fs.writeFileSync(outPath,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]));
console.log(outPath);

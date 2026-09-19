#!/usr/bin/env node
// Сборка атласа спрайтов: tools/raw/<лист>.png (1024², RGBA, ракурсы в ряд) → proto/sprites.png + proto/sprites.json.
// Лист режется на виды по пустым столбцам альфы (слипшиеся — по самому пустому столбцу), каждый вид уменьшается
// до высоты 96 px усреднением по площади с весом альфы. В атласе — серый тон в RGB и альфа. Исходники в репозиторий не входят
// (по мегабайту каждый); id ассетов SpriteCook — в tools/spritecook-assets.json, по ним листы скачиваются заново.
const fs=require('fs'), path=require('path'), zlib=require('zlib'); const {decodePNG}=require('./png.js');
const RAW=path.join(__dirname,'raw'), OUT=path.join(__dirname,'..','proto'); const VH=96, ATLAS_W=2048;

function slice(d){ const cols=new Uint32Array(d.w); for(let y=0;y<d.h;y++)for(let x=0;x<d.w;x++) if(d.alpha[y*d.w+x]>100) cols[x]++;
  let runs=[], on=false, st=0; for(let x=0;x<=d.w;x++){ const v=x<d.w&&cols[x]>0; if(v&&!on){st=x;on=true;} if(!v&&on){ runs.push([st,x]); on=false; } }
  while(runs.length<5){ const ws=runs.map(r=>r[1]-r[0]).sort((a,b)=>a-b); const med=Math.min(ws[Math.floor(ws.length/2)], ws.reduce((a,b)=>a+b,0)/5); const k=runs.findIndex(r=>r[1]-r[0]>1.5*med); if(k<0) break;   // ориентир ширины — медиана, но не шире пятой части листа: слипшиеся четыре вида тоже делятся
    const [a,b]=runs[k]; let best=-1, bv=Infinity; for(let x=a+Math.floor((b-a)*0.3); x<a+Math.floor((b-a)*0.7); x++) if(cols[x]<bv){ bv=cols[x]; best=x; } runs.splice(k,1,[a,best],[best,b]); }
  return runs.map(([x0,x1])=>{ let y0=d.h,y1=0; for(let y=0;y<d.h;y++)for(let x=x0;x<x1;x++) if(d.alpha[y*d.w+x]>100){ if(y<y0)y0=y; if(y>y1)y1=y; } return {x0,y0,w:x1-x0,h:y1-y0+1}; }); }
function shrink(d,v){ const h=VH, w=Math.max(1,Math.round(v.w*VH/v.h)); const g=new Uint8Array(w*h), a=new Uint8Array(w*h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){ const lx0=Math.floor(x*v.w/w), lx1=Math.max(lx0+1,Math.floor((x+1)*v.w/w)), ly0=Math.floor(y*v.h/h), ly1=Math.max(ly0+1,Math.floor((y+1)*v.h/h)); const sx0=v.x0+lx0, sx1=v.x0+lx1, sy0=v.y0+ly0, sy1=v.y0+ly1;
    let sa=0, sg=0, n=0; for(let yy=sy0;yy<sy1;yy++)for(let xx=sx0;xx<sx1;xx++){ const k=yy*d.w+xx; const al=d.alpha[k]/255; sa+=al; sg+=al*d.gray[k]; n++; }
    a[y*w+x]=Math.round(255*sa/n); g[y*w+x]=sa>0?Math.round(sg/sa):0; }
  return {w,h,g,a}; }
function png(ga,w,h){ const bpp=2, stride=w*bpp; const raw=Buffer.alloc((stride+1)*h);   // серый+альфа, фильтр Sub — заметно лучше жмётся
  for(let y=0;y<h;y++){ raw[y*(stride+1)]=1; for(let i=0;i<stride;i++){ const cur=ga[y*stride+i], left=i>=bpp?ga[y*stride+i-bpp]:0; raw[y*(stride+1)+1+i]=(cur-left)&255; } }
  const crc=(b)=>{ let c=~0; for(const v of b){ c^=v; for(let i=0;i<8;i++) c=(c>>>1)^(0xEDB88320&-(c&1)); } return ~c>>>0; };
  const chunk=(t,d)=>{ const len=Buffer.alloc(4); len.writeUInt32BE(d.length); const td=Buffer.concat([Buffer.from(t),d]); const c=Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len,td,c]); };
  const ihdr=Buffer.alloc(13); ihdr.writeUInt32BE(w,0); ihdr.writeUInt32BE(h,4); ihdr[8]=8; ihdr[9]=4;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(raw,{level:9})),chunk('IEND',Buffer.alloc(0))]); }

const sheets={}; const views=[];
for(const f of fs.readdirSync(RAW).filter(f=>f.endsWith('.png')).sort()){ const name=f.replace(/\.png$/,''); const d=decodePNG(fs.readFileSync(path.join(RAW,f)));
  const vs=slice(d).map(v=>shrink(d,v)); sheets[name]=vs.map(v=>views.push(v)-1); console.log(name.padEnd(24), vs.length+' видов', vs.map(v=>v.w+'×'+v.h).join(' ')); }
// упаковка рядами
let x=0, y=0, rowH=0; const pos=[]; for(const v of views){ if(x+v.w>ATLAS_W){ x=0; y+=rowH+1; rowH=0; } pos.push({x,y}); x+=v.w+1; rowH=Math.max(rowH,v.h); }
const H=y+rowH; const ga=Buffer.alloc(ATLAS_W*H*2);
views.forEach((v,i)=>{ const p=pos[i]; for(let yy=0;yy<v.h;yy++)for(let xx=0;xx<v.w;xx++){ const k=((p.y+yy)*ATLAS_W+p.x+xx)*2, s=yy*v.w+xx; ga[k]=v.g[s]; ga[k+1]=v.a[s]; } });
const json={ w:ATLAS_W, h:H, sheets:{} }; for(const [name,idx] of Object.entries(sheets)) json.sheets[name]=idx.map(i=>({x:pos[i].x,y:pos[i].y,w:views[i].w,h:views[i].h}));
fs.writeFileSync(path.join(OUT,'sprites.png'),png(ga,ATLAS_W,H)); fs.writeFileSync(path.join(OUT,'sprites.json'),JSON.stringify(json));
console.log('атлас',ATLAS_W+'×'+H, (fs.statSync(path.join(OUT,'sprites.png')).size/1024|0)+' КБ,', views.length,'видов');

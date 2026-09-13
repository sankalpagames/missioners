#!/usr/bin/env node
// Headless-проверка карты высот: тело идёт от станции к расщелине, снимает лидаром под всеми наклонами, консольный блок «карта высот»
// (вырезан из console.js по маркерам) копит карту; сравнение с TER.H и разбор изогипс: сколько цепочек, какой длины, как далеко от правды.
//   node tools/hmap-check.js          — текущие правила
//   node tools/hmap-check.js old      — как было: барометр 0,5 м, без отсева обрывков (для сравнения)
//   HMIN=6 node tools/hmap-check.js  — подбор порога отсева обрывков
const fs=require('fs'), path=require('path'); const P=path.join(__dirname,'..','proto')+'/';
const OLD=process.argv[2]==='old';
const msgs=[]; const shims={ self:{location:{search:'?v=0'}}, importScripts(){}, postMessage(m){ msgs.push(m); }, setInterval(){return 1}, clearInterval(){}, setTimeout(){return 1}, onmessage:null, fetch(){ return Promise.reject(new Error('no fetch')); } };
const wsrc=['codebook.js','terrain.js','camera.js','world.js'].map(f=>fs.readFileSync(P+f,'utf8')).join('\n')+'\nreturn {sonar, TER, units};';
const W=new Function(...Object.keys(shims), wsrc)(...Object.values(shims));
let csrc=fs.readFileSync(P+'console.js','utf8'); csrc=csrc.slice(csrc.indexOf('// ---------- карта высот'), csrc.indexOf('// ---------- /карта высот'));
if(OLD) csrc=csrc.replace('HMIN=4','HMIN=1'); if(process.env.HMIN) csrc=csrc.replace('HMIN=4','HMIN='+process.env.HMIN);
const C=new Function(csrc+'\nreturn {HCELL, hmap, hmapAdd, hmapSmooth, hmapContours};')();

// маршрут: станция → вход в расщелину, снимки каждые 8 м под пятью наклонами
const A={x:16,y:0}, B={x:262,y:151}; const L=Math.hypot(B.x-A.x,B.y-A.y); const TILTS=[-1,-2,-3,-6,-12]; let nsnap=0;
for(let d=0;d<=L;d+=8){ const u={id:1,x:A.x+(B.x-A.x)*d/L,y:A.y+(B.y-A.y)*d/L,sensors:{sonar:true},sonarTilt:0,items:[]};
  for(const k of TILTS){ u.sonarTilt=k; msgs.length=0; W.sonar(u); const b=msgs[0].payload; nsnap++;
    const x=(((b[0]<<8)|b[1])-32768)/10, y=(((b[2]<<8)|b[3])-32768)/10, tilt=b[4]-90; let zs=((b[5]<<8)|b[6])/10-40; if(OLD) zs=Math.round(zs*2)/2;
    C.hmapAdd(x,y,tilt,zs,[...b.slice(15,79)],[...b.slice(7,15)]); } }
console.log(`снимков ${nsnap}, ячеек ${C.hmap.size}`);
// ошибка ячеек против правды
const es=[]; for(const [k,c] of C.hmap){ const [i,j]=k.split(',').map(Number); es.push(Math.abs(c.z-W.TER.H((i+0.5)*C.HCELL,(j+0.5)*C.HCELL))); } es.sort((a,b)=>a-b);
console.log(`ошибка высоты ячейки: медиана ${es[es.length>>1].toFixed(2)} м, p90 ${es[(es.length*.9)|0].toFixed(2)}, максимум ${es[es.length-1].toFixed(2)} (в максимуме — корпус платформы и объекты, это не грунт)`);
// изогипсы: окно на всю карту
let i0=1e9,i1=-1e9,j0=1e9,j1=-1e9; for(const k of C.hmap.keys()){ const [i,j]=k.split(',').map(Number); i0=Math.min(i0,i); i1=Math.max(i1,i); j0=Math.min(j0,j); j1=Math.max(j1,j); }
const seg=C.hmapContours(C.hmapSmooth(),i0-2,i1+2,j0-2,j1+2);
// цепочки: отрезки с общими концами (с точностью до 1 см)
const key=(x,y)=>Math.round(x*100)+','+Math.round(y*100); const par=seg.map((_,i)=>i); const find=i=>par[i]===i?i:(par[i]=find(par[i])); const ends=new Map();
seg.forEach((s,i)=>{ for(const k of [key(s[0],s[1]),key(s[2],s[3])]){ if(ends.has(k)) par[find(i)]=find(ends.get(k)); else ends.set(k,i); } });
const len=new Map(); seg.forEach((_,i)=>{ const r=find(i); len.set(r,(len.get(r)||0)+1); }); const ls=[...len.values()].sort((a,b)=>a-b);
const short=ls.filter(n=>n<=2).length; console.log(`отрезков ${seg.length}, цепочек ${ls.length}: коротких (1–2 отрезка) ${short}, длинных (≥10) ${ls.filter(n=>n>=10).length}, самая длинная ${ls[ls.length-1]||0}`);
// правдивость: истинная высота в середине отрезка против уровня изогипсы (уровень — ближайший к средней высоте по сглаженной карте)
const sm=C.hmapSmooth(); const dev=[]; for(const [x1,y1,x2,y2] of seg){ const mx=(x1+x2)/2, my=(y1+y2)/2; const c=sm.get(Math.floor(mx/C.HCELL)+','+Math.floor(my/C.HCELL)); if(!c) continue; const Lv=Math.round(c.z*2)/2; dev.push(Math.abs(W.TER.H(mx,my)-Lv)); } dev.sort((a,b)=>a-b);
// положение: расстояние от середины отрезка до ближайшей точки, где истинная высота равна уровню (поиск в радиусе 15 м шагом 1 м)
const pd=[]; for(const [x1,y1,x2,y2,Lv] of seg){ const mx=(x1+x2)/2, my=(y1+y2)/2; let best=15; for(let dx=-15;dx<=15;dx++)for(let dy=-15;dy<=15;dy++){ const d=Math.hypot(dx,dy); if(d>=best) continue; if(Math.abs(W.TER.H(mx+dx,my+dy)-Lv)<0.06) best=d; } pd.push(best); } pd.sort((a,b)=>a-b);
if(pd.length) console.log(`расстояние от изогипсы до истинной того же уровня: медиана ${pd[pd.length>>1].toFixed(1)} м, p90 ${pd[(pd.length*.9)|0].toFixed(1)}, дальше 15 м — ${(100*pd.filter(d=>d>=15).length/pd.length).toFixed(0)} % отрезков`);
if(dev.length) console.log(`истинная высота под изогипсой минус её уровень: медиана ${dev[dev.length>>1].toFixed(2)} м, p90 ${dev[(dev.length*.9)|0].toFixed(2)} (сечение 0,5 — терпимо до 0,25)`);

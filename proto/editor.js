// РЕДАКТОР УРОВНЯ (editor.html, только localhost). Инструмент, а не игра: читает мир напрямую — уровень, рельеф, камеру, физику линии;
// канала и воркера мира нет, правило «консоль не читает мир» на него не распространяется. Правит LEVEL в памяти,
// кадр свободной камеры рендерит воркер тем же CAM.renderRaw, сохраняет level.js через POST в serve.py (или текстом для копирования).
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const MAX_SLOPE=0.84;   // как в world.js: круче тело не идёт
const RETURN_R=500;     // как в world.js: радиус возврата ПС-2
const cv=$('#map'), ctx=cv.getContext('2d');
let W=1, H=1, cx=120, cy=60, sc=2;                       // вид: центр в метрах, масштаб px/м
const S=(x)=>W/2+(x-cx)*sc, Sy=(y)=>H/2+(y-cy)*sc, iS=(px)=>cx+(px-W/2)/sc, iSy=(py)=>cy+(py-H/2)/sc;
const layers={hm:true,iso:true,steep:true,decor:false,grid:true,ret:true,labels:true};
let sel=null, mode=null, drag=null, ruler=null, hover=null;   // mode: null | {add:'sub'|'poi'|'decor'|'hull'} | 'ruler'
const cam={x:-6,y:-12,tx:16,ty:0,z:1.6,fov:50,light:true,size:160};
let dirty=false; const hist=[];
const UCOL='#7fe07f';

// ---------- уровень: история, сериализация, сохранение ----------
function pushHist(){ hist.push(JSON.stringify(LEVEL)); if(hist.length>100) hist.shift(); dirty=true; setStatus(''); }
function replaceLevel(obj){ for(const k in LEVEL) delete LEVEL[k]; Object.assign(LEVEL,obj); TER.reload(); hmDirty(); }
function undo(){ if(!hist.length) return; replaceLevel(JSON.parse(hist.pop())); sel=null; renderProps(); draw(); camShot(); }
const num=v=>String(Math.round(v*100)/100);
const nameOf=t=>(CODEBOOK[t]||{}).name||('тип '+t);
function levelText(){ const L=LEVEL; const o=[];
  o.push(`// УРОВЕНЬ. Данные первого акта: где что стоит. Ориентиры с подобъектами, расщелина, корпуса, существо, сюжетные декорации.
// Подключается в мир (world.js, terrain.js), в редактор (editor.html, только localhost) и в headless-проверки; консоль этого файла не видит.
// Файл пишет редактор — комментарии-имена он восстанавливает из кодовой книги, прочие комментарии при сохранении не сохраняются.
// Типы и их свойства (имя, состояния, действия, спрайт, высота отражателя) — в codebook.js и world.js; здесь только положение и начальное состояние.
//   stations — посадочные платформы: центр корпуса (эллипс STATION из кодовой книги) и курс ang в градусах; airlock — шлюз (ориентир
//              типа 1, id 240+k) с подобъектами subs (id 160+k·4+i, не больше 4); spawn — где появляется миссионер и куда идёт «отступление».
//              Сколько платформ поднимать, решает хост: одиночная игра — первую, сетевая комната — по числу операторов.
//   pois     — ориентиры: id = тип из кодовой книги (2…9). subs — подобъекты, id = id ориентира·10 + индекс (не больше 10 штук):
//              type — тип из кодовой книги, dx/dy — смещение от ориентира, м; f — курс, градусы (нет — по хешу id);
//              state — начальное состояние (нет — 0); items — содержимое контейнера.
//   canyon   — расщелина: колена pts и ширина w в каждом колене, м; branch — тупиковый отросток (первое колено — на оси расщелины).
//   hulls    — корпуса кроме платформы (она — STATION в кодовой книге): круги, непроходимы и отражают лидар; h — высота, м.
//   pack     — одичалые: lair — логово, members — особи: лёжка x/y и черты 0…1 (size, courage, attention). Не больше 10.
//   decor    — сюжетные декорации: type — лист из SPRITES, f — курс в градусах, Hs — высота, м. Процедурные декорации — в terrain.js.
const LEVEL = {`);
  o.push(`  stations: [`);
  L.stations.forEach((S,k)=>{ o.push(`    { x:${num(S.x)}, y:${num(S.y)}, ang:${num(S.ang||0)}, spawn:{x:${num(S.spawn.x)}, y:${num(S.spawn.y)}}, airlock:{x:${num(S.airlock.x)}, y:${num(S.airlock.y)}}, subs:[   // ARK-04${1+k}`);
    for(const s of S.subs){ let f=`{type:${s.type}, dx:${num(s.dx)}, dy:${num(s.dy)}`; if(s.f!==undefined) f+=`, f:${num(s.f)}`; if(s.state) f+=`, state:${s.state}`; if(s.items&&s.items.length) f+=`, items:[${s.items.join(',')}]`; o.push(`      ${f}},   // ${nameOf(s.type)}`); }
    o.push(`    ] },`); });
  o.push(`  ],`);
  o.push(`  pois: [`);
  for(const p of L.pois){ o.push(`    { id:${p.id}, x:${num(p.x)}, y:${num(p.y)}, subs:[   // ${nameOf(p.id)}`);
    for(const s of p.subs){ let f=`{type:${s.type}, dx:${num(s.dx)}, dy:${num(s.dy)}`; if(s.f!==undefined) f+=`, f:${num(s.f)}`; if(s.state) f+=`, state:${s.state}`; if(s.items&&s.items.length) f+=`, items:[${s.items.join(',')}]`; o.push(`      ${f}},   // ${nameOf(s.type)}`); }
    o.push(`    ] },`); }
  o.push(`  ],`);
  const pts=a=>a.map(p=>`{x:${num(p.x)},y:${num(p.y)}}`).join(', ');
  o.push(`  canyon: {`); o.push(`    pts: [${pts(L.canyon.pts)}],`); o.push(`    w: [${L.canyon.w.map(num).join(', ')}],`);
  o.push(`    branch: { pts: [${pts(L.canyon.branch.pts)}], w: [${L.canyon.branch.w.map(num).join(', ')}] },`); o.push(`  },`);
  o.push(`  hulls: [`); for(const h of L.hulls) o.push(`    {x:${num(h.x)}, y:${num(h.y)}, r:${num(h.r)}, h:${num(h.h)}},${h.name?'   // '+h.name:''}`); o.push(`  ],`);
  o.push(`  pack: { lair:{x:${num(L.pack.lair.x)},y:${num(L.pack.lair.y)}}, members:[`); for(const m of L.pack.members) o.push(`    {x:${num(m.x)}, y:${num(m.y)}, size:${num(m.size)}, courage:${num(m.courage)}, attention:${num(m.attention)}},`); o.push(`  ] },`);
  o.push(`  decor: [`); for(const d of L.decor) o.push(`    {id:${d.id}, type:'${d.type}', x:${num(d.x)}, y:${num(d.y)}, f:${num(d.f)}, Hs:${num(d.Hs)}},`); o.push(`  ],`);
  o.push(`};`); o.push(`if (typeof module !== 'undefined') module.exports = { LEVEL };`); return o.join('\n')+'\n'; }
function setStatus(t,cls=''){ $('#status').textContent=t; $('#status').className=cls; }
async function save(){ const text=levelText(); setStatus('сохранение…');
  try{ const r=await fetch('level.js',{method:'POST',body:text}); if(!r.ok) throw new Error(r.status+' '+r.statusText); dirty=false; setStatus('сохранено '+new Date().toLocaleTimeString('ru'),'ok'); }
  catch(e){ setStatus('сервер не принял ('+e.message+') — текст ниже, скопировать в proto/level.js','err'); showText(); } }
function showText(){ $('#text').value=levelText(); $('#textwrap').hidden=false; }
$('#btn-save').onclick=save; $('#btn-text').onclick=showText; $('#btn-text-close').onclick=()=>$('#textwrap').hidden=true;
$('#btn-copy').onclick=()=>{ navigator.clipboard.writeText($('#text').value); setStatus('скопировано','ok'); };
$('#btn-reload').onclick=()=>{ if(!dirty||confirm('Есть несохранённые правки. Перечитать level.js?')) location.reload(); };
$('#btn-undo').onclick=undo;
window.addEventListener('beforeunload',e=>{ if(dirty){ e.preventDefault(); e.returnValue=''; } });

// ---------- физика линии в точке: тот же Link, что в игре; расстояние и затухание — как считает мир ----------
const link=new Link();
function tunnelT(x,y){ const c=TER.inside(x,y); return c && c.along>0 ? Math.min(1,c.along/TER.LEN) : -1; }
function lineAt(x,y,tx){ const tT=tunnelT(x,y); link.phys.units[1]={id:1,dist:Math.max(1,Math.min(...LEVEL.stations.map(st=>Math.hypot(x-st.x,y-st.y)))),obstDb:tT>=0?8+22*tT:0,txDbm:tx,alive:true}; link.phys.extraGain=$('#boost').checked?6:0;
  return {snr:link.snrDb(1),cap:link.localCapBps(1),per:link.per(1,72)}; }

// ---------- карта высот: сетка отсчётов по виду, тон по высоте + светотень, красное — склон круче 40°, изогипсы (marching squares) ----------
const hm={cv:document.createElement('canvas'),box:null,timer:null};
function hmDirty(ms=80){ clearTimeout(hm.timer); hm.timer=setTimeout(hmCompute,ms); }
function isoStep(){ return sc>=5?0.5 : sc>=2?1 : sc>=0.8?2 : 5; }
function hmCompute(){ const step=3, nx=Math.ceil(W/step)+2, ny=Math.ceil(H/step)+2, dm=step/sc, lod=sc>=8?0:1;
  const x0=iS(-step), y0=iSy(-step); const z=new Float32Array(nx*ny);
  for(let j=0;j<ny;j++)for(let i=0;i<nx;i++) z[j*nx+i]=TER.H(x0+i*dm,y0+j*dm,lod);
  const small=document.createElement('canvas'); small.width=nx; small.height=ny; const sctx=small.getContext('2d'); const id=sctx.createImageData(nx,ny), px=id.data; const SUN=TER.SUN;
  for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){ const k=j*nx+i; const zx=(z[k+(i<nx-1?1:0)]-z[k-(i>0?1:0)])/(dm*((i>0)+(i<nx-1))), zy=(z[k+(j<ny-1?nx:0)]-z[k-(j>0?nx:0)])/(dm*((j>0)+(j<ny-1)));
    let v=layers.hm? 60+150*Math.max(0,Math.min(1,(z[k]+5)/42)) : 120; const nl=Math.hypot(zx,zy,1); const lam=(-zx*SUN.x-zy*SUN.y+SUN.z)/nl; v*=0.55+0.5*Math.max(0,lam);
    let r=v,g=v,b=v; if(layers.steep && Math.hypot(zx,zy)>MAX_SLOPE){ r=v*0.5+110; g=v*0.5; b=v*0.5; } px[k*4]=r; px[k*4+1]=g; px[k*4+2]=b; px[k*4+3]=255; }
  sctx.putImageData(id,0,0); hm.cv.width=W; hm.cv.height=H; const c=hm.cv.getContext('2d'); c.imageSmoothingEnabled=true; c.drawImage(small,-step,-step,nx*step,ny*step);
  if(layers.iso){ const st=isoStep(); const segs=[[],[]];   // [обычные, каждая пятая]
    for(let j=0;j<ny-1;j++)for(let i=0;i<nx-1;i++){ const a=z[j*nx+i], b=z[j*nx+i+1], cc=z[(j+1)*nx+i+1], d=z[(j+1)*nx+i]; const lo=Math.min(a,b,cc,d), hi=Math.max(a,b,cc,d); if(hi-lo>st*12) continue;   // стены: пачку изогипс не рисуем
      for(let L=Math.ceil(lo/st)*st; L<=hi; L+=st){ const idx=(a>=L?1:0)|(b>=L?2:0)|(cc>=L?4:0)|(d>=L?8:0); if(!idx||idx===15) continue;
        const X0=(i-1)*step, Y0=(j-1)*step, X1=X0+step, Y1=Y0+step; const top=[X0+step*(L-a)/((b-a)||1e-9),Y0], right=[X1,Y0+step*(L-b)/((cc-b)||1e-9)], bottom=[X0+step*(L-d)/((cc-d)||1e-9),Y1], left=[X0,Y0+step*(L-a)/((d-a)||1e-9)];
        const T={1:[left,top],2:[top,right],3:[left,right],4:[right,bottom],5:[left,top,right,bottom],6:[top,bottom],7:[left,bottom],8:[bottom,left],9:[top,bottom],10:[top,right,bottom,left],11:[right,bottom],12:[right,left],13:[top,right],14:[left,top]}[idx];
        const out=segs[Math.abs(L/(st*5)-Math.round(L/(st*5)))<1e-6?1:0]; for(let q=0;q<T.length;q+=2) out.push(T[q],T[q+1]); } }
    for(const [k,col,lw] of [[0,'rgba(255,255,255,0.22)',1],[1,'rgba(255,220,150,0.5)',1]]){ c.strokeStyle=col; c.lineWidth=lw; c.beginPath(); const s=segs[k]; for(let q=0;q<s.length;q+=2){ c.moveTo(s[q][0],s[q][1]); c.lineTo(s[q+1][0],s[q+1][1]); } c.stroke(); } }
  hm.box={x0:iS(0),y0:iSy(0),x1:iS(W),y1:iSy(H)}; draw(); }

// ---------- рисование ----------
let handles=[];   // {kind, ref, x, y, r, ...} — что можно схватить; заполняется при рисовании
function poiOf(id){ return LEVEL.pois.find(p=>p.id===id); }
function draw(){ handles=[]; ctx.fillStyle='#000'; ctx.fillRect(0,0,W,H);
  if(hm.box){ const b=hm.box; ctx.drawImage(hm.cv,S(b.x0),Sy(b.y0),(b.x1-b.x0)*sc,(b.y1-b.y0)*sc); }
  ctx.font='11px ui-monospace,Menlo,monospace'; ctx.textBaseline='middle';
  if(layers.grid){ const g=sc>=4?10:sc>=1?50:sc>=0.3?100:500; ctx.strokeStyle='rgba(255,255,255,0.08)'; ctx.fillStyle='rgba(255,255,255,0.35)'; ctx.lineWidth=1;
    for(let x=Math.ceil(iS(0)/g)*g;x<=iS(W);x+=g){ ctx.beginPath(); ctx.moveTo(S(x)+0.5,0); ctx.lineTo(S(x)+0.5,H); ctx.stroke(); ctx.fillText(x,S(x)+3,8); }
    for(let y=Math.ceil(iSy(0)/g)*g;y<=iSy(H);y+=g){ ctx.beginPath(); ctx.moveTo(0,Sy(y)+0.5); ctx.lineTo(W,Sy(y)+0.5); ctx.stroke(); ctx.fillText(y,3,Sy(y)-7); } }
  // радиус возврата: станция и мачта (с усилителем)
  if(layers.ret){ ctx.setLineDash([6,6]); ctx.strokeStyle='rgba(224,169,74,0.45)'; ctx.lineWidth=1; const m=poiOf(3); for(const n of [...LEVEL.stations, ...( $('#boost').checked&&m?[m]:[] )]){ ctx.beginPath(); ctx.arc(S(n.x),Sy(n.y),RETURN_R*sc,0,7); ctx.stroke(); } ctx.setLineDash([]); }
  // расщелина: полоса шириной w (интерполяция по колену), ось, колена
  // ширина: у расщелины — по коленам (интерполяция вдоль сегмента), у отростка — по сегментам
  const C=LEVEL.canyon; const band=(pts,w,col,perSeg)=>{ for(let i=0;i<pts.length-1;i++){ const p=pts[i], q=pts[i+1]; const dx=q.x-p.x, dy=q.y-p.y, L=Math.hypot(dx,dy)||1, nx=-dy/L, ny=dx/L; const w0=(w[i]!==undefined?w[i]:w[w.length-1])/2, w1=perSeg?w0:(w[i+1]!==undefined?w[i+1]:w0*2)/2;
      ctx.fillStyle=col; ctx.beginPath(); ctx.moveTo(S(p.x+nx*w0),Sy(p.y+ny*w0)); ctx.lineTo(S(q.x+nx*w1),Sy(q.y+ny*w1)); ctx.lineTo(S(q.x-nx*w1),Sy(q.y-ny*w1)); ctx.lineTo(S(p.x-nx*w0),Sy(p.y-ny*w0)); ctx.closePath(); ctx.fill(); }
    ctx.strokeStyle='rgba(120,180,255,0.7)'; ctx.lineWidth=1; ctx.beginPath(); pts.forEach((p,i)=>i?ctx.lineTo(S(p.x),Sy(p.y)):ctx.moveTo(S(p.x),Sy(p.y))); ctx.stroke(); };
  band(C.pts,C.w,'rgba(80,140,255,0.18)',false); band(C.branch.pts,C.branch.w,'rgba(80,140,255,0.12)',true);
  const knee=(pts,w,br)=>pts.forEach((p,i)=>{ handles.push({kind:'knee',ref:p,pts,w,i,br,x:p.x,y:p.y,r:7}); ctx.fillStyle='#7fb0ff'; ctx.fillRect(S(p.x)-3,Sy(p.y)-3,7,7); if(layers.labels&&sc>=1.5&&w[i]!==undefined){ ctx.fillStyle='rgba(160,200,255,0.8)'; ctx.fillText((br?'отр ':'')+i+' · '+w[i]+' м',S(p.x)+6,Sy(p.y)-8); } });
  knee(C.pts,C.w,false); knee(C.branch.pts,C.branch.w,true);
  // корпуса: платформа (из кодовой книги) и круги уровня
  LEVEL.stations.forEach((st,k)=>{ const X=S(st.x),Y=Sy(st.y); handles.push({kind:'station',ref:st,x:st.x,y:st.y,r:8}); ctx.strokeStyle='#aaa'; ctx.lineWidth=1; ctx.beginPath(); ctx.ellipse(X,Y,STATION.rx*sc,STATION.ry*sc,(st.ang||0)*Math.PI/180,0,7); ctx.stroke();
    if(layers.labels&&sc>=0.7){ ctx.fillStyle='#aaa'; ctx.fillText('ARK-04'+(1+k),X-14,Y-STATION.ry*sc-4); } });
  for(const h of LEVEL.hulls){ handles.push({kind:'hull',ref:h,x:h.x,y:h.y,r:Math.max(6,h.r*sc)}); ctx.strokeStyle='#aaa'; ctx.beginPath(); ctx.arc(S(h.x),Sy(h.y),h.r*sc,0,7); ctx.stroke(); }
  // декорации: сюжетные — крестики; процедурные — точки (слой)
  if(layers.decor&&sc>=1){ ctx.fillStyle='rgba(200,200,200,0.35)'; const R=Math.max(W,H)/sc/2+20; for(const o of TER.decor({x:cx,y:cy},R)){ if(o.id>=7000&&o.id<7400&&LEVEL.decor.some(d=>d.id===o.id)) continue; const r=Math.max(1,(o.Hs||1)*0.4*sc); ctx.beginPath(); ctx.arc(S(o.x),Sy(o.y),r,0,7); ctx.fill(); } }
  for(const d of LEVEL.decor){ handles.push({kind:'decor',ref:d,x:d.x,y:d.y,r:6}); const X=S(d.x),Y=Sy(d.y); ctx.strokeStyle='rgba(220,220,220,0.7)'; ctx.beginPath(); ctx.moveTo(X-3,Y-3); ctx.lineTo(X+3,Y+3); ctx.moveTo(X-3,Y+3); ctx.lineTo(X+3,Y-3); ctx.stroke();
    if(layers.labels&&sc>=4){ ctx.fillStyle='rgba(200,200,200,0.6)'; ctx.fillText(d.type+' '+d.Hs,X+5,Y+6); } }
  // ориентиры и подобъекты; шлюзы платформ рисуются как ориентиры (id 240+k), их подобъекты — как подобъекты
  const AIR=LEVEL.stations.map((st,k)=>{ const a=st.airlock; for(const [key,value] of Object.entries({id:240+k,subs:st.subs,station:st})) Object.defineProperty(a,key,{value,enumerable:false,configurable:true}); return a; });   // служебные поля не сериализуются
  for(const p of [...LEVEL.pois, ...AIR]){ const X=S(p.x),Y=Sy(p.y); const on=sel&&(sel.ref===p||sel.poi===p);
    if(on){ ctx.strokeStyle='rgba(224,169,74,0.35)'; for(const s of p.subs){ ctx.beginPath(); ctx.moveTo(X,Y); ctx.lineTo(S(p.x+s.dx),Sy(p.y+s.dy)); ctx.stroke(); } }
    p.subs.forEach((s,i)=>{ const x=p.x+s.dx, y=p.y+s.dy; handles.push({kind:'sub',ref:s,poi:p,i,x,y,r:6}); const sx=S(x),sy=Sy(y); ctx.fillStyle='#cfd6de'; ctx.beginPath(); ctx.arc(sx,sy,2.5,0,7); ctx.fill();
      if(s.f!==undefined){ const a=s.f*Math.PI/180; ctx.strokeStyle='#cfd6de'; ctx.beginPath(); ctx.moveTo(sx,sy); ctx.lineTo(sx+Math.cos(a)*9,sy+Math.sin(a)*9); ctx.stroke(); }
      if(layers.labels&&sc>=2.5){ ctx.fillStyle='rgba(207,214,222,0.8)'; ctx.fillText(nameOf(s.type),sx+5,sy+5); } });
    handles.push({kind:p.station?'airlock':'poi',ref:p,x:p.x,y:p.y,r:8}); ctx.fillStyle=UCOL; ctx.beginPath(); ctx.moveTo(X,Y-5); ctx.lineTo(X+5,Y); ctx.lineTo(X,Y+5); ctx.lineTo(X-5,Y); ctx.closePath(); ctx.fill();
    if(layers.labels&&sc>=0.7){ ctx.fillStyle=UCOL; ctx.fillText(p.id+' '+(p.station?'ШЛЮЗ':nameOf(p.id).toUpperCase()),X+8,Y-8); } }
  // существо, логово, старт, камера
  const mark=(kind,ref,x,y,col,label)=>{ handles.push({kind,ref,x,y,r:7}); ctx.fillStyle=col; ctx.beginPath(); ctx.arc(S(x),Sy(y),4,0,7); ctx.fill(); if(layers.labels&&sc>=1){ ctx.fillText(label,S(x)+7,Sy(y)+1); } };
  LEVEL.pack.members.forEach((m,i)=>mark('wild',m,m.x,m.y,'#ff5c5c',`особь ${i} · ${m.size} / ${m.courage} / ${m.attention}`)); mark('lair',LEVEL.pack.lair,LEVEL.pack.lair.x,LEVEL.pack.lair.y,'#8a3a3a','логово'); LEVEL.stations.forEach(st=>mark('spawn',st.spawn,st.spawn.x,st.spawn.y,'#5cb85c','старт'));
  { const hd=Math.atan2(cam.ty-cam.y,cam.tx-cam.x), f=cam.fov/2*Math.PI/180, L=25*sc; const X=S(cam.x),Y=Sy(cam.y); ctx.strokeStyle='rgba(224,169,74,0.6)'; ctx.fillStyle='rgba(224,169,74,0.08)'; ctx.beginPath(); ctx.moveTo(X,Y); ctx.lineTo(X+Math.cos(hd-f)*L,Y+Math.sin(hd-f)*L); ctx.lineTo(X+Math.cos(hd+f)*L,Y+Math.sin(hd+f)*L); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.setLineDash([3,4]); ctx.beginPath(); ctx.moveTo(X,Y); ctx.lineTo(S(cam.tx),Sy(cam.ty)); ctx.stroke(); ctx.setLineDash([]);
    mark('cam',cam,cam.x,cam.y,'#e0a94a','камера'); handles.push({kind:'camtg',ref:cam,x:cam.tx,y:cam.ty,r:7}); const TX=S(cam.tx),TY=Sy(cam.ty); ctx.strokeStyle='#e0a94a'; ctx.beginPath(); ctx.moveTo(TX-5,TY); ctx.lineTo(TX+5,TY); ctx.moveTo(TX,TY-5); ctx.lineTo(TX,TY+5); ctx.stroke(); }
  if(ruler){ ctx.strokeStyle='#fff'; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(S(ruler.x0),Sy(ruler.y0)); ctx.lineTo(S(ruler.x1),Sy(ruler.y1)); ctx.stroke(); const d=Math.hypot(ruler.x1-ruler.x0,ruler.y1-ruler.y0), dz=TER.H(ruler.x1,ruler.y1)-TER.H(ruler.x0,ruler.y0); ctx.fillStyle='#fff'; ctx.fillText(`${d.toFixed(1)} м · Δh ${dz>=0?'+':''}${dz.toFixed(1)} м · ${Math.round((Math.atan2(ruler.y1-ruler.y0,ruler.x1-ruler.x0)*180/Math.PI+360)%360)}°`,S(ruler.x1)+8,Sy(ruler.y1)); }
  if(sel){ const h=handles.find(h=>h.kind===sel.kind&&h.ref===sel.ref&&(sel.kind!=='knee'||(h.pts===sel.pts&&h.i===sel.i))); if(h){ ctx.strokeStyle='#e0a94a'; ctx.lineWidth=1.5; ctx.beginPath(); ctx.arc(S(h.x),Sy(h.y),9,0,7); ctx.stroke(); ctx.lineWidth=1; } }
  ctx.fillStyle='rgba(255,255,255,0.5)'; ctx.fillText(`1 px = ${(1/sc).toFixed(2)} м · изогипсы через ${isoStep()} м`,8,H-10); }

// ---------- положение объекта за ручкой: чтение и перемещение ----------
function posOf(h){ return {x:h.x,y:h.y}; }
function moveTo(h,x,y){ switch(h.kind){
  case 'poi': case 'airlock': h.ref.x=x; h.ref.y=y; break;
  case 'station': { const dx=x-h.ref.x, dy=y-h.ref.y; h.ref.x=x; h.ref.y=y; h.ref.airlock.x+=dx; h.ref.airlock.y+=dy; h.ref.spawn.x+=dx; h.ref.spawn.y+=dy; break; }   // платформа едет со шлюзом и стартом
  case 'sub': h.ref.dx=x-h.poi.x; h.ref.dy=y-h.poi.y; break;
  case 'knee': { const p=h.pts[h.i]; if(!h.br&&h.i>0){ const b=LEVEL.canyon.branch.pts[0]; if(Math.abs(b.x-p.x)<1e-6&&Math.abs(b.y-p.y)<1e-6){ b.x=x; b.y=y; } }   // корень отростка сидит на колене — едет вместе
    p.x=x; p.y=y; TER.reload(); hmDirty(150); break; }
  case 'cam': { const dx=x-h.ref.x, dy=y-h.ref.y; cam.x=x; cam.y=y; cam.tx+=dx; cam.ty+=dy; camShot(); break; }
  case 'camtg': cam.tx=x; cam.ty=y; camShot(); break;
  default: h.ref.x=x; h.ref.y=y; if(h.kind==='decor') TER.reload(); }
  h.x=x; h.y=y; }
function hit(px,py){ let best=null, bd=1e9; for(const h of handles){ const d=Math.hypot(S(h.x)-px,Sy(h.y)-py); const pr=h.kind==='poi'?4:h.kind==='hull'?2:0;   // мелкое — приоритетнее крупного
    if(d<=h.r+4 && d+pr<bd){ bd=d+pr; best=h; } } return best; }
function select(h){ sel=h?{kind:h.kind,ref:h.ref,poi:h.poi,i:h.i,pts:h.pts,w:h.w,br:h.br}:null; renderProps(); draw(); }
function nearestPoi(x,y){ let b=null,bd=1e9; for(const p of [...LEVEL.pois, ...LEVEL.stations.map(st=>st.airlock)]){ const d=Math.hypot(p.x-x,p.y-y); if(d<bd){ bd=d; b=p; } } return b; }
function snap(v,e){ const st=e.shiftKey?1:0.1; return Math.round(v/st)*st; }

// ---------- мышь ----------
cv.addEventListener('wheel',e=>{ e.preventDefault(); const k=Math.pow(1.15,-e.deltaY/100); const ns=Math.max(0.15,Math.min(40,sc*k)); const mx=e.offsetX, my=e.offsetY; const wx=iS(mx), wy=iSy(my); sc=ns; cx=wx-(mx-W/2)/sc; cy=wy-(my-H/2)/sc; draw(); hmDirty(); },{passive:false});
cv.addEventListener('mousedown',e=>{ if(e.button!==0) return; const wx=iS(e.offsetX), wy=iSy(e.offsetY);
  if(mode==='ruler'){ ruler={x0:wx,y0:wy,x1:wx,y1:wy}; drag={ruler:true}; return; }
  if(mode&&mode.add){ place(mode.add,snap(wx,e),snap(wy,e)); setMode(null); return; }
  const h=hit(e.offsetX,e.offsetY); if(h){ select(h); drag={h,moved:false,ox:wx-h.x,oy:wy-h.y}; return; }
  drag={pan:true,sx:e.offsetX,sy:e.offsetY,cx0:cx,cy0:cy,moved:false}; cv.classList.add('grab'); });
cv.addEventListener('mousemove',e=>{ const wx=iS(e.offsetX), wy=iSy(e.offsetY); showCursor(wx,wy); if(!drag){ hover=hit(e.offsetX,e.offsetY); cv.style.cursor=mode?'crosshair':(hover?'pointer':'default'); return; }
  if(drag.ruler){ ruler.x1=wx; ruler.y1=wy; draw(); return; }
  if(drag.pan){ cx=drag.cx0-(e.offsetX-drag.sx)/sc; cy=drag.cy0-(e.offsetY-drag.sy)/sc; drag.moved=true; draw(); return; }
  if(!drag.moved){ drag.moved=true; if(drag.h.kind!=='cam'&&drag.h.kind!=='camtg') pushHist(); }
  moveTo(drag.h,snap(wx-drag.ox,e),snap(wy-drag.oy,e)); renderProps(); draw(); });
window.addEventListener('mouseup',e=>{ if(!drag) return; const d=drag; drag=null; cv.classList.remove('grab');
  if(d.ruler){ setMode(null); draw(); return; } if(d.pan){ if(!d.moved) select(null); else hmDirty(); return; }
  if(d.moved&&d.h.kind==='knee') hmCompute(); if(d.moved&&['poi','sub','decor','hull','wild','lair','spawn','station','airlock'].includes(d.h.kind)) camShot(); });
cv.addEventListener('dblclick',e=>{ if(hit(e.offsetX,e.offsetY)) return; const wx=iS(e.offsetX), wy=iSy(e.offsetY); const c=TER.canyon(wx,wy); if(!(c.d<c.w/2+2)) return;   // новое колено на расщелине: в ближайший сегмент
  const C=LEVEL.canyon; const pts=c.branch?C.branch.pts:C.pts, w=c.branch?C.branch.w:C.w; let bi=0,bd=1e9; for(let i=0;i<pts.length-1;i++){ const p=pts[i],q=pts[i+1]; const dx=q.x-p.x,dy=q.y-p.y,L2=dx*dx+dy*dy; const t=Math.max(0,Math.min(1,((wx-p.x)*dx+(wy-p.y)*dy)/L2)); const d=Math.hypot(wx-p.x-dx*t,wy-p.y-dy*t); if(d<bd){ bd=d; bi=i; } }
  pushHist(); pts.splice(bi+1,0,{x:snap(wx,e),y:snap(wy,e)}); w.splice(bi+1,0,Math.round(((w[bi]||w[w.length-1])+(w[bi+1]||w[bi]||w[w.length-1]))/2*10)/10); TER.reload(); select({kind:'knee',pts,w,i:bi+1,br:!!c.branch,ref:pts[bi+1]}); hmCompute(); });
function setMode(m){ mode=m; $$('[data-add]').forEach(b=>b.classList.toggle('on',!!(m&&m.add===b.dataset.add))); $('#btn-ruler').classList.toggle('on',m==='ruler'); cv.className=m?'place':''; }
$$('[data-add]').forEach(b=>b.onclick=()=>setMode(mode&&mode.add===b.dataset.add?null:{add:b.dataset.add}));
$('#btn-ruler').onclick=()=>setMode(mode==='ruler'?null:'ruler');
function place(kind,x,y){ const p=kind==='sub'?((sel&&(sel.kind==='poi'?sel.ref:sel.poi))||nearestPoi(x,y)):null;
  if(kind==='sub'&&p.subs.length>=(p.station?4:10)){ setStatus(p.station?'у шлюза не больше 4 подобъектов (id = 160 + k·4 + индекс)':'у ориентира уже 10 подобъектов (id = id·10 + индекс)','err'); return; }
  if(kind==='poi'&&!+$('#add-poi-type').value){ setStatus('свободных типов ориентиров нет — добавить в codebook.js (1…9)','err'); return; }
  pushHist();
  if(kind==='sub'){ const s={type:+$('#add-sub-type').value,dx:Math.round((x-p.x)*10)/10,dy:Math.round((y-p.y)*10)/10}; p.subs.push(s); select({kind:'sub',ref:s,poi:p,i:p.subs.length-1}); }
  if(kind==='poi'){ const np={id:+$('#add-poi-type').value,x,y,subs:[]}; LEVEL.pois.push(np); LEVEL.pois.sort((a,b)=>a.id-b.id); fillAddSelects(); select({kind:'poi',ref:np}); }
  if(kind==='decor'){ const id=Math.max(7000,...LEVEL.decor.map(d=>d.id))+1; const type=$('#add-decor-type').value; const d={id,type,x,y,f:0,Hs:SPRITES[type].H}; LEVEL.decor.push(d); TER.reload(); select({kind:'decor',ref:d}); }
  if(kind==='hull'){ const h={x,y,r:3,h:3}; LEVEL.hulls.push(h); select({kind:'hull',ref:h}); }
  if(kind==='wild'){ if(LEVEL.pack.members.length>=10){ setStatus('в стае не больше 10 особей (id 250…259)','err'); return; } const m={x,y,size:1,courage:0.5,attention:0.5}; LEVEL.pack.members.push(m); select({kind:'wild',ref:m}); }
  camShot(); }
function del(){ if(!sel) return; const k=sel.kind;
  if(k==='sub'){ pushHist(); sel.poi.subs.splice(sel.i,1); }
  else if(k==='poi'){ if(!confirm(`Удалить ориентир ${sel.ref.id} «${nameOf(sel.ref.id)}» со всеми подобъектами?`)) return; pushHist(); LEVEL.pois.splice(LEVEL.pois.indexOf(sel.ref),1); fillAddSelects(); }
  else if(k==='decor'){ pushHist(); LEVEL.decor.splice(LEVEL.decor.indexOf(sel.ref),1); TER.reload(); }
  else if(k==='hull'){ pushHist(); LEVEL.hulls.splice(LEVEL.hulls.indexOf(sel.ref),1); }
  else if(k==='wild'){ pushHist(); LEVEL.pack.members.splice(LEVEL.pack.members.indexOf(sel.ref),1); }
  else if(k==='knee'){ if(sel.pts.length<=2){ setStatus('в ломаной должно остаться хотя бы два колена','err'); return; } pushHist(); sel.pts.splice(sel.i,1); if(sel.w.length>sel.i) sel.w.splice(sel.i,1); TER.reload(); hmCompute(); }
  else return;
  select(null); camShot(); }
document.addEventListener('keydown',e=>{ if(/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
  if((e.metaKey||e.ctrlKey)&&e.key==='z'){ e.preventDefault(); undo(); return; }
  if(e.key==='Delete'||e.key==='Backspace'){ e.preventDefault(); del(); return; }
  if(e.key==='Escape'){ setMode(null); ruler=null; select(null); return; }
  if(e.key==='r'||e.key==='к'){ setMode(mode==='ruler'?null:'ruler'); return; }
  const st=e.shiftKey?10:2, hd=Math.atan2(cam.ty-cam.y,cam.tx-cam.x), R=Math.hypot(cam.tx-cam.x,cam.ty-cam.y)||10;   // полёт камеры
  const turn=a=>{ cam.tx=cam.x+Math.cos(hd+a)*R; cam.ty=cam.y+Math.sin(hd+a)*R; }, fwd=d=>{ cam.x+=Math.cos(hd)*d; cam.y+=Math.sin(hd)*d; cam.tx+=Math.cos(hd)*d; cam.ty+=Math.sin(hd)*d; };
  const K={ArrowUp:()=>fwd(st),ArrowDown:()=>fwd(-st),ArrowLeft:()=>turn(-(e.shiftKey?15:5)*Math.PI/180),ArrowRight:()=>turn((e.shiftKey?15:5)*Math.PI/180),PageUp:()=>setZ(cam.z+(e.shiftKey?5:0.5)),PageDown:()=>setZ(cam.z-(e.shiftKey?5:0.5))}[e.key];
  if(K){ e.preventDefault(); K(); draw(); camShot(); } });

// ---------- курсор и свойства ----------
function showCursor(x,y){ const z=TER.H(x,y), sl=TER.slope(x,y), c=TER.canyon(x,y), inC=c.d<c.w/2; const l0=lineAt(x,y,0), l10=lineAt(x,y,10);
  const snr=l=>l.snr<-5?`${l.snr.toFixed(1)} дБ — несущей нет`:`${l.snr.toFixed(1)} дБ · ${(l.cap/1000).toFixed(2)} кбит/с · потери ${(l.per*100).toFixed(0)} %`;
  const rows=[['x, y',`${x.toFixed(1)}, ${y.toFixed(1)}`],['высота',`${z.toFixed(2)} м`],['уклон',`${(Math.atan(sl)*180/Math.PI).toFixed(0)}°${sl>MAX_SLOPE?' — непроходимо':''}`],
    ['расщелина',inC?(c.along<0?`подход: ${(-c.along).toFixed(0)} м до входа`:`внутри: ${c.along.toFixed(0)} м от входа${c.branch?', отросток':''}, ширина ${c.w.toFixed(1)}, глубина ${(Math.max(0,tunnelT(x,y))*100).toFixed(0)} % — затухание ${(8+22*Math.max(0,tunnelT(x,y))).toFixed(0)} дБ`):(c.d<c.w/2+4?'стена/кромка':'—')],
    ['от станции',`${Math.min(...LEVEL.stations.map(st=>Math.hypot(x-st.x,y-st.y))).toFixed(0)} м${Math.min(...LEVEL.stations.map(st=>Math.hypot(x-st.x,y-st.y)))>RETURN_R&&!( $('#boost').checked&&poiOf(3)&&Math.hypot(x-poiOf(3).x,y-poiOf(3).y)<=RETURN_R)?' — за радиусом возврата':''}`],
    ['SNR 0 дБм',snr(l0)],['SNR +10 дБм',snr(l10)]];
  if(sel&&sel.kind!=='cam'&&sel.kind!=='camtg'){ const h=handles.find(h=>h.ref===sel.ref); if(h) rows.push(['до выбранного',`${Math.hypot(h.x-x,h.y-y).toFixed(1)} м`]); }
  $('#cur').innerHTML=rows.map(([k,v])=>`<label>${k}</label><b>${v}</b>`).join(''); }
$('#boost').onchange=()=>draw();
function renderProps(){ const P=$('#props'); if(!sel){ $('#sel-title').textContent=''; P.innerHTML='<span class="dim wide">клик по объекту на карте</span>'; return; }
  const rows=[]; const k=sel.kind, r=sel.ref; const F=(label,get,set,attrs='step="0.1"')=>rows.push({label,html:`<input type="number" value="${num(get())}" ${attrs}>`,on:v=>set(+v)});
  const XY=(o)=>{ F('x',()=>o.x,v=>o.x=v); F('y',()=>o.y,v=>o.y=v); };
  let title='';
  if(k==='poi'){ title=`ориентир ${r.id} · ${nameOf(r.id)}`; XY(r); rows.push({label:'подобъектов',html:`<span>${r.subs.length} (id ${r.id*10}…${r.id*10+r.subs.length-1})</span>`}); }
  if(k==='sub'){ const id=sel.poi.id*10+sel.i; title=`объект ${id} · ${nameOf(r.type)}`; const cb=CODEBOOK[r.type]||{};
    rows.push({label:'тип',html:`<select>${Object.keys(CODEBOOK).filter(t=>t>=10&&t<250).map(t=>`<option value="${t}" ${+t===r.type?'selected':''}>${t} ${CODEBOOK[t].name}</option>`).join('')}</select>`,on:v=>{ r.type=+v; delete r.state; }});
    F('x',()=>sel.poi.x+r.dx,v=>r.dx=Math.round((v-sel.poi.x)*100)/100); F('y',()=>sel.poi.y+r.dy,v=>r.dy=Math.round((v-sel.poi.y)*100)/100);
    F('dx',()=>r.dx,v=>r.dx=v); F('dy',()=>r.dy,v=>r.dy=v);
    rows.push({label:'курс',html:`<input type="number" value="${r.f===undefined?'':r.f}" step="5" placeholder="по хешу">`,on:v=>{ if(v==='') delete r.f; else r.f=((+v%360)+360)%360; }});
    if(cb.states&&cb.states.length>1) rows.push({label:'состояние',html:`<select>${cb.states.map((s,i)=>`<option value="${i}" ${i===(r.state||0)?'selected':''}>${i} ${s.slice(0,42)}</option>`).join('')}</select>`,on:v=>{ if(+v) r.state=+v; else delete r.state; }});
    if(cb.container!==undefined) rows.push({label:'предметы',html:`<input type="text" value="${(r.items||[]).join(',')}" placeholder="${Object.entries(ITEMS).map(([i,n])=>i+' '+n).join(', ')}">`,on:v=>{ const a=v.split(/[,\s]+/).map(Number).filter(i=>ITEMS[i]); if(a.length) r.items=a; else delete r.items; }});
    rows.push({label:'в кадре',html:`<span>${SPRITES[r.type]?(SPRITES[r.type].flat?'декаль на земле':'спрайт, '+SPRITES[r.type].H+' м'):'нет спрайта'}</span>`}); }
  if(k==='knee'){ title=`колено ${sel.i}${sel.br?' отростка':''}`; XY(r); if(sel.w[sel.i]!==undefined) F('ширина',()=>sel.w[sel.i],v=>{ sel.w[sel.i]=v; }); rows.push({label:'',html:`<button data-act="knee-add">колено после</button>`}); }
  if(k==='decor'){ title=`декорация ${r.id}`; rows.push({label:'тип',html:`<select>${decorTypes().map(t=>`<option ${t===r.type?'selected':''}>${t}</option>`).join('')}</select>`,on:v=>r.type=v}); XY(r); F('курс',()=>r.f,v=>r.f=v,'step="5"'); F('высота Hs',()=>r.Hs,v=>r.Hs=v); }
  if(k==='hull'){ title='корпус'; XY(r); F('радиус',()=>r.r,v=>r.r=v); F('высота',()=>r.h,v=>r.h=v); }
  if(k==='wild'){ title=`особь ${LEVEL.pack.members.indexOf(r)} (id ${250+LEVEL.pack.members.indexOf(r)})`; XY(r); F('размер',()=>r.size,v=>r.size=v,'step="0.1" min="0.5" max="1.5"'); F('храбрость',()=>r.courage,v=>r.courage=v,'step="0.05" min="0" max="1"'); F('внимательность',()=>r.attention,v=>r.attention=v,'step="0.05" min="0" max="1"'); } if(k==='lair'){ title='логово стаи'; XY(r); } if(k==='spawn'){ title='точка старта'; XY(r); }
  if(k==='station'){ title='платформа ARK-04'+(1+LEVEL.stations.indexOf(r)); XY(r); F('курс',()=>r.ang||0,v=>r.ang=v,'step="5"'); }
  if(k==='airlock'){ title='шлюз '+r.id; XY(r); }
  if(k==='cam'||k==='camtg'){ title=k==='cam'?'камера':'цель камеры'; const o=k==='cam'?{get x(){return cam.x},set x(v){cam.x=v},get y(){return cam.y},set y(v){cam.y=v}}:{get x(){return cam.tx},set x(v){cam.tx=v},get y(){return cam.ty},set y(v){cam.ty=v}}; XY(o); }
  if(!['cam','camtg','station','airlock','spawn','lair'].includes(k)) rows.push({label:'',html:`<button data-act="del" class="ghost">удалить</button> <button data-act="cam-here" class="ghost">кадр сюда</button>`});
  $('#sel-title').textContent=title; P.innerHTML=rows.map(r=>`<label>${r.label}</label><span>${r.html}</span>`).join('');
  [...P.querySelectorAll('input,select')].forEach((el,i)=>{ const row=rows.filter(r=>r.on)[i]; if(!row) return; el.onchange=()=>{ if(!['cam','camtg'].includes(k)) pushHist(); row.on(el.value); if(k==='knee'||k==='decor') TER.reload(); if(k==='knee') hmCompute(); draw(); renderProps(); camShot(); }; });
  P.querySelectorAll('[data-act]').forEach(b=>b.onclick=()=>{ const a=b.dataset.act; if(a==='del') del(); if(a==='cam-here') camToSel(); if(a==='knee-add'){ pushHist(); const p=sel.pts[sel.i], q=sel.pts[sel.i+1]||{x:p.x+10,y:p.y}; sel.pts.splice(sel.i+1,0,{x:(p.x+q.x)/2,y:(p.y+q.y)/2}); sel.w.splice(sel.i+1,0,sel.w[sel.i]); TER.reload(); select({kind:'knee',pts:sel.pts,w:sel.w,i:sel.i+1,br:sel.br,ref:sel.pts[sel.i+1]}); hmCompute(); } }); }
function decorTypes(){ return Object.keys(SPRITES).filter(k=>isNaN(+k)&&!['sleep','walk','station'].includes(k)); }
function fillAddSelects(){ $('#add-sub-type').innerHTML=Object.keys(CODEBOOK).filter(t=>t>=10&&t<250).map(t=>`<option value="${t}">${t} ${CODEBOOK[t].name}</option>`).join('');
  const free=Object.keys(CODEBOOK).filter(t=>t>=2&&t<10&&!poiOf(+t));   // тип 1 — шлюз, он у платформ $('#add-poi-type').innerHTML=free.length?free.map(t=>`<option value="${t}">${t} ${CODEBOOK[t].name}</option>`).join(''):'<option value="0">свободных типов нет</option>';
  $('#add-decor-type').innerHTML=decorTypes().map(t=>`<option>${t}</option>`).join(''); }

// ---------- свободная камера: кадр рендерит воркер (level + codebook + terrain + camera, без world.js), сцена — весь уровень без правил видимости ----------
const camW=(()=>{ const base=new URL('.',location.href).href, v=window.__v;
  const src=`importScripts(${['level.js','codebook.js','terrain.js','camera.js'].map(f=>JSON.stringify(base+f+'?v='+v)).join(',')});
    const ready=CAM.load(${JSON.stringify(String(v))},${JSON.stringify(base)});
    function scene(u){ const out=[]; for(const p of LEVEL.pois){ if(SPRITES[p.id]) out.push({id:p.id,type:p.id,x:p.x,y:p.y}); p.subs.forEach((s,i)=>{ if(SPRITES[s.type]) out.push({id:p.id*10+i,type:s.type,x:p.x+s.dx,y:p.y+s.dy,facing:s.f===undefined?undefined:s.f*Math.PI/180}); }); }
      LEVEL.pack.members.forEach((m,i)=>out.push({id:250+i,type:'sleep',x:m.x,y:m.y,facing:Math.atan2(u.y-m.y,u.x-m.x),Hs:0.6*m.size}));
      LEVEL.stations.forEach((st,k)=>{ out.push({id:900+k,type:'station',x:st.x,y:st.y,facing:(st.ang||0)*Math.PI/180}); out.push({id:201+k,type:252,x:st.spawn.x,y:st.spawn.y,facing:0}); st.subs.forEach((s,i)=>{ if(SPRITES[s.type]) out.push({id:160+k*4+i,type:s.type,x:st.airlock.x+s.dx,y:st.airlock.y+s.dy,facing:s.f===undefined?undefined:s.f*Math.PI/180}); }); });
      return out.concat(TER.decor(u,120)); }
    onmessage=async e=>{ const m=e.data; await ready; for(const k in LEVEL) delete LEVEL[k]; Object.assign(LEVEL,m.level); TER.reload(); const t0=Date.now();
      const img=CAM.renderRaw(m.u,m.W,scene(m.u),{H:m.H,fov:m.fov,heading:m.u.heading,z:m.z}); postMessage({img,W:m.W,H:m.H,ms:Date.now()-t0,atlas:CAM.ready}); };`;
  const w=new Worker(URL.createObjectURL(new Blob([src],{type:'text/javascript'}))); w.busy=false; w.pending=false;
  w.onmessage=e=>{ const m=e.data; const fc=$('#frame'); fc.width=m.W; fc.height=m.H; const id=fc.getContext('2d').createImageData(m.W,m.H); for(let i=0;i<m.img.length;i++){ id.data[i*4]=id.data[i*4+1]=id.data[i*4+2]=m.img[i]; id.data[i*4+3]=255; } fc.getContext('2d').putImageData(id,0,0);
    $('#cam-info').textContent=`${m.W}×${m.H} · ${m.ms} мс${m.atlas?'':' · атлас не загружен'}`; w.busy=false; if(w.pending){ w.pending=false; camShot(true); } };
  return w; })();
let shotTimer=null;
function camShot(now=false){ if(!now&&!$('#cam-auto').classList.contains('on')) return; clearTimeout(shotTimer); shotTimer=setTimeout(()=>{ if(camW.busy){ camW.pending=true; return; } camW.busy=true;
  const heading=Math.atan2(cam.ty-cam.y,cam.tx-cam.x); camW.postMessage({level:JSON.parse(JSON.stringify(LEVEL)),u:{id:9,x:cam.x,y:cam.y,heading,goal:{x:cam.tx,y:cam.ty},lightOn:cam.light,charge:100,alive:true},W:cam.size,H:cam.size*5/8,fov:cam.fov,z:cam.z}); },now?0:120); }
function setZ(z){ cam.z=Math.max(0.3,Math.min(40,Math.round(z*10)/10)); $('#cam-z').value=cam.z; $('#cam-z-v').textContent=String(cam.z).replace('.',',')+' м'; }
function camToSel(){ if(!sel) return; const h=handles.find(h=>h.ref===sel.ref); if(!h) return; const a=Math.atan2(cam.y-h.y,cam.x-h.x); cam.tx=h.x; cam.ty=h.y; cam.x=h.x+Math.cos(a)*8; cam.y=h.y+Math.sin(a)*8; draw(); camShot(true); }
$('#cam-size').onchange=e=>{ cam.size=+e.target.value; camShot(true); };
$('#cam-fov').oninput=e=>{ cam.fov=+e.target.value; $('#cam-fov-v').textContent=cam.fov+'°'; draw(); camShot(); };
$('#cam-z').oninput=e=>{ setZ(+e.target.value); camShot(); };
$('#cam-light').onchange=e=>{ cam.light=e.target.checked; camShot(); };
$('#cam-shot').onclick=()=>camShot(true); $('#cam-auto').onclick=e=>{ e.target.classList.toggle('on'); camShot(); }; $('#cam-to-sel').onclick=camToSel;

// ---------- слои, размер, старт ----------
$$('[data-layer]').forEach(b=>b.onclick=()=>{ layers[b.dataset.layer]=!layers[b.dataset.layer]; b.classList.toggle('on',layers[b.dataset.layer]); if(['hm','iso','steep'].includes(b.dataset.layer)) hmCompute(); else draw(); });
function fit(){ const r=$('#mapwrap').getBoundingClientRect(); W=cv.width=Math.max(1,Math.floor(r.width)); H=cv.height=Math.max(1,Math.floor(r.height)); draw(); hmDirty(); }
new ResizeObserver(fit).observe($('#mapwrap'));
fillAddSelects(); fit(); camShot(true);

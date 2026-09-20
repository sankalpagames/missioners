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
  o.push(`// УРОВЕНЬ. Данные первого акта: где что стоит. Ориентиры с подобъектами, расщелина, корпуса, одичалые, сюжетные декорации.
// Подключается в мир (world.js, terrain.js), в редактор (editor.html, только localhost) и в headless-проверки; консоль этого файла не видит.
// Файл пишет редактор — комментарии-имена он восстанавливает из кодовой книги, прочие комментарии при сохранении не сохраняются.
// Типы и их свойства (имя, состояния, действия, спрайт, высота отражателя) — в codebook.js и world.js; здесь только положение и начальное состояние.
//   sites    — площадки под базы: центр и курс ang в градусах. Самой базы в уровне нет — она разворачивается по штатному составу
//              (BASE в кодовой книге: корпус, шлюз, старт, люк, прожектор, ящики, турель), когда хост поднимает платформу.
//              subs — сюжетные подобъекты у шлюза сверх штатных (смещения от шлюза в осях площадки; всего не больше 10, id 160+k·10+i);
//              turret — своя турель вместо штатной: dx/dy от центра площадки, f — курс от курса площадки, fov/range/aim/reload.
//   layouts  — какие площадки заняты при n платформах: индексы площадок в порядке платформ (ARK-041, 042, …). Без записи — первые n.
//              Сколько платформ поднимать, решает хост: одиночная игра — одну, сетевая комната — по настройке.
//   pois     — ориентиры: id = тип из кодовой книги (2…9). subs — подобъекты, id = id ориентира·10 + индекс (не больше 10 штук):
//              type — тип из кодовой книги, dx/dy — смещение от ориентира, м; f — курс, градусы (нет — по хешу id);
//              state — начальное состояние (нет — 0); items — содержимое контейнера.
//   canyon   — расщелина: колена pts и ширина w в каждом колене, м; branch — тупиковый отросток (первое колено — на оси расщелины).
//   bounds   — край уровня, м: дальше тела и одичалые не ступают (рельеф — функция от координат, определён везде; край — техническая гарантия,
//              что баг или бесконечная цель не уведут за карту). Спектатор и редактор рисуют его рамкой.
//   hulls    — корпуса кроме платформы (она — STATION в кодовой книге): круги, непроходимы и отражают лидар; h — высота, м.
//   pack     — одичалые: lair — логово (куда уходят), members — особи: лёжка x/y и черты 0…1 — size (размер, 1 = тело миссионера),
//              courage (храбрость: пугливый → агрессивный), attention (внимательность: радиус чувств, кто кричит первым). Не больше 10.
//   decor    — сюжетные декорации: type — лист из SPRITES, f — курс в градусах, Hs — высота, м. Процедурные декорации — в terrain.js.
const LEVEL = {`);
  o.push(`  sites: [`);
  L.sites.forEach((S,i)=>{ const T=S.turret; const tur=T?`, turret:{dx:${num(T.dx)}, dy:${num(T.dy)}, f:${num(T.f||0)}${T.fov!==undefined?', fov:'+num(T.fov):''}${T.range!==undefined?', range:'+num(T.range):''}${T.aim!==undefined?', aim:'+num(T.aim):''}${T.reload!==undefined?', reload:'+num(T.reload):''}}`:'';
    if(!S.subs||!S.subs.length){ o.push(`    { x:${num(S.x)}, y:${num(S.y)}, ang:${num(S.ang||0)}${tur} },   // площадка ${1+i}`); return; }
    o.push(`    { x:${num(S.x)}, y:${num(S.y)}, ang:${num(S.ang||0)}${tur}, subs:[   // площадка ${1+i}`);
    for(const s of S.subs){ let f=`{type:${s.type}, dx:${num(s.dx)}, dy:${num(s.dy)}`; if(s.f!==undefined) f+=`, f:${num(s.f)}`; if(s.state) f+=`, state:${s.state}`; if(s.items&&s.items.length) f+=`, items:[${s.items.join(',')}]`; o.push(`      ${f}},   // ${nameOf(s.type)}`); }
    o.push(`    ] },`); });
  o.push(`  ],`);
  o.push(`  layouts: { ${Object.keys(L.layouts||{}).map(n=>`${n}:[${L.layouts[n].join(',')}]`).join(', ')} },`);
  o.push(`  pois: [`);
  for(const p of L.pois){ o.push(`    { id:${p.id}, x:${num(p.x)}, y:${num(p.y)}, subs:[   // ${nameOf(p.id)}`);
    for(const s of p.subs){ let f=`{type:${s.type}, dx:${num(s.dx)}, dy:${num(s.dy)}`; if(s.f!==undefined) f+=`, f:${num(s.f)}`; if(s.state) f+=`, state:${s.state}`; if(s.items&&s.items.length) f+=`, items:[${s.items.join(',')}]`; o.push(`      ${f}},   // ${nameOf(s.type)}`); }
    o.push(`    ] },`); }
  o.push(`  ],`);
  const pts=a=>a.map(p=>`{x:${num(p.x)},y:${num(p.y)}}`).join(', ');
  o.push(`  canyon: {`); o.push(`    pts: [${pts(L.canyon.pts)}],`); o.push(`    w: [${L.canyon.w.map(num).join(', ')}],`);
  o.push(`    branch: { pts: [${pts(L.canyon.branch.pts)}], w: [${L.canyon.branch.w.map(num).join(', ')}] },`); o.push(`  },`);
  if(L.bounds) o.push(`  bounds: {x0:${num(L.bounds.x0)}, y0:${num(L.bounds.y0)}, x1:${num(L.bounds.x1)}, y1:${num(L.bounds.y1)}},`);
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
// импорт и экспорт карт: тот же формат, что level.js (его принимает сервер: node server/index.js … level=ФАЙЛ); импорт — файл или перетаскивание на карту
let mapName='level.js';
function exportLevel(){ const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([levelText()],{type:'text/javascript'})); a.download=mapName; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1000); setStatus('экспорт: '+mapName,'ok'); }
function importLevel(text,name){ let obj; try{ if(!/^\/\/ УРОВЕНЬ/.test(text)||!/\nconst LEVEL = \{/.test(text)) throw new Error('не файл уровня'); obj=new Function(text+'\nreturn LEVEL;')(); if(!Array.isArray(obj.sites)||!Array.isArray(obj.pois)||!obj.canyon) throw new Error('нет площадок, ориентиров или расщелины'); }
  catch(e){ setStatus('импорт не удался: '+e.message,'err'); return; }
  if(dirty&&!confirm('Есть несохранённые правки. Заменить уровень импортом?')) return;
  pushHist(); replaceLevel(obj); sel=null; mapName=name||mapName; fillAddSelects(); renderProps(); draw(); camShot(true); setStatus(`импорт: ${mapName} — не сохранено (сохранить → proto/level.js)`,'ok'); }
$('#btn-export').onclick=exportLevel;
$('#btn-import').onclick=()=>$('#file-import').click();
$('#file-import').onchange=e=>{ const f=e.target.files[0]; if(f) f.text().then(t=>importLevel(t,f.name)); e.target.value=''; };
window.addEventListener('dragover',e=>e.preventDefault()); window.addEventListener('drop',e=>{ e.preventDefault(); const f=e.dataTransfer.files[0]; if(f) f.text().then(t=>importLevel(t,f.name)); });
$('#btn-reload').onclick=()=>{ if(!dirty||confirm('Есть несохранённые правки. Перечитать level.js?')) location.reload(); };
$('#btn-undo').onclick=undo;
window.addEventListener('beforeunload',e=>{ if(dirty){ e.preventDefault(); e.returnValue=''; } });

// ---------- физика линии в точке: тот же Link, что в игре; расстояние и затухание — как считает мир ----------
const link=new Link();
function tunnelT(x,y){ const c=TER.inside(x,y); return c && c.along>0 ? Math.min(1,c.along/TER.LEN) : -1; }
function lineAt(x,y,tx){ const tT=tunnelT(x,y); link.phys.units[1]={id:1,dist:Math.max(1,Math.min(...LEVEL.sites.map(st=>Math.hypot(x-st.x,y-st.y)))),obstDb:tT>=0?8+22*tT:0,txDbm:tx,alive:true}; link.phys.extraGain=$('#boost').checked?6:0;
  return {snr:link.snrDb(1),cap:link.localCapBps(1),per:link.per(1,72)}; }

// ---------- карта высот: сетка отсчётов по виду, тон по высоте + светотень, красное — склон круче 40°, изогипсы (marching squares) ----------
const hm={cv:document.createElement('canvas'),box:null,timer:null};
function hmDirty(ms=80){ clearTimeout(hm.timer); hm.timer=setTimeout(hmCompute,ms); }
function isoStep(){ return sc>=5?0.5 : sc>=2?1 : sc>=0.8?2 : 5; }
function hmCompute(){ MAPDRAW.heightmap(hm.cv,{W,H,sc,iS,iSy,hm:layers.hm,iso:layers.iso,steep:layers.steep,isoStep:isoStep(),MAX_SLOPE}); hm.box={x0:iS(0),y0:iSy(0),x1:iS(W),y1:iSy(H)}; draw(); }   // слой высот — общий со спектатором (mapdraw.js)

// ---------- рисование ----------
let handles=[];   // {kind, ref, x, y, r, ...} — что можно схватить; заполняется при рисовании
function poiOf(id){ return LEVEL.pois.find(p=>p.id===id); }
function draw(){ handles=[]; ctx.fillStyle='#000'; ctx.fillRect(0,0,W,H);
  if(hm.box){ const b=hm.box; ctx.drawImage(hm.cv,S(b.x0),Sy(b.y0),(b.x1-b.x0)*sc,(b.y1-b.y0)*sc); }
  ctx.font='11px ui-monospace,Menlo,monospace'; ctx.textBaseline='middle';
  if(layers.grid){ const g=sc>=4?10:sc>=1?50:sc>=0.3?100:500; ctx.strokeStyle='rgba(255,255,255,0.08)'; ctx.fillStyle='rgba(255,255,255,0.35)'; ctx.lineWidth=1;
    for(let x=Math.ceil(iS(0)/g)*g;x<=iS(W);x+=g){ ctx.beginPath(); ctx.moveTo(S(x)+0.5,0); ctx.lineTo(S(x)+0.5,H); ctx.stroke(); ctx.fillText(x,S(x)+3,8); }
    for(let y=Math.ceil(iSy(0)/g)*g;y<=iSy(H);y+=g){ ctx.beginPath(); ctx.moveTo(0,Sy(y)+0.5); ctx.lineTo(W,Sy(y)+0.5); ctx.stroke(); ctx.fillText(y,3,Sy(y)-7); } }
  if(LEVEL.bounds){ const b=LEVEL.bounds; ctx.setLineDash([2,4]); ctx.strokeStyle='rgba(255,92,92,0.5)'; ctx.strokeRect(S(b.x0),Sy(b.y0),(b.x1-b.x0)*sc,(b.y1-b.y0)*sc); ctx.setLineDash([]); }   // край уровня
  // радиус возврата: станция и мачта (с усилителем)
  if(layers.ret){ ctx.setLineDash([6,6]); ctx.strokeStyle='rgba(224,169,74,0.45)'; ctx.lineWidth=1; const m=poiOf(3); for(const n of [...LEVEL.sites, ...( $('#boost').checked&&m?[m]:[] )]){ ctx.beginPath(); ctx.arc(S(n.x),Sy(n.y),RETURN_R*sc,0,7); ctx.stroke(); } ctx.setLineDash([]); }
  // расщелина: полоса шириной w (интерполяция по колену), ось, колена
  // ширина: у расщелины — по коленам (интерполяция вдоль сегмента), у отростка — по сегментам
  const C=LEVEL.canyon; const band=(pts,w,col,perSeg)=>{ for(let i=0;i<pts.length-1;i++){ const p=pts[i], q=pts[i+1]; const dx=q.x-p.x, dy=q.y-p.y, L=Math.hypot(dx,dy)||1, nx=-dy/L, ny=dx/L; const w0=(w[i]!==undefined?w[i]:w[w.length-1])/2, w1=perSeg?w0:(w[i+1]!==undefined?w[i+1]:w0*2)/2;
      ctx.fillStyle=col; ctx.beginPath(); ctx.moveTo(S(p.x+nx*w0),Sy(p.y+ny*w0)); ctx.lineTo(S(q.x+nx*w1),Sy(q.y+ny*w1)); ctx.lineTo(S(q.x-nx*w1),Sy(q.y-ny*w1)); ctx.lineTo(S(p.x-nx*w0),Sy(p.y-ny*w0)); ctx.closePath(); ctx.fill(); }
    ctx.strokeStyle='rgba(120,180,255,0.7)'; ctx.lineWidth=1; ctx.beginPath(); pts.forEach((p,i)=>i?ctx.lineTo(S(p.x),Sy(p.y)):ctx.moveTo(S(p.x),Sy(p.y))); ctx.stroke(); };
  band(C.pts,C.w,'rgba(80,140,255,0.18)',false); band(C.branch.pts,C.branch.w,'rgba(80,140,255,0.12)',true);
  const knee=(pts,w,br)=>pts.forEach((p,i)=>{ handles.push({kind:'knee',ref:p,pts,w,i,br,x:p.x,y:p.y,r:7}); ctx.fillStyle='#7fb0ff'; ctx.fillRect(S(p.x)-3,Sy(p.y)-3,7,7); if(layers.labels&&sc>=1.5&&w[i]!==undefined){ ctx.fillStyle='rgba(160,200,255,0.8)'; ctx.fillText((br?'отр ':'')+i+' · '+w[i]+' м',S(p.x)+6,Sy(p.y)-8); } });
  knee(C.pts,C.w,false); knee(C.branch.pts,C.branch.w,true);
  // площадки: база на каждой — призраком, как её развернёт хост (корпус из кодовой книги, зона питания, турель сектором, старт)
  const AIR=airlocks();
  AIR.forEach(A=>{ const st=A.site, B=A.base, i=A.i, X=S(st.x),Y=Sy(st.y); handles.push({kind:'station',ref:st,x:st.x,y:st.y,r:8}); ctx.strokeStyle='#aaa'; ctx.lineWidth=1; ctx.setLineDash([4,3]); ctx.beginPath(); ctx.ellipse(X,Y,STATION.rx*sc,STATION.ry*sc,(st.ang||0)*Math.PI/180,0,7); ctx.stroke(); ctx.setLineDash([]);
    if(layers.labels&&sc>=0.7){ ctx.fillStyle='#aaa'; ctx.fillText(`площадка ${1+i} · ${layoutsOf(i)}`,X-14,Y-STATION.ry*sc-4); }
    ctx.setLineDash([3,5]); ctx.strokeStyle='rgba(255,220,120,0.35)'; ctx.beginPath(); ctx.arc(X,Y,STATION.powerR*sc,0,7); ctx.stroke(); ctx.setLineDash([]);   // зона питания
    const T=B.turret; handles.push({kind:'turret',ref:st,x:T.x,y:T.y,r:7}); const TX=S(T.x),TY=Sy(T.y), a=T.f*Math.PI/180, fov=T.fov*Math.PI/180, R=T.range*sc; ctx.fillStyle='rgba(255,220,120,0.06)'; ctx.strokeStyle=st.turret?'rgba(255,220,120,0.4)':'rgba(255,220,120,0.2)'; ctx.beginPath(); ctx.moveTo(TX,TY); ctx.arc(TX,TY,R,a-fov/2,a+fov/2); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.fillStyle=st.turret?'#ffdc78':'rgba(255,220,120,0.5)'; ctx.fillRect(TX-3,TY-3,7,7); if(layers.labels&&sc>=1){ ctx.fillText(st.turret?'турель':'турель (штатная)',TX+7,TY+8); }
    const sp=B.spawn; ctx.fillStyle='#5cb85c'; ctx.beginPath(); ctx.arc(S(sp.x),Sy(sp.y),4,0,7); ctx.fill(); if(layers.labels&&sc>=1) ctx.fillText('старт',S(sp.x)+7,Sy(sp.y)+1); });
  for(const h of LEVEL.hulls){ handles.push({kind:'hull',ref:h,x:h.x,y:h.y,r:Math.max(6,h.r*sc)}); ctx.strokeStyle='#aaa'; ctx.beginPath(); ctx.arc(S(h.x),Sy(h.y),h.r*sc,0,7); ctx.stroke(); }
  // декорации: сюжетные — крестики; процедурные — точки (слой)
  if(layers.decor&&sc>=1){ ctx.fillStyle='rgba(200,200,200,0.35)'; const R=Math.max(W,H)/sc/2+20; for(const o of TER.decor({x:cx,y:cy},R)){ if(o.id>=7000&&o.id<7400&&LEVEL.decor.some(d=>d.id===o.id)) continue; const r=Math.max(1,(o.Hs||1)*0.4*sc); ctx.beginPath(); ctx.arc(S(o.x),Sy(o.y),r,0,7); ctx.fill(); } }
  for(const d of LEVEL.decor){ handles.push({kind:'decor',ref:d,x:d.x,y:d.y,r:6}); const X=S(d.x),Y=Sy(d.y); ctx.strokeStyle='rgba(220,220,220,0.7)'; ctx.beginPath(); ctx.moveTo(X-3,Y-3); ctx.lineTo(X+3,Y+3); ctx.moveTo(X-3,Y+3); ctx.lineTo(X+3,Y-3); ctx.stroke();
    if(layers.labels&&sc>=4){ ctx.fillStyle='rgba(200,200,200,0.6)'; ctx.fillText(d.type+' '+d.Hs,X+5,Y+6); } }
  // ориентиры и подобъекты; шлюзы баз рисуются как ориентиры (id 240+k), их подобъекты — как подобъекты: штатные (BASE) тусклее и не правятся, сюжетные — из площадки
  for(const p of [...LEVEL.pois, ...AIR]){ const X=S(p.x),Y=Sy(p.y); const on=sel&&(sel.ref===p||sel.poi===p||(p.station&&(sel.ref===p.site||sel.poi&&sel.poi.site===p.site)));
    const subs=p.station?p.base.subs:p.subs, nk=p.station?BASE.subs.length:0;
    if(on){ ctx.strokeStyle='rgba(224,169,74,0.35)'; for(const s of subs){ ctx.beginPath(); ctx.moveTo(X,Y); ctx.lineTo(S(p.x+s.dx),Sy(p.y+s.dy)); ctx.stroke(); } }
    subs.forEach((s,i)=>{ const x=p.x+s.dx, y=p.y+s.dy, kit=i<nk; handles.push(kit?{kind:'ksub',ref:BASE.subs[i],poi:p,i,x,y,r:6}:{kind:'sub',ref:p.station?p.site.subs[i-nk]:s,poi:p,i:i-nk,x,y,r:6}); const sx=S(x),sy=Sy(y); ctx.fillStyle=kit?'rgba(207,214,222,0.45)':'#cfd6de'; ctx.beginPath(); ctx.arc(sx,sy,2.5,0,7); ctx.fill();
      if(s.f!==undefined){ const a=s.f*Math.PI/180; ctx.strokeStyle=ctx.fillStyle; ctx.beginPath(); ctx.moveTo(sx,sy); ctx.lineTo(sx+Math.cos(a)*9,sy+Math.sin(a)*9); ctx.stroke(); }
      if(layers.labels&&sc>=2.5){ ctx.fillStyle=kit?'rgba(207,214,222,0.45)':'rgba(207,214,222,0.8)'; ctx.fillText(nameOf(s.type),sx+5,sy+5); } });
    if(!p.station) handles.push({kind:'poi',ref:p,x:p.x,y:p.y,r:8}); ctx.fillStyle=UCOL; ctx.beginPath(); ctx.moveTo(X,Y-5); ctx.lineTo(X+5,Y); ctx.lineTo(X,Y+5); ctx.lineTo(X-5,Y); ctx.closePath(); ctx.fill();
    if(layers.labels&&sc>=0.7){ ctx.fillStyle=UCOL; ctx.fillText(p.station?'ШЛЮЗ':p.id+' '+nameOf(p.id).toUpperCase(),X+8,Y-8); } }
  // существо, логово, камера
  const mark=(kind,ref,x,y,col,label)=>{ handles.push({kind,ref,x,y,r:7}); ctx.fillStyle=col; ctx.beginPath(); ctx.arc(S(x),Sy(y),4,0,7); ctx.fill(); if(layers.labels&&sc>=1){ ctx.fillText(label,S(x)+7,Sy(y)+1); } };
  LEVEL.pack.members.forEach((m,i)=>mark('wild',m,m.x,m.y,'#ff5c5c',`особь ${i} · ${m.size} / ${m.courage} / ${m.attention}`)); mark('lair',LEVEL.pack.lair,LEVEL.pack.lair.x,LEVEL.pack.lair.y,'#8a3a3a','логово');
  { const hd=Math.atan2(cam.ty-cam.y,cam.tx-cam.x), f=cam.fov/2*Math.PI/180, L=25*sc; const X=S(cam.x),Y=Sy(cam.y); ctx.strokeStyle='rgba(224,169,74,0.6)'; ctx.fillStyle='rgba(224,169,74,0.08)'; ctx.beginPath(); ctx.moveTo(X,Y); ctx.lineTo(X+Math.cos(hd-f)*L,Y+Math.sin(hd-f)*L); ctx.lineTo(X+Math.cos(hd+f)*L,Y+Math.sin(hd+f)*L); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.setLineDash([3,4]); ctx.beginPath(); ctx.moveTo(X,Y); ctx.lineTo(S(cam.tx),Sy(cam.ty)); ctx.stroke(); ctx.setLineDash([]);
    mark('cam',cam,cam.x,cam.y,'#e0a94a','камера'); handles.push({kind:'camtg',ref:cam,x:cam.tx,y:cam.ty,r:7}); const TX=S(cam.tx),TY=Sy(cam.ty); ctx.strokeStyle='#e0a94a'; ctx.beginPath(); ctx.moveTo(TX-5,TY); ctx.lineTo(TX+5,TY); ctx.moveTo(TX,TY-5); ctx.lineTo(TX,TY+5); ctx.stroke(); }
  if(ruler){ ctx.strokeStyle='#fff'; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(S(ruler.x0),Sy(ruler.y0)); ctx.lineTo(S(ruler.x1),Sy(ruler.y1)); ctx.stroke(); const d=Math.hypot(ruler.x1-ruler.x0,ruler.y1-ruler.y0), dz=TER.H(ruler.x1,ruler.y1)-TER.H(ruler.x0,ruler.y0); ctx.fillStyle='#fff'; ctx.fillText(`${d.toFixed(1)} м · Δh ${dz>=0?'+':''}${dz.toFixed(1)} м · ${Math.round((Math.atan2(ruler.y1-ruler.y0,ruler.x1-ruler.x0)*180/Math.PI+360)%360)}°`,S(ruler.x1)+8,Sy(ruler.y1)); }
  if(sel){ const h=handles.find(h=>h.kind===sel.kind&&h.ref===sel.ref&&(sel.kind!=='knee'||(h.pts===sel.pts&&h.i===sel.i))); if(h){ ctx.strokeStyle='#e0a94a'; ctx.lineWidth=1.5; ctx.beginPath(); ctx.arc(S(h.x),Sy(h.y),9,0,7); ctx.stroke(); ctx.lineWidth=1; } }
  ctx.fillStyle='rgba(255,255,255,0.5)'; ctx.fillText(`1 px = ${(1/sc).toFixed(2)} м · изогипсы через ${isoStep()} м`,8,H-10); }

// ---------- положение объекта за ручкой: чтение и перемещение ----------
function posOf(h){ return {x:h.x,y:h.y}; }
// площадки: база на каждой — baseAt из кодовой книги; шлюзы — как ориентиры (для подобъектов и ближайшего); смещения площадки — в её осях
function airlocks(){ return LEVEL.sites.map((site,i)=>{ const base=baseAt(site); return {station:true, site, base, i, x:base.airlock.x, y:base.airlock.y, subs:site.subs||[]}; }); }
function toLocal(site,x,y){ const a=(site.ang||0)*Math.PI/180, c=Math.cos(a), s=Math.sin(a); return {dx:Math.round((x*c+y*s)*100)/100, dy:Math.round((-x*s+y*c)*100)/100}; }   // мировое смещение → оси площадки
function layoutsOf(i){ const L=LEVEL.layouts||{}; const ns=Object.keys(L).filter(n=>L[n].includes(i)); return ns.length?ns.map(n=>`${n}: ARK-04${1+L[n].indexOf(i)}`).join(', '):'не занята'; }   // при каких n площадка занята и какой платформой
function moveTo(h,x,y){ switch(h.kind){
  case 'poi': h.ref.x=x; h.ref.y=y; break;
  case 'station': h.ref.x=x; h.ref.y=y; break;   // база едет за площадкой сама — всё в ней задано смещениями
  case 'turret': { const st=h.ref; const l=toLocal(st,x-st.x,y-st.y); st.turret={...(st.turret||{f:0}), ...l}; break; }   // перетащенная штатная турель становится турелью площадки
  case 'sub': if(h.poi.station){ const l=toLocal(h.poi.site,x-h.poi.x,y-h.poi.y); h.ref.dx=l.dx; h.ref.dy=l.dy; } else { h.ref.dx=x-h.poi.x; h.ref.dy=y-h.poi.y; } break;
  case 'ksub': return;   // штатный подобъект базы — из кодовой книги, не двигается
  case 'knee': { const p=h.pts[h.i]; if(!h.br&&h.i>0){ const b=LEVEL.canyon.branch.pts[0]; if(Math.abs(b.x-p.x)<1e-6&&Math.abs(b.y-p.y)<1e-6){ b.x=x; b.y=y; } }   // корень отростка сидит на колене — едет вместе
    p.x=x; p.y=y; TER.reload(); hmDirty(150); break; }
  case 'cam': { const dx=x-h.ref.x, dy=y-h.ref.y; cam.x=x; cam.y=y; cam.tx+=dx; cam.ty+=dy; camShot(); break; }
  case 'camtg': cam.tx=x; cam.ty=y; camShot(); break;
  default: h.ref.x=x; h.ref.y=y; if(h.kind==='decor') TER.reload(); }
  h.x=x; h.y=y; }
function hit(px,py){ let best=null, bd=1e9; for(const h of handles){ const d=Math.hypot(S(h.x)-px,Sy(h.y)-py); const pr=h.kind==='poi'?4:h.kind==='hull'?2:0;   // мелкое — приоритетнее крупного
    if(d<=h.r+4 && d+pr<bd){ bd=d+pr; best=h; } } return best; }
function select(h){ sel=h?{kind:h.kind,ref:h.ref,poi:h.poi,i:h.i,pts:h.pts,w:h.w,br:h.br}:null; renderProps(); draw(); }
function nearestPoi(x,y){ let b=null,bd=1e9; for(const p of [...LEVEL.pois, ...airlocks()]){ const d=Math.hypot(p.x-x,p.y-y); if(d<bd){ bd=d; b=p; } } return b; }
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
  if(d.moved&&d.h.kind==='knee') hmCompute(); if(d.moved&&['poi','sub','decor','hull','wild','lair','station','turret'].includes(d.h.kind)) camShot(); });
cv.addEventListener('dblclick',e=>{ if(hit(e.offsetX,e.offsetY)) return; const wx=iS(e.offsetX), wy=iSy(e.offsetY); const c=TER.canyon(wx,wy); if(!(c.d<c.w/2+2)) return;   // новое колено на расщелине: в ближайший сегмент
  const C=LEVEL.canyon; const pts=c.branch?C.branch.pts:C.pts, w=c.branch?C.branch.w:C.w; let bi=0,bd=1e9; for(let i=0;i<pts.length-1;i++){ const p=pts[i],q=pts[i+1]; const dx=q.x-p.x,dy=q.y-p.y,L2=dx*dx+dy*dy; const t=Math.max(0,Math.min(1,((wx-p.x)*dx+(wy-p.y)*dy)/L2)); const d=Math.hypot(wx-p.x-dx*t,wy-p.y-dy*t); if(d<bd){ bd=d; bi=i; } }
  pushHist(); pts.splice(bi+1,0,{x:snap(wx,e),y:snap(wy,e)}); w.splice(bi+1,0,Math.round(((w[bi]||w[w.length-1])+(w[bi+1]||w[bi]||w[w.length-1]))/2*10)/10); TER.reload(); select({kind:'knee',pts,w,i:bi+1,br:!!c.branch,ref:pts[bi+1]}); hmCompute(); });
function setMode(m){ mode=m; $$('[data-add]').forEach(b=>b.classList.toggle('on',!!(m&&m.add===b.dataset.add))); $('#btn-ruler').classList.toggle('on',m==='ruler'); cv.className=m?'place':''; }
$$('[data-add]').forEach(b=>b.onclick=()=>setMode(mode&&mode.add===b.dataset.add?null:{add:b.dataset.add}));
$('#btn-ruler').onclick=()=>setMode(mode==='ruler'?null:'ruler');
function place(kind,x,y){ const p=kind==='sub'?((sel&&(sel.kind==='poi'?sel.ref:sel.poi))||nearestPoi(x,y)):null;
  if(kind==='sub'&&p.subs.length>=(p.station?10-BASE.subs.length:10)){ setStatus(p.station?`у шлюза не больше 10 подобъектов вместе со штатными ${BASE.subs.length} (id = 160 + k·10 + индекс)`:'у ориентира уже 10 подобъектов (id = id·10 + индекс)','err'); return; }
  if(kind==='poi'&&!+$('#add-poi-type').value){ setStatus('свободных типов ориентиров нет — добавить в codebook.js (1…9)','err'); return; }
  pushHist();
  if(kind==='sub'){ const l=p.station?toLocal(p.site,x-p.x,y-p.y):{dx:x-p.x,dy:y-p.y}; const s={type:+$('#add-sub-type').value,dx:Math.round(l.dx*10)/10,dy:Math.round(l.dy*10)/10}; if(p.station){ p.site.subs=p.site.subs||[]; p.site.subs.push(s); } else p.subs.push(s); select({kind:'sub',ref:s,poi:p,i:(p.station?p.site.subs:p.subs).length-1}); }
  if(kind==='poi'){ const np={id:+$('#add-poi-type').value,x,y,subs:[]}; LEVEL.pois.push(np); LEVEL.pois.sort((a,b)=>a.id-b.id); fillAddSelects(); select({kind:'poi',ref:np}); }
  if(kind==='decor'){ const id=Math.max(7000,...LEVEL.decor.map(d=>d.id))+1; const type=$('#add-decor-type').value; const d={id,type,x,y,f:0,Hs:SPRITES[type].H}; LEVEL.decor.push(d); TER.reload(); select({kind:'decor',ref:d}); }
  if(kind==='hull'){ const h={x,y,r:3,h:3}; LEVEL.hulls.push(h); select({kind:'hull',ref:h}); }
  if(kind==='wild'){ if(LEVEL.pack.members.length>=10){ setStatus('в стае не больше 10 особей (id 250…259)','err'); return; } const m={x,y,size:1,courage:0.5,attention:0.5}; LEVEL.pack.members.push(m); select({kind:'wild',ref:m}); }
  camShot(); }
function del(){ if(!sel) return; const k=sel.kind;
  if(k==='turret'){ if(!sel.ref.turret) return; pushHist(); delete sel.ref.turret; }   // турель площадки → штатная
  else if(k==='sub'){ pushHist(); if(sel.poi.station){ sel.poi.site.subs.splice(sel.i,1); if(!sel.poi.site.subs.length) delete sel.poi.site.subs; } else sel.poi.subs.splice(sel.i,1); }
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
    ['от станции',`${Math.min(...LEVEL.sites.map(st=>Math.hypot(x-st.x,y-st.y))).toFixed(0)} м${Math.min(...LEVEL.sites.map(st=>Math.hypot(x-st.x,y-st.y)))>RETURN_R&&!( $('#boost').checked&&poiOf(3)&&Math.hypot(x-poiOf(3).x,y-poiOf(3).y)<=RETURN_R)?' — за радиусом возврата':''}`],
    ['SNR 0 дБм',snr(l0)],['SNR +10 дБм',snr(l10)]];
  if(sel&&sel.kind!=='cam'&&sel.kind!=='camtg'){ const h=handles.find(h=>h.ref===sel.ref); if(h) rows.push(['до выбранного',`${Math.hypot(h.x-x,h.y-y).toFixed(1)} м`]); }
  $('#cur').innerHTML=rows.map(([k,v])=>`<label>${k}</label><b>${v}</b>`).join(''); }
$('#boost').onchange=()=>draw();
function renderProps(){ const P=$('#props'); if(!sel){ $('#sel-title').textContent=''; P.innerHTML='<span class="dim wide">клик по объекту на карте</span>'; return; }
  const rows=[]; const k=sel.kind, r=sel.ref; const F=(label,get,set,attrs='step="0.1"')=>rows.push({label,html:`<input type="number" value="${num(get())}" ${attrs}>`,on:v=>set(+v)});
  const XY=(o)=>{ F('x',()=>o.x,v=>o.x=v); F('y',()=>o.y,v=>o.y=v); };
  let title='';
  if(k==='turret'){ const i=LEVEL.sites.indexOf(r), B=baseAt(r), T=B.turret; title=`турель площадки ${1+i}${r.turret?'':' · штатная'} · id 230 + k`;   // правка любого поля делает турель площадки; без записи — штатная из BASE
    const own=()=>{ r.turret=r.turret||{dx:BASE.turret.dx,dy:BASE.turret.dy,f:BASE.turret.f}; return r.turret; }; const loc=(x,y)=>toLocal(r,x-r.x,y-r.y);
    F('x',()=>T.x,v=>{ const l=loc(v,T.y); Object.assign(own(),l); }); F('y',()=>T.y,v=>{ const l=loc(T.x,v); Object.assign(own(),l); });
    F('курс, °',()=>T.f,v=>own().f=v-(r.ang||0),'step="1"'); F('сектор, °',()=>T.fov,v=>own().fov=v,'step="5"'); F('дальность, м',()=>T.range,v=>own().range=v,'step="5"'); F('прицел, с',()=>T.aim,v=>own().aim=v,'step="0.5"'); F('перезарядка, с',()=>T.reload,v=>own().reload=v,'step="1"');
    if(r.turret) rows.push({label:'',html:`<button data-act="del" class="ghost">штатная</button>`}); }
  if(k==='ksub'){ title=`штатный объект базы · ${nameOf(r.type)}`; rows.push({label:'',html:`<span class="dim">состав базы — BASE в codebook.js: dx ${r.dx}, dy ${r.dy} от шлюза${r.items?', предметы '+r.items.map(i=>ITEMS[i]).join(', '):''}; id 160 + k·10 + ${sel.i}</span>`}); }
  if(k==='poi'){ title=`ориентир ${r.id} · ${nameOf(r.id)}`; XY(r); rows.push({label:'подобъектов',html:`<span>${r.subs.length} (id ${r.id*10}…${r.id*10+r.subs.length-1})</span>`}); }
  if(k==='sub'){ const st=sel.poi.station?sel.poi.site:null; title=st?`объект 160 + k·10 + ${BASE.subs.length+sel.i} · ${nameOf(r.type)} · площадка ${1+LEVEL.sites.indexOf(st)}`:`объект ${sel.poi.id*10+sel.i} · ${nameOf(r.type)}`; const cb=CODEBOOK[r.type]||{};
    rows.push({label:'тип',html:`<select>${Object.keys(CODEBOOK).filter(t=>t>=10&&t<250).map(t=>`<option value="${t}" ${+t===r.type?'selected':''}>${t} ${CODEBOOK[t].name}</option>`).join('')}</select>`,on:v=>{ r.type=+v; delete r.state; }});
    const A=st?baseAt(st).airlock:sel.poi, w=()=>{ if(!st) return {dx:r.dx,dy:r.dy}; const a=(st.ang||0)*Math.PI/180; return {dx:r.dx*Math.cos(a)-r.dy*Math.sin(a), dy:r.dx*Math.sin(a)+r.dy*Math.cos(a)}; };   // мировое положение: у площадки смещение в её осях
    F('x',()=>A.x+w().dx,v=>{ if(st) Object.assign(r,toLocal(st,v-A.x,w().dy)); else r.dx=Math.round((v-A.x)*100)/100; }); F('y',()=>A.y+w().dy,v=>{ if(st) Object.assign(r,toLocal(st,w().dx,v-A.y)); else r.dy=Math.round((v-A.y)*100)/100; });
    F(st?'dx (оси площадки)':'dx',()=>r.dx,v=>r.dx=v); F(st?'dy (оси площадки)':'dy',()=>r.dy,v=>r.dy=v);
    rows.push({label:'курс',html:`<input type="number" value="${r.f===undefined?'':r.f}" step="5" placeholder="по хешу">`,on:v=>{ if(v==='') delete r.f; else r.f=((+v%360)+360)%360; }});
    if(cb.states&&cb.states.length>1) rows.push({label:'состояние',html:`<select>${cb.states.map((s,i)=>`<option value="${i}" ${i===(r.state||0)?'selected':''}>${i} ${s.slice(0,42)}</option>`).join('')}</select>`,on:v=>{ if(+v) r.state=+v; else delete r.state; }});
    if(cb.container!==undefined) rows.push({label:'предметы',html:`<input type="text" value="${(r.items||[]).join(',')}" placeholder="${Object.entries(ITEMS).map(([i,n])=>i+' '+n).join(', ')}">`,on:v=>{ const a=v.split(/[,\s]+/).map(Number).filter(i=>ITEMS[i]); if(a.length) r.items=a; else delete r.items; }});
    rows.push({label:'в кадре',html:`<span>${SPRITES[r.type]?(SPRITES[r.type].flat?'декаль на земле':'спрайт, '+SPRITES[r.type].H+' м'):'нет спрайта'}</span>`}); }
  if(k==='knee'){ title=`колено ${sel.i}${sel.br?' отростка':''}`; XY(r); if(sel.w[sel.i]!==undefined) F('ширина',()=>sel.w[sel.i],v=>{ sel.w[sel.i]=v; }); rows.push({label:'',html:`<button data-act="knee-add">колено после</button>`}); }
  if(k==='decor'){ title=`декорация ${r.id}`; rows.push({label:'тип',html:`<select>${decorTypes().map(t=>`<option ${t===r.type?'selected':''}>${t}</option>`).join('')}</select>`,on:v=>r.type=v}); XY(r); F('курс',()=>r.f,v=>r.f=v,'step="5"'); F('высота Hs',()=>r.Hs,v=>r.Hs=v); }
  if(k==='hull'){ title='корпус'; XY(r); F('радиус',()=>r.r,v=>r.r=v); F('высота',()=>r.h,v=>r.h=v); }
  if(k==='wild'){ title=`особь ${LEVEL.pack.members.indexOf(r)} (id ${250+LEVEL.pack.members.indexOf(r)})`; XY(r); F('размер',()=>r.size,v=>r.size=v,'step="0.1" min="0.5" max="1.5"'); F('храбрость',()=>r.courage,v=>r.courage=v,'step="0.05" min="0" max="1"'); F('внимательность',()=>r.attention,v=>r.attention=v,'step="0.05" min="0" max="1"'); } if(k==='lair'){ title='логово стаи'; XY(r); }
  if(k==='station'){ const i=LEVEL.sites.indexOf(r); title=`площадка ${1+i}`; XY(r); F('курс',()=>r.ang||0,v=>r.ang=v,'step="5"'); rows.push({label:'платформы',html:`<span>${layoutsOf(i)}</span>`}); rows.push({label:'раскладки',html:`<span class="dim">layouts в level.js: n → площадки; правится в тексте</span>`}); }
  if(k==='cam'||k==='camtg'){ title=k==='cam'?'камера':'цель камеры'; const o=k==='cam'?{get x(){return cam.x},set x(v){cam.x=v},get y(){return cam.y},set y(v){cam.y=v}}:{get x(){return cam.tx},set x(v){cam.tx=v},get y(){return cam.ty},set y(v){cam.ty=v}}; XY(o); }
  if(!['cam','camtg','station','lair','turret','ksub'].includes(k)) rows.push({label:'',html:`<button data-act="del" class="ghost">удалить</button> <button data-act="cam-here" class="ghost">кадр сюда</button>`});
  if(['station','turret','ksub'].includes(k)) rows.push({label:'',html:`<button data-act="cam-here" class="ghost">кадр сюда</button>`});
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
      LEVEL.sites.forEach((st,k)=>{ const B=baseAt(st); out.push({id:900+k,type:'station',x:B.x,y:B.y,facing:B.ang*Math.PI/180}); out.push({id:201+k,type:252,x:B.spawn.x,y:B.spawn.y,facing:0}); out.push({id:230+k,type:34,x:B.turret.x,y:B.turret.y,facing:B.turret.f*Math.PI/180}); B.subs.forEach((s,i)=>{ if(SPRITES[s.type]) out.push({id:160+k*10+i,type:s.type,x:B.airlock.x+s.dx,y:B.airlock.y+s.dy,facing:s.f===undefined?undefined:s.f*Math.PI/180}); }); });
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

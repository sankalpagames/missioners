// РЕДАКТОР УРОВНЯ (editor.html, только localhost). Инструмент, а не игра: читает мир напрямую — уровень, рельеф, камеру, физику линии;
// канала и воркера мира нет, правило «консоль не читает мир» на него не распространяется. Правит LEVEL в памяти,
// кадр свободной камеры рендерит воркер тем же CAM.renderRaw, сохраняет карту в proto/maps/ID.js через POST в serve.py (или текстом для копирования).
// Карта — editor.html?map=ID (нет — act1); список карт — GET /maps у serve.py. «сохранить» пишет в открытую карту и поднимает meta.v;
// «сохранить как…» — новый id → новый файл; импорт файлом лишь подменяет уровень в памяти, на диск — теми же двумя кнопками.
// Слои (формат уровня 2, docs/tech.md §11): тирейн, указатели, объекты, приметы, декор, базы, стая. У каждого — вкладка с правилом слоя и
// инструментами; видимость — флажки над картой; клик выбирает только в видимых слоях. Правила карты (levelLint из codebook.js) — списком.
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const MAX_SLOPE=0.84;   // как в world.js: круче тело не идёт
const RETURN_R=500;     // как в world.js: радиус возврата ПС-2
const cv=$('#map'), ctx=cv.getContext('2d');
let W=1, H=1, cx=120, cy=60, sc=2;                       // вид: центр в метрах, масштаб px/м
const S=(x)=>W/2+(x-cx)*sc, Sy=(y)=>H/2+(y-cy)*sc, iS=(px)=>cx+(px-W/2)/sc, iSy=(py)=>cy+(py-H/2)/sc;
const LAYERS={terrain:'тирейн',pois:'указатели',objects:'объекты',scenery:'приметы',decor:'декор',bases:'базы',pack:'стая'};
const vis={terrain:true,pois:true,objects:true,scenery:true,decor:true,bases:true,pack:true};   // что рисуется и что можно выбрать
let active='objects';                                                                           // вкладка панели
const show={hm:true,iso:true,steep:true,pdecor:false,grid:true,ret:true,labels:true};          // показ: слой высот, изогипсы, непроходимое, процедурный декор, сетка, радиус возврата, подписи
let sel=null, mode=null, drag=null, ruler=null, hover=null;   // mode: null | {add:'obj'|'scenery'|'poi'|'decor'|'bump'|'sub'|'wild'} | 'ruler'
const cam={x:-6,y:-12,tx:16,ty:0,z:1.6,fov:50,light:true,size:160};
let dirty=false; const hist=[];
const COL={poi:'#e0a94a',obj:'#cfd6de',scenery:'#9fb59f',decor:'rgba(220,220,220,0.7)',terrain:'#7fb0ff',pack:'#ff5c5c',bases:'#aaa'};

// ---------- уровень: история, сериализация, сохранение ----------
function pushHist(){ hist.push(JSON.stringify(LEVEL)); if(hist.length>100) hist.shift(); dirty=true; setStatus(''); }
function replaceLevel(obj){ for(const k in LEVEL) delete LEVEL[k]; Object.assign(LEVEL,obj); TER.reload(); hmDirty(); }
function undo(){ if(!hist.length) return; replaceLevel(JSON.parse(hist.pop())); sel=null; renderProps(); draw(); camShot(); }
const num=v=>String(Math.round(v*100)/100);
const nameOf=t=>(CODEBOOK[t]||{}).name||('тип '+t);
function setStatus(t,cls=''){ $('#status').textContent=t; $('#status').className=cls; }
// сохранение: в открытую карту (id из URL), meta.id — по ней, meta.v — на единицу больше, чем на диске. «сохранить как» — тот же текст под новым id. Текст — levelText из codebook.js
const MAP_ID=window.__map;
async function save(id){ id=id||MAP_ID; const L=LEVEL; L.meta={ id, name:$('#map-name').value.trim()||id, v:(id===MAP_ID?(L.meta&&L.meta.v|0):0)+1, format:LEVEL_FORMAT }; const text=levelText(L); setStatus('сохранение…');
  try{ const r=await fetch('maps/'+id+'.js',{method:'POST',body:text}); if(!r.ok) throw new Error(r.status+' '+r.statusText); dirty=false; showMeta(); setStatus(`сохранено maps/${id}.js v${L.meta.v} · ${new Date().toLocaleTimeString('ru')}`,'ok'); if(id!==MAP_ID) location.href='editor.html?map='+id; else loadMapList(); }
  catch(e){ L.meta.v--; setStatus('сервер не принял ('+e.message+') — текст ниже, скопировать в proto/maps/'+id+'.js','err'); showText(); } }
function saveAs(){ const id=prompt('id новой карты (имя файла proto/maps/ID.js, [a-z0-9_-]):',MAP_ID+'-2'); if(id===null) return; if(!/^[a-z0-9_-]{1,32}$/.test(id)||id===MAP_ID){ setStatus('id: латиница, цифры, - и _; не совпадает с открытой','err'); return; }
  if(maps.some(m=>m.id===id)&&!confirm(`Карта ${id} уже есть. Перезаписать?`)) return; save(id); }
function showMeta(){ const M=LEVEL.meta||{}; $('#map-name').value=M.name||''; $('#map-v').textContent=`v${M.v|0} · формат ${M.format}`; document.title=`редактор · ${MAP_ID} v${M.v|0}`; }
let maps=[];
async function loadMapList(){ try{ maps=await fetch('maps').then(r=>r.json()); }catch(e){ maps=[]; }
  if(!maps.some(m=>m.id===MAP_ID)) maps.push({id:MAP_ID,name:'',v:0});
  $('#map-select').innerHTML=maps.map(m=>`<option value="${m.id}"${m.id===MAP_ID?' selected':''}>${m.id}${m.name?' · '+m.name:''} v${m.v|0}${m.format!==LEVEL_FORMAT?' · формат '+m.format:''}</option>`).join(''); }
$('#map-select').onchange=e=>{ const id=e.target.value; if(id===MAP_ID) return; if(dirty&&!confirm('Есть несохранённые правки. Открыть другую карту?')){ e.target.value=MAP_ID; return; } location.href='editor.html?map='+id; };
$('#map-name').oninput=()=>{ dirty=true; };
$('#btn-save-as').onclick=saveAs;
function showText(){ $('#text').value=levelText(LEVEL); $('#textwrap').hidden=false; }
$('#btn-save').onclick=()=>save(); $('#btn-text').onclick=showText; $('#btn-text-close').onclick=()=>$('#textwrap').hidden=true;
$('#btn-copy').onclick=()=>{ navigator.clipboard.writeText($('#text').value); setStatus('скопировано','ok'); };
// импорт и экспорт карт: тот же формат, что proto/maps/ID.js (файл принимает и сервер: node server/index.js … level=ФАЙЛ); импорт — файл или перетаскивание на карту.
// Карта формата 1 — сначала tools/level-convert.js
function exportLevel(){ const name=(LEVEL.meta&&LEVEL.meta.id||MAP_ID)+'.js'; const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([levelText(LEVEL)],{type:'text/javascript'})); a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1000); setStatus('экспорт: '+name,'ok'); }
function importLevel(text,name){ let obj; try{ if(!/^\/\/ УРОВЕНЬ/.test(text)||!/\nconst LEVEL = \{/.test(text)) throw new Error('не файл уровня'); obj=new Function(text+'\nreturn LEVEL;')(); const e=levelCheck(obj); if(e) throw new Error(e+(obj.meta&&obj.meta.format===1?' — перевести: node tools/level-convert.js ФАЙЛ':'')); }
  catch(e){ setStatus('импорт не удался: '+e.message,'err'); return; }
  if(dirty&&!confirm('Есть несохранённые правки. Заменить уровень импортом?')) return;
  pushHist(); replaceLevel(obj); sel=null; fillAddSelects(); renderProps(); draw(); camShot(true); showMeta(); setStatus(`импорт: ${name||'файл'} (${obj.meta.id} v${obj.meta.v}) — не сохранено: «сохранить» → maps/${MAP_ID}.js или «сохранить как…»`,'ok'); }
$('#btn-export').onclick=exportLevel;
$('#btn-import').onclick=()=>$('#file-import').click();
$('#file-import').onchange=e=>{ const f=e.target.files[0]; if(f) f.text().then(t=>importLevel(t,f.name)); e.target.value=''; };
window.addEventListener('dragover',e=>e.preventDefault()); window.addEventListener('drop',e=>{ e.preventDefault(); const f=e.dataTransfer.files[0]; if(f) f.text().then(t=>importLevel(t,f.name)); });
$('#btn-reload').onclick=()=>{ if(!dirty||confirm('Есть несохранённые правки. Перечитать карту с диска?')) location.reload(); };
$('#btn-undo').onclick=undo;
window.addEventListener('beforeunload',e=>{ if(dirty){ e.preventDefault(); e.returnValue=''; } });

// ---------- физика линии в точке: тот же Link, что в игре; расстояние и затухание — как считает мир ----------
const link=new Link();
function tunnelT(x,y){ const c=TER.inside(x,y); return c && c.along>0 ? Math.min(1,c.along/TER.LEN) : -1; }
// узлы связи: площадки и ретрансляторы уровня — все (флажок «все ретрансляторы в сети») или только те, что на старте включены, с питанием,
// на канале 1 (ARK-041) и в пределах дальности от площадки. Линия — к лучшему узлу, как в мире (bestNode): FSPL + разница затуханий − усиление
function relaysOf(){ return LEVEL.objects.filter(o=>(CODEBOOK[o.type]||{}).relay).map(o=>{ const cb=CODEBOOK[o.type]; return {id:o.id,x:o.x,y:o.y,s:o,gain:cb.relay.gain,range:o.range||cb.relay.range}; }); }
function nodesOf(){ const all=$('#relays-on').checked; return [...LEVEL.sites.map(st=>({x:st.x,y:st.y,gain:0})), ...relaysOf().filter(r=>all||(r.s.on&&!r.s.feed&&r.s.powered!==0&&(r.s.freq|0)===1&&LEVEL.sites.some(st=>Math.hypot(r.x-st.x,r.y-st.y)<=r.range)))]; }
function obstAt(x,y){ const tT=tunnelT(x,y); return tT>=0?8+22*tT:0; }
function lineAt(x,y,tx){ let best=null; for(const n of nodesOf()){ const d=Math.max(1,Math.hypot(x-n.x,y-n.y)), o=Math.abs(obstAt(x,y)-obstAt(n.x,n.y)), cost=20*Math.log10(d)+o-n.gain; if(!best||cost<best.cost) best={dist:d,obst:o,gain:n.gain,cost}; }
  link.phys.units[1]={id:1,dist:best.dist,obstDb:best.obst,gain:best.gain,txDbm:tx,alive:true};
  return {snr:link.snrDb(1),cap:link.localCapBps(1),per:link.per(1,72)}; }
function nodeDist(x,y){ return Math.min(...nodesOf().map(n=>Math.hypot(x-n.x,y-n.y))); }

// ---------- карта высот: сетка отсчётов по виду, тон по высоте + светотень, красное — склон круче 40°, изогипсы (marching squares) ----------
const hm={cv:document.createElement('canvas'),box:null,timer:null};
function hmDirty(ms=80){ clearTimeout(hm.timer); hm.timer=setTimeout(hmCompute,ms); }
function isoStep(){ return sc>=5?0.5 : sc>=2?1 : sc>=0.8?2 : 5; }
function hmCompute(){ MAPDRAW.heightmap(hm.cv,{W,H,sc,iS,iSy,hm:show.hm,iso:show.iso,steep:show.steep,isoStep:isoStep(),MAX_SLOPE}); hm.box={x0:iS(0),y0:iSy(0),x1:iS(W),y1:iSy(H)}; draw(); }   // слой высот — общий со спектатором (mapdraw.js)

// ---------- рисование ----------
let handles=[];   // {kind, layer, ref, x, y, r, ...} — что можно схватить; заполняется при рисовании, только для видимых слоёв
const layerOf=o=>o.scenery?'scenery':'objects';
function draw(){ handles=[]; ctx.fillStyle='#000'; ctx.fillRect(0,0,W,H);
  if(hm.box){ const b=hm.box; ctx.drawImage(hm.cv,S(b.x0),Sy(b.y0),(b.x1-b.x0)*sc,(b.y1-b.y0)*sc); }
  ctx.font='11px ui-monospace,Menlo,monospace'; ctx.textBaseline='middle';
  if(show.grid){ const g=sc>=4?10:sc>=1?50:sc>=0.3?100:500; ctx.strokeStyle='rgba(255,255,255,0.08)'; ctx.fillStyle='rgba(255,255,255,0.35)'; ctx.lineWidth=1;
    for(let x=Math.ceil(iS(0)/g)*g;x<=iS(W);x+=g){ ctx.beginPath(); ctx.moveTo(S(x)+0.5,0); ctx.lineTo(S(x)+0.5,H); ctx.stroke(); ctx.fillText(x,S(x)+3,8); }
    for(let y=Math.ceil(iSy(0)/g)*g;y<=iSy(H);y+=g){ ctx.beginPath(); ctx.moveTo(0,Sy(y)+0.5); ctx.lineTo(W,Sy(y)+0.5); ctx.stroke(); ctx.fillText(y,3,Sy(y)-7); } }
  const T=LEVEL.terrain;
  // ---- тирейн: край уровня (углы — ручки), расщелина (полоса, ось, колена), пятна рельефа ----
  if(vis.terrain){
    if(T.bounds){ const b=T.bounds; ctx.setLineDash([2,4]); ctx.strokeStyle='rgba(255,92,92,0.5)'; ctx.strokeRect(S(b.x0),Sy(b.y0),(b.x1-b.x0)*sc,(b.y1-b.y0)*sc); ctx.setLineDash([]);
      [['x0','y0'],['x1','y0'],['x1','y1'],['x0','y1']].forEach(([kx,ky],i)=>{ handles.push({kind:'bound',layer:'terrain',ref:b,kx,ky,i,x:b[kx],y:b[ky],r:6}); ctx.fillStyle='rgba(255,92,92,0.7)'; ctx.fillRect(S(b[kx])-3,Sy(b[ky])-3,7,7); }); }
    const C=T.canyon; const band=(pts,w,col,perSeg)=>{ for(let i=0;i<pts.length-1;i++){ const p=pts[i], q=pts[i+1]; const dx=q.x-p.x, dy=q.y-p.y, L=Math.hypot(dx,dy)||1, nx=-dy/L, ny=dx/L; const w0=(w[i]!==undefined?w[i]:w[w.length-1])/2, w1=perSeg?w0:(w[i+1]!==undefined?w[i+1]:w0*2)/2;
        ctx.fillStyle=col; ctx.beginPath(); ctx.moveTo(S(p.x+nx*w0),Sy(p.y+ny*w0)); ctx.lineTo(S(q.x+nx*w1),Sy(q.y+ny*w1)); ctx.lineTo(S(q.x-nx*w1),Sy(q.y-ny*w1)); ctx.lineTo(S(p.x-nx*w0),Sy(p.y-ny*w0)); ctx.closePath(); ctx.fill(); }
      ctx.strokeStyle='rgba(120,180,255,0.7)'; ctx.lineWidth=1; ctx.beginPath(); pts.forEach((p,i)=>i?ctx.lineTo(S(p.x),Sy(p.y)):ctx.moveTo(S(p.x),Sy(p.y))); ctx.stroke(); };
    band(C.pts,C.w,'rgba(80,140,255,0.18)',false); band(C.branch.pts,C.branch.w,'rgba(80,140,255,0.12)',true);   // ширина: у расщелины — по коленам, у отростка — по сегментам
    const knee=(pts,w,br)=>pts.forEach((p,i)=>{ handles.push({kind:'knee',layer:'terrain',ref:p,pts,w,i,br,x:p.x,y:p.y,r:7}); ctx.fillStyle=COL.terrain; ctx.fillRect(S(p.x)-3,Sy(p.y)-3,7,7); if(show.labels&&sc>=1.5&&w[i]!==undefined){ ctx.fillStyle='rgba(160,200,255,0.8)'; ctx.fillText((br?'отр ':'')+i+' · '+w[i]+' м',S(p.x)+6,Sy(p.y)-8); } });
    knee(C.pts,C.w,false); knee(C.branch.pts,C.branch.w,true);
    for(const b of T.bumps||[]){ handles.push({kind:'bump',layer:'terrain',ref:b,x:b.x,y:b.y,r:Math.max(6,b.r*sc)}); ctx.strokeStyle=b.h>=0?'rgba(200,170,90,0.7)':'rgba(90,150,200,0.7)'; ctx.setLineDash([3,3]); ctx.beginPath(); ctx.arc(S(b.x),Sy(b.y),b.r*sc,0,7); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle=ctx.strokeStyle; ctx.fillRect(S(b.x)-2,Sy(b.y)-2,5,5); if(show.labels&&sc>=1) ctx.fillText(`${b.h>=0?'+':''}${b.h} м`,S(b.x)+6,Sy(b.y)+8); } }
  // радиус возврата: площадки и ретрансляторы в сети (nodesOf)
  if(show.ret){ ctx.setLineDash([6,6]); ctx.strokeStyle='rgba(224,169,74,0.45)'; ctx.lineWidth=1; for(const n of nodesOf()){ ctx.beginPath(); ctx.arc(S(n.x),Sy(n.y),RETURN_R*sc,0,7); ctx.stroke(); } ctx.setLineDash([]); }
  // ---- базы: площадка — призрак базы, как её развернёт хост (корпус из кодовой книги, зона питания, турель сектором, старт), объекты у шлюза ----
  if(vis.bases){ const AIR=airlocks();
    AIR.forEach(A=>{ const st=A.site, B=A.base, i=A.i, X=S(st.x),Y=Sy(st.y); handles.push({kind:'station',layer:'bases',ref:st,x:st.x,y:st.y,r:8}); ctx.strokeStyle='#aaa'; ctx.lineWidth=1; ctx.setLineDash([4,3]); ctx.beginPath(); ctx.ellipse(X,Y,STATION.rx*sc,STATION.ry*sc,(st.ang||0)*Math.PI/180,0,7); ctx.stroke(); ctx.setLineDash([]);
      if(show.labels&&sc>=0.7){ ctx.fillStyle='#aaa'; ctx.fillText(`площадка ${1+i} · ${layoutsOf(i)}`,X-14,Y-STATION.ry*sc-4); }
      ctx.setLineDash([3,5]); ctx.strokeStyle='rgba(255,220,120,0.35)'; ctx.beginPath(); ctx.arc(X,Y,STATION.powerR*sc,0,7); ctx.stroke(); ctx.setLineDash([]);   // зона питания
      const Tu=B.turret; handles.push({kind:'turret',layer:'bases',ref:st,x:Tu.x,y:Tu.y,r:7}); const TX=S(Tu.x),TY=Sy(Tu.y), a=Tu.f*Math.PI/180, fov=Tu.fov*Math.PI/180, R=Tu.range*sc; ctx.fillStyle='rgba(255,220,120,0.06)'; ctx.strokeStyle=st.turret?'rgba(255,220,120,0.4)':'rgba(255,220,120,0.2)'; ctx.beginPath(); ctx.moveTo(TX,TY); ctx.arc(TX,TY,R,a-fov/2,a+fov/2); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.fillStyle=st.turret?'#ffdc78':'rgba(255,220,120,0.5)'; ctx.fillRect(TX-3,TY-3,7,7); if(show.labels&&sc>=1){ ctx.fillText(st.turret?'турель':'турель (штатная)',TX+7,TY+8); }
      const sp=B.spawn; ctx.fillStyle='#5cb85c'; ctx.beginPath(); ctx.arc(S(sp.x),Sy(sp.y),4,0,7); ctx.fill(); if(show.labels&&sc>=1) ctx.fillText('старт',S(sp.x)+7,Sy(sp.y)+1);
      // шлюз — ромб; объекты у шлюза: штатные (BASE) тусклее и не правятся, сюжетные — из площадки
      const on=sel&&(sel.ref===st||(sel.poi&&sel.poi.site===st)); const AX=S(A.x),AY=Sy(A.y); const subs=B.subs, nk=BASE.subs.length;
      if(on){ ctx.strokeStyle='rgba(224,169,74,0.35)'; for(const s of subs){ ctx.beginPath(); ctx.moveTo(AX,AY); ctx.lineTo(S(A.x+s.dx),Sy(A.y+s.dy)); ctx.stroke(); } }
      subs.forEach((s,j)=>{ const x=A.x+s.dx, y=A.y+s.dy, kit=j<nk; handles.push(kit?{kind:'ksub',layer:'bases',ref:BASE.subs[j],poi:A,i:j,x,y,r:6}:{kind:'sub',layer:'bases',ref:st.subs[j-nk],poi:A,i:j-nk,x,y,r:6}); const sx=S(x),sy=Sy(y); ctx.fillStyle=kit?'rgba(207,214,222,0.45)':COL.obj; ctx.beginPath(); ctx.arc(sx,sy,2.5,0,7); ctx.fill();
        if(s.f!==undefined){ const a=s.f*Math.PI/180; ctx.strokeStyle=ctx.fillStyle; ctx.beginPath(); ctx.moveTo(sx,sy); ctx.lineTo(sx+Math.cos(a)*9,sy+Math.sin(a)*9); ctx.stroke(); }
        if(show.labels&&sc>=2.5){ ctx.fillStyle=kit?'rgba(207,214,222,0.45)':'rgba(207,214,222,0.8)'; ctx.fillText(nameOf(s.type),sx+5,sy+5); } });
      ctx.fillStyle='#aaa'; ctx.beginPath(); ctx.moveTo(AX,AY-5); ctx.lineTo(AX+5,AY); ctx.lineTo(AX,AY+5); ctx.lineTo(AX-5,AY); ctx.closePath(); ctx.fill(); if(show.labels&&sc>=0.7) ctx.fillText('ШЛЮЗ',AX+8,AY-8); }); }
  // ---- декор: из уровня — крестики (с коллайдером — круг); процедурный — точки (показ) ----
  if(show.pdecor&&sc>=1){ ctx.fillStyle='rgba(200,200,200,0.35)'; const R=Math.max(W,H)/sc/2+20; for(const o of TER.decor({x:cx,y:cy},R)){ if(LEVEL.decor.some(d=>d.id===o.id)) continue; const r=Math.max(1,(o.Hs||1)*0.4*sc); ctx.beginPath(); ctx.arc(S(o.x),Sy(o.y),r,0,7); ctx.fill(); } }
  if(vis.decor) for(const d of LEVEL.decor){ handles.push({kind:'decor',layer:'decor',ref:d,x:d.x,y:d.y,r:6}); const X=S(d.x),Y=Sy(d.y); ctx.strokeStyle=COL.decor; ctx.beginPath(); ctx.moveTo(X-3,Y-3); ctx.lineTo(X+3,Y+3); ctx.moveTo(X-3,Y+3); ctx.lineTo(X+3,Y-3); ctx.stroke();
    if(d.collider&&d.collider.r>0){ ctx.strokeStyle='rgba(170,170,170,0.8)'; ctx.beginPath(); ctx.arc(X,Y,d.collider.r*sc,0,7); ctx.stroke(); }
    if(show.labels&&sc>=4){ ctx.fillStyle='rgba(200,200,200,0.6)'; ctx.fillText(d.type+' '+d.Hs,X+5,Y+6); } }
  // ---- объекты и приметы: точка (пустой кружок — без спрайта), курс чёрточкой, коллайдер кругом ----
  for(const o of LEVEL.objects){ const lay=layerOf(o); if(!vis[lay]) continue; handles.push({kind:'obj',layer:lay,ref:o,x:o.x,y:o.y,r:6}); const X=S(o.x),Y=Sy(o.y); const col=lay==='scenery'?COL.scenery:COL.obj; const c=objCollider(o);
    if(c){ ctx.strokeStyle='rgba(170,170,170,0.8)'; ctx.beginPath(); ctx.arc(X,Y,c.r*sc,0,7); ctx.stroke(); }
    ctx.fillStyle=col; ctx.strokeStyle=col; ctx.beginPath(); ctx.arc(X,Y,2.5,0,7); if(SPRITES[o.type]) ctx.fill(); else ctx.stroke();
    if(o.f!==undefined){ const a=o.f*Math.PI/180; ctx.beginPath(); ctx.moveTo(X,Y); ctx.lineTo(X+Math.cos(a)*9,Y+Math.sin(a)*9); ctx.stroke(); }
    if(show.labels&&sc>=2.5){ ctx.fillStyle=col; ctx.fillText(`${o.id} ${nameOf(o.type)}`,X+5,Y+5); } }
  // ---- указатели: ромб и имя прописными, как на карте консоли ----
  if(vis.pois) for(const p of LEVEL.pois){ handles.push({kind:'poi',layer:'pois',ref:p,x:p.x,y:p.y,r:8}); const X=S(p.x),Y=Sy(p.y); ctx.strokeStyle=COL.poi; ctx.lineWidth=1.2; ctx.beginPath(); ctx.moveTo(X,Y-10); ctx.lineTo(X+4,Y-6); ctx.lineTo(X,Y-2); ctx.lineTo(X-4,Y-6); ctx.closePath(); ctx.moveTo(X,Y-2); ctx.lineTo(X,Y); ctx.stroke(); ctx.lineWidth=1;
    if(show.labels&&sc>=0.7){ ctx.fillStyle=COL.poi; ctx.fillText(p.name.toUpperCase(),X+7,Y-8); } }
  // ---- стая: особи, логово ----
  const mark=(kind,layer,ref,x,y,col,label)=>{ handles.push({kind,layer,ref,x,y,r:7}); ctx.fillStyle=col; ctx.beginPath(); ctx.arc(S(x),Sy(y),4,0,7); ctx.fill(); if(show.labels&&sc>=1){ ctx.fillText(label,S(x)+7,Sy(y)+1); } };
  if(vis.pack){ LEVEL.pack.members.forEach((m,i)=>mark('wild','pack',m,m.x,m.y,COL.pack,`особь ${i} · ${m.size} / ${m.courage} / ${m.attention}`)); mark('lair','pack',LEVEL.pack.lair,LEVEL.pack.lair.x,LEVEL.pack.lair.y,'#8a3a3a','логово'); }
  // ---- камера (всегда) ----
  { const hd=Math.atan2(cam.ty-cam.y,cam.tx-cam.x), f=cam.fov/2*Math.PI/180, L=25*sc; const X=S(cam.x),Y=Sy(cam.y); ctx.strokeStyle='rgba(224,169,74,0.6)'; ctx.fillStyle='rgba(224,169,74,0.08)'; ctx.beginPath(); ctx.moveTo(X,Y); ctx.lineTo(X+Math.cos(hd-f)*L,Y+Math.sin(hd-f)*L); ctx.lineTo(X+Math.cos(hd+f)*L,Y+Math.sin(hd+f)*L); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.setLineDash([3,4]); ctx.beginPath(); ctx.moveTo(X,Y); ctx.lineTo(S(cam.tx),Sy(cam.ty)); ctx.stroke(); ctx.setLineDash([]);
    mark('cam','cam',cam,cam.x,cam.y,'#e0a94a','камера'); handles.push({kind:'camtg',layer:'cam',ref:cam,x:cam.tx,y:cam.ty,r:7}); const TX=S(cam.tx),TY=Sy(cam.ty); ctx.strokeStyle='#e0a94a'; ctx.beginPath(); ctx.moveTo(TX-5,TY); ctx.lineTo(TX+5,TY); ctx.moveTo(TX,TY-5); ctx.lineTo(TX,TY+5); ctx.stroke(); }
  if(ruler){ ctx.strokeStyle='#fff'; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(S(ruler.x0),Sy(ruler.y0)); ctx.lineTo(S(ruler.x1),Sy(ruler.y1)); ctx.stroke(); const d=Math.hypot(ruler.x1-ruler.x0,ruler.y1-ruler.y0), dz=TER.H(ruler.x1,ruler.y1)-TER.H(ruler.x0,ruler.y0); ctx.fillStyle='#fff'; ctx.fillText(`${d.toFixed(1)} м · Δh ${dz>=0?'+':''}${dz.toFixed(1)} м · ${Math.round((Math.atan2(ruler.y1-ruler.y0,ruler.x1-ruler.x0)*180/Math.PI+360)%360)}°`,S(ruler.x1)+8,Sy(ruler.y1)); }
  if(sel){ const h=handles.find(h=>h.kind===sel.kind&&h.ref===sel.ref&&(sel.kind!=='knee'||(h.pts===sel.pts&&h.i===sel.i))&&(sel.kind!=='bound'||h.i===sel.i)); if(h){ ctx.strokeStyle='#e0a94a'; ctx.lineWidth=1.5; ctx.beginPath(); ctx.arc(S(h.x),Sy(h.y),9,0,7); ctx.stroke(); ctx.lineWidth=1; } }
  ctx.fillStyle='rgba(255,255,255,0.5)'; ctx.fillText(`1 px = ${(1/sc).toFixed(2)} м · изогипсы через ${isoStep()} м`,8,H-10); }

// ---------- положение объекта за ручкой: чтение и перемещение ----------
// площадки: база на каждой — baseAt из кодовой книги; шлюз — точка, от которой считаются объекты у шлюза; смещения площадки — в её осях
function airlocks(){ return LEVEL.sites.map((site,i)=>{ const base=baseAt(site); return {station:true, site, base, i, x:base.airlock.x, y:base.airlock.y}; }); }
function toLocal(site,x,y){ const a=(site.ang||0)*Math.PI/180, c=Math.cos(a), s=Math.sin(a); return {dx:Math.round((x*c+y*s)*100)/100, dy:Math.round((-x*s+y*c)*100)/100}; }   // мировое смещение → оси площадки
function layoutsOf(i){ const L=LEVEL.layouts||{}; const ns=Object.keys(L).filter(n=>L[n].includes(i)); return ns.length?ns.map(n=>`${n}: ARK-04${1+L[n].indexOf(i)}`).join(', '):'не занята'; }   // при каких n площадка занята и какой платформой
function moveTo(h,x,y){ switch(h.kind){
  case 'station': h.ref.x=x; h.ref.y=y; if(h.ref===LEVEL.sites[0]){ TER.reload(); hmDirty(150); } break;   // база едет за площадкой сама — всё в ней задано смещениями; под площадкой 1 — посадочное поле
  case 'turret': { const st=h.ref; const l=toLocal(st,x-st.x,y-st.y); st.turret={...(st.turret||{f:0}), ...l}; break; }   // перетащенная штатная турель становится турелью площадки
  case 'sub': { const l=toLocal(h.poi.site,x-h.poi.x,y-h.poi.y); h.ref.dx=l.dx; h.ref.dy=l.dy; break; }
  case 'ksub': return;   // штатный объект базы — из кодовой книги, не двигается
  case 'knee': { const p=h.pts[h.i]; if(!h.br&&h.i>0){ const b=LEVEL.terrain.canyon.branch.pts[0]; if(Math.abs(b.x-p.x)<1e-6&&Math.abs(b.y-p.y)<1e-6){ b.x=x; b.y=y; } }   // корень отростка сидит на колене — едет вместе
    p.x=x; p.y=y; TER.reload(); hmDirty(150); break; }
  case 'bound': { const b=h.ref; b[h.kx]=x; b[h.ky]=y; if(b.x1<b.x0) [b.x0,b.x1]=[b.x1,b.x0]; if(b.y1<b.y0) [b.y0,b.y1]=[b.y1,b.y0]; break; }
  case 'bump': h.ref.x=x; h.ref.y=y; TER.reload(); hmDirty(150); break;
  case 'cam': { const dx=x-h.ref.x, dy=y-h.ref.y; cam.x=x; cam.y=y; cam.tx+=dx; cam.ty+=dy; camShot(); break; }
  case 'camtg': cam.tx=x; cam.ty=y; camShot(); break;
  default: h.ref.x=x; h.ref.y=y; if(h.kind==='decor') TER.reload(); }
  h.x=x; h.y=y; }
function hit(px,py){ let best=null, bd=1e9; for(const h of handles){ if(h.layer!=='cam'&&!vis[h.layer]) continue; const d=Math.hypot(S(h.x)-px,Sy(h.y)-py); const pr=h.kind==='poi'?4:h.kind==='bump'?3:0;   // мелкое — приоритетнее крупного
    if(d<=h.r+4 && d+pr<bd){ bd=d+pr; best=h; } } return best; }
function select(h){ sel=h?{kind:h.kind,ref:h.ref,poi:h.poi,i:h.i,pts:h.pts,w:h.w,br:h.br,kx:h.kx,ky:h.ky}:null; if(h&&h.layer&&h.layer!=='cam') setActive(h.layer); renderProps(); draw(); }
function nearestSite(x,y){ let b=null,bd=1e9; for(const A of airlocks()){ const d=Math.hypot(A.x-x,A.y-y); if(d<bd){ bd=d; b=A; } } return b; }
function snap(v,e){ const st=e.shiftKey?1:0.1; return Math.round(v/st)*st; }
function freeId(list,lo,hi){ const used=new Set(list.map(o=>o.id)); for(let i=lo;i<=hi;i++) if(!used.has(i)) return i; return 0; }

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
  if(d.moved&&(d.h.kind==='knee'||d.h.kind==='bump')) hmCompute(); if(d.moved&&['poi','obj','sub','decor','wild','lair','station','turret'].includes(d.h.kind)) camShot(); });
cv.addEventListener('dblclick',e=>{ if(hit(e.offsetX,e.offsetY)||!vis.terrain) return; const wx=iS(e.offsetX), wy=iSy(e.offsetY); const c=TER.canyon(wx,wy); if(!(c.d<c.w/2+2)) return;   // новое колено на расщелине: в ближайший сегмент
  const C=LEVEL.terrain.canyon; const pts=c.branch?C.branch.pts:C.pts, w=c.branch?C.branch.w:C.w; let bi=0,bd=1e9; for(let i=0;i<pts.length-1;i++){ const p=pts[i],q=pts[i+1]; const dx=q.x-p.x,dy=q.y-p.y,L2=dx*dx+dy*dy; const t=Math.max(0,Math.min(1,((wx-p.x)*dx+(wy-p.y)*dy)/L2)); const d=Math.hypot(wx-p.x-dx*t,wy-p.y-dy*t); if(d<bd){ bd=d; bi=i; } }
  pushHist(); pts.splice(bi+1,0,{x:snap(wx,e),y:snap(wy,e)}); w.splice(bi+1,0,Math.round(((w[bi]||w[w.length-1])+(w[bi+1]||w[bi]||w[w.length-1]))/2*10)/10); TER.reload(); select({kind:'knee',layer:'terrain',pts,w,i:bi+1,br:!!c.branch,ref:pts[bi+1]}); hmCompute(); });
function setMode(m){ mode=m; $$('[data-add]').forEach(b=>b.classList.toggle('on',!!(m&&m.add===b.dataset.add))); $('#btn-ruler').classList.toggle('on',m==='ruler'); cv.className=m?'place':''; }
$$('[data-add]').forEach(b=>b.onclick=()=>setMode(mode&&mode.add===b.dataset.add?null:{add:b.dataset.add}));
$('#btn-ruler').onclick=()=>setMode(mode==='ruler'?null:'ruler');
function place(kind,x,y){
  if(kind==='sub'){ const A=(sel&&sel.kind==='station')?airlocks()[LEVEL.sites.indexOf(sel.ref)]:(sel&&sel.poi)||nearestSite(x,y); const st=A.site;
    if((st.subs||[]).length>=10-BASE.subs.length){ setStatus(`у шлюза не больше 10 объектов вместе со штатными ${BASE.subs.length} (id = 160 + k·10 + индекс)`,'err'); return; }
    pushHist(); const l=toLocal(st,x-A.x,y-A.y); const s={type:+$('#add-sub-type').value,dx:Math.round(l.dx*10)/10,dy:Math.round(l.dy*10)/10}; st.subs=st.subs||[]; st.subs.push(s); select({kind:'sub',layer:'bases',ref:s,poi:A,i:st.subs.length-1}); }
  if(kind==='obj'||kind==='scenery'){ const id=freeId(LEVEL.objects,IDS.obj[0],IDS.obj[1]); if(!id){ setStatus(`объектов не больше ${IDS.obj[1]} (id ${IDS.obj[0]}…${IDS.obj[1]})`,'err'); return; }
    pushHist(); const o={id,type:+$(kind==='obj'?'#add-obj-type':'#add-scenery-type').value,x,y}; if(kind==='scenery') o.scenery=1; LEVEL.objects.push(o); LEVEL.objects.sort((a,b)=>a.id-b.id); select({kind:'obj',layer:kind==='obj'?'objects':'scenery',ref:o}); }
  if(kind==='poi'){ const id=freeId(LEVEL.pois,IDS.poi[0],IDS.poi[1]); if(!id){ setStatus(`указателей не больше ${IDS.poi[1]-IDS.poi[0]+1}`,'err'); return; }
    pushHist(); const np={id,x,y,name:'место',text:''}; LEVEL.pois.push(np); select({kind:'poi',layer:'pois',ref:np}); }
  if(kind==='decor'){ pushHist(); const id=Math.max(7000,...LEVEL.decor.map(d=>d.id))+1; const type=$('#add-decor-type').value; const d={id,type,x,y,f:0,Hs:SPRITES[type].H}; LEVEL.decor.push(d); TER.reload(); select({kind:'decor',layer:'decor',ref:d}); }
  if(kind==='bump'){ pushHist(); LEVEL.terrain.bumps=LEVEL.terrain.bumps||[]; const b={x,y,r:12,h:2}; LEVEL.terrain.bumps.push(b); TER.reload(); select({kind:'bump',layer:'terrain',ref:b}); hmCompute(); }
  if(kind==='wild'){ if(LEVEL.pack.members.length>=6){ setStatus('в стае не больше 6 особей (id 250…255)','err'); return; } pushHist(); const m={x,y,size:1,courage:0.5,attention:0.5}; LEVEL.pack.members.push(m); select({kind:'wild',layer:'pack',ref:m}); }
  camShot(); }
function del(){ if(!sel) return; const k=sel.kind;
  if(k==='turret'){ if(!sel.ref.turret) return; pushHist(); delete sel.ref.turret; }   // турель площадки → штатная
  else if(k==='sub'){ pushHist(); const st=sel.poi.site; st.subs.splice(sel.i,1); if(!st.subs.length) delete st.subs; }
  else if(k==='obj'){ pushHist(); LEVEL.objects.splice(LEVEL.objects.indexOf(sel.ref),1); }
  else if(k==='poi'){ pushHist(); LEVEL.pois.splice(LEVEL.pois.indexOf(sel.ref),1); }
  else if(k==='decor'){ pushHist(); LEVEL.decor.splice(LEVEL.decor.indexOf(sel.ref),1); TER.reload(); }
  else if(k==='bump'){ pushHist(); LEVEL.terrain.bumps.splice(LEVEL.terrain.bumps.indexOf(sel.ref),1); TER.reload(); hmCompute(); }
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

// ---------- курсор, свойства, правила ----------
function showCursor(x,y){ const z=TER.H(x,y), sl=TER.slope(x,y), c=TER.canyon(x,y), inC=c.d<c.w/2; const l0=lineAt(x,y,0), l10=lineAt(x,y,10);
  const snr=l=>l.snr<-5?`${l.snr.toFixed(1)} дБ — несущей нет`:`${l.snr.toFixed(1)} дБ · ${(l.cap/1000).toFixed(2)} кбит/с · потери ${(l.per*100).toFixed(0)} %`;
  const rows=[['x, y',`${x.toFixed(1)}, ${y.toFixed(1)}`],['высота',`${z.toFixed(2)} м`],['уклон',`${(Math.atan(sl)*180/Math.PI).toFixed(0)}°${sl>MAX_SLOPE?' — непроходимо':''}`],
    ['расщелина',inC?(c.along<0?`подход: ${(-c.along).toFixed(0)} м до входа`:`внутри: ${c.along.toFixed(0)} м от входа${c.branch?', отросток':''}, ширина ${c.w.toFixed(1)}, глубина ${(Math.max(0,tunnelT(x,y))*100).toFixed(0)} % — затухание ${(8+22*Math.max(0,tunnelT(x,y))).toFixed(0)} дБ`):(c.d<c.w/2+4?'стена/кромка':'—')],
    ['от узла',`${nodeDist(x,y).toFixed(0)} м${nodeDist(x,y)>RETURN_R?' — за радиусом возврата':''}`],
    ['SNR 0 дБм',snr(l0)],['SNR +10 дБм',snr(l10)]];
  if(sel&&sel.kind!=='cam'&&sel.kind!=='camtg'){ const h=handles.find(h=>h.ref===sel.ref); if(h) rows.push(['до выбранного',`${Math.hypot(h.x-x,h.y-y).toFixed(1)} м`]); }
  $('#cur').innerHTML=rows.map(([k,v])=>`<label>${k}</label><b>${v}</b>`).join(''); }
$('#relays-on').onchange=()=>draw();
const objTypes=()=>Object.keys(CODEBOOK).filter(t=>t>=10&&t<250);
function renderRules(){ const el=$('#rules'); const L=levelLint(LEVEL); if(!L.length){ el.innerHTML='<div class="okk">нарушений нет</div>'; return; }
  el.innerHTML=L.map((w,i)=>`<div class="${w.info?'info':'warn'}" data-i="${i}">${w.info?'·':'!'} ${w.text}</div>`).join('');
  el.querySelectorAll('[data-i]').forEach(d=>d.onclick=()=>{ const w=L[+d.dataset.i]; const h=handles.find(h=>h.ref===w.ref); if(h){ if(!vis[h.layer]) setVis(h.layer,true); select(h); cx=h.x; cy=h.y; draw(); hmDirty(); } else { const o=w.ref; if(o&&o.x!==undefined){ cx=o.x; cy=o.y; draw(); hmDirty(); } } }); }
function renderProps(){ renderRules(); const P=$('#props'); if(!sel){ $('#sel-title').textContent=''; P.innerHTML='<span class="dim wide">клик по объекту на карте</span>'; return; }
  const rows=[]; const k=sel.kind, r=sel.ref; const F=(label,get,set,attrs='step="0.1"')=>rows.push({label,html:`<input type="number" value="${num(get())}" ${attrs}>`,on:v=>set(+v)});
  const XY=(o)=>{ F('x',()=>o.x,v=>o.x=v); F('y',()=>o.y,v=>o.y=v); };
  // общие поля объекта (уровня или у шлюза): тип, курс, состояние, предметы, ретранслятор, коллайдер, спрайт
  const objFields=(r,cb,feedDefault)=>{
    rows.push({label:'курс',html:`<input type="number" value="${r.f===undefined?'':r.f}" step="5" placeholder="по хешу">`,on:v=>{ if(v==='') delete r.f; else r.f=((+v%360)+360)%360; }});
    if(cb.states&&cb.states.length>1&&!cb.relay) rows.push({label:'состояние',html:`<select>${cb.states.map((s,i)=>`<option value="${i}" ${i===(r.state||0)?'selected':''}>${i} ${s.slice(0,42)}</option>`).join('')}</select>`,on:v=>{ if(+v) r.state=+v; else delete r.state; }});
    if(cb.container!==undefined) rows.push({label:'предметы',html:`<input type="text" value="${(r.items||[]).join(',')}" placeholder="${Object.entries(ITEMS).map(([i,n])=>i+' '+n).join(', ')}">`,on:v=>{ const a=v.split(/[,\s]+/).map(Number).filter(i=>ITEMS[i]); if(a.length) r.items=a; else delete r.items; }});
    if(cb.relay){   // ретранслятор: стартовое состояние узла связи; состояние объекта ставит мир
      rows.push({label:'включён',html:`<input type="checkbox" ${r.on?'checked':''}>`,on:v=>{ if(v) r.on=1; else delete r.on; }});
      rows.push({label:'канал',html:`<input type="number" value="${r.freq||0}" min="0" max="255" step="1" title="1 + номер команды станции; 0 — не настроен">`,on:v=>{ if(+v) r.freq=+v; else delete r.freq; }});
      rows.push({label:'питание',html:`<select><option value="1" ${!r.feed&&r.powered!==0?'selected':''}>есть (автономно)</option><option value="0" ${!r.feed&&r.powered===0?'selected':''}>нет</option><option value="feed" ${r.feed?'selected':''}>от объекта в состоянии</option></select>`,on:v=>{ if(v==='feed'){ r.feed=r.feed||{obj:feedDefault,state:1}; delete r.powered; } else { delete r.feed; if(+v) delete r.powered; else r.powered=0; } }});
      if(r.feed){ rows.push({label:'объект питания',html:`<input type="number" value="${r.feed.obj}" step="1" title="id объекта (например, оборванный кабель)">`,on:v=>r.feed.obj=+v}); rows.push({label:'его состояние',html:`<input type="number" value="${r.feed.state}" step="1" min="0">`,on:v=>r.feed.state=+v}); }
      rows.push({label:'дальность, м',html:`<input type="number" value="${r.range||''}" placeholder="${cb.relay.range}" step="50" min="0">`,on:v=>{ if(+v) r.range=+v; else delete r.range; }});
      rows.push({label:'',html:`<span class="dim">усиление ${cb.relay.gain>=0?'+':''}${cb.relay.gain} дБ (по виду)</span>`}); }
    const tc=cb.collider, own=r.collider; const cmode=own?'own':tc?'type':'none';
    rows.push({label:'коллайдер',html:`<select><option value="type" ${cmode==='type'?'selected':''}>${tc?`по типу: r ${tc.r}, h ${tc.h}`:'по типу: нет'}</option><option value="own" ${cmode==='own'?'selected':''}>свой</option>${tc?`<option value="none" ${cmode==='none'?'selected':''}>нет</option>`:''}</select>`,on:v=>{ if(v==='own') r.collider=r.collider||{r:tc?tc.r:1,h:tc?tc.h:1}; else if(v==='none') r.collider={r:0,h:0}; else delete r.collider; }});
    if(own&&own.r>0){ F('  радиус',()=>own.r,v=>own.r=v); F('  высота',()=>own.h,v=>own.h=v); }
    rows.push({label:'в кадре',html:`<span class="${SPRITES[r.type]?'':'dim'}">${SPRITES[r.type]?(SPRITES[r.type].flat?'плоский рисунок на грунте':'спрайт, '+SPRITES[r.type].H+' м'):'нет спрайта — в кадр не попадает'}</span>`}); };
  let title='';
  if(k==='turret'){ const i=LEVEL.sites.indexOf(r), B=baseAt(r), Tu=B.turret; title=`турель площадки ${1+i}${r.turret?'':' · штатная'} · id 230 + k`;   // правка любого поля делает турель площадки; без записи — штатная из BASE
    const own=()=>{ r.turret=r.turret||{dx:BASE.turret.dx,dy:BASE.turret.dy,f:BASE.turret.f}; return r.turret; }; const loc=(x,y)=>toLocal(r,x-r.x,y-r.y);
    F('x',()=>Tu.x,v=>{ const l=loc(v,Tu.y); Object.assign(own(),l); }); F('y',()=>Tu.y,v=>{ const l=loc(Tu.x,v); Object.assign(own(),l); });
    F('курс, °',()=>Tu.f,v=>own().f=v-(r.ang||0),'step="1"'); F('сектор, °',()=>Tu.fov,v=>own().fov=v,'step="5"'); F('дальность, м',()=>Tu.range,v=>own().range=v,'step="5"'); F('прицел, с',()=>Tu.aim,v=>own().aim=v,'step="0.5"'); F('перезарядка, с',()=>Tu.reload,v=>own().reload=v,'step="1"');
    if(r.turret) rows.push({label:'',html:`<button data-act="del" class="ghost">штатная</button>`}); }
  if(k==='ksub'){ title=`штатный объект базы · ${nameOf(r.type)}`; rows.push({label:'',html:`<span class="dim">состав базы — BASE в codebook.js: dx ${r.dx}, dy ${r.dy} от шлюза${r.items?', предметы '+r.items.map(i=>ITEMS[i]).join(', '):''}; id 160 + k·10 + ${sel.i}</span>`}); }
  if(k==='poi'){ title=`указатель ${r.id}`; rows.push({label:'имя',html:`<input type="text" value="${(r.name||'').replace(/"/g,'&quot;')}">`,on:v=>r.name=v.trim()||'место'}); XY(r);
    rows.push({label:'текст',html:`<textarea placeholder="что видно на месте — про местность, без того, что может измениться">${(r.text||'').replace(/</g,'&lt;')}</textarea>`,on:v=>r.text=v.trim()}); }
  if(k==='obj'){ const cb=CODEBOOK[r.type]||{}; title=`${r.scenery?'примета':'объект'} ${r.id} · ${nameOf(r.type)}`;
    rows.push({label:'тип',html:`<select>${objTypes().map(t=>`<option value="${t}" ${+t===r.type?'selected':''}>${t} ${CODEBOOK[t].name}</option>`).join('')}</select>`,on:v=>{ r.type=+v; delete r.state; }});
    XY(r); objFields(r,cb,r.id);
    rows.push({label:'примета',html:`<input type="checkbox" ${r.scenery?'checked':''} title="объект без функции: слой «приметы» в редакторе, мир разницы не видит">`,on:v=>{ if(v) r.scenery=1; else delete r.scenery; }});
    if(cb.actions) rows.push({label:'',html:`<span class="dim">действия: ${cb.actions.map(a=>a.verb).join('; ')}</span>`}); }
  if(k==='sub'){ const st=sel.poi.site, cb=CODEBOOK[r.type]||{}; title=`объект у шлюза 160 + k·10 + ${BASE.subs.length+sel.i} · ${nameOf(r.type)} · площадка ${1+LEVEL.sites.indexOf(st)}`;
    rows.push({label:'тип',html:`<select>${objTypes().map(t=>`<option value="${t}" ${+t===r.type?'selected':''}>${t} ${CODEBOOK[t].name}</option>`).join('')}</select>`,on:v=>{ r.type=+v; delete r.state; }});
    const A=sel.poi, w=()=>{ const a=(st.ang||0)*Math.PI/180; return {dx:r.dx*Math.cos(a)-r.dy*Math.sin(a), dy:r.dx*Math.sin(a)+r.dy*Math.cos(a)}; };   // мировое положение: смещение в осях площадки
    F('x',()=>A.x+w().dx,v=>Object.assign(r,toLocal(st,v-A.x,w().dy))); F('y',()=>A.y+w().dy,v=>Object.assign(r,toLocal(st,w().dx,v-A.y)));
    F('dx (оси площадки)',()=>r.dx,v=>r.dx=v); F('dy (оси площадки)',()=>r.dy,v=>r.dy=v); objFields(r,cb,1); }
  if(k==='knee'){ title=`колено ${sel.i}${sel.br?' отростка':''}`; XY(r); if(sel.w[sel.i]!==undefined) F('ширина',()=>sel.w[sel.i],v=>{ sel.w[sel.i]=v; }); rows.push({label:'',html:`<button data-act="knee-add">колено после</button>`}); }
  if(k==='bump'){ title='пятно рельефа'; XY(r); F('радиус, м',()=>r.r,v=>r.r=Math.max(0.5,v),'step="1" min="0.5"'); F('высота, м',()=>r.h,v=>r.h=v,'step="0.5"'); rows.push({label:'',html:`<span class="dim">купол: высота h в центре, ноль на радиусе; h < 0 — яма. Крутизна купола ${(Math.atan(1.5*Math.abs(r.h)/r.r)*180/Math.PI).toFixed(0)}°${1.5*Math.abs(r.h)/r.r>MAX_SLOPE?' — склон непроходим':''}</span>`}); }
  if(k==='bound'){ title='край уровня'; F('x0',()=>r.x0,v=>r.x0=v,'step="10"'); F('y0',()=>r.y0,v=>r.y0=v,'step="10"'); F('x1',()=>r.x1,v=>r.x1=v,'step="10"'); F('y1',()=>r.y1,v=>r.y1=v,'step="10"'); }
  if(k==='decor'){ title=`декор ${r.id}`; rows.push({label:'тип',html:`<select>${decorTypes().map(t=>`<option ${t===r.type?'selected':''}>${t}</option>`).join('')}</select>`,on:v=>r.type=v}); XY(r); F('курс',()=>r.f,v=>r.f=v,'step="5"'); F('высота Hs',()=>r.Hs,v=>r.Hs=v);
    const c=r.collider; rows.push({label:'коллайдер',html:`<input type="checkbox" ${c&&c.r>0?'checked':''} title="не пройти; отражает лидар как корпус">`,on:v=>{ if(v) r.collider={r:Math.round(r.Hs*5)/10||1,h:r.Hs}; else delete r.collider; }});
    if(c&&c.r>0){ F('  радиус',()=>c.r,v=>c.r=v); F('  высота',()=>c.h,v=>c.h=v); } }
  if(k==='wild'){ title=`особь ${LEVEL.pack.members.indexOf(r)} (id ${250+LEVEL.pack.members.indexOf(r)})`; XY(r); F('размер',()=>r.size,v=>r.size=v,'step="0.1" min="0.5" max="1.5"'); F('храбрость',()=>r.courage,v=>r.courage=v,'step="0.05" min="0" max="1"'); F('внимательность',()=>r.attention,v=>r.attention=v,'step="0.05" min="0" max="1"'); } if(k==='lair'){ title='логово стаи'; XY(r); }
  if(k==='station'){ const i=LEVEL.sites.indexOf(r); title=`площадка ${1+i}`; XY(r); F('курс',()=>r.ang||0,v=>r.ang=v,'step="5"'); rows.push({label:'платформы',html:`<span>${layoutsOf(i)}</span>`});
    // раскладки (LEVEL.layouts): при n платформах — номера площадок в порядке ARK-041, 042, …; пусто — первые n. Общие для всех площадок, здесь — чтобы править не в тексте
    const LO=LEVEL.layouts||(LEVEL.layouts={}); for(let n=1;n<=LEVEL.sites.length;n++) rows.push({label:`при ${n} платф.`,html:`<input type="text" value="${(LO[n]||[]).map(j=>1+j).join(',')}" placeholder="${[...Array(n).keys()].map(j=>1+j).join(',')} (первые ${n})" title="Номера площадок через запятую: первая — ARK-041, вторая — ARK-042… Пусто — первые ${n}">`,
      on:v=>{ const a=v.split(/[,\s]+/).filter(Boolean).map(x=>+x-1); const ok=a.length===n&&new Set(a).size===n&&a.every(j=>Number.isInteger(j)&&LEVEL.sites[j]); if(ok) LO[n]=a; else delete LO[n]; if(!ok&&v.trim()) alert(`раскладка при ${n}: нужно ${n} разных номеров площадок 1…${LEVEL.sites.length}`); } }); }
  if(k==='cam'||k==='camtg'){ title=k==='cam'?'камера':'цель камеры'; const o=k==='cam'?{get x(){return cam.x},set x(v){cam.x=v},get y(){return cam.y},set y(v){cam.y=v}}:{get x(){return cam.tx},set x(v){cam.tx=v},get y(){return cam.ty},set y(v){cam.ty=v}}; XY(o); }
  if(!['cam','camtg','station','lair','turret','ksub','bound'].includes(k)) rows.push({label:'',html:`<button data-act="del" class="ghost">удалить</button> <button data-act="cam-here" class="ghost">кадр сюда</button>`});
  if(['station','turret','ksub','bound'].includes(k)) rows.push({label:'',html:`<button data-act="cam-here" class="ghost">кадр сюда</button>`});
  $('#sel-title').textContent=title; P.innerHTML=rows.map(r=>`<label>${r.label}</label><span>${r.html}</span>`).join('');
  [...P.querySelectorAll('input,select,textarea')].forEach((el,i)=>{ const row=rows.filter(r=>r.on)[i]; if(!row) return; el.onchange=()=>{ if(!['cam','camtg'].includes(k)) pushHist(); row.on(el.type==='checkbox'?el.checked:el.value); if(['knee','decor','bump'].includes(k)) TER.reload(); if(k==='knee'||k==='bump') hmCompute(); draw(); renderProps(); camShot(); }; });
  P.querySelectorAll('[data-act]').forEach(b=>b.onclick=()=>{ const a=b.dataset.act; if(a==='del') del(); if(a==='cam-here') camToSel(); if(a==='knee-add'){ pushHist(); const p=sel.pts[sel.i], q=sel.pts[sel.i+1]||{x:p.x+10,y:p.y}; sel.pts.splice(sel.i+1,0,{x:(p.x+q.x)/2,y:(p.y+q.y)/2}); sel.w.splice(sel.i+1,0,sel.w[sel.i]); TER.reload(); select({kind:'knee',layer:'terrain',pts:sel.pts,w:sel.w,i:sel.i+1,br:sel.br,ref:sel.pts[sel.i+1]}); hmCompute(); } }); }
function decorTypes(){ return Object.keys(SPRITES).filter(k=>isNaN(+k)&&!['sleep','walk','station'].includes(k)); }
function fillAddSelects(){ const opts=objTypes().map(t=>`<option value="${t}">${t} ${CODEBOOK[t].name}</option>`).join('');
  $('#add-obj-type').innerHTML=opts; $('#add-sub-type').innerHTML=opts;
  $('#add-scenery-type').innerHTML=objTypes().filter(t=>!CODEBOOK[t].actions&&CODEBOOK[t].container===undefined&&!CODEBOOK[t].relay).map(t=>`<option value="${t}">${t} ${CODEBOOK[t].name}</option>`).join('');   // примета — тип без действий и содержимого
  $('#add-decor-type').innerHTML=decorTypes().map(t=>`<option>${t}</option>`).join(''); }

// ---------- свободная камера: кадр рендерит воркер (level + codebook + terrain + camera, без world.js), сцена — весь уровень без правил видимости ----------
const camW=(()=>{ const base=new URL('.',location.href).href, v=window.__v;
  const src=`importScripts(${['maps/'+MAP_ID+'.js','codebook.js','terrain.js','camera.js'].map(f=>JSON.stringify(base+f+'?v='+v)).join(',')});
    const ready=CAM.load(${JSON.stringify(String(v))},${JSON.stringify(base)});
    function scene(u){ const out=[]; for(const o of LEVEL.objects){ if(SPRITES[o.type]) out.push({id:o.id,type:o.type,x:o.x,y:o.y,facing:o.f===undefined?undefined:o.f*Math.PI/180}); }
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

// ---------- слои: вкладки панели (активный слой), флажки видимости над картой, показ; размер, старт ----------
function setActive(l){ active=l; if(!vis[l]) setVis(l,true); $$('#ltabs button').forEach(b=>b.classList.toggle('on',b.dataset.lay===l)); $$('.lay').forEach(d=>d.classList.toggle('on',d.dataset.lay===l)); setMode(null); }
function setVis(l,v){ vis[l]=v; const c=$(`#lvis input[data-vis="${l}"]`); if(c) c.checked=v; $$('#ltabs button').forEach(b=>{ if(b.dataset.lay===l) b.classList.toggle('off',!v); }); if(!v&&sel){ const h=handles.find(h=>h.ref===sel.ref); if(h&&h.layer===l) select(null); } draw(); }
$('#ltabs').innerHTML=Object.entries(LAYERS).map(([k,n])=>`<button data-lay="${k}">${n}</button>`).join('');
$('#lvis').innerHTML=Object.entries(LAYERS).map(([k,n])=>`<label><input type="checkbox" data-vis="${k}" checked> ${n}</label>`).join('');
$$('#ltabs button').forEach(b=>b.onclick=()=>setActive(b.dataset.lay));
$$('#lvis input').forEach(c=>c.onchange=()=>setVis(c.dataset.vis,c.checked));
$$('[data-show]').forEach(c=>c.onchange=()=>{ show[c.dataset.show]=c.checked; if(['hm','iso','steep'].includes(c.dataset.show)) hmCompute(); else draw(); });
function fit(){ const r=$('#mapwrap').getBoundingClientRect(); W=cv.width=Math.max(1,Math.floor(r.width)); H=cv.height=Math.max(1,Math.floor(r.height)); draw(); hmDirty(); }
new ResizeObserver(fit).observe($('#mapwrap'));
fillAddSelects(); setActive('objects'); fit(); camShot(true); showMeta(); loadMapList(); renderRules();

// СПЕКТАТОР (spectate.html). Проигрывает лог мира (tech.md §12) постфактум: правда о положениях из записей `phys` раз в секунду
// (положения между ними — интерполяция), крики, заметки, лента агента стаи и его намерения, события операторам. Инструмент, не
// игра: читает уровень и рельеф напрямую (как редактор), сервера не требует — файл лога открывается локально;
// на сервере ?room=КОД — тот же лог живьём по WebSocket, без перемотки (tech.md §12). Мир в логе
// записан по карте на момент сеанса: запись start (и live с сервера) несёт map {id, v}; страница стартует с maps/act1.js и, если карта
// другая, подгружает maps/ID.js и подменяет LEVEL; если ревизия v с тех пор выросла, подложка может разойтись с записью — в ленте есть заметка.
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const MAX_SLOPE=0.84;
const cv=$('#map'), ctx=cv.getContext('2d');
let W=1, H=1, cx=180, cy=100, sc=1.2;
const S=(x)=>W/2+(x-cx)*sc, Sy=(y)=>H/2+(y-cy)*sc, iS=(px)=>cx+(px-W/2)/sc, iSy=(py)=>cy+(py-H/2)/sc;
const layers={hm:true,iso:true,grid:false,labels:true,sectors:true,targets:true,senses:true,ret:true};
const hm={cv:document.createElement('canvas'),box:null,timer:null};
function isoStep(){ return sc>=5?0.5 : sc>=2?1 : sc>=0.8?2 : 5; }
function hmDirty(ms=80){ clearTimeout(hm.timer); hm.timer=setTimeout(()=>{ MAPDRAW.heightmap(hm.cv,{W,H,sc,iS,iSy,hm:layers.hm,iso:layers.iso,steep:true,isoStep:isoStep(),MAX_SLOPE}); hm.box={x0:iS(0),y0:iSy(0),x1:iS(W),y1:iSy(H)}; draw(); },ms); }

// ---------- лог ----------
// Два источника одних и тех же строк JSONL: файл (постфактум, с ползунком) и сервер живьём (spectate.html?room=КОД: WebSocket
// /ws?room=КОД&spectate=1 — хвост лога при входе, дальше каждая запись по мере появления; «сейчас» держится на секунду позади
// последней записи phys, чтобы положения интерполировались, перемотки нет). Зритель — не оператор: мир от него не идёт.
let frames=[], events=[], cries=[], t0=0, t1=0, cur=0, playing=false, speed=4, pinned=null, hover=null, feedIdx=-1;
let nSt=LEVEL.sites.length;   // сколько платформ было в сеансе — из записи start; базы рисуются по раскладке уровня (LEVEL.layouts), как их поднял хост
const live={ on:false, code:null, ws:null, lastPhys:0, connected:false, first:true, centered:false };   // lastPhys — стенное время последней phys: мир идёт, если она недавняя
const LIVE_KEEP=7200;   // живьём: сколько записей phys держать в памяти (2 ч мира); лента — 5000 строк
const bases=()=>sitesFor(LEVEL,nSt).map((si,k)=>({k, ...baseAt(LEVEL.sites[si])}));
const ACT_RU={sleep:'спит',idle:'стоит',freeze:'замерла',approach:'подходит',attack:'нападает',back:'отходит',flee:'бежит',home:'домой',rest:'передышка',goto:'идёт',stay:'ждёт',dead:'мертва'};
function b64(s){ const b=atob(s); const a=new Uint8Array(b.length); for(let i=0;i<b.length;i++) a[i]=b.charCodeAt(i); return a; }
function reset(){ frames=[]; events=[]; cries=[]; pinned=hover=null; feedIdx=-1; }
// одна запись лога → кадр phys, крик, строка ленты. Лента держится по времени: вставка с конца (записи идут почти по порядку)
function ev(e){ let i=events.length; while(i>0&&events[i-1].t>e.t) i--; events.splice(i,0,e); if(live.on&&events.length>5000) events.splice(0,events.length-5000); }   // вставка по времени с конца: записи идут почти по порядку
function parseLine(line){ if(!line.trim()) return; let r; try{ r=JSON.parse(line); }catch(e){ return; } const t=+r.t||0;
  if(r.k==='phys'){ frames.push({t, units:r.units||[], pack:r.pack||[], turrets:r.turrets||[], relays:r.relays||[], ground:r.ground||[]}); if(live.on){ live.lastPhys=performance.now(); if(frames.length>LIVE_KEEP) frames.splice(0,frames.length-LIVE_KEEP); } return; }
  if(r.k==='agent'){ ev({t:r.at??t, cls:'pack', text:`О${r.who}: ${r.text}`}); return; }
  if(r.k==='agentAck'){ ev({t, cls:'ack', text:`→ «${r.line}» — ${r.ok?'принято':'отказано'}${r.why?': '+r.why:''}`}); return; }
  if(r.k==='note'){ if(r.kind==='cry'){ cries.push({t, x:r.x, y:r.y, who:r.who, word:r.word}); if(cries.length>500) cries.splice(0,cries.length-500); ev({t, cls:'cry', text:`крик О${r.who+1} «${r.word}»${r.heard&&r.heard.length?' — слышали О'+r.heard.map(i=>i+1).join(', О'):' — никто не слышал'}`}); }
    else if(r.kind==='turret'&&r.shot) ev({t, cls:'shot', text:`турель ARK-04${1+(r.st||0)}: выстрел по ${r.shot}`});
    else if(r.kind==='turret') ev({t, cls:'note', text:`турель ARK-04${1+(r.st||0)}: захват ${r.lock}`});
    else if(r.kind==='relay'&&r.reach!==undefined) ev({t, cls:'note', text:`ретранслятор ${r.id}: ${r.reach?'в сети':'вне сети'} ARK-04${1+(r.st||0)} (${r.d} м из ${r.range}, канал ${r.freq})`});
    else if(r.kind==='relay'&&r.by!==undefined) ev({t, cls:'note', text:`ретранслятор ${r.id}: ${r.on?'включён':'выключен'}, канал ${r.freq} — ${r.by==='станция'?'ARK-04'+(1+r.st):'М'+r.by}`});
    else { const {k,t:_,at,kind,...rest}=r; ev({t, cls:'note', text:`${kind}: ${Object.entries(rest).map(([a,b])=>a+'='+(typeof b==='object'?JSON.stringify(b):b)).join(' ')}`}); } return; }
  if(r.k==='pkt'&&r.kind==='EVT'){ const b=b64(r.b); ev({t:r.at??t, cls:'op', text:`ARK-04${1+(r.st||0)}: событие ${b[0]}${r.unit?' М'+r.unit:''} — ${EVENTS[b[0]]||'?'}${b[1]?' ('+b[1]+')':''}`}); return; }
  if(r.k==='up'){ ev({t, cls:'op', text:`ARK-04${1+(r.st||0)}: команда ${r.bytes[0]}${r.bytes[2]?' М'+r.bytes[2]:''} (${r.bytes[1]})`}); return; }
  if(r.k==='op'){ ev({t, cls:'op', text:r.join?`оператор ${r.join} вошёл (ARK-04${1+(r.st||0)})`:`оператор ${r.leave} вышел`}); return; }
  if(r.k==='start'){ const n=r.n||(r.cfg&&r.cfg.n); if(r.map) useMap(r.map,t); if(n) nSt=Math.max(1,Math.min(LEVEL.sites.length,n)); if(live.on&&r.cfg&&r.cfg.speed) speed=r.cfg.speed; ev({t, cls:'note', text:`начало: ${r.host}${r.code?' '+r.code:''}, платформ ${n||'?'}${r.map?`, карта ${r.map.id} v${r.map.v}`:''}${r.wall?', '+r.wall:''}`}); return; }
  if(r.k==='live'){ if(r.map) useMap(r.map,t); if(r.n) nSt=Math.max(1,Math.min(LEVEL.sites.length,r.n)); if(r.speed) speed=r.speed; if(r.running) live.lastPhys=performance.now(); return; }   // первая запись от сервера зрителю
  if(r.k==='speed'){ if(live.on) speed=r.v; ev({t, cls:'note', text:`ускорение ×${r.v}`}); }
  if(r.k==='fault'){ ev({t, cls:'note', text:`СБОЙ ${r.where}: ${r.text}`}); } }
// карта записи: другая, чем на странице, — подгрузить maps/ID.js и подменить LEVEL (рельеф пересчитать); та же, но другой ревизии — заметка в ленте
let mapWanted=null;
function useMap(m,t){ if(!m||!m.id||!/^[a-z0-9_-]{1,32}$/.test(m.id)) return; const cur=LEVEL.meta||{};
  if(m.id===cur.id){ if(m.v!==undefined&&m.v!==cur.v) ev({t, cls:'note', text:`карта ${m.id}: запись v${m.v}, на странице v${cur.v} — подложка может расходиться`}); return; }
  if(mapWanted===m.id) return; mapWanted=m.id;
  fetch('maps/'+m.id+'.js').then(r=>{ if(!r.ok) throw new Error(r.status); return r.text(); }).then(text=>{ if(!/^\/\/ УРОВЕНЬ/.test(text)) throw new Error('не файл уровня'); const L=new Function(text+'\nreturn LEVEL;')(); const e=levelCheck(L); if(e) throw new Error(e);
      for(const k in LEVEL) delete LEVEL[k]; Object.assign(LEVEL,L); TER.reload(); nSt=Math.min(nSt,LEVEL.sites.length); ev({t, cls:'note', text:`карта ${L.meta.id} v${L.meta.v} загружена`+(m.v!==undefined&&m.v!==L.meta.v?` (запись v${m.v})`:'')}); hmDirty(0); draw(); })
    .catch(e=>{ ev({t, cls:'note', text:`карта ${m.id} не загружена (${e.message}) — подложка от ${cur.id}`}); draw(); }); }
function span(){ t0=frames.length?frames[0].t:0; t1=frames.length?frames[frames.length-1].t:(events.length?events[events.length-1].t:0); }
function center(){ if(frames.length){ const f=frames[0]; const pts=[...f.units,...f.pack]; if(pts.length){ cx=pts.reduce((a,p)=>a+p.x,0)/pts.length; cy=pts.reduce((a,p)=>a+p.y,0)/pts.length; } } }
function load(text){
  reset(); for(const line of text.split('\n')) parseLine(line);
  events.sort((a,b)=>a.t-b.t); cries.sort((a,b)=>a.t-b.t); span(); cur=t0;
  $('#seek').min=t0; $('#seek').max=t1; $('#drop').hidden=true; document.title=`спектатор · ${Math.round(t1-t0)} с`;
  center(); hmDirty(0); renderFeed(true); setPlaying(false); }
// живьём: строки от сервера — в те же структуры; первая порция (хвост лога) — как файл, дальше «сейчас» догоняет t1 в loop
function liveConnect(code){ live.on=true; live.code=code; live.first=true; reset(); document.body.classList.add('live'); $('#drop').hidden=true; document.title=`спектатор · ${code} · живьём`; liveStatus();
  const url=`${location.protocol==='https:'?'wss':'ws'}://${location.host}/ws?room=${encodeURIComponent(code)}&spectate=1`; const ws=live.ws=new WebSocket(url);
  ws.onopen=()=>{ live.connected=true; liveStatus(); };
  ws.onmessage=e=>{ for(const line of String(e.data).split('\n')) parseLine(line); span();
    if(live.first){ live.first=false; cur=Math.max(t0,t1-1); if(!live.centered){ live.centered=true; center(); } hmDirty(0); renderFeed(true); } };
  ws.onclose=()=>{ live.connected=false; liveStatus(); setTimeout(()=>{ if(live.ws===ws) liveConnect(code); },3000); };   // переподключение: сервер дошлёт хвост заново, поэтому кадры и лента собираются с нуля (reset в liveConnect); камера остаётся где была
  ws.onerror=()=>ws.close(); }
function liveStatus(){ const running=live.connected&&performance.now()-live.lastPhys<3000; const E=$('#livest'); E.textContent=!live.connected?'нет связи с сервером':running?'мир идёт':'мир стоит'; E.className='when-live '+(!live.connected?'bad':running?'ok':'dim'); }
const mmss=t=>`${String(Math.floor(t/60)).padStart(2,'0')}:${String(Math.floor(t%60)).padStart(2,'0')}`;

// кадр на момент cur: соседние записи phys и интерполяция положений
function frameAt(t){ if(!frames.length) return null; let lo=0, hi=frames.length-1; while(lo<hi){ const m=(lo+hi+1)>>1; if(frames[m].t<=t) lo=m; else hi=m-1; }
  const a=frames[lo], b=frames[lo+1]; if(!b||b.t-a.t>2.5||t<=a.t) return a; const k=(t-a.t)/(b.t-a.t);
  const mix=(pa,pb)=>({...pa, x:pa.x+(pb.x-pa.x)*k, y:pa.y+(pb.y-pa.y)*k});
  return { t, units:a.units.map(u=>{ const v=b.units.find(v=>v.id===u.id); return v&&u.alive?mix(u,v):u; }), pack:a.pack.map(p=>{ const q=b.pack[p.i]; return q&&p.act!=='dead'?mix(p,q):p; }), turrets:a.turrets, relays:a.relays, ground:a.ground }; }

// ---------- рисование ----------
const UCOL=['#7fe07f','#5fd0ff','#e0a94a','#d98cff','#ff9f5f'];
function draw(){ ctx.fillStyle='#000'; ctx.fillRect(0,0,W,H);
  if(hm.box){ const b=hm.box; ctx.drawImage(hm.cv,S(b.x0),Sy(b.y0),(b.x1-b.x0)*sc,(b.y1-b.y0)*sc); }
  ctx.font='11px ui-monospace,Menlo,monospace'; ctx.textBaseline='middle'; ctx.lineWidth=1;
  if(layers.grid){ const g=sc>=4?10:sc>=1?50:sc>=0.3?100:500; ctx.strokeStyle='rgba(255,255,255,0.08)'; ctx.fillStyle='rgba(255,255,255,0.35)';
    for(let x=Math.ceil(iS(0)/g)*g;x<=iS(W);x+=g){ ctx.beginPath(); ctx.moveTo(S(x)+0.5,0); ctx.lineTo(S(x)+0.5,H); ctx.stroke(); ctx.fillText(x,S(x)+3,8); }
    for(let y=Math.ceil(iSy(0)/g)*g;y<=iSy(H);y+=g){ ctx.beginPath(); ctx.moveTo(0,Sy(y)+0.5); ctx.lineTo(W,Sy(y)+0.5); ctx.stroke(); ctx.fillText(y,3,Sy(y)-7); } }
  // расщелина
  const C=LEVEL.canyon; const band=(pts,w,col,perSeg)=>{ for(let i=0;i<pts.length-1;i++){ const p=pts[i], q=pts[i+1]; const dx=q.x-p.x, dy=q.y-p.y, L=Math.hypot(dx,dy)||1, nx=-dy/L, ny=dx/L; const w0=(w[i]!==undefined?w[i]:w[w.length-1])/2, w1=perSeg?w0:(w[i+1]!==undefined?w[i+1]:w[w.length-1])/2;
      ctx.fillStyle=col; ctx.beginPath(); ctx.moveTo(S(p.x+nx*w0),Sy(p.y+ny*w0)); ctx.lineTo(S(q.x+nx*w1),Sy(q.y+ny*w1)); ctx.lineTo(S(q.x-nx*w1),Sy(q.y-ny*w1)); ctx.lineTo(S(p.x-nx*w0),Sy(p.y-ny*w0)); ctx.closePath(); ctx.fill(); } };
  band(C.pts,C.w,'rgba(80,140,255,0.18)',false); band(C.branch.pts,C.branch.w,'rgba(80,140,255,0.12)',true);
  if(LEVEL.bounds){ const b=LEVEL.bounds; ctx.setLineDash([2,4]); ctx.strokeStyle='rgba(255,92,92,0.5)'; ctx.strokeRect(S(b.x0),Sy(b.y0),(b.x1-b.x0)*sc,(b.y1-b.y0)*sc); ctx.setLineDash([]); }   // край уровня
  if(layers.ret){ ctx.setLineDash([6,6]); ctx.strokeStyle='rgba(224,169,74,0.45)'; const f0=frameAt(cur); for(const n of [...bases(), ...((f0&&f0.relays)||[]).filter(R=>R.linked.length)]){ ctx.beginPath(); ctx.arc(S(n.x),Sy(n.y),500*sc,0,7); ctx.stroke(); } ctx.setLineDash([]); }   // радиус возврата ПС-2: площадки и ретрансляторы-узлы из phys
  // платформы, корпуса, ориентиры, логово
  for(const B of bases()){ const X=S(B.x),Y=Sy(B.y); ctx.strokeStyle='#aaa'; ctx.beginPath(); ctx.ellipse(X,Y,STATION.rx*sc,STATION.ry*sc,B.ang*Math.PI/180,0,7); ctx.stroke(); if(layers.labels&&sc>=0.5){ ctx.fillStyle='#aaa'; ctx.fillText('ARK-04'+(1+B.k),X-14,Y-STATION.ry*sc-6); } }
  for(const h of LEVEL.hulls){ ctx.strokeStyle='#aaa'; ctx.beginPath(); ctx.arc(S(h.x),Sy(h.y),h.r*sc,0,7); ctx.stroke(); }
  for(const p of LEVEL.pois){ const X=S(p.x),Y=Sy(p.y); ctx.fillStyle='rgba(127,224,127,0.6)'; ctx.beginPath(); ctx.moveTo(X,Y-4); ctx.lineTo(X+4,Y); ctx.lineTo(X,Y+4); ctx.lineTo(X-4,Y); ctx.closePath(); ctx.fill(); if(layers.labels&&sc>=0.5){ ctx.fillStyle='rgba(127,224,127,0.6)'; ctx.fillText(CODEBOOK[p.id].name,X+7,Y-7); } }
  { const L=LEVEL.pack.lair; ctx.strokeStyle='#8a3a3a'; ctx.beginPath(); ctx.arc(S(L.x),Sy(L.y),Math.max(4,3*sc),0,7); ctx.stroke(); if(layers.labels&&sc>=1){ ctx.fillStyle='#8a3a3a'; ctx.fillText('логово',S(L.x)+7,Sy(L.y)); } }
  const f=frameAt(cur); if(!f){ return; }
  // турели: сектор и захват
  for(const B of bases()){ ctx.setLineDash([3,5]); ctx.strokeStyle='rgba(255,220,120,0.3)'; ctx.beginPath(); ctx.arc(S(B.x),Sy(B.y),STATION.powerR*sc,0,7); ctx.stroke(); ctx.setLineDash([]); }   // зона питания
  for(const [k,T] of f.turrets.entries()){ if(!T) continue; const X=S(T.x),Y=Sy(T.y); const live=T.on!==false&&T.powered!==false&&!T.broken;
    if(layers.sectors){ ctx.fillStyle=live?'rgba(255,220,120,0.07)':'rgba(120,120,120,0.05)'; ctx.strokeStyle=live?'rgba(255,220,120,0.35)':'rgba(120,120,120,0.3)'; ctx.beginPath(); ctx.moveTo(X,Y); ctx.arc(X,Y,T.range*sc,T.ang-T.fov/2,T.ang+T.fov/2); ctx.closePath(); ctx.fill(); ctx.stroke(); }
    ctx.fillStyle=T.broken?'#8a3a3a':live?'#ffdc78':'#777'; ctx.fillRect(X-3,Y-3,7,7);
    if(T.tgt){ const o=T.tgt.p!==undefined?f.pack[T.tgt.p]:f.units.find(u=>u.id===T.tgt.u); if(o){ ctx.strokeStyle='rgba(255,220,120,0.9)'; ctx.lineWidth=1.5; ctx.beginPath(); ctx.moveTo(X,Y); ctx.lineTo(S(o.x),Sy(o.y)); ctx.stroke(); ctx.lineWidth=1; ctx.strokeStyle='#ffdc78'; ctx.beginPath(); ctx.arc(S(o.x),Sy(o.y),9,-Math.PI/2,-Math.PI/2+Math.PI*2*Math.min(1,T.aim/3)); ctx.stroke(); } }
    if(layers.labels&&sc>=1) { ctx.fillStyle='#ffdc78'; ctx.fillText(`турель${T.ammo!==undefined?' · '+T.ammo:''}${T.rel>0?' · перезарядка':''}${T.cut!=null?' · режут':''}`,X+7,Y+8); } }
  // ретрансляторы: ромб, включённый — залитый; в сети какой платформы — подпись
  for(const R of f.relays||[]){ const X=S(R.x),Y=Sy(R.y), r=R.kind==='переносной'?4:5; ctx.beginPath(); ctx.moveTo(X,Y-r); ctx.lineTo(X+r,Y); ctx.lineTo(X,Y+r); ctx.lineTo(X-r,Y); ctx.closePath(); ctx.strokeStyle=R.powered?'#e0a94a':'#777'; if(R.on&&R.powered){ ctx.fillStyle='#e0a94a'; ctx.fill(); } ctx.stroke();
    if(layers.labels&&sc>=1){ ctx.fillStyle='#e0a94a'; ctx.fillText(`ретр. ${R.id} · канал ${R.freq||'—'}${R.linked.length?' · узел ARK-04'+R.linked.map(k=>1+k).join('/'):''}`,X+7,Y+8); } }
  // свёртки
  for(const g of f.ground){ const X=S(g.x),Y=Sy(g.y); ctx.fillStyle='#cfd6de'; ctx.beginPath(); ctx.moveTo(X,Y-3); ctx.lineTo(X+3,Y); ctx.lineTo(X,Y+3); ctx.lineTo(X-3,Y); ctx.closePath(); ctx.fill(); if(layers.labels&&sc>=2){ ctx.fillStyle='rgba(207,214,222,0.8)'; ctx.fillText(g.items.map(i=>ITEMS[i]).join(', '),X+6,Y); } }
  // крики: кольцо расходится 6 с
  for(const c of cries){ const age=cur-c.t; if(age<0||age>6) continue; const m=LEVEL.pack.members[c.who]||{size:1}; const R=120*(0.8+0.4*m.size)*age/6; ctx.strokeStyle=`rgba(255,92,92,${0.6*(1-age/6)})`; ctx.beginPath(); ctx.arc(S(c.x),Sy(c.y),R*sc,0,7); ctx.stroke(); if(age<3){ ctx.fillStyle='#ff5c5c'; ctx.fillText(`«${c.word}»`,S(c.x)+8,Sy(c.y)-10); } }
  // тела
  for(const u of f.units){ const X=S(u.x),Y=Sy(u.y), col=u.alive?UCOL[(u.id-1)%UCOL.length]:'#666';
    if(layers.senses&&u.alive&&u.light){ ctx.fillStyle='rgba(255,255,200,0.05)'; ctx.beginPath(); ctx.moveTo(X,Y); ctx.arc(X,Y,25*sc,u.h-0.45,u.h+0.45); ctx.closePath(); ctx.fill(); }
    if(layers.targets&&u.tg){ ctx.setLineDash([3,4]); ctx.strokeStyle=col; ctx.beginPath(); ctx.moveTo(X,Y); ctx.lineTo(S(u.tg[0]),Sy(u.tg[1])); ctx.stroke(); ctx.setLineDash([]); }
    ctx.fillStyle=col; ctx.fillRect(X-3,Y-3,7,7); if(u.alive){ ctx.strokeStyle=col; ctx.beginPath(); ctx.moveTo(X,Y); ctx.lineTo(X+Math.cos(u.h)*9,Y+Math.sin(u.h)*9); ctx.stroke(); }
    if(layers.labels){ ctx.fillStyle=col; ctx.fillText(`М${u.id}${u.alive?(u.reflex===5?' бой':u.reflex===6?' бегство':u.stealth?' тихо':''):' †'}`,X+7,Y-8); } }
  // особи
  for(const p of f.pack){ const X=S(p.x),Y=Sy(p.y); const dead=p.act==='dead', col=dead?'#7a2a2a':'#ff5c5c', r=Math.max(3,0.8*p.size*sc);
    if(layers.targets&&p.tg&&!dead){ ctx.setLineDash([3,4]); ctx.strokeStyle='rgba(255,92,92,0.6)'; ctx.beginPath(); ctx.moveTo(X,Y); ctx.lineTo(S(p.tg[0]),Sy(p.tg[1])); ctx.stroke(); ctx.setLineDash([]); }
    if(layers.senses&&p.foe&&!dead){ ctx.strokeStyle='rgba(255,180,80,0.5)'; ctx.beginPath(); ctx.moveTo(X,Y); ctx.lineTo(S(p.foe[0]),Sy(p.foe[1])); ctx.stroke(); }
    if(p.lit){ ctx.strokeStyle='#ffdc78'; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(X,Y,r+4,0,7); ctx.stroke(); ctx.lineWidth=1; }
    ctx.fillStyle=col; ctx.beginPath(); ctx.arc(X,Y,r,0,7); ctx.fill(); if(dead){ ctx.strokeStyle='#000'; ctx.beginPath(); ctx.moveTo(X-3,Y-3); ctx.lineTo(X+3,Y+3); ctx.moveTo(X-3,Y+3); ctx.lineTo(X+3,Y-3); ctx.stroke(); }
    else if(p.act!=='sleep'&&p.act!=='rest'){ ctx.strokeStyle=col; ctx.beginPath(); ctx.moveTo(X,Y); ctx.lineTo(X+Math.cos(p.h)*(r+5),Y+Math.sin(p.h)*(r+5)); ctx.stroke(); }
    if(p.item){ ctx.fillStyle='#cfd6de'; ctx.beginPath(); ctx.moveTo(X,Y-r-7); ctx.lineTo(X+3,Y-r-4); ctx.lineTo(X,Y-r-1); ctx.lineTo(X-3,Y-r-4); ctx.closePath(); ctx.fill(); if(sc>=2){ ctx.fillText(ITEMS[p.item],X+5,Y-r-6); } }   // ноша
    if(layers.labels){ ctx.fillStyle=col; ctx.fillText(`О${p.i+1} ${ACT_RU[p.act]||p.act}${p.told&&!dead?' ●':''}`,X+r+4,Y+8); } }
  const sel=pinned||hover; if(sel){ const o=findSel(f,sel); if(o){ ctx.strokeStyle='#fff'; ctx.beginPath(); ctx.arc(S(o.x),Sy(o.y),11,0,7); ctx.stroke(); } }
  ctx.fillStyle='rgba(255,255,255,0.5)'; ctx.fillText(`1 px = ${(1/sc).toFixed(2)} м · ${cur.toFixed(1)} с`,8,H-10); }
function findSel(f,sel){ if(sel.kind==='unit') return f.units.find(u=>u.id===sel.id); if(sel.kind==='pack') return f.pack[sel.i]; if(sel.kind==='turret') return f.turrets[sel.k]; if(sel.kind==='relay') return (f.relays||[]).find(R=>R.id===sel.id); if(sel.kind==='ground') return f.ground.find(g=>g.id===sel.id); return null; }
function hit(px,py){ const f=frameAt(cur); if(!f) return null; let best=null, bd=14;
  const test=(o,sel)=>{ const d=Math.hypot(S(o.x)-px,Sy(o.y)-py); if(d<bd){ bd=d; best=sel; } };
  f.units.forEach(u=>test(u,{kind:'unit',id:u.id})); f.pack.forEach(p=>test(p,{kind:'pack',i:p.i})); f.turrets.forEach((T,k)=>T&&test(T,{kind:'turret',k})); (f.relays||[]).forEach(R=>test(R,{kind:'relay',id:R.id})); f.ground.forEach(g=>test(g,{kind:'ground',id:g.id})); return best; }

// ---------- характеристики ----------
function kv(rows){ return '<div class="kv">'+rows.filter(r=>r[1]!==undefined&&r[1]!==null&&r[1]!=='').map(([k,v])=>`<label>${k}</label><span>${v}</span>`).join('')+'</div>'; }
function renderInfo(){ const sel=pinned||hover, P=$('#info'); if(!sel){ P.innerHTML='<span class="dim">Наведи на тело, особь, турель, ретранслятор или свёрток. Клик — закрепить.</span>'; return; }
  const f=frameAt(cur); const o=f&&findSel(f,sel); if(!o){ P.innerHTML='<span class="dim">нет в кадре</span>'; return; } const pin=pinned?' <span class="dim">(закреплено, клик по пустому — снять)</span>':'';
  if(sel.kind==='unit') P.innerHTML=`<h3>М${o.id} · ARK-04${1+o.st}${pin}</h3>`+kv([['положение',`${o.x.toFixed(1)}, ${o.y.toFixed(1)}`],['состояние',o.alive?'жив':'мёртв'],['режим',MODES[o.mode]],['скрытность',o.stealth?'да':'нет'],['стойка',STANCES[o.stance]],['рефлекс',o.reflex===5?'бой':o.reflex===6?'бегство':'—'],['фонарь',o.light?'горит':'выключен'],['цель',o.tg?`${o.tg[0]}, ${o.tg[1]}`:'—'],['пульс',o.pulse],['кожа / кости',`${o.skin} / ${o.bone}`],['глюкоза / заряд',`${o.glu} / ${o.chg}`],['психика',o.psy],['страх',o.fear],['несущая',o.car?'есть':'нет'],['камера',o.cam?'на теле':'—'],['предметы',(o.items||[]).map(i=>ITEMS[i]).join(', ')||'—']]);
  else if(sel.kind==='pack'){ const m=LEVEL.pack.members[o.i]||{}; P.innerHTML=`<h3>О${o.i+1}${pin}</h3>`+kv([['положение',`${o.x.toFixed(1)}, ${o.y.toFixed(1)}`],['действие',`${ACT_RU[o.act]||o.act} (${o.act})`],['почему',o.why],['размер / храбрость / внимание',`${m.size} / ${m.courage} / ${m.attention}`],['действующая храбрость',o.nerve],['раны',`${o.hp} из ${Math.max(1,Math.round(3*(m.size||1)))}`],['страх',o.fear],['усталость',o.tired],['чужой',o.foe?`${o.foe[0]}, ${o.foe[1]} (М${o.foe[2]})`:'—'],['цель',o.tg?`${o.tg[0]}, ${o.tg[1]}`:'—'],['слово агента',o.told||'—'],['ноша',o.item?ITEMS[o.item]:'—'],['луч турели',o.lit?'на ней':'—'],['передышка / реакция',`${o.rest} / ${o.hold}`]]); }
  else if(sel.kind==='turret') P.innerHTML=`<h3>турель ${o.id??''} · ARK-04${1+(o.st??sel.k)}${pin}</h3>`+kv([['положение',`${o.x}, ${o.y}`],['состояние',o.broken?'повреждена':o.powered===false?'без питания':o.on===false?'выключена':'включена'],['патроны',o.ammo],['режут',o.cut!=null?o.cut+' с':undefined],['лампа',(o.on!==false&&o.powered!==false&&!o.broken)?'горит':'не горит'],['сектор',`${(o.fov*180/Math.PI).toFixed(0)}° вокруг ${(o.ang*180/Math.PI).toFixed(0)}°`],['дальность',o.range+' м'],['цель',o.tgt?(o.tgt.p!==undefined?'О'+(o.tgt.p+1):'М'+o.tgt.u):'—'],['прицел',o.aim+' с'],['перезарядка',o.rel>0?o.rel+' с':'готова']]);
  else if(sel.kind==='relay') P.innerHTML=`<h3>ретранслятор ${o.id}${pin}</h3>`+kv([['положение',`${o.x}, ${o.y}`],['вид',o.kind],['питание',o.powered?'есть':'нет'],['состояние',o.on?'включён':'выключен'],['канал',o.freq||'не задан'],['дальность / усиление',`${o.range} м / ${o.gain>=0?'+':''}${o.gain} дБ`],['слышат',o.reach.length?o.reach.map(k=>'ARK-04'+(1+k)).join(', '):'—'],['узел для',o.linked.length?o.linked.map(k=>'ARK-04'+(1+k)).join(', '):'—']]);
  else P.innerHTML=`<h3>свёрток${pin}</h3>`+kv([['положение',`${o.x}, ${o.y}`],['внутри',o.items.map(i=>ITEMS[i]).join(', ')]]); }

// ---------- лента ----------
const filters={pack:true,ack:true,op:true,note:false};
function renderFeed(force){ let n=0; while(n<events.length&&events[n].t<=cur) n++; if(!force&&n===feedIdx) return; feedIdx=n;
  const F=$('#feed'); const vis=events.slice(0,n).filter(e=>filters[e.cls==='cry'||e.cls==='shot'?'pack':e.cls]).slice(-400);
  F.innerHTML=vis.map(e=>`<div class="${e.cls}"><span class="t">${e.t.toFixed(0).padStart(5)}с</span> ${esc(e.text)}</div>`).join(''); F.scrollTop=F.scrollHeight; $('#feedn').textContent=`${n} из ${events.length}`; }
function esc(s){ return String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }

// ---------- проигрывание ----------
function setTime(t){ cur=Math.max(t0,Math.min(t1,t)); $('#seek').value=cur; $('#time').textContent=`${cur.toFixed(0)} / ${(t1-t0).toFixed(0)} с`; renderFeed(); renderInfo(); draw(); }
function setPlaying(v){ playing=v&&frames.length>0; $('#play').textContent=playing?'❚❚':'▶'; }
let last=performance.now(); function loop(now){ const dt=(now-last)/1000; last=now;
  if(live.on){ if(!live.first){ const target=t1-1; if(Math.abs(target-cur)>5) cur=target; else cur+=dt*speed*(1+Math.max(-0.5,Math.min(0.5,(target-cur)*0.5)));   // догоняет мягко: отстал — быстрее, обогнал — медленнее
      cur=Math.max(t0,Math.min(t1,cur)); renderFeed(); renderInfo(); draw(); $('#time').textContent=`часы мира ${mmss(cur)} · ×${speed}`; } liveStatus(); }
  else if(playing){ setTime(cur+dt*speed); if(cur>=t1) setPlaying(false); } requestAnimationFrame(loop); } requestAnimationFrame(loop);
$('#play').onclick=()=>setPlaying(!playing); $('#speed').onchange=e=>{ speed=+e.target.value; }; $('#seek').oninput=e=>setTime(+e.target.value);
document.addEventListener('keydown',e=>{ if(live.on||e.target.tagName==='INPUT'&&e.target.type!=='range') return; if(e.code==='Space'){ e.preventDefault(); setPlaying(!playing); } if(e.key==='ArrowLeft') setTime(cur-(e.shiftKey?60:5)); if(e.key==='ArrowRight') setTime(cur+(e.shiftKey?60:5)); });
$$('[data-layer]').forEach(b=>b.onclick=()=>{ layers[b.dataset.layer]=!layers[b.dataset.layer]; b.classList.toggle('on',layers[b.dataset.layer]); if(b.dataset.layer==='hm'||b.dataset.layer==='iso') hmDirty(0); else draw(); });
$$('[data-f]').forEach(c=>c.onchange=()=>{ filters[c.dataset.f]=c.checked; renderFeed(true); });
// файл: выбор или перетаскивание; ?log=URL — загрузить по адресу
$('#file').onchange=e=>{ const f=e.target.files[0]; if(f) f.text().then(load); };
document.addEventListener('dragover',e=>e.preventDefault()); document.addEventListener('drop',e=>{ e.preventDefault(); const f=e.dataTransfer.files[0]; if(f) f.text().then(load); });
const qs=new URLSearchParams(location.search), qlog=qs.get('log'), qroom=(qs.get('room')||'').trim();
if(/^[\w-]{1,32}$/.test(qroom)) liveConnect(qroom); else if(qlog) fetch(qlog).then(r=>r.text()).then(load).catch(()=>{});   // ?room=КОД — живьём с сервера; ?log=URL — файл
// карта: сдвиг, масштаб, наведение, закрепление
let drag=null;
cv.addEventListener('mousedown',e=>{ drag={x:e.clientX,y:e.clientY,cx,cy,moved:false}; });
window.addEventListener('mousemove',e=>{ if(drag){ const dx=e.clientX-drag.x, dy=e.clientY-drag.y; if(Math.hypot(dx,dy)>3){ drag.moved=true; cv.classList.add('grab'); } cx=drag.cx-dx/sc; cy=drag.cy-dy/sc; draw(); hmDirty(); return; }
  const r=cv.getBoundingClientRect(); hover=hit(e.clientX-r.left,e.clientY-r.top); renderInfo(); draw(); });
window.addEventListener('mouseup',e=>{ if(drag&&!drag.moved){ const r=cv.getBoundingClientRect(); pinned=hit(e.clientX-r.left,e.clientY-r.top); renderInfo(); draw(); } drag=null; cv.classList.remove('grab'); });
cv.addEventListener('wheel',e=>{ e.preventDefault(); const r=cv.getBoundingClientRect(); const mx=e.clientX-r.left, my=e.clientY-r.top; const wx=iS(mx), wy=iSy(my); sc=Math.max(0.15,Math.min(20,sc*Math.exp(-e.deltaY*0.002))); cx=wx-(mx-W/2)/sc; cy=wy-(my-H/2)/sc; draw(); hmDirty(); },{passive:false});
function fit(){ const r=$('#mapwrap').getBoundingClientRect(); W=cv.width=Math.max(1,Math.floor(r.width)); H=cv.height=Math.max(1,Math.floor(r.height)); hmDirty(0); }
window.addEventListener('resize',fit); fit();

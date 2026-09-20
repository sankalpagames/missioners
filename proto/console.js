// КОНСОЛЬ. Видит только сообщения станции: доставленные пакеты, потери и показания своего модема (transport.onmessage).
// Всё, что нарисовано на экране, восстановлено из этих байтов. Отладочная шторка показывает правду о мире, если станция её отдаёт (только одиночная игра).
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
// Лаборатория лидара (index.html?lab): та же консоль и тот же мир, но канал без ограничений (ёмкость 1e8 бит/с, шум −500 дБм, RTT 0),
// сеанс не сохраняется, клик по карте и стрелки — телепорт тела с мгновенным снимком лидара. Датчик и карта работают как в игре.
const LAB=/[?&]lab\b/.test(location.search) && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);   // только локально: на опубликованном сайте флаг не действует
// Станция: в одиночной игре — воркер (мир + канал в браузере), в сети — WebSocket на сервер (index.html?room=КОД). Консоль разницы не видит.
const ROOM=new URLSearchParams(location.search).get('room')||'', ST=+(new URLSearchParams(location.search).get('st')||0);   // комната и платформа оператора в ней
const MAP=(q=>/^[a-z0-9_-]{1,32}$/.test(q)?q:'act1')(new URLSearchParams(location.search).get('map')||'');   // одиночная игра: карта из proto/maps/ (в сети карту знает комната)
const OP=(()=>{ try{ return JSON.parse(localStorage.getItem('missioners.op'))||{}; }catch(e){ return {}; } })();   // имя и токен оператора — задаются в лобби
const transport=ROOM?wsTransport(ROOM):workerTransport();
function workerTransport(){ const w=new Worker('station-worker.js?v='+window.__v+(LAB?'&lab':'')+(MAP!=='act1'?'&map='+MAP:'')); let ready=false; const q=[]; const tr={ mp:false, onmessage:null, send(m){ if(ready) w.postMessage(m); else q.push(m); } };
  w.onmessage=e=>{ const m=e.data; if(m.t==='ready'){ ready=true; for(const x of q) w.postMessage(x); q.length=0; return; } tr.onmessage&&tr.onmessage(m); }; return tr; }
function wsTransport(room){ const q=[]; const tr={ mp:true, onmessage:null, onopen:null, send(m){ if(ws&&ws.readyState===1) ws.send(JSON.stringify(m)); else q.push(m); } }; let ws=null;   // до соединения — очередь; после обрыва — переподключение
  const open=()=>{ ws=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host+'/ws?room='+encodeURIComponent(room)); ws.onopen=()=>{ tr.onopen&&tr.onopen(); for(const m of q) ws.send(JSON.stringify(m)); q.length=0; }; ws.onclose=()=>{ setTimeout(open,2000); };
    ws.onmessage=e=>{ const m=JSON.parse(e.data); if(m.bytes) m.bytes=new Uint8Array(m.bytes); if(m.img) m.img=new Uint8Array(m.img); tr.onmessage&&tr.onmessage(m); }; };
  open(); return tr; }
if(ROOM){ $('#room').hidden=false; $('#room').textContent='комната '+ROOM; $('#btn-debug').hidden=true; $('#speed').disabled=true; $('#speed').title='ускорение — настройка планеты, задаётся при создании'; }   // в сети отладки нет: мир общий, крутилки были бы читом
if(LAB){ for(const [k,v] of Object.entries({deepCapBps:1e8,noiseDbm:-500,rtt:0,deepBer:0})) transport.send({t:'cfg',k,v}); document.body.classList.add('lab'); document.title='лаборатория лидара'; }
// показания модема — последнее сообщение станции {t:'modem'}; история по секундам копится здесь
const modem={at:0,speed:1,up:false,cap:0,orbit:null,qbg:0,qcmd:0,ncmd:0,retry:0,sec:null,cnt:{delivered:0,dropped:0,retrans:0},queue:[],dbg:null}; const modemHist=[];
function kindOf(k){ return /^IM[GD]/.test(k)?'IMG':k; }
let speed=1, tNow=0, active=1, dbgLevel=null;   // dbgLevel и modem.dbg — правда о мире для шторки, игрок этого не видит
const units=new Map();          // id → знание о миссионере
const station={bio:null,cam:null,grow:null,brik:0,cut:0,at:-1e9,pos:null,name:'ARK-041',turrets:[],turretGeo:{},turretReq:{},relays:[],relayGeo:{},relayReq:{},freq:null};   // turrets — из пульса (состояние, патроны), turretGeo — из паспорта (где стоит, сектор), turretReq — запрошено кнопкой, до подтверждения пульсом; relays / relayGeo / relayReq — то же для ретрансляторов, чей маяк станция слышит (в пульсе есть — слышен); freq — канал станции из паспорта   // pos — где стоит своя платформа: из паспорта станции (INFO)
const known=new Map();          // ключ → объект с координатами (только из полученных данных)
const journal=new Map();        // id объекта → [{t, unit, text}] — что узнали, изучив или взаимодействуя
function jadd(id,unit,text){ (journal.get(id)||journal.set(id,[]).get(id)).push({t:tNow,unit,text}); if($('.tabs button.on').dataset.tab==='journal') renderJournal(); }
function jlast(id){ const j=journal.get(id); return j?j[j.length-1]:null; }
function oname(id){ const o=[...known.values()].find(k=>k.id===id); return o?o.name:(id>=IDS.ground[0]&&id<=IDS.ground[1]?'свёрток':id>=IDS.poi[0]&&id<=IDS.poi[1]?'указатель '+id:'объект '+id); }
// объект, который миссионер изучил или трогал, — знакомый ему: подсветить на карте, дать имя, если его ещё нет
function markSeen(id,unit){ let o=[...known.values()].find(k=>k.id===id); const p=pos(unit);
  if(!o){ o={id,cls:0,x:p.x,y:p.y,at:tNow,unit,seenBy:new Set(),name:oname(id)}; known.set(id>=250?'c'+id:id>=200?'unit'+id:'o'+id,o); }
  o.seenBy.add(unit); o.at=tNow; }
const KIND_RU={TLM:'телеметрия',HB:'пульс станции',SONAR:'лидар',DESC:'описание',IMG:'изображение',EVT:'событие',EXAM:'осмотр',ACT:'действие',INFO:'статус станции',CONT:'содержимое'};
const KIND_COL={TLM:'#5cb85c',HB:'#2f6f3a',SONAR:'#4a8fe0',DESC:'#9fb59f',IMG:'#e0a94a',EVT:'#8a7fd0',EXAM:'#8a7fd0',ACT:'#8a7fd0',INFO:'#2f6f3a',CONT:'#8a7fd0',drop:'#d9534f'};
const UCOL=['#7fe07f','#4a8fe0','#e0a94a','#d97fd9','#5cd0d0','#d9534f'];
const bw={};                    // kind → массив {t,bytes} за 5 с
const lastRx={};                // kind → последний принятый пакет
const contents=new Map();       // id контейнера → предметы (по последнему CONT)
const stcam={ id:0, img:{msg:null,buf:new Uint8Array(64*64),levels:{},skipped:0,at:-1e9,asm:{},state:'',prog:0}, subs:{img:0,level:2,delta:true}, camera:true };
const totals={};

function U(id){ if(!units.has(id)) units.set(id,{id,alive:true,carrier:true,camera:false,sonar:false,streaming:false,charge:null,tlm:null,tlmAt:-1e9,hist:[],track:[],sonarAt:-1e9,desc:[],descAt:-1e9,autonomy:0,target:null,descPts:[],subs:{tlm:1,sonar:0,desc:0,img:0,level:2,delta:true},img:{msg:null,buf:new Uint8Array(64*64),levels:{},skipped:0,at:-1e9,asm:{},state:'',prog:0}}); return units.get(id); }
function T(){ const u=units.get(active); return u?u.sel:null; }
U(1); units.get(1).camera=true; units.get(1).sonar=true;
function pos(id){ const u=units.get(id); if(u&&u.tlm) return {x:u.tlm.x,y:u.tlm.y}; if(u&&u.track.length) return u.track[u.track.length-1]; return {x:16,y:0}; }

// ---------- лог ----------
const logEntries=[];            // лог — тоже принятая информация, сохраняется и восстанавливается мгновенно
function log(txt,cls='sys',t=tNow){ logEntries.push({t,txt,cls}); if(logEntries.length>800) logEntries.shift(); const d=document.createElement('div'); d.innerHTML=`<span class="t">${fmtT(t)}</span><span class="${cls}">${txt}</span>`; const l=$('#log'); l.appendChild(d); l.scrollTop=l.scrollHeight; }
function fmtT(t){ if(!isFinite(t)) return '—'; const m=Math.floor(t/60), s=Math.floor(t%60); return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`; }

// ---------- станция → консоль ----------
let rxN=0;   // номер последнего принятого пакета: по нему сервер досылает пропущенное при повторном подключении
// сбой терминала (ошибка в коде консоли) — строкой в журнал с пометкой «терминал:», как имена операторов: знание инструментария, не станции.
// Иначе исключение уходит в DevTools, а панель молча показывает «нет данных». Повторы одной и той же ошибки не дублируются.
// Плашка «⚠ сбой ×N» в шапке и панель со стеками открываются сами при первом сбое — чтобы баг был виден сразу, а не по «нет данных» через час.
const faults=new Map();   // текст → {n, at, stack}
function fault(where,e,src='терминал'){ const txt=`${src}: сбой ${where} — ${e&&e.message||e}`; const f=faults.get(txt); if(f){ f.n++; renderFaults(); return; }
  faults.set(txt,{n:1, at:tNow, wall:new Date().toLocaleTimeString('ru'), stack:e&&e.stack||''}); log(txt,'err'); console.error(where,e); renderFaults(); $('#faults').hidden=false; }
function renderFaults(){ const n=[...faults.values()].reduce((a,f)=>a+f.n,0); const b=$('#fault-badge'); b.hidden=!n; b.textContent=`⚠ сбой${n>1?' ×'+n:''}`;
  $('#fault-list').innerHTML=[...faults].map(([txt,f])=>`<div class="f"><b>${f.wall} · ${fmtT(f.at)}</b> ${txt.replace(/</g,'&lt;')}${f.n>1?` <span class="dim">×${f.n}</span>`:''}<pre>${(f.stack||'').replace(/</g,'&lt;')}</pre></div>`).join(''); }
$('#fault-badge').onclick=()=>{ $('#faults').hidden=!$('#faults').hidden; }; $('#btn-faults-close').onclick=()=>$('#faults').hidden=true;
$('#btn-faults-copy').onclick=()=>navigator.clipboard.writeText([...faults].map(([txt,f])=>`${f.wall} ${fmtT(f.at)} ${txt}${f.n>1?' ×'+f.n:''}\n${f.stack}`).join('\n\n'));
window.addEventListener('error',e=>fault('скрипта',e.error||e.message)); window.addEventListener('unhandledrejection',e=>fault('скрипта',e.reason));
transport.onmessage=m=>{ try{ onMessage(m); }catch(e){ fault(`приёма ${m.t}${m.kind?' '+m.kind:''}${m.unit?' М'+m.unit:''}`,e); } };
function onMessage(m){
  if(m.t==='pkt'){ if(m.replay) tNow=m.at; rxN=Math.max(rxN,m.n); onDeliver(m); }
  else if(m.t==='drop') onDrop(m);
  else if(m.t==='modem'){ Object.assign(modem,m); if(m.sec){ modemHist.push(m.sec); if(modemHist.length>90) modemHist.shift(); } if(Math.abs(tNow-m.at)>0.3) tNow=m.at; if(speed!==m.speed){ speed=m.speed; $('#speed').value=String(speed); } }
  else if(m.t==='level') dbgLevel=m; else if(m.t==='peekImg') drawGray($('#peek'),m.img,64); else if(m.t==='state') saveNow(m.data); else if(m.t==='logText') downloadText(m.text,'ark-041-world.jsonl');
  else if(m.t==='welcome') boot.onWelcome&&boot.onWelcome(m);
  else if(m.t==='ops') showOps(m.ops,m.stations); else if(m.t==='echo') onEcho(m);
  else if(m.t==='fault') fault(m.where,{message:m.text,stack:m.stack},'хост мира');   // исключение в станции (такт, команда) или воркере — та же панель, другая подпись
}
// операторы на станции: терминалы, подключённые к той же комнате (не пакеты — знание своего инструментария)
let opsNow=null; const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function showOps(ops,stations){ const others=(stations||[]).filter(s=>s.k!==ST).map(s=>`${s.name}: ${s.ops.join(', ')||'—'}`).join(' · '); $('#room').textContent=`${station.name} · комната ${ROOM} · операторы: ${ops.join(', ')||'—'}${others?' · '+others:''}`;
  if(opsNow){ for(const n of ops.filter(n=>!opsNow.includes(n))) log(`терминал: оператор ${esc(n)} подключился`,'sys'); for(const n of opsNow.filter(n=>!ops.includes(n))) log(`терминал: оператор ${esc(n)} отключился`,'sys'); }
  opsNow=ops; }
let joined=false; const hello=()=>transport.send({t:'hello',since:rxN,st:ST,op:{name:OP.name,token:OP.token}}); transport.onopen=()=>{ if(joined) hello(); };   // после обрыва: сервер дошлёт пакеты после rxN
// Сборка многопакетных текстовых сообщений: декодируем, когда пришли все пакеты
const asm={};
function assemble(pkt){ if(pkt.total===1) return pkt.bytes; const a=asm[pkt.msgId]=asm[pkt.msgId]||{parts:{},total:pkt.total,at:tNow}; a.parts[pkt.seq]=pkt.bytes; a.at=tNow;
  if(Object.keys(a.parts).length<a.total) return null; const out=[]; for(let i=0;i<a.total;i++) out.push(...a.parts[i]); delete asm[pkt.msgId]; return new Uint8Array(out); }
function onDeliver(pkt){
  const k=kindOf(pkt.kind); (bw[k]=bw[k]||[]).push({t:tNow,b:pkt.size}); totals[k]=(totals[k]||0)+pkt.size; lastRx[k]={t:tNow,b:pkt.size,msg:pkt.msgId}; if(k==='IMG'&&pkt.unit===0){ (bw.STIMG=bw.STIMG||[]).push({t:tNow,b:pkt.size}); lastRx.STIMG={t:tNow,b:pkt.size}; }
  if(pkt.kind==='DESC'||pkt.kind==='EXAM'||pkt.kind==='ACT'||pkt.kind==='INFO'||pkt.kind==='SONAR'){ const full=assemble(pkt); if(!full) return; pkt={...pkt,bytes:full}; }
  switch(pkt.kind){
    case 'TLM': decodeTlm(pkt); break;
    case 'HB': decodeHb(pkt.bytes); break;
    case 'DESC': decodeDesc(pkt); break;
    case 'SONAR': { const u=U(pkt.unit); const b=pkt.bytes; const p={x:(((b[0]<<8)|b[1])-32768)/10,y:(((b[2]<<8)|b[3])-32768)/10}; const o=b.length>=79?3:b.length>=78?2:b.length>=77?1:0; const tilt=o?b[4]-90:0; const zs=o>2?((b[5]<<8)|b[6])/10-40:o>1?b[5]/2-40:null; const mask=[...b.slice(4+o,12+o)], rays=b.slice(12+o);   /* o — сдвиг: наклон, барометр 2 Б (шаг 0,1 м; старые форматы — 1 Б по 0,5 м или без) */ u.sonarData=rays; u.sonarMask=mask; u.sonarTilt=tilt; u.sonarAt=tNow; if(zs!==null) hmapAdd(p.x,p.y,tilt,zs,rays,mask); snapWalls({x:p.x,y:p.y,b:rays,m:mask,k:tilt}); if(pkt.unit===active) drawSonar(rays,mask,tilt); break; }
    case 'IMG0': case 'IMG1': case 'IMG2': case 'IMG3': decodeImg(pkt); break;
    case 'IMD0': case 'IMD1': case 'IMD2': case 'IMD3': decodeImd(pkt); break;
    case 'EVT': decodeEvt(pkt); break;
    case 'INFO': { const text=decText(pkt.bytes); const tl=text.split('\n').find(l=>l.startsWith('задача:')); if(tl) $('#task').textContent=tl; const rr=/возврат:.*?(\d+) м/.exec(text); if(rr) station.returnR=+rr[1]; /* радиус возврата — из паспорта, для круга на карте */ const pp=/платформа: (-?[\d.]+), (-?[\d.]+); курс (-?\d+)/.exec(text); if(pp) station.pos={x:+pp[1],y:+pp[2],ang:+pp[3]*Math.PI/180}; const nm=/^(ARK-\d+),/.exec(text); if(nm) station.name=nm[1]; const tl2=/турели: (.*)/.exec(text); if(tl2){ for(const m of tl2[1].matchAll(/(\d+) \((-?\d+), (-?\d+)\) курс (-?\d+)° сектор (\d+)° дальность (\d+) м/g)) station.turretGeo[+m[1]]={x:+m[2],y:+m[3],ang:+m[4]*Math.PI/180,fov:+m[5]*Math.PI/180,range:+m[6]}; } const pw=/питание (\d+) м/.exec(text); if(pw) station.powerR=+pw[1];
      const fq=/^канал (\d+)/m.exec(text); if(fq) station.freq=+fq[1];
      const rl=/ретрансляторы: (.*)/.exec(text); if(rl){ for(const m of rl[1].matchAll(/(\d+) \((-?\d+), (-?\d+)\) (стационарный|переносной), дальность (\d+) м, ([+-]?\d+) дБ, (включён|выключен)/g)) station.relayGeo[+m[1]]={x:+m[2],y:+m[3],kind:m[4],range:+m[5],gain:+m[6]}; }   // где стоит ретранслятор — из паспорта станции или паспорта ретранслятора (событие 3)
      if(boot.onInfo&&/^ARK-/.test(text)) boot.onInfo(text,pkt); else log('станция: '+text.replace(/\n/g,' · '),'sys'); break; }
    case 'CONT': { const b=pkt.bytes; contents.set(b[0],[...b.slice(2,2+b[1])]); renderDesc(); break; }
    case 'EXAM': decodeExam(pkt); break;
    case 'ACT': decodeAct(pkt); break;
  }
}
function onDrop(pkt){ if(pkt.kind==='TLM'||pkt.kind==='HB') return; if(pkt.seq===undefined){ const u=holderOf(pkt.unit); u.img.skipped++; u.img.state=`кадр пропущен (${u.img.skipped}): ${pkt.reason.split(': ')[1]}`; if(pkt.unit===active||pkt.unit===0) showImg(u); return; } log(`М${pkt.unit} ${pkt.kind} #${pkt.msgId}/${pkt.seq}: ${pkt.reason}`,'err'); }

// ---------- декодеры ----------
function decodeTlm(pkt){ const b=pkt.bytes, u=U(pkt.unit); if(boot.onTlm) boot.onTlm(pkt);
  u.tlm={pulse:b[0],electro:b[1],glucose:b[2],toxin:b[3],skin:b[4],bone:b[5],psyche:b[6],danger:b[7]&1,autonomy:(b[7]>>1)&3,cons:b[8]/50,charge:b[9]/2.55,gen:b[10]/50,x:(((b[11]<<8)|b[12])-32768)/10,y:(((b[13]<<8)|b[14])-32768)/10,mode:b[15]&7,stealth:!!(b[15]&8),stance:(b[15]>>4)&3,reflex:b[15]&64?5:b[15]&128?6:0};   // байт 15: режим | скрытность·8 | стойка·16 | рефлекс 64/128
  { const r=u.req; if(r){ for(const k of ['mode','stealth','stance','autonomy']) if(r[k]!==undefined && r[k]===u.tlm[k]) delete r[k]; if(tNow-r.at>90) u.req=null; } }   // запрошенное подтвердилось — контур снимается
  u.tlmAt=tNow; u.hist.push({t:tNow,...u.tlm}); if(u.hist.length>3000) u.hist.shift();
  const last=u.track[u.track.length-1]; if(!last||Math.hypot(last.x-u.tlm.x,last.y-u.tlm.y)>2){ u.track.push({x:u.tlm.x,y:u.tlm.y,t:tNow}); if(u.track.length>600) u.track.shift(); }
}
function decodeHb(b){ if(boot.onHb){ boot.onHb(b); } station.bio=b[0]; station.cam=b[1]; station.grow=b[2]===255?null:b[2]; station.brik=b[3]; station.cut=b[4]; station.at=tNow; const n=b[5];
  { const o=6+n*5, nt=b[o]??0; const prev=station.turrets; station.turrets=[]; for(let j=0;j<nt;j++){ const id=b[o+1+j*3], f=b[o+2+j*3], am=b[o+3+j*3]; const T={id, powered:!!(f&1), on:!!(f&2), broken:!!(f&4), tracking:!!(f&8), reloading:!!(f&16), ammo:am===255?null:am}; station.turrets.push(T);
      const was=prev.find(x=>x.id===id); if(was){ if(!was.broken&&T.broken) log(`станция: турель ${id} повреждена`,'err'); if(was.ammo>0&&T.ammo===0) log(`станция: турель ${id} — патроны кончились`,'warn'); }
      const rq=station.turretReq[id]; if(rq&&(rq.on===T.on||tNow-rq.at>90)) delete station.turretReq[id]; }
    // ретрансляторы, чей маяк слышен на канале станции: id, флаги (включён, переносной); нет в пульсе — не слышен. Перемены в журнал пишут события 3/41/42
    const o2=o+1+nt*3, nr=b[o2]??0; const prevR=station.relays; station.relays=[]; for(let j=0;j<nr;j++){ const id=b[o2+1+j*2], f=b[o2+2+j*2]; const R={id, on:!!(f&1), mobile:!!(f&2)}; station.relays.push(R);
      const rq=station.relayReq[id]; if(rq&&(rq.on===R.on||tNow-rq.at>90)) delete station.relayReq[id]; }
    for(const was of prevR) if(!station.relays.find(x=>x.id===was.id)) delete station.relayReq[was.id]; }   // свои турели: состояние и патроны; без питания — данных нет (255)
  for(let i=0;i<n;i++){ const id=b[6+i*5], f=b[7+i*5], ch=b[8+i*5]/2.55, it=b[9+i*5], snr=b[10+i*5]-30; const u=U(id); const wasAlive=u.alive, wasCarrier=u.carrier; u.items=[...Array(it&3).fill(40), ...(it&4?[41]:[]), ...(it&8?[43]:[])];
    u.alive=!!(f&1); u.carrier=!!(f&2); u.camera=!!(f&4); u.sonar=!!(f&8); u.streaming=!!(f&16); u.atAirlock=!!(f&32); u.charge=ch; u.snr=snr; u.hbAt=tNow;
    if(wasAlive&&!u.alive) log(`станция: М${id} — жизненные функции прекращены`,'err');
    { const was=u.snrState||'ok', now=!u.carrier?'lost':snr<5?'weak':'ok'; if(u.alive&&now!==was&&u.hbAt>-1e8){ if(now==='weak') log(`станция: несущая М${id} слабеет, ${snr>0?'+':''}${snr} дБ`,'err'); if(now==='ok'&&was!=='ok'&&u.carrier) log(`станция: несущая М${id} уверенная, +${snr} дБ`,'sys'); } u.snrState=now; }
    if(wasCarrier&&!u.carrier) log(`станция: несущая М${id} не принимается`,'err');
    if(!wasCarrier&&u.carrier) log(`станция: несущая М${id} восстановлена`,'sys'); }
  // пульс — перечень тел станции: чего в нём нет, того у станции нет (пустая заготовка под М1 в консоли до первого пульса)
  { const listed=new Set(); for(let i=0;i<n;i++) listed.add(b[6+i*5]); for(const [id,u] of units) if(!listed.has(id)&&u.hbAt===undefined) units.delete(id); if(!listed.has(active)&&listed.size){ active=[...listed][0]; selectUnit(); } }
  renderUnits(); const au=units.get(active); if(au){ $('#sonar-body').hidden=!au.sonar; $('#sonar-none').hidden=au.sonar; $('#img-body').hidden=!au.camera; $('#img-none').hidden=au.camera; } }
// Описание: [id, класс, пеленг/2, дальность, длина, текст]*. Класс: 0 объект, 1 ориентир, 2 неопознанное, 3 тело, 4 миссионер.
function decodeDesc(pkt){ const b=pkt.bytes, u=U(pkt.unit); const p={x:(((b[0]<<8)|b[1])-32768)/10,y:(((b[2]<<8)|b[3])-32768)/10}; const items=[];   // позиция съёмки — из пакета, дециметры
  for(let i=4;i+4<b.length;){ const len=b[i+4]; const it={id:b[i],cls:b[i+1],bearing:b[i+2]*2,range:b[i+3],name:decText(b.slice(i+5,i+5+len))}; i+=5+len;
    it.x=p.x+Math.cos(it.bearing*Math.PI/180)*it.range; it.y=p.y+Math.sin(it.bearing*Math.PI/180)*it.range; items.push(it);
    const key=it.cls===2?'c'+it.id:'o'+it.id; const prev=known.get(key); const seen=prev?prev.seenBy:new Set(); seen.add(pkt.unit);   // особей несколько — по id
    // ошибка места ∝ дальности (пеленг шагом 2°): для неподвижного объекта остаётся оценка с самой близкой съёмки; существо — всегда свежая
    const keep=prev&&it.cls!==2&&prev.range!==undefined&&prev.range<it.range;
    known.set(key,{id:it.id,cls:it.cls,x:keep?prev.x:it.x,y:keep?prev.y:it.y,range:keep?prev.range:it.range,at:tNow,unit:pkt.unit,seenBy:seen,name:it.name}); }
  u.desc=items; u.descAt=tNow; u.descPts.push({x:p.x,y:p.y,t:tNow}); if(pkt.unit===active) renderDesc();
  log(`М${pkt.unit} описание: ${items.length} — ${items.map(i=>i.name).join(', ')}`,'desc'); }
// Осмотр и действие: [id, код, длина, текст] — текст составила станция, консоль его только печатает.
function decodeExam(pkt){ const b=pkt.bytes, id=b[0], len=(b[2]<<8)|b[3], text=decText(b.slice(4,4+len)); markSeen(id,pkt.unit); jadd(id,pkt.unit,text); log(`М${pkt.unit} · ${oname(id)}: ${text}`,'desc'); renderDesc(); }
function decodeAct(pkt){ const b=pkt.bytes, id=b[0], code=b[1], len=(b[2]<<8)|b[3], text=decText(b.slice(4,4+len)); if(code===0) markSeen(id,pkt.unit); jadd(id,pkt.unit,text); log(`М${pkt.unit} · ${oname(id)}: ${text}`,code===0?'evt':'err'); renderDesc(); }
function decodeEvt(pkt){ const b=pkt.bytes, code=b[0], arg=b[1], un=pkt.unit?`М${pkt.unit} `:''; const txt=EVENTS[code]||('событие '+code);
  if(code===7) log(`${un}${txt}: ${MODES[arg]}`,'evt'); else if(code===32) log(`${un}${txt}: ${arg?'включена':'выключена'}`,'evt'); else if(code===33) log(`${un}${txt}: ${STANCES[arg]}`,'evt'); else if(code===35) log(`${un}${txt}: ${AUTONOMY[arg]}`,'evt'); else if(code===13) log(`${un}${txt} М${arg}`,'evt'); else if(code===16) log(`${un}${txt} (id ${arg}); требуется новое описание`,'err'); else if(code===19||code===20) log(`${un}${txt}: ${ITEMS[arg]||arg}`,'evt'); else if(code===28) log(`${un}${txt} (${arg*10} м от ближайшего узла${station.returnR?', предел '+station.returnR+' м':''})`,'err'); else if(code===3||code===41) log(`${txt}: ${arg}${code===3?' — маяк на канале станции; в пульсе':' — маяка нет: питание, канал или дальность'}`,code===3?'sys':'warn'); else if(code===42) log(`${txt}: ${arg>>1} ${arg&1?'включён':'выключен'}`,'evt'); else log(`${un}${txt}`,'evt');
  if(code===5){ const u=U(pkt.unit); u.alive=false; renderUnits(); }
  if(code===6){ U(pkt.unit); renderUnits(); }
  if(code===28){ const u=U(pkt.unit); if(u.prevGoal){ u.goalName=u.prevGoal.name; u.goalPos=u.prevGoal.pos; } $('#img-look').textContent=`смотрит: ${u.goalName?'на «'+u.goalName+'»':'вперёд'}`; }   // цель не принята — голова там же, где была
  if(code===27){ $('#fin-title').textContent='СЕРИЯ 1 ИСЧЕРПАНА'; $('#fin-text').textContent=`Живых миссионеров нет, биоматериала нет. Станция закрыла серию 1 и продолжает работу по протоколу.\n\nПС-7 остаётся открытой. Кто-то не вернулся тридцать девять лет назад; теперь — ещё ${[...units.values()].length}.\n\nПриборы на телах отвечают, пока есть заряд. Новый сеанс — в терминале при подключении: [n].`; $('#finale').hidden=false; }
  if(code===17){ $('#fin-title').textContent='ЗАДАЧА ПС-7 ЗАКРЫТА'; $('#task').textContent='задача: ПС-7 закрыта'; const last=[...journal.values()].flat().filter(e=>/прочитал запись/.test(e.text)).pop(); $('#fin-text').textContent=(last?last.text.replace(/^прочитал запись\. /,'')+'\n\n':'')+`Станция остановила протокол ПС-7. Биоматериала осталось: ${station.bio ?? '—'} ед. Миссионеров в поле: ${[...units.values()].filter(u=>u.alive).length}.\n\nЭто условная развязка прототипа. Сеанс можно продолжать.`; $('#finale').hidden=false; } }
function showImg(u){ if(u.id===0){ drawGray($('#st-img'),u.img.buf,64); $('#st-img-state').textContent=u.img.state; $('#st-img-prog').style.width=(u.img.prog*100)+'%'; return; } drawGray($('#img'),u.img.buf,64); $('#img-unit').textContent='М'+u.id; $('#img-state').textContent=u.img.state; $('#img-prog').style.width=(u.img.prog*100)+'%'; }
// отмена запроса в буфере станции: команда 27 с номером сообщения из показаний модема
function cancelReq(g){ if(!send([27,0,g.unit,g.id>>8,g.id&255],`отмена: ${KIND_RU[kindOf(g.kind)]} М${g.unit}`)) return; if(/^IM[GD]/.test(g.kind)){ const u=holderOf(g.unit); delete u.img.asm[g.id]; u.img.state='запрос отменён'; u.img.prog=0; if(g.unit===active||g.unit===0) showImg(u); } }
// отмена — только во вкладке «Канал», в таблице очереди: это операция с буфером станции, не с панелью
function holderOf(unit){ return unit===0?stcam:U(unit); }
function decodeImg(pkt){ const u=holderOf(pkt.unit), im=u.img, lvl=+pkt.kind[3], side=[8,16,32,64][lvl], block=64/side;
  if(lvl===0&&im.msg!==pkt.msgId){ im.buf.fill(0); im.levels={}; }   // новая пирамида — чистим, чтобы прогресс был виден
  im.msg=pkt.msgId; const off=pkt.seq*64;
  for(let k=0;k<pkt.bytes.length;k++){ const i=off+k, px=i%side, py=Math.floor(i/side), v=pkt.bytes[k]; for(let y=0;y<block;y++)for(let x=0;x<block;x++) im.buf[(py*block+y)*64+px*block+x]=v; }
  im.levels[lvl]=(im.levels[lvl]||0)+1; im.at=tNow; const tot=[1,4,16,64]; const maxLvl=u.subs.level;
  const done=[0,1,2,3].reduce((a,l)=>a+(im.levels[l]||0),0), all=[0,1,2,3].slice(0,maxLvl+1).reduce((a,l)=>a+tot[l],0); im.prog=Math.min(1,done/all);
  im.state=`уровень ${lvl} (${side}×${side}): ${im.levels[lvl]}/${tot[lvl]} пакетов`+(im.levels[lvl]===tot[lvl]?' · уровень полный':'');
  if(pkt.unit===active||pkt.unit===0) showImg(u); }
function decodeImd(pkt){ const u=holderOf(pkt.unit), im=u.img, lvl=+pkt.kind[3], side=[8,16,32,64][lvl], bsz=side/8, n=bsz*bsz, up=64/side;
  im.asm[pkt.msgId]=im.asm[pkt.msgId]||{parts:{},total:pkt.total,at:tNow,len:pkt.total*64}; const a=im.asm[pkt.msgId]; a.parts[pkt.seq]=pkt.bytes; a.at=tNow; if(pkt.seq===pkt.total-1) a.len=pkt.seq*64+pkt.bytes.length;
  const buf=new Uint8Array(a.len), have=new Array(a.total).fill(false); for(const s in a.parts){ buf.set(a.parts[s].slice(0,Math.max(0,a.len-s*64)),s*64); have[s]=true; }
  const frameNo=buf[0], key=buf[1]; if(key&&pkt.seq===0&&Object.keys(a.parts).length===1) im.buf.fill(0);
  let p=2, applied=0, skipped=0;
  while(p+1+n<=buf.length){ const p0=Math.floor(p/64), p1=Math.floor((p+n)/64); let ok=true; for(let q=p0;q<=p1;q++) if(!have[q]) ok=false;
    if(ok){ const b=buf[p]; if(b<64){ const bx=(b%8)*bsz, by=Math.floor(b/8)*bsz; for(let j=0;j<bsz;j++)for(let i=0;i<bsz;i++){ const v=buf[p+1+j*bsz+i]; for(let yy=0;yy<up;yy++)for(let xx=0;xx<up;xx++) im.buf[((by+j)*up+yy)*64+(bx+i)*up+xx]=v; } applied++; } } else skipped++; p+=1+n; }
  im.at=tNow; im.prog=Object.keys(a.parts).length/a.total; if(have.every(Boolean)) delete im.asm[pkt.msgId];
  im.state=`дельта-кадр ${frameNo}${key?' (ключевой)':''} ${side}×${side} · блоков ${applied}${skipped?' · неполных '+skipped:''}`;
  for(const id in im.asm) if(tNow-im.asm[id].at>90) delete im.asm[id];   // сборка живёт, пока приходят пакеты
  if(pkt.unit===active||pkt.unit===0) showImg(u); }

// ---------- отрисовка ----------
function drawGray(cv,buf,side){ const ctx=cv.getContext('2d'), im=ctx.createImageData(side,side); for(let i=0;i<side*side;i++){ im.data[i*4]=im.data[i*4+1]=im.data[i*4+2]=buf[i]; im.data[i*4+3]=255; } ctx.putImageData(im,0,0); }
// лидар: 64 дальности по кругу. Соседние отсчёты с близкой дальностью — одна поверхность (линия), одиночные — точки
// ---------- карта высот (чистые функции без DOM; tools/hmap-check.js вырезает этот блок по маркерам) ----------
// Из отсчётов лидара: дальность, наклон и высота датчика дают высоту точки попадания. Сетка 2 м, в ячейке — среднее и число отсчётов.
const HCELL=2, hmap=new Map();   // 'i,j' → {z,n}. Ошибка одного отсчёта ≈ 0,05 м (барометр ±0,05, квантование дальности 0,4·sin наклона)
// Ячейки, через которые прошла стена (сплошная цепочка лидара): сглаживание через них не тянется, изогипсы в них не строятся —
// иначе высота дна растягивалась на 4 м под скалу, а между ячейкой стены и гребнем ложилась пачка ложных изогипс.
const hwall=new Set();
// Растр стен: ячейка WCELL = 0,5 м (шаг квантования дальности 0,4 м — мельче смысла нет) → число попаданий. Снимок растеризуется один раз при
// приёме и не хранится: двадцать снимков одной стены дают одну линию, только увереннее; стена, снятая раз издалека, остаётся тусклой навсегда.
// hwall (2 м) — производная от того же растра, для сглаживания и изогипс.
const WCELL=0.5, wmap=new Map();   // 'i,j' → n
function wallCell(x,y){ const k=Math.floor(x/WCELL)+','+Math.floor(y/WCELL); wmap.set(k,(wmap.get(k)||0)+1); hwall.add(Math.floor(x/HCELL)+','+Math.floor(y/HCELL)); }
function hmapAddWall(x1,y1,x2,y2){ const n=Math.ceil(Math.hypot(x2-x1,y2-y1)/(WCELL/2))+1; let last=null; for(let k=0;k<=n;k++){ const x=x1+(x2-x1)*k/n, y=y1+(y2-y1)*k/n; const c=Math.floor(x/WCELL)+','+Math.floor(y/WCELL); if(c===last) continue; last=c; wallCell(x,y); } hsmDirty=true; }   // отрезок между соседними сплошными отсчётами — та же поверхность
function wallBetween(i,j,di,dj){ const n=2*Math.max(Math.abs(di),Math.abs(dj)); for(let k=1;k<=n;k++) if(hwall.has((i+Math.round(di*k/n))+','+(j+Math.round(dj*k/n)))) return true; return false; }   // стена на пути от ячейки к соседу (включая соседа)
let hsm=new Map(), hsmDirty=true;   // сглаженное поле: отсчёты растянуты на соседние ячейки (радиус 2), чтобы между кольцами снимков появились изогипсы
// Увязка снимков между собой (сдвиг нового к уже снятому по перекрытию) проверялась в tools/hmap-check.js: при барометре 0,1 м она только
// добавляет дрейф (ошибка ячейки 0,03 → 0,17 м), поэтому снимки кладутся как есть.
// Сплошные отсчёты (стены, корпуса) в карту высот не идут: точка на вертикальной поверхности — не высота грунта в этой XY (на одной XY все
// высоты от подошвы до гребня, и какая попадёт в пакет, зависит от наклона и дальности, а не от рельефа — вдоль стены получалась ложная
// лесенка, изогипсы поперёк стены). Стена остаётся линией на карте.
function hmapAdd(x0,y0,tilt,zs,rays,mask){ const tr=tilt*Math.PI/180, ch=Math.cos(tr), sh=Math.sin(tr);
  for(let i=0;i<64;i++){ const r=rays[i]/255*100; if(r>=99.5) continue; if(mask&&(mask[i>>3]&(1<<(i&7)))) continue; const a=i/64*Math.PI*2; const x=x0+Math.cos(a)*r*ch, y=y0+Math.sin(a)*r*ch, z=zs+r*sh;
    const key=Math.floor(x/HCELL)+','+Math.floor(y/HCELL); const c=hmap.get(key); if(c){ c.z+=(z-c.z)/Math.min(c.n+1,8); c.n++; } else hmap.set(key,{z,n:1}); } hsmDirty=true; }
function hmapSmooth(){ if(!hsmDirty) return hsm; hsm=new Map(); const R=2;
  for(const [k,c] of hmap){ const [i,j]=k.split(',').map(Number); const own=hwall.has(k); for(let di=-R;di<=R;di++)for(let dj=-R;dj<=R;dj++){ if((di||dj)&&(own||wallBetween(i,j,di,dj))) continue; const w=Math.min(c.n,4)/(1+di*di+dj*dj); const kk=(i+di)+','+(j+dj); const t=hsm.get(kk); if(t){ t.z+=c.z*w; t.w+=w; } else hsm.set(kk,{z:c.z*w,w}); } }
  for(const [k,t] of hsm){ if(t.w<0.7) hsm.delete(k); else t.z/=t.w; } hsmDirty=false; return hsm; }
// Изогипсы через STEP по центрам ячеек (marching squares) в окне ячеек [i0..i1]×[j0..j1]; отрезки в метрах: [x1,y1,x2,y2].
// Отрезки собираются в цепочки по общим концам; цепочка короче HMIN отрезков — обрывок: на плоском его даёт шум измерения, а не рельеф.
// Проверено tools/hmap-check.js: изогипса ложится в 1 м (медиана) от истинной того же уровня; порог по уклону ячейки (ошибка/уклон) точности не добавлял.
const HMIN=4;
function hmapContours(sm,i0,i1,j0,j1,STEP=0.5){ const seg=[]; const get=(i,j)=>sm.get(i+','+j);
  for(let i=i0;i<=i1;i++)for(let j=j0;j<=j1;j++){ const a=get(i,j), b=get(i+1,j), c=get(i+1,j+1), d=get(i,j+1); if(!a||!b||!c||!d) continue; if(hwall.has(i+','+j)||hwall.has((i+1)+','+j)||hwall.has((i+1)+','+(j+1))||hwall.has(i+','+(j+1))) continue; const v=[a.z,b.z,c.z,d.z]; const lo=Math.ceil(Math.min(...v)/STEP)*STEP, hi=Math.max(...v);
    const P=[[i,j],[i+1,j],[i+1,j+1],[i,j+1]].map(([q,w])=>[(q+0.5)*HCELL,(w+0.5)*HCELL]);
    for(let L=lo;L<=hi;L+=STEP){ const pts=[]; for(let e=0;e<4;e++){ const va=v[e], vb=v[(e+1)%4]; if((va<L)!==(vb<L)){ const k=(L-va)/(vb-va); pts.push([P[e][0]+(P[(e+1)%4][0]-P[e][0])*k, P[e][1]+(P[(e+1)%4][1]-P[e][1])*k]); } }
      if(pts.length>=2) seg.push([...pts[0],...pts[1],L]); if(pts.length===4) seg.push([...pts[2],...pts[3],L]); } }
  // цепочки: объединение по общим концам (ключ — сантиметры и уровень)
  const par=seg.map((_,i)=>i); const find=i=>{ while(par[i]!==i) i=par[i]=par[par[i]]; return i; }; const ends=new Map();
  seg.forEach((s,i)=>{ for(const k of [Math.round(s[0]*100)+','+Math.round(s[1]*100)+','+s[4], Math.round(s[2]*100)+','+Math.round(s[3]*100)+','+s[4]]){ const j=ends.get(k); if(j!==undefined) par[find(i)]=find(j); else ends.set(k,i); } });
  const len=new Map(); for(let i=0;i<seg.length;i++){ const r=find(i); len.set(r,(len.get(r)||0)+1); }
  return seg.filter((_,i)=>len.get(find(i))>=HMIN); }
function snapWalls(s){ const {pts,joined}=sonarSegments(s.b,s.m,s.k||0); for(let i=0;i<64;i++){ const p=pts[i]; if(!p||!p.solid||!joined(i)) continue; const q=pts[(i+1)%64]; hmapAddWall(s.x+Math.cos(p.a)*p.r,s.y+Math.sin(p.a)*p.r,s.x+Math.cos(q.a)*q.r,s.y+Math.sin(q.a)*q.r); } }   // сплошные пары снимка → ячейки стен
function sonarSegments(b,m,tilt=0){ const pts=[]; const ch=Math.cos(tilt*Math.PI/180); for(let i=0;i<64;i++){ const r=b[i]/255*100; const solid=m?!!(m[i>>3]&(1<<(i&7))):true; pts.push(r>=99.5?null:{a:i/64*Math.PI*2,r:r*ch,solid}); }   // r — горизонтальная проекция наклонной дальности
  // соединяем только сплошные отсчёты; допуск по дальности растёт с дальностью (лучи расходятся на 0,1·r; поверхность под углом до ~70° даёт Δr ≈ 0,27·r)
  const joined=i=>{ const p=pts[i], q=pts[(i+1)%64]; return p&&q&&p.solid===q.solid&&Math.abs(p.r-q.r)<0.5+0.3*Math.min(p.r,q.r); };   // соседи одного рода: стена со стеной, грунт с грунтом
  // цепочка: сколько подряд соединённых отсчётов, начиная с i
  const chainLen=i=>{ let n=1; while(n<64&&joined((i+n-1)%64)) n++; return n; };
  return {pts, joined, chainLen}; }
// ---------- /карта высот ----------
function drawSonar(b,m,tilt=0){ const cv=$('#sonar'), ctx=cv.getContext('2d'), c=100; ctx.fillStyle='#000'; ctx.fillRect(0,0,200,200);
  // масштаб — по самому дальнему отражению: ближняя геометрия заполняет круг
  // масштаб: по 75-му процентилю дальностей (ближняя геометрия заполняет круг), колёсико — вручную
  const {pts,joined}=b?sonarSegments(b,m,tilt):{pts:[],joined:()=>false}; const rs=pts.filter(Boolean).map(p=>p.r).sort((a,b)=>a-b); const q=rs.length?rs[Math.floor(rs.length*0.75)]:100;
  const R=map.sonarR||Math.max(12,Math.min(100,q*1.25)); map.sonarAuto=R; const k=100/R;
  const step=[2,5,10,20,25,50].find(s=>s*k>=22)||50; ctx.strokeStyle='#1e3a1e'; ctx.fillStyle='#555'; ctx.font='9px monospace'; for(let r=step;r<=R;r+=step){ ctx.beginPath(); ctx.arc(c,c,r*k,0,7); ctx.stroke(); ctx.fillText(r,c+r*k+2,c-2); }
  if(!b) return; const X=p=>c+Math.cos(p.a)*p.r*k, Y=p=>c+Math.sin(p.a)*p.r*k;
  // свободное пространство
  ctx.fillStyle='rgba(127,224,127,0.07)'; ctx.beginPath(); for(let i=0;i<64;i++){ const p=pts[i]||{a:i/64*Math.PI*2,r:R}; i?ctx.lineTo(X(p),Y(p)):ctx.moveTo(X(p),Y(p)); } ctx.closePath(); ctx.fill();
  // стены (сплошные цепочки) — яркая линия; грунт (цепочки низкого эха) — тусклая тонкая: рельеф, а не преграда
  for(let i=0;i<64;i++){ if(!joined(i)) continue; const p=pts[i], q=pts[(i+1)%64]; if(p.r>R||q.r>R) continue; ctx.strokeStyle=p.solid?'#7fe07f':'#3d5c3d'; ctx.lineWidth=p.solid?1.5:1; ctx.beginPath(); ctx.moveTo(X(p),Y(p)); ctx.lineTo(X(q),Y(q)); ctx.stroke(); } ctx.lineWidth=1;
  for(let i=0;i<64;i++){ const p=pts[i]; if(!p) continue; if(p.r>R){ ctx.fillStyle='#2f5f2f'; ctx.fillRect(c+Math.cos(p.a)*99-1,c+Math.sin(p.a)*99-1,2,2); continue; } const lone=!joined(i)&&!joined((i+63)%64);   // одиночное низкое эхо — объект (ящик, тело, существо): жёлтая точка; грунт в цепочке — тусклая
    ctx.fillStyle=p.solid?'#7fe07f':lone?'#e0a94a':'#4d7a4d'; const sz=lone?4:2; ctx.fillRect(X(p)-sz/2,Y(p)-sz/2,sz,sz); }
  ctx.fillStyle='#fff'; ctx.fillRect(c-1,c-1,2,2); ctx.fillStyle='#555'; ctx.fillText(`до ${R.toFixed(0)} м${map.sonarR?' ·':''}${tilt?` · наклон ${tilt>0?'+':''}${tilt}°`:''}`,4,196); }
let ecgPhase=0, ecgX=0;
function drawEcg(dt){ const cv=$('#ecg'), ctx=cv.getContext('2d'), u=units.get(active); const W=150;
  if(!u||!u.tlm||tNow-u.tlmAt>3*Math.max(1,+$('#sub-tlm').value||1)){ ctx.fillStyle='#000'; ctx.fillRect(0,0,W,44); ctx.fillStyle='#333'; ctx.fillRect(0,22,W,1); return; }
  const bpm=u.tlm.pulse; ecgPhase+=dt*bpm/60; const ph=ecgPhase%1; let v=0; if(ph<0.08) v=Math.sin(ph/0.08*Math.PI)*0.15; else if(ph<0.12) v=-0.2; else if(ph<0.16) v=1; else if(ph<0.2) v=-0.3; else if(ph>0.35&&ph<0.5) v=Math.sin((ph-0.35)/0.15*Math.PI)*0.25;
  const y=28-v*20, x=ecgX; ecgX=(ecgX+dt*60)%W; ctx.fillStyle='rgba(0,0,0,0.06)'; ctx.fillRect(0,0,W,44); ctx.fillStyle='#000'; ctx.fillRect(x,0,8,44); ctx.fillStyle=bpm>150?'#ff5c5c':'#7fe07f'; ctx.fillRect(x,y,2,2); }

function renderUnits(){ const el=$('#units'); el.innerHTML=''; [...units.values()].sort((a,b)=>a.id-b.id).forEach(u=>{ const b=document.createElement('button'); b.className=(u.id===active?'on ':'')+(u.alive?'':'dead ')+(u.alive&&u.hbAt>-1e8?(!u.carrier?'lost':(u.snr??99)<5?'weak':''):''); b.textContent=`${u.alive?(u.carrier?'●':'◌'):'○'} М${u.id}`; b.onclick=()=>{ active=u.id; selectUnit(); }; b.ondblclick=()=>{ map.focus=pos(u.id); if(map.zoom<3) map.zoom=3; $$('.tabs button').forEach(x=>x.classList.toggle('on',x.dataset.tab==='map')); $$('.tab').forEach(t=>t.classList.toggle('on',t.id==='tab-map')); drawMap(); }; el.appendChild(b); }); }
function selectUnit(){ const u=units.get(active); renderUnits(); renderDesc(); drawSonar(u.sonarData,u.sonarMask,u.sonarTilt||0); showImg(u); updateTarget();
  $('#sub-tlm').value=u.subs.tlm; $('#tx-pow').value=u.subs.tx||0; $('#sub-sonar').value=u.subs.sonar; $('#sub-desc').value=u.subs.desc; $('#sub-img').value=u.subs.img; $('#img-level').value=u.subs.level; $('#img-delta').checked=u.subs.delta;
  $('#sonar-body').hidden=!u.sonar; $('#sonar-none').hidden=u.sonar; $('#img-body').hidden=!u.camera; $('#img-none').hidden=u.camera; $('#img-look').textContent=`смотрит: ${u.goalName?'на «'+u.goalName+'»':'вперёд'}`; }
function renderDesc(){ const u=units.get(active), el=$('#desc'); el.innerHTML=''; $('#desc-unit').textContent='М'+active; if(!u||!u.desc.length){ el.innerHTML='<div class="dim small">нет данных</div>'; return; }
  el.insertAdjacentHTML('beforeend',`<div class="dim small">${(tNow-u.descAt).toFixed(0)} с назад</div>`); const tg=T();
  for(const it of u.desc){ const name=it.name; const d=document.createElement('div'); d.className='it'+(tg&&tg.id===it.id?' sel':''); const j=jlast(it.id);
    const js=journal.get(it.id)||[]; const open=expanded.has(it.id);
    d.innerHTML=`<span class="${it.cls===2?'u':'n'}">${name}</span> <span class="dim">${it.bearing}° · ${it.range} м</span>`+(j?`<br><span class="j">М${j.unit}: ${j.text}</span>`:'')+(js.length>1?` <span class="jt">${open?'▾':'▸'} ${js.length} записей</span>`:'')+(open?js.slice(0,-1).map(e=>`<div class="jl">${fmtT(e.t)} М${e.unit}: ${e.text}</div>`).join(''):'');
    const cont=contents.get(it.id);
    if(cont) d.innerHTML+=`<div class="cont dim">${cont.length?'здесь: '+cont.map(i=>ITEMS[i]).join(', '):'пусто'}</div>`;
    d.onclick=e=>{ if(e.target.classList.contains('jt')){ expanded.has(it.id)?expanded.delete(it.id):expanded.add(it.id); renderDesc(); return; } setTarget({id:it.id,cls:it.cls,x:it.x,y:it.y,name}); }; el.appendChild(d); } }
const expanded=new Set();
function nearestLandmark(x,y){ let best=null, bd=1e9; for(const o of known.values()){ if(o.cls!==1) continue; const d=Math.hypot(o.x-x,o.y-y); if(d<bd){ bd=d; best=o; } } return best?best.name:'станция'; }
function renderJournal(){ const el=$('#journal'); el.innerHTML=''; const fu=$('#jf-unit').value, flm=$('#jf-lm').value;
  const rows=[]; const lms=new Set();
  for(const [id,entries] of journal){ const o=[...known.values()].find(k=>k.id===id); const lm=o?nearestLandmark(o.x,o.y):'без координат'; lms.add(lm); const name=o?o.name:('объект '+id);
    for(const e of entries) rows.push({t:e.t,unit:e.unit,text:e.text,name,lm,o}); }
  const ju=$('#jf-unit'); if(ju.options.length!==units.size+1){ const cur=ju.value; ju.innerHTML='<option value="">все</option>'; for(const v of units.values()) ju.insertAdjacentHTML('beforeend',`<option value="${v.id}">М${v.id}</option>`); ju.value=cur; }
  const jl=$('#jf-lm'); if(jl.options.length!==lms.size+1){ const cur=jl.value; jl.innerHTML='<option value="">все</option>'; for(const l of lms) jl.insertAdjacentHTML('beforeend',`<option value="${l}">${l}</option>`); jl.value=cur; }
  const f=rows.filter(r=>(!fu||r.unit===+fu)&&(!flm||r.lm===flm)).sort((a,b)=>b.t-a.t);
  $('#jf-count').textContent=`${f.length} из ${rows.length}`;
  if(!rows.length){ el.innerHTML='<div class="dim">записей нет</div>'; return; }
  for(const r of f){ const d=document.createElement('div'); d.className='row-e'; d.innerHTML=`<span class="t">${fmtT(r.t)}</span><span class="u">М${r.unit}</span><span class="n">${r.name}</span>${r.text} <span class="lm">· ${r.lm}</span>`; if(r.o) d.onclick=()=>setTarget({id:r.o.id,cls:r.o.cls,x:r.o.x,y:r.o.y,name:r.name}); el.appendChild(d); } }
['#jf-unit','#jf-lm'].forEach(s=>$(s).onchange=renderJournal);
function updateTarget(){ const tg=T(); $('#target-label').textContent=tg?`выбрано: ${tg.name} (${Math.round(tg.x)}, ${Math.round(tg.y)})`:'выбор: нет'; }
function setTarget(tg){ units.get(active).sel=tg; renderDesc(); updateTarget(); }   // выбор — локальный, ничего не уходит
function setGoal(name,p){ const u=units.get(active); u.prevGoal={name:u.goalName,pos:u.goalPos}; u.goalName=name; if(p) u.goalPos={x:p.x,y:p.y}; else if(T()) u.goalPos={x:T().x,y:T().y}; $('#img-look').textContent=`смотрит: ${name?'на «'+name+'»':'вперёд'}`; }

function fitCanvas(cv, crt){
  // crt: рисуем в половинном разрешении, по горизонтали чуть уже — растягивается вширь — при растяжении получается ЭЛТ-зерно и крупный «плохой» шрифт
  const w=Math.max(50,(cv.clientWidth/(crt?2.15:1))|0), h=Math.max(50,(cv.clientHeight/(crt?2:1))|0); if(cv.width!==w||cv.height!==h){ cv.width=w; cv.height=h; } }
function drawMap(){ const cv=$('#map'); fitCanvas(cv,true); const ctx=cv.getContext('2d'), W=cv.width, H=cv.height; ctx.fillStyle='#000'; ctx.fillRect(0,0,W,H);
  const SP=station.pos||STATION; const pts=[{x:SP.x,y:SP.y},...Object.values(station.relayGeo),...Object.values(station.turretGeo)]; for(const o of known.values()) pts.push(o); for(const u of units.values()){ pts.push(...u.track); }
  let minx=Math.min(...pts.map(p=>p.x))-30, maxx=Math.max(...pts.map(p=>p.x))+30, miny=Math.min(...pts.map(p=>p.y))-30, maxy=Math.max(...pts.map(p=>p.y))+30;
  const sc=Math.min(W/(maxx-minx),H/(maxy-miny))*map.zoom;
  if(map.focus){ map.panX=((minx+maxx)/2-map.focus.x)*sc; map.panY=((miny+maxy)/2-map.focus.y)*sc; map.focus=null; }   // перелёт к точке
  // сдвиг ограничен: центр вида не дальше радиуса возврата от всего, что консоль знает (станция, узлы, объекты, пути) — дальше ни данных, ни целей
  { const M=station.returnR||500; const ccx=Math.max(minx-M,Math.min(maxx+M,(minx+maxx)/2-map.panX/sc)), ccy=Math.max(miny-M,Math.min(maxy+M,(miny+maxy)/2-map.panY/sc)); map.panX=((minx+maxx)/2-ccx)*sc; map.panY=((miny+maxy)/2-ccy)*sc; }
  const cx=(minx+maxx)/2-map.panX/sc, cy=(miny+maxy)/2-map.panY/sc; const sx=x=>W/2+(x-cx)*sc, sy=y=>H/2+(y-cy)*sc; map.tf={sx,sy,sc,cx,cy,W,H};
  // сетка: шаг подбирается так, чтобы клетка была 40–120 px; подписи координат по краям
  const step=[1,2,5,10,20,50,100,200,500,1000].find(s=>s*sc>=40)||1000; const vx0=cx-W/2/sc, vx1=cx+W/2/sc, vy0=cy-H/2/sc, vy1=cy+H/2/sc;
  ctx.strokeStyle='#1a1e25'; ctx.fillStyle='#444'; ctx.font='9px monospace';
  for(let gx=Math.floor(vx0/step)*step;gx<=vx1;gx+=step){ ctx.beginPath(); ctx.moveTo(sx(gx),0); ctx.lineTo(sx(gx),H); ctx.stroke(); ctx.fillText(gx,sx(gx)+2,H-3); }
  for(let gy=Math.floor(vy0/step)*step;gy<=vy1;gy+=step){ ctx.beginPath(); ctx.moveTo(0,sy(gy)); ctx.lineTo(W,sy(gy)); ctx.stroke(); ctx.fillText(gy,2,sy(gy)-2); }
  // линейка масштаба
  ctx.fillStyle='#aaa'; ctx.fillRect(W-16-step*sc,12,step*sc,2); ctx.fillText(step+' м',W-16-step*sc,10);
  // покрытие: где снимались описания (радиус 100 м). Два тона, без наслоения и без зависимости от времени: все прошлые — одна область
  // одним тоном, последний снимок каждого миссионера — чуть светлее
  { const off=map.off||(map.off=document.createElement('canvas')); if(off.width!==W||off.height!==H){ off.width=W; off.height=H; } const o=off.getContext('2d'); o.clearRect(0,0,W,H); o.fillStyle='#9fb59f';
    for(const u of units.values()) for(const q of u.descPts){ o.beginPath(); o.arc(sx(q.x),sy(q.y),100*sc,0,7); o.fill(); }
    ctx.globalAlpha=0.05; ctx.drawImage(off,0,0);
    o.clearRect(0,0,W,H); for(const u of units.values()){ const q=u.descPts[u.descPts.length-1]; if(!q) continue; o.beginPath(); o.arc(sx(q.x),sy(q.y),100*sc,0,7); o.fill(); }
    ctx.globalAlpha=0.04; ctx.drawImage(off,0,0); ctx.globalAlpha=1; }
  // карта высот: заливка тоном по высоте (ниже — темнее) и изогипсы через 0,5 м по центрам ячеек (marching squares)
  if(hmap.size&&(map.hm||map.iso)){ const sm=hmapSmooth(); const i0=Math.floor((cx-W/2/sc)/HCELL)-1, i1=Math.floor((cx+W/2/sc)/HCELL)+1, j0=Math.floor((cy-H/2/sc)/HCELL)-1, j1=Math.floor((cy+H/2/sc)/HCELL)+1; const get=(i,j)=>sm.get(i+','+j);
    const cs=HCELL*sc; if(map.hm) for(let i=i0;i<=i1;i++)for(let j=j0;j<=j1;j++){ const c=get(i,j); if(!c) continue; const t=Math.max(0,Math.min(1,(c.z+3)/30)); ctx.fillStyle=`rgba(${70+120*t},${110+90*t},${100+70*t},${0.12+0.05*Math.min(c.w,4)})`; ctx.fillRect(sx(i*HCELL),sy(j*HCELL),cs+0.5,cs+0.5); }
    if(map.iso&&cs>=2){ ctx.strokeStyle='rgba(140,210,185,0.7)'; ctx.lineWidth=1; ctx.beginPath(); for(const [x1,y1,x2,y2] of hmapContours(sm,i0,i1,j0,j1)){ ctx.moveTo(sx(x1),sy(y1)); ctx.lineTo(sx(x2),sy(y2)); } ctx.stroke(); } }
  // стены с лидара — растр 0,5 м: яркость по числу попаданий (одно — тускло, три и больше — ярко); при отдалении ячейка меньше пикселя — точка
  if(map.walls&&wmap.size){ const x0=cx-W/2/sc-WCELL, x1=cx+W/2/sc, y0=cy-H/2/sc-WCELL, y1=cy+H/2/sc; const ws=Math.max(1,WCELL*sc);
    for(const [k,n] of wmap){ const [i,j]=k.split(',').map(Number); const x=i*WCELL, y=j*WCELL; if(x<x0||x>x1||y<y0||y>y1) continue; ctx.fillStyle=`rgba(226,240,255,${n>=3?0.85:n===2?0.6:0.35})`; ctx.fillRect(sx(x),sy(y),ws,ws); } }
  // радиус возврата (ПС-2) — пунктир вокруг узлов: станция и включённые ретрансляторы из пульса (где стоят — из паспорта)
  if(station.returnR){ const nodes=[SP, ...station.relays.filter(R=>R.on&&station.relayGeo[R.id]).map(R=>station.relayGeo[R.id])]; ctx.strokeStyle='rgba(224,169,74,0.35)'; ctx.setLineDash([4,6]); for(const n of nodes){ ctx.beginPath(); ctx.arc(sx(n.x),sy(n.y),station.returnR*sc,0,7); ctx.stroke(); } ctx.setLineDash([]); }
  // ретрансляторы, чей маяк слышен: ромб, включённый — залитый
  for(const R of station.relays){ const g=station.relayGeo[R.id]; if(!g) continue; const X=sx(g.x),Y=sy(g.y),r=R.mobile?3:4; ctx.beginPath(); ctx.moveTo(X,Y-r); ctx.lineTo(X+r,Y); ctx.lineTo(X,Y+r); ctx.lineTo(X-r,Y); ctx.closePath(); ctx.strokeStyle='#e0a94a'; if(R.on){ ctx.fillStyle='#e0a94a'; ctx.fill(); } ctx.stroke(); ctx.fillStyle='#8a7040'; ctx.font='10px monospace'; ctx.fillText('ретр. '+R.id,X+6,Y+3); }
  // знак станции — контур корпуса из кодовой книги (эллипс, люк на +x); лидар отражается от того же контура
  ctx.strokeStyle='#666'; ctx.beginPath(); ctx.ellipse(sx(SP.x),sy(SP.y),STATION.rx*sc,STATION.ry*sc,SP.ang||0,0,7); ctx.stroke(); ctx.fillStyle='#555'; ctx.font='10px monospace'; ctx.fillText('станция',sx(SP.x)-8*sc-44,sy(SP.y)+3);
  ctx.setLineDash([3,5]); ctx.strokeStyle='rgba(255,220,120,0.35)'; ctx.beginPath(); ctx.arc(sx(SP.x),sy(SP.y),(station.powerR||STATION.powerR)*sc,0,7); ctx.stroke(); ctx.setLineDash([]);   // зона питания — знание протокола, как эллипс корпуса
  // сектор горящей лампы турели — из паспорта (где стоит, курс, сектор, дальность) и пульса (горит ли); сама турель на карте — объект из описания, как всё остальное
  for(const T of station.turrets){ const g=station.turretGeo[T.id]; if(!g||!(T.powered&&T.on&&!T.broken)) continue; const X=sx(g.x),Y=sy(g.y); ctx.fillStyle='rgba(255,220,120,0.07)'; ctx.strokeStyle='rgba(255,220,120,0.35)'; ctx.beginPath(); ctx.moveTo(X,Y); ctx.arc(X,Y,g.range*sc,g.ang-g.fov/2,g.ang+g.fov/2); ctx.closePath(); ctx.fill(); ctx.stroke(); }
  for(const u of units.values()){ const col=UCOL[(u.id-1)%UCOL.length]; ctx.strokeStyle=col; ctx.globalAlpha=0.5; ctx.beginPath(); const t0=map.trackLife?tNow-map.trackLife:-1; u.track.filter(p=>!(p.t<t0)).forEach((p,i)=>i?ctx.lineTo(sx(p.x),sy(p.y)):ctx.moveTo(sx(p.x),sy(p.y))); ctx.stroke(); ctx.globalAlpha=1; }
  ctx.font='10px monospace';
  const tg=T(), au0=units.get(active), gp=au0&&au0.goalPos;
  // ориентир — место: ромб с ножкой и имя ПРОПИСНЫМИ над ним; предмет, тело, существо — точка и имя строчными справа
  const labels=[]; const place=(x,y,w)=>{ let yy=y; for(let k=0;k<6;k++){ if(!labels.some(l=>Math.abs(l.y-yy)<10&&x<l.x+l.w&&x+w>l.x)) break; yy+=10; } labels.push({x,y:yy,w}); return yy; };   // подписи не налезают: сдвиг вниз
  for(const o of [...known.values()].sort((a,b)=>(b.cls===1)-(a.cls===1))){ const age=tNow-o.at, mine=o.seenBy.has(active); ctx.globalAlpha=(mine?Math.max(0.4,1-age/600):0.22); const col=o.cls===2?'#ff5c5c':o.cls===3?'#888':o.cls===1?'#e0a94a':'#9fb59f'; const X=sx(o.x), Y=sy(o.y);   // ориентиры первыми: их подписи на месте, предметы уступают
    if(o.cls===1){ ctx.strokeStyle=col; ctx.lineWidth=1.2; ctx.beginPath(); ctx.moveTo(X,Y-10); ctx.lineTo(X+4,Y-6); ctx.lineTo(X,Y-2); ctx.lineTo(X-4,Y-6); ctx.closePath(); ctx.moveTo(X,Y-2); ctx.lineTo(X,Y); ctx.stroke(); ctx.lineWidth=1; if(mine){ ctx.fillStyle=col; ctx.font='bold 9px monospace'; const nm=o.name.toUpperCase(); place(X+7,Y-5,ctx.measureText(nm).width); ctx.fillText(nm,X+7,Y-5); ctx.font='10px monospace'; } }
    else { ctx.fillStyle=col; ctx.strokeStyle=col; ctx.beginPath(); ctx.arc(X,Y,2,0,7); if(mine) ctx.fill(); else ctx.stroke(); if(mine&&(o.cls!==0||sc>1.2)){ const yy=place(X+5,Y+3,ctx.measureText(o.name).width); if(yy!==Y+3){ ctx.beginPath(); ctx.moveTo(X,Y); ctx.lineTo(X+4,yy-3); ctx.stroke(); } ctx.fillText(o.name,X+5,yy); } } }
  { const au=units.get(active); if(au){ const p=pos(active); let ang=null; if(gp&&Math.hypot(gp.x-p.x,gp.y-p.y)>1.5) ang=Math.atan2(gp.y-p.y,gp.x-p.x); else if(au.track.length>1){ const a=au.track[au.track.length-2], b=au.track[au.track.length-1]; ang=Math.atan2(b.y-a.y,b.x-a.x); } else ang=0;
      const R=80*sc, f=52*Math.PI/180; ctx.fillStyle='rgba(224,169,74,0.10)'; ctx.beginPath(); ctx.moveTo(sx(p.x),sy(p.y)); ctx.arc(sx(p.x),sy(p.y),R,ang-f,ang+f); ctx.closePath(); ctx.fill(); } }
  ctx.globalAlpha=1; if(gp){ ctx.strokeStyle='#e0a94a'; ctx.beginPath(); ctx.arc(sx(gp.x),sy(gp.y),5,0,7); ctx.stroke(); } if(tg){ ctx.strokeStyle='#fff'; ctx.beginPath(); ctx.arc(sx(tg.x),sy(tg.y),7,0,7); ctx.stroke(); ctx.fillStyle='#fff'; ctx.fillText('выбрано',sx(tg.x)+9,sy(tg.y)-8); }
  ctx.globalAlpha=1;
  for(const u of units.values()){ const p=pos(u.id); const col=UCOL[(u.id-1)%UCOL.length]; ctx.fillStyle=u.alive?col:'#666'; ctx.beginPath(); ctx.arc(sx(p.x),sy(p.y),u.id===active?5:3.5,0,7); ctx.fill(); ctx.fillStyle=col; ctx.fillText(`М${u.id}${u.alive?'':' †'}`,sx(p.x)+7,sy(p.y)-6); if(u.tlm&&tNow-u.tlmAt>10){ ctx.fillStyle='#888'; ctx.fillText(`${(tNow-u.tlmAt).toFixed(0)} с назад`,sx(p.x)+7,sy(p.y)+6); } }
  $('#map-count').textContent=`объектов: ${known.size}`; $('#map-scale').textContent=`1 px = ${(1/sc).toFixed(2)} м · ×${map.zoom.toFixed(1)}`; }
const map={tf:null,zoom:1,panX:0,panY:0,drag:null,hm:true,iso:true,walls:true,trackLife:0};   // hm/iso/walls — показ карты высот, изогипс и стен; trackLife — сколько секунд пути показывать, 0 — весь
{ const cv=$('#map');
  cv.onwheel=e=>{ e.preventDefault(); const tf=map.tf; if(!tf) return; const r=cv.getBoundingClientRect(); const px=(e.clientX-r.left)*(cv.width/r.width), py=(e.clientY-r.top)*(cv.height/r.height);
    const f=e.deltaY<0?1.07:1/1.07; const nz=Math.max(0.5,Math.min(40,map.zoom*f)); const k=nz/map.zoom;
    // зум к курсору: точка под курсором остаётся на месте
    map.panX=(map.panX-(px-tf.W/2))*k+(px-tf.W/2); map.panY=(map.panY-(py-tf.H/2))*k+(py-tf.H/2); map.zoom=nz; drawMap(); };
  cv.onmousedown=e=>{ map.drag={x:e.clientX,y:e.clientY,px:map.panX,py:map.panY,moved:false}; };
  window.addEventListener('mousemove',e=>{ if(!map.drag) return; const r=cv.getBoundingClientRect(), k=cv.width/r.width; const dx=(e.clientX-map.drag.x)*k, dy=(e.clientY-map.drag.y)*k; if(Math.hypot(dx,dy)>4) map.drag.moved=true; map.panX=map.drag.px+dx; map.panY=map.drag.py+dy; if(map.drag.moved) drawMap(); });
  window.addEventListener('mouseup',()=>{ if(map.drag&&map.drag.moved) map.suppressClick=true; map.drag=null; });
  cv.ondblclick=()=>{ map.zoom=1; map.panX=0; map.panY=0; drawMap(); };
  const zoomBy=f=>{ const nz=Math.max(0.5,Math.min(40,map.zoom*f)); const k=nz/map.zoom; map.panX*=k; map.panY*=k; map.zoom=nz; drawMap(); };
  $('#map-tracks').onchange=()=>{ map.trackLife=+$('#map-tracks').value; drawMap(); };
  for(const id of ['hm','iso','walls']) $('#map-'+id).onclick=e=>{ map[id]=!map[id]; e.target.classList.toggle('on',map[id]); drawMap(); };
  $('#map-plus').onclick=()=>zoomBy(1.5); $('#map-minus').onclick=()=>zoomBy(1/1.5); $('#map-reset').onclick=()=>{ map.zoom=1; map.panX=0; map.panY=0; drawMap(); }; }
$('#map').onclick=e=>{ if(map.suppressClick){ map.suppressClick=false; return; } const cv=$('#map'), r=cv.getBoundingClientRect(), tf=map.tf; if(!tf) return; const px=(e.clientX-r.left)*(cv.width/r.width), py=(e.clientY-r.top)*(cv.height/r.height);
  if(LAB){ labJump(tf.cx+(px-tf.W/2)/tf.sc, tf.cy+(py-tf.H/2)/tf.sc); return; }
  let best=null, bd=12; for(const o of known.values()){ const d=Math.hypot(tf.sx(o.x)-px,tf.sy(o.y)-py); if(d<bd){ bd=d; best=o; } }
  const wx=Math.round(tf.cx+(px-tf.W/2)/tf.sc), wy=Math.round(tf.cy+(py-tf.H/2)/tf.sc);
  setTarget(best?{id:best.id,cls:best.cls,x:best.x,y:best.y,name:best.name}:{id:0,cls:0,x:wx,y:wy,name:`точка ${wx}, ${wy}`}); };

function drawChartTlm(){ const cv=$('#chart-tlm'); fitCanvas(cv); const ctx=cv.getContext('2d'), W=cv.width, H=cv.height; ctx.fillStyle='#000'; ctx.fillRect(0,0,W,H); const u=units.get(+$('#ch-unit').value||active); const f=$('#ch-field').value; if(!u||!u.hist.length) return;
  const h=u.hist, t0=h[0].t, t1=Math.max(tNow,t0+60); const max=f==='pulse'?220:f==='cons'?3:100; ctx.strokeStyle='#1a1e25'; for(let g=0;g<=4;g++){ const y=H-g/4*H; ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); ctx.fillStyle='#555'; ctx.font='10px monospace'; ctx.fillText((max*g/4).toFixed(0),2,y-2); }
  ctx.strokeStyle=UCOL[(u.id-1)%UCOL.length]; ctx.fillStyle=ctx.strokeStyle; ctx.beginPath(); let prev=null;
  for(const p of h){ const x=(p.t-t0)/(t1-t0)*W, y=H-Math.min(1,p[f]/max)*H; if(prev&&p.t-prev.t>6){ ctx.stroke(); ctx.beginPath(); ctx.moveTo(x,y); } else if(!prev) ctx.moveTo(x,y); else ctx.lineTo(x,y); ctx.fillRect(x-1,y-1,2,2); prev=p; } ctx.stroke();
  ctx.fillStyle='#555'; ctx.fillText(fmtT(t0),2,H-2); ctx.fillText(fmtT(t1),W-40,H-2); }
function drawChartCh(){ const cv=$('#chart-ch'); fitCanvas(cv); const ctx=cv.getContext('2d'), W=cv.width, H=cv.height; ctx.fillStyle='#000'; ctx.fillRect(0,0,W,H); const h=modemHist; if(!h.length) return;
  const kinds=['TLM','HB','SONAR','DESC','IMG','EVT','drop']; const max=Math.max(100,...h.map(s=>Math.max(s.cap,kinds.reduce((a,k)=>a+s[k],0)))); const bwd=W/90;
  h.forEach((s,i)=>{ const x=W-(h.length-i)*bwd; let y=H; for(const k of kinds){ const hh=s[k]/max*H; ctx.fillStyle=KIND_COL[k]; ctx.fillRect(x,y-hh,bwd-1,hh); y-=hh; } });
  ctx.strokeStyle='#fff'; ctx.beginPath(); h.forEach((s,i)=>{ const x=W-(h.length-i)*bwd+bwd/2, y=H-s.cap/max*H; i?ctx.lineTo(x,y):ctx.moveTo(x,y); }); ctx.stroke(); ctx.fillStyle='#888'; ctx.font='10px monospace'; ctx.fillText(Math.round(max)+' Б/с',4,10); ctx.fillText('90 с',W-30,H-4); }
function bwRate(k){ const arr=bw[k]||[]; while(arr.length&&tNow-arr[0].t>5) arr.shift(); return arr.reduce((a,p)=>a+p.b,0)/5; }
const TR={ox:160,oy:90,k:0.45};   // правда о мире: масштаб и смещение — чтобы влезала расщелина с логовом
function drawTruth(){ const cv=$('#truth'), ctx=cv.getContext('2d'); ctx.fillStyle='#000'; ctx.fillRect(0,0,360,200); const sx=x=>TR.ox+x*TR.k, sy=y=>TR.oy+y*TR.k; ctx.strokeStyle='#333'; for(const S of (modem.dbg&&modem.dbg.world&&modem.dbg.world.stations)||[STATION]){ ctx.beginPath(); ctx.ellipse(sx(S.x),sy(S.y),STATION.rx*TR.k,STATION.ry*TR.k,S.ang||0,0,7); ctx.stroke(); }
  if(dbgLevel){ ctx.strokeStyle='#444'; ctx.beginPath(); for(const pts of [dbgLevel.canyon.pts,dbgLevel.canyon.branch]) pts.forEach((p,i)=>i?ctx.lineTo(sx(p.x),sy(p.y)):ctx.moveTo(sx(p.x),sy(p.y))); ctx.stroke();   // расщелина с отростком и ориентиры — из уровня, присланы миром при старте
    ctx.fillStyle='#666'; ctx.font='10px monospace'; for(const p of dbgLevel.pois){ ctx.fillRect(sx(p.x)-1,sy(p.y)-1,3,3); ctx.fillText(p.id,sx(p.x)+4,sy(p.y)+3); } }
  const dbg=modem.dbg&&modem.dbg.world; if(dbg){ ctx.font='10px monospace'; for(const u of dbg.units){ ctx.fillStyle=u.alive?UCOL[(u.id-1)%UCOL.length]:'#666'; ctx.fillRect(sx(u.x)-2,sy(u.y)-2,5,5); ctx.fillText('М'+u.id,sx(u.x)+5,sy(u.y)+3); } for(const p of dbg.pack||[]){ const r=1.5+p.size*1.5; ctx.fillStyle=p.act==='sleep'?'#553':p.act==='attack'?'#ff3c3c':p.act==='flee'||p.act==='home'||p.act==='rest'?'#a86a2a':p.act==='approach'?'#ff8a5c':'#c9a24a'; ctx.beginPath(); ctx.arc(sx(p.x),sy(p.y),r,0,7); ctx.fill(); if(p.hp<3*p.size-0.5){ ctx.strokeStyle='#fff'; ctx.strokeRect(sx(p.x)-r,sy(p.y)-r,2*r,2*r); } }   // одичалые: цвет — что делает, размер — размер, рамка — ранена
    for(const c of dbg.cries||[]){ ctx.strokeStyle='rgba(255,220,120,'+Math.max(0,1-c.age/4)+')'; ctx.beginPath(); ctx.arc(sx(c.x),sy(c.y),3+c.age*12,0,7); ctx.stroke(); ctx.fillStyle='#ffdc78'; ctx.fillText(c.word,sx(c.x)+6,sy(c.y)-4); } } }
// телепорт: клик — в точку, перетаскивание — тело едет за курсором (мимо канала)
{ const cv=$('#truth'); let drag=false; const at=e=>{ const r=cv.getBoundingClientRect(); return { x:((e.clientX-r.left)*(360/r.width)-TR.ox)/TR.k, y:((e.clientY-r.top)*(200/r.height)-TR.oy)/TR.k }; };
  const tp=p=>transport.send({t:'tp',unit:active,x:p.x,y:p.y});
  cv.onmousedown=e=>{ drag=true; tp(at(e)); e.preventDefault(); }; cv.onmousemove=e=>{ if(drag) tp(at(e)); };
  window.addEventListener('mouseup',e=>{ if(!drag) return; drag=false; const p=at(e); tp(p); log(`[отладка] телепорт М${active} в ${p.x.toFixed(0)}, ${p.y.toFixed(0)}`,'sys'); }); }

// ---------- команды ----------
function send(bytes,label){ if(!modem.up){ log(`${label}: нет связи со станцией`,'err'); return false; } transport.send({t:'up',bytes:[...bytes]}); if(label) log(`→ ${label}`,'cmd'); return true; }
function coordBytes(p){ const X=Math.round(p.x*10)+32768, Y=Math.round(p.y*10)+32768; return [X>>8,X&255,Y>>8,Y&255]; }   // дециметры
// лаборатория: телепорт (мимо канала, как в шторке) и сразу запрос лидара с текущим наклоном; положение ведём сами — телеметрия отстаёт
const lab={pos:null};
function labJump(x,y){ lab.pos={x,y}; transport.send({t:'tp',unit:active,x,y}); send([2,+$('#sonar-tilt').value+90,active]); }
if(LAB) document.addEventListener('keydown',e=>{ if(/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return; const d={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[e.key]; if(!d) return; e.preventDefault();
  const p=lab.pos||pos(active), st=e.shiftKey?10:2; labJump(p.x+d[0]*st,p.y+d[1]*st); });
function moveTo(tg){ const u=units.get(active); if(!u||!u.alive){ log('М'+active+': тело мертво, перемещение невозможно','err'); return; } if(send([6,0,active,...coordBytes(tg)],`М${active} идти: ${tg.name}`)) setGoal(tg.name); }
$$('button[data-cmd]').forEach(b=>b.onclick=()=>{ const c=+b.dataset.cmd, tg=T();
  if(c===8){ if(!tg||!tg.id) return log('объект не выбран','err'); if(send([8,tg.id,active],`М${active} взаимодействовать: ${tg.name}`)) setGoal(tg.name); }
  if(c===19){ if(!tg||!tg.id) return log('объект не выбран','err'); if(send([19,tg.id,active],`М${active} изучить: ${tg.name}`)) setGoal(tg.name); } });
$('#btn-desc').onclick=()=>{ const u=units.get(active); if(!u.alive) return log('М'+active+': тело мертво, описание недоступно','err'); send([1,0,active],`М${active} описание`); };
$('#btn-move').onclick=()=>{ const tg=T(); if(!tg) return log('цель не выбрана','err'); moveTo(tg); };
$('#btn-look').onclick=()=>{ const tg=T(); if(!tg) return log('цель не выбрана','err'); if(send([18,0,active,...coordBytes(tg)],`М${active} смотреть: ${tg.name}`)) setGoal(tg.name); };
$('#btn-sonar').onclick=()=>{ const u=units.get(active); if(!u.sonar) return log('М'+active+': лидар не установлен','err'); const k=+$('#sonar-tilt').value; send([2,k+90,active],`М${active} лидар${k?` (наклон ${k>0?'+':''}${k}°)`:''}`); };
$$('button[data-mode]').forEach(b=>b.onclick=()=>{ if(send([7,+b.dataset.mode,active],`М${active} режим ${MODES[b.dataset.mode]}`)){ req(active,'mode',+b.dataset.mode); if(b.dataset.mode==='3') setGoal('шлюз станции',{x:16,y:0}); } });
$$('button[data-stance]').forEach(b=>b.onclick=()=>{ if(send([25,+b.dataset.stance,active],`М${active} при контакте: ${STANCES[b.dataset.stance]}`)) req(active,'stance',+b.dataset.stance); });
$('#stealth').onchange=e=>{ const on=e.target.checked?1:0; if(send([24,on,active],`М${active} скрытность ${on?'вкл':'выкл'}`)) req(active,'stealth',!!on); else renderUnit(); };
// запрошенное состояние тела: свои команды и эхо сокомандника; контур на кнопке, пока телеметрия не подтвердит
function req(id,k,v,by){ const u=U(id); u.req=u.req||{at:tNow}; u.req[k]=v; u.req.at=tNow; if(by) u.req.by=by; renderUnit(); }
// кнопки режима и стойки, галочка скрытности: залито — по телеметрии, контур — запрошено (своё или сокомандника), ещё не подтверждено
function renderUnit(){ const u=units.get(active); const T=u&&u.tlm, r=u&&u.req||{};
  $$('button[data-mode]').forEach(b=>{ const v=+b.dataset.mode; b.classList.toggle('on',!!T&&T.mode===v); b.classList.toggle('req',r.mode===v); });
  $$('button[data-stance]').forEach(b=>{ const v=+b.dataset.stance; b.classList.toggle('on',!!T&&T.stance===v); b.classList.toggle('req',r.stance===v); });
  $$('button[data-autonomy]').forEach(b=>{ const v=+b.dataset.autonomy; b.classList.toggle('on',!!T&&T.autonomy===v); b.classList.toggle('req',r.autonomy===v); });
  const st=$('#stealth'); st.checked=r.stealth!==undefined?r.stealth:!!(T&&T.stealth); st.parentElement.classList.toggle('req',r.stealth!==undefined);
  st.parentElement.title=r.by?`запросил ${r.by}`:''; }
// эхо аплинка сокомандника — знание земной стороны, канал не проходит; подпись команды по байтам
function cmdLabel(b){ const [c,a,un]=b; const M=un?`М${un} `:''; const xy=()=>`(${(((b[3]<<8)|b[4])-32768)/10}, ${(((b[5]<<8)|b[6])-32768)/10})`;
  return {1:`${M}описание`,2:`${M}лидар`,3:`${M}кадр ${[8,16,32,64][a]}px`,6:`${M}идти ${xy()}`,7:`${M}режим ${MODES[a]||a}`,8:`${M}действие: ${oname(a)}`,9:`${M}передатчик ${a-20} дБм`,10:'вырастить',11:'статус',12:`${M}телеметрия ${a} с`,13:`${M}лидар каждые ${a} с`,14:`${M}описание каждые ${a} с`,15:`пульс ${a} с`,16:`${M}автосъёмка ${a?'каждые '+a+' с':'выкл'}`,17:`${M}стоп`,18:`${M}смотреть ${xy()}`,19:`${M}изучить: ${oname(a)}`,20:`${M}съесть`,21:`${M}склад`,22:`${M}положить ${ITEMS[a]||a}`,23:`${M}взять ${ITEMS[a]||a}`,24:`${M}скрытность ${a?'вкл':'выкл'}`,25:`${M}при контакте: ${STANCES[a]||a}`,26:`${M}без несущей: ${AUTONOMY[a]||a}`,27:'отмена запроса'}[c]||`команда ${c}`; }
function onEcho(m){ const b=m.bytes; log(`${m.op} → ${cmdLabel(b)}`,'cmd'); const [c,a,un]=b; if(c===7) req(un,'mode',a,m.op); if(c===24) req(un,'stealth',!!a,m.op); if(c===25) req(un,'stance',a,m.op); if(c===26) req(un,'autonomy',a,m.op); }
$('#btn-img').onclick=()=>{ const u=units.get(active); if(!u.camera) return log('М'+active+': камера не установлена','err'); const lvl=+$('#img-level').value, d=$('#img-delta').checked?1:0; send([3,lvl,active,d],`М${active} кадр ${[8,16,32,64][lvl]}×${[8,16,32,64][lvl]}${d?' (дельта)':''}`); };
$('#btn-stop').onclick=()=>send([17,0,active],`М${active} стоп`);
$('#btn-take').onclick=()=>{ const tg=T(), item=+$('#take-item').value; if(!tg||!item) return; if(send([23,item,active,tg.id],`М${active} взять ${ITEMS[item]} из «${tg.name}»`)) setGoal(tg.name); };
$('#btn-put').onclick=()=>{ const tg=T(), item=+$('#put-item').value; if(!tg||!item) return; if(send([22,item,active,tg.id],`М${active} положить ${ITEMS[item]} в «${tg.name}»`)) setGoal(tg.name); };
$('#sonar').onwheel=e=>{ e.preventDefault(); const cur=map.sonarR||map.sonarAuto||50; map.sonarR=Math.max(5,Math.min(100,cur*(e.deltaY<0?1/1.15:1.15))); drawSonar(units.get(active).sonarData,units.get(active).sonarMask,units.get(active).sonarTilt||0); };
$('#sonar').ondblclick=()=>{ map.sonarR=null; drawSonar(units.get(active).sonarData,units.get(active).sonarMask,units.get(active).sonarTilt||0); };
$('#airlock').onclick=e=>{ const b=e.target.closest('[data-tr]'); if(!b) return; const [item,dir,unit]=b.dataset.tr.split(',').map(Number); send([21,item,unit,dir],`М${unit} ${dir?'взять со склада':'сдать на склад'}: ${ITEMS[item]}`); };
{ const sp=$('#splitter'), lw=$('#logwrap'); let drag=null;
  sp.onmousedown=e=>{ drag={y:e.clientY,h:lw.offsetHeight}; sp.classList.add('on'); e.preventDefault(); };
  window.addEventListener('mousemove',e=>{ if(!drag) return; const h=Math.max(60,Math.min(innerHeight*0.6,drag.h-(e.clientY-drag.y))); lw.style.height=h+'px'; });
  window.addEventListener('mouseup',()=>{ if(drag){ drag=null; sp.classList.remove('on'); try{ localStorage.setItem('missioners.logh',lw.style.height); }catch(e){} } });
  try{ const hh=localStorage.getItem('missioners.logh'); if(hh) lw.style.height=hh; }catch(e){} }
$('#v-items').onclick=e=>{ const b=e.target.closest('[data-eat]'); if(b) return send([20,+b.dataset.eat,active],`М${active} съесть брикет`); const dr=e.target.closest('[data-drop]'); if(dr) send([22,+dr.dataset.drop,active,0],`М${active} сбросить ${ITEMS[+dr.dataset.drop]} на грунт`); };
$('#st-btn-img').onclick=()=>{ const lvl=+$('#st-img-level').value, d=$('#st-img-delta').checked?1:0; send([3,lvl,0,d],`камера шлюза: кадр ${[8,16,32,64][lvl]}×${[8,16,32,64][lvl]}${d?' (дельта)':''}`); };
function sendStSub(){ const iv=+$('#st-sub-img').value, lvl=+$('#st-img-level').value, d=$('#st-img-delta').checked?1:0; Object.assign(stcam.subs,{img:iv,level:lvl,delta:!!d}); send([16,iv,0,lvl,d],`камера шлюза: автосъёмка ${iv?'каждые '+iv+' с ('+[8,16,32,64][lvl]+'px'+(d?', дельта':'')+')':'выкл'}`); }
$('#st-sub-img').onchange=sendStSub; $('#st-img-level').onchange=()=>{ if(+$('#st-sub-img').value) sendStSub(); }; $('#st-img-delta').onchange=()=>{ if(+$('#st-sub-img').value) sendStSub(); };
function sendImgSub(){ const u=units.get(active); const iv=+$('#sub-img').value, lvl=+$('#img-level').value, d=$('#img-delta').checked?1:0; Object.assign(u.subs,{img:iv,level:lvl,delta:!!d}); if(iv&&!u.camera) return log('М'+active+': камера не установлена','err'); send([16,iv,active,lvl,d],`М${active} автосъёмка: ${iv?'каждые '+iv+' с ('+[8,16,32,64][lvl]+'px'+(d?', дельта':'')+')':'выкл'}`); }
$('#sub-img').onchange=sendImgSub; $('#img-level').onchange=()=>{ units.get(active).subs.level=+$('#img-level').value; if(+$('#sub-img').value) sendImgSub(); }; $('#img-delta').onchange=()=>{ units.get(active).subs.delta=$('#img-delta').checked; if(+$('#sub-img').value) sendImgSub(); };
$('#tx-pow').onchange=e=>{ const v=+e.target.value; units.get(active).subs.tx=v; send([9,v+20,active],`М${active} передатчик ${v>0?'+':''}${v} дБм`); };
$('#sub-tlm').onchange=e=>{ units.get(active).subs.tlm=+e.target.value; send([12,+e.target.value,active],`М${active} телеметрия: ${e.target.selectedOptions[0].text}`); };
$('#sub-sonar').onchange=e=>{ units.get(active).subs.sonar=+e.target.value; send([13,+e.target.value,active],`М${active} лидар: ${e.target.selectedOptions[0].text}`); };
$('#sub-desc').onchange=e=>{ units.get(active).subs.desc=+e.target.value; send([14,+e.target.value,active],`М${active} описание: ${e.target.selectedOptions[0].text}`); };
$('#sub-hb').onchange=e=>send([15,+e.target.value,0],`пульс станции: ${e.target.selectedOptions[0].text}`);
$$('button[data-autonomy]').forEach(b=>b.onclick=()=>{ if(send([26,+b.dataset.autonomy,active],`М${active} без несущей: ${AUTONOMY[b.dataset.autonomy]}`)) req(active,'autonomy',+b.dataset.autonomy); });
$('#btn-grow').onclick=()=>{ const mask=($('#g-cam').checked?1:0)|($('#g-sonar').checked?2:0); if(send([10,mask,0],`станция: вырастить миссионера (${$('#g-cam').checked?'камера, ':''}${$('#g-sonar').checked?'лидар':''})`)){ $('#btn-grow').disabled=true; $('#grow-state').textContent='команда отправлена, ожидание подтверждения станции…'; } };
$('#btn-st').onclick=()=>send([11,0,0],'станция: статус');
$('#turrets').onclick=e=>{ const b=e.target.closest('button.tur'); if(!b||b.disabled) return; const id=+b.dataset.id, on=+b.dataset.on; if(send([28,on,id],`турель ${id}: ${on?'включить':'выключить'}`)) station.turretReq[id]={on:!!on,at:tNow}; };
$('#relays').onclick=e=>{ const b=e.target.closest('button.rel'); if(!b) return; const id=+b.dataset.id, on=+b.dataset.on; if(send([29,on,id],`ретранслятор ${id}: ${on?'включить':'выключить'}`)) station.relayReq[id]={on:!!on,at:tNow}; };
$('#speed').onchange=e=>{ speed=+e.target.value; transport.send({t:'speed',v:speed}); };
$$('.tabs button').forEach(b=>b.onclick=()=>{ $$('.tabs button').forEach(x=>x.classList.toggle('on',x===b)); $$('.tab').forEach(t=>t.classList.toggle('on',t.id==='tab-'+b.dataset.tab)); if(b.dataset.tab==='journal') renderJournal(); });
$('#fin-close').onclick=()=>$('#finale').hidden=true;
{ let clicks=[]; $('#btn-debug').onclick=()=>{ const now=Date.now(); clicks=clicks.filter(t=>now-t<800); clicks.push(now); if(clicks.length>=3){ clicks=[]; $('#drawer').hidden=false; } }; }   // три быстрых нажатия
$('#btn-debug-close').onclick=()=>$('#drawer').hidden=true;
$('#btn-worldlog').onclick=()=>{ if(transport.mp) alert('в сети лог мира ведёт сервер: data/КОД.log'); else transport.send({t:'log',op:'get'}); };
const bind=(id,key,fmt,tx)=>{ const el=$(id); el.oninput=()=>{ const v=+el.value; if(tx) send([9,v+20,active],`М${active} TX ${v} dBm`); else transport.send({t:'cfg',k:key,v}); $(id+'-v').textContent=fmt(v); }; };
bind('#c-tx',null,v=>v+' dBm',true); bind('#c-noise','noiseDbm',v=>v+' dBm'); bind('#c-bw','bwHz',v=>v+' Hz'); bind('#c-deep','deepCapBps',v=>v+' bps');
$('#c-fec').onchange=e=>transport.send({t:'cfg',k:'fec',v:e.target.checked}); $('#c-arq').onchange=e=>transport.send({t:'cfg',k:'arq',v:e.target.checked}); $('#c-orbit').onchange=e=>transport.send({t:'cfg',k:'orbit',v:e.target.checked});

// ---------- сноски ----------
const tip=$('#tip'); document.addEventListener('mouseover',e=>{ const el=e.target.closest('[data-tip]'); if(!el){ tip.style.display='none'; return; } tip.textContent=el.dataset.tip; tip.style.display='block'; });
document.addEventListener('mousemove',e=>{ if(tip.style.display!=='block') return; let x=e.clientX+14, y=e.clientY+14; if(x+350>innerWidth) x=e.clientX-350; if(y+tip.offsetHeight+10>innerHeight) y=e.clientY-tip.offsetHeight-10; tip.style.left=x+'px'; tip.style.top=y+'px'; });

// ---------- главный цикл ----------
let lastUp=null;   // до первых показаний модема состояние линии неизвестно
setInterval(()=>{
  const dt=0.1*speed; if(modem.up||!transport.mp) tNow+=dt;   // часы консоли идут за станцией; точная поправка — из показаний модема
  drawEcg(dt); renderUnit();
  const u=units.get(active); $('#tlm-unit').textContent='М'+active;
  if(u&&u.tlm){ const T=u.tlm, age=tNow-u.tlmAt; $('#tlm-age').textContent=age<1.5?'live':`${age.toFixed(0)} с назад`; $('#tlm-age').style.color=age>3*Math.max(1,+$('#sub-tlm').value||1)?'#d9534f':'';
    $('#pulse-val').textContent=T.pulse; $('#pulse-cls').textContent=T.pulse===0?'остановка':T.pulse<55?'замедленный':T.pulse<100?'нормальный':T.pulse<150?'ускоренный':T.pulse<220?'интенсивный':'экстремальный';
    for(const k of ['electro','glucose','toxin','skin','bone','psyche']){ $('#b-'+k).style.width=Math.min(100,T[k])+'%'; $('#v-'+k).textContent=T[k]; }
    $('#v-danger').textContent=T.danger?'ДА':'нет'; $('#v-danger').style.color=T.danger?'#ff5c5c':''; $('#v-cons').textContent=T.cons.toFixed(2); $('#v-charge').textContent=T.charge.toFixed(0)+'%'; $('#v-gen').textContent=T.gen.toFixed(2); $('#v-xy').textContent=`${T.x.toFixed(1)}, ${T.y.toFixed(1)}`; $('#v-mode').textContent=(MODES[T.mode]||'—')+(T.reflex?` · ${MODES[T.reflex]} (контакт)`:'')+(T.stealth&&!T.reflex?' · скрытность':T.stealth?' · скрытность не действует':''); }
  else { $('#tlm-age').textContent=u&&!u.alive?'тело мертво':'нет данных'; $('#pulse-val').textContent='—'; }
  { const el=$('#v-snr'), bar=$('#b-snr'); if(u&&u.hbAt>-1e8){ const s=u.snr??0; el.textContent=u.carrier?`${s>0?'+':''}${s.toFixed(0)} дБ`:'нет'; el.style.color=!u.carrier?'#d9534f':s<5?'#e0a94a':'';
      bar.style.width=(u.carrier?Math.max(0,Math.min(100,(s+10)/50*100)):0)+'%'; bar.className=!u.carrier?'lost':s<5?'weak':''; } else { el.textContent='—'; bar.style.width='0'; } }
  { const el=$('#v-items'); const items=u&&u.items||[]; const n40=items.filter(i=>i===40).length; const html=[n40?`пищевой брикет${n40>1?' ×'+n40:''} <button class="mini" data-eat="40">съесть ●</button> <button class="mini" data-drop="40">сбросить ●</button>`:'', items.includes(41)?'резак <button class="mini" data-drop="41">сбросить ●</button>':''].filter(Boolean).join(', ')||'—'; if(el.innerHTML!==html) el.innerHTML=html; }
  { const tg=T(), cont=tg&&contents.get(tg.id); const p=u&&pos(active); const near=cont&&p&&Math.hypot(p.x-tg.x,p.y-tg.y)<=4; const box=$('#xfer'); box.hidden=!near;
    if(near){ const ts=$('#take-item'), ps=$('#put-item'); const carry=[...(u.camera?[42]:[]),...(u.items||[])];
      const fill=(sel,arr)=>{ const cur=sel.value; const html=[...new Set(arr)].map(i=>`<option value="${i}">${ITEMS[i]}</option>`).join(''); if(sel.dataset.h!==html){ sel.innerHTML=html; sel.dataset.h=html; if([...sel.options].some(o=>o.value===cur)) sel.value=cur; } sel.disabled=!arr.length; };
      fill(ts,cont); fill(ps,carry); $('#btn-take').disabled=!cont.length; $('#btn-put').disabled=!carry.length; } }
  { const iv=Math.max(1,+$('#sub-tlm').value||1); const tAge=u&&u.tlm?tNow-u.tlmAt:Infinity; $('#blk-tlm .bb').classList.toggle('stale',tAge>3*iv);
    $('#sonar-body').classList.toggle('stale',!u||tNow-u.sonarAt>120); $('#blk-desc .bb').classList.toggle('stale',!u||tNow-u.descAt>120); $('#img-body').classList.toggle('stale',!u||tNow-u.img.at>300); }
  $('#sonar-age').textContent=u&&u.sonarAt>-1e8?`снимок ${(tNow-u.sonarAt).toFixed(0)} с назад`:'нет данных';
  // расход по панелям
  const setBw=(id,k)=>{ const r=bwRate(k), el=$(id), lr=lastRx[k]; const fresh=lr&&tNow-lr.t<2; el.textContent=(fresh?`↓${lr.b} · `:'')+(r?r.toFixed(0)+' Б/с':'0 Б/с'); el.classList.toggle('hot',!!fresh); };
  setBw('#bw-tlm','TLM'); setBw('#bw-sonar','SONAR'); setBw('#bw-desc','DESC'); setBw('#bw-img','IMG'); setBw('#bw-hb','HB'); setBw('#bw-stimg','STIMG');
  { const lvl=+$('#img-level').value, iv=+$('#sub-img').value, full=[72,72+264,72+264+1040,72+264+1040+4160][lvl]; const keyD=[2+64*2+8, 2+64*5+8*6, 2+64*17+8*18, 2+64*65+8*66][lvl]; const cap=modem.cap/8; const est=$('#img-est'); if(iv){ const per=$('#img-delta').checked?`ключевой ${keyD} Б, дальше по движению`:`${full} Б`; const rate=($('#img-delta').checked?keyD:full)/iv; est.textContent=`подписка: ${per} · до ${rate.toFixed(0)} Б/с из ${cap.toFixed(0)}`; est.style.color=rate>cap*0.8?'#d9534f':''; } else est.textContent=`один кадр: ${full} Б ≈ ${cap?(full/cap).toFixed(1):'∞'} с`; }
  // связь
  const up=modem.up; const st=$('#link-state'); st.textContent=up?'СВЯЗЬ':'НЕТ СВЯЗИ'; st.className='badge '+(up?'up':'down');
  { const capB=modem.cap/8||1e-9; const qb=modem.qcmd+modem.qbg; const eta=qb/capB; $('#lamp').className='lamp'+(!up||eta>10?' full':qb>0?' busy':''); }   // нет связи — лампа красная, как и значок
  const last=modem.sec; const used=last?['TLM','HB','SONAR','DESC','IMG','EVT','EXAM','ACT','INFO','CONT'].reduce((a,k)=>a+(last[k]||0),0):0; $('#rate').textContent=`${used.toFixed(0)} / ${(modem.cap/8).toFixed(0)} Б/с`+(modem.orbit!==null?` · окно ${fmtT(modem.orbit)}`:'');
  if(modem.at>0){ if(lastUp!==null&&up!==lastUp) log(up?'дальняя линия: связь установлена':'дальняя линия: связь потеряна','sys'); lastUp=up; }
  // станция
  { const at=[...units.values()].filter(v=>v.alive&&v.atAirlock).sort((a,b)=>a.id-b.id); const el=$('#airlock'); let html=`<div class="small dim">склад: камер ${station.cam??'—'} · брикетов ${station.brik} · резаков ${station.cut}</div>`;
    if(!at.length) html+='<div class="small dim">у шлюза никого</div>';
    for(const v of at){ const n40=v.items.filter(i=>i===40).length, has41=v.items.includes(41);
      const give=[v.camera?`<button class="mini" data-tr="42,0,${v.id}">камера → склад ●</button>`:'', n40?`<button class="mini" data-tr="40,0,${v.id}">брикет${n40>1?' ×'+n40:''} → склад ●</button>`:'', has41?`<button class="mini" data-tr="41,0,${v.id}">резак → склад ●</button>`:''].filter(Boolean).join(' ');
      const take=[station.cam&&!v.camera?`<button class="mini" data-tr="42,1,${v.id}">← камера ●</button>`:'', station.brik?`<button class="mini" data-tr="40,1,${v.id}">← брикет ●</button>`:'', station.cut&&!has41?`<button class="mini" data-tr="41,1,${v.id}">← резак ●</button>`:''].filter(Boolean).join(' ');
      html+=`<div class="row small" style="margin:3px 0"><b>М${v.id}</b> <span class="dim">${[v.camera?'камера':'',v.sonar?'лидар':''].filter(Boolean).join(', ')||'без датчиков'}${n40||has41?' · '+[n40?'брикет'+(n40>1?' ×'+n40:''):'',has41?'резак':''].filter(Boolean).join(', '):''}</span> ${give} ${take}</div>`; }
    if(el.dataset.html!==html){ el.innerHTML=html; el.dataset.html=html; } }
  $('#st-bio').textContent=station.bio??'—'; $('#st-cam').textContent=station.cam??'—'; $('#st-grow').textContent=station.grow==null?'нет':`${Math.floor(station.grow/60)}:${String(station.grow%60).padStart(2,'0')}`;
  { const growing=station.grow!=null; $('#btn-grow').disabled=growing||station.bio===0; $('#g-cam').disabled=!station.cam; $('#g-cam-l').classList.toggle('dim',!station.cam); if(!station.cam) $('#g-cam').checked=false;
    $('#grow-state').textContent=growing?`идёт выращивание: готовность через ${Math.floor(station.grow/60)}:${String(station.grow%60).padStart(2,'0')}`:station.bio===0?'биоматериала нет':`готово к запуску · биоматериал ${station.bio??'—'} ед.`;
    $('#grow-prog').style.width=growing?((180-station.grow)/180*100)+'%':'0%'; }
  // таблицы турелей и ретрансляторов: разметка собирается заново, но в DOM попадает только при изменении — иначе пересборка на тике
  // между нажатием и отпусканием съедает клик по кнопке; обработчик — один на таблицу, кнопки данные несут в data-*
  { let html=''; for(const T of station.turrets){ const rq=station.turretReq[T.id]; const st=T.broken?'повреждена':!T.powered?'без питания, данных нет':T.on?(T.tracking?'ведёт цель':T.reloading?'перезарядка':'включена'):'выключена';
      html+=`<tr><td>${T.id}</td><td>${st}</td><td>${T.ammo==null?'—':T.ammo}</td><td><button class="mini tur ${rq?'req':''}" data-id="${T.id}" data-on="${T.on?0:1}" ${T.broken||!T.powered?'disabled':''}>${rq?(rq.on?'включить ●':'выключить ●'):T.on?'выключить':'включить'}</button></td></tr>`; }
    if(!station.turrets.length) html='<tr><td colspan="4" class="dim">нет данных — ждите пульс</td></tr>';
    const tt=$('#turrets tbody'); if(tt.dataset.html!==html){ tt.innerHTML=html; tt.dataset.html=html; } }
  { let html=''; for(const R of station.relays){ const rq=station.relayReq[R.id], g=station.relayGeo[R.id];
      html+=`<tr><td>${R.id}</td><td>${R.mobile?'переносной':'стационарный'}</td><td>${g?`${g.x}, ${g.y}`:'<span class="dim">запросите статус</span>'}</td><td>${R.on?'включён — узел':'выключен'}</td><td><button class="mini rel ${rq?'req':''}" data-id="${R.id}" data-on="${R.on?0:1}">${rq?(rq.on?'включить ●':'выключить ●'):R.on?'выключить':'включить'}</button></td></tr>`; }
    if(!station.relays.length) html=`<tr><td colspan="5" class="dim">в сети нет${station.freq?' · канал станции '+station.freq:''}</td></tr>`;
    const tt=$('#relays tbody'); if(tt.dataset.html!==html){ tt.innerHTML=html; tt.dataset.html=html; } }
  { let html=''; for(const v of [...units.values()].sort((a,b)=>a.id-b.id)) html+=`<tr><td>М${v.id}</td><td>${v.alive?'жив':'мёртв'}</td><td>${v.carrier?'есть':'<span style="color:#d9534f">нет</span>'}</td><td>${[v.camera?'камера':'',v.sonar?'лидар':''].filter(Boolean).join(', ')||'—'}</td><td>${v.charge==null?'—':v.charge.toFixed(0)+'%'}</td><td>${(v.items||[]).map(i=>ITEMS[i]).join(', ')||'—'}</td><td>${v.streaming?'да':''}</td></tr>`; const tb=$('#roster tbody'); if(tb.dataset.html!==html){ tb.innerHTML=html; tb.dataset.html=html; } }
  // вкладки
  const tab=$('.tabs button.on').dataset.tab;
  if(tab==='map') drawMap(); if(tab==='charts'){ const cu=$('#ch-unit'); if(cu.options.length!==units.size){ const cur=cu.value; cu.innerHTML=''; for(const v of units.values()){ const o=document.createElement('option'); o.value=v.id; o.textContent='М'+v.id; cu.appendChild(o); } cu.value=cur||active; } drawChartTlm(); }
  if(tab==='channel'){ drawChartCh(); const ct=$('#ch-table tbody'); ct.innerHTML=''; for(const k of ['TLM','HB','SONAR','DESC','IMG','EVT']) ct.insertAdjacentHTML('beforeend',`<tr><td><i class="k-${k}" style="display:inline-block;width:8px;height:8px;margin-right:6px"></i>${KIND_RU[k]}</td><td>${bwRate(k).toFixed(0)}</td><td>${totals[k]||0}</td></tr>`);
    const qb=$('#queue tbody'); qb.innerHTML='';
    for(const g of modem.queue){ const eta=g.eta; qb.insertAdjacentHTML('beforeend',`<tr><td>${KIND_RU[kindOf(g.kind)]}${/^IM/.test(g.kind)?' '+[8,16,32,64][+g.kind[3]]+'px'+(g.kind[2]==='D'?' Δ':''):''}</td><td>М${g.unit}</td><td>${g.total-g.n}/${g.total}</td><td>${g.bytes}</td><td>${isFinite(eta)?eta.toFixed(1)+' с':'∞ (нет несущей)'}</td><td><button class="mini" data-cancel="${g.id}">✕</button></td></tr>`); }
    qb.querySelectorAll('[data-cancel]').forEach(b=>b.onclick=()=>{ const g=modem.queue.find(x=>x.id===+b.dataset.cancel); if(g) cancelReq(g); }); }
  // отладка
  if(!$('#drawer').hidden&&modem.dbg){ const id=active, L=modem.dbg.link.units[id]||{dist:0,fspl:999,obst:0,snr:-99,local:0,ber:0.5,per:1}; $('#i-dist').textContent=L.dist.toFixed(0)+' м'; $('#i-fspl').textContent=L.fspl.toFixed(1)+' дБ'; $('#i-obst').textContent=L.obst.toFixed(1)+' дБ'; $('#i-snr').textContent=L.snr.toFixed(1)+' дБ'+(L.gain?' (+'+L.gain+')':''); $('#i-dist').textContent+=L.node?' · ретр. '+L.node:''; $('#i-local').textContent=(L.local/1000).toFixed(2)+' кбит/с'; $('#i-ber').textContent=L.ber.toExponential(1); $('#i-per').textContent=(L.per*100).toFixed(1)+'%'; $('#i-deep').textContent=(modem.cap/1000).toFixed(2)+' кбит/с = '+(modem.cap/8).toFixed(0)+' Б/с'; $('#i-cnt').textContent=`${modem.cnt.delivered}/${modem.cnt.dropped}/${modem.cnt.retrans}`;
    if((tNow*10|0)%10===0) transport.send({t:'peek',unit:active});
    $('#i-queue').textContent=`фон: ${modem.qbg} Б · команды: ${modem.qcmd} Б (${modem.ncmd} пкт) · повторы: ${modem.retry}`; drawTruth(); }
},100);

// ---------- сохранение: мир + знание консоли, хранилище браузера ----------
const SAVE_KEY='missioners.save'+(ROOM?':'+ROOM+':'+ST:'')+(!ROOM&&MAP!=='act1'?':map:'+MAP:''), SAVE_VERSION=11;   // в сети — своё знание на каждую комнату и платформу; одиночная игра — свой сеанс на каждую карту (снимок мира годен только для своей карты)   // поднимать при несовместимых изменениях формата мира или консоли
let pendingWorld=null, lastSaveAt=0, prevSessionGap=null;
function consoleSnapshot(){
  const us=[...units.values()].map(u=>({...u, hist:u.hist.slice(-600), img:undefined, sonarData:u.sonarData?[...u.sonarData]:null, sonarMask:u.sonarMask||null}));
  return { tNow, active, rxN, station, totals, stcam:{subs:stcam.subs}, log:logEntries.slice(-400), contents:[...contents.entries()], walls:[...wmap.entries()], hmap:[...hmap.entries()].map(([k,c])=>[k,+c.z.toFixed(2),c.n]), units:us, known:[...known.entries()].map(([k,v])=>[k,{...v,seenBy:[...v.seenBy]}]), journal:[...journal.entries()] };
}
function saveNow(worldData){ try{ localStorage.setItem(SAVE_KEY, JSON.stringify({v:SAVE_VERSION, savedAt:Date.now(), world:worldData, console:consoleSnapshot()})); lastSaveAt=Date.now(); $('#save-state').textContent='сохранено '+new Date().toLocaleTimeString('ru',{hour:'2-digit',minute:'2-digit'}); }catch(e){ $('#save-state').textContent='сохранение не удалось'; } }
function requestSave(){ if(transport.mp) saveNow(null); else transport.send({t:'save'}); }   // в сети мир хранит сервер, консоль — только своё знание
function restoreConsole(d){
  tNow=d.tNow; active=d.active||1; rxN=d.rxN||0; Object.assign(station,d.station); if(d.stcam) Object.assign(stcam.subs,d.stcam.subs); Object.assign(totals,d.totals||{}); units.clear();
  for(const su of d.units){ const u=U(su.id); Object.assign(u,su,{img:u.img, sonarData:su.sonarData?new Uint8Array(su.sonarData):null, sonarMask:su.sonarMask||null}); }
  known.clear(); for(const [k,v] of d.known) known.set(k,{...v,seenBy:new Set(v.seenBy)});
  journal.clear(); for(const [k,v] of d.journal) journal.set(k,v); contents.clear(); for(const [k,v] of d.contents||[]) contents.set(k,v); hmap.clear(); for(const [k,z,n] of d.hmap||[]) hmap.set(k,{z,n}); wmap.clear(); hwall.clear();
  if(d.walls) for(const [k,n] of d.walls){ wmap.set(k,n); const [i,j]=k.split(',').map(Number); hwall.add(Math.floor((i+0.5)*WCELL/HCELL)+','+Math.floor((j+0.5)*WCELL/HCELL)); }
  else for(const sn of (d.sonar||[])) if(sn.b&&sn.b.length===64) snapWalls(sn);   // старое сохранение: растр из снимков
  hsmDirty=true;
  $('#log').innerHTML=''; logEntries.length=0; for(const e of d.log||[]) log(e.txt,e.cls,e.t); log('— сеанс восстановлен —','sys');
}
function readSave(){ try{ const raw=localStorage.getItem(SAVE_KEY); return raw?JSON.parse(raw):null; }catch(e){ return null; } }
function applySave(s){ const gap=Math.max(0,(Date.now()-s.savedAt)/1000); prevSessionGap=gap;
  if(!transport.mp) transport.send({t:'load',data:s.world,elapsed:0}); restoreConsole(s.console); resumed=true; }   // игровое время стоит, пока консоль закрыта
setInterval(()=>{ if(LAB||!$('#boot').classList.contains('off')) return; requestSave(); },10000);
function downloadText(text,name){ const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([text],{type:'application/x-ndjson'})); a.download=name; a.click(); }
function exportSave(){ const raw=localStorage.getItem(SAVE_KEY); if(!raw) return false; const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([raw],{type:'application/json'})); a.download='ark-041-session.json'; a.click(); return true; }
function importSave(){ return new Promise(res=>{ const inp=$('#import-file'); inp.value=''; let done=false; const finish=v=>{ if(done) return; done=true; window.removeEventListener('focus',onFocus); res(v); };
  inp.onchange=e=>{ const f=e.target.files[0]; if(!f) return finish(null); f.text().then(txt=>{ const s=JSON.parse(txt); localStorage.setItem(SAVE_KEY,txt); finish(s); }).catch(()=>finish(null)); };
  const onFocus=()=>setTimeout(()=>{ if(!inp.files.length) finish(null); },800);   // диалог закрыт без файла — отмена
  setTimeout(()=>window.addEventListener('focus',onFocus),300); inp.click(); }); }
let resumed=false;
function fmtGap(s){ if(s<90) return `${s.toFixed(0)}s`; if(s<5400) return `${(s/60).toFixed(0)}m`; if(s<172800) return `${(s/3600).toFixed(1)}h`; return `${(s/86400).toFixed(1)}d`; }

// ---------- заставка: ведётся настоящими пакетами ----------
const boot={onInfo:null,onHb:null,onTlm:null,onWelcome:null};
(async()=>{
  const el=$('#boot-text'); const sl=ms=>new Promise(r=>setTimeout(r,ms));
  const type=async s=>{ for(const ch of s){ el.textContent+=ch; await sl(12); } };
  const line=(s)=>{ el.textContent+=s+'\n'; };
  // вращающийся индикатор ожидания: -\|/ на конце последней строки, пока обещание не разрешится
  const spin=async p=>{ const f=['-','\\','|','/']; let i=0; el.textContent+=' '; const t=setInterval(()=>{ el.textContent=el.textContent.slice(0,-1)+f[i++%4]; },120); try{ return await p; } finally{ clearInterval(t); el.textContent=el.textContent.slice(0,-1)+'\n'; } };
  selectUnit(); drawSonar(null);
  el.textContent='$ '; await sl(200); await type('ares-tk --key ~/old/dse.key ping '+(ROOM?'ARK-04'+(1+ST):'ARK-041')); el.textContent+='\n';
  line('resolve ARK-041 via DSE routing table… corp endpoint unreachable, using cached route');
  // сеанс: меню в терминале, одна клавиша
  // Enter = первый вариант в списке
  const key=async(keys)=>{ const cur=document.createElement('span'); cur.className='cur'; el.appendChild(cur); const k=await new Promise(res=>{ const h=e=>{ let k=e.key.toLowerCase(); if(k==='enter') k=keys[0]; if(keys.includes(k)){ document.removeEventListener('keydown',h); res(k); } }; document.addEventListener('keydown',h); }); cur.remove(); el.textContent+=k+'\n'; return k; };
  let s=LAB?null:readSave();
  if(LAB){ line('lab mode: session store bypassed, link unlimited'); $('#save-state').textContent='лаборатория: не сохраняется'; }
  else if(transport.mp){   // сеть: мир живёт на сервере, местное знание подхватывается само, пропущенные пакеты досылаются
    if(s){ line(`local session store: found, last link ${fmtGap((Date.now()-s.savedAt)/1000)} ago`); if((s.v||0)!==SAVE_VERSION) line(`  warning: session build v${s.v||0}, current v${SAVE_VERSION}`); applySave(s); }
    else line('local session store: empty');
    el.textContent+=`join room ${ROOM}, platform ${ST}`; hello(); joined=true; const w=await spin(new Promise(res=>{ boot.onWelcome=m=>{ boot.onWelcome=null; res(m); }; }));
    station.name=w.name; line(`joined ${w.name}: operators=${w.operators}  replay=${w.replay} pkts  world clock ${fmtT(w.at)}`); }
  else for(;;){
    if(s){ const gap=(Date.now()-s.savedAt)/1000; line(`local session store: found, last link ${fmtGap(gap)} ago`); if((s.v||0)!==SAVE_VERSION) line(`  warning: session build v${s.v||0}, current v${SAVE_VERSION} — resume may misbehave, [n] recommended`); el.textContent+='[r/enter] resume  [n] new  [i] import file  [e] export file  ';
      const k=await key(['r','n','i','e']);
      if(k==='r'){ applySave(s); line('session restored, world clock paused since'); break; }
      if(k==='e'){ exportSave(); line('exported'); continue; }
      if(k==='i'){ const ns=await importSave(); if(ns){ s=ns; line('imported'); } else line('import cancelled'); continue; }
      if(k==='n'){ el.textContent+='overwrite stored session? [y/n] '; const y=await key(['y','n']); if(y==='y'){ localStorage.removeItem(SAVE_KEY); transport.send({t:'log',op:'new'}); line('new session'); break; } continue; }
    } else { line('local session store: empty'); el.textContent+='[n/enter] new  [i] import file  ';
      const k=await key(['n','i']); if(k==='n'){ transport.send({t:'log',op:'new'}); line('new session'); break; } const ns=await importSave(); if(ns){ s=ns; line('imported'); } else line('import cancelled'); }
  }
  const t0=Date.now(), info0=totals.INFO||0; el.textContent+='status request, 3 B'; transport.send({t:'up',bytes:[11,0,0]});
  const info=await spin(new Promise(res=>{ boot.onInfo=(text,pkt)=>{ boot.onInfo=null; res({text,pkt}); }; }));
  line(`ACK ${station.name}  rtt=${((Date.now()-t0)/1000).toFixed(2)}s  ch=FTL/DSE-2  rate=${modem.cap.toFixed(0)}bps  rx=${(totals.INFO||0)-info0}B`);
  for(const l of info.text.split('\n')) line('  '+l);
  el.textContent+='heartbeat'; const hb=await spin(Promise.race([new Promise(res=>{ boot.onHb=b=>{ boot.onHb=null; res(b); }; }), sl(8000).then(()=>null)])); boot.onHb=null; el.textContent=el.textContent.replace(/heartbeat\n$/,'');
  if(!hb) line('heartbeat: none within 8s'); else line(`heartbeat ${hb.length}B  units=${hb[5]}` + (hb[5]?`  M${hb[6]}[${[hb[7]&1?'alive':'dead',hb[7]&2?'carrier '+(hb[10]-30)+'dB':'nocarrier',hb[7]&4?'cam':'',hb[7]&8?'sonar':''].filter(Boolean).join(' ')}]`:''));
  const anyAlive=[...units.values()].some(u=>u.alive);
  if(anyAlive) el.textContent+='telemetry'; const tlm=anyAlive?await spin(Promise.race([new Promise(res=>{ boot.onTlm=p=>{ boot.onTlm=null; res(p); }; }), sl(6000).then(()=>null)])):null; boot.onTlm=null; if(anyAlive) el.textContent=el.textContent.replace(/telemetry\n$/,'');
  if(tlm){ const T=units.get(tlm.unit).tlm; line(`telemetry M${tlm.unit} ${tlm.size}B  pulse=${T.pulse} charge=${T.charge.toFixed(0)}% pos=${T.x},${T.y}`); } else line(anyAlive?'telemetry: none within 6s':'telemetry: no live units');
  line(''); line('$ console'); await sl(250); $('#boot').classList.add('off');
  log('консоль открыта. ключ принят.','sys'); if(!resumed) log('первый шаг: описание окружения — «снять ●» в панели «Описание» справа.','sys'); selectUnit(); renderUnits();
})();

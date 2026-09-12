// КОНСОЛЬ. Видит только пакеты, доставленные каналом (link.onDeliver).
// Всё, что нарисовано на экране, восстановлено из этих байтов. Отладочная шторка читает канал и мир напрямую.
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const link=new Link(); const world=new Worker('world.js?v='+window.__v);
let speed=1, tNow=0, active=1, dbg=null;
const units=new Map();          // id → знание о миссионере
const station={bio:null,cam:null,grow:null,brik:0,cut:0,at:-1e9};
const known=new Map();          // ключ → объект с координатами (только из полученных данных)
const journal=new Map();        // id объекта → [{t, unit, text}] — что узнали, изучив или взаимодействуя
function jadd(id,unit,text){ (journal.get(id)||journal.set(id,[]).get(id)).push({t:tNow,unit,text}); if($('.tabs button.on').dataset.tab==='journal') renderJournal(); }
function jlast(id){ const j=journal.get(id); return j?j[j.length-1]:null; }
function oname(id){ const o=[...known.values()].find(k=>k.id===id); return o?o.name:(id>=100&&id<200?'свёрток':'объект '+id); }
// объект, который миссионер изучил или трогал, — знакомый ему: подсветить на карте, дать имя, если его ещё нет
function markSeen(id,unit){ let o=[...known.values()].find(k=>k.id===id); const p=pos(unit);
  if(!o){ o={id,cls:0,x:p.x,y:p.y,at:tNow,unit,seenBy:new Set(),name:oname(id)}; known.set(id>=200&&id<250?'unit'+id:'o'+id,o); }
  o.seenBy.add(unit); o.at=tNow; }
const KIND_RU={TLM:'телеметрия',HB:'пульс станции',SONAR:'сонар',DESC:'описание',IMG:'изображение',EVT:'событие',EXAM:'осмотр',ACT:'действие',INFO:'статус станции',CONT:'содержимое'};
const KIND_COL={TLM:'#5cb85c',HB:'#2f6f3a',SONAR:'#4a8fe0',DESC:'#9fb59f',IMG:'#e0a94a',EVT:'#8a7fd0',EXAM:'#8a7fd0',ACT:'#8a7fd0',INFO:'#2f6f3a',CONT:'#8a7fd0',drop:'#d9534f'};
const UCOL=['#7fe07f','#4a8fe0','#e0a94a','#d97fd9','#5cd0d0','#d9534f'];
const bw={};                    // kind → массив {t,bytes} за 5 с
const lastRx={};                // kind → последний принятый пакет
const contents=new Map();       // id контейнера → предметы (по последнему CONT)
const sonarSnaps=[];             // снимки сонара для карты: {x,y,t,b}
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

// ---------- мир → канал → консоль ----------
world.onmessage=e=>{ const m=e.data; if(m.t==='msg') link.enqueue(m); else if(m.t==='phys'){ link.setPhys(m); dbg=m.dbg; } else if(m.t==='peekImg') drawGray($('#peek'),m.img,64); else if(m.t==='state') saveNow(m.data); };
link.onUplink=bytes=>world.postMessage({t:'cmd',bytes});
link.onFrame=(msg,ok)=>world.postMessage({t:'imgAck',unit:msg.unit,level:+msg.kind[3],ok});
// Сборка многопакетных текстовых сообщений: декодируем, когда пришли все пакеты
const asm={};
function assemble(pkt){ if(pkt.total===1) return pkt.bytes; const a=asm[pkt.msgId]=asm[pkt.msgId]||{parts:{},total:pkt.total,at:tNow}; a.parts[pkt.seq]=pkt.bytes; a.at=tNow;
  if(Object.keys(a.parts).length<a.total) return null; const out=[]; for(let i=0;i<a.total;i++) out.push(...a.parts[i]); delete asm[pkt.msgId]; return new Uint8Array(out); }
link.onDeliver=pkt=>{
  const k=link.kindOf(pkt.kind); (bw[k]=bw[k]||[]).push({t:tNow,b:pkt.size}); totals[k]=(totals[k]||0)+pkt.size; lastRx[k]={t:tNow,b:pkt.size,msg:pkt.msgId}; if(k==='IMG'&&pkt.unit===0){ (bw.STIMG=bw.STIMG||[]).push({t:tNow,b:pkt.size}); lastRx.STIMG={t:tNow,b:pkt.size}; }
  if(pkt.kind==='DESC'||pkt.kind==='EXAM'||pkt.kind==='ACT'||pkt.kind==='INFO'||pkt.kind==='SONAR'){ const full=assemble(pkt); if(!full) return; pkt={...pkt,bytes:full}; }
  switch(pkt.kind){
    case 'TLM': decodeTlm(pkt); break;
    case 'HB': decodeHb(pkt.bytes); break;
    case 'DESC': decodeDesc(pkt); break;
    case 'SONAR': { const u=U(pkt.unit); const b=pkt.bytes; const p={x:(((b[0]<<8)|b[1])-32768)/10,y:(((b[2]<<8)|b[3])-32768)/10}; const mask=[...b.slice(4,12)], rays=b.slice(12); u.sonarData=rays; u.sonarMask=mask; u.sonarAt=tNow; sonarSnaps.push({x:p.x,y:p.y,t:tNow,b:[...rays],m:mask}); if(sonarSnaps.length>300) sonarSnaps.shift(); if(pkt.unit===active) drawSonar(rays,mask); break; }
    case 'IMG0': case 'IMG1': case 'IMG2': case 'IMG3': decodeImg(pkt); break;
    case 'IMD0': case 'IMD1': case 'IMD2': case 'IMD3': decodeImd(pkt); break;
    case 'EVT': decodeEvt(pkt); break;
    case 'INFO': { const text=decText(pkt.bytes); const tl=text.split('\n').find(l=>l.startsWith('задача:')); if(tl) $('#task').textContent=tl; if(boot.onInfo) boot.onInfo(text,pkt); else log('станция: '+text.replace(/\n/g,' · '),'sys'); break; }
    case 'CONT': { const b=pkt.bytes; contents.set(b[0],[...b.slice(2,2+b[1])]); renderDesc(); break; }
    case 'EXAM': decodeExam(pkt); break;
    case 'ACT': decodeAct(pkt); break;
  }
};
link.onDrop=pkt=>{ if(pkt.kind==='TLM'||pkt.kind==='HB') return; if(pkt.seq===undefined){ const u=holderOf(pkt.unit); u.img.skipped++; u.img.state=`кадр пропущен (${u.img.skipped}): ${pkt.reason.split(': ')[1]}`; if(pkt.unit===active||pkt.unit===0) showImg(u); return; } log(`М${pkt.unit} ${pkt.kind} #${pkt.msgId}/${pkt.seq}: ${pkt.reason}`,'err'); };

// ---------- декодеры ----------
function decodeTlm(pkt){ const b=pkt.bytes, u=U(pkt.unit); if(boot.onTlm) boot.onTlm(pkt);
  u.tlm={pulse:b[0],electro:b[1],glucose:b[2],toxin:b[3],skin:b[4],bone:b[5],psyche:b[6],danger:b[7],cons:b[8]/50,charge:b[9]/2.55,gen:b[10]/50,x:(((b[11]<<8)|b[12])-32768)/10,y:(((b[13]<<8)|b[14])-32768)/10,mode:b[15]};
  u.tlmAt=tNow; u.hist.push({t:tNow,...u.tlm}); if(u.hist.length>3000) u.hist.shift();
  const last=u.track[u.track.length-1]; if(!last||Math.hypot(last.x-u.tlm.x,last.y-u.tlm.y)>2){ u.track.push({x:u.tlm.x,y:u.tlm.y,t:tNow}); if(u.track.length>600) u.track.shift(); }
}
function decodeHb(b){ if(boot.onHb){ boot.onHb(b); } station.bio=b[0]; station.cam=b[1]; station.grow=b[2]===255?null:b[2]; station.brik=b[3]; station.cut=b[4]; station.at=tNow; const n=b[5];
  for(let i=0;i<n;i++){ const id=b[6+i*5], f=b[7+i*5], ch=b[8+i*5]/2.55, it=b[9+i*5], snr=b[10+i*5]-30; const u=U(id); const wasAlive=u.alive, wasCarrier=u.carrier; u.items=[...Array(it&3).fill(40), ...(it&4?[41]:[])];
    u.alive=!!(f&1); u.carrier=!!(f&2); u.camera=!!(f&4); u.sonar=!!(f&8); u.streaming=!!(f&16); u.atAirlock=!!(f&32); u.charge=ch; u.snr=snr; u.hbAt=tNow;
    if(wasAlive&&!u.alive) log(`станция: М${id} — жизненные функции прекращены`,'err');
    if(wasCarrier&&!u.carrier) log(`станция: несущая М${id} не принимается`,'err');
    if(!wasCarrier&&u.carrier) log(`станция: несущая М${id} восстановлена`,'sys'); }
  renderUnits(); const au=units.get(active); if(au){ $('#sonar-body').hidden=!au.sonar; $('#sonar-none').hidden=au.sonar; $('#img-body').hidden=!au.camera; $('#img-none').hidden=au.camera; } }
// Описание: [id, класс, пеленг/2, дальность, длина, текст]*. Класс: 0 объект, 1 ориентир, 2 неопознанное, 3 тело, 4 миссионер.
function decodeDesc(pkt){ const b=pkt.bytes, u=U(pkt.unit); const p={x:(((b[0]<<8)|b[1])-32768)/10,y:(((b[2]<<8)|b[3])-32768)/10}; const items=[];   // позиция съёмки — из пакета, дециметры
  for(let i=4;i+4<b.length;){ const len=b[i+4]; const it={id:b[i],cls:b[i+1],bearing:b[i+2]*2,range:b[i+3],name:decText(b.slice(i+5,i+5+len))}; i+=5+len;
    it.x=Math.round(p.x+Math.cos(it.bearing*Math.PI/180)*it.range); it.y=Math.round(p.y+Math.sin(it.bearing*Math.PI/180)*it.range); items.push(it);
    const key=it.cls===2?'creature':'o'+it.id; const prev=known.get(key); const seen=prev?prev.seenBy:new Set(); seen.add(pkt.unit);
    known.set(key,{id:it.id,cls:it.cls,x:it.x,y:it.y,at:tNow,unit:pkt.unit,seenBy:seen,name:it.name}); }
  u.desc=items; u.descAt=tNow; u.descPts.push({x:p.x,y:p.y,t:tNow}); if(pkt.unit===active) renderDesc();
  log(`М${pkt.unit} описание: ${items.length} — ${items.map(i=>i.name).join(', ')}`,'desc'); }
// Осмотр и действие: [id, код, длина, текст] — текст составила станция, консоль его только печатает.
function decodeExam(pkt){ const b=pkt.bytes, id=b[0], len=(b[2]<<8)|b[3], text=decText(b.slice(4,4+len)); markSeen(id,pkt.unit); jadd(id,pkt.unit,text); log(`М${pkt.unit} · ${oname(id)}: ${text}`,'desc'); renderDesc(); }
function decodeAct(pkt){ const b=pkt.bytes, id=b[0], code=b[1], len=(b[2]<<8)|b[3], text=decText(b.slice(4,4+len)); if(code===0) markSeen(id,pkt.unit); jadd(id,pkt.unit,text); log(`М${pkt.unit} · ${oname(id)}: ${text}`,code===0?'evt':'err'); renderDesc(); }
function decodeEvt(pkt){ const b=pkt.bytes, code=b[0], arg=b[1], un=pkt.unit?`М${pkt.unit} `:''; const txt=EVENTS[code]||('событие '+code);
  if(code===7) log(`${un}${txt}: ${MODES[arg]}`,'evt'); else if(code===13) log(`${un}${txt} М${arg}`,'evt'); else if(code===16) log(`${un}${txt} (id ${arg}); требуется новое описание`,'err'); else if(code===19||code===20) log(`${un}${txt}: ${ITEMS[arg]||arg}`,'evt'); else log(`${un}${txt}`,'evt');
  if(code===5){ const u=U(pkt.unit); u.alive=false; renderUnits(); }
  if(code===6){ U(pkt.unit); renderUnits(); }
  if(code===3) log('усиление тракта +6 дБ на всех линиях','sys');
  if(code===17){ $('#task').textContent='задача: ПС-7 закрыта'; const last=[...journal.values()].flat().filter(e=>/прочитал запись/.test(e.text)).pop(); $('#fin-text').textContent=(last?last.text.replace(/^прочитал запись\. /,'')+'\n\n':'')+`Станция остановила протокол ПС-7. Биоматериала осталось: ${station.bio ?? '—'} ед. Миссионеров в поле: ${[...units.values()].filter(u=>u.alive).length}.\n\nЭто условная развязка прототипа. Сеанс можно продолжать.`; $('#finale').hidden=false; } }
function showImg(u){ if(u.id===0){ drawGray($('#st-img'),u.img.buf,64); $('#st-img-state').textContent=u.img.state; $('#st-img-prog').style.width=(u.img.prog*100)+'%'; return; } drawGray($('#img'),u.img.buf,64); $('#img-unit').textContent='М'+u.id; $('#img-state').textContent=u.img.state; $('#img-prog').style.width=(u.img.prog*100)+'%'; }
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
// сонар: 64 дальности по кругу. Соседние отсчёты с близкой дальностью — одна поверхность (линия), одиночные — точки
function sonarSegments(b,m){ const pts=[]; for(let i=0;i<64;i++){ const r=b[i]/255*100; const solid=m?!!(m[i>>3]&(1<<(i&7))):true; pts.push(r>=99.5?null:{a:i/64*Math.PI*2,r,solid}); }
  // соединяем только сплошные отсчёты; допуск по дальности растёт с дальностью (лучи расходятся на 0,1·r; поверхность под углом до ~70° даёт Δr ≈ 0,27·r)
  const joined=i=>{ const p=pts[i], q=pts[(i+1)%64]; return p&&q&&p.solid&&q.solid&&Math.abs(p.r-q.r)<0.5+0.3*Math.min(p.r,q.r); };
  // цепочка: сколько подряд соединённых отсчётов, начиная с i
  const chainLen=i=>{ let n=1; while(n<64&&joined((i+n-1)%64)) n++; return n; };
  return {pts, joined, chainLen}; }
function drawSonar(b,m){ const cv=$('#sonar'), ctx=cv.getContext('2d'), c=100; ctx.fillStyle='#000'; ctx.fillRect(0,0,200,200);
  // масштаб — по самому дальнему отражению: ближняя геометрия заполняет круг
  // масштаб: по 75-му процентилю дальностей (ближняя геометрия заполняет круг), колёсико — вручную
  const {pts,joined}=b?sonarSegments(b,m):{pts:[],joined:()=>false}; const rs=pts.filter(Boolean).map(p=>p.r).sort((a,b)=>a-b); const q=rs.length?rs[Math.floor(rs.length*0.75)]:100;
  const R=map.sonarR||Math.max(12,Math.min(100,q*1.25)); map.sonarAuto=R; const k=100/R;
  const step=[2,5,10,20,25,50].find(s=>s*k>=22)||50; ctx.strokeStyle='#1e3a1e'; ctx.fillStyle='#555'; ctx.font='9px monospace'; for(let r=step;r<=R;r+=step){ ctx.beginPath(); ctx.arc(c,c,r*k,0,7); ctx.stroke(); ctx.fillText(r,c+r*k+2,c-2); }
  if(!b) return; const X=p=>c+Math.cos(p.a)*p.r*k, Y=p=>c+Math.sin(p.a)*p.r*k;
  // свободное пространство
  ctx.fillStyle='rgba(127,224,127,0.07)'; ctx.beginPath(); for(let i=0;i<64;i++){ const p=pts[i]||{a:i/64*Math.PI*2,r:R}; i?ctx.lineTo(X(p),Y(p)):ctx.moveTo(X(p),Y(p)); } ctx.closePath(); ctx.fill();
  ctx.strokeStyle='#7fe07f'; ctx.lineWidth=1.5; for(let i=0;i<64;i++){ if(!joined(i)) continue; const p=pts[i], q=pts[(i+1)%64]; if(p.r>R||q.r>R) continue; ctx.beginPath(); ctx.moveTo(X(p),Y(p)); ctx.lineTo(X(q),Y(q)); ctx.stroke(); } ctx.lineWidth=1;
  ctx.fillStyle='#7fe07f'; for(let i=0;i<64;i++){ const p=pts[i]; if(!p) continue; if(p.r>R){ ctx.fillStyle='#2f5f2f'; ctx.fillRect(c+Math.cos(p.a)*99-1,c+Math.sin(p.a)*99-1,2,2); ctx.fillStyle='#7fe07f'; continue; } const lone=!p.solid||(!joined(i)&&!joined((i+63)%64)); ctx.fillStyle=p.solid?'#7fe07f':'#e0a94a'; ctx.fillRect(X(p)-(lone?2:1),Y(p)-(lone?2:1),lone?4:2,lone?4:2); }
  ctx.fillStyle='#fff'; ctx.fillRect(c-1,c-1,2,2); ctx.fillStyle='#555'; ctx.fillText(`до ${R.toFixed(0)} м${map.sonarR?' ·':''}`,4,196); }
let ecgPhase=0, ecgX=0;
function drawEcg(dt){ const cv=$('#ecg'), ctx=cv.getContext('2d'), u=units.get(active); const W=150;
  if(!u||!u.tlm||tNow-u.tlmAt>3*Math.max(1,+$('#sub-tlm').value||1)){ ctx.fillStyle='#000'; ctx.fillRect(0,0,W,44); ctx.fillStyle='#333'; ctx.fillRect(0,22,W,1); return; }
  const bpm=u.tlm.pulse; ecgPhase+=dt*bpm/60; const ph=ecgPhase%1; let v=0; if(ph<0.08) v=Math.sin(ph/0.08*Math.PI)*0.15; else if(ph<0.12) v=-0.2; else if(ph<0.16) v=1; else if(ph<0.2) v=-0.3; else if(ph>0.35&&ph<0.5) v=Math.sin((ph-0.35)/0.15*Math.PI)*0.25;
  const y=28-v*20, x=ecgX; ecgX=(ecgX+dt*60)%W; ctx.fillStyle='rgba(0,0,0,0.06)'; ctx.fillRect(0,0,W,44); ctx.fillStyle='#000'; ctx.fillRect(x,0,8,44); ctx.fillStyle=bpm>150?'#ff5c5c':'#7fe07f'; ctx.fillRect(x,y,2,2); }

function renderUnits(){ const el=$('#units'); el.innerHTML=''; [...units.values()].sort((a,b)=>a.id-b.id).forEach(u=>{ const b=document.createElement('button'); b.className=(u.id===active?'on ':'')+(u.alive?'':'dead'); b.textContent=`${u.alive?(u.carrier?'●':'◌'):'○'} М${u.id}`; b.onclick=()=>{ active=u.id; selectUnit(); }; b.ondblclick=()=>{ map.focus=pos(u.id); if(map.zoom<3) map.zoom=3; $$('.tabs button').forEach(x=>x.classList.toggle('on',x.dataset.tab==='map')); $$('.tab').forEach(t=>t.classList.toggle('on',t.id==='tab-map')); drawMap(); }; el.appendChild(b); }); }
function selectUnit(){ const u=units.get(active); renderUnits(); renderDesc(); drawSonar(u.sonarData,u.sonarMask); showImg(u); updateTarget();
  $('#autonomy').value=u.autonomy; $('#sub-tlm').value=u.subs.tlm; $('#tx-pow').value=u.subs.tx||0; $('#sub-sonar').value=u.subs.sonar; $('#sub-desc').value=u.subs.desc; $('#sub-img').value=u.subs.img; $('#img-level').value=u.subs.level; $('#img-delta').checked=u.subs.delta;
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
function updateTarget(){ const tg=T(); $('#target-label').textContent=tg?`выбрано: ${tg.name} (${tg.x}, ${tg.y})`:'выбор: нет'; }
function setTarget(tg){ units.get(active).sel=tg; renderDesc(); updateTarget(); }   // выбор — локальный, ничего не уходит
function setGoal(name,p){ const u=units.get(active); u.goalName=name; if(p) u.goalPos={x:p.x,y:p.y}; else if(T()) u.goalPos={x:T().x,y:T().y}; $('#img-look').textContent=`смотрит: ${name?'на «'+name+'»':'вперёд'}`; }

function fitCanvas(cv, crt){
  // crt: рисуем в половинном разрешении, по горизонтали чуть уже — растягивается вширь — при растяжении получается ЭЛТ-зерно и крупный «плохой» шрифт
  const w=Math.max(50,(cv.clientWidth/(crt?2.15:1))|0), h=Math.max(50,(cv.clientHeight/(crt?2:1))|0); if(cv.width!==w||cv.height!==h){ cv.width=w; cv.height=h; } }
function drawMap(){ const cv=$('#map'); fitCanvas(cv,true); const ctx=cv.getContext('2d'), W=cv.width, H=cv.height; ctx.fillStyle='#000'; ctx.fillRect(0,0,W,H);
  const pts=[{x:0,y:0}]; for(const o of known.values()) pts.push(o); for(const u of units.values()){ pts.push(...u.track); }
  let minx=Math.min(...pts.map(p=>p.x))-30, maxx=Math.max(...pts.map(p=>p.x))+30, miny=Math.min(...pts.map(p=>p.y))-30, maxy=Math.max(...pts.map(p=>p.y))+30;
  const sc=Math.min(W/(maxx-minx),H/(maxy-miny))*map.zoom;
  if(map.focus){ map.panX=((minx+maxx)/2-map.focus.x)*sc; map.panY=((miny+maxy)/2-map.focus.y)*sc; map.focus=null; }   // перелёт к точке
  const cx=(minx+maxx)/2-map.panX/sc, cy=(miny+maxy)/2-map.panY/sc; const sx=x=>W/2+(x-cx)*sc, sy=y=>H/2+(y-cy)*sc; map.tf={sx,sy,sc,cx,cy,W,H};
  // сетка: шаг подбирается так, чтобы клетка была 40–120 px; подписи координат по краям
  const step=[1,2,5,10,20,50,100,200,500,1000].find(s=>s*sc>=40)||1000; const vx0=cx-W/2/sc, vx1=cx+W/2/sc, vy0=cy-H/2/sc, vy1=cy+H/2/sc;
  ctx.strokeStyle='#1a1e25'; ctx.fillStyle='#444'; ctx.font='9px monospace';
  for(let gx=Math.floor(vx0/step)*step;gx<=vx1;gx+=step){ ctx.beginPath(); ctx.moveTo(sx(gx),0); ctx.lineTo(sx(gx),H); ctx.stroke(); ctx.fillText(gx,sx(gx)+2,H-3); }
  for(let gy=Math.floor(vy0/step)*step;gy<=vy1;gy+=step){ ctx.beginPath(); ctx.moveTo(0,sy(gy)); ctx.lineTo(W,sy(gy)); ctx.stroke(); ctx.fillText(gy,2,sy(gy)-2); }
  // линейка масштаба
  ctx.fillStyle='#aaa'; ctx.fillRect(W-16-step*sc,12,step*sc,2); ctx.fillText(step+' м',W-16-step*sc,10);
  // покрытие: где снимались описания (радиус 100 м). Все прошлые — одна область одним тоном (без наслоения),
  // последний снимок каждого миссионера — ярче, за минуту гаснет до общего тона
  { const off=map.off||(map.off=document.createElement('canvas')); if(off.width!==W||off.height!==H){ off.width=W; off.height=H; } const o=off.getContext('2d'); o.clearRect(0,0,W,H); o.fillStyle='#9fb59f';
    for(const u of units.values()) for(const q of u.descPts){ o.beginPath(); o.arc(sx(q.x),sy(q.y),100*sc,0,7); o.fill(); }
    ctx.globalAlpha=0.07; ctx.drawImage(off,0,0); ctx.globalAlpha=1;
    for(const u of units.values()){ const q=u.descPts[u.descPts.length-1]; if(!q) continue; const age=tNow-q.t; const a=Math.max(0,0.12*(1-age/60)); if(a<=0) continue; ctx.fillStyle=`rgba(159,181,159,${a})`; ctx.beginPath(); ctx.arc(sx(q.x),sy(q.y),100*sc,0,7); ctx.fill(); } }
  // геометрия с сонара: поверхности линиями, одиночные отражения точками; старые снимки тусклее
  for(const s of sonarSnaps){ const age=tNow-s.t; const al=Math.max(0.15,0.7-age/3000); const {pts,joined,chainLen}=sonarSegments(s.b,s.m); const X=p=>sx(s.x+Math.cos(p.a)*p.r), Y=p=>sy(s.y+Math.sin(p.a)*p.r);
    // на карту — только поверхности (цепочки отсчётов); одиночные отражения (ящики, столбики) остаются в панели сонара
    // на карту — цепочки от 4 отсчётов (стены, корпуса); короткие (ящики, столбики) остаются в панели
    const inChain=new Array(64).fill(false); for(let i=0;i<64;i++){ if(joined((i+63)%64)) continue; const n=chainLen(i); if(n>=(s.m?2:4)) for(let k=0;k<n;k++) inChain[(i+k)%64]=true; }
    if(!inChain.some(Boolean) && joined(0)) inChain.fill(true);   // все 64 соединены — замкнутая стена вокруг
    ctx.strokeStyle=`rgba(92,208,208,${al})`; for(let i=0;i<64;i++){ const p=pts[i]; if(!p||!joined(i)||!inChain[i]) continue; const q=pts[(i+1)%64]; ctx.beginPath(); ctx.moveTo(X(p),Y(p)); ctx.lineTo(X(q),Y(q)); ctx.stroke(); } }
  ctx.strokeStyle='#555'; ctx.beginPath(); ctx.arc(sx(0),sy(0),14*sc,0,7); ctx.stroke(); ctx.fillStyle='#555'; ctx.font='10px monospace'; ctx.fillText('станция',sx(0)+16*sc,sy(0)-4);
  for(const u of units.values()){ const col=UCOL[(u.id-1)%UCOL.length]; ctx.strokeStyle=col; ctx.globalAlpha=0.5; ctx.beginPath(); u.track.forEach((p,i)=>i?ctx.lineTo(sx(p.x),sy(p.y)):ctx.moveTo(sx(p.x),sy(p.y))); ctx.stroke(); ctx.globalAlpha=1; }
  ctx.font='10px monospace';
  const tg=T(), au0=units.get(active), gp=au0&&au0.goalPos;
  for(const o of known.values()){ const age=tNow-o.at, mine=o.seenBy.has(active); ctx.globalAlpha=(mine?Math.max(0.4,1-age/600):0.22); const col=o.cls===2?'#ff5c5c':o.cls===3?'#888':o.cls===1?'#e0a94a':'#9fb59f'; const r=o.cls===1?3:2; if(mine){ ctx.fillStyle=col; ctx.fillRect(sx(o.x)-r,sy(o.y)-r,r*2,r*2); } else { ctx.strokeStyle=col; ctx.strokeRect(sx(o.x)-r,sy(o.y)-r,r*2,r*2); } if(mine&&(o.cls!==0||sc>1.2)) ctx.fillText(o.name,sx(o.x)+5,sy(o.y)+3); }
  { const au=units.get(active); if(au){ const p=pos(active); let ang=null; if(gp&&Math.hypot(gp.x-p.x,gp.y-p.y)>1.5) ang=Math.atan2(gp.y-p.y,gp.x-p.x); else if(au.track.length>1){ const a=au.track[au.track.length-2], b=au.track[au.track.length-1]; ang=Math.atan2(b.y-a.y,b.x-a.x); } else ang=0;
      const R=80*sc, f=52*Math.PI/180; ctx.fillStyle='rgba(224,169,74,0.10)'; ctx.beginPath(); ctx.moveTo(sx(p.x),sy(p.y)); ctx.arc(sx(p.x),sy(p.y),R,ang-f,ang+f); ctx.closePath(); ctx.fill(); } }
  ctx.globalAlpha=1; if(gp){ ctx.strokeStyle='#e0a94a'; ctx.beginPath(); ctx.arc(sx(gp.x),sy(gp.y),5,0,7); ctx.stroke(); } if(tg){ ctx.strokeStyle='#fff'; ctx.beginPath(); ctx.arc(sx(tg.x),sy(tg.y),7,0,7); ctx.stroke(); ctx.fillStyle='#fff'; ctx.fillText('выбрано',sx(tg.x)+9,sy(tg.y)-8); }
  ctx.globalAlpha=1;
  for(const u of units.values()){ const p=pos(u.id); const col=UCOL[(u.id-1)%UCOL.length]; ctx.fillStyle=u.alive?col:'#666'; ctx.beginPath(); ctx.arc(sx(p.x),sy(p.y),u.id===active?5:3.5,0,7); ctx.fill(); ctx.fillStyle=col; ctx.fillText(`М${u.id}${u.alive?'':' †'}${u.tlm?'':' ?'}`,sx(p.x)+7,sy(p.y)-6); if(u.tlm&&tNow-u.tlmAt>10){ ctx.fillStyle='#888'; ctx.fillText(`${(tNow-u.tlmAt).toFixed(0)} с назад`,sx(p.x)+7,sy(p.y)+6); } }
  $('#map-count').textContent=`объектов: ${known.size}`; $('#map-scale').textContent=`1 px = ${(1/sc).toFixed(2)} м · ×${map.zoom.toFixed(1)}`; }
const map={tf:null,zoom:1,panX:0,panY:0,drag:null};
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
  $('#map-tracks').onclick=()=>{ for(const u of units.values()){ const p=pos(u.id); u.track=[{x:p.x,y:p.y,t:tNow}]; } drawMap(); };
  $('#map-plus').onclick=()=>zoomBy(1.5); $('#map-minus').onclick=()=>zoomBy(1/1.5); $('#map-reset').onclick=()=>{ map.zoom=1; map.panX=0; map.panY=0; drawMap(); }; }
$('#map').onclick=e=>{ if(map.suppressClick){ map.suppressClick=false; return; } const cv=$('#map'), r=cv.getBoundingClientRect(), tf=map.tf; if(!tf) return; const px=(e.clientX-r.left)*(cv.width/r.width), py=(e.clientY-r.top)*(cv.height/r.height);
  let best=null, bd=12; for(const o of known.values()){ const d=Math.hypot(tf.sx(o.x)-px,tf.sy(o.y)-py); if(d<bd){ bd=d; best=o; } }
  const wx=Math.round(tf.cx+(px-tf.W/2)/tf.sc), wy=Math.round(tf.cy+(py-tf.H/2)/tf.sc);
  setTarget(best?{id:best.id,cls:best.cls,x:best.x,y:best.y,name:best.name}:{id:0,cls:0,x:wx,y:wy,name:`точка ${wx}, ${wy}`}); };

function drawChartTlm(){ const cv=$('#chart-tlm'); fitCanvas(cv); const ctx=cv.getContext('2d'), W=cv.width, H=cv.height; ctx.fillStyle='#000'; ctx.fillRect(0,0,W,H); const u=units.get(+$('#ch-unit').value||active); const f=$('#ch-field').value; if(!u||!u.hist.length) return;
  const h=u.hist, t0=h[0].t, t1=Math.max(tNow,t0+60); const max=f==='pulse'?220:f==='cons'?3:100; ctx.strokeStyle='#1a1e25'; for(let g=0;g<=4;g++){ const y=H-g/4*H; ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); ctx.fillStyle='#555'; ctx.font='10px monospace'; ctx.fillText((max*g/4).toFixed(0),2,y-2); }
  ctx.strokeStyle=UCOL[(u.id-1)%UCOL.length]; ctx.fillStyle=ctx.strokeStyle; ctx.beginPath(); let prev=null;
  for(const p of h){ const x=(p.t-t0)/(t1-t0)*W, y=H-Math.min(1,p[f]/max)*H; if(prev&&p.t-prev.t>6){ ctx.stroke(); ctx.beginPath(); ctx.moveTo(x,y); } else if(!prev) ctx.moveTo(x,y); else ctx.lineTo(x,y); ctx.fillRect(x-1,y-1,2,2); prev=p; } ctx.stroke();
  ctx.fillStyle='#555'; ctx.fillText(fmtT(t0),2,H-2); ctx.fillText(fmtT(t1),W-40,H-2); }
function drawChartCh(){ const cv=$('#chart-ch'); fitCanvas(cv); const ctx=cv.getContext('2d'), W=cv.width, H=cv.height; ctx.fillStyle='#000'; ctx.fillRect(0,0,W,H); const h=link.stats.hist; if(!h.length) return;
  const kinds=['TLM','HB','SONAR','DESC','IMG','EVT','drop']; const max=Math.max(100,...h.map(s=>Math.max(s.cap,kinds.reduce((a,k)=>a+s[k],0)))); const bwd=W/90;
  h.forEach((s,i)=>{ const x=W-(h.length-i)*bwd; let y=H; for(const k of kinds){ const hh=s[k]/max*H; ctx.fillStyle=KIND_COL[k]; ctx.fillRect(x,y-hh,bwd-1,hh); y-=hh; } });
  ctx.strokeStyle='#fff'; ctx.beginPath(); h.forEach((s,i)=>{ const x=W-(h.length-i)*bwd+bwd/2, y=H-s.cap/max*H; i?ctx.lineTo(x,y):ctx.moveTo(x,y); }); ctx.stroke(); ctx.fillStyle='#888'; ctx.font='10px monospace'; ctx.fillText(Math.round(max)+' Б/с',4,10); ctx.fillText('90 с',W-30,H-4); }
function bwRate(k){ const arr=bw[k]||[]; while(arr.length&&tNow-arr[0].t>5) arr.shift(); return arr.reduce((a,p)=>a+p.b,0)/5; }
function drawTruth(){ const cv=$('#truth'), ctx=cv.getContext('2d'); ctx.fillStyle='#000'; ctx.fillRect(0,0,360,200); const sx=x=>180+x*0.5, sy=y=>100+y*0.5; ctx.strokeStyle='#333'; ctx.beginPath(); ctx.arc(sx(0),sy(0),7,0,7); ctx.stroke(); ctx.strokeStyle='#444'; ctx.beginPath(); ctx.moveTo(sx(260),sy(150)); ctx.lineTo(sx(340),sy(218)); ctx.stroke();
  ctx.fillStyle='#666'; ctx.font='10px monospace'; for(const [id,x,y] of [[1,16,0],[2,40,14],[3,120,-80],[4,90,140],[5,-200,60],[6,260,150],[7,330,210]]){ ctx.fillRect(sx(x)-1,sy(y)-1,3,3); ctx.fillText(id,sx(x)+4,sy(y)+3); }
  if(dbg){ for(const u of dbg.units){ ctx.fillStyle=u.alive?UCOL[(u.id-1)%UCOL.length]:'#666'; ctx.fillRect(sx(u.x)-2,sy(u.y)-2,5,5); ctx.fillText('М'+u.id,sx(u.x)+5,sy(u.y)+3); } ctx.fillStyle=dbg.awake?'#ff5c5c':'#663'; ctx.fillRect(sx(dbg.cx)-2,sy(dbg.cy)-2,5,5); } }
$('#truth').onclick=e=>{ const r=$('#truth').getBoundingClientRect(); const x=((e.clientX-r.left)*(360/r.width)-180)/0.5, y=((e.clientY-r.top)*(200/r.height)-100)/0.5; world.postMessage({t:'tp',unit:active,x,y}); log(`[отладка] телепорт М${active} в ${x.toFixed(0)}, ${y.toFixed(0)}`,'sys'); };

// ---------- команды ----------
function send(bytes,label){ if(!link.sendUplink(bytes)){ log(`${label}: нет связи со станцией`,'err'); return false; } if(label) log(`→ ${label}`,'cmd'); return true; }
function coordBytes(p){ const X=Math.round(p.x*10)+32768, Y=Math.round(p.y*10)+32768; return [X>>8,X&255,Y>>8,Y&255]; }   // дециметры
function moveTo(tg){ const u=units.get(active); if(!u||!u.alive){ log('М'+active+': тело мертво, перемещение невозможно','err'); return; } if(send([6,0,active,...coordBytes(tg)],`М${active} идти: ${tg.name}`)) setGoal(tg.name); }
$$('button[data-cmd]').forEach(b=>b.onclick=()=>{ const c=+b.dataset.cmd, tg=T();
  if(c===8){ if(!tg||!tg.id) return log('объект не выбран','err'); if(send([8,tg.id,active],`М${active} взаимодействовать: ${tg.name}`)) setGoal(tg.name); }
  if(c===19){ if(!tg||!tg.id) return log('объект не выбран','err'); if(send([19,tg.id,active],`М${active} изучить: ${tg.name}`)) setGoal(tg.name); } });
$('#btn-desc').onclick=()=>{ const u=units.get(active); if(!u.alive) return log('М'+active+': тело мертво, описание недоступно','err'); send([1,0,active],`М${active} описание`); };
$('#btn-move').onclick=()=>{ const tg=T(); if(!tg) return log('цель не выбрана','err'); moveTo(tg); };
$('#btn-look').onclick=()=>{ const tg=T(); if(!tg) return log('цель не выбрана','err'); if(send([18,0,active,...coordBytes(tg)],`М${active} смотреть: ${tg.name}`)) setGoal(tg.name); };
$('#btn-sonar').onclick=()=>{ const u=units.get(active); if(!u.sonar) return log('М'+active+': сонар не установлен','err'); send([2,0,active],`М${active} сонар`); };
$$('button[data-mode]').forEach(b=>b.onclick=()=>{ if(send([7,+b.dataset.mode,active],`М${active} режим ${MODES[b.dataset.mode]}`) && b.dataset.mode==='3') setGoal('шлюз станции',{x:16,y:0}); });
$('#btn-img').onclick=()=>{ const u=units.get(active); if(!u.camera) return log('М'+active+': камера не установлена','err'); const lvl=+$('#img-level').value, d=$('#img-delta').checked?1:0; send([3,lvl,active,d],`М${active} кадр ${[8,16,32,64][lvl]}×${[8,16,32,64][lvl]}${d?' (дельта)':''}`); };
$('#btn-stop').onclick=()=>send([17,0,active],`М${active} стоп`);
$('#btn-take').onclick=()=>{ const tg=T(), item=+$('#take-item').value; if(!tg||!item) return; if(send([23,item,active,tg.id],`М${active} взять ${ITEMS[item]} из «${tg.name}»`)) setGoal(tg.name); };
$('#btn-put').onclick=()=>{ const tg=T(), item=+$('#put-item').value; if(!tg||!item) return; if(send([22,item,active,tg.id],`М${active} положить ${ITEMS[item]} в «${tg.name}»`)) setGoal(tg.name); };
$('#sonar').onwheel=e=>{ e.preventDefault(); const cur=map.sonarR||map.sonarAuto||50; map.sonarR=Math.max(5,Math.min(100,cur*(e.deltaY<0?1/1.15:1.15))); drawSonar(units.get(active).sonarData,units.get(active).sonarMask); };
$('#sonar').ondblclick=()=>{ map.sonarR=null; drawSonar(units.get(active).sonarData,units.get(active).sonarMask); };
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
$('#sub-sonar').onchange=e=>{ units.get(active).subs.sonar=+e.target.value; send([13,+e.target.value,active],`М${active} сонар: ${e.target.selectedOptions[0].text}`); };
$('#sub-desc').onchange=e=>{ units.get(active).subs.desc=+e.target.value; send([14,+e.target.value,active],`М${active} описание: ${e.target.selectedOptions[0].text}`); };
$('#sub-hb').onchange=e=>send([15,+e.target.value,0],`пульс станции: ${e.target.selectedOptions[0].text}`);
$('#autonomy').onchange=e=>{ const u=units.get(active); u.autonomy=+e.target.value; world.postMessage({t:'autonomy',unit:active,v:u.autonomy}); log(`М${active} при потере связи: ${e.target.selectedOptions[0].text}`,'cmd'); };
$('#btn-grow').onclick=()=>{ const mask=($('#g-cam').checked?1:0)|($('#g-sonar').checked?2:0); if(send([10,mask,0],`станция: вырастить миссионера (${$('#g-cam').checked?'камера, ':''}${$('#g-sonar').checked?'сонар':''})`)){ $('#btn-grow').disabled=true; $('#grow-state').textContent='команда отправлена, ожидание подтверждения станции…'; } };
$('#btn-st').onclick=()=>send([11,0,0],'станция: статус');
$('#speed').onchange=e=>{ speed=+e.target.value; world.postMessage({t:'speed',v:speed}); };
$$('.tabs button').forEach(b=>b.onclick=()=>{ $$('.tabs button').forEach(x=>x.classList.toggle('on',x===b)); $$('.tab').forEach(t=>t.classList.toggle('on',t.id==='tab-'+b.dataset.tab)); if(b.dataset.tab==='journal') renderJournal(); });
$('#fin-close').onclick=()=>$('#finale').hidden=true;
{ let clicks=[]; $('#btn-debug').onclick=()=>{ const now=Date.now(); clicks=clicks.filter(t=>now-t<800); clicks.push(now); if(clicks.length>=3){ clicks=[]; $('#drawer').hidden=false; } }; }   // три быстрых нажатия
$('#btn-debug-close').onclick=()=>$('#drawer').hidden=true;
const bind=(id,key,fmt,tx)=>{ const el=$(id); el.oninput=()=>{ const v=+el.value; if(tx) send([9,v+20,active],`М${active} TX ${v} dBm`); else link.cfg[key]=v; $(id+'-v').textContent=fmt(v); }; };
bind('#c-tx',null,v=>v+' dBm',true); bind('#c-noise','noiseDbm',v=>v+' dBm'); bind('#c-bw','bwHz',v=>v+' Hz'); bind('#c-deep','deepCapBps',v=>v+' bps');
$('#c-fec').onchange=e=>link.cfg.fec=e.target.checked; $('#c-arq').onchange=e=>link.cfg.arq=e.target.checked; $('#c-orbit').onchange=e=>link.cfg.orbit=e.target.checked;

// ---------- сноски ----------
const tip=$('#tip'); document.addEventListener('mouseover',e=>{ const el=e.target.closest('[data-tip]'); if(!el){ tip.style.display='none'; return; } tip.textContent=el.dataset.tip; tip.style.display='block'; });
document.addEventListener('mousemove',e=>{ if(tip.style.display!=='block') return; let x=e.clientX+14, y=e.clientY+14; if(x+350>innerWidth) x=e.clientX-350; if(y+tip.offsetHeight+10>innerHeight) y=e.clientY-tip.offsetHeight-10; tip.style.left=x+'px'; tip.style.top=y+'px'; });

// ---------- главный цикл ----------
let lastUp=true;
setInterval(()=>{
  const dt=0.1*speed; tNow+=dt; link.tick(dt);
  world.postMessage({t:'link',carriers:Object.fromEntries([...units.keys()].map(id=>[id,link.carrier(id)])),snr:Object.fromEntries([...units.keys()].map(id=>[id,link.phys.units[id]?link.snrDb(id):0]))});
  drawEcg(dt);
  const u=units.get(active); $('#tlm-unit').textContent='М'+active;
  if(u&&u.tlm){ const T=u.tlm, age=tNow-u.tlmAt; $('#tlm-age').textContent=age<1.5?'live':`${age.toFixed(0)} с назад`; $('#tlm-age').style.color=age>3*Math.max(1,+$('#sub-tlm').value||1)?'#d9534f':'';
    $('#pulse-val').textContent=T.pulse; $('#pulse-cls').textContent=T.pulse<55?'замедленный':T.pulse<100?'нормальный':T.pulse<150?'ускоренный':T.pulse<220?'интенсивный':'экстремальный';
    for(const k of ['electro','glucose','toxin','skin','bone','psyche']){ $('#b-'+k).style.width=T[k]+'%'; $('#v-'+k).textContent=T[k]; }
    $('#v-danger').textContent=T.danger?'ДА':'нет'; $('#v-danger').style.color=T.danger?'#ff5c5c':''; $('#v-cons').textContent=T.cons.toFixed(2); $('#v-charge').textContent=T.charge.toFixed(0)+'%'; $('#v-gen').textContent=T.gen.toFixed(2); $('#v-xy').textContent=`${T.x.toFixed(1)}, ${T.y.toFixed(1)}`; $('#v-mode').textContent=MODES[T.mode]||'—'; }
  else { $('#tlm-age').textContent=u&&!u.alive?'тело мертво':'нет данных'; $('#pulse-val').textContent='—'; }
  { const el=$('#v-snr'); if(u&&u.hbAt>-1e8){ const s=u.snr??0; el.textContent=u.carrier?`${s>0?'+':''}${s.toFixed(0)} дБ`:'нет'; el.style.color=!u.carrier?'#d9534f':s<5?'#e0a94a':''; } else el.textContent='—'; }
  { const el=$('#v-items'); const items=u&&u.items||[]; const n40=items.filter(i=>i===40).length; const html=[n40?`пищевой брикет${n40>1?' ×'+n40:''} <button class="mini" data-eat="40">съесть ●</button> <button class="mini" data-drop="40">сбросить ●</button>`:'', items.includes(41)?'резак <button class="mini" data-drop="41">сбросить ●</button>':''].filter(Boolean).join(', ')||'—'; if(el.innerHTML!==html) el.innerHTML=html; }
  { const tg=T(), cont=tg&&contents.get(tg.id); const p=u&&pos(active); const near=cont&&p&&Math.hypot(p.x-tg.x,p.y-tg.y)<=4; const box=$('#xfer'); box.hidden=!near;
    if(near){ const ts=$('#take-item'), ps=$('#put-item'); const carry=[...(u.camera?[42]:[]),...(u.items||[])];
      const fill=(sel,arr)=>{ const cur=sel.value; const html=[...new Set(arr)].map(i=>`<option value="${i}">${ITEMS[i]}</option>`).join(''); if(sel.dataset.h!==html){ sel.innerHTML=html; sel.dataset.h=html; if([...sel.options].some(o=>o.value===cur)) sel.value=cur; } sel.disabled=!arr.length; };
      fill(ts,cont); fill(ps,carry); $('#btn-take').disabled=!cont.length; $('#btn-put').disabled=!carry.length; } }
  $('#sonar-age').textContent=u&&u.sonarAt>-1e8?`снимок ${(tNow-u.sonarAt).toFixed(0)} с назад`:'нет данных';
  // расход по панелям
  const setBw=(id,k)=>{ const r=bwRate(k), el=$(id), lr=lastRx[k]; const fresh=lr&&tNow-lr.t<2; el.textContent=(fresh?`↓${lr.b} · `:'')+(r?r.toFixed(0)+' Б/с':'0 Б/с'); el.classList.toggle('hot',!!fresh); };
  setBw('#bw-tlm','TLM'); setBw('#bw-sonar','SONAR'); setBw('#bw-desc','DESC'); setBw('#bw-img','IMG'); setBw('#bw-hb','HB'); setBw('#bw-stimg','STIMG');
  { const lvl=+$('#img-level').value, iv=+$('#sub-img').value, full=[72,72+264,72+264+1040,72+264+1040+4160][lvl]; const keyD=[2+64*2+8, 2+64*5+8*6, 2+64*17+8*18, 2+64*65+8*66][lvl]; const cap=link.deepCapBps()/8; const est=$('#img-est'); if(iv){ const per=$('#img-delta').checked?`ключевой ${keyD} Б, дальше по движению`:`${full} Б`; const rate=($('#img-delta').checked?keyD:full)/iv; est.textContent=`подписка: ${per} · до ${rate.toFixed(0)} Б/с из ${cap.toFixed(0)}`; est.style.color=rate>cap*0.8?'#d9534f':''; } else est.textContent=`один кадр: ${full} Б ≈ ${cap?(full/cap).toFixed(1):'∞'} с`; }
  // связь
  const up=link.up(); const st=$('#link-state'); st.textContent=up?'СВЯЗЬ':'НЕТ СВЯЗИ'; st.className='badge '+(up?'up':'down');
  { const capB=link.deepCapBps()/8||1e-9; const qb=link.queueBytes('cmd')+link.queueBytes('bg'); const eta=qb/capB; $('#lamp').className='lamp'+(!up||eta>10?' full':qb>0?' busy':''); }   // нет связи — лампа красная, как и значок
  const last=link.stats.hist[link.stats.hist.length-1]; const used=last?['TLM','HB','SONAR','DESC','IMG','EVT','EXAM','ACT','INFO','CONT'].reduce((a,k)=>a+(last[k]||0),0):0; $('#rate').textContent=`${used.toFixed(0)} / ${(link.deepCapBps()/8).toFixed(0)} Б/с`+(link.cfg.orbit?` · окно ${fmtT(link.orbit().tLeft)}`:'');
  if(up!==lastUp){ log(up?'дальняя линия: связь установлена':'дальняя линия: связь потеряна','sys'); lastUp=up; }
  // станция
  { const at=[...units.values()].filter(v=>v.alive&&v.atAirlock).sort((a,b)=>a.id-b.id); const el=$('#airlock'); let html=`<div class="small dim">склад: камер ${station.cam??'—'} · брикетов ${station.brik} · резаков ${station.cut}</div>`;
    if(!at.length) html+='<div class="small dim">у шлюза никого</div>';
    for(const v of at){ const n40=v.items.filter(i=>i===40).length, has41=v.items.includes(41);
      const give=[v.camera?`<button class="mini" data-tr="42,0,${v.id}">камера → склад ●</button>`:'', n40?`<button class="mini" data-tr="40,0,${v.id}">брикет${n40>1?' ×'+n40:''} → склад ●</button>`:'', has41?`<button class="mini" data-tr="41,0,${v.id}">резак → склад ●</button>`:''].filter(Boolean).join(' ');
      const take=[station.cam&&!v.camera?`<button class="mini" data-tr="42,1,${v.id}">← камера ●</button>`:'', station.brik?`<button class="mini" data-tr="40,1,${v.id}">← брикет ●</button>`:'', station.cut&&!has41?`<button class="mini" data-tr="41,1,${v.id}">← резак ●</button>`:''].filter(Boolean).join(' ');
      html+=`<div class="row small" style="margin:3px 0"><b>М${v.id}</b> <span class="dim">${[v.camera?'камера':'',v.sonar?'сонар':''].filter(Boolean).join(', ')||'без датчиков'}${n40||has41?' · '+[n40?'брикет'+(n40>1?' ×'+n40:''):'',has41?'резак':''].filter(Boolean).join(', '):''}</span> ${give} ${take}</div>`; }
    if(el.dataset.html!==html){ el.innerHTML=html; el.dataset.html=html; } }
  $('#st-bio').textContent=station.bio??'—'; $('#st-cam').textContent=station.cam??'—'; $('#st-grow').textContent=station.grow==null?'нет':`${Math.floor(station.grow/60)}:${String(station.grow%60).padStart(2,'0')}`;
  { const growing=station.grow!=null; $('#btn-grow').disabled=growing||station.bio===0; $('#g-cam').disabled=!station.cam; $('#g-cam-l').classList.toggle('dim',!station.cam); if(!station.cam) $('#g-cam').checked=false;
    $('#grow-state').textContent=growing?`идёт выращивание: готовность через ${Math.floor(station.grow/60)}:${String(station.grow%60).padStart(2,'0')}`:station.bio===0?'биоматериала нет':`готово к запуску · биоматериал ${station.bio??'—'} ед.`;
    $('#grow-prog').style.width=growing?((180-station.grow)/180*100)+'%':'0%'; }
  const tb=$('#roster tbody'); tb.innerHTML=''; for(const v of [...units.values()].sort((a,b)=>a.id-b.id)) tb.insertAdjacentHTML('beforeend',`<tr><td>М${v.id}</td><td>${v.alive?'жив':'мёртв'}</td><td>${v.carrier?'есть':'<span style="color:#d9534f">нет</span>'}</td><td>${[v.camera?'камера':'',v.sonar?'сонар':''].filter(Boolean).join(', ')||'—'}</td><td>${v.charge==null?'—':v.charge.toFixed(0)+'%'}</td><td>${(v.items||[]).map(i=>ITEMS[i]).join(', ')||'—'}</td><td>${v.streaming?'да':''}</td></tr>`);
  // вкладки
  const tab=$('.tabs button.on').dataset.tab;
  if(tab==='map') drawMap(); if(tab==='charts'){ const cu=$('#ch-unit'); if(cu.options.length!==units.size){ const cur=cu.value; cu.innerHTML=''; for(const v of units.values()){ const o=document.createElement('option'); o.value=v.id; o.textContent='М'+v.id; cu.appendChild(o); } cu.value=cur||active; } drawChartTlm(); }
  if(tab==='channel'){ drawChartCh(); const ct=$('#ch-table tbody'); ct.innerHTML=''; for(const k of ['TLM','HB','SONAR','DESC','IMG','EVT']) ct.insertAdjacentHTML('beforeend',`<tr><td><i class="k-${k}" style="display:inline-block;width:8px;height:8px;margin-right:6px"></i>${KIND_RU[k]}</td><td>${bwRate(k).toFixed(0)}</td><td>${totals[k]||0}</td></tr>`);
    const qb=$('#queue tbody'); qb.innerHTML=''; const groups={}; for(const p of [...link.queues.cmd,...Object.values(link.queues.bg).flat().filter(p=>/^IM/.test(p.kind))]){ const g=groups[p.msgId]=groups[p.msgId]||{kind:p.kind,unit:p.unit,n:0,bytes:0,total:p.total,cls:p.cls}; g.n++; g.bytes+=p.size; }
    for(const id in groups){ const g=groups[id]; const eta=g.cls==='cmd'?link.etaFor(+id):g.bytes/(link.deepCapBps()/8||1e-9); qb.insertAdjacentHTML('beforeend',`<tr><td>${KIND_RU[link.kindOf(g.kind)]}${/^IM/.test(g.kind)?' '+[8,16,32,64][+g.kind[3]]+'px'+(g.kind[2]==='D'?' Δ':''):''}</td><td>М${g.unit}</td><td>${g.total-g.n}/${g.total}</td><td>${g.bytes}</td><td>${isFinite(eta)?eta.toFixed(1)+' с':'∞ (нет несущей)'}</td></tr>`); } }
  // отладка
  if(!$('#drawer').hidden){ const id=active; $('#i-dist').textContent=(link.phys.units[id]||{dist:0}).dist.toFixed(0)+' м'; $('#i-fspl').textContent=link.fsplDb(id).toFixed(1)+' дБ'; $('#i-obst').textContent=(link.phys.units[id]||{obstDb:0}).obstDb.toFixed(1)+' дБ'; $('#i-snr').textContent=link.snrDb(id).toFixed(1)+' дБ'+(link.phys.extraGain?' (+'+link.phys.extraGain+')':''); $('#i-local').textContent=(link.localCapBps(id)/1000).toFixed(2)+' кбит/с'; $('#i-ber').textContent=link.ber(id).toExponential(1); $('#i-per').textContent=(link.per(id,72)*100).toFixed(1)+'%'; $('#i-deep').textContent=(link.deepCapBps()/1000).toFixed(2)+' кбит/с = '+(link.deepCapBps()/8).toFixed(0)+' Б/с'; $('#i-cnt').textContent=`${link.stats.delivered}/${link.stats.dropped}/${link.stats.retrans}`;
    if((tNow*10|0)%10===0) world.postMessage({t:'peek',unit:active});
    $('#i-queue').textContent=`фон: ${link.queueBytes('bg')} Б · команды: ${link.queueBytes('cmd')} Б (${link.queues.cmd.length} пкт) · повторы: ${link.retry.length}`; drawTruth(); }
},100);

// ---------- сохранение: мир + знание консоли, хранилище браузера ----------
const SAVE_KEY='missioners.save', SAVE_VERSION=5;   // поднимать при несовместимых изменениях формата мира или консоли
let pendingWorld=null, lastSaveAt=0, prevSessionGap=null;
function consoleSnapshot(){
  const us=[...units.values()].map(u=>({...u, hist:u.hist.slice(-600), img:undefined, sonarData:u.sonarData?[...u.sonarData]:null, sonarMask:u.sonarMask||null}));
  return { tNow, active, station, totals, stcam:{subs:stcam.subs}, log:logEntries.slice(-400), contents:[...contents.entries()], sonar:sonarSnaps.slice(-120), units:us, known:[...known.entries()].map(([k,v])=>[k,{...v,seenBy:[...v.seenBy]}]), journal:[...journal.entries()] };
}
function saveNow(worldData){ try{ localStorage.setItem(SAVE_KEY, JSON.stringify({v:SAVE_VERSION, savedAt:Date.now(), world:worldData, console:consoleSnapshot()})); lastSaveAt=Date.now(); $('#save-state').textContent='сохранено '+new Date().toLocaleTimeString('ru',{hour:'2-digit',minute:'2-digit'}); }catch(e){ $('#save-state').textContent='сохранение не удалось'; } }
function requestSave(){ world.postMessage({t:'save'}); }
function restoreConsole(d){
  tNow=d.tNow; active=d.active||1; Object.assign(station,d.station); if(d.stcam) Object.assign(stcam.subs,d.stcam.subs); Object.assign(totals,d.totals||{}); units.clear();
  for(const su of d.units){ const u=U(su.id); Object.assign(u,su,{img:u.img, sonarData:su.sonarData?new Uint8Array(su.sonarData):null, sonarMask:su.sonarMask||null}); }
  known.clear(); for(const [k,v] of d.known) known.set(k,{...v,seenBy:new Set(v.seenBy)});
  journal.clear(); for(const [k,v] of d.journal) journal.set(k,v); contents.clear(); for(const [k,v] of d.contents||[]) contents.set(k,v); sonarSnaps.length=0; sonarSnaps.push(...(d.sonar||[]).filter(s=>s.b&&s.b.length===64));
  $('#log').innerHTML=''; logEntries.length=0; for(const e of d.log||[]) log(e.txt,e.cls,e.t); log('— сеанс восстановлен —','sys');
}
function readSave(){ try{ const raw=localStorage.getItem(SAVE_KEY); return raw?JSON.parse(raw):null; }catch(e){ return null; } }
function applySave(s){ const gap=Math.max(0,(Date.now()-s.savedAt)/1000); prevSessionGap=gap; link.reset();
  world.postMessage({t:'load',data:s.world,elapsed:0}); restoreConsole(s.console); resumed=true; }   // игровое время стоит, пока консоль закрыта
setInterval(()=>{ if(!$('#boot').classList.contains('off')) return; requestSave(); },10000);
function exportSave(){ const raw=localStorage.getItem(SAVE_KEY); if(!raw) return false; const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([raw],{type:'application/json'})); a.download='ark-041-session.json'; a.click(); return true; }
function importSave(){ return new Promise(res=>{ const inp=$('#import-file'); inp.value=''; let done=false; const finish=v=>{ if(done) return; done=true; window.removeEventListener('focus',onFocus); res(v); };
  inp.onchange=e=>{ const f=e.target.files[0]; if(!f) return finish(null); f.text().then(txt=>{ const s=JSON.parse(txt); localStorage.setItem(SAVE_KEY,txt); finish(s); }).catch(()=>finish(null)); };
  const onFocus=()=>setTimeout(()=>{ if(!inp.files.length) finish(null); },800);   // диалог закрыт без файла — отмена
  setTimeout(()=>window.addEventListener('focus',onFocus),300); inp.click(); }); }
let resumed=false;
function fmtGap(s){ if(s<90) return `${s.toFixed(0)}s`; if(s<5400) return `${(s/60).toFixed(0)}m`; if(s<172800) return `${(s/3600).toFixed(1)}h`; return `${(s/86400).toFixed(1)}d`; }

// ---------- заставка: ведётся настоящими пакетами ----------
const boot={onInfo:null,onHb:null,onTlm:null};
(async()=>{
  const el=$('#boot-text'); const sl=ms=>new Promise(r=>setTimeout(r,ms));
  const type=async s=>{ for(const ch of s){ el.textContent+=ch; await sl(12); } };
  const line=(s)=>{ el.textContent+=s+'\n'; };
  // вращающийся индикатор ожидания: -\|/ на конце последней строки, пока обещание не разрешится
  const spin=async p=>{ const f=['-','\\','|','/']; let i=0; el.textContent+=' '; const t=setInterval(()=>{ el.textContent=el.textContent.slice(0,-1)+f[i++%4]; },120); try{ return await p; } finally{ clearInterval(t); el.textContent=el.textContent.slice(0,-1)+'\n'; } };
  selectUnit(); drawSonar(null);
  el.textContent='$ '; await sl(200); await type('ares-tk --key ~/old/dse.key ping ARK-041'); el.textContent+='\n';
  line('resolve ARK-041 via DSE routing table… corp endpoint unreachable, using cached route');
  // сеанс: меню в терминале, одна клавиша
  const key=async(keys)=>{ const cur=document.createElement('span'); cur.className='cur'; el.appendChild(cur); const k=await new Promise(res=>{ const h=e=>{ const k=e.key.toLowerCase(); if(keys.includes(k)){ document.removeEventListener('keydown',h); res(k); } }; document.addEventListener('keydown',h); }); cur.remove(); el.textContent+=k+'\n'; return k; };
  let s=readSave();
  for(;;){
    if(s){ const gap=(Date.now()-s.savedAt)/1000; line(`local session store: found, last link ${fmtGap(gap)} ago`); if((s.v||0)!==SAVE_VERSION) line(`  warning: session build v${s.v||0}, current v${SAVE_VERSION} — resume may misbehave, [n] recommended`); el.textContent+='[r] resume  [n] new  [i] import file  [e] export file  ';
      const k=await key(['r','n','i','e']);
      if(k==='r'){ applySave(s); line('session restored, world clock paused since'); break; }
      if(k==='e'){ exportSave(); line('exported'); continue; }
      if(k==='i'){ const ns=await importSave(); if(ns){ s=ns; line('imported'); } else line('import cancelled'); continue; }
      if(k==='n'){ el.textContent+='overwrite stored session? [y/n] '; const y=await key(['y','n']); if(y==='y'){ localStorage.removeItem(SAVE_KEY); line('new session'); break; } continue; }
    } else { line('local session store: empty'); el.textContent+='[n] new  [i] import file  ';
      const k=await key(['n','i']); if(k==='n'){ line('new session'); break; } const ns=await importSave(); if(ns){ s=ns; line('imported'); } else line('import cancelled'); }
  }
  const t0=Date.now(), info0=totals.INFO||0; el.textContent+='status request, 3 B'; link.sendUplink([11,0,0]);
  const info=await spin(new Promise(res=>{ boot.onInfo=(text,pkt)=>{ boot.onInfo=null; res({text,pkt}); }; }));
  line(`ACK ARK-041  rtt=${((Date.now()-t0)/1000).toFixed(2)}s  ch=FTL/DSE-2  rate=${(link.deepCapBps()).toFixed(0)}bps  rx=${(totals.INFO||0)-info0}B`);
  for(const l of info.text.split('\n')) line('  '+l);
  el.textContent+='heartbeat'; const hb=await spin(Promise.race([new Promise(res=>{ boot.onHb=b=>{ boot.onHb=null; res(b); }; }), sl(8000).then(()=>null)])); boot.onHb=null; el.textContent=el.textContent.replace(/heartbeat\n$/,'');
  if(!hb) line('heartbeat: none within 8s'); else line(`heartbeat ${hb.length}B  units=${hb[5]}` + (hb[5]?`  M${hb[6]}[${[hb[7]&1?'alive':'dead',hb[7]&2?'carrier '+(hb[10]-30)+'dB':'nocarrier',hb[7]&4?'cam':'',hb[7]&8?'sonar':''].filter(Boolean).join(' ')}]`:''));
  const anyAlive=[...units.values()].some(u=>u.alive);
  if(anyAlive) el.textContent+='telemetry'; const tlm=anyAlive?await spin(Promise.race([new Promise(res=>{ boot.onTlm=p=>{ boot.onTlm=null; res(p); }; }), sl(6000).then(()=>null)])):null; boot.onTlm=null; if(anyAlive) el.textContent=el.textContent.replace(/telemetry\n$/,'');
  if(tlm){ const T=units.get(tlm.unit).tlm; line(`telemetry M${tlm.unit} ${tlm.size}B  pulse=${T.pulse} charge=${T.charge.toFixed(0)}% pos=${T.x},${T.y}`); } else line(anyAlive?'telemetry: none within 6s':'telemetry: no live units');
  line(''); line('$ console'); await sl(250); $('#boot').classList.add('off');
  log('консоль открыта. ключ принят.','sys'); selectUnit(); renderUnits();
})();

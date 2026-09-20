// ВИРТУАЛЬНАЯ КОНСОЛЬ ОПЕРАТОРА для внешнего агента (docs/agent-api.md §10). Такой же клиент станции, как консоль в браузере:
// получает те же сообщения (пакеты, потери, показания модема), декодирует их в текст, а текстовые команды превращает в те же
// байты аплинка (tech.md §4). Знает о мире ровно то, что пришло по каналу: телеметрия, пульс, описания, события, кадры.
// Никаких данных мира напрямую — честность по построению: консоль подключается к комнате как обычный оператор.
const path=require('path'), fs=require('fs');
const CB=require(path.join(__dirname,'..','proto','codebook.js'));
const {EVENTS, MODES, STANCES, AUTONOMY, ITEMS, decText, objCmds}=CB;
const RUMBS=['В','ЮВ','Ю','ЮЗ','З','СЗ','С','СВ'];   // пеленг 0° — восток (+x), 90° — юг (+y на карте)
const rumb=deg=>RUMBS[Math.round(deg/45)%8];
const KIND_RU={TLM:'телеметрия',HB:'пульс станции',SONAR:'лидар',DESC:'описание',IMG:'кадр',EVT:'событие',EXAM:'осмотр',ACT:'действие',INFO:'паспорт',CONT:'содержимое'};
const CLS_RU={0:'объект',1:'ориентир',2:'неопознанное',3:'тело',4:'миссионер'};
const pos=(b,o)=>({x:(((b[o]<<8)|b[o+1])-32768)/10, y:(((b[o+2]<<8)|b[o+3])-32768)/10});
const coordBytes=p=>{ const X=Math.round(p.x*10)+32768, Y=Math.round(p.y*10)+32768; return [X>>8,X&255,Y>>8,Y&255]; };
const f1=v=>(Math.round(v*10)/10).toFixed(1);
const ITEM_BY_WORD=[['брикет',40],['резак',41],['камер',42],['патрон',43]];
const itemOf=s=>{ const w=(s||'').toLowerCase(); for(const [k,id] of ITEM_BY_WORD) if(w.includes(k)) return id; return null; };
const stem=w=>w.toLowerCase().slice(0,Math.max(3,w.length-2));

class OpConsole {
  constructor(){
    this.n=0; this.lines=[]; this.units=new Map(); this.station={}; this.modem=null; this.known=new Map(); this.contents=new Map();
    this.img=new Map(); this.asm={}; this.replay=0; this.tNow=0;
  }
  unit(id){ if(!this.units.has(id)) this.units.set(id,{id, alive:true, carrier:true, camera:false, sonar:false, items:[], charge:null, tlm:null, tlmLine:null, tlmLineAt:-1e9, desc:[], descAt:-1e9}); return this.units.get(id); }
  imgOf(unit){ if(!this.img.has(unit)) this.img.set(unit,{buf:new Uint8Array(64*64), levels:{}, msg:null, asm:{}}); return this.img.get(unit); }
  say(text){ this.n++; const l={n:this.n, at:+this.tNow.toFixed(1), text}; this.lines.push(l); if(this.lines.length>2000) this.lines.shift(); if(this.onLine) this.onLine(l); }
  // ---- сообщения станции (то же, что transport.onmessage в console.js) ----
  onMsg(m){
    if(m.t==='pkt'){ if(m.bytes&&!(m.bytes instanceof Uint8Array)) m.bytes=new Uint8Array(m.bytes); this.tNow=m.at; if(m.replay) this.replay++; this.onPkt(m,!!m.replay); }
    else if(m.t==='drop'){ if(m.kind==='TLM'||m.kind==='HB') return; if(m.seq===undefined){ this.say(`кадр М${m.unit} пропущен: ${(m.reason||'').split(': ')[1]||m.reason}`); return; } this.say(`потерян пакет ${KIND_RU[m.kind.replace(/^IM[GD]\d/,'IMG')]||m.kind} М${m.unit} #${m.msgId}/${m.seq}: ${m.reason}`); }
    else if(m.t==='modem'){ const was=this.modem; this.modem=m; this.tNow=m.at; if(was&&was.up!==m.up) this.say(m.up?'дальняя линия: связь установлена':'дальняя линия: связь потеряна'); }
    else if(m.t==='ops'){ const s=(m.ops||[]).join(', '); if(s!==this.ops){ this.ops=s; this.say(`терминал: операторы на платформе — ${s||'—'}`); } }
    else if(m.t==='welcome'){ this.name=m.name; this.st=m.st; }
  }
  onPkt(p,replay){
    if(p.kind==='DESC'||p.kind==='EXAM'||p.kind==='ACT'||p.kind==='INFO'||p.kind==='SONAR'){ const full=this.assemble(p); if(!full) return; p={...p,bytes:full}; }
    switch(p.kind){
      case 'TLM': this.tlm(p,replay); break;
      case 'HB': this.hb(p.bytes,replay); break;
      case 'DESC': this.desc(p,replay); break;
      case 'EVT': this.evt(p,replay); break;
      case 'INFO': { const text=decText(p.bytes); const pp=/платформа: (-?[\d.]+), (-?[\d.]+)/.exec(text); if(pp) this.station.pos={x:+pp[1],y:+pp[2]}; const rr=/возврат:.*?(\d+) м/.exec(text); if(rr) this.station.returnR=+rr[1]; this.station.info=text; if(!replay) this.say('станция: '+text.replace(/\n/g,' · ')); break; }
      case 'CONT': { const b=p.bytes; const c=[...b.slice(2,2+b[1])]; this.contents.set(b[0],c); if(!replay) this.say(`содержимое ${this.oname(b[0])}: ${c.map(i=>ITEMS[i]).join(', ')||'пусто'}`); break; }
      case 'EXAM': { const b=p.bytes, id=b[0], st=b[2], len=(b[3]<<8)|b[4]; const text=decText(b.slice(5,5+len)); const k=this.known.get(id); if(k){ k.state=st; k.examined=true; } if(!replay) this.say(`М${p.unit} осмотр ${this.oname(id)}: ${text}${this.cmdsText(id)}`); break; }   // [id, код, состояние после, длина 2 Б, текст]
      case 'ACT': { const b=p.bytes, id=b[0], code=b[1], st=b[2], len=(b[3]<<8)|b[4]; const text=decText(b.slice(5,5+len)); const k=this.known.get(id); if(k) k.state=st; if(!replay) this.say(`М${p.unit} ${this.oname(id)}: ${text}${code?' [не вышло]':''}${this.cmdsText(id)}`); break; }
      case 'SONAR': this.sonar(p,replay); break;
      default: if(/^IMG\d/.test(p.kind)) this.imgPyr(p,replay); else if(/^IMD\d/.test(p.kind)) this.imgDelta(p,replay);
    }
  }
  assemble(p){ if(p.total===1) return p.bytes; const a=this.asm[p.msgId]=this.asm[p.msgId]||{parts:{},total:p.total}; a.parts[p.seq]=p.bytes; if(Object.keys(a.parts).length<a.total) return null; const out=[]; for(let i=0;i<a.total;i++) out.push(...a.parts[i]); delete this.asm[p.msgId]; return new Uint8Array(out); }
  oname(id){ const k=this.known.get(id); return k?`${k.name} (${id})`:`объект ${id}`; }
  // телеметрия: строка не на каждый пакет, а на перемену — иначе агент тонет в цифрах (полная картина — в state)
  tlm(p,replay){ const b=p.bytes, u=this.unit(p.unit);
    const T={pulse:b[0],electro:b[1],glucose:b[2],toxin:b[3],skin:b[4],bone:b[5],psyche:b[6],danger:b[7]&1,autonomy:(b[7]>>1)&3,cons:b[8]/50,charge:b[9]/2.55,gen:b[10]/50,...pos(b,11),mode:b[15]&7,stealth:!!(b[15]&8),stance:(b[15]>>4)&3,reflex:b[15]&64?5:b[15]&128?6:0};
    const L=u.tlmLine; u.tlm=T; u.tlmAt=this.tNow; if(replay) return;
    const band=v=>v<55?0:v<100?1:v<150?2:v<220?3:4;
    const why=!L?'первая':T.danger!==L.danger?'опасность':T.mode!==L.mode||T.reflex!==L.reflex?'режим':band(T.pulse)!==band(L.pulse)?'пульс':['skin','bone','psyche','glucose','electro'].some(k=>L[k]-T[k]>=5)?'падение':T.charge<L.charge-5?'заряд':Math.hypot(T.x-L.x,T.y-L.y)>=5?'положение':this.tNow-u.tlmLineAt>=30?'срок':null;
    if(!why) return; u.tlmLine={...T}; u.tlmLineAt=this.tNow; this.say(this.tlmText(u)); }
  tlmText(u){ const T=u.tlm; if(!T) return `М${u.id}: телеметрии нет`; const pc=T.pulse<55?'замедленный':T.pulse<100?'нормальный':T.pulse<150?'ускоренный':T.pulse<220?'интенсивный':'экстремальный';
    return `М${u.id} телеметрия: пульс ${T.pulse} (${pc}), электролиты ${T.electro}, глюкоза ${T.glucose}, токсины ${T.toxin}, кожа ${T.skin}, кости ${T.bone}, психика ${T.psyche}, заряд ${T.charge.toFixed(0)}%, опасность ${T.danger?'ДА':'нет'}, режим ${T.reflex?MODES[T.reflex]+' (рефлекс)':MODES[T.mode]||T.mode}${T.stealth?', скрытность':''}, стойка ${STANCES[T.stance]}, без несущей: ${AUTONOMY[T.autonomy]}, позиция ${f1(T.x)}, ${f1(T.y)}`; }
  hb(b,replay){ const S=this.station; const was=JSON.stringify([S.bio,S.cam,S.grow,S.brik,S.cut]); Object.assign(S,{bio:b[0],cam:b[1],grow:b[2]===255?null:b[2],brik:b[3],cut:b[4],at:this.tNow}); const n=b[5]; const changes=[];
    const listed=new Set(); for(let i=0;i<n;i++){ const id=b[6+i*9], f=b[7+i*9], ch=b[8+i*9]/2.55, it=b[9+i*9], snr=b[10+i*9]-30, im=b[14+i*9]; listed.add(id); const u=this.unit(id); const was={alive:u.alive,carrier:u.carrier,camera:u.camera,sonar:u.sonar,atAirlock:u.atAirlock,hb:u.hbAt!==undefined};
      // подписки и передатчик — настройки тела, которые держит станция (общие для всех консолей платформы): в state, не в ленту
      Object.assign(u,{alive:!!(f&1),carrier:!!(f&2),camera:!!(f&4),sonar:!!(f&8),streaming:!!(f&16),atAirlock:!!(f&32),charge:ch,snr,hbAt:this.tNow,items:[...Array(it&3).fill(40),...(it&4?[41]:[]),...(it&8?[43]:[])],
        subs:{tlm:b[11+i*9],sonar:b[12+i*9],desc:b[13+i*9],img:im&31,delta:!!(im&32),level:im>>6,tx:[-10,0,10,null][(it>>4)&3]}});
      if(!was.hb) changes.push(`М${id}: ${u.alive?'жив':'мёртв'}, несущая ${u.carrier?(snr>0?'+':'')+snr+' дБ':'нет'}, ${[u.camera?'камера':'',u.sonar?'лидар':''].filter(Boolean).join(', ')||'без датчиков'}, заряд ${ch.toFixed(0)}%`);
      else { if(was.alive&&!u.alive) changes.push(`М${id}: жизненные функции прекращены`); if(was.carrier!==u.carrier) changes.push(`М${id}: несущая ${u.carrier?'восстановлена':'не принимается'}`); if(was.camera!==u.camera) changes.push(`М${id}: камера ${u.camera?'на теле':'снята'}`); if(was.atAirlock!==u.atAirlock&&u.alive) changes.push(`М${id}: ${u.atAirlock?'у шлюза':'отошёл от шлюза'}`); } }
    for(const [id,u] of this.units) if(!listed.has(id)&&u.hbAt===undefined) this.units.delete(id);
    { const o=6+n*9, nt=b[o]??0; const prev=S.turrets||[]; S.turrets=[]; for(let j=0;j<nt;j++){ const id=b[o+1+j*3], f=b[o+2+j*3], am=b[o+3+j*3]; const T={id,powered:!!(f&1),on:!!(f&2),broken:!!(f&4),tracking:!!(f&8),reloading:!!(f&16),ammo:am===255?null:am}; S.turrets.push(T);
        const w=prev.find(x=>x.id===id); const txt=this.turretText(T); if(!w) changes.push(txt); else if(w.on!==T.on||w.broken!==T.broken||w.powered!==T.powered||w.tracking!==T.tracking||w.ammo!==T.ammo) changes.push(txt); }
      // ретрансляторы, чей маяк станция слышит на своём канале: по перемене; пропал из пульса — вне сети
      const o2=o+1+nt*3, nr=b[o2]??0; const prevR=S.relays||[]; S.relays=[]; for(let j=0;j<nr;j++){ const id=b[o2+1+j*2], f=b[o2+2+j*2]; const R={id,on:!!(f&1),mobile:!!(f&2)}; S.relays.push(R); const w=prevR.find(x=>x.id===id); if(!w||w.on!==R.on) changes.push(`ретранслятор ${id}: ${R.mobile?'переносной, ':''}${R.on?'включён — узел связи':'выключен'}`); }
      for(const w of prevR) if(!S.relays.find(x=>x.id===w.id)) changes.push(`ретранслятор ${w.id}: вне сети`);
      const o3=o2+1+nr*2; if(b.length>o3) S.camSub={img:b[o3]&31,delta:!!(b[o3]&32),level:b[o3]>>6}; }   // автосъёмка камеры шлюза
    const now=JSON.stringify([S.bio,S.cam,S.grow,S.brik,S.cut]); if(was!==now&&was!=='[null,null,null,null,null]') changes.push(this.stationText());
    if(!replay) for(const c of changes) this.say(c); }
  subsText(s){ const iv=v=>v?`каждые ${v} с`:'выкл'; return `телеметрия ${iv(s.tlm)}, лидар ${iv(s.sonar)}, описание ${iv(s.desc)}, автосъёмка ${s.img?`${iv(s.img)} (${[8,16,32,64][s.level]}px${s.delta?', дельта':''})`:'выкл'}, передатчик ${s.tx==null?'?':(s.tx>0?'+':'')+s.tx+' дБм'}`; }
  turretText(T){ return `турель ${T.id}: ${T.broken?'повреждена':!T.powered?'без питания, данных нет':T.on?(T.tracking?'ведёт цель':T.reloading?'перезарядка':'включена'):'выключена'}${T.ammo==null?'':', патронов '+T.ammo}`; }
  stationText(){ const S=this.station; return `станция: биоматериал ${S.bio??'—'}, камер на складе ${S.cam??'—'}, брикетов ${S.brik??'—'}, резаков ${S.cut??'—'}${S.grow!=null?`, выращивание: готовность через ${Math.floor(S.grow/60)}:${String(S.grow%60).padStart(2,'0')}`:''}`; }
  desc(p,replay){ const b=p.bytes, u=this.unit(p.unit); const at=pos(b,0); const items=[];
    for(let i=4;i+6<b.length;){ const len=b[i+6]; const it={id:b[i],cls:b[i+1],bearing:b[i+2]*2,range:b[i+3],type:b[i+4],state:b[i+5],name:decText(b.slice(i+7,i+7+len))}; i+=7+len;   // тип — корпоративная номенклатура или 0; состояние — байт
      it.x=at.x+Math.cos(it.bearing*Math.PI/180)*it.range; it.y=at.y+Math.sin(it.bearing*Math.PI/180)*it.range; items.push(it);
      const prev=this.known.get(it.id); const keep=prev&&it.cls!==2&&prev.range<it.range; this.known.set(it.id,{id:it.id,cls:it.cls,type:it.type,state:it.state,examined:prev&&prev.examined,name:it.name,x:keep?prev.x:it.x,y:keep?prev.y:it.y,range:keep?prev.range:it.range,at:this.tNow,unit:p.unit}); }
    u.desc=items; u.descAt=this.tNow; u.descPos=at; if(replay) return;
    this.say(`М${p.unit} описание (снято в ${f1(at.x)}, ${f1(at.y)}), ${items.length}: `+items.map(it=>`${it.name} [${it.id}, ${CLS_RU[it.cls]}, ${rumb(it.bearing)} ${it.bearing}°, ${it.range} м${this.cmdsText(it.id,true)}]`).join('; ')); }
  // команды объекта по типу и состоянию из описания (objCmds, кодовая книга): «изучить» — у всего; указатель — только оно; тип 0 — «взаимодействовать»
  cmdsText(id,short){ const k=this.known.get(id); if(!k||k.cls!==0) return ''; const own=k.type===34?(this.station.turrets||[]).some(T=>T.id===id):undefined; const c=objCmds(k.type||0,k.state||0,{own}).filter(c=>!c.afterExam||k.examined).map(c=>c.label+(c.needs?' (нужен '+ITEMS[c.needs]+')':'')); return c.length?(short?'; ':' Команды: ')+c.join(', '):''; }
  evt(p,replay){ const b=p.bytes, code=b[0], arg=b[1], un=p.unit?`М${p.unit} `:''; const txt=EVENTS[code]||('событие '+code); let s;
    if(code===7) s=`${un}${txt}: ${MODES[arg]}`; else if(code===32) s=`${un}${txt}: ${arg?'включена':'выключена'}`; else if(code===33) s=`${un}${txt}: ${STANCES[arg]}`; else if(code===35) s=`${un}${txt}: ${AUTONOMY[arg]}`; else if(code===13) s=`${un}${txt} М${arg}`; else if(code===16) s=`${un}${txt} (id ${arg}); нужно новое описание`; else if(code===19||code===20) s=`${un}${txt}: ${ITEMS[arg]||arg}`; else if(code===28) s=`${un}${txt} (${arg*10} м от ближайшего узла${this.station.returnR?', предел '+this.station.returnR+' м':''})`; else if(code===3||code===41) s=`${txt}: ${arg}`; else if(code===42) s=`${txt}: ${arg>>1} ${arg&1?'включён':'выключен'}`; else s=`${un}${txt}`;
    if(code===5) this.unit(p.unit).alive=false; if(code===6) this.unit(p.unit);
    if(!replay) this.say(s); }
  sonar(p,replay){ const b=p.bytes, at=pos(b,0); const o=b.length>=79?3:b.length>=78?2:b.length>=77?1:0; const tilt=o?b[4]-90:0; const mask=[...b.slice(4+o,12+o)], rays=b.slice(12+o); if(replay) return;
    const R=i=>rays[i]/255*100; let near=1e9, ni=0, far=0; const solid=[]; for(let i=0;i<64;i++){ const r=R(i); if(r<near){ near=r; ni=i; } if(rays[i]>=255) far++; if(mask[i>>3]&(1<<(i&7))) solid.push(i); }
    const byRumb={}; for(const i of solid){ const k=RUMBS[Math.round(i/8)%8]; byRumb[k]=(byRumb[k]||0)+1; }
    const sectors=[]; for(let s=0;s<8;s++){ let sum=0,c=0; for(let i=s*8;i<s*8+8;i++){ if(rays[i]<255){ sum+=R(i); c++; } } sectors.push(`${RUMBS[s]} ${c?(sum/c).toFixed(0)+' м':'∞'}`); }
    this.say(`М${p.unit} лидар (снято в ${f1(at.x)}, ${f1(at.y)}, наклон ${tilt}°): по секторам ${sectors.join(', ')}; ближайшее ${near.toFixed(1)} м на ${RUMBS[Math.round(ni/8)%8]}; сплошное (стены, корпуса): ${solid.length?Object.entries(byRumb).map(([k,n])=>k+'×'+n).join(', '):'нет'}; без эха ${far} лучей из 64`); }
  imgPyr(p,replay){ const im=this.imgOf(p.unit), lvl=+p.kind[3], side=[8,16,32,64][lvl], block=64/side; if(lvl===0&&im.msg!==p.msgId){ im.buf.fill(0); im.levels={}; } im.msg=p.msgId; const off=p.seq*64;
    for(let k=0;k<p.bytes.length;k++){ const i=off+k, px=i%side, py=Math.floor(i/side), v=p.bytes[k]; for(let y=0;y<block;y++)for(let x=0;x<block;x++) im.buf[(py*block+y)*64+px*block+x]=v; }
    im.levels[lvl]=(im.levels[lvl]||0)+1; const tot=[1,4,16,64]; if(!replay&&im.levels[lvl]===tot[lvl]) this.say(`М${p.unit} кадр ${side}×${side} (уровень ${lvl} полный):\n`+this.ascii(im.buf)); }
  imgDelta(p,replay){ const im=this.imgOf(p.unit), lvl=+p.kind[3], side=[8,16,32,64][lvl], bsz=side/8, n=bsz*bsz, up=64/side;
    im.asm[p.msgId]=im.asm[p.msgId]||{parts:{},total:p.total,len:p.total*64}; const a=im.asm[p.msgId]; a.parts[p.seq]=p.bytes; if(p.seq===p.total-1) a.len=p.seq*64+p.bytes.length;
    const buf=new Uint8Array(a.len), have=new Array(a.total).fill(false); for(const s in a.parts){ buf.set(a.parts[s].slice(0,Math.max(0,a.len-s*64)),s*64); have[s]=true; }
    const frameNo=buf[0], key=buf[1]; if(key&&p.seq===0&&Object.keys(a.parts).length===1) im.buf.fill(0);
    let q=2, applied=0; while(q+1+n<=buf.length){ const p0=Math.floor(q/64), p1=Math.floor((q+n)/64); let ok=true; for(let z=p0;z<=p1;z++) if(!have[z]) ok=false;
      if(ok){ const bb=buf[q]; if(bb<64){ const bx=(bb%8)*bsz, by=Math.floor(bb/8)*bsz; for(let j=0;j<bsz;j++)for(let i=0;i<bsz;i++){ const v=buf[q+1+j*bsz+i]; for(let yy=0;yy<up;yy++)for(let xx=0;xx<up;xx++) im.buf[((by+j)*up+yy)*64+(bx+i)*up+xx]=v; } applied++; } } q+=1+n; }
    if(have.every(Boolean)){ delete im.asm[p.msgId]; if(!replay) this.say(`М${p.unit} дельта-кадр ${frameNo}${key?' (ключевой)':''} ${side}×${side}, блоков ${applied}:\n`+this.ascii(im.buf)); } }
  // кадр текстом: 64×64 → 32 столбца × 16 строк (усреднение 2×4), 10 градаций серого
  ascii(buf){ const ch=' .:-=+*#%@'; const rows=[]; for(let y=0;y<16;y++){ let s=''; for(let x=0;x<32;x++){ let sum=0; for(let j=0;j<4;j++)for(let i=0;i<2;i++) sum+=buf[(y*4+j)*64+x*2+i]; s+=ch[Math.min(9,Math.floor(sum/8/25.6))]; } rows.push(s); } return rows.join('\n'); }
  // ---- картина сейчас (join / state) ----
  state(){ const out=[]; const M=this.modem; out.push(`${this.name||'платформа'}: ${M?(M.up?'связь есть':'СВЯЗИ НЕТ')+`, ёмкость ${(M.cap/8).toFixed(0)} Б/с, в очереди станции ${M.qcmd+M.qbg} Б`+(M.queue.length?` (${M.queue.map(g=>`${KIND_RU[g.kind.replace(/^IM[GD]\d/,'IMG')]||g.kind} М${g.unit} #${g.id} ${isFinite(g.eta)?g.eta.toFixed(0)+' с':'∞'}`).join(', ')})`:''):'показаний модема ещё нет'}`);
    if(this.station.bio!==undefined) out.push(this.stationText()); if(this.station.pos) out.push(`платформа стоит в ${f1(this.station.pos.x)}, ${f1(this.station.pos.y)}; радиус возврата ${this.station.returnR||'—'} м`);
    for(const u of [...this.units.values()].sort((a,b)=>a.id-b.id)){ out.push(`М${u.id}: ${u.alive?'жив':'мёртв'}, несущая ${u.carrier?'есть':'нет'}, ${[u.camera?'камера':'',u.sonar?'лидар':''].filter(Boolean).join(', ')||'без датчиков'}, заряд ${u.charge==null?'—':u.charge.toFixed(0)+'%'}, предметы: ${u.items.map(i=>ITEMS[i]).join(', ')||'—'}${u.atAirlock?', у шлюза':''}${u.subs?`; подписки: ${this.subsText(u.subs)}`:''}`); if(u.tlm) out.push('  '+this.tlmText(u)); }
    if(this.station.camSub&&this.station.camSub.img) out.push(`камера шлюза: автосъёмка каждые ${this.station.camSub.img} с, ${[8,16,32,64][this.station.camSub.level]}px${this.station.camSub.delta?', дельта':''}`);
    const K=[...this.known.values()].sort((a,b)=>a.id-b.id); if(K.length) out.push('известные объекты (по описаниям): '+K.map(k=>`${k.name} [${k.id}, ${CLS_RU[k.cls]}, ~${f1(k.x)}, ${f1(k.y)}]`).join('; '));
    return out; }
  // ---- команды текстом → байты (tech.md §4) ----
  parse(line){
    const s=String(line||'').trim(); const m=/^(м\s*(\d+)|станция|отменить)\s*[:,—-]?\s*(.*)$/iu.exec(s); if(!m) return {error:'нужно «М1: описание», «станция: статус» или «отменить 37»'};
    const v=(m[3]||'').trim().toLowerCase().replace(/ё/g,'е'); const num=(re)=>{ const r=re.exec(v); return r?+r[1]:null; };
    if(/^отменить/i.test(m[1])){ const id=num(/(\d+)/); if(id==null) return {error:'отменить: нужен номер запроса из очереди (state)'}; const g=this.modem&&this.modem.queue.find(g=>g.id===id); if(!g) return {error:`в очереди нет запроса #${id}`}; return {bytes:[27,0,g.unit,id>>8,id&255], label:`отмена #${id}`}; }
    if(/^станция/i.test(m[1])){
      if(/^статус/.test(v)) return {bytes:[11,0,0], label:'статус станции'};
      if(/^ретранслятор/.test(v)){ const id=num(/ретранслятор\s*(\d+)/); if(id==null) return {error:'ретранслятор <номер> вкл | выкл (номера — в пульсе, когда маяк слышен)'}; const on=/вкл/.test(v)?1:/выкл/.test(v)?0:null; if(on==null) return {error:'ретранслятор '+id+': вкл | выкл'}; return {bytes:[29,on,id], label:`ретранслятор ${id}: ${on?'включить':'выключить'}`}; }
      if(/^турель/.test(v)){ const id=num(/турель\s*(\d+)/); if(id==null) return {error:'турель <номер> вкл | выкл (номера — в паспорте и пульсе)'}; const on=/вкл/.test(v)?1:/выкл/.test(v)?0:null; if(on==null) return {error:'турель '+id+': вкл | выкл'}; return {bytes:[28,on,id], label:`турель ${id}: ${on?'включить':'выключить'}`}; }
      if(/^выраст/.test(v)) return {bytes:[10,(v.includes('камер')?1:0)|(v.includes('лидар')?2:0),0], label:'вырастить'};
      if(/^пульс/.test(v)){ const iv=v.includes('выкл')?0:(num(/(\d+)/)??2); return {bytes:[15,iv,0], label:'пульс станции '+iv+' с'}; }
      if(/^кадр/.test(v)) return {bytes:[3,this.level(v),0,v.includes('дельт')?1:0], label:'кадр камеры шлюза'};
      if(/^автосъемк/.test(v)){ const iv=v.includes('выкл')?0:(num(/(\d+)\s*с/)??num(/каждые\s*(\d+)/)??30); return {bytes:[16,iv,0,this.level(v),v.includes('дельт')?1:0], label:'автосъёмка шлюза'}; }
      return {error:'станция: статус | вырастить [камера] [лидар] | пульс каждые N | кадр [8|16|32|64] [дельта] | автосъёмка каждые N [32] [дельта] | выкл | турель <номер> вкл|выкл | ретранслятор <номер> вкл|выкл'}; }
    const unit=+m[2]; const u=this.units.get(unit); if(!u) return {error:`М${unit}: такого тела в пульсе станции нет`};
    const rest=v.replace(/^\S+\s*/,'');   // без глагола
    const tgt=()=>{ const xy=/(-?\d+(?:[.,]\d+)?)\s+(-?\d+(?:[.,]\d+)?)$/.exec(v); if(xy) return {x:+xy[1].replace(',','.'), y:+xy[2].replace(',','.')}; const k=this.findKnown(rest); return k?{x:k.x,y:k.y,name:k.name}:null; };
    const obj=()=>this.findKnown(rest);
    if(/^описан/.test(v)&&!/кажд|выкл/.test(v)) return {bytes:[1,0,unit], label:`М${unit} описание`};
    if(/^лидар/.test(v)&&!/кажд|выкл/.test(v)){ const t=num(/наклон\s*(-?\d+)/)??0; return {bytes:[2,Math.max(-45,Math.min(45,t))+90,unit], label:`М${unit} лидар`}; }
    if(/^кадр/.test(v)) return {bytes:[3,this.level(v),unit,v.includes('дельт')?1:0], label:`М${unit} кадр`};
    if(/^(идти|иди)/.test(v)){ const t=tgt(); if(!t) return {error:'идти: «идти 40 14» или «идти к штабелю» (объект из описания)'}; return {bytes:[6,0,unit,...coordBytes(t)], label:`М${unit} идти ${t.name||f1(t.x)+', '+f1(t.y)}`}; }
    if(/^смотр/.test(v)){ const t=tgt(); if(!t) return {error:'смотреть: точка или объект из описания'}; return {bytes:[18,0,unit,...coordBytes(t)], label:`М${unit} смотреть`}; }
    if(/^изуч/.test(v)){ const o=obj(); if(!o) return {error:'изучить: объект из описания (имя или id)'}; return {bytes:[19,o.id,unit], label:`М${unit} изучить ${o.name}`}; }
    if(/^(взаимодейств|действ|открой|включи)/.test(v)){ const o=obj(); if(!o) return {error:'взаимодействовать: объект из описания'}; return {bytes:[8,o.id,unit], label:`М${unit} взаимодействовать ${o.name}`}; }
    if(/^взять|^возьми/.test(v)){ const it=itemOf(v); if(!it) return {error:'взять: брикет / резак / камеру'}; if(/со склад/.test(v)) return {bytes:[21,it,unit,1], label:`М${unit} взять со склада ${ITEMS[it]}`}; const o=/\sиз\s/.test(v)?this.findKnown(v.replace(/^.*?\sиз\s/,'')):null; if(!o) return {error:'взять X из <контейнер> | взять X со склада'}; /* \b в JS не знает кириллицы — границы по пробелам */ return {bytes:[23,it,unit,o.id], label:`М${unit} взять ${ITEMS[it]} из ${o.name}`}; }
    if(/^(полож|сдать|сдай|брос)/.test(v)){ const it=itemOf(v); if(!it) return {error:'положить: брикет / резак / камеру / патроны'}; if(/^сда|на склад/.test(v)) return {bytes:[21,it,unit,0], label:`М${unit} сдать на склад ${ITEMS[it]}`}; if(/на грунт|^брос/.test(v)) return {bytes:[22,it,unit,0], label:`М${unit} сбросить ${ITEMS[it]}`}; const o=/\sв\s/.test(v)?this.findKnown(v.replace(/^.*?\sв\s/,'')):null; if(!o) return {error:'положить X в <контейнер> | на грунт | сдать X (склад)'}; return {bytes:[22,it,unit,o.id], label:`М${unit} положить ${ITEMS[it]} в ${o.name}`}; }
    if(/^(съесть|съешь|ешь)/.test(v)) return {bytes:[20,40,unit], label:`М${unit} съесть брикет`};
    if(/^режим/.test(v)){ const mode=/исслед/.test(v)?1:/отступ/.test(v)?3:/отдых/.test(v)?4:null; if(!mode) return {error:'режим: исследование | отступление | отдых'}; return {bytes:[7,mode,unit], label:`М${unit} режим ${MODES[mode]}`}; }
    if(/^стойк|^при контакте/.test(v)){ const st=/пассив/.test(v)?0:/бег/.test(v)?1:/бой/.test(v)?2:null; if(st==null) return {error:'стойка: пассивно | бегство | бой'}; return {bytes:[25,st,unit], label:`М${unit} стойка ${STANCES[st]}`}; }
    if(/^скрытн/.test(v)) return {bytes:[24,/выкл|нет|0/.test(v)?0:1,unit], label:`М${unit} скрытность`};
    if(/^(при потере|без несущей|инструкц)/.test(v)){ const a=/продолж/.test(v)?0:/стоп|стой/.test(v)?1:/шлюз/.test(v)?2:null; if(a==null) return {error:'при потере несущей: продолжать | стоп | к шлюзу'}; return {bytes:[26,a,unit], label:`М${unit} без несущей: ${AUTONOMY[a]}`}; }
    if(/^(передатчик|мощност)/.test(v)){ const d=num(/(-?\d+)/)??0; const p=d<=-5?-10:d>=5?10:0; return {bytes:[9,p+20,unit], label:`М${unit} передатчик ${p} дБм`}; }
    if(/^телеметр/.test(v)){ const iv=v.includes('выкл')?0:(num(/(\d+)/)??1); return {bytes:[12,iv,unit], label:`М${unit} телеметрия ${iv?'каждые '+iv+' с':'выкл'}`}; }
    if(/^лидар/.test(v)){ const iv=v.includes('выкл')?0:(num(/(\d+)/)??10); return {bytes:[13,iv,unit], label:`М${unit} лидар ${iv?'каждые '+iv+' с':'выкл'}`}; }
    if(/^описан/.test(v)){ const iv=v.includes('выкл')?0:(num(/(\d+)/)??15); return {bytes:[14,iv,unit], label:`М${unit} описание ${iv?'каждые '+iv+' с':'выкл'}`}; }
    if(/^автосъемк/.test(v)){ const iv=v.includes('выкл')?0:(num(/(\d+)\s*с/)??num(/каждые\s*(\d+)/)??30); return {bytes:[16,iv,unit,this.level(v),v.includes('дельт')?1:0], label:`М${unit} автосъёмка ${iv?'каждые '+iv+' с':'выкл'}`}; }
    if(/^стоп|^стой/.test(v)) return {bytes:[17,0,unit], label:`М${unit} стоп`};
    // именные команды объекта, как их показывает описание («вскрыть ящик», «переключить ретранслятор», «прочитать запись планшет», «заправить турель патроны»):
    // это то же «взаимодействовать» — что именно сделать, мир выбирает по состоянию объекта; «заправить: X» — «положить X в объект»
    { const verb=stem(v.split(/\s+/)[0]); const o=obj(); if(o&&o.cls===0){ const own=o.type===34?(this.station.turrets||[]).some(T=>T.id===o.id):undefined;
        const hit=objCmds(o.type||0,o.state||0,{own}).find(c=>stem(c.label.split(/[:\s]/)[0])===verb);
        if(hit&&hit.kind==='fill') return {bytes:[22,hit.item,unit,o.id], label:`М${unit} положить ${ITEMS[hit.item]} в ${o.name}`};
        if(hit) return {bytes:[8,o.id,unit], label:`М${unit} взаимодействовать ${o.name} (${hit.label})`}; } }
    return {error:'не понял; знаю: описание, лидар [наклон N], кадр [8|16|32|64] [дельта], идти X Y | идти к <объект>, смотреть …, изучить <объект>, взаимодействовать <объект>, взять <вещь> из <контейнер> | со склада, положить <вещь> в <контейнер> | на грунт, сдать <вещь>, съесть брикет, режим …, стойка …, скрытность вкл|выкл, при потере несущей …, передатчик -10|0|10, телеметрия|лидар|описание каждые N|выкл, автосъёмка каждые N [32] [дельта]|выкл, стоп'};
  }
  level(v){ const r=/\b(8|16|32|64)\b/.exec(v); return r?[8,16,32,64].indexOf(+r[1]):2; }
  findKnown(v){ const id=/\[?\b(\d{1,3})\]?\s*$/.exec(v.trim()); if(id&&this.known.has(+id[1])) return this.known.get(+id[1]);
    const words=v.trim().replace(/^(к|на|в)\s+/,'').split(/[\s,]+/).filter(w=>w.length>2); if(!words.length) return null;
    const ws=words.map(stem); let best=null, bs=0;   // сколько слов фразы нашлось в имени; все слова имени покрыты — плюс: «ящик» раньше «штабеля ящиков», «вскрытый ящик» — по двум словам
    for(const k of this.known.values()){ const nw=k.name.split(' ').map(stem); const hit=(a,b)=>a.startsWith(b)||b.startsWith(a); const matched=ws.filter(w=>nw.some(n=>hit(n,w))).length; if(!matched) continue;
      const sc=matched*2+(nw.every(n=>ws.some(w=>hit(n,w)))?1:0); if(sc>bs||(sc===bs&&(k.name.length<best.name.length||(k.name.length===best.name.length&&k.at>best.at)))){ best=k; bs=sc; } } return best; }
}
module.exports={OpConsole};

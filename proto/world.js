// МИР. Web Worker. Ничего не знает о консоли.
// Наружу: (а) байтовые сообщения для канала, (б) физика линии по каждому миссионеру.
const LAB=/&lab\b/.test(self.location.search);   // лаборатория лидара: одичалые спят, тело не умирает; остальное — как в игре
const VER=self.location.search.replace(/^\?v=/,'').replace(/&.*$/,'')||'0'; importScripts('level.js?v='+VER,'codebook.js?v='+VER,'terrain.js?v='+VER,'camera.js?v='+VER);
const NST=Math.max(1,Math.min(LEVEL.stations.length,+(/&st=(\d+)/.exec(self.location.search)||[])[1]||1));   // сколько платформ поднято: решает хост (одиночная игра — одна)
const TEAMS=((/&teams=([\d,]+)/.exec(self.location.search)||[])[1]||'').split(',').map(Number);   // команда каждой платформы (кто с кем): нет — все в одной; одичалые всегда сами за себя
const teamOf=k=>TEAMS[k]||0;
CAM.load(VER);   // атлас спрайтов грузится асинхронно; до загрузки объекты в кадре — серые блоки

const DT = 0.1;
let speed = 1, msgId = 1, t = 0;

// ---------- геометрия: уровень (level.js) ----------
// Ориентиры: id = тип из кодовой книги; подобъект получает id = id ориентира·10 + индекс, положение — смещение от ориентира, курс — из уровня (нет — по хешу id).
const POIS = LEVEL.pois.map(p=>({ id:p.id, x:p.x, y:p.y, subs:p.subs.map(s=>[s.type,s.dx,s.dy,s.f===undefined?undefined:s.f*Math.PI/180]) }));
function poi(id){ return POIS.find(p=>p.id===id); }
// видимость по расщелине — из геометрии: ориентир внутри расщелины (вход, глубина) виден изнутри; глубокий (дальше 5 % пути) снаружи — только у входа
function poiInCanyon(p){ return !!TER.inside(p.x,p.y); }
function poiDeep(p){ return tunnelT(p.x,p.y)>0.05; }
const TUN_A = TER.CANYON.pts[0];                                             // вход в расщелину (ориентир 6)
// ---------- станции: посадочные платформы из уровня, по одной на оператора (или одна на всех — кооператив) ----------
// У каждой — свой запас, склад, выращивание, задача, пульс, стационарная камера и канал (у хоста); тела помечены станцией (u.st).
// Общее — мир: рельеф, ориентиры, предметы, одичалые, мачта с усилителем. Шлюз станции — ориентир id 240+k, его подобъекты — 160+k·4+i.
const stations = LEVEL.stations.slice(0,NST).map((L,k)=>{ const ang=(L.ang||0)*Math.PI/180; const a={x:L.airlock.x,y:L.airlock.y};
  const dx=a.x-L.x, dy=a.y-L.y, d=Math.hypot(dx,dy)||1, ox=dx/d, oy=dy/d;   // наружу — от центра корпуса к шлюзу
  return { k, name:'ARK-04'+(1+k), x:L.x, y:L.y, ang, spawn:{...L.spawn}, airlock:a,
    subs:L.subs.slice(0,4).map(s=>[s.type,s.dx,s.dy,s.f===undefined?undefined:s.f*Math.PI/180]),
    bioStock:4, camInv:0, store:{40:0,41:0}, power:100, growing:null, taskOpen:true, hbTimer:0, hbInterval:2, team:teamOf(k),
    turret:(()=>{ const i=L.subs.findIndex(s=>s.type===34); if(i<0||i>3) return null; const s=L.subs[i], c=s.turret||{}; return { id:160+k*4+i, x:a.x+s.dx, y:a.y+s.dy, ang:(s.f===undefined?0:s.f)*Math.PI/180, fov:(c.fov||120)*Math.PI/180, range:c.range||60, aim:c.aim||3, reload:c.reload||10, aimT:0, reloadT:0, tgt:null }; })(),
    // стационарная камера у шлюза: смотрит от люка наружу, сигнала не требует — она на станции
    cam:{ id:0, st:k, x:a.x-4*ox, y:a.y-4*oy, heading:Math.atan2(oy,ox), goal:{x:a.x+44*ox-8*oy,y:a.y+44*oy+8*ox}, lightOn:true, charge:100, alive:true, lastImg:{}, pendingImg:null, frameNo:0, sensors:{camera:true}, sub:{img:{interval:0,level:2,delta:true}}, subT:{img:0}, items:[] } }; });
const SPOIS = stations.map(S=>({ id:240+S.k, x:S.airlock.x, y:S.airlock.y, subs:S.subs, station:S, idBase:160+S.k*4 }));
function stOf(u){ return stations[u.st]||stations[0]; }
// ПС-2, радиус гарантированного возврата: цель дальше RETURN_R от ближайшего узла (своя станция, работающий ретранслятор) станция не принимает —
// потеря биоматериала гарантирована. Бюджет линии (дБ) к границе не привязан: далеко уйти можно, если есть узел
const RETURN_R = 500;
const LINK_LOST_S = 5;   // столько секунд без несущей — потеря связи: тело исполняет инструкцию (команда 26). Секундный провал за камнем — ещё нет
function nodes(S){ const n=[{x:S.x,y:S.y}]; if(antennaBoost) n.push(poi(3)); return n; }   // ретранслятор — мачта (ориентир 3) с включённым усилителем
function nodeDist(S,p){ return Math.min(...nodes(S).map(n=>dist(p,n))); }
function beyondReturn(u,p){ const d=nodeDist(stOf(u),p); if(d<=RETURN_R) return false; evt(28,u.id,Math.min(255,Math.ceil(d/10))); note('station',{st:u.st,unit:u.id,refuse:'ПС-2',d:+d.toFixed(0),nodes:nodes(stOf(u)).length}); return true; }   // отказ: arg — расстояние до узла, десятки метров
const HULLS = [ ...stations.map(S=>({x:S.x,y:S.y,rx:STATION.rx,ry:STATION.ry,ang:S.ang,h:STATION.h})), ...LEVEL.hulls.map(h=>({...h})) ];   // корпуса платформ (эллипс из кодовой книги), корпуса уровня (круги: обломки): непроходимы и отражают лидар; остальное — рельеф
// точка внутри корпуса (с запасом pad); луч в корпус: эллипс приводится к единичному кругу, параметр t — в метрах по лучу
function hullIn(x,y,c,pad=0){ if(c.r!==undefined) return Math.hypot(x-c.x,y-c.y)<c.r+pad; const ca=Math.cos(c.ang), sa=Math.sin(c.ang), lx=(x-c.x)*ca+(y-c.y)*sa, ly=-(x-c.x)*sa+(y-c.y)*ca; return (lx/(c.rx+pad))**2+(ly/(c.ry+pad))**2<1; }
function rayHull(ox,oy,dx,dy,c){ if(c.r!==undefined) return rayCircle(ox,oy,dx,dy,c); const ca=Math.cos(c.ang), sa=Math.sin(c.ang); const fx=((ox-c.x)*ca+(oy-c.y)*sa)/c.rx, fy=(-(ox-c.x)*sa+(oy-c.y)*ca)/c.ry, ex=(dx*ca+dy*sa)/c.rx, ey=(-dx*sa+dy*ca)/c.ry;
  const a=ex*ex+ey*ey, b=2*(fx*ex+fy*ey), cc=fx*fx+fy*fy-1, D=b*b-4*a*cc; if(D<0) return Infinity; const s=Math.sqrt(D), t1=(-b-s)/(2*a), t2=(-b+s)/(2*a); if(t1>0) return t1; if(t2>0) return t2; return Infinity; }
// t ∈ [0,1] — доля пути вглубь расщелины, −1 — снаружи. Дальше от входа — глубже, сильнее затухание радио
function tunnelT(x,y){ const c=TER.inside(x,y); return c && c.along>0 ? Math.min(1,c.along/TER.LEN) : -1; }
function inCorridor(x,y,margin=0){ return !!TER.inside(x,y,margin); }
// затухание радио в расщелине, дБ: 8 у входа + 22 к концу; у стены и у входа — плавно за 2 м, а не скачком (тело, скользящее вдоль
// стены, иначе теряло и ловило несущую каждый такт)
function obstDb(u){ const c=TER.canyon(u.x,u.y); if(c.along<=0 || c.d>=c.w/2+1) return 0; const k=Math.min(1,(c.w/2+1-c.d)/2)*Math.min(1,c.along/2); return k*(8+22*Math.min(1,c.along/TER.LEN)); }
function dist(a,b){ return Math.hypot(a.x-b.x,a.y-b.y); }
function bearingDeg(from,to){ return (Math.atan2(to.y-from.y,to.x-from.x)*180/Math.PI+360)%360; }

// ---------- состояние ----------
function atAirlock(u){ return u.alive && dist(u,stOf(u).airlock)<12; }   // у шлюза своей станции
const objState = {};                       // id объекта → состояние (по умолчанию 0); начальные — из уровня
function stateOf(id){ return objState[id]||0; }
const contents = {};                        // содержимое контейнеров: id объекта → предметы; начальное — из уровня
for(const p of LEVEL.pois) p.subs.forEach((s,i)=>{ const id=p.id*10+i; if(s.state) objState[id]=s.state; if(s.items&&s.items.length) contents[id]=s.items.slice(); });
LEVEL.stations.slice(0,NST).forEach((L,k)=>L.subs.slice(0,4).forEach((s,i)=>{ const id=160+k*4+i; if(s.state) objState[id]=s.state; if(s.items&&s.items.length) contents[id]=s.items.slice(); }));
const ground = [];                          // свёртки на грунте: {id, x, y}; id 100…199
let nextGround = 100;
// изъять предмет из контейнера (тело — камера отдельно; пустой свёрток исчезает); свёрток на грунт — предмет под ногами
function removeItem(o,item){ if(o.unit){ const v=o.unit; if(item===42){ v.sensors.camera=false; v.sub.img.interval=0; } else v.items.splice(v.items.indexOf(item),1); }
  else { const arr=contents[o.id]; arr.splice(arr.indexOf(item),1); if(o.type===33&&!arr.length){ const gi=ground.findIndex(g=>g.id===o.id); if(gi>=0){ ground.splice(gi,1); delete contents[o.id]; } } } }   // свёрток уровня (не из ground) пустым остаётся
function dropBundle(x,y,item){ const g={id:nextGround++, x:Math.round(x), y:Math.round(y)}; if(nextGround>199) nextGround=100; ground.push(g); contents[g.id]=[item]; return g; }
function isContainer(o){ if(o.unit) return !o.unit.alive; const cb=CODEBOOK[o.type]; return !!cb && cb.container!==undefined; }
function containerOpen(o){ if(o.unit) return true; const cb=CODEBOOK[o.type]; return stateOf(o.id)>=cb.container; }
function contentsOf(o){ if(o.unit){ const v=o.unit; return [...(v.sensors.camera?[42]:[]), ...v.items]; } return contents[o.id]||[]; }
const units = []; let nextUnit = 1;
function spawn(sensors,S){
  const u = { id:nextUnit++, st:S.k, alive:true, x:S.spawn.x, y:S.spawn.y, heading:0, target:null, mode:1, stealth:false, stance:0, reflex:0, lightOn:true,
    pulse:72, glucose:92, electro:96, toxin:0, skin:100, bone:100, psyche:88, charge:100, gen:0.8, cons:1.0,
    fear:0, pain:0, exertion:0, txDbm:0, dmgTimer:0, atkTimer:0,
    sensors:{ camera:!!sensors.camera, sonar:!!sensors.sonar },
    tlmTimer:Math.random(), carrier:true, carrierNoted:true, linkLostFor:0, autoDone:false, autonomy:0,
    sub:{ tlm:1, sonar:0, desc:0, img:{interval:0,level:2,delta:true} }, goal:null, items:[], pending:null, subT:{ sonar:0, desc:0, img:0 }, lastImg:{}, pendingImg:null, frameNo:0 };
  units.push(u); return u;
}
for(const S of stations) spawn({camera:true, sonar:true},S);          // первый миссионер каждой станции уже готов и несёт её единственную камеру
let antennaBoost = 0;

// Режим (mode) — команда: 1 исследование, 3 отступление, 4 отдых. Скрытность (stealth) и стойка при контакте (stance: 0 пассивно,
// 1 бегство, 2 бой) — настройки, хранятся на теле. Рефлекс (reflex: 0 нет, 5 бой, 6 бегство) — что тело делает сейчас по стойке;
// пока он идёт, скрытность не действует: свет включён, шаг обычный. Всё это — в байте 15 телеметрии (tech.md §5).
function speedFor(u){ if(u.reflex===6) return 2.6; if(u.reflex===5) return 0; if(u.stealth) return u.mode===4?0:0.6; return u.mode===3?2.6 : u.mode===4?0 : 1.4; }
function detectRadius(u){ return !u.lightOn?6 : u.mode===4?35 : 70; }   // без фонаря почти не замечает: идёт на свет
function modeByte(u){ return (u.mode&7)|(u.stealth?8:0)|((u.stance&3)<<4)|(u.reflex===5?64:u.reflex===6?128:0); }

// ---------- одичалые (design.md §12а) ----------
// Стая — бывшие миссионеры без голоса в голове: тела те же, живут рефлексами. Черты из уровня: size (размер), courage (храбрость),
// attention (внимательность); состояние: fear, tired, hp, act. Мир не знает, кто за них играет: агент (потом) даёт намерения
// через ту же `p.target`, рефлексы остаются. Стая одна на мир — чужие для всех платформ.
const LAIR = {...LEVEL.pack.lair};
const pack = LEVEL.pack.members.slice(0,10).map((m,i)=>({ i, x:m.x, y:m.y, home:{x:m.x,y:m.y}, heading:0, size:m.size, courage:m.courage, attention:m.attention,
  hpMax:Math.max(1,Math.round(3*m.size)), hp:Math.max(1,Math.round(3*m.size)), fear:0, tired:0, act:'sleep', target:null, foe:null,
  rest:0, throat:0, freezeT:0, hold:0, rage:0, alert:0, idle:0, hitT:0, stuckT:0, heard:{}, lastAct:'sleep', why:'' }));
const cries = [];   // крики за последние секунды: {word, x, y, t, i} — для рефлексов и шторки
// действующая храбрость: страх, раны и удалённость от логова отнимают, размер добавляет
function nerve(p){ return p.courage + 0.15*(p.size-1) - 0.6*p.fear - 0.5*(1-p.hp/p.hpMax) - 0.3*Math.max(0,(dist(p,LAIR)-120)/150); }
function foeOf(p){ return p.foe && t-p.foe.t<20+60*(1-p.courage) ? p.foe : null; }   // чужой, которого видела или слышала недавно: 20 с, пугливые помнят до 80
function dirTo(a,b){ return Math.atan2(b.y-a.y,b.x-a.x); }
// доля отрезка a→b, закрытая рельефом или корпусом (луч на высоте h над концами): 0 — чисто, 1 — стена. Одна функция для зрения, слуха и крика
function losFrac(a,b,h=1.2,hb=h){ const d=dist(a,b); if(d<3) return 0; const n=Math.min(40,Math.ceil(d/2.5)); const za=TER.H(a.x,a.y)+h, zb=TER.H(b.x,b.y)+hb; let hit=0;
  for(let i=1;i<n;i++){ const k=i/n, x=a.x+(b.x-a.x)*k, y=a.y+(b.y-a.y)*k; if(TER.H(x,y)>za+(zb-za)*k || HULLS.some(c=>hullIn(x,y,c))) hit++; } return hit/(n-1); }
// шаг особи к цели: те же столкновения, что у тела; в расщелине — вдоль оси (поиска пути нет, колена обходятся по оси)
function packStep(p,sp){ const tg=p.target; if(!tg) return; let aim=tg; const cp=TER.inside(p.x,p.y), ct=TER.inside(tg.x,tg.y);
  const root=TER.CANYON.branch.pts[0], rootA=TER.canyon(root.x,root.y).along;
  if(cp && cp.along>0){ if(cp.branch){ if(!ct||!ct.branch) aim=dist(p,root)>4?root:tg; }
    else { const a=!ct?-8:ct.branch?rootA:ct.along; if(Math.abs(a-cp.along)>6){ const q=TER.canyonPoint(Math.max(0,Math.min(1,(cp.along+(a>cp.along?5:-5))/TER.LEN))); aim=q; } } }
  else if(ct && ct.along>0 && dist(p,TUN_A)>4) aim=TUN_A;
  p.heading=dirTo(p,aim); if(stepBody(p,sp*DT)) p.stuckT=0; else { p.stuckT+=DT; if(p.stuckT>3){ p.stuckT=0; p.target=null; if(p.told){ say(p,'не пройти, стою'); } } } }
// крик: слово = реакция. Слышат особи в радиусе с затуханием за стенами; кулдаун на глотку. Тела рядом вздрагивают — звук, слов не разбирают
function cry(p,word){ if(p.throat>0) return false; p.throat=6; cries.push({word,x:p.x,y:p.y,t,i:p.i}); const R=120*(0.8+0.4*p.size); const heard=[];
  for(const q of pack){ if(q===p||q.act==='dead') continue; const d=dist(p,q); if(d>R) continue; const loud=(1-d/R)*(1-0.7*losFrac(p,q,1.5)); if(loud>0.05) heard.push([q,loud]); }
  note('cry',{who:p.i,word,x:+p.x.toFixed(1),y:+p.y.toFixed(1),heard:heard.map(([q])=>q.i)}); say(p,`кричу «${word}»`);
  for(const [q,loud] of heard) hear(q,word,p,loud);   // заметка раньше реакций: эхо в логе идёт после крика
  for(const u of units){ if(!u.alive) continue; const d=dist(p,u); if(d>R) continue; const loud=(1-d/R)*(1-0.7*losFrac(p,u,1.5)); u.startle=Math.min(1,(u.startle||0)+0.6*loud); }
  return true; }
function hear(q,word,from,loud){ const ce=nerve(q); q.heard[word]=t; const why=`«${word}» от #${from.i}, слышно ${loud.toFixed(2)}, nerve ${ce.toFixed(2)}`; if(q.act==='sleep'&&loud>0.25) wake(q,why); q.why=why;
  const src={x:from.x,y:from.y}; const toward=(d)=>{ const L=dist(q,src); return L<=d?null:{x:src.x+(q.x-src.x)*d/L, y:src.y+(q.y-src.y)*d/L}; };
  q.hold=15;   // реакция держится, пока особь сама не увидит чужого или не дойдёт
  if(word==='тревога'){ q.fear=Math.min(1,q.fear+0.25*(1-q.courage)*loud); if(ce<0.3){ q.act='flee'; q.target={...LAIR}; } else if(ce<0.6){ q.act='freeze'; q.freezeT=10; q.target=null; q.heading=dirTo(q,src); } else { q.heading=dirTo(q,src); q.alert=20; }
    if(ce<0.35 && Math.random()<0.5 && !(t-(q.heard.echo||-99)<15)){ q.heard.echo=t; cry(q,'тревога'); } }   // эхо по стае — так весть идёт дальше радиуса одной глотки
  else if(word==='чужой'){ q.alert=20; if(ce<0.3){ if(dist(q,LAIR)>3){ q.act='flee'; q.target={...LAIR}; } } else if(ce<0.6){ q.act='goto'; q.target=toward(20); } else { q.act='goto'; q.target=src; } }   // к крикнувшему, не к чужому: крик несёт направление источника
  else if(word==='сюда'){ if(ce<0.5 || Math.random()<0.5){ q.act='goto'; q.target=toward(3); } }
  else if(word==='бей'){ if(ce>=0.6 && foeOf(q)) q.rage=15; else q.fear=Math.min(1,q.fear+0.2); }
  else if(word==='домой'){ if(!(q.rage>0 && q.act==='attack')){ q.act='home'; q.target={...LAIR}; } }
  else if(word==='добыча'){ if(ce>=0.3 && ce<0.7){ q.act='goto'; q.target=toward(3); } } }
function wake(p,why='проснулась'){ if(p.act==='sleep'){ p.act='idle'; p.idle=0; p.why=why; } }
// чувства: свет фонаря (в скрытности — почти ничего), шаги; спящая слышит и видит хуже, внимательная — дальше; стены режут и то и другое
function sense(p){ const k=(p.act==='sleep'?0.2+0.3*p.attention:0.6+0.8*p.attention)*(p.alert>0?1.4:1); let best=null, bd=1e9, how='see';
  for(const u of units){ if(!u.alive) continue; const d=dist(p,u); if(d>120 || d>=bd) continue;
    const seeR=detectRadius(u)*k, sp=u.target?speedFor(u):0, hearR=Math.min(80,12*sp*sp)*k;   // шум шагов ∝ квадрату скорости: крадущегося слышно с 4 м, бегущего — с 80 if(d>seeR && d>hearR) continue;
    const f=losFrac(p,u); if(d<=seeR && f<0.34 || d<=hearR*(1-0.75*f)){ best=u; bd=d; how=d<=seeR&&f<0.34?'see':'hear'; } }
  if(!best) return; const fresh=!foeOf(p); p.foe={x:best.x,y:best.y,t,u:best.id,how}; wake(p);
  if(fresh){ note('pack',{who:p.i,sense:bd<=detectRadius(best)*k?'see':'hear',unit:best.id,d:+bd.toFixed(1),mode:best.mode,stealth:best.stealth,light:best.lightOn,nerve:+nerve(p).toFixed(2)}); const ce=nerve(p); if(ce<0.35) cry(p,'тревога'); else if(Math.random()<0.25+0.7*p.attention) cry(p,'чужой'); } }
// рефлексы раз в полсекунды: по действующей храбрости и расстоянию до чужого
function decide(p){ const ce=nerve(p), foe=foeOf(p), d=foe?dist(p,foe):1e9, atLair=dist(p,LAIR)<3;
  if(p.lit!==undefined && t-p.lit<0.6 && ce<0.6){ const T=stations.map(S=>S.turret).find(T=>T&&T.tgt&&T.tgt.p===p.i); if(T){ if(p.act!=='flee'||p.why!=='луч'){ p.fear=Math.min(1,p.fear+0.2*(1-p.courage)); p.act='flee'; p.told=null; p.hold=10; const L=dist(p,T)||1; p.target={x:p.x+(p.x-T.x)*40/L, y:p.y+(p.y-T.y)*40/L}; p.why='луч'; if(ce<0.35) cry(p,'тревога'); } return; } }   // луч на мне: пугливая бежит от света (не к логову — прочь) и ни на что не отвлекается, пока луч на ней; храбрая идёт дальше
  if(foe && d<10) p.fear=Math.min(1,p.fear+0.015*(1-p.courage)); p.fear=Math.max(0,p.fear-(atLair||p.rest>0?0.01:0.004));
  if(p.act==='attack') p.tired=Math.min(1,p.tired+0.006); else p.tired=Math.max(0,p.tired-0.01);
  if(p.rest>0){ p.rest-=0.5; if(atLair && p.hp<p.hpMax){ p.heal=(p.heal||0)+0.5; if(p.heal>=40){ p.heal=0; p.hp++; } } p.why=`передышка ${p.rest.toFixed(0)} с`; if(foe && d<2.5){ p.act='attack'; p.why='зажали у логова'; } else if(atLair){ p.act='rest'; p.target=null; } else { p.act='home'; p.target={...LAIR}; } return; }   // передышка: не выходит; зажали — огрызается
  if(p.act==='freeze'){ p.freezeT-=0.5; if(p.freezeT>0){ if(foe) p.heading=dirTo(p,foe); return; } p.act='idle'; }
  if(p.act==='goto' && p.target){ if(dist(p,p.target)<2) { p.target=null; if(p.told) say(p,'дошёл'); p.act=p.told?'stay':'idle'; p.why='пришла'; } else if(!foe || d>15) return; }   // намерение держится, пока чужой не рядом
  if(!foe && p.hold>0){ p.hold-=0.5; if(p.act==='flee' && atLair){ p.hold=0; p.rest=60+60*Math.random(); p.why='прибежала на крик, чужого не видела'; } else if(!p.target || dist(p,p.target)>2) return; }   // по слову: бежит/идёт, пока не дошла
  if(!foe){ if(p.hp<p.hpMax){ p.heal=(p.heal||0)+0.5; if(p.heal>=120){ p.heal=0; p.hp++; } } if(p.act==='sleep') return; if(p.told){ if(p.act!=='stay'){ p.act='stay'; p.target=null; p.why='жду, как сказано'; } return; } p.idle+=0.5; let next; if(dist(p,p.home)>2){ next='home'; p.target={...p.home}; } else { next=p.idle>90?'sleep':'idle'; p.target=null; }
    if(next!==p.act){ p.act=next; p.why=next==='sleep'?'покой 90 с':'чужого нет 20 с'; } return; }
  p.idle=0; p.why=`nerve ${ce.toFixed(2)}, d ${d.toFixed(1)}`;
  if(ce<0.3){ if(d<2.5 && atLair){ p.act='attack'; return; } p.act='flee'; if(atLair){ p.target=null; p.rest=90+90*Math.random(); if(p.hp<p.hpMax) cry(p,'домой'); } else p.target={...LAIR}; return; }   // передышка 90…180 с: стая не ходит по часам
  if(ce<0.6 && !(p.act==='attack' && ce>=0.5)){ if(d<2.5){ p.act='attack'; return; } const b=d<12?backOff(p,foe):null; if(b){ p.act='back'; p.target=b; } else { p.act='freeze'; p.freezeT=4; p.target=null; p.heading=dirTo(p,foe); } return; }   // начатую драку бросает позже, чем не начинает; вплотную — огрызается
  if(p.tired>0.8){ p.why='устала'; p.act='freeze'; p.freezeT=6; p.target=null; p.heading=dirTo(p,foe); return; }
  if(ce>=0.8 || d<2.5 || p.rage>0){ if(p.rage>0) p.why+=', «бей»'; p.act='attack'; p.target={x:foe.x,y:foe.y}; return; }
  const L=Math.max(d,0.1); p.act='approach'; p.target=d>9?{x:foe.x+(p.x-foe.x)*8/L, y:foe.y+(p.y-foe.y)*8/L}:null; if(!p.target) p.heading=dirTo(p,foe); }   // на расстояние: подходит на 8 м и смотрит
function packSpeed(p){ const v=p.act==='flee'?2.0 : p.act==='attack'?1.1*(0.7+0.3*p.size) : p.act==='back'?1.5 : p.act==='home'?1.0 : 0.8; return p.item?v*Math.min(1,0.5+0.3*p.size):v; }   // с ношей медленнее, мелкому тяжелее
// отойти от чужого на 10 м: в расщелине — по оси в сторону от него (в тупике отходить некуда — null, тогда стоит и огрызается), снаружи — прямо от него
function backOff(p,foe){ const cp=TER.inside(p.x,p.y); if(cp && cp.along>0 && !cp.branch){ const fa=TER.canyon(foe.x,foe.y).along, a=cp.along+(cp.along>=fa?10:-10); if(a>TER.LEN-1) return null; return TER.canyonPoint(Math.max(0,a)/TER.LEN); }
  const L=dist(p,foe)||1; return {x:p.x+(p.x-foe.x)*10/L, y:p.y+(p.y-foe.y)*10/L}; }
function packTick(){ 
  for(const p of pack){ if(p.act==='dead') continue; p.throat=Math.max(0,p.throat-DT); p.alert=Math.max(0,p.alert-DT); p.rage=Math.max(0,p.rage-DT);
    if(!LAB && (Math.floor(t/DT)+p.i)%5===0){ sense(p); decide(p); if(p.told && (p.act==='flee'||p.act==='home'||p.act==='rest')) p.told=null; perceive(p); if(p.act!==p.lastAct){ const f=foeOf(p); note('pack',{who:p.i,act:p.act,was:p.lastAct,why:p.why,hp:p.hp,fear:+p.fear.toFixed(2),foe:f?f.u:undefined,x:+p.x.toFixed(1),y:+p.y.toFixed(1)}); p.lastAct=p.act; } }
    if(p.act==='attack'){ const foe=foeOf(p); const u=foe&&units.find(u=>u.id===foe.u&&u.alive&&dist(p,u)<30); if(u){ const d=dist(p,u); p.foe={x:u.x,y:u.y,t,u:u.id};   // цель в 30 м не теряет — ведёт её; дальше — только если чувства поймают снова
        if(d>2.2){ p.target={x:u.x,y:u.y}; p.hitT=0; } else { p.target=null; p.heading=dirTo(p,u); p.hitT+=DT; if(p.hitT>2){ p.hitT=0; u.skin-=10*p.size; u.bone-=4*p.size; u.pain=1; u.psyche-=6; u.bitAt=t; u.bitBy=p; evt(4,u.id); say(p,'укусил двуногого'); note('pack',{who:p.i,bite:u.id,skin:+u.skin.toFixed(0),bone:+u.bone.toFixed(0),reflex:u.reflex,stance:u.stance}); } } } }
    if(p.target) packStep(p,packSpeed(p)); }
  while(cries.length && t-cries[0].t>6) cries.shift(); }
// отпор резаком: тело в рефлексе «бой» бьёт ближайшую особь в 4 м раз в 2 с; на нуле она уходит в логово на передышку
// Стойка при контакте — рефлекс тела, канал для него слишком медленный. Контакт — глазами тела, без стены между, или укус за
// последние 3 с. Для бегства — любая бодрствующая особь в 15 м при фонаре (4 без): увидел — побежал. Для боя — угроза: особь идёт
// на тело или нападает в 8 м, либо любая вплотную (3 м); смотрящая с 12 м — не повод. Бой: тело стоит и бьёт, пока чужой в
// досягаемости; 10 с без угрозы — продолжает задачу. Бегство: к ближайшему узлу (шлюз своей платформы, мачта с усилителем), пока
// чужих не видно 20 с, потом стоит.
function contact(u,threat){ if(u.bitAt!==undefined && t-u.bitAt<3) return u.bitBy; const R=threat?8:u.lightOn?15:4; let best=null, bd=R;
  for(const p of pack){ if(p.act==='sleep'||p.act==='dead') continue; const d=dist(u,p); if(d>=bd) continue; if(threat && d>3 && p.act!=='attack' && p.act!=='approach') continue; if(losFrac(u,p)<0.34){ bd=d; best=p; } } return best; }
function nearestNode(u){ const S=stOf(u); let best={x:S.spawn.x,y:S.spawn.y}, bd=dist(u,best); if(antennaBoost){ const m=poi(3); const d=dist(u,m); if(d<bd){ best={x:m.x,y:m.y}; bd=d; } } return best; }
function stanceTick(u,dt){
  if(!u.reflex){ if(!u.stance) return; const c=contact(u,u.stance===2); if(!c) return;
    if(u.stance===2){ u.reflex=5; u.savedTarget=u.target; u.target=null; u.lastContact=t; evt(29,u.id); note('unit',{unit:u.id,reflex:'бой',who:c.i,d:+dist(u,c).toFixed(1),stealth:u.stealth}); }
    else { u.reflex=6; u.pending=null; u.target=null; const n=nearestNode(u); u.goal={...n}; u.lastContact=t; evt(30,u.id); note('unit',{unit:u.id,reflex:'бегство',who:c.i,d:+dist(u,c).toFixed(1),to:n}); }
    return; }
  if(contact(u,u.reflex===5)) u.lastContact=t;
  if(u.reflex===5 && t-u.lastContact>10){ u.reflex=0; u.target=u.savedTarget||null; u.savedTarget=null; evt(31,u.id); note('unit',{unit:u.id,reflex:'конец боя',resume:!!u.target}); }
  if(u.reflex===6){ const n=nearestNode(u);
    if(t-u.lastContact>20 || dist(u,n)<3){ u.reflex=0; u.target=null; evt(34,u.id); note('unit',{unit:u.id,reflex:'конец бегства',x:+u.x.toFixed(0),y:+u.y.toFixed(0)}); return; }
    // бежит по точкам: в расщелине — по оси к выходу (как одичалые), снаружи — к узлу; новая точка, когда прежняя близко
    if(!u.target || dist(u,u.target)<3){ const c=TER.canyon(u.x,u.y); u.stuck=0; u.bestD=undefined;
      const a=c.along-8; if(c.d<c.w/2+4 && c.along>-50) u.target = a>0 ? TER.canyonPoint(a/TER.LEN) : {x:TUN_A.x+c.dir.x*a, y:TUN_A.y+c.dir.y*a};   // по оси расщелины, у входа и на подходе — вдоль направления входа наружу
      else u.target={...n}; } }
}
function fightBack(u){ let q=null, qd=4; for(const p of pack){ if(p.act==='dead') continue; const d=dist(u,p); if(d<qd){ qd=d; q=p; } } if(!q){ u.atkTimer=0; return; }
  u.atkTimer+=DT; if(u.atkTimer<2) return; u.atkTimer=0; const was=q.hp; q.hp=Math.max(0,q.hp-1); q.fear=Math.min(1,q.fear+0.35*(1.2-q.courage)); wake(q); q.foe={x:u.x,y:u.y,t,u:u.id};
  say(q,'двуногий ударил меня'); note('pack',{who:q.i,hitBy:u.id,hp:q.hp,fear:+q.fear.toFixed(2),nerve:+nerve(q).toFixed(2)});
  if(nerve(q)<0.5) cry(q,'тревога');
  if(was>0 && q.hp===0){ q.act='flee'; q.target={...LAIR}; q.rage=0; evt(9,u.id); } }

// ---------- агент стаи: восприятие и намерения (design.md §12а, roadmap п. 0б (в)) ----------
// Одна ось вместо режимов: VOICE_R — радиус голоса стаи, кому доходит слово агента и чьё восприятие приходит. Бесконечность —
// «единый мозг»: агент слышит каждую особь и говорит с каждой; конечный радиус — вожак и крики (потом, тем же кодом).
// Текст — источник истины: каждое слово — честное чувство особи. Ни координат, ни метров, ни номеров тел, ни карты; отладочный
// флаг сюда не достаёт. Строка — на смену класса, не по таймеру. Наружу — {t:'agent', n, at, who, text}; консоли не видят.
const VOICE_R = +(/&voice=(\d+)/.exec(self.location.search)||[])[1] || Infinity;
const INTENT_CD = 15, INTENT_CD_SHORT = 3;   // кулдаун намерения на особь, с игрового: чаще особь не слушает; короткий — на мелкое (взять, положить, шаг, стой)
let agentN = 0;
const pname = p => 'О'+(p.i+1);
function say(p, text){ if(muted) return; postMessage({t:'agent', n:++agentN, at:+t.toFixed(1), who:p.i+1, text}); }
const RUMBS = ['востоке','юго-востоке','юге','юго-западе','западе','северо-западе','севере','северо-востоке'];   // +y на карте — юг
const RUMB_DIR = {восток:0,'юго-восток':1,юг:2,'юго-запад':3,запад:4,'северо-запад':5,север:6,'северо-восток':7};
function rumb(a,b){ return RUMBS[Math.round(bearingDeg(a,b)/45)%8]; }
const ACT_WORDS = { dead:'лежу, мёртв', sleep:'сплю', idle:'стою', freeze:'замер, смотрю', approach:'подхожу к двуногому', attack:'нападаю', back:'отхожу от двуногого',
  flee:'бегу к логову', home:'иду к логову', rest:'отдыхаю у логова', goto:'иду', stay:'жду' };
// ориентиры, которые особь видит издалека: платформы и крупные ориентиры уровня — дальность по высоте, стены — как у зрения
let LANDMARKS=null; function landmarks(){ return LANDMARKS=LANDMARKS||[ ...stations.map(S=>({key:'st'+S.k, get name(){ return S.turret&&S.turret.on?'постройка со светом':'постройка'; }, x:S.x, y:S.y, H:STATION.h})),
  ...POIS.filter(p=>p.id<=5).map(p=>({key:'poi'+p.id, name:CODEBOOK[p.id].name, x:p.x, y:p.y, H:Math.max(0.5,...p.subs.map(s=>OBJ_H[s[0]]||0))})) ]; }   // лениво: OBJ_H объявлен ниже
function seesLandmark(p,L){ const d=dist(p,L); if(d>Math.min(300,40*L.H)) return false; const q=d>8?{x:L.x+(p.x-L.x)*6/d, y:L.y+(p.y-L.y)*6/d}:p; return losFrac(p,q,1.2,L.H)<0.34; }   // луч до 6 м перед ориентиром: свой корпус его не закрывает
function farWord(d){ return d<3?'вплотную':d<15?'близко':d<60?'недалеко':'далеко'; }
function placeWord(p){ if(dist(p,LAIR)<5) return 'у логова'; const tt=tunnelT(p.x,p.y); if(tt>0.5) return 'в глубине расщелины'; if(tt>=0) return 'в расщелине'; if(dist(p,TUN_A)<30) return 'у выхода из расщелины'; return 'снаружи'; }
function foeText(p){ const f=foeOf(p); if(!f || t-f.t>1.5) return ''; const u=units.find(u=>u.id===f.u); if(!u) return '';
  if(f.how!=='see') return `слышу шаги, ${farWord(dist(p,u))}, на ${rumb(p,u)}`;
  const sp=u.target?speedFor(u):0, mv=sp<=0?'стоит':sp<1?'крадётся':sp<2?'идёт':'бежит';
  return `вижу двуногого ${u.lightOn?'со светом':'без света'}, ${farWord(dist(p,u))}, на ${rumb(p,u)}, ${mv}`; }
function nearItems(p,r=6){ return objectsAround(p,r).filter(o=>!o.pack&&!o.landmark&&isContainer(o)&&containerOpen(o)&&contentsOf(o).length&&(r<=6||losFrac(p,o)<0.34)); }   // открытые контейнеры с содержимым: в 6 м — с содержимым, до 20 м — видны как предмет (стены — как у зрения)
// класс с гистерезисом: у порога значение дрожит, слово — нет
function band(v,bands,prev){ const i=bands.findIndex(b=>b[0]===prev); if(i>=0){ const lo=i>0?bands[i][1]-0.05:-1, hi=i<bands.length-1?bands[i+1][1]+0.05:2; if(v>=lo&&v<hi) return prev; } let w=bands[0][0]; for(const b of bands) if(v>=b[1]) w=b[0]; return w; }
const FEAR_BANDS=[['спокоен',0],['тревожно',0.3],['страшно',0.6]];
function stateWords(p){ return { act:p.act==='flee'&&p.why==='луч'?'бегу от света':ACT_WORDS[p.act]||p.act, fear:band(p.fear,FEAR_BANDS,p.per&&p.per.fear),
  hp:p.act==='dead'?'мёртв':p.hp>=p.hpMax?'цел':p.hp>p.hpMax/2?'ранен':'едва жив', tired:p.tired>0.8?'устал':'', place:placeWord(p) }; }
// раз в полсекунды после рефлексов: что изменилось — то и сказано. Первый вызов — молча, базовая картина (полная — agentState)
function perceive(p){ const first=!p.per; const per=p.per=p.per||{seen:{}}; const w=stateWords(p), out=[];
  const foe=foeText(p); if(foe!==(per.foe||'')){ if(foe) out.push(foe); else if(per.foe) out.push('двуногого больше не чувствую'); per.foe=foe; }
  for(const k of ['act','fear','hp','tired','place']){ if(w[k]!==per[k]){ if(w[k]) out.push(w[k]); per[k]=w[k]; } }
  const carry=p.item?'несу: '+ITEMS[p.item]:''; if(carry!==(per.carry||'')){ if(carry) out.push(carry); else if(per.carry) out.push('положил'); per.carry=carry; }
  if(p.act!=='sleep' && (Math.floor(t/DT)+p.i)%20===0){ const near=nearItems(p).map(o=>`${nameOf(o)} — ${contentsOf(o).map(i=>ITEMS[i]).join(', ')}`).join('; '); if(near!==(per.near||'')){ if(near) out.push('рядом: '+near); per.near=near; }
    const fresh={}; for(const o of nearItems(p,20)){ const k='obj'+o.id; if(!per.seen[k]){ const n=nameOf(o); if(!fresh[n]||dist(p,o)<dist(p,fresh[n].o)) fresh[n]={o,n:(fresh[n]?fresh[n].n:0)+1}; else fresh[n].n++; } per.seen[k]=true; }
    for(const n in fresh){ const f=fresh[n]; out.push(`вижу: ${n}${f.n>1?' (×'+f.n+')':''}, ${farWord(dist(p,f.o))}, на ${rumb(p,f.o)}`); }   // одинаковые предметы — одной строкой, по ближайшему for(const k in per.seen) if(k.startsWith('obj')&&!nearItems(p,20).some(o=>'obj'+o.id===k)) per.seen[k]=false;   // предмет в поле зрения — с направлением, чтобы к нему можно было подойти
    for(const L of landmarks()){ const s=seesLandmark(p,L); if(s && !per.seen[L.key]) out.push(`вижу: ${L.name}, ${farWord(dist(p,L))}, на ${rumb(p,L)}`); per.seen[L.key]=s; }
    for(const q of pack){ if(q===p||q.act!=='dead') continue; const k='dead'+q.i; const s=dist(p,q)<40 && losFrac(p,q)<0.34; if(s && !per.seen[k]) out.push(`${pname(q)} лежит, мёртв, ${farWord(dist(p,q))}, на ${rumb(p,q)}`); per.seen[k]=s; }
    for(const u of units){ if(u.alive) continue; const k='body'+u.id; const s=dist(p,u)<40 && losFrac(p,u)<0.34; if(s && !per.seen[k]) out.push(`тело двуногого лежит, ${farWord(dist(p,u))}, на ${rumb(p,u)}`); per.seen[k]=s; } }
  if(!first) for(const s of out) say(p,s); }
// полная картина сейчас — для входа агента: по особи строка состояния, чужой, что видит вокруг
function agentState(){ return pack.map(p=>{ const w=stateWords(p); const parts=[`${pname(p)}: ${w.place}, ${w.act}, ${w.fear}, ${w.hp}${w.tired?', '+w.tired:''}`];
  const foe=foeText(p); if(foe) parts.push(foe); if(p.act!=='sleep') for(const L of landmarks()) if(seesLandmark(p,L)) parts.push(`вижу: ${L.name}, ${farWord(dist(p,L))}, на ${rumb(p,L)}`);
  if(p.item) parts.push('несу: '+ITEMS[p.item]); if(p.told) parts.push('делаю, как сказано'); return parts.join('; '); }); }
// намерение — строка «О2: к обломкам». Ложится в те же target/act, что рефлексы; принято ≠ выполнено: что особь сделала — в ленте
const WORDS = ['тревога','чужой','сюда','бей','домой','добыча'];
function intent(line){
  const m=/^о?\s*(\d+)\s*[:,—-]?\s*(.+)$/iu.exec(String(line||'').trim()); if(!m) return {ok:false, why:'не понял: нужно «О2: домой»'};
  const p=pack[+m[1]-1], v=m[2].trim().toLowerCase().replace(/[«»"']/g,''); if(!p) return {ok:false, why:'такой особи нет'};
  const no=why=>({ok:false, who:p.i+1, why});
  if(p.act==='dead') return no('мёртв');
  if(p.act==='sleep') wake(p,'слово');   // голос в голове будит
  if(p.rest>0) return no('на передышке у логова, не выйдет');
  if(p.rage>0 && p.act==='attack') return no('дерётся');
  const left=(p.intentCd||INTENT_CD)-(t-(p.intentAt??-1e9)); if(left>0) return no(`не слушает, ещё ${Math.ceil(left)} с`);
  const accept=(cd)=>{ p.intentAt=t; p.intentCd=cd; return {ok:true, who:p.i+1}; };
  const ce=nerve(p); let tg=null, act='goto', why='';
  const go=(pt)=>{ tg=pt; };
  let short=false;   // мелкое слово — короткий кулдаун
  if(/^как хочешь/.test(v)){ p.told=null; p.target=null; if(p.act==='goto'||p.act==='stay') p.act='idle'; return accept(INTENT_CD_SHORT); }
  else if(/^(стой|затаись|замри|жди)/.test(v)){ act='freeze'; short=true; }
  else if(/^крикни\s+(\S+)/.test(v)){ const w=/^крикни\s+(\S+)/.exec(v)[1]; if(!WORDS.includes(w)) return no('нет такого крика: '+WORDS.join(', '));
    if((w==='бей'||w==='сюда') && ce<0.35) return no('боится'); if(!cry(p,w)) return no('глотка, только что кричал'); return accept(INTENT_CD_SHORT); }
  else if(/^(возьми|подними)\s+(.+)/.test(v)){ if(p.item) return no('уже несу: '+ITEMS[p.item]); const want=/^(возьми|подними)\s+(.+)/.exec(v)[2]; const stem=w=>w.slice(0,Math.max(3,w.length-2));
    for(const o of nearItems(p,4)) for(const it of contentsOf(o)) if(ITEMS[it].split(' ').some(w=>stem(w).startsWith(stem(want.split(' ').pop())))){ removeItem(o,it); p.item=it; note('agent',{who:p.i,take:it,from:o.id}); return accept(INTENT_CD_SHORT); }
    return no(nearItems(p,4).length?'такого рядом нет':'рядом ничего нет, подойти вплотную'); }
  else if(/^(положи|брось)/.test(v)){ if(!p.item) return no('ничего не несу'); const g=dropBundle(p.x,p.y,p.item); if(p.per) p.per.seen['obj'+g.id]=true; note('agent',{who:p.i,drop:p.item}); p.item=null; return accept(INTENT_CD_SHORT); }   // свой свёрток особь знает — «вижу» о нём не будет
  else if(/^к чужому/.test(v)){ const f=foeOf(p); if(!f) return no('чужого не чувствую'); if(ce<0.3) return no('боится'); go({x:f.x,y:f.y}); }
  else if(/^к крикнувшему/.test(v)){ const c=[...cries].reverse().find(c=>c.i!==p.i && t-c.t<30); if(!c) return no('крика не слышал'); go({x:c.x,y:c.y}); }
  else if(/^домой/.test(v)) go({...LAIR});
  else if(/^на лёжку/.test(v)) go({...p.home});
  else if(/^к о\s*(\d+)/.test(v)){ const q=pack[+/^к о\s*(\d+)/.exec(v)[1]-1]; if(!q||q===p) return no('такой особи нет'); if(q.act==='dead') return no(`${pname(q)} мёртв`); if(dist(p,q)>VOICE_R) return no(`не знаю, где ${pname(q)}`); go({x:q.x,y:q.y}); }
  else if(/^на (северо-восток|северо-запад|юго-восток|юго-запад|север|юг|восток|запад)( далеко| близко| чуть)?/.test(v)){ const mm=/^на (северо-восток|северо-запад|юго-восток|юго-запад|север|юг|восток|запад)( далеко| близко| чуть)?/.exec(v);
    const a=RUMB_DIR[mm[1]]*Math.PI/4, R=mm[2]===' далеко'?150:mm[2]===' близко'?20:mm[2]===' чуть'?8:50; short=R<=8; go({x:p.x+Math.cos(a)*R, y:p.y+Math.sin(a)*R}); }
  else if(/^к /.test(v)){ const stem=w=>w.slice(0,Math.max(3,w.length-2)), want=stem(v.slice(2).trim().split(' ').pop());
    const near=objectsAround(p,20).filter(o=>!o.pack&&!o.landmark&&losFrac(p,o)<0.34&&nameOf(o).split(' ').some(w=>stem(w).startsWith(want)||want.startsWith(stem(w))));   // предмет в поле зрения — раньше ориентира: «к ящику» у обломков
    if(near.length){ const o=near.reduce((a,b)=>dist(p,a)<dist(p,b)?a:b), d=dist(p,o)||1; short=true; go({x:o.x+(p.x-o.x)*1.0/d, y:o.y+(p.y-o.y)*1.0/d}); }
    else { const L=landmarks().filter(L=>L.name.split(' ').some(w=>stem(w).startsWith(want)||want.startsWith(stem(w)))); const seen=L.filter(L=>p.per&&p.per.seen[L.key]);   // «к обломкам», «к ящикам»: по основе слова
    if(!L.length) return no('не знаю такого'); if(!seen.length) return no(`не вижу: ${L[0].name}`); const best=seen.reduce((a,b)=>dist(p,a)<dist(p,b)?a:b); const d=dist(p,best)||1; go({x:best.x+(p.x-best.x)*6/d, y:best.y+(p.y-best.y)*6/d}); } }
  else return no('не понял; знаю: к чужому, к крикнувшему, домой, на лёжку, к О3, к обломкам, на запад [далеко|близко|чуть], стой, возьми предмет, положи, крикни слово, как хочешь');
  p.told={v}; p.hold=0; p.rage=0; p.freezeT=0;
  if(act==='freeze'){ p.act='freeze'; p.freezeT=30; p.target=null; p.why='слово: стой'; }
  else { p.act='goto'; p.target=tg; p.why='слово: '+v; say(p,'иду '+v); if(p.per) p.per.act=ACT_WORDS.goto; }   // «иду на запад» на каждое принятое движение, даже если уже шла
  note('agent',{who:p.i,intent:v,x:+p.x.toFixed(1),y:+p.y.toFixed(1),to:tg?{x:+tg.x.toFixed(1),y:+tg.y.toFixed(1)}:undefined,nerve:+ce.toFixed(2)});
  return accept(short?INTENT_CD_SHORT:INTENT_CD); }

// ---------- турель платформы (design.md §12а, roadmap п. 0б (в) 5) ----------
// Лампа у самой турели: видит только то, что освещает — сектор fov вокруг курса, дальность range, без стены (losFrac). Захват — по
// движению (скорость > 0,3 м/с): одичалые и тела чужих команд (свои — по транспондеру ПС-2, не цель). Прицел aim с: цель, вышедшая
// из сектора, дальности или за камень, сбрасывает захват; остановиться не спасает — лампа уже на ней. Точность 100 %, насмерть.
// Перезарядка reload с. Без питания лампа не горит — турель слепа. Освещённая особь чувствует луч; выстрел слышен далеко.
function turretTargets(S,T){ const out=[]; const inSector=(o)=>{ const d=dist(T,o); if(d>T.range) return false; let a=Math.atan2(o.y-T.y,o.x-T.x)-T.ang; a=Math.atan2(Math.sin(a),Math.cos(a)); return Math.abs(a)<=T.fov/2 && losFrac(T,o,1.6,1.2)<0.34; };
  for(const p of pack){ if(p.act==='dead'||!p.target||packSpeed(p)<0.3) continue; if(inSector(p)) out.push({p}); }
  for(const u of units){ if(!u.alive||stOf(u).team===S.team||!u.target||speedFor(u)<0.3) continue; if(inSector(u)) out.push({u}); }
  return out; }
function turretHolds(T,o){ const d=dist(T,o); if(d>T.range) return false; let a=Math.atan2(o.y-T.y,o.x-T.x)-T.ang; a=Math.atan2(Math.sin(a),Math.cos(a)); return Math.abs(a)<=T.fov/2 && losFrac(T,o,1.6,1.2)<0.34; }
function turretTick(S,dt){ const T=S.turret; if(!T) return; T.on=S.power>0; T.reloadT=Math.max(0,T.reloadT-dt); if(!T.on){ if(T.tgt) turretDrop(S,T); return; }
  const cur=T.tgt?(T.tgt.p!==undefined?pack[T.tgt.p]:units.find(u=>u.id===T.tgt.u)):null;
  if(cur && (cur.act==='dead'||cur.alive===false||!turretHolds(T,cur))){ turretDrop(S,T); return; }
  if(!cur){ const c=turretTargets(S,T); if(!c.length) return; const best=c.reduce((a,b)=>dist(T,a.p||a.u)<dist(T,b.p||b.u)?a:b); T.tgt=best.p?{p:best.p.i}:{u:best.u.id}; T.aimT=0;
    if(best.p){ best.p.lit=t; say(best.p,'на меня направили свет'); } else evt(36,best.u.id); note('turret',{st:S.k,lock:best.p?'О'+(best.p.i+1):'М'+best.u.id}); return; }
  T.aimT+=dt; if(cur.lit!==undefined) cur.lit=t; if(T.aimT<T.aim||T.reloadT>0) return;
  T.reloadT=T.reload; T.aimT=0; T.tgt=null; evt(37,0,cur.i!==undefined?250+cur.i:cur.id,S.k); note('turret',{st:S.k,shot:cur.i!==undefined?'О'+(cur.i+1):'М'+cur.id,x:+cur.x.toFixed(0),y:+cur.y.toFixed(0)});
  if(cur.i!==undefined) killPack(cur,'выстрел'); else { cur.skin=0; cur.pain=1; }
  // выстрел слышен: стая — страх и слово, тела — вздрагивают
  for(const q of pack){ if(q.act==='dead') continue; const d=dist(T,q); if(d>400) continue; const loud=(1-d/400)*(1-0.7*losFrac(T,q,1.6,1.2)); if(loud<0.05) continue; wake(q,'выстрел'); q.fear=Math.min(1,q.fear+0.3*(1-q.courage)*loud); q.alert=20; say(q,`выстрел, ${d<60?'близко':d<150?'недалеко':'далеко'}, на ${rumb(q,T)}`); }
  for(const u of units){ if(!u.alive) continue; const d=dist(T,u); if(d>400) continue; u.startle=Math.min(1,(u.startle||0)+0.6*(1-d/400)); } }
function turretDrop(S,T){ const cur=T.tgt&&T.tgt.p!==undefined?pack[T.tgt.p]:null; T.tgt=null; T.aimT=0; if(cur&&cur.act!=='dead') say(cur,'свет ушёл'); }
// смерть особи: лежит, где упала; ноша — свёрток рядом
function killPack(p,why){ p.hp=0; p.act='dead'; p.target=null; p.told=null; p.foe=null; if(p.item){ dropBundle(p.x,p.y,p.item); p.item=null; } note('pack',{who:p.i,dead:why,x:+p.x.toFixed(1),y:+p.y.toFixed(1)}); }

// ---------- столкновения: тело не проходит сквозь корпус, скалы и стены тоннеля; вдоль препятствия скользит ----------
const BODY_R = 0.6;
const MAX_SLOPE=0.84;   // tg 40°: круче тело не идёт — стены расщелины, обрыв; дюны, осыпь, завал проходимы
const BOUNDS=LEVEL.bounds||{x0:-1e4,y0:-1e4,x1:1e4,y1:1e4};   // край уровня: рельеф определён везде, но дальше никто не ступает
function inBounds(x,y){ return x>=BOUNDS.x0&&x<=BOUNDS.x1&&y>=BOUNDS.y0&&y<=BOUNDS.y1; }
function blocked(x,y,fromX,fromY){ if(!inBounds(x,y)) return true;
  const len=Math.hypot(x-fromX,y-fromY)||1; if((TER.H(x,y)-TER.H(fromX,fromY))/len>MAX_SLOPE) return true;
  for(const c of HULLS){ if(hullIn(x,y,c,BODY_R)) return true; }
  return false;
}
// цель внутри корпуса (платформа, обломки — сам ориентир стоит в их центре) → ближайшая точка снаружи, к ней и идти
// (радиально от центра корпуса; цель в самом центре — со стороны тела)
function outsideHulls(x,y,from){ for(const c of HULLS){ if(!hullIn(x,y,c,BODY_R)) continue; const pad=BODY_R+0.4; let vx=x-c.x, vy=y-c.y; if(Math.hypot(vx,vy)<0.5){ vx=from.x-c.x; vy=from.y-c.y; }
    if(c.r!==undefined){ const d=Math.hypot(vx,vy)||1; return {x:c.x+vx/d*(c.r+pad), y:c.y+vy/d*(c.r+pad)}; }
    const ca=Math.cos(c.ang), sa=Math.sin(c.ang), lx=vx*ca+vy*sa, ly=-vx*sa+vy*ca; const k=Math.hypot(lx/(c.rx+pad),ly/(c.ry+pad))||1; const ox=lx/k, oy=ly/k;   // в осях эллипса
    return {x:c.x+ox*ca-oy*sa, y:c.y+ox*sa+oy*ca}; }
  return {x,y}; }
function stepBody(u,len){
  const dx=Math.cos(u.heading)*len, dy=Math.sin(u.heading)*len;
  if(!inBounds(u.x+dx,u.y+dy)) return false;   // край уровня: без скольжения вдоль рамки, чтобы не дрожать на месте
  if(!blocked(u.x+dx,u.y+dy,u.x,u.y)){ u.x+=dx; u.y+=dy; return true; }
  // скольжение: пробуем повернуть шаг на ±45°, ±90°
  for(const a of [Math.PI/4,-Math.PI/4,Math.PI/2,-Math.PI/2]){ const h=u.heading+a, sx=Math.cos(h)*len, sy=Math.sin(h)*len; if(!blocked(u.x+sx,u.y+sy,u.x,u.y)){ u.x+=sx; u.y+=sy; return true; } }
  return false;
}

// ---------- сообщения наружу ----------
// st — станция-адресат: её оператор(ы) и получают сообщение; по умолчанию — станция тела
function emit(cls, kind, unit, payload, st){ if(st===undefined){ const u=units.find(u=>u.id===unit); st=u?u.st:0; } if(muted){ msgId++; return; } postMessage({ t:'msg', id:msgId++, st, cls, kind, unit, payload }); }
function evt(code, unit=0, arg=0, st){ emit('cmd','EVT', unit, new Uint8Array([code,arg]), st); }
// Заметка мира: что решил и почему — в лог хоста (tech.md §12). Консоль этого не видит: станция не пересылает note операторам.
// Ставится там, где if с числами решает игровой исход и потом спросят «почему оно так». Не трассировка: сотни строк на час, не тысячи.
function note(kind, data){ if(muted) return; postMessage({ t:'note', at:+t.toFixed(1), kind, ...data }); }
const CMD_NAMES={1:'описание',2:'лидар',3:'кадр',6:'идти',7:'режим',8:'действие',9:'передатчик',10:'вырастить',11:'статус',12:'телеметрия',13:'лидар-подписка',14:'описание-подписка',15:'пульс',16:'кадр-подписка',17:'стоп',18:'смотреть',19:'изучить',20:'съесть',21:'склад',22:'положить',23:'взять',24:'скрытность',25:'стойка',26:'при потере несущей'};
function emitAuto(kind, unit, payload){ emit('bg', kind, unit, payload); }   // периодические подписки идут фоном

// ---------- телеметрия миссионера (16 байт) ----------
function telemetry(u){
  const b=new Uint8Array(16), c=v=>Math.max(0,Math.min(255,Math.round(v)));
  b[0]=c(u.pulse); b[1]=c(u.electro); b[2]=c(u.glucose); b[3]=c(u.toxin); b[4]=c(u.skin); b[5]=c(u.bone); b[6]=c(u.psyche);
  b[7]=(pack.some(p=>p.act!=='sleep' && dist(u,p)<90)?1:0)|((u.autonomy&3)<<1);   // бит 0 — опасность, биты 1–2 — инструкция на потерю несущей
  b[8]=c(u.cons*50); b[9]=c(u.charge*2.55); b[10]=c(u.gen*50);
  const [xh,xl,yh,yl]=posBytes(u); b[11]=xh; b[12]=xl; b[13]=yh; b[14]=yl; b[15]=modeByte(u);
  return b;
}
// ---------- пульс станции (раз в 2 с): [биозапас, склад камер, рост(с|255), склад брикетов, склад резаков, n, (id, флаги, заряд, предметы, SNR+30)*] ----------
function heartbeat(S){
  const own=units.filter(u=>u.st===S.k);
  const b=[S.bioStock, S.camInv, S.growing?Math.ceil(S.growing.tLeft):255, S.store[40], S.store[41], own.length];
  for(const u of own){ b.push(u.id, (u.alive?1:0)|(u.carrier?2:0)|(u.sensors.camera?4:0)|(u.sensors.sonar?8:0)|(u.sub.img.interval?16:0)|(atAirlock(u)?32:0), Math.round(u.charge*2.55), Math.min(3,u.items.filter(i=>i===40).length)|(u.items.includes(41)?4:0), Math.max(0,Math.min(255,Math.round((u.snr||0)+30)))); }
  emit('bg','HB',0,new Uint8Array(b),S.k);
}

// ---------- восприятие ----------
function objectsAround(u, maxR){
  const out=[]; const inT=tunnelT(u.x,u.y)>=0;
  out.push=function(o){ o.viewer=u; return Array.prototype.push.call(this,o); };   // кто смотрит — для «наш»/«чужой» в тексте
  for(const p of [...POIS, ...SPOIS]){
    const pInT=poiInCanyon(p), deep=poiDeep(p);
    const lmVisible = inT ? pInT : (!deep || dist(u,TUN_A)<=30);
    if(lmVisible && dist(u,p)<=300) out.push({id:p.id,type:p.station?1:p.id,x:p.x,y:p.y,landmark:true,station:p.station});
    if(inT && !pInT) continue;
    if(!inT && deep) continue;
    for(let i=0;i<p.subs.length;i++){ const s=p.subs[i]; const o={id:p.station?p.idBase+i:p.id*10+i,type:s[0],x:p.x+s[1],y:p.y+s[2],facing:s[3]}; if(dist(u,o)<=maxR) out.push(o); }
  }
  for(const v of units){ if(v===u) continue; if(dist(u,v)<=maxR) out.push({id:200+v.id,type:v.alive?252:251,x:v.x,y:v.y,unit:v}); }
  for(const g of ground){ if(dist(u,g)<=maxR) out.push({id:g.id,type:33,x:g.x,y:g.y}); }
  for(const p of pack){ if(dist(u,p)<=Math.min(maxR,60)) out.push({id:250+p.i,type:250,x:p.x,y:p.y,pack:p}); }
  return out;
}
// Станция составляет текст сама — из базы знаний и текущего состояния мира.
function nameOf(o){
  if(o.pack) return o.pack.act!=='sleep' ? 'существо, класс не определён' : 'объект, класс не определён';
  if(o.unit){ const v=o.unit, who=v.st===o.viewer.st?'':`, ${stOf(v).name}`; return v.alive ? `миссионер М${v.id}${who}` : `тело М${v.id}${who}`; }
  if(o.station) return o.station.k===o.viewer.st ? 'шлюз станции' : `шлюз ${o.station.name}`;
  if(o.type===28) return (contents[o.id]||[]).length ? 'резак на камне' : 'плоский камень';
  return (CODEBOOK[o.type]||CODEBOOK[250]).name;
}
function examText(o){
  if(o.pack){ const p=o.pack, sz=p.size>1.15?', крупное':p.size<0.85?', мелкое':'', a=p.act; if(a==='dead') return `Двуногое${sz}, лежит. Не дышит. Кожа с тем же рисунком пор, что у миссионера.`; return a==='sleep'||a==='rest' ? `Двуногое${sz}, лежит. ${a==='rest'?'Смотрит.':'Дышит.'} Кожа с тем же рисунком пор, что у миссионера.`
    : `Двуногое${sz}. Кожа с тем же рисунком пор, что у миссионера. ${a==='flee'||a==='home'||a==='back'?'Уходит.':a==='attack'||a==='approach'?'Идёт сюда.':'Смотрит.'}`; }
  if(o.unit){ const v=o.unit; if(v.alive) return `${v.st===o.viewer.st?'Наш.':'Той же серии, платформа '+stOf(v).name+'.'} ${v.target?'Идёт.':'Стоит.'} Пульс на вид ${v.pulse<100?'ровный':'частый'}.`; return withContents(o,'Не двигается.'); }
  const cb=CODEBOOK[o.type]||CODEBOOK[250]; return withContents(o,(cb.states||[])[stateOf(o.id)]||'');
}
function withContents(o,text){ if(!isContainer(o)||!containerOpen(o)) return text; const c=contentsOf(o); return text+(c.length?' Здесь: '+c.map(i=>ITEMS[i]).join(', ')+'.':' Пусто.'); }
function classOf(o){ return o.pack?2 : o.unit?(o.unit.alive?4:3) : o.landmark?1 : 0; }
function describe(u, cls='cmd'){
  const objs=objectsAround(u,100); const parts=[];
  for(const o of objs){ const t=encText(nameOf(o)); parts.push([o.id&255, classOf(o), Math.round(bearingDeg(u,o)/2), Math.min(255,Math.round(dist(u,o))), t.length, ...t]); }
  emit(cls,'DESC',u.id,new Uint8Array([...posBytes(u),...parts.flat()]));   // первые 4 байта — где снято
}
function posBytes(u){ const c=v=>Math.max(0,Math.min(65535,Math.round(v*10)+32768)), x=c(u.x), y=c(u.y); return [x>>8,x&255,y>>8,y&255]; }   // дециметры, 16 бит: ±3276 м, за пределом — край, не заворот
function decPos(b,o){ return { x:(((b[o]<<8)|b[o+1])-32768)/10, y:(((b[o+2]<<8)|b[o+3])-32768)/10 }; }
function rayCircle(ox,oy,dx,dy,c){ const fx=ox-c.x, fy=oy-c.y; const b=2*(fx*dx+fy*dy), cc=fx*fx+fy*fy-c.r*c.r; const D=b*b-4*cc; if(D<0) return Infinity; const s=Math.sqrt(D); const t1=(-b-s)/2, t2=(-b+s)/2; if(t1>0) return t1; if(t2>0) return t2; return Infinity; }
// что отражает лидар: только тела с объёмом (радиус, м); следы, надписи, кабели, вода — нет
const SONAR_R={13:0.8,14:0.8,17:0.3,18:0.6,20:1.5,21:0.15,22:0.4,23:3,28:0.4,29:1.5,32:0.2,33:0.3,34:0.4};   // люки и прожектор — часть корпуса, он отражает сам
// Лидар: 64 луча по кругу под наклоном tilt° к горизонту с высоты SONAR_H над грунтом; на луч — байт наклонной дальности
// и бит «сплошное». Бит — измерение, а не подсказка мира: на каждый азимут датчик даёт второй луч на SONAR_DT выше, две точки
// попадания лежат на поверхности, и крутизна хорды между ними — уклон поверхности вдоль луча. Хорда круче MAX_SLOPE (40°, куда
// тело не пройдёт) — «сплошное»: стены, обрыв, корпус. Вертикальная стена вертикальна с любого азимута; склон наискось кажется положе.
// Наклон вниз даёт эхо от грунта: подъём впереди укорачивает дальность, понижение удлиняет — профиль рельефа за те же байты.
// Пакет: [x,y съёмки (4), наклон+90 (1), высота датчика (2), маска (8), дальности (64)] = 79 Б
const SONAR_H=1.7, SONAR_DT=3*Math.PI/180;   // высота датчика над грунтом (голова; глаза камеры — 1,6) и разнос пары лучей по вертикали
const OBJ_H={13:1,14:1,17:7,18:1.8,20:0.7,21:1.1,22:0.5,23:4,28:0.4,29:1.4,32:0.25,33:0.4,34:1.6};   // высота отражателя, м; тела — 1,8 / 0,5, одичалые — по размеру
// декорации (`TER.decor`) отражают тоже — кадр и лидар видят одно: радиус футпринта в долях высоты спрайта `Hs`, высота — `Hs`;
// сухостой — нет (тонкие стебли), столбик кабеля — 8 см, луч в него почти не попадает
const DECOR_R={boulder:0.45,boulder2:0.5,rocks:0.8,outcrop:0.6,hoodoo:0.3,debris:0.6,cairn:0.4,post:0};
function decorR(o){ return o.type==='post'?0.08:(DECOR_R[o.type]||0)*o.Hs; }
// один луч: первое препятствие по направлению (ca,sa) под наклоном tilt; возвращает наклонную дальность (100 — нет эха) и точку попадания
function castRay(u,z0,ca,sa,tilt,objs){ const ch=Math.cos(tilt), sh=Math.sin(tilt), dx=ca*ch, dy=sa*ch; const hitZ=(t)=>z0+sh*t; let best=100;   // dx,dy — шаг по горизонтали на метр наклонной дальности
  for(const c of HULLS){ const t=rayHull(u.x,u.y,ca,sa,c)/ch; if(t<best && hitZ(t)<TER.H(c.x,c.y)+c.h) best=t; }
  for(let t=0.5;t<best;t+=0.5){ const px=u.x+dx*t, py=u.y+dy*t; if(hitZ(t)<=TER.H(px,py)){ let lo=t-0.5, hi=t; for(let k=0;k<5;k++){ const m=(lo+hi)/2; if(hitZ(m)<=TER.H(u.x+dx*m,u.y+dy*m)) hi=m; else lo=m; } best=hi; break; } }
  for(const o of objs){ if(o.landmark) continue; const r=o.pack?0.5*o.pack.size:o.unit?0.5:o.decor?decorR(o):(SONAR_R[o.type]||0); if(!r) continue; const t=rayCircle(u.x,u.y,ca,sa,{x:o.x,y:o.y,r})/ch; const oh=o.pack?(o.pack.act!=='sleep'?1.6:0.6)*o.pack.size:o.unit?(o.unit.alive?1.8:0.5):o.decor?o.Hs:(OBJ_H[o.type]||1);
    if(t<best && hitZ(t)<TER.H(o.x,o.y)+oh && hitZ(t)>TER.H(o.x,o.y)-0.5) best=t; }
  return {t:best, x:u.x+dx*best, y:u.y+dy*best, z:hitZ(best)}; }
function sonar(u, cls='cmd'){
  const b=new Uint8Array(64), mask=new Uint8Array(8); const objs=objectsAround(u,100).concat(TER.decor(u,100)); const tilt=(u.sonarTilt||0)*Math.PI/180;
  const z0=TER.H(u.x,u.y)+SONAR_H;
  for(let i=0;i<64;i++){ const a=i/64*Math.PI*2, ca=Math.cos(a), sa=Math.sin(a);
    const p=castRay(u,z0,ca,sa,tilt,objs); b[i]=Math.round(Math.min(100,p.t)/100*255); if(p.t>=100) continue;
    const q=castRay(u,z0,ca,sa,tilt+SONAR_DT,objs); if(q.t>=100) continue;   // второй луч ушёл в пустоту — поверхность не круче луча
    if(Math.abs(q.z-p.z)>MAX_SLOPE*Math.hypot(q.x-p.x,q.y-p.y)) mask[i>>3]|=1<<(i&7); }
  const zs=Math.max(0,Math.min(65535,Math.round((z0+40)*10)));   // высота датчика над уровнем станции: барометр тела, 2 Б, шаг 0,1 м от −40 м
  emit(cls,'SONAR',u.id,new Uint8Array([...posBytes(u),Math.round(u.sonarTilt||0)+90,zs>>8,zs&255,...mask,...b]));
}

// ---------- камера ----------
function camHeading(u){ return u.goal && dist(u,u.goal)>1.5 ? Math.atan2(u.goal.y-u.y,u.goal.x-u.x) : u.heading; }   // голова повёрнута к цели, если она задана
// что попадает в кадр: объекты мира с подменой типа по состоянию (спит / идёт / тело), платформа, декорации
function sceneObjects(u){ const out=[];
  for(const o of objectsAround(u,140)){ if(o.landmark && !SPRITES[o.type]) continue; if(o.type===26) continue;
    let type=o.type, Hs; if(o.pack){ const p=o.pack, ly=p.act==='sleep'||p.act==='dead'; type=ly?'sleep':250; Hs=(ly?0.6:1.6)*p.size; } if(o.unit) type=o.unit.alive?(o.unit.target?'walk':252):251;
    if(!SPRITES[type]) continue; const facing=o.unit?o.unit.heading:o.pack?(o.pack.target?o.pack.heading:Math.atan2(u.y-o.y,u.x-o.x)):o.facing;   // тела и идущие особи — по курсу, стоящая особь — на камеру, объекты — по уровню
    out.push({id:o.id,type,x:o.x,y:o.y,facing,Hs}); }
  for(const S of stations) out.push({id:900+S.k,type:'station',x:S.x,y:S.y,facing:S.ang}); return out.concat(TER.decor(u,120)); }
function render(u,size){ return CAM.render(u,size,sceneObjects(u)); }   // size×size, 8 бит; внутри — удвоенное разрешение и усреднение
function downsample(img,size,to){ const f=size/to, out=new Uint8Array(to*to); for(let y=0;y<to;y++)for(let x=0;x<to;x++){ let s=0; for(let j=0;j<f;j++)for(let i=0;i<f;i++) s+=img[(y*f+j)*size+x*f+i]; out[y*to+x]=s/(f*f);} return out; }
// Изображение. Пирамида уровней 8→16→32→64 (kind IMG0..3), либо дельта-кадр на одном уровне (kind IMDn):
// сетка 8×8 блоков, уходят только изменившиеся; payload [frameNo, key, (idx, блок)*]. Блок = (side/8)² байт.
function imagePyramid(u, level, cls){ const top=[8,16,32,64][level], full=render(u,top); [8,16,32,64].slice(0,level+1).forEach((s,l)=>emit(cls,'IMG'+l,u.id,s===top?full:downsample(full,top,s),u.st)); }
function imageDelta(u, level, cls='bg'){
  const side=[8,16,32,64][level], bsz=side/8, f=render(u,side);
  const last=u.lastImg[level]; const key=!last; u.frameNo=(u.frameNo+1)&255; const blocks=[];
  for(let b=0;b<64;b++){ const bx=(b%8)*bsz, by=Math.floor(b/8)*bsz; let maxd=0; const px=[];
    for(let j=0;j<bsz;j++)for(let i=0;i<bsz;i++){ const idx=(by+j)*side+bx+i; px.push(f[idx]); if(last) maxd=Math.max(maxd,Math.abs(f[idx]-last[idx])); }
    if(key||maxd>18) blocks.push({b,px}); }
  const n=bsz*bsz; const out=new Uint8Array(2+blocks.length*(1+n)); out[0]=u.frameNo; out[1]=key?1:0;
  blocks.forEach((bl,i)=>{ out[2+i*(1+n)]=bl.b; for(let k=0;k<n;k++) out[3+i*(1+n)+k]=bl.px[k]; });
  if(cls==='cmd'){ u.lastImg[level]=f; emit('cmd','IMD'+level,u.id,out,u.st); }                  // запрос кнопкой встаёт в очередь всегда
  else { u.pendingImg={level,f}; emit('bg','IMD'+level,u.id,out,u.st); }   // подписка: lastImg обновится, когда канал подтвердит приём кадра в передачу
}

// ---------- изучить / взаимодействовать ----------
// Обе команды — «подойди к объекту и сделай». Тело идёт к объекту; по прибытии выполняет и докладывает.
function findObj(u,id){ return objectsAround(u,100).find(o=>o.id===id); }
function beginAction(u,kind,id,item){
  if(!u.alive) return;
  if(kind==='put'&&id===0){ // сбросить на грунт: свёрток под ногами
    const has = item===42 ? u.sensors.camera : u.items.includes(item); if(!has){ evt(2,u.id); return; }
    if(item===42){ u.sensors.camera=false; u.sub.img.interval=0; } else u.items.splice(u.items.indexOf(item),1);
    const g=dropBundle(u.x,u.y,item);
    const t=encText(`сбросил: ${ITEMS[item]}.`); emit('cmd','ACT',u.id,new Uint8Array([g.id,0,t.length>>8,t.length&255,...t])); emit('cmd','CONT',u.id,new Uint8Array([g.id,1,item])); return; }
  const o=findObj(u,id); if(!o){ evt(16,u.id,id); return; }
  if(dist(u,o)>3 && beyondReturn(u,o)) return;
  u.pending={kind,id,item}; u.goal={x:o.x,y:o.y};
  if(dist(u,o)>3){ u.target={x:o.x,y:o.y}; evt(8,u.id); } else doPending(u);
}
function doPending(u){
  const p=u.pending; u.pending=null; if(!p) return; const o=findObj(u,p.id); if(!o){ evt(16,u.id,p.id); return; }
  const st=stateOf(o.id), cb=CODEBOOK[o.type]||CODEBOOK[250];
  const textReply=(kind,code,text)=>{ const t=encText(text); emit('cmd',kind,u.id,new Uint8Array([o.id,code,t.length>>8,t.length&255,...t])); };   // длина — 2 байта
  const sendCont=()=>{ if(isContainer(o)&&containerOpen(o)){ const c=contentsOf(o); emit('cmd','CONT',u.id,new Uint8Array([o.id,c.length,...c])); } };
  if(p.kind==='exam'){ textReply('EXAM',0,examText(o)); sendCont(); return; }
  if(p.kind==='take'||p.kind==='put'){
    if(!isContainer(o)||!containerOpen(o)){ textReply('ACT',1,'не контейнер.'); return; }
    const item=p.item;
    if(p.kind==='take'){ const c=contentsOf(o); if(!c.includes(item)){ textReply('ACT',1,`здесь нет: ${ITEMS[item]}.`); return; }
      removeItem(o,item);
      if(item===42){ u.sensors.camera=true; u.lastImg={}; } else u.items.push(item);
      textReply('ACT',0,`взял: ${ITEMS[item]}.`); sendCont(); return; }
    // put
    const has = item===42 ? u.sensors.camera : u.items.includes(item); if(!has){ textReply('ACT',1,`нечего положить: ${ITEMS[item]}.`); return; }
    if(item===42){ u.sensors.camera=false; u.sub.img.interval=0; } else u.items.splice(u.items.indexOf(item),1);
    if(o.unit){ const v=o.unit; if(item===42) v.sensors.camera=true; else v.items.push(item); } else (contents[o.id]=contents[o.id]||[]).push(item);
    textReply('ACT',0,`положил: ${ITEMS[item]}.`); sendCont(); return; }
  // взаимодействие: действие из текущего состояния; ответ — текст, составленный станцией
  const acts=cb.actions||[]; const a=acts.find(a=>a.from===st);
  if(!a){ textReply('ACT',1,'действий нет.'); return; }
  if(a.needs && !u.items.includes(a.needs)){ textReply('ACT',2,`не смог: ${a.fail||'нужен предмет'}`); return; }
  if(a.req && stateOf(a.req.obj)!==a.req.state){ textReply('ACT',3,`не смог: ${a.fail||'условие не выполнено'}`); return; }
  if(a.special==='boost') antennaBoost=6;
  if(a.special==='finale' && stOf(u).taskOpen){ stOf(u).taskOpen=false; setTimeout(()=>evt(17,u.id),1500/speed); }
  if(a.item===42){ u.sensors.camera=true; u.lastImg={}; } else if(a.item) u.items.push(a.item);
  objState[o.id]=a.to; textReply('ACT',0,withContents(o,`${a.verb}. ${(cb.states||[])[a.to]||''}`)); sendCont();
}

// ---------- команды (uplink) ----------
onmessage = e => {
  const m=e.data;
  if(m.t==='speed'){ speed=m.v; schedule(); return; }
  if(m.t==='link'){ for(const u of units) if(u.id in m.carriers){ const c=!!m.carriers[u.id]; u.carrier=c; u.snr=m.snr?m.snr[u.id]:0; if(c!==u.carrierNoted){ u.carrierFlipAt=u.carrierFlipAt??t; if(u.carrierNoted===undefined || t-u.carrierFlipAt>=1){ u.carrierNoted=c; u.carrierFlipAt=undefined; if(u.alive) note('unit',{unit:u.id,carrier:c,snr:+u.snr.toFixed(1),x:+u.x.toFixed(0),y:+u.y.toFixed(0)}); } } else u.carrierFlipAt=undefined; } return; }   // станция измеряет уровень сигнала каждого тела; миссионер сам слышит несущую — физика, не данные; заметка — когда состояние продержалось секунду
  if(m.t==='imgAck'){ const u=m.unit===0?stations[m.st||0].cam:units.find(u=>u.id===m.unit); if(u&&u.pendingImg&&u.pendingImg.level===m.level){ if(m.ok) u.lastImg[m.level]=u.pendingImg.f; u.pendingImg=null; } return; }
  if(m.t==='imgCancel'){ const u=m.unit===0?stations[m.st||0].cam:units.find(u=>u.id===m.unit); if(u){ u.pendingImg=null; delete u.lastImg[m.level]; } return; }   // кадр не дошёл: следующий на этом уровне — ключевой
  if(m.t==='tp'){ m.x=Math.max(BOUNDS.x0,Math.min(BOUNDS.x1,m.x)); m.y=Math.max(BOUNDS.y0,Math.min(BOUNDS.y1,m.y)); if(m.pack!==undefined){ const p=pack[m.pack]; if(p&&p.act!=='dead'){ p.x=m.x; p.y=m.y; p.target=null; p.act='idle'; p.told={v:'тп'}; note('debug',{tp:'О'+(m.pack+1),x:+m.x.toFixed(0),y:+m.y.toFixed(0)}); } return; }
    const u=units.find(u=>u.id===m.unit)||units[0]; if(u){ u.x=m.x; u.y=m.y; u.target=null; note('debug',{tp:u.id,x:+m.x.toFixed(0),y:+m.y.toFixed(0)}); } return; }
  if(m.t==='peek'){ const u=units.find(u=>u.id===m.unit)||units[0]; if(u) postMessage({t:'peekImg',unit:u.id,img:render(u,64)}); return; }   // отладка: чистый рендер мимо канала
  if(m.t==='intent'){ postMessage({t:'agentAck', id:m.id, line:m.text, ...intent(m.text)}); return; }   // намерение агента стаи: ответ принято / отказано с причиной
  if(m.t==='agentState'){ postMessage({t:'agentState', id:m.id, n:agentN, at:+t.toFixed(1), lines:agentState()}); return; }
  if(m.t==='save'){ postMessage({t:'state',data:snapshot()}); return; }
  if(m.t==='load'){ restore(m.data); catchUp(m.elapsed||0); return; }
  if(m.t!=='cmd') return;
  const S=stations[m.st||0]; if(!S) return;   // команда пришла по каналу этой станции
  const [cmd,arg,unit]=m.bytes; note('cmd',{st:S.k,cmd:CMD_NAMES[cmd]||cmd,arg,unit,bytes:Array.from(m.bytes.slice(3))});
  if(cmd===10){ // вырастить: arg = маска датчиков
    if(S.growing) { evt(2,0,0,S.k); return; }
    if(S.bioStock<=0){ evt(14,0,0,S.k); return; }
    const cam=!!(arg&1); if(cam && S.camInv<1){ evt(10,0,0,S.k); return; }
    if(cam) S.camInv--; S.bioStock--; S.growing={sensors:{camera:cam,sonar:!!(arg&2)},tLeft:180}; evt(11,0,0,S.k); return;
  }
  if(cmd===11){ // статус: паспорт станции текстом + пульс
    const own=units.filter(u=>u.st===S.k);
    const info=`${S.name}, посадочная платформа; штатно; миссия 39 л 211 д\nоператор: нет; последний сеанс 31 г 004 д назад\nплатформа: ${S.x.toFixed(0)}, ${S.y.toFixed(0)}; курс ${Math.round(S.ang*180/Math.PI)}°\nбиоматериал ${S.bioStock}; камер ${S.camInv}; развёрнуто ${own.length}\nвозврат: ПС-2, ${RETURN_R} м от узла; узлов ${nodes(S).length}\nзадача: ${S.taskOpen?'ПС-7 открыта 39 л 209 д — поиск М-07, не вернулся. Серия 0 исчерпана (7)':'ПС-7 закрыта'}`;
    emit('cmd','INFO',0,encText(info),S.k); heartbeat(S); return; }
  if(cmd===15){ S.hbInterval=arg; return; }
  const u=unit===0&&(cmd===3||cmd===16) ? S.cam : units.find(u=>u.id===unit); if(!u || u.st!==S.k) return;   // чужим телом эта станция не управляет
  if(u!==S.cam){
    if(!u.carrier){ evt(25,u.id); return; }                                              // станция не слышит тело — команда не дойдёт
    if(!u.alive && [1,6,7,8,17,18,19,20,21,22,23,24,25,26].includes(cmd)){ evt(24,u.id); return; }  // мёртвому — только приборы
  }
  switch(cmd){
    case 1: if(u.alive) describe(u); break;
    case 2: if(!u.sensors.sonar) evt(2,u.id); else if(u.charge<=0) evt(26,u.id); else { if(arg) u.sonarTilt=Math.max(-45,Math.min(45,arg-90)); sonar(u); } break;   // arg: наклон+90, 0 — горизонт (старый формат)
    case 3: if(u.sensors.camera && u.charge<=0) evt(26,u.id); else if(u.sensors.camera && u.charge>0){ if(m.bytes[3]) imageDelta(u,Math.min(3,arg),'cmd'); else imagePyramid(u,Math.min(3,arg),'cmd'); } break;
    case 16: if(u.sensors.camera){ u.sub.img={interval:arg,level:Math.min(3,m.bytes[3]),delta:!!m.bytes[4]}; u.subT.img=0; u.lastImg={}; } break;
    case 17: if(u.alive){ u.target=null; u.pending=null; if(u.reflex===6) u.reflex=0; evt(15,u.id); } break;   // стоп снимает и бегство: оператор видит больше тела
    case 21: { const item=arg, toUnit=!!m.bytes[3]; if(!atAirlock(u)){ evt(2,u.id); break; }
      if(item===42){ if(toUnit){ if(S.camInv>0&&!u.sensors.camera){ S.camInv--; u.sensors.camera=true; u.lastImg={}; evt(20,u.id,42); } else evt(2,u.id); } else { if(u.sensors.camera){ u.sensors.camera=false; u.sub.img.interval=0; S.camInv++; evt(19,u.id,42); } else evt(2,u.id); } }
      else { if(toUnit){ if(S.store[item]>0){ S.store[item]--; u.items.push(item); evt(20,u.id,item); } else evt(2,u.id); } else { const i=u.items.indexOf(item); if(i>=0){ u.items.splice(i,1); S.store[item]++; evt(19,u.id,item); } else evt(2,u.id); } }
      heartbeat(S); break; }
    case 22: beginAction(u,'put',m.bytes[3],arg); break;    // положить: [22,item,unit,objId] (objId 0 — на грунт)
    case 23: beginAction(u,'take',m.bytes[3],arg); break;   // взять:    [23,item,unit,objId]
    case 20: if(u.alive && arg===40 && u.items.includes(40)){ u.items.splice(u.items.indexOf(40),1); u.glucose=Math.min(100,u.glucose+50); u.electro=Math.min(100,u.electro+20); evt(18,u.id); } else evt(2,u.id); break;   // съесть брикет   // стоп: цель остаётся, тело стоит
    case 6: if(u.alive){ const g=decPos(m.bytes,3); if(beyondReturn(u,g)) break; u.goal={x:g.x,y:g.y}; const {x,y}=outsideHulls(g.x,g.y,u); u.target={x,y}; u.bestD=undefined; u.stuck=0; u.pending=null; u.lastImg={}; evt(8,u.id); } break;   // идти: цель = точка, тело идёт и смотрит туда
    case 18: { const {x,y}=decPos(m.bytes,3); u.goal={x,y}; u.lastImg={}; break; }   // смотреть: повернуть голову к точке, не идя
    case 7: if(u.alive && [1,3,4].includes(arg)){ u.mode=arg; if(arg===3){ const sp=S.spawn; u.target={x:sp.x,y:sp.y}; u.goal={x:sp.x,y:sp.y}; u.pending=null; } if(arg===4) u.target=null; evt(7,u.id,arg); } break;
    case 24: if(u.alive){ u.stealth=!!arg; evt(32,u.id,arg?1:0); } break;   // скрытность — настройка; действует, пока нет рефлекса
    case 25: if(u.alive){ u.stance=Math.min(2,arg); evt(33,u.id,u.stance); } break;   // стойка при контакте
    case 26: if(u.alive){ u.autonomy=Math.min(2,arg); evt(35,u.id,u.autonomy); } break;   // инструкция на потерю несущей: 0 продолжать, 1 стоп, 2 к шлюзу
    case 8: beginAction(u,'act',arg); break;
    case 19: beginAction(u,'exam',arg); break;
    case 9: u.txDbm=arg-20; evt(8,u.id,9); break;
    case 12: u.sub.tlm=arg; break;        // интервал телеметрии, с (0 = выкл)
    case 13: u.sub.sonar=arg; u.subT.sonar=0; break;
    case 14: u.sub.desc=arg; u.subT.desc=0; break;
  }
};

// ---------- сохранение мира ----------
function snapshot(){
  const su=units.map(u=>{ const o={...u}; delete o.lastImg; delete o.pendingImg; return o; });
  const ss=stations.map(S=>{ const {cam,...o}=S; return {...o, camSub:cam.sub}; });   // геометрия платформы — из уровня, но в снимке тоже: так проще читать
  return { t, nextUnit, msgId, objState, contents, ground, nextGround, pack:pack.map(p=>({...p})), antennaBoost, units:su, stations:ss };
}
function restore(d){
  t=d.t; nextUnit=d.nextUnit; msgId=d.msgId; for(const k in objState) delete objState[k]; Object.assign(objState,d.objState);
  if(d.pack) d.pack.forEach((s,i)=>{ if(pack[i]) Object.assign(pack[i],s,{i}); }); antennaBoost=d.antennaBoost;
  units.length=0; for(const su of d.units){ const u={st:0, stealth:false, stance:0, reflex:0, carrierNoted:true, ...su, lastImg:{}, pendingImg:null}; if(u.mode===2){ u.mode=1; u.stealth=true; } if(u.mode===5){ u.mode=1; u.stance=2; } units.push(u); }
  for(const sd of d.stations||[]){ const S=stations[sd.k]; if(!S) continue; const {camSub,cam,...o}=sd; Object.assign(S,o,{k:S.k}); if(camSub) S.cam.sub=camSub; S.cam.lastImg={}; S.cam.pendingImg=null; }
  if(d.contents){ for(const k in contents) delete contents[k]; Object.assign(contents,d.contents); } if(d.ground){ ground.length=0; ground.push(...d.ground); nextGround=d.nextGround||100; }
}
// Мир жил без оператора: досчитываем прошедшее время (не больше 8 часов), ничего не передавая
let muted=false;
function catchUp(sec){ const n=Math.min(sec,8*3600)/DT; muted=true; for(let i=0;i<n;i++) tick(); muted=false; }

// ---------- тик ----------
function tick(){
  const dt=DT; t+=dt;
  for(const S of stations){ const own=units.filter(u=>u.st===S.k);
    // тупик: живых нет, биоматериала нет, ничего не растёт — станция закрывает серию
    if(S.taskOpen && !S.seriesClosed && own.length && !own.some(u=>u.alive) && S.bioStock<=0 && !S.growing){ S.seriesClosed=true; note('station',{st:S.k,series:'closed'}); setTimeout(()=>evt(27,0,0,S.k),2000/speed); }
    if(S.growing){ S.growing.tLeft-=dt; if(S.growing.tLeft<=0){ const u=spawn(S.growing.sensors,S); S.growing=null; evt(6,u.id); } } }
  packTick(); for(const S of stations) turretTick(S,dt);
  for(const u of units){
    if(u.alive){
      if(!u.carrier){ u.linkLostFor+=dt; if(u.linkLostFor>LINK_LOST_S && !u.autoDone){ u.autoDone=true; note('unit',{unit:u.id,autonomy:u.autonomy,x:+u.x.toFixed(0),y:+u.y.toFixed(0)}); if(u.autonomy===1) u.target=null; if(u.autonomy===2){ const sp=stOf(u).spawn; u.target={x:sp.x,y:sp.y}; u.mode=3; } } }
      else { u.linkLostFor=0; u.autoDone=false; }
      u.lightOn=!(u.stealth && !u.reflex);
      const sp=speedFor(u);
      if(u.target && sp>0){ const d=dist(u,u.target); if(d<(u.pending?2.5:0.5)){ u.target=null; u.exertion=0; u.stuck=0; u.bestD=undefined; if(u.pending) doPending(u); else if(u.mode!==3 && u.reflex!==6) evt(1,u.id); }
        else { u.heading=Math.atan2(u.target.y-u.y,u.target.x-u.x); stepBody(u,sp*dt); u.exertion=Math.min(1,sp/1.4);
          // застревание — по продвижению: за 4 с не приблизился к цели на метр → стоп
          u.stuck=(u.stuck||0)+dt; if(u.stuck>=4){ const d2=dist(u,u.target); if(u.bestD!==undefined && u.bestD-d2<1){ u.stuck=0; u.bestD=undefined; u.target=null; u.pending=null; u.exertion=0; evt(23,u.id); note('unit',{unit:u.id,stuck:true,x:+u.x.toFixed(1),y:+u.y.toFixed(1),slope:+TER.slope(u.x,u.y).toFixed(2)}); } else { u.bestD=d2; u.stuck=0; } } } } else u.exertion=0;
      stanceTick(u,dt); if(u.reflex===5) fightBack(u);
      // страх: ближайшая бодрствующая особь (уходящая не в счёт) и крики рядом — звук тело слышит, слов не разбирает
      let fearT=0; for(const p of pack){ const w=p.act==='attack'||p.act==='approach'?1:p.act==='sleep'||p.act==='dead'||p.act==='flee'||p.act==='home'?0:0.5; if(w) fearT=Math.max(fearT,w*(1-dist(u,p)/80)); }
      u.startle=Math.max(0,(u.startle||0)-dt*0.1); fearT=Math.min(1,fearT+0.5*u.startle); u.fear+=(fearT-u.fear)*dt/2; u.pain=Math.max(0,u.pain-dt/8);
      const rest=u.mode===4; const pulseT=60+55*u.exertion+95*u.fear+45*u.pain-(rest?8:0); u.pulse+=(pulseT-u.pulse)*dt/3;
      u.glucose-=dt*0.003*(1+2*u.exertion+u.fear);   // покой ~9 ч, ходьба ~3 ч
      u.electro-=dt*0.002*(1+u.exertion);
      const inT=tunnelT(u.x,u.y)>=0; u.toxin=Math.max(0,Math.min(100,u.toxin+dt*(inT?0.06:-0.02)));   // шкала 0…100, как у остальных; последствий пока нет (roadmap)
      u.psyche=Math.max(0,Math.min(100,u.psyche+dt*(rest?0.05:-(0.01+0.15*u.fear+(inT&&!u.lightOn?0.04:0)))));
      u.cons=0.6+0.8*u.exertion+Math.pow(10,u.txDbm/10)*0.4+(u.lightOn?0.2:0)+(u.sub.img.interval?0.3:0)-(rest?0.4:0); u.gen=0.8-0.3*u.fear;
      u.charge=Math.max(0,Math.min(100,u.charge+(u.gen-u.cons)*dt*0.01));   // ходьба с фонарём: ~3 ч; стоя — почти ровно; отдых восстанавливает
      if(LAB){ u.glucose=u.electro=u.charge=100; }
      if(u.skin<=0||u.bone<=0||u.glucose<=0||u.charge<=0){ u.alive=false; u.target=null; evt(5,u.id); note('unit',{unit:u.id,dead:u.skin<=0?'skin':u.bone<=0?'bone':u.glucose<=0?'glucose':'charge',skin:+u.skin.toFixed(0),bone:+u.bone.toFixed(0),glucose:+u.glucose.toFixed(0),charge:+u.charge.toFixed(0),psyche:+u.psyche.toFixed(0),x:+u.x.toFixed(0),y:+u.y.toFixed(0)}); }
      if(u.sub.tlm){ u.tlmTimer+=dt; if(u.tlmTimer>=u.sub.tlm){ u.tlmTimer=0; emit('bg','TLM',u.id,telemetry(u)); } }
      if(u.sub.desc){ u.subT.desc+=dt; if(u.subT.desc>=u.sub.desc){ u.subT.desc=0; describe(u,'bg'); } }
    } else {
      u.cons=u.charge>0?(u.sub.img.interval?0.3:0.04):0; u.gen=0;
      u.charge=Math.max(0,u.charge-dt*(u.sub.img.interval?0.03:0.004));   // приборы на теле сидят на остатке заряда
    }
    if(u.sub.sonar && u.sensors.sonar && u.charge>0){ u.subT.sonar+=dt; if(u.subT.sonar>=u.sub.sonar){ u.subT.sonar=0; sonar(u,'bg'); } }
    if(u.sub.img.interval && u.sensors.camera && u.charge>0){ u.subT.img+=dt; if(u.subT.img>=u.sub.img.interval){ u.subT.img=0; if(u.sub.img.delta) imageDelta(u,u.sub.img.level); else imagePyramid(u,u.sub.img.level,'bg'); } }
  }
  for(const S of stations){ const u=S.cam; if(u.sub.img.interval){ u.subT.img+=dt; if(u.subT.img>=u.sub.img.interval){ u.subT.img=0; if(u.sub.img.delta) imageDelta(u,u.sub.img.level); else imagePyramid(u,u.sub.img.level,'bg'); } }
    if(S.hbInterval){ S.hbTimer+=dt; if(S.hbTimer>=S.hbInterval){ S.hbTimer=0; heartbeat(S); } } }
  if(muted) return;
  postMessage({ t:'phys', extraGain:antennaBoost,
    units:units.map(u=>{ const S=stOf(u); return {id:u.id, st:u.st, dist:Math.max(1,Math.hypot(u.x-S.x,u.y-S.y)), obstDb:obstDb(u), txDbm:u.charge>0?u.txDbm:-99, alive:u.alive}; }),   // без заряда передатчик молчит; расстояние — до своей станции
    dbg:truth() });
}
// правда о мире (игрок этого не видит): в отладочную шторку каждый такт, в лог мира раз в секунду — по ней спектатор проигрывает сеанс
const r1=v=>+v.toFixed(1), r2=v=>+v.toFixed(2), xy=p=>p?[r1(p.x),r1(p.y)]:null;
function truth(){ return {
  units:units.map(u=>({id:u.id,st:u.st,x:r1(u.x),y:r1(u.y),h:r2(u.heading),alive:u.alive,mode:u.mode,stealth:u.stealth,stance:u.stance,reflex:u.reflex,light:u.lightOn,tg:xy(u.target),
    pulse:Math.round(u.pulse),skin:Math.round(u.skin),bone:Math.round(u.bone),glu:Math.round(u.glucose),chg:Math.round(u.charge),psy:Math.round(u.psyche),fear:r2(u.fear),car:u.carrier,items:u.items,cam:u.sensors.camera})),
  stations:stations.map(S=>({k:S.k,name:S.name,x:S.x,y:S.y,ang:S.ang,team:S.team,bio:S.bioStock,power:S.power,turret:S.turret?{x:r1(S.turret.x),y:r1(S.turret.y),ang:r2(S.turret.ang),fov:r2(S.turret.fov),range:S.turret.range,on:!!S.turret.on,tgt:S.turret.tgt,aim:r1(S.turret.aimT),rel:r1(S.turret.reloadT)}:null})),
  pack:pack.map(p=>({i:p.i,x:r1(p.x),y:r1(p.y),h:r2(p.heading),act:p.act,hp:p.hp,fear:r2(p.fear),tired:r2(p.tired),nerve:r2(nerve(p)),size:p.size,tg:xy(p.target),foe:p.foe&&foeOf(p)?[...xy(p.foe),p.foe.u]:null,told:p.told?p.told.v:null,item:p.item||null,lit:p.lit!==undefined&&t-p.lit<0.6,why:p.why,rest:r1(p.rest),hold:r1(p.hold)})),
  ground:ground.map(g=>({id:g.id,x:g.x,y:g.y,items:contents[g.id]||[]})),
  cries:cries.filter(c=>t-c.t<4).map(c=>({x:c.x,y:c.y,word:c.word,age:+(t-c.t).toFixed(1)})) }; }
// расщелина и ориентиры — один раз при старте
postMessage({ t:'level', canyon:{pts:LEVEL.canyon.pts, branch:LEVEL.canyon.branch.pts}, pois:[...POIS,...SPOIS].map(p=>({id:p.id,x:p.x,y:p.y})), stations:stations.map(S=>({k:S.k,name:S.name,x:S.x,y:S.y,ang:S.ang})) });
let timer=null; function schedule(){ if(timer) clearInterval(timer); timer=setInterval(tick, DT*1000/speed); } schedule();

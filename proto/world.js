// МИР. Web Worker. Ничего не знает о консоли.
// Наружу: (а) байтовые сообщения для канала, (б) физика линии по каждому миссионеру.
const LAB=/&lab\b/.test(self.location.search);   // лаборатория лидара: существо спит, тело не умирает; остальное — как в игре
const VER=self.location.search.replace(/^\?v=/,'').replace(/&.*$/,'')||'0'; importScripts('level.js?v='+VER,'codebook.js?v='+VER,'terrain.js?v='+VER,'camera.js?v='+VER);
const NST=Math.max(1,Math.min(LEVEL.stations.length,+(/&st=(\d+)/.exec(self.location.search)||[])[1]||1));   // сколько платформ поднято: решает хост (одиночная игра — одна)
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
// Общее — мир: рельеф, ориентиры, предметы, существо, мачта с усилителем. Шлюз станции — ориентир id 240+k, его подобъекты — 160+k·4+i.
const stations = LEVEL.stations.slice(0,NST).map((L,k)=>{ const ang=(L.ang||0)*Math.PI/180; const a={x:L.airlock.x,y:L.airlock.y};
  const dx=a.x-L.x, dy=a.y-L.y, d=Math.hypot(dx,dy)||1, ox=dx/d, oy=dy/d;   // наружу — от центра корпуса к шлюзу
  return { k, name:'ARK-04'+(1+k), x:L.x, y:L.y, ang, spawn:{...L.spawn}, airlock:a,
    subs:L.subs.slice(0,4).map(s=>[s.type,s.dx,s.dy,s.f===undefined?undefined:s.f*Math.PI/180]),
    bioStock:4, camInv:0, store:{40:0,41:0}, power:100, growing:null, taskOpen:true, hbTimer:0, hbInterval:2,
    // стационарная камера у шлюза: смотрит от люка наружу, сигнала не требует — она на станции
    cam:{ id:0, st:k, x:a.x-4*ox, y:a.y-4*oy, heading:Math.atan2(oy,ox), goal:{x:a.x+44*ox-8*oy,y:a.y+44*oy+8*ox}, lightOn:true, charge:100, alive:true, lastImg:{}, pendingImg:null, frameNo:0, sensors:{camera:true}, sub:{img:{interval:0,level:2,delta:true}}, subT:{img:0}, items:[] } }; });
const SPOIS = stations.map(S=>({ id:240+S.k, x:S.airlock.x, y:S.airlock.y, subs:S.subs, station:S, idBase:160+S.k*4 }));
function stOf(u){ return stations[u.st]||stations[0]; }
// ПС-2, радиус гарантированного возврата: цель дальше RETURN_R от ближайшего узла (своя станция, работающий ретранслятор) станция не принимает —
// потеря биоматериала гарантирована. Бюджет линии (дБ) к границе не привязан: далеко уйти можно, если есть узел
const RETURN_R = 500;
function nodes(S){ const n=[{x:S.x,y:S.y}]; if(antennaBoost) n.push(poi(3)); return n; }   // ретранслятор — мачта (ориентир 3) с включённым усилителем
function nodeDist(S,p){ return Math.min(...nodes(S).map(n=>dist(p,n))); }
function beyondReturn(u,p){ const d=nodeDist(stOf(u),p); if(d<=RETURN_R) return false; evt(28,u.id,Math.min(255,Math.ceil(d/10))); return true; }   // отказ: arg — расстояние до узла, десятки метров
const HULLS = [ ...stations.map(S=>({x:S.x,y:S.y,rx:STATION.rx,ry:STATION.ry,ang:S.ang,h:STATION.h})), ...LEVEL.hulls.map(h=>({...h})) ];   // корпуса платформ (эллипс из кодовой книги), корпуса уровня (круги: обломки): непроходимы и отражают лидар; остальное — рельеф
// точка внутри корпуса (с запасом pad); луч в корпус: эллипс приводится к единичному кругу, параметр t — в метрах по лучу
function hullIn(x,y,c,pad=0){ if(c.r!==undefined) return Math.hypot(x-c.x,y-c.y)<c.r+pad; const ca=Math.cos(c.ang), sa=Math.sin(c.ang), lx=(x-c.x)*ca+(y-c.y)*sa, ly=-(x-c.x)*sa+(y-c.y)*ca; return (lx/(c.rx+pad))**2+(ly/(c.ry+pad))**2<1; }
function rayHull(ox,oy,dx,dy,c){ if(c.r!==undefined) return rayCircle(ox,oy,dx,dy,c); const ca=Math.cos(c.ang), sa=Math.sin(c.ang); const fx=((ox-c.x)*ca+(oy-c.y)*sa)/c.rx, fy=(-(ox-c.x)*sa+(oy-c.y)*ca)/c.ry, ex=(dx*ca+dy*sa)/c.rx, ey=(-dx*sa+dy*ca)/c.ry;
  const a=ex*ex+ey*ey, b=2*(fx*ex+fy*ey), cc=fx*fx+fy*fy-1, D=b*b-4*a*cc; if(D<0) return Infinity; const s=Math.sqrt(D), t1=(-b-s)/(2*a), t2=(-b+s)/(2*a); if(t1>0) return t1; if(t2>0) return t2; return Infinity; }
// t ∈ [0,1] — доля пути вглубь расщелины, −1 — снаружи. Дальше от входа — глубже, сильнее затухание радио
function tunnelT(x,y){ const c=TER.inside(x,y); return c && c.along>0 ? Math.min(1,c.along/TER.LEN) : -1; }
function inCorridor(x,y,margin=0){ return !!TER.inside(x,y,margin); }
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
function isContainer(o){ if(o.unit) return !o.unit.alive; const cb=CODEBOOK[o.type]; return !!cb && cb.container!==undefined; }
function containerOpen(o){ if(o.unit) return true; const cb=CODEBOOK[o.type]; return stateOf(o.id)>=cb.container; }
function contentsOf(o){ if(o.unit){ const v=o.unit; return [...(v.sensors.camera?[42]:[]), ...v.items]; } return contents[o.id]||[]; }
const units = []; let nextUnit = 1;
function spawn(sensors,S){
  const u = { id:nextUnit++, st:S.k, alive:true, x:S.spawn.x, y:S.spawn.y, heading:0, target:null, mode:1, lightOn:true,
    pulse:72, glucose:92, electro:96, toxin:0, skin:100, bone:100, psyche:88, charge:100, gen:0.8, cons:1.0,
    fear:0, pain:0, exertion:0, txDbm:0, dmgTimer:0, atkTimer:0,
    sensors:{ camera:!!sensors.camera, sonar:!!sensors.sonar },
    tlmTimer:Math.random(), carrier:true, linkLostFor:0, autoDone:false, autonomy:0,
    sub:{ tlm:1, sonar:0, desc:0, img:{interval:0,level:2,delta:true} }, goal:null, items:[], pending:null, subT:{ sonar:0, desc:0, img:0 }, lastImg:{}, pendingImg:null, frameNo:0 };
  units.push(u); return u;
}
for(const S of stations) spawn({camera:true, sonar:true},S);          // первый миссионер каждой станции уже готов и несёт её единственную камеру
const creature = { x:LEVEL.creature.home.x, y:LEVEL.creature.home.y, home:{...LEVEL.creature.home}, lair:{...LEVEL.creature.lair}, awake:false, hp:3, fleeing:false, cooldown:0 };   // после отпора уходит в логово и не трогает 2 минуты
let antennaBoost = 0;

function speedFor(m){ return m===2?0.6 : m===3?2.6 : m===4?0 : m===5?1.0 : 1.4; }
function detectRadius(m){ return m===2?6 : m===4?35 : 70; }   // без фонаря почти не замечает: идёт на свет

// ---------- столкновения: тело не проходит сквозь корпус, скалы и стены тоннеля; вдоль препятствия скользит ----------
const BODY_R = 0.6;
const MAX_SLOPE=0.84;   // tg 40°: круче тело не идёт — стены расщелины, обрыв; дюны, осыпь, завал проходимы
function blocked(x,y,fromX,fromY){
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
  if(!blocked(u.x+dx,u.y+dy,u.x,u.y)){ u.x+=dx; u.y+=dy; return true; }
  // скольжение: пробуем повернуть шаг на ±45°, ±90°
  for(const a of [Math.PI/4,-Math.PI/4,Math.PI/2,-Math.PI/2]){ const h=u.heading+a, sx=Math.cos(h)*len, sy=Math.sin(h)*len; if(!blocked(u.x+sx,u.y+sy,u.x,u.y)){ u.x+=sx; u.y+=sy; return true; } }
  return false;
}

// ---------- сообщения наружу ----------
// st — станция-адресат: её оператор(ы) и получают сообщение; по умолчанию — станция тела
function emit(cls, kind, unit, payload, st){ if(st===undefined){ const u=units.find(u=>u.id===unit); st=u?u.st:0; } if(muted){ msgId++; return; } postMessage({ t:'msg', id:msgId++, st, cls, kind, unit, payload }); }
function evt(code, unit=0, arg=0, st){ emit('cmd','EVT', unit, new Uint8Array([code,arg]), st); }
function emitAuto(kind, unit, payload){ emit('bg', kind, unit, payload); }   // периодические подписки идут фоном

// ---------- телеметрия миссионера (16 байт) ----------
function telemetry(u){
  const b=new Uint8Array(16), c=v=>Math.max(0,Math.min(255,Math.round(v)));
  b[0]=c(u.pulse); b[1]=c(u.electro); b[2]=c(u.glucose); b[3]=c(u.toxin); b[4]=c(u.skin); b[5]=c(u.bone); b[6]=c(u.psyche);
  b[7]=(creature.awake && dist(u,creature)<90)?1:0;
  b[8]=c(u.cons*50); b[9]=c(u.charge*2.55); b[10]=c(u.gen*50);
  const [xh,xl,yh,yl]=posBytes(u); b[11]=xh; b[12]=xl; b[13]=yh; b[14]=yl; b[15]=u.mode;
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
  if(dist(u,creature)<=Math.min(maxR,60)) out.push({id:250,type:250,x:creature.x,y:creature.y,creature:true});
  return out;
}
// Станция составляет текст сама — из базы знаний и текущего состояния мира.
function nameOf(o){
  if(o.creature) return creature.awake ? 'существо, класс не определён' : 'объект, класс не определён';
  if(o.unit){ const v=o.unit, who=v.st===o.viewer.st?'':`, ${stOf(v).name}`; return v.alive ? `миссионер М${v.id}${who}` : `тело М${v.id}${who}`; }
  if(o.station) return o.station.k===o.viewer.st ? 'шлюз станции' : `шлюз ${o.station.name}`;
  if(o.type===28) return (contents[o.id]||[]).length ? 'резак на камне' : 'плоский камень';
  return (CODEBOOK[o.type]||CODEBOOK[250]).name;
}
function examText(o){
  if(o.creature) return creature.awake ? 'Двуногое. Кожа с тем же рисунком пор, что у миссионера. Смотрит.' : 'Двуногое, лежит. Дышит. Кожа с тем же рисунком пор, что у миссионера.';
  if(o.unit){ const v=o.unit; if(v.alive) return `${v.st===o.viewer.st?'Наш.':'Той же серии, платформа '+stOf(v).name+'.'} ${v.target?'Идёт.':'Стоит.'} Пульс на вид ${v.pulse<100?'ровный':'частый'}.`; return withContents(o,'Не двигается.'); }
  const cb=CODEBOOK[o.type]||CODEBOOK[250]; return withContents(o,(cb.states||[])[stateOf(o.id)]||'');
}
function withContents(o,text){ if(!isContainer(o)||!containerOpen(o)) return text; const c=contentsOf(o); return text+(c.length?' Здесь: '+c.map(i=>ITEMS[i]).join(', ')+'.':' Пусто.'); }
function classOf(o){ return o.creature?2 : o.unit?(o.unit.alive?4:3) : o.landmark?1 : 0; }
function describe(u, cls='cmd'){
  const objs=objectsAround(u,100); const parts=[];
  for(const o of objs){ const t=encText(nameOf(o)); parts.push([o.id&255, classOf(o), Math.round(bearingDeg(u,o)/2), Math.min(255,Math.round(dist(u,o))), t.length, ...t]); }
  emit(cls,'DESC',u.id,new Uint8Array([...posBytes(u),...parts.flat()]));   // первые 4 байта — где снято
}
function posBytes(u){ const c=v=>Math.max(0,Math.min(65535,Math.round(v*10)+32768)), x=c(u.x), y=c(u.y); return [x>>8,x&255,y>>8,y&255]; }   // дециметры, 16 бит: ±3276 м, за пределом — край, не заворот
function decPos(b,o){ return { x:(((b[o]<<8)|b[o+1])-32768)/10, y:(((b[o+2]<<8)|b[o+3])-32768)/10 }; }
function rayCircle(ox,oy,dx,dy,c){ const fx=ox-c.x, fy=oy-c.y; const b=2*(fx*dx+fy*dy), cc=fx*fx+fy*fy-c.r*c.r; const D=b*b-4*cc; if(D<0) return Infinity; const s=Math.sqrt(D); const t1=(-b-s)/2, t2=(-b+s)/2; if(t1>0) return t1; if(t2>0) return t2; return Infinity; }
// что отражает лидар: только тела с объёмом (радиус, м); следы, надписи, кабели, вода — нет
const SONAR_R={13:0.8,14:0.8,17:0.3,18:0.6,20:1.5,21:0.15,22:0.4,23:3,28:0.4,29:1.5,32:0.2,33:0.3};   // люки и прожектор — часть корпуса, он отражает сам
// Лидар: 64 луча по кругу под наклоном tilt° к горизонту с высоты SONAR_H над грунтом; на луч — байт наклонной дальности
// и бит «сплошное». Бит — измерение, а не подсказка мира: на каждый азимут датчик даёт второй луч на SONAR_DT выше, две точки
// попадания лежат на поверхности, и крутизна хорды между ними — уклон поверхности вдоль луча. Хорда круче MAX_SLOPE (40°, куда
// тело не пройдёт) — «сплошное»: стены, обрыв, корпус. Вертикальная стена вертикальна с любого азимута; склон наискось кажется положе.
// Наклон вниз даёт эхо от грунта: подъём впереди укорачивает дальность, понижение удлиняет — профиль рельефа за те же байты.
// Пакет: [x,y съёмки (4), наклон+90 (1), высота датчика (2), маска (8), дальности (64)] = 79 Б
const SONAR_H=1.7, SONAR_DT=3*Math.PI/180;   // высота датчика над грунтом (голова; глаза камеры — 1,6) и разнос пары лучей по вертикали
const OBJ_H={13:1,14:1,17:7,18:1.8,20:0.7,21:1.1,22:0.5,23:4,28:0.4,29:1.4,32:0.25,33:0.4};   // высота отражателя, м; тела и существо — 1,6 / 0,5
// декорации (`TER.decor`) отражают тоже — кадр и лидар видят одно: радиус футпринта в долях высоты спрайта `Hs`, высота — `Hs`;
// сухостой — нет (тонкие стебли), столбик кабеля — 8 см, луч в него почти не попадает
const DECOR_R={boulder:0.45,boulder2:0.5,rocks:0.8,outcrop:0.6,hoodoo:0.3,debris:0.6,cairn:0.4,post:0};
function decorR(o){ return o.type==='post'?0.08:(DECOR_R[o.type]||0)*o.Hs; }
// один луч: первое препятствие по направлению (ca,sa) под наклоном tilt; возвращает наклонную дальность (100 — нет эха) и точку попадания
function castRay(u,z0,ca,sa,tilt,objs){ const ch=Math.cos(tilt), sh=Math.sin(tilt), dx=ca*ch, dy=sa*ch; const hitZ=(t)=>z0+sh*t; let best=100;   // dx,dy — шаг по горизонтали на метр наклонной дальности
  for(const c of HULLS){ const t=rayHull(u.x,u.y,ca,sa,c)/ch; if(t<best && hitZ(t)<TER.H(c.x,c.y)+c.h) best=t; }
  for(let t=0.5;t<best;t+=0.5){ const px=u.x+dx*t, py=u.y+dy*t; if(hitZ(t)<=TER.H(px,py)){ let lo=t-0.5, hi=t; for(let k=0;k<5;k++){ const m=(lo+hi)/2; if(hitZ(m)<=TER.H(u.x+dx*m,u.y+dy*m)) hi=m; else lo=m; } best=hi; break; } }
  for(const o of objs){ if(o.landmark) continue; const r=o.creature?0.5:o.unit?0.5:o.decor?decorR(o):(SONAR_R[o.type]||0); if(!r) continue; const t=rayCircle(u.x,u.y,ca,sa,{x:o.x,y:o.y,r})/ch; const oh=o.creature?(creature.awake?1.6:0.6):o.unit?(o.unit.alive?1.8:0.5):o.decor?o.Hs:(OBJ_H[o.type]||1);
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
    let type=o.type; if(o.creature) type=creature.awake?250:'sleep'; if(o.unit) type=o.unit.alive?(o.unit.target?'walk':252):251;
    if(!SPRITES[type]) continue; const facing=o.unit?o.unit.heading:(o.creature?Math.atan2(u.y-o.y,u.x-o.x):o.facing);   // тела смотрят по курсу, существо — на камеру, объекты — по уровню
    out.push({id:o.id,type,x:o.x,y:o.y,facing}); }
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
    const g={id:nextGround++, x:Math.round(u.x), y:Math.round(u.y)}; if(nextGround>199) nextGround=100; ground.push(g); contents[g.id]=[item];
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
      if(o.unit){ const v=o.unit; if(item===42){ v.sensors.camera=false; v.sub.img.interval=0; } else v.items.splice(v.items.indexOf(item),1); } else { const arr=contents[o.id]; arr.splice(arr.indexOf(item),1); if(o.type===33&&!arr.length){ ground.splice(ground.findIndex(g=>g.id===o.id),1); delete contents[o.id]; } }
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
  if(m.t==='link'){ for(const u of units) if(u.id in m.carriers){ u.carrier=!!m.carriers[u.id]; u.snr=m.snr?m.snr[u.id]:0; } return; }   // станция измеряет уровень сигнала каждого тела   // миссионер сам слышит несущую станции — физика, не данные
  if(m.t==='imgAck'){ const u=m.unit===0?stations[m.st||0].cam:units.find(u=>u.id===m.unit); if(u&&u.pendingImg&&u.pendingImg.level===m.level){ if(m.ok) u.lastImg[m.level]=u.pendingImg.f; u.pendingImg=null; } return; }
  if(m.t==='autonomy'){ const u=units.find(u=>u.id===m.unit); if(u) u.autonomy=m.v; return; }
  if(m.t==='tp'){ const u=units.find(u=>u.id===m.unit)||units[0]; if(u){ u.x=m.x; u.y=m.y; u.target=null; } return; }
  if(m.t==='peek'){ const u=units.find(u=>u.id===m.unit)||units[0]; if(u) postMessage({t:'peekImg',unit:u.id,img:render(u,64)}); return; }   // отладка: чистый рендер мимо канала
  if(m.t==='save'){ postMessage({t:'state',data:snapshot()}); return; }
  if(m.t==='load'){ restore(m.data); catchUp(m.elapsed||0); return; }
  if(m.t!=='cmd') return;
  const S=stations[m.st||0]; if(!S) return;   // команда пришла по каналу этой станции
  const [cmd,arg,unit]=m.bytes;
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
    if(!u.alive && [1,6,7,8,17,18,19,20,21,22,23].includes(cmd)){ evt(24,u.id); return; }  // мёртвому — только приборы
  }
  switch(cmd){
    case 1: if(u.alive) describe(u); break;
    case 2: if(!u.sensors.sonar) evt(2,u.id); else if(u.charge<=0) evt(26,u.id); else { if(arg) u.sonarTilt=Math.max(-45,Math.min(45,arg-90)); sonar(u); } break;   // arg: наклон+90, 0 — горизонт (старый формат)
    case 3: if(u.sensors.camera && u.charge<=0) evt(26,u.id); else if(u.sensors.camera && u.charge>0){ if(m.bytes[3]) imageDelta(u,Math.min(3,arg),'cmd'); else imagePyramid(u,Math.min(3,arg),'cmd'); } break;
    case 16: if(u.sensors.camera){ u.sub.img={interval:arg,level:Math.min(3,m.bytes[3]),delta:!!m.bytes[4]}; u.subT.img=0; u.lastImg={}; } break;
    case 17: if(u.alive){ u.target=null; u.pending=null; evt(15,u.id); } break;
    case 21: { const item=arg, toUnit=!!m.bytes[3]; if(!atAirlock(u)){ evt(2,u.id); break; }
      if(item===42){ if(toUnit){ if(S.camInv>0&&!u.sensors.camera){ S.camInv--; u.sensors.camera=true; u.lastImg={}; evt(20,u.id,42); } else evt(2,u.id); } else { if(u.sensors.camera){ u.sensors.camera=false; u.sub.img.interval=0; S.camInv++; evt(19,u.id,42); } else evt(2,u.id); } }
      else { if(toUnit){ if(S.store[item]>0){ S.store[item]--; u.items.push(item); evt(20,u.id,item); } else evt(2,u.id); } else { const i=u.items.indexOf(item); if(i>=0){ u.items.splice(i,1); S.store[item]++; evt(19,u.id,item); } else evt(2,u.id); } }
      heartbeat(S); break; }
    case 22: beginAction(u,'put',m.bytes[3],arg); break;    // положить: [22,item,unit,objId] (objId 0 — на грунт)
    case 23: beginAction(u,'take',m.bytes[3],arg); break;   // взять:    [23,item,unit,objId]
    case 20: if(u.alive && arg===40 && u.items.includes(40)){ u.items.splice(u.items.indexOf(40),1); u.glucose=Math.min(100,u.glucose+50); u.electro=Math.min(100,u.electro+20); evt(18,u.id); } else evt(2,u.id); break;   // съесть брикет   // стоп: цель остаётся, тело стоит
    case 6: if(u.alive){ const g=decPos(m.bytes,3); if(beyondReturn(u,g)) break; u.goal={x:g.x,y:g.y}; const {x,y}=outsideHulls(g.x,g.y,u); u.target={x,y}; u.bestD=undefined; u.stuck=0; u.pending=null; u.lastImg={}; evt(8,u.id); } break;   // идти: цель = точка, тело идёт и смотрит туда
    case 18: { const {x,y}=decPos(m.bytes,3); u.goal={x,y}; u.lastImg={}; break; }   // смотреть: повернуть голову к точке, не идя
    case 7: if(u.alive){ u.mode=arg; u.lightOn=(arg!==2); if(arg===3){ const sp=S.spawn; u.target={x:sp.x,y:sp.y}; u.goal={x:sp.x,y:sp.y}; u.pending=null; } if(arg===4) u.target=null; evt(7,u.id,arg); } break;
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
  return { t, nextUnit, msgId, objState, contents, ground, nextGround, creature, antennaBoost, units:su, stations:ss };
}
function restore(d){
  t=d.t; nextUnit=d.nextUnit; msgId=d.msgId; for(const k in objState) delete objState[k]; Object.assign(objState,d.objState);
  Object.assign(creature,d.creature); antennaBoost=d.antennaBoost;
  units.length=0; for(const su of d.units){ units.push({st:0, ...su, lastImg:{}, pendingImg:null}); }
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
    if(S.taskOpen && !S.seriesClosed && own.length && !own.some(u=>u.alive) && S.bioStock<=0 && !S.growing){ S.seriesClosed=true; setTimeout(()=>evt(27,0,0,S.k),2000/speed); }
    if(S.growing){ S.growing.tLeft-=dt; if(S.growing.tLeft<=0){ const u=spawn(S.growing.sensors,S); S.growing=null; evt(6,u.id); } } }
  // существо выбирает ближайшего живого
  let nearest=null, nd=1e9; for(const u of units){ if(!u.alive) continue; const d=dist(u,creature); if(d<nd){ nd=d; nearest=u; } }
  creature.cooldown=Math.max(0,creature.cooldown-dt);
  if(!LAB && !creature.awake && !creature.fleeing && !creature.cooldown && nearest && nd<detectRadius(nearest.mode)) creature.awake=true;
  if(creature.awake){
    if(creature.fleeing){ const h=Math.atan2(creature.lair.y-creature.y,creature.lair.x-creature.x); creature.x+=Math.cos(h)*2*dt; creature.y+=Math.sin(h)*2*dt; if(dist(creature,creature.lair)<2){creature.fleeing=false;creature.awake=false;creature.hp=3;creature.cooldown=120;} }
    else if(!nearest || nd>160){ creature.awake=false; creature.x=creature.home.x; creature.y=creature.home.y; }
    else if(creature.cooldown){ /* передышка: не преследует */ }
    else if(nd>2.5){ const h=Math.atan2(nearest.y-creature.y,nearest.x-creature.x); const cs=nearest.mode===2?0.7:1.1; creature.x+=Math.cos(h)*cs*dt; creature.y+=Math.sin(h)*cs*dt; }
    else { nearest.dmgTimer+=dt; if(nearest.dmgTimer>2){ nearest.dmgTimer=0; nearest.skin-=12; nearest.bone-=5; nearest.pain=1; nearest.psyche-=6; evt(4,nearest.id); } }
    if(nearest && nearest.mode===5 && nd<4){ nearest.atkTimer+=dt; if(nearest.atkTimer>2){ nearest.atkTimer=0; creature.hp--; if(creature.hp<=0){ creature.fleeing=true; evt(9,nearest.id); } } }
  }
  for(const u of units){
    if(u.alive){
      if(!u.carrier){ u.linkLostFor+=dt; if(u.linkLostFor>20 && !u.autoDone){ u.autoDone=true; if(u.autonomy===1) u.target=null; if(u.autonomy===2){ const sp=stOf(u).spawn; u.target={x:sp.x,y:sp.y}; u.mode=3; } } }
      else { u.linkLostFor=0; u.autoDone=false; }
      const sp=speedFor(u.mode);
      if(u.target && sp>0){ const d=dist(u,u.target); if(d<(u.pending?2.5:0.5)){ u.target=null; u.exertion=0; u.stuck=0; u.bestD=undefined; if(u.pending) doPending(u); else if(u.mode!==3) evt(1,u.id); }
        else { u.heading=Math.atan2(u.target.y-u.y,u.target.x-u.x); stepBody(u,sp*dt); u.exertion=Math.min(1,sp/1.4);
          // застревание — по продвижению: за 4 с не приблизился к цели на метр → стоп
          u.stuck=(u.stuck||0)+dt; if(u.stuck>=4){ const d2=dist(u,u.target); if(u.bestD!==undefined && u.bestD-d2<1){ u.stuck=0; u.bestD=undefined; u.target=null; u.pending=null; u.exertion=0; evt(23,u.id); } else { u.bestD=d2; u.stuck=0; } } } } else u.exertion=0;
      const dc=dist(u,creature);
      const fearT=creature.awake&&!creature.fleeing?Math.max(0,1-dc/80):0; u.fear+=(fearT-u.fear)*dt/2; u.pain=Math.max(0,u.pain-dt/8);
      const rest=u.mode===4; const pulseT=60+55*u.exertion+95*u.fear+45*u.pain-(rest?8:0); u.pulse+=(pulseT-u.pulse)*dt/3;
      u.glucose-=dt*0.003*(1+2*u.exertion+u.fear);   // покой ~9 ч, ходьба ~3 ч
      u.electro-=dt*0.002*(1+u.exertion);
      const inT=tunnelT(u.x,u.y)>=0; u.toxin=Math.max(0,u.toxin+dt*(inT?0.06:-0.02));
      u.psyche=Math.max(0,Math.min(100,u.psyche+dt*(rest?0.05:-(0.01+0.15*u.fear+(inT&&!u.lightOn?0.04:0)))));
      u.cons=0.6+0.8*u.exertion+Math.pow(10,u.txDbm/10)*0.4+(u.lightOn?0.2:0)+(u.sub.img.interval?0.3:0)-(rest?0.4:0); u.gen=0.8-0.3*u.fear;
      u.charge=Math.max(0,Math.min(100,u.charge+(u.gen-u.cons)*dt*0.01));   // ходьба с фонарём: ~3 ч; стоя — почти ровно; отдых восстанавливает
      if(LAB){ u.glucose=u.electro=u.charge=100; }
      if(u.skin<=0||u.bone<=0||u.glucose<=0||u.charge<=0){ u.alive=false; u.target=null; evt(5,u.id); }
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
    units:units.map(u=>{ const tT=tunnelT(u.x,u.y), S=stOf(u); return {id:u.id, st:u.st, dist:Math.max(1,Math.hypot(u.x-S.x,u.y-S.y)), obstDb:tT>=0?8+22*tT:0, txDbm:u.charge>0?u.txDbm:-99, alive:u.alive}; }),   // без заряда передатчик молчит; расстояние — до своей станции
    dbg:{ units:units.map(u=>({id:u.id,st:u.st,x:u.x,y:u.y,alive:u.alive})), stations:stations.map(S=>({k:S.k,name:S.name,x:S.x,y:S.y,ang:S.ang})), cx:creature.x, cy:creature.y, awake:creature.awake } });
}
// правда о мире для отладочной шторки (игрок этого не видит): расщелина и ориентиры — один раз при старте
postMessage({ t:'level', canyon:{pts:LEVEL.canyon.pts, branch:LEVEL.canyon.branch.pts}, pois:[...POIS,...SPOIS].map(p=>({id:p.id,x:p.x,y:p.y})), stations:stations.map(S=>({k:S.k,name:S.name,x:S.x,y:S.y,ang:S.ang})) });
let timer=null; function schedule(){ if(timer) clearInterval(timer); timer=setInterval(tick, DT*1000/speed); } schedule();

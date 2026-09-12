// МИР. Web Worker. Ничего не знает о консоли.
// Наружу: (а) байтовые сообщения для канала, (б) физика линии по каждому миссионеру.
importScripts('codebook.js?v='+(self.location.search.slice(3)||'0'));

const DT = 0.1;
let speed = 1, msgId = 1, t = 0;

// ---------- геометрия ----------
const POIS = [
  { id:1, x:16,  y:0,    subs:[[10,3,2],[11,-2,5],[12,6,-4]] },
  { id:2, x:40,  y:14,   subs:[[13,1,1],[13,-2,2],[14,3,-1],[15,3,-1.5],[16,8,-6]] },
  { id:3, x:120, y:-80,  subs:[[17,0,0],[18,4,3],[19,-3,-2]] },
  { id:4, x:90,  y:140,  subs:[[20,0,0],[20,3,0],[20,6,0],[20,9,0],[20,12,0],[20,15,0],[21,6,-3],[22,-4,4]] },
  { id:5, x:-200,y:60,   subs:[[23,0,0],[24,6,-5],[25,-15,10]] },
  { id:6, x:260, y:150,  subs:[[26,10,8],[27,-3,-2],[28,-6,3]] },
  { id:7, x:330, y:210,  subs:[[29,4,3],[30,-3,-4],[31,8,-6],[32,1,6]] },
];
const TUN_A = {x:260,y:150}, TUN_B = {x:340,y:218};
const CIRCLES = [ {x:0,y:0,r:14}, {x:-200,y:60,r:12},
  {x:-60,y:-90,r:6},{x:180,y:40,r:5},{x:210,y:-30,r:7},{x:-120,y:160,r:8},{x:60,y:220,r:9},{x:300,y:60,r:6} ];
const SEGS = (()=>{ const dx=TUN_B.x-TUN_A.x, dy=TUN_B.y-TUN_A.y, L=Math.hypot(dx,dy), nx=-dy/L*4, ny=dx/L*4;
  return [ {x1:TUN_A.x+nx,y1:TUN_A.y+ny,x2:TUN_B.x+nx,y2:TUN_B.y+ny}, {x1:TUN_A.x-nx,y1:TUN_A.y-ny,x2:TUN_B.x-nx,y2:TUN_B.y-ny}, {x1:TUN_B.x+nx,y1:TUN_B.y+ny,x2:TUN_B.x-nx,y2:TUN_B.y-ny} ]; })();
function tunnelT(x,y){ const dx=TUN_B.x-TUN_A.x, dy=TUN_B.y-TUN_A.y, L2=dx*dx+dy*dy; const tt=((x-TUN_A.x)*dx+(y-TUN_A.y)*dy)/L2; if(tt<0||tt>1) return -1; const px=TUN_A.x+tt*dx, py=TUN_A.y+tt*dy; return Math.hypot(x-px,y-py)<12 ? tt : -1; }
function dist(a,b){ return Math.hypot(a.x-b.x,a.y-b.y); }
function bearingDeg(from,to){ return (Math.atan2(to.y-from.y,to.x-from.x)*180/Math.PI+360)%360; }

// ---------- состояние ----------
const station = { bioStock:4, camInv:0, power:100, growing:null, taskOpen:true };
const objState = {};                       // id объекта → состояние (по умолчанию 0)
function stateOf(id){ return objState[id]||0; }
const units = []; let nextUnit = 1;
function spawn(sensors){
  const u = { id:nextUnit++, alive:true, x:16, y:0, heading:0, target:null, mode:1, lightOn:true,
    pulse:72, glucose:92, electro:96, toxin:0, skin:100, bone:100, psyche:88, charge:100, gen:0.8, cons:1.0,
    fear:0, pain:0, exertion:0, txDbm:0, dmgTimer:0, atkTimer:0,
    sensors:{ camera:!!sensors.camera, sonar:!!sensors.sonar },
    tlmTimer:Math.random(), carrier:true, linkLostFor:0, autoDone:false, autonomy:0,
    sub:{ tlm:1, sonar:0, desc:0, img:{interval:0,level:2,delta:true} }, goal:null, items:[], pending:null, subT:{ sonar:0, desc:0, img:0 }, lastImg:{}, pendingImg:null, frameNo:0 };
  units.push(u); return u;
}
spawn({camera:true, sonar:true});          // первый миссионер уже готов и несёт единственную камеру
// стационарная камера у шлюза: смотрит от люка наружу (+x), сигнала не требует — она на станции
const stationCam = { id:0, x:12, y:0, heading:0, goal:{x:60,y:8}, lightOn:true, charge:100, alive:true, lastImg:{}, pendingImg:null, frameNo:0, sensors:{camera:true}, sub:{img:{interval:0,level:2,delta:true}}, subT:{img:0}, items:[] };
const creature = { x:330, y:210, home:{x:330,y:210}, lair:{x:346,y:222}, awake:false, hp:3, fleeing:false, cooldown:0 };   // после отпора уходит в логово и не трогает 2 минуты
let antennaBoost = 0, hbTimer = 0, hbInterval = 2;

function speedFor(m){ return m===2?0.6 : m===3?2.6 : m===4?0 : m===5?1.0 : 1.4; }
function detectRadius(m){ return m===2?22 : m===4?35 : 70; }

// ---------- сообщения наружу ----------
function emit(cls, kind, unit, payload){ if(muted){ msgId++; return; } postMessage({ t:'msg', id:msgId++, cls, kind, unit, payload }); }
function evt(code, unit=0, arg=0){ emit('cmd','EVT', unit, new Uint8Array([code,arg])); }
function emitAuto(kind, unit, payload){ emit('bg', kind, unit, payload); }   // периодические подписки идут фоном

// ---------- телеметрия миссионера (16 байт) ----------
function telemetry(u){
  const b=new Uint8Array(16), c=v=>Math.max(0,Math.min(255,Math.round(v)));
  b[0]=c(u.pulse); b[1]=c(u.electro); b[2]=c(u.glucose); b[3]=c(u.toxin); b[4]=c(u.skin); b[5]=c(u.bone); b[6]=c(u.psyche);
  b[7]=(creature.awake && dist(u,creature)<90)?1:0;
  b[8]=c(u.cons*50); b[9]=c(u.charge*2.55); b[10]=c(u.gen*50);
  const x=Math.round(u.x)+32768, y=Math.round(u.y)+32768; b[11]=x>>8; b[12]=x&255; b[13]=y>>8; b[14]=y&255; b[15]=u.mode;
  return b;
}
// ---------- пульс станции (раз в 2 с): [биозапас, склад камер, рост(с|255), n, (id, флаги, заряд, предметы)*] ----------
function heartbeat(){
  const b=[station.bioStock, station.camInv, station.growing?Math.ceil(station.growing.tLeft):255, units.length];
  for(const u of units){ b.push(u.id, (u.alive?1:0)|(u.carrier?2:0)|(u.sensors.camera?4:0)|(u.sensors.sonar?8:0)|(u.sub.img.interval?16:0), Math.round(u.charge*2.55), (u.items.includes(40)?1:0)|(u.items.includes(41)?2:0)); }
  emit('bg','HB',0,new Uint8Array(b));
}

// ---------- восприятие ----------
function objectsAround(u, maxR){
  const out=[]; const inT=tunnelT(u.x,u.y)>=0;
  for(const p of POIS){
    const pInT=(p.id===7)||(p.id===6);
    const lmVisible = inT ? pInT : (p.id!==7 || dist(u,TUN_A)<=30);
    if(lmVisible && dist(u,p)<=300) out.push({id:p.id,type:p.id,x:p.x,y:p.y,landmark:true});
    if(inT && !pInT) continue;
    if(!inT && p.id===7) continue;
    for(let i=0;i<p.subs.length;i++){ const s=p.subs[i]; const o={id:p.id*10+i,type:s[0],x:p.x+s[1],y:p.y+s[2]}; if(dist(u,o)<=maxR) out.push(o); }
  }
  for(const v of units){ if(v===u) continue; if(dist(u,v)<=maxR) out.push({id:200+v.id,type:v.alive?252:251,x:v.x,y:v.y,unit:v}); }
  if(dist(u,creature)<=Math.min(maxR,60)) out.push({id:250,type:250,x:creature.x,y:creature.y,creature:true});
  return out;
}
// Станция составляет текст сама — из базы знаний и текущего состояния мира.
function nameOf(o){
  if(o.creature) return creature.awake ? 'существо, класс не определён' : 'объект, класс не определён';
  if(o.unit) return o.unit.alive ? `миссионер М${o.unit.id}` : `тело М${o.unit.id}`;
  return (CODEBOOK[o.type]||CODEBOOK[250]).name;
}
function examText(o){
  if(o.creature) return creature.awake ? 'Двуногое. Кожа с тем же рисунком пор, что у миссионера. Смотрит.' : 'Двуногое, лежит. Дышит. Кожа с тем же рисунком пор, что у миссионера.';
  if(o.unit){ const v=o.unit; if(v.alive) return `Наш. ${v.target?'Идёт.':'Стоит.'} Пульс на вид ${v.pulse<100?'ровный':'частый'}.`; return `Не двигается. ${v.sensors.camera?'Камера на месте.':'Камеры нет.'}${v.items.length?' При нём: '+v.items.map(i=>ITEMS[i]).join(', ')+'.':''}`; }
  const cb=CODEBOOK[o.type]||CODEBOOK[250]; return (cb.states||[])[stateOf(o.id)]||'';
}
function classOf(o){ return o.creature?2 : o.unit?(o.unit.alive?4:3) : o.landmark?1 : 0; }
function describe(u, cls='cmd'){
  const objs=objectsAround(u,100); const parts=[];
  for(const o of objs){ const t=encText(nameOf(o)); parts.push([o.id&255, classOf(o), Math.round(bearingDeg(u,o)/2), Math.min(255,Math.round(dist(u,o))), t.length, ...t]); }
  emit(cls,'DESC',u.id,new Uint8Array(parts.flat()));
}
function rayCircle(ox,oy,dx,dy,c){ const fx=ox-c.x, fy=oy-c.y; const b=2*(fx*dx+fy*dy), cc=fx*fx+fy*fy-c.r*c.r; const D=b*b-4*cc; if(D<0) return Infinity; const s=Math.sqrt(D); const t1=(-b-s)/2, t2=(-b+s)/2; if(t1>0) return t1; if(t2>0) return t2; return Infinity; }
function raySeg(ox,oy,dx,dy,s){ const ex=s.x2-s.x1, ey=s.y2-s.y1; const den=dx*ey-dy*ex; if(Math.abs(den)<1e-9) return Infinity; const tt=((s.x1-ox)*ey-(s.y1-oy)*ex)/den; const uu=((s.x1-ox)*dy-(s.y1-oy)*dx)/den; return (tt>0&&uu>=0&&uu<=1)?tt:Infinity; }
function sonar(u, cls='cmd'){
  const b=new Uint8Array(64); const objs=objectsAround(u,100);
  for(let i=0;i<64;i++){ const a=i/64*Math.PI*2, dx=Math.cos(a), dy=Math.sin(a); let best=100;
    for(const c of CIRCLES) best=Math.min(best,rayCircle(u.x,u.y,dx,dy,c));
    for(const s of SEGS) best=Math.min(best,raySeg(u.x,u.y,dx,dy,s));
    for(const o of objs){ if(o.landmark) continue; best=Math.min(best,rayCircle(u.x,u.y,dx,dy,{x:o.x,y:o.y,r:o.creature?0.8:1.2})); }
    b[i]=Math.round(Math.min(100,best)/100*255); }
  emit(cls,'SONAR',u.id,b);
}

// ---------- камера ----------
const SHAPES={10:{w:0.6,base:90},11:{w:0.3,base:60},12:{w:1.5,base:120},13:{w:1,base:130},14:{w:1,base:100},15:{w:0.2,base:40},16:{w:2,base:50},17:{w:0.15,base:80},18:{w:0.7,base:70},19:{w:1.2,base:50},20:{w:1.6,base:100},21:{w:0.12,base:60},22:{w:0.8,base:170},23:{w:2.5,base:80},24:{w:0.5,base:40},25:{w:3,base:30},26:{w:1.2,base:5},27:{w:2,base:60},28:{w:0.4,base:140},29:{w:1.3,base:90},30:{w:1.5,base:60},31:{w:3,base:70},251:{w:1.4,base:75},252:{w:0.35,base:160}};
function camHeading(u){ return u.goal && dist(u,u.goal)>1.5 ? Math.atan2(u.goal.y-u.y,u.goal.x-u.x) : u.heading; }   // голова повёрнута к цели, если она задана
function relBearing(u,o){ let d=bearingDeg(u,o)-camHeading(u)*180/Math.PI; while(d>180)d-=360; while(d<-180)d+=360; return d; }
function render(u,size){
  const img=new Uint8Array(size*size); const inT=tunnelT(u.x,u.y)>=0; const light=u.lightOn && u.charge>0; const horizon=size*0.55;
  for(let y=0;y<size;y++) for(let x=0;x<size;x++){ let v;
    if(inT){ const amb=light?80:5; v=amb*(1-0.6*Math.abs(y-horizon)/size)*(1-0.6*Math.abs(x-size/2)/(size/2))+3; }
    else v = y<horizon ? 70+50*(y/horizon) : 150-70*((y-horizon)/(size-horizon));
    img[y*size+x]=v; }
  const objs=objectsAround(u,80).filter(o=>!o.landmark).map(o=>({...o,rb:relBearing(u,o),r:dist(u,o)})).filter(o=>Math.abs(o.rb)<52).sort((a,b)=>b.r-a.r);
  for(const o of objs){
    const sx=size/2+(o.rb/52)*(size/2); const h=Math.max(2,Math.min(size*0.9,size*7/Math.max(1,o.r)));
    const shape=o.creature?{w:0.35,base:20}:SHAPES[o.type]||{w:0.8,base:110}; const w=Math.max(1,h*shape.w*(o.type===251?1:1));
    const att=inT?(light?Math.max(0.08,1-o.r/40):0.05):1; const shade=o.creature?shape.base:shape.base*att;
    const hh = o.type===251 ? h*0.3 : h;       // тело лежит
    const bottom=horizon+h*0.5*(inT?0.4:1);
    for(let yy=Math.round(bottom-hh);yy<bottom;yy++) for(let xx=Math.round(sx-w/2);xx<sx+w/2;xx++){ if(xx<0||xx>=size||yy<0||yy>=size) continue; img[yy*size+xx]=shade; }
    if(o.creature||o.type===252){ const hr=Math.max(1,w*0.5); for(let yy=Math.round(bottom-h-hr);yy<bottom-h+hr*0.5;yy++) for(let xx=Math.round(sx-hr/2);xx<sx+hr/2;xx++){ if(xx<0||xx>=size||yy<0||yy>=size) continue; img[yy*size+xx]=shade; } }
  }
  for(let i=0;i<img.length;i++) img[i]=Math.max(0,Math.min(255,img[i]+(Math.random()-0.5)*(inT?14:8)));
  return img;
}
function downsample(img,size,to){ const f=size/to, out=new Uint8Array(to*to); for(let y=0;y<to;y++)for(let x=0;x<to;x++){ let s=0; for(let j=0;j<f;j++)for(let i=0;i<f;i++) s+=img[(y*f+j)*size+x*f+i]; out[y*to+x]=s/(f*f);} return out; }
// Изображение. Пирамида уровней 8→16→32→64 (kind IMG0..3), либо дельта-кадр на одном уровне (kind IMDn):
// сетка 8×8 блоков, уходят только изменившиеся; payload [frameNo, key, (idx, блок)*]. Блок = (side/8)² байт.
function imagePyramid(u, level, cls){ const full=render(u,64); [8,16,32,64].slice(0,level+1).forEach((s,l)=>emit(cls,'IMG'+l,u.id,s===64?full:downsample(full,64,s))); }
function imageDelta(u, level, cls='bg'){
  const side=[8,16,32,64][level], bsz=side/8, f=side===64?render(u,64):downsample(render(u,64),64,side);
  const last=u.lastImg[level]; const key=!last; u.frameNo=(u.frameNo+1)&255; const blocks=[];
  for(let b=0;b<64;b++){ const bx=(b%8)*bsz, by=Math.floor(b/8)*bsz; let maxd=0; const px=[];
    for(let j=0;j<bsz;j++)for(let i=0;i<bsz;i++){ const idx=(by+j)*side+bx+i; px.push(f[idx]); if(last) maxd=Math.max(maxd,Math.abs(f[idx]-last[idx])); }
    if(key||maxd>18) blocks.push({b,px}); }
  const n=bsz*bsz; const out=new Uint8Array(2+blocks.length*(1+n)); out[0]=u.frameNo; out[1]=key?1:0;
  blocks.forEach((bl,i)=>{ out[2+i*(1+n)]=bl.b; for(let k=0;k<n;k++) out[3+i*(1+n)+k]=bl.px[k]; });
  if(cls==='cmd'){ u.lastImg[level]=f; emit('cmd','IMD'+level,u.id,out); }                  // запрос кнопкой встаёт в очередь всегда
  else { u.pendingImg={level,f}; emit('bg','IMD'+level,u.id,out); }   // подписка: lastImg обновится, когда канал подтвердит приём кадра в передачу
}

// ---------- изучить / взаимодействовать ----------
// Обе команды — «подойди к объекту и сделай». Тело идёт к объекту; по прибытии выполняет и докладывает.
function findObj(u,id){ return objectsAround(u,100).find(o=>o.id===id); }
function beginAction(u,kind,id){
  if(!u.alive) return; const o=findObj(u,id); if(!o){ evt(16,u.id,id); return; }
  u.pending={kind,id}; u.goal={x:o.x,y:o.y};
  if(dist(u,o)>3){ u.target={x:o.x,y:o.y}; evt(8,u.id); } else doPending(u);
}
function doPending(u){
  const p=u.pending; u.pending=null; if(!p) return; const o=findObj(u,p.id); if(!o){ evt(16,u.id,p.id); return; }
  const st=stateOf(o.id), cb=CODEBOOK[o.type]||CODEBOOK[250];
  const textReply=(kind,code,text)=>{ const t=encText(text); emit('cmd',kind,u.id,new Uint8Array([o.id,code,t.length>>8,t.length&255,...t])); };   // длина — 2 байта
  if(p.kind==='exam'){ textReply('EXAM',0,examText(o)); return; }
  // взаимодействие: действие из текущего состояния; ответ — текст, составленный станцией
  const acts=cb.actions||[]; const a=acts.find(a=>a.from===st);
  if(!a){ textReply('ACT',1,'осмотрел: сделать здесь нечего.'); return; }
  if(a.needs && !u.items.includes(a.needs)){ textReply('ACT',2,`не смог: ${a.fail||'нужен предмет'}`); return; }
  if(a.req && stateOf(a.req.obj)!==a.req.state){ textReply('ACT',3,`не смог: ${a.fail||'условие не выполнено'}`); return; }
  if(a.special==='return_camera'){ if(u.sensors.camera){ u.sensors.camera=false; u.sub.img.interval=0; station.camInv++; textReply('ACT',0,'сдал камеру на склад. На складе: '+station.camInv+'.'); } else textReply('ACT',1,'осмотрел: сдавать нечего.'); return; }
  if(a.special==='strip'){ const v=o.unit; let got='датчиков на теле нет.'; if(v&&v.sensors.camera){ v.sensors.camera=false; v.sub.img.interval=0; u.sensors.camera=true; u.lastImg={}; got='снял камеру. Теперь она на М'+u.id+'.'; } objState[o.id]=a.to; textReply('ACT',0,got); return; }
  if(a.special==='boost') antennaBoost=6;
  if(a.special==='finale' && station.taskOpen){ station.taskOpen=false; setTimeout(()=>evt(17,u.id),1500/speed); }
  if(a.item===42){ u.sensors.camera=true; u.lastImg={}; } else if(a.item) u.items.push(a.item);
  objState[o.id]=a.to; textReply('ACT',0,`${a.verb}. ${(cb.states||[])[a.to]||''}${a.item&&a.item!==42?' ['+ITEMS[a.item]+']':''}`);
}

// ---------- команды (uplink) ----------
onmessage = e => {
  const m=e.data;
  if(m.t==='speed'){ speed=m.v; schedule(); return; }
  if(m.t==='link'){ for(const u of units) if(u.id in m.carriers) u.carrier=!!m.carriers[u.id]; return; }   // миссионер сам слышит несущую станции — физика, не данные
  if(m.t==='imgAck'){ const u=m.unit===0?stationCam:units.find(u=>u.id===m.unit); if(u&&u.pendingImg&&u.pendingImg.level===m.level){ if(m.ok) u.lastImg[m.level]=u.pendingImg.f; u.pendingImg=null; } return; }
  if(m.t==='autonomy'){ const u=units.find(u=>u.id===m.unit); if(u) u.autonomy=m.v; return; }
  if(m.t==='tp'){ const u=units.find(u=>u.id===m.unit)||units[0]; if(u){ u.x=m.x; u.y=m.y; u.target=null; } return; }
  if(m.t==='peek'){ const u=units.find(u=>u.id===m.unit)||units[0]; if(u) postMessage({t:'peekImg',unit:u.id,img:render(u,64)}); return; }   // отладка: чистый рендер мимо канала
  if(m.t==='save'){ postMessage({t:'state',data:snapshot()}); return; }
  if(m.t==='load'){ restore(m.data); catchUp(m.elapsed||0); return; }
  if(m.t!=='cmd') return;
  const [cmd,arg,unit]=m.bytes;
  if(cmd===10){ // вырастить: arg = маска датчиков
    if(station.growing) { evt(2); return; }
    if(station.bioStock<=0){ evt(14); return; }
    const cam=!!(arg&1); if(cam && station.camInv<1){ evt(10); return; }
    if(cam) station.camInv--; station.bioStock--; station.growing={sensors:{camera:cam,sonar:!!(arg&2)},tLeft:180}; evt(11); return;
  }
  if(cmd===11){ // статус: паспорт станции текстом + пульс
    const info=`ARK-041, автономная посадочная платформа\nсостояние: штатное\nвозраст миссии: 39 л 211 д\nоператор: нет; последний сеанс 31 г 004 д назад\nбиоматериал: ${station.bioStock} ед.; камер на складе: ${station.camInv}; развёрнуто: ${units.length}\nзадача: ${station.taskOpen?'ПС-7 открыта 39 л 209 д — поиск М-07, не вернулся с выхода. Серия 0 исчерпана (7 ед.)':'ПС-7 закрыта'}`;
    emit('cmd','INFO',0,encText(info)); heartbeat(); return; }
  if(cmd===15){ hbInterval=arg; return; }
  const u=unit===0&&(cmd===3||cmd===16) ? stationCam : units.find(u=>u.id===unit); if(!u) return;
  switch(cmd){
    case 1: if(u.alive) describe(u); break;
    case 2: if(u.sensors.sonar && u.charge>0) sonar(u); break;
    case 3: if(u.sensors.camera && u.charge>0){ if(m.bytes[3]) imageDelta(u,Math.min(3,arg),'cmd'); else imagePyramid(u,Math.min(3,arg),'cmd'); } break;
    case 16: if(u.sensors.camera){ u.sub.img={interval:arg,level:Math.min(3,m.bytes[3]),delta:!!m.bytes[4]}; u.subT.img=0; u.lastImg={}; } break;
    case 17: if(u.alive){ u.target=null; u.pending=null; evt(15,u.id); } break;   // стоп: цель остаётся, тело стоит
    case 6: if(u.alive){ const x=((m.bytes[3]<<8)|m.bytes[4])-32768, y=((m.bytes[5]<<8)|m.bytes[6])-32768; u.goal={x,y}; u.target={x,y}; u.pending=null; u.lastImg={}; evt(8,u.id); } break;   // идти: цель = точка, тело идёт и смотрит туда
    case 18: { const x=((m.bytes[3]<<8)|m.bytes[4])-32768, y=((m.bytes[5]<<8)|m.bytes[6])-32768; u.goal={x,y}; u.lastImg={}; break; }   // смотреть: повернуть голову к точке, не идя
    case 7: if(u.alive){ u.mode=arg; u.lightOn=(arg!==2); if(arg===3){ u.target={x:16,y:0}; u.goal={x:16,y:0}; u.pending=null; } if(arg===4) u.target=null; evt(7,u.id,arg); } break;
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
  return { t, nextUnit, msgId, station, objState, creature, antennaBoost, hbInterval, units:su, stcam:{sub:stationCam.sub} };
}
function restore(d){
  t=d.t; nextUnit=d.nextUnit; msgId=d.msgId; Object.assign(station,d.station); for(const k in objState) delete objState[k]; Object.assign(objState,d.objState);
  Object.assign(creature,d.creature); antennaBoost=d.antennaBoost; hbInterval=d.hbInterval;
  units.length=0; for(const su of d.units){ units.push({...su, lastImg:{}, pendingImg:null}); }
  if(d.stcam) stationCam.sub=d.stcam.sub;
}
// Мир жил без оператора: досчитываем прошедшее время (не больше 8 часов), ничего не передавая
let muted=false;
function catchUp(sec){ const n=Math.min(sec,8*3600)/DT; muted=true; for(let i=0;i<n;i++) tick(); muted=false; }

// ---------- тик ----------
function tick(){
  const dt=DT; t+=dt;
  if(station.growing){ station.growing.tLeft-=dt; if(station.growing.tLeft<=0){ const u=spawn(station.growing.sensors); station.growing=null; evt(6,u.id); } }
  // существо выбирает ближайшего живого
  let nearest=null, nd=1e9; for(const u of units){ if(!u.alive) continue; const d=dist(u,creature); if(d<nd){ nd=d; nearest=u; } }
  creature.cooldown=Math.max(0,creature.cooldown-dt);
  if(!creature.awake && !creature.fleeing && !creature.cooldown && nearest && nd<detectRadius(nearest.mode)) creature.awake=true;
  if(creature.awake){
    if(creature.fleeing){ const h=Math.atan2(creature.lair.y-creature.y,creature.lair.x-creature.x); creature.x+=Math.cos(h)*2*dt; creature.y+=Math.sin(h)*2*dt; if(dist(creature,creature.lair)<2){creature.fleeing=false;creature.awake=false;creature.hp=3;creature.cooldown=120;} }
    else if(!nearest || nd>160){ creature.awake=false; creature.x=creature.home.x; creature.y=creature.home.y; }
    else if(creature.cooldown){ /* передышка: не преследует */ }
    else if(nd>2.5){ const h=Math.atan2(nearest.y-creature.y,nearest.x-creature.x); const cs=nearest.mode===2?0.7:1.1; creature.x+=Math.cos(h)*cs*dt; creature.y+=Math.sin(h)*cs*dt; }
    else { nearest.dmgTimer+=dt; if(nearest.dmgTimer>2){ nearest.dmgTimer=0; nearest.skin-=15; nearest.bone-=7; nearest.pain=1; nearest.psyche-=6; evt(4,nearest.id); } }
    if(nearest && nearest.mode===5 && nd<4){ nearest.atkTimer+=dt; if(nearest.atkTimer>2){ nearest.atkTimer=0; creature.hp--; if(creature.hp<=0){ creature.fleeing=true; evt(9,nearest.id); } } }
  }
  for(const u of units){
    if(u.alive){
      if(!u.carrier){ u.linkLostFor+=dt; if(u.linkLostFor>20 && !u.autoDone){ u.autoDone=true; if(u.autonomy===1) u.target=null; if(u.autonomy===2){ u.target={x:16,y:0}; u.mode=3; } } }
      else { u.linkLostFor=0; u.autoDone=false; }
      const sp=speedFor(u.mode);
      if(u.target && sp>0){ const d=dist(u,u.target); if(d<(u.pending?2.5:1.5)){ u.target=null; u.exertion=0; if(u.pending) doPending(u); else if(u.mode!==3) evt(1,u.id); } else { u.heading=Math.atan2(u.target.y-u.y,u.target.x-u.x); u.x+=Math.cos(u.heading)*sp*dt; u.y+=Math.sin(u.heading)*sp*dt; u.exertion=Math.min(1,sp/1.4); } } else u.exertion=0;
      const dc=dist(u,creature);
      const fearT=creature.awake&&!creature.fleeing?Math.max(0,1-dc/80):0; u.fear+=(fearT-u.fear)*dt/2; u.pain=Math.max(0,u.pain-dt/8);
      const rest=u.mode===4; const pulseT=60+55*u.exertion+95*u.fear+45*u.pain-(rest?8:0); u.pulse+=(pulseT-u.pulse)*dt/3;
      u.glucose-=dt*0.025*(1+2*u.exertion+u.fear); u.electro-=dt*0.012*(1+u.exertion);
      const inT=tunnelT(u.x,u.y)>=0; u.toxin=Math.max(0,u.toxin+dt*(inT?0.06:-0.02));
      u.psyche=Math.max(0,Math.min(100,u.psyche+dt*(rest?0.05:-(0.01+0.15*u.fear+(inT&&!u.lightOn?0.04:0)))));
      u.cons=0.6+0.8*u.exertion+Math.pow(10,u.txDbm/10)*0.4+(u.lightOn?0.2:0)+(u.sub.img.interval?0.3:0)-(rest?0.4:0); u.gen=0.8-0.3*u.fear;
      u.charge=Math.max(0,Math.min(100,u.charge+(u.gen-u.cons)*dt*0.05));
      if(u.skin<=0||u.bone<=0||u.glucose<=0||u.charge<=0){ u.alive=false; u.target=null; evt(5,u.id); }
      if(u.sub.tlm){ u.tlmTimer+=dt; if(u.tlmTimer>=u.sub.tlm){ u.tlmTimer=0; emit('bg','TLM',u.id,telemetry(u)); } }
      if(u.sub.desc){ u.subT.desc+=dt; if(u.subT.desc>=u.sub.desc){ u.subT.desc=0; describe(u,'bg'); } }
    } else {
      u.charge=Math.max(0,u.charge-dt*(u.sub.img.interval?0.03:0.004));   // приборы на теле сидят на остатке заряда
    }
    if(u.sub.sonar && u.sensors.sonar && u.charge>0){ u.subT.sonar+=dt; if(u.subT.sonar>=u.sub.sonar){ u.subT.sonar=0; sonar(u,'bg'); } }
    if(u.sub.img.interval && u.sensors.camera && u.charge>0){ u.subT.img+=dt; if(u.subT.img>=u.sub.img.interval){ u.subT.img=0; if(u.sub.img.delta) imageDelta(u,u.sub.img.level); else imagePyramid(u,u.sub.img.level,'bg'); } }
  }
  { const u=stationCam; if(u.sub.img.interval){ u.subT.img+=dt; if(u.subT.img>=u.sub.img.interval){ u.subT.img=0; if(u.sub.img.delta) imageDelta(u,u.sub.img.level); else imagePyramid(u,u.sub.img.level,'bg'); } } }
  if(hbInterval){ hbTimer+=dt; if(hbTimer>=hbInterval){ hbTimer=0; heartbeat(); } }
  if(muted) return;
  postMessage({ t:'phys', extraGain:antennaBoost,
    units:units.map(u=>{ const tT=tunnelT(u.x,u.y); return {id:u.id, dist:Math.max(1,Math.hypot(u.x,u.y)), obstDb:tT>=0?8+22*tT:0, txDbm:u.txDbm, alive:u.alive}; }),
    dbg:{ units:units.map(u=>({id:u.id,x:u.x,y:u.y,alive:u.alive})), cx:creature.x, cy:creature.y, awake:creature.awake } });
}
let timer=null; function schedule(){ if(timer) clearInterval(timer); timer=setInterval(tick, DT*1000/speed); } schedule();

#!/usr/bin/env node
// СЕРВЕРНЫЙ ХОСТ СТАНЦИИ. Комнаты: в каждой — своя станция (мир + канал, proto/station.js), общий канал 512 бит/с на всех
// операторов комнаты. Раздаёт proto/ статикой, держит WebSocket /ws?room=КОД. Мир идёт, только пока в комнате есть операторы.
// Сохранение — JSON-файл на комнату в DATA_DIR (по умолчанию /home/data на App Service, иначе ./data): снимок мира,
// номер последнего пакета и хвост доставленных пакетов — им досылаются пропуски при повторном подключении.
// Запуск: node server/index.js [порт] [debug]   (или PORT, DATA_DIR, DEBUG=1; debug — отдавать правду о мире в шторку и принимать телепорт)
const fs=require('fs'), path=require('path'), http=require('http'), zlib=require('zlib');
const {WebSocketServer}=require('ws'); const {decodePNG}=require('../tools/png.js');
const ROOT=path.join(__dirname,'..'), P=path.join(ROOT,'proto')+'/';
const PORT=+process.argv[2]||+process.env.PORT||8765, DEBUG=!!process.env.DEBUG||process.argv.includes('debug');
const DATA=process.env.DATA_DIR||(process.env.WEBSITE_SITE_NAME?'/home/data':path.join(ROOT,'data'));   // WEBSITE_SITE_NAME — признак App Service
fs.mkdirSync(DATA,{recursive:true});
const RING=20000, SAVE_EVERY=10000, TAIL=5000;

// станция и мир — теми же исходниками, что в браузере
const read=f=>fs.readFileSync(P+f,'utf8');
const makeStation=new Function(read('link.js')+'\n'+read('station.js')+'\nreturn makeStation;')();
const worldSrc=['level.js','codebook.js','terrain.js','camera.js','world.js'].map(read).join('\n');
const atlas=(()=>{ const a=decodePNG(fs.readFileSync(P+'sprites.png')); const json=JSON.parse(read('sprites.json')); const px=new Uint8Array(a.w*a.h*4); for(let i=0;i<a.w*a.h;i++){ px[i*4]=a.gray[i]; px[i*4+3]=a.alpha[i]; } return {json,px}; })();
const replacer=(k,v)=>v instanceof Uint8Array?Array.from(v):v;
const enc=m=>JSON.stringify(m,replacer);

class Room {
  constructor(code){ this.code=code; this.file=path.join(DATA,code+'.json'); this.clients=new Set(); this.ring=[]; this.timer=null; this.saveTimer=null; this.seen={};   // seen: токен → имя, все операторы, что были на станции
    this.st=makeStation({ worldSrc, search:'?v=0', debug:DEBUG, out:m=>this.out(m) });
    // атлас — после того, как отвергнутый fetch в CAM.load отработает (иначе он обнулит атлас)
    setImmediate(()=>this.st.W.CAM.build(atlas.json,atlas.px));
    try{ const d=JSON.parse(fs.readFileSync(this.file,'utf8')); this.st.restore(d.world,d.n); this.ring=d.ring||[]; this.seen=d.seen||{}; if(d.speed) this.st.handle({t:'speed',v:d.speed}); log(`${code}: восстановлена, t=${d.world.t|0} с, пакетов ${d.n}`); }
    catch(e){ if(e.code!=='ENOENT') log(`${code}: сохранение не прочитано (${e.message}), новая станция`); else log(`${code}: новая станция`); }
  }
  out(m){
    if(m.t==='pkt'){ this.ring.push(m); if(this.ring.length>RING) this.ring.splice(0,this.ring.length-RING); }
    if(m.t==='state') return;
    const s=enc(m); for(const c of this.clients) if(c.live) c.send(s);
  }
  ops(){ return [...this.clients].filter(c=>c.live).map(c=>c.op.name); }
  info(){ const W=this.st.W, u=this.st.snapshot().units; return {code:this.code, ops:this.ops(), t:this.st.link.t, units:u.length, alive:u.filter(x=>x.alive).length, savedAt:Date.now()}; }
  sendOps(){ const s=enc({t:'ops',ops:this.ops()}); for(const c of this.clients) if(c.live) c.send(s); }
  join(ws){ this.clients.add(ws); if(!this.timer){ this.schedule(); this.saveTimer=setInterval(()=>this.save(),SAVE_EVERY); log(`${this.code}: мир идёт`); } }
  leave(ws){ this.clients.delete(ws); this.sendOps(); if(!this.clients.size){ clearInterval(this.timer); clearInterval(this.saveTimer); this.timer=this.saveTimer=null; this.save(); log(`${this.code}: операторов нет, мир стоит`); } }
  schedule(){ if(this.timer) clearInterval(this.timer); this.timer=setInterval(()=>this.st.tick(), 100/this.st.speed); }
  hello(ws,since,op){   // досылка пропущенного, потом — живой поток
    ws.op={ name:String(op&&op.name||'').replace(/[^\p{L}\p{N} _.-]/gu,'').trim().slice(0,24)||'оператор', token:String(op&&op.token||'').slice(0,32) };
    if(ws.op.token) this.seen[ws.op.token]=ws.op.name;
    const miss=this.ring.filter(p=>p.n>since);
    ws.send(enc({t:'welcome', operators:this.clients.size, replay:miss.length, at:this.st.link.t, speed:this.st.speed}));
    for(const p of miss) ws.send(enc({...p,replay:true}));
    ws.send(enc(this.st.modem())); ws.live=true; this.sendOps();
  }
  handle(ws,m){
    if(m.t==='hello'){ this.hello(ws,+m.since||0,m.op); return; }
    if(!ws.live) return;
    if(m.t==='up'||m.t==='autonomy'){ this.st.handle(m); return; }
    if(m.t==='speed'){ this.st.handle(m); this.schedule(); return; }
    if(DEBUG&&(m.t==='cfg'||m.t==='tp'||m.t==='peek')) this.st.handle(m);   // load/save от клиентов не принимаются: мир — у сервера
  }
  save(){ const d={v:1, savedAt:Date.now(), world:this.st.snapshot(), n:this.st.rxN(), speed:this.st.speed, seen:this.seen, ring:this.ring.slice(-TAIL)};
    try{ fs.writeFileSync(this.file+'.tmp',enc(d)); fs.renameSync(this.file+'.tmp',this.file); }catch(e){ log(`${this.code}: сохранение не удалось: ${e.message}`); } }
}
const rooms=new Map(); const room=code=>{ if(!rooms.has(code)) rooms.set(code,new Room(code)); return rooms.get(code); };
// список станций для лобби: живые — из памяти, остальные — по файлам (читаются заново, только если файл изменился)
const diskInfo={};
function listRooms(){ const out=[]; const codes=new Set(rooms.keys());
  for(const f of fs.readdirSync(DATA)){ if(!f.endsWith('.json')) continue; const code=f.slice(0,-5); if(codes.has(code)) continue; codes.add(code);
    try{ const st=fs.statSync(path.join(DATA,f)); const c=diskInfo[code]; if(c&&c.mtime===st.mtimeMs){ out.push(c.info); continue; }
      const d=JSON.parse(fs.readFileSync(path.join(DATA,f),'utf8')); const info={code, ops:[], t:d.world.t||0, units:d.world.units.length, alive:d.world.units.filter(u=>u.alive).length, savedAt:d.savedAt}; diskInfo[code]={mtime:st.mtimeMs,info}; out.push(info); }catch(e){} }
  for(const r of rooms.values()) out.push(r.info());
  return out.sort((a,b)=>(b.ops.length-a.ops.length)||(b.savedAt-a.savedAt)); }
const log=s=>console.log(new Date().toISOString().slice(11,19)+' '+s);

// статика: proto/ в корне, без кэша
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon'};
const server=http.createServer((req,res)=>{
  const u=new URL(req.url,'http://x'); let f=decodeURIComponent(u.pathname); if(f==='/') f='/lobby.html';   // корень — лобби; консоль — index.html?room=КОД
  if(f==='/rooms'){ res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}); res.end(JSON.stringify(listRooms())); return; }
  const fp=path.normalize(path.join(P,f)); if(!fp.startsWith(P)||/editor|serve\.py/.test(f)){ res.writeHead(404); res.end(); return; }   // редактор — только локально через serve.py
  fs.readFile(fp,(e,b)=>{ if(e){ res.writeHead(404); res.end('not found'); return; } res.writeHead(200,{'Content-Type':MIME[path.extname(fp)]||'application/octet-stream','Cache-Control':'no-store'}); res.end(b); });
});
const wss=new WebSocketServer({noServer:true});
server.on('upgrade',(req,sock,head)=>{
  const u=new URL(req.url,'http://x'); const code=(u.searchParams.get('room')||'').trim();
  if(u.pathname!=='/ws'||!/^[\w-]{1,32}$/.test(code)){ sock.destroy(); return; }
  wss.handleUpgrade(req,sock,head,ws=>{ const r=room(code); ws.live=false; r.join(ws); log(`${code}: оператор подключился (${r.clients.size})`);
    ws.on('message',d=>{ let m; try{ m=JSON.parse(d); }catch(e){ return; } if(m&&typeof m.t==='string') r.handle(ws,m); });
    ws.on('close',()=>{ r.leave(ws); log(`${code}: оператор отключился (${r.clients.size})`); }); });
});
process.on('SIGTERM',()=>{ for(const r of rooms.values()) r.save(); process.exit(0); });
process.on('SIGINT',()=>{ for(const r of rooms.values()) r.save(); process.exit(0); });
server.listen(PORT,()=>log(`станция слушает :${PORT}, данные в ${DATA}${DEBUG?', отладка':''}`));

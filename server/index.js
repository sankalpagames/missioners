#!/usr/bin/env node
// СЕРВЕРНЫЙ ХОСТ СТАНЦИИ. Комната = один мир с NST посадочными платформами (proto/station.js): у каждой платформы свои
// миссионеры, запасы и канал 512 бит/с; оператор при входе выбирает платформу (несколько операторов на одной — кооператив,
// канал делят). Раздаёт proto/ статикой, держит WebSocket /ws?room=КОД. Мир идёт, только пока в комнате есть операторы.
// Сохранение — JSON-файл на комнату в DATA_DIR (по умолчанию /home/data на App Service, иначе ./data): снимок мира,
// номера последних пакетов и хвосты доставленных пакетов по платформам — ими досылаются пропуски при повторном подключении.
// Запуск: node server/index.js [порт] [debug] [level=ФАЙЛ]   (или PORT, DATA_DIR, DEBUG=1, LEVEL_FILE; debug — отдавать правду о мире в шторку
// и принимать телепорт; level — уровень вместо proto/level.js: файл в формате level.js, например экспорт из редактора. Одна карта на сервер,
// все комнаты на ней; комнаты, сохранённые на другой карте, восстанавливаются на этой — сохранение карту не помнит)
const fs=require('fs'), path=require('path'), http=require('http'), zlib=require('zlib'), crypto=require('crypto');
const {WebSocketServer}=require('ws'); const {decodePNG}=require('../tools/png.js'); const {OpConsole}=require('./opconsole.js');
const ROOT=path.join(__dirname,'..'), P=path.join(ROOT,'proto')+'/';
const PORT=+process.argv[2]||+process.env.PORT||8765, DEBUG=!!process.env.DEBUG||process.argv.includes('debug');
const LEVEL_FILE=(process.argv.find(a=>a.startsWith('level='))||'').slice(6)||process.env.LEVEL_FILE||'';   // своя карта: путь к файлу уровня
const DATA=process.env.DATA_DIR||(process.env.WEBSITE_SITE_NAME?'/home/data':path.join(ROOT,'data'));   // WEBSITE_SITE_NAME — признак App Service
fs.mkdirSync(DATA,{recursive:true});
const RING=20000, SAVE_EVERY=10000, TAIL=5000;
const PACK_RING=2000, PACK_WAIT_MAX=30, PACK_MIN_MS=200;   // сторона стаи: буфер ленты, потолок долгого опроса (App Service рвёт запросы дольше ~230 с), мягкий лимит частоты на токен

// станция и мир — теми же исходниками, что в браузере
const read=f=>fs.readFileSync(P+f,'utf8');
const levelPath=LEVEL_FILE?path.resolve(LEVEL_FILE):P+'level.js', levelSrc=fs.readFileSync(levelPath,'utf8');
if(!/^\/\/ УРОВЕНЬ/.test(levelSrc)||!/\nconst LEVEL = \{/.test(levelSrc)){ console.error(`${levelPath}: не файл уровня (ожидается формат proto/level.js)`); process.exit(1); }
const makeStation=new Function(read('link.js')+'\n'+read('station.js')+'\nreturn makeStation;')();
const worldSrc=[levelSrc, ...['codebook.js','terrain.js','camera.js','world.js'].map(read)].join('\n');
const atlas=(()=>{ const a=decodePNG(fs.readFileSync(P+'sprites.png')); const json=JSON.parse(read('sprites.json')); const px=new Uint8Array(a.w*a.h*4); for(let i=0;i<a.w*a.h;i++){ px[i*4]=a.gray[i]; px[i*4+3]=a.alpha[i]; } return {json,px}; })();
const replacer=(k,v)=>v instanceof Uint8Array?Array.from(v):v;
const enc=m=>JSON.stringify(m,replacer);

// настройки комнаты задаёт создатель в лобби, одинаковы для всех платформ: число платформ, ёмкость дальней линии, ускорение времени
const CAPS=[512,1024,2048,4096], SPEEDS=[1,2,4], MAXN=new Function(levelSrc+'\nreturn LEVEL;')().sites.length;   // не больше площадок в уровне
const roomCfg=q=>({ n:Math.max(2,Math.min(MAXN,+q.n||2)), cap:CAPS.includes(+q.cap)?+q.cap:512, speed:SPEEDS.includes(+q.speed)?+q.speed:1,
  pack:/^[0-9a-f]{12,32}$/.test(q.pack||'')?q.pack:crypto.randomBytes(8).toString('hex') });   // pack — токен стаи: выдаётся создателю планеты, по нему агент входит (docs/agent-api.md)
const pubCfg=c=>{ const {pack,...o}=c; return o; };   // наружу (список планет) токен не отдаётся
class Room {
  constructor(code,cfg){ this.code=code; this.file=path.join(DATA,code+'.json'); this.logFile=path.join(DATA,code+'.log'); this.logBuf=[]; this.clients=new Set(); this.timer=null; this.saveTimer=null; this.seen={};   // seen: токен → {name, st}, все операторы, что были в комнате
    let d=null; try{ d=JSON.parse(fs.readFileSync(this.file,'utf8')); if(d.v!==3){ log(`${code}: старый формат сохранения v${d.v}, новая планета`); d=null; } }
    catch(e){ if(e.code!=='ENOENT') log(`${code}: сохранение не прочитано (${e.message}), новая планета`); }
    this.cfg=roomCfg(d?(d.cfg||{}):(cfg||{}));   // число платформ — из сохранения, если оно есть: мир уже с ним
    this.pack={ lines:[], waiters:[], last:0, capture:null };   // сторона стаи: лента восприятия с курсором n, ожидающие долгого опроса, время последнего запроса, перехват ответов мира
    this.st=makeStation({ worldSrc, search:'?v=0&st='+this.cfg.n, debug:DEBUG, out:m=>this.out(m), agent:m=>this.onAgent(m), log:r=>this.logBuf.push(JSON.stringify(r)) }); this.rings=this.st.links.map(()=>[]);
    // атлас — после того, как отвергнутый fetch в CAM.load отработает (иначе он обнулит атлас)
    setImmediate(()=>this.st.W.CAM.build(atlas.json,atlas.px));
    if(d){ this.st.restore(d.world,d.n); (d.rings||[]).forEach((r,k)=>{ if(this.rings[k]) this.rings[k]=r; }); this.seen=d.seen||{}; log(`${code}: восстановлена, t=${d.world.t|0} с, платформ ${this.cfg.n}, пакетов ${[].concat(d.n).join('/')}`); }
    else log(`${code}: новая планета, платформ ${this.cfg.n}`);
    this.st.log({k:'start', host:'server', code, cfg:this.cfg, level:path.basename(levelPath), restored:!!d, wall:new Date().toISOString()});
    for(const L of this.st.links) L.link.cfg.deepCapBps=this.cfg.cap; this.st.handle({t:'speed',v:this.cfg.speed});
  }
  out(m){
    if(m.t==='state') return;
    if(m.t==='pkt'){ const r=this.rings[m.st]; r.push(m); if(r.length>RING) r.splice(0,r.length-RING); }
    const s=enc(m); for(const c of this.clients) if(c.live && (m.st===undefined || c.st===m.st)) c.send(s);   // сообщения станции — только её операторам
  }
  // ---- сторона стаи (HTTP-API агента, docs/agent-api.md): мир отдаёт строки восприятия, сервер копит их и будит долгий опрос; ответы на намерения и картину мир отдаёт синхронно — перехват
  onAgent(m){
    if(m.t==='agent'){ const L=this.pack.lines; L.push({n:m.n, at:m.at, who:m.who, text:m.text}); if(L.length>PACK_RING) L.splice(0,L.length-PACK_RING); for(const w of this.pack.waiters.splice(0)) w(); }
    else if(this.pack.capture) this.pack.capture(m);
  }
  askWorld(msg){ const got=[]; this.pack.capture=m=>got.push(m); try{ this.st.handle(msg); } finally{ this.pack.capture=null; } return got; }
  packLines(since){ return this.pack.lines.filter(l=>l.n>since); }
  packState(){ const s=this.askWorld({t:'agentState'})[0]||{n:0,at:0,lines:[]}; return { n:s.n, at:s.at, asleep:!this.timer, speed:this.st.speed, lines:s.lines }; }
  packAct(text){ const lines=String(text||'').split('\n').map(x=>x.trim()).filter(Boolean).slice(0,20); const out=[];
    for(const line of lines){ const a=this.askWorld({t:'intent', text:line})[0]; out.push(a?{line, ok:!!a.ok, who:a.who, why:a.why}:{line, ok:false, why:'мир не ответил'}); }
    if(lines.length) this.lastCmd=Date.now(); return out; }
  ops(k){ return [...this.clients].filter(c=>c.live&&(k===undefined||c.st===k)).map(c=>c.op.name); }
  stationsInfo(){ const u=this.st.snapshot().units; return this.st.links.map((L,k)=>({k, name:'ARK-04'+(1+k), ops:this.ops(k), units:u.filter(x=>x.st===k).length, alive:u.filter(x=>x.st===k&&x.alive).length})); }
  info(){ const u=this.st.snapshot().units; return {code:this.code, cfg:pubCfg(this.cfg), running:!!this.timer, lastCmd:this.lastCmd||0, ops:this.ops(), t:this.st.links[0].link.t, units:u.length, alive:u.filter(x=>x.alive).length, savedAt:Date.now(), stations:this.stationsInfo()}; }
  sendOps(){ const st=this.stationsInfo(); for(const c of this.clients) if(c.live) c.send(enc({t:'ops', ops:this.ops(c.st), stations:st})); }
  join(ws){ this.clients.add(ws); if(!this.timer){ this.schedule(); this.saveTimer=setInterval(()=>{ this.save(); this.flushLog(); },SAVE_EVERY); log(`${this.code}: мир идёт`); } }
  // лог мира (tech.md §12): JSONL, строка на запись, дописывается раз в SAVE_EVERY и при остановке; читать — tools/log-*.js
  flushLog(){ if(!this.logBuf.length) return; const s=this.logBuf.join('\n')+'\n'; this.logBuf=[]; try{ fs.appendFileSync(this.logFile,s); }catch(e){ log(`${this.code}: лог не записан: ${e.message}`); } }
  leave(ws){ this.clients.delete(ws); if(ws.live) this.st.log({k:'op', leave:ws.op.name, st:ws.st, wall:new Date().toISOString()}); this.sendOps(); if(!this.clients.size){ clearInterval(this.timer); clearInterval(this.saveTimer); this.timer=this.saveTimer=null; this.save(); this.flushLog(); log(`${this.code}: операторов нет, мир стоит`); } }
  schedule(){ if(this.timer) clearInterval(this.timer); this.timer=setInterval(()=>this.st.tick(), 100/this.st.speed); }
  hello(ws,since,op,st){   // выбор платформы, досылка пропущенного, потом — живой поток
    ws.op={ name:String(op&&op.name||'').replace(/[^\p{L}\p{N} _.-]/gu,'').trim().slice(0,24)||'оператор', token:String(op&&op.token||'').slice(0,32) };
    ws.st=Math.max(0,Math.min(this.st.links.length-1,st|0));
    if(ws.op.token) this.seen[ws.op.token]={name:ws.op.name, st:ws.st};
    const miss=this.rings[ws.st].filter(p=>p.n>since);
    ws.send(enc({t:'welcome', st:ws.st, name:'ARK-04'+(1+ws.st), operators:this.ops(ws.st).length+1, replay:miss.length, at:this.st.links[ws.st].link.t, speed:this.st.speed}));
    for(const p of miss) ws.send(enc({...p,replay:true}));
    ws.send(enc(this.st.modem(ws.st))); ws.live=true; this.sendOps(); this.st.log({k:'op', join:ws.op.name, st:ws.st, since, wall:new Date().toISOString()});
  }
  handle(ws,m){
    if(m.t==='hello'){ this.hello(ws,+m.since||0,m.op,+m.st||0); return; }
    if(!ws.live) return;
    m.st=ws.st;   // станция — та, к которой подключён оператор, а не та, что назвал клиент
    if(m.t==='up'){ this.st.handle(m); this.lastCmd=Date.now();   // lastCmd — для лобби: не просто сидят, а что-то делают
      // эхо сокомандникам той же платформы: кто что отправил — знание земной стороны, канала не проходит (tech.md §8)
      const e=enc({t:'echo',st:ws.st,op:ws.op.name,bytes:m.bytes}); for(const c of this.clients) if(c!==ws && c.live && c.st===ws.st) c.send(e);
      return; }
    if(DEBUG&&(m.t==='cfg'||m.t==='tp'||m.t==='peek')) this.st.handle(m);   // speed/load/save от клиентов не принимаются: ускорение — настройка комнаты, мир — у сервера
  }
  save(){ const d={v:3, savedAt:Date.now(), world:this.st.snapshot(), n:this.st.rxN(), cfg:this.cfg, seen:this.seen, rings:this.rings.map(r=>r.slice(-TAIL))};
    try{ fs.writeFileSync(this.file+'.tmp',enc(d)); fs.renameSync(this.file+'.tmp',this.file); }catch(e){ log(`${this.code}: сохранение не удалось: ${e.message}`); } }
}
const rooms=new Map(); const room=(code,cfg)=>{ if(!rooms.has(code)) rooms.set(code,new Room(code,cfg)); return rooms.get(code); };
// список станций для лобби: живые — из памяти, остальные — по файлам (читаются заново, только если файл изменился)
const diskInfo={};
function listRooms(){ const out=[]; const codes=new Set(rooms.keys());
  for(const f of fs.readdirSync(DATA)){ if(!f.endsWith('.json')) continue; const code=f.slice(0,-5); if(codes.has(code)) continue; codes.add(code);
    try{ const st=fs.statSync(path.join(DATA,f)); const c=diskInfo[code]; if(c&&c.mtime===st.mtimeMs){ out.push(c.info); continue; }
      const d=JSON.parse(fs.readFileSync(path.join(DATA,f),'utf8')); if(d.v!==3) continue; const u=d.world.units; const info={code, cfg:pubCfg(roomCfg(d.cfg||{})), ops:[], t:d.world.t||0, units:u.length, alive:u.filter(x=>x.alive).length, savedAt:d.savedAt,
        running:false, lastCmd:0, stations:(d.world.stations||[]).map(S=>({k:S.k, name:S.name, ops:[], units:u.filter(x=>x.st===S.k).length, alive:u.filter(x=>x.st===S.k&&x.alive).length}))}; diskInfo[code]={mtime:st.mtimeMs,info}; out.push(info); }catch(e){} }
  for(const r of rooms.values()) out.push(r.info());
  return out.sort((a,b)=>(b.ops.length-a.ops.length)||(b.savedAt-a.savedAt)); }
const log=s=>console.log(new Date().toISOString().slice(11,19)+' '+s);

// ---- HTTP-API агента-оператора: /op/join, /op/perceive, /op/act, /op/state, /op/leave (docs/agent-api.md §10). Агент — обычный клиент
// станции: виртуальная консоль (server/opconsole.js) входит в комнату как оператор платформы, получает те же пакеты, что консоль
// в браузере, и шлёт те же байты. Мир и станция разницы не видят; сессия держит мир идущим, как любой оператор.
const OP_TTL=10*60*1000, OP_MIN_MS=200; const opSessions=new Map();
class OpClient { constructor(){ this.oc=new OpConsole(); this.live=false; this.st=0; this.op={name:'агент',token:''}; this.waiters=[]; this.last=Date.now(); this.oc.onLine=()=>{ for(const w of this.waiters.splice(0)) w(); }; }
  send(s){ let m; try{ m=JSON.parse(s); }catch(e){ return; } this.oc.onMsg(m); } }
setInterval(()=>{ const now=Date.now(); for(const [id,S] of opSessions) if(now-S.client.last>OP_TTL){ S.room.leave(S.client); opSessions.delete(id); log(`${S.room.code}: агент-оператор ${S.client.op.name} вышел по тишине`); } },60000);
function opApi(req,res,u,op){
  const wantText=u.searchParams.get('text')==='1'||/^text\/plain/.test(req.headers.accept||'');
  const send=(code,obj,text)=>{ if(wantText&&text!==undefined){ res.writeHead(code,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}); res.end(text); } else { res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(obj)); } };
  const withBody=cb=>{ let body=''; req.on('data',c=>{ body+=c; if(body.length>2e4) req.destroy(); }); req.on('end',()=>{ let q={}; try{ q=JSON.parse(body||'{}'); }catch(e){ q={}; } cb(q); }); };
  const sess=q=>{ const id=String(q.id||u.searchParams.get('id')||''); const S=opSessions.get(id); if(!S){ send(404,{error:'сессии нет: сначала /op/join'},'сессии нет'); return null; }
    const now=Date.now(); if(now-S.client.last<OP_MIN_MS){ send(429,{error:'не чаще '+OP_MIN_MS+' мс'},'слишком часто'); return null; } S.client.last=now; return S; };
  const header=S=>{ const M=S.client.oc.modem; return M?`${M.up?'связь':'НЕТ СВЯЗИ'} · ${(M.cap/8).toFixed(0)} Б/с · в очереди ${M.qcmd+M.qbg} Б`:'модем: нет показаний'; };
  if(op==='join'&&req.method==='POST'){ withBody(q=>{ const code=String(q.room||'').trim(); if(!/^[\w-]{1,32}$/.test(code)){ send(400,{error:'нужен код планеты'},'нужен код планеты'); return; }
      const r=room(code); const c=new OpClient(); const id=crypto.randomBytes(8).toString('hex'); opSessions.set(id,{room:r,client:c});
      r.join(c); r.hello(c, 0, {name:String(q.name||'агент').slice(0,24), token:''}, +q.st||0); log(`${code}: агент-оператор ${c.op.name} на платформе ${c.st}`);
      const st=c.oc.state(); send(200,{ok:true, id, room:code, st:c.st, name:c.oc.name, n:c.oc.n, replay:c.oc.replay, speed:r.st.speed, lines:st, text:st.join('\n')}, `сессия ${id}\n`+st.join('\n')+`\n— ${header({client:c})}, n=${c.oc.n}, досыл ${c.oc.replay} пакетов`); }); return; }
  if(op==='perceive'&&req.method==='GET'){ const S=sess({}); if(!S) return; const c=S.client, since=+u.searchParams.get('since')||0, wait=Math.max(0,Math.min(PACK_WAIT_MAX,+u.searchParams.get('wait')||0));
    const reply=()=>{ const lines=c.oc.lines.filter(l=>l.n>since); const n=lines.length?lines[lines.length-1].n:c.oc.n; const M=c.oc.modem;
      send(200,{n, at:+c.oc.tNow.toFixed(1), speed:S.room.st.speed, modem:M?{up:M.up,cap:M.cap,queue:M.qcmd+M.qbg,eta:M.queue.map(g=>({id:g.id,kind:g.kind,unit:g.unit,eta:g.eta}))}:null, lines, text:lines.map(l=>`${mmss(l.at)} ${l.text}`).join('\n')}, lines.map(l=>`${mmss(l.at)} ${l.text}`).join('\n')+(lines.length?'\n':'')+`— ${header(S)}, n=${n}`); };
    if(c.oc.lines.some(l=>l.n>since)||!wait) return reply();
    let done=false; const fire=()=>{ if(done) return; done=true; clearTimeout(tm); reply(); }; const tm=setTimeout(fire,wait*1000); c.waiters.push(fire); req.on('close',()=>{ done=true; clearTimeout(tm); }); return; }
  if(op==='act'&&req.method==='POST'){ withBody(q=>{ const S=sess(q); if(!S) return; const c=S.client; const lines=(Array.isArray(q.acts)?q.acts:String(q.acts||q.text||'').split('\n')).map(x=>x.trim()).filter(Boolean).slice(0,20); const results=[];
      for(const line of lines){ const p=c.oc.parse(line); if(p.error){ results.push({line, ok:false, why:p.error}); continue; } if(!c.oc.modem||!c.oc.modem.up){ results.push({line, ok:false, why:'нет связи со станцией'}); continue; }
        S.room.handle(c,{t:'up',bytes:p.bytes}); c.oc.say('→ '+p.label); results.push({line, ok:true, sent:p.label, bytes:p.bytes}); }
      send(200,{results}, results.map(x=>`${x.ok?'отправлено':'отказ'} — ${x.line}${x.why?' ('+x.why+')':''}${x.sent?' → '+x.sent:''}`).join('\n')); }); return; }
  if(op==='state'&&req.method==='GET'){ const S=sess({}); if(!S) return; const st=S.client.oc.state(); send(200,{n:S.client.oc.n, lines:st, text:st.join('\n')}, st.join('\n')+`\n— ${header(S)}, n=${S.client.oc.n}`); return; }
  if(op==='leave'&&req.method==='POST'){ withBody(q=>{ const id=String(q.id||''); const S=opSessions.get(id); if(S){ S.room.leave(S.client); opSessions.delete(id); } send(200,{ok:true},'вышел'); }); return; }
  send(404,{error:'нет такого: /op/join (POST), /op/perceive (GET), /op/act (POST), /op/state (GET), /op/leave (POST)'},'нет такого');
}

// ---- HTTP-API агента стаи: /pack/join, /pack/perceive, /pack/act (docs/agent-api.md). Планета — по коду и токену стаи из настроек.
// Сессия RTS: если операторов нет, мир стоит — asleep:true, лента не растёт. Ответ — JSON; ?text=1 или Accept: text/plain — только текст ленты.
const mmss=at=>`${String(Math.floor(at/60)).padStart(2,'0')}:${String(Math.floor(at%60)).padStart(2,'0')}`, fmtLine=l=>`${mmss(l.at)} О${l.who}: ${l.text}`;
function packApi(req,res,u,op){
  const wantText=u.searchParams.get('text')==='1'||/^text\/plain/.test(req.headers.accept||'');
  const send=(code,obj,text)=>{ if(wantText&&text!==undefined){ res.writeHead(code,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}); res.end(text); } else { res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(obj)); } };
  const withBody=cb=>{ let body=''; req.on('data',c=>{ body+=c; if(body.length>2e4) req.destroy(); }); req.on('end',()=>{ let q={}; try{ q=JSON.parse(body||'{}'); }catch(e){ q={}; } cb(q); }); };
  const auth=q=>{ const code=String(q.room||u.searchParams.get('room')||'').trim(), token=String(q.token||u.searchParams.get('token')||'').trim();
    if(!/^[\w-]{1,32}$/.test(code)||!rooms.has(code)&&!fs.existsSync(path.join(DATA,code+'.json'))){ send(404,{error:'планеты нет: '+code},'планеты нет'); return null; }
    const r=room(code); if(token!==r.cfg.pack){ send(401,{error:'токен стаи не подходит'},'токен стаи не подходит'); return null; }
    const now=Date.now(); if(now-r.pack.last<PACK_MIN_MS){ send(429,{error:'не чаще '+PACK_MIN_MS+' мс'},'слишком часто'); return null; } r.pack.last=now; return r; };
  if(op==='join'&&req.method==='POST'){ withBody(q=>{ const r=auth(q); if(!r) return; const s=r.packState(); r.st.log({k:'pack', join:true, wall:new Date().toISOString()});
      send(200,{ok:true, room:r.code, ...s, text:s.lines.join('\n')}, s.lines.join('\n')+`\n— часы мира ${mmss(s.at)}, ${s.asleep?'стая спит: операторов нет':'мир идёт'}, n=${s.n}`); }); return; }
  if(op==='perceive'&&req.method==='GET'){ const r=auth({}); if(!r) return; const since=+u.searchParams.get('since')||0, wait=Math.max(0,Math.min(PACK_WAIT_MAX,+u.searchParams.get('wait')||0));
    const reply=()=>{ const lines=r.packLines(since); const n=lines.length?lines[lines.length-1].n:Math.max(since,r.pack.lines.length?r.pack.lines[r.pack.lines.length-1].n:since); const at=r.st.links[0].link.t;
      send(200,{n, at:+at.toFixed(1), asleep:!r.timer, speed:r.st.speed, lines, text:lines.map(fmtLine).join('\n')}, lines.map(fmtLine).join('\n')+(lines.length?'\n':'')+`— n=${n}, ${r.timer?'мир идёт':'стая спит: операторов нет'}`); };
    if(r.packLines(since).length||!wait||!r.timer) return reply();
    let done=false; const fire=()=>{ if(done) return; done=true; clearTimeout(tm); reply(); }; const tm=setTimeout(fire,wait*1000); r.pack.waiters.push(fire); req.on('close',()=>{ done=true; clearTimeout(tm); }); return; }
  if(op==='act'&&req.method==='POST'){ withBody(q=>{ const r=auth(q); if(!r) return; const acts=Array.isArray(q.acts)?q.acts.join('\n'):String(q.acts||q.text||''); const results=r.packAct(acts);
      for(const x of results) r.st.log({k:'pack', act:x.line, ok:x.ok, why:x.why}); send(200,{results, asleep:!r.timer}, results.map(x=>`${x.ok?'принято':'отказ'} — ${x.line}${x.why?' ('+x.why+')':''}`).join('\n')); }); return; }
  send(404,{error:'нет такого: /pack/join (POST), /pack/perceive (GET), /pack/act (POST)'},'нет такого');
}

// статика: proto/ в корне, без кэша
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon'};
const server=http.createServer((req,res)=>{
  const u=new URL(req.url,'http://x'); let f=decodeURIComponent(u.pathname); if(f==='/') f='/lobby.html';   // корень — лобби; консоль — index.html?room=КОД
  if(f==='/rooms'&&req.method==='POST'){   // создать планету с настройками (если уже есть — настройки не меняются)
    let body=''; req.on('data',c=>{ body+=c; if(body.length>1e4) req.destroy(); }); req.on('end',()=>{ let q={}; try{ q=JSON.parse(body); }catch(e){}
      const code=String(q.code||'').trim(); if(!/^[\w-]{1,32}$/.test(code)){ res.writeHead(400); res.end('bad code'); return; }
      const fresh=!rooms.has(code); const r=room(code,q); res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify({...r.info(), pack:fresh?r.cfg.pack:undefined})); }); return; }   // токен стаи — только создателю, один раз
  if(f.startsWith('/pack/')){ packApi(req,res,u,f.slice(6)); return; }
  if(f.startsWith('/op/')){ opApi(req,res,u,f.slice(4)); return; }
  if(f==='/rooms'){ res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}); res.end(JSON.stringify(listRooms())); return; }
  if(f==='/level.js'){ res.writeHead(200,{'Content-Type':MIME['.js'],'Cache-Control':'no-store'}); res.end(levelSrc); return; }   // карта сервера, та же, что в мире (спектатор, проверки)
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
process.on('SIGTERM',()=>{ for(const r of rooms.values()){ r.save(); r.flushLog(); } process.exit(0); });
process.on('SIGINT',()=>{ for(const r of rooms.values()){ r.save(); r.flushLog(); } process.exit(0); });
server.listen(PORT,()=>log(`станция слушает :${PORT}, данные в ${DATA}${DEBUG?', отладка':''}, карта ${LEVEL_FILE?levelPath:'proto/level.js'} (площадок ${MAXN})`));

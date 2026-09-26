#!/usr/bin/env node
// СЕРВЕРНЫЙ ХОСТ СТАНЦИИ. Комната = один мир с NST посадочными платформами (proto/station.js): у каждой платформы свои
// миссионеры, запасы и канал 512 бит/с; оператор при входе выбирает платформу (несколько операторов на одной — кооператив,
// канал делят). Раздаёт proto/ статикой, держит WebSocket /ws?room=КОД (операторы) и /ws?room=КОД&spectate=1 (зрители: лог мира живьём для
// spectate.html?room=КОД, мир не запускают). Мир идёт, только пока в комнате есть операторы.
// Сохранение — JSON-файл на комнату в DATA_DIR (по умолчанию /home/data на App Service, иначе ./data): снимок мира,
// номера последних пакетов и хвосты доставленных пакетов по платформам — ими досылаются пропуски при повторном подключении.
// Запуск: node server/index.js [порт] [debug] [level=ФАЙЛ]   (или PORT, DATA_DIR, DEBUG=1, LEVEL_FILE; debug — отдавать правду о мире в шторку
// и принимать телепорт; level — ещё одна карта сверх proto/maps/: файл в формате уровня, например экспорт из редактора, id — из meta).
// Карты: все proto/maps/*.js, у каждой комнаты своя (cfg.map, задаётся при создании, хранится в сохранении); нет в запросе — MAP_DEFAULT (act1).
const fs=require('fs'), path=require('path'), http=require('http'), zlib=require('zlib'), crypto=require('crypto');
const {WebSocketServer}=require('ws'); const {decodePNG}=require('../tools/png.js'); const {OpConsole}=require('./opconsole.js');
const ROOT=path.join(__dirname,'..'), P=path.join(ROOT,'proto')+'/';
const PORT=+process.argv[2]||+process.env.PORT||8765, DEBUG=!!process.env.DEBUG||process.argv.includes('debug');
const LEVEL_FILE=(process.argv.find(a=>a.startsWith('level='))||'').slice(6)||process.env.LEVEL_FILE||'';   // своя карта: путь к файлу уровня
const DATA=process.env.DATA_DIR||(process.env.WEBSITE_SITE_NAME?'/home/data':path.join(ROOT,'data'));   // WEBSITE_SITE_NAME — признак App Service
fs.mkdirSync(DATA,{recursive:true});
const RING=20000, SAVE_EVERY=10000, TAIL=5000, SPECT_TAIL=2<<20;   // SPECT_TAIL — сколько байт лога мира зритель получает при входе (~2 ч игры)
const PACK_RING=2000, PACK_WAIT_MAX=30, PACK_MIN_MS=200;   // сторона стаи: буфер ленты, потолок долгого опроса (App Service рвёт запросы дольше ~230 с), мягкий лимит частоты на токен

// станция и мир — теми же исходниками, что в браузере
const read=f=>fs.readFileSync(P+f,'utf8');
const makeStation=new Function(read('link.js')+'\n'+read('station.js')+'\nreturn makeStation;')();
const {levelCheck}=require('../proto/codebook.js');
// карты: proto/maps/*.js и, если задан, level=ФАЙЛ. id — из meta (для файлов из maps/ должен совпадать с именем). Карта чужого формата не поднимается.
const MAPS={};
function loadMap(file){ let src, L; try{ src=fs.readFileSync(file,'utf8'); if(!/^\/\/ УРОВЕНЬ/.test(src)||!/\nconst LEVEL = \{/.test(src)) throw new Error('не файл уровня'); L=new Function(src+'\nreturn LEVEL;')(); const e=levelCheck(L); if(e) throw new Error(e);
    if(path.dirname(file)===path.join(P,'maps')&&path.basename(file,'.js')!==L.meta.id) throw new Error(`meta.id «${L.meta.id}» не совпадает с именем файла`); }
  catch(e){ console.error(`карта ${file} не поднята: ${e.message}`); return; }
  MAPS[L.meta.id]={ id:L.meta.id, name:L.meta.name||L.meta.id, v:L.meta.v||0, format:L.meta.format, sites:L.sites.length, file, worldSrc:[src, ...['codebook.js','terrain.js','camera.js','world.js'].map(read)].join('\n') }; }
for(const f of fs.readdirSync(P+'maps').filter(f=>/^[a-z0-9_-]+\.js$/.test(f)).sort()) loadMap(P+'maps/'+f);
if(LEVEL_FILE) loadMap(path.resolve(LEVEL_FILE));
const MAP_DEFAULT=MAPS[process.env.MAP_DEFAULT]?process.env.MAP_DEFAULT:MAPS.act1?'act1':Object.keys(MAPS)[0];
if(!MAP_DEFAULT){ console.error('ни одной карты (proto/maps/*.js)'); process.exit(1); }
const mapsInfo=()=>Object.values(MAPS).map(({worldSrc,file,...m})=>m);   // наружу (GET /maps, лобби): без текста
const atlas=(()=>{ const a=decodePNG(fs.readFileSync(P+'sprites.png')); const json=JSON.parse(read('sprites.json')); const px=new Uint8Array(a.w*a.h*4); for(let i=0;i<a.w*a.h;i++){ px[i*4]=a.gray[i]; px[i*4+3]=a.alpha[i]; } return {json,px}; })();
const replacer=(k,v)=>v instanceof Uint8Array?Array.from(v):v;
const enc=m=>JSON.stringify(m,replacer);

// настройки комнаты задаёт создатель в лобби, одинаковы для всех платформ: карта, число платформ (не больше площадок карты), ёмкость дальней линии, ускорение времени
const CAPS=[512,1024,2048,4096], SPEEDS=[1,2,4];
// teams — команда каждой платформы («0,0,1,1»: первые две вместе); нет или не по числу платформ — каждая сама за себя. voice — радиус голоса стаи, м (0 — без предела).
// Оба уходят миру строкой search (tech.md §6: &teams=…&voice=…); сервер их не толкует
const roomCfg=q=>{ const map=MAPS[q.map]?q.map:MAP_DEFAULT; const n=Math.max(2,Math.min(MAPS[map].sites,+q.n||2));
  const teams=String(Array.isArray(q.teams)?q.teams.join(','):q.teams||'').split(',').map(x=>x.trim()).filter(x=>/^\d$/.test(x)).map(Number);
  const hex=v=>/^[0-9a-f]{12,32}$/.test(v||'')?v:crypto.randomBytes(8).toString('hex');
  return { map, n, cap:CAPS.includes(+q.cap)?+q.cap:512, speed:SPEEDS.includes(+q.speed)?+q.speed:1, teams:teams.length===n&&new Set(teams).size<n?teams:[], voice:Math.max(0,Math.min(2000,+q.voice||0)),
  pack:hex(q.pack), ops:[...Array(n).keys()].map(k=>hex(q.ops&&q.ops[k])) }; };   // pack, ops[k] — секреты ролей: стая и каждая платформа; из них собираются ключи агентов (roleKey), выдаются создателю планеты один раз
const worldSearch=c=>'?v=0&st='+c.n+(c.teams.length?'&teams='+c.teams.join(','):'')+(c.voice?'&voice='+c.voice:'');
const pubCfg=c=>{ const {pack,ops,...o}=c; return o; };   // наружу (список планет) секреты не отдаются
// Ключ агента: КОД.РОЛЬ.СЕКРЕТ — код планеты, роль (op0…op3 — платформа, pack — стая), секрет роли. Ключи видны всем в лобби (авторизации
// в игре нет, код планеты и есть приглашение; привязывать планету к браузеру создателя нельзя — доступ терялся бы со сменой браузера);
// человек передаёт ключ своему агенту, по ключу агент получает спеку своей роли (GET /agent/КЛЮЧ) и входит (/op/join, /pack/join {key}).
const roleKey=(code,cfg,role)=>`${code}.${role}.${role==='pack'?cfg.pack:cfg.ops[+role.slice(2)]}`;
const roleKeys=(code,cfg)=>({ ops:cfg.ops.map((_,k)=>roleKey(code,cfg,'op'+k)), pack:roleKey(code,cfg,'pack') });
function parseKey(key){ const m=/^([\w-]{1,32})\.(op\d|pack)\.([0-9a-f]{12,32})$/.exec(String(key||'').trim()); if(!m) return null;
  const code=m[1]; if(!rooms.has(code)&&!fs.existsSync(path.join(DATA,code+'.json'))) return null; const r=room(code);
  const role=m[2], st=role==='pack'?-1:+role.slice(2); if(role!=='pack'&&!r.cfg.ops[st]) return null; if(m[3]!==(role==='pack'?r.cfg.pack:r.cfg.ops[st])) return null; return {room:r, role, st}; }
class Room {
  constructor(code,cfg){ this.code=code; this.file=path.join(DATA,code+'.json'); this.logFile=path.join(DATA,code+'.log'); this.logBuf=[]; this.clients=new Set(); this.watchers=new Set(); this.timer=null; this.saveTimer=null; this.seen={};   // seen: токен → {name, st}, все операторы, что были в комнате
    let d=null; try{ d=JSON.parse(fs.readFileSync(this.file,'utf8')); if(d.v!==4){ log(`${code}: старый формат сохранения v${d.v}, новая планета`); d=null; } }
    catch(e){ if(e.code!=='ENOENT') log(`${code}: сохранение не прочитано (${e.message}), новая планета`); }
    this.cfg=roomCfg(d?(d.cfg||{}):(cfg||{}));   // карта и число платформ — из сохранения, если оно есть: мир уже с ними
    if(d&&d.cfg&&d.cfg.map&&d.cfg.map!==this.cfg.map) log(`${code}: карты «${d.cfg.map}» на сервере нет, планета поднята на «${this.cfg.map}» — снимок мира может не сойтись с картой`);
    if(d&&d.map&&d.map.id===this.cfg.map&&d.map.v!==MAPS[this.cfg.map].v) log(`${code}: карта ${d.map.id} v${d.map.v} → v${MAPS[this.cfg.map].v}, снимок мира может не сойтись с картой`);
    this.pack={ lines:[], waiters:[], last:0, capture:null };   // сторона стаи: лента восприятия с курсором n, ожидающие долгого опроса, время последнего запроса, перехват ответов мира
    this.agents=d&&d.agents||{};   // сессии агентов-операторов из сохранения (id → имя, платформа, курсор журнала): поднимаются по первому запросу с этим id (opApi)
    this.packHold=d&&d.packHold||null;   // сессия стаи: {sid, name, since, last, alive — особи, живые при входе}; роль занята, пока сессия не вышла или не замолчала на OP_TTL
    this.winner=d&&d.winner||null; this.history=d&&d.history||[];   // объявленная победа (до возобновления) и прежние, оспоренные возобновлением
    this.stopped=d&&d.stopped||null; this.savedAt=d&&d.savedAt||Date.now();   // stopped: «конец игры» — кто и когда, до входа человека через лобби; savedAt — когда последний раз записана (лобби: «стоит · N назад»)
    this.st=makeStation({ worldSrc:MAPS[this.cfg.map].worldSrc, search:worldSearch(this.cfg), debug:DEBUG, out:m=>this.out(m), agent:m=>this.onAgent(m), log:r=>{ const s=JSON.stringify(r); this.logBuf.push(s); for(const w of this.watchers) if(w.readyState===1) w.send(s); } }); this.rings=this.st.links.map(()=>[]);
    // атлас — после того, как отвергнутый fetch в CAM.load отработает (иначе он обнулит атлас)
    setImmediate(()=>this.st.W.CAM.build(atlas.json,atlas.px));
    if(d){ this.st.restore(d.world,d.n); (d.rings||[]).forEach((r,k)=>{ if(this.rings[k]) this.rings[k]=r; }); this.seen=d.seen||{}; log(`${code}: восстановлена, карта ${this.cfg.map}, t=${d.world.t|0} с, платформ ${this.cfg.n}, пакетов ${[].concat(d.n).join('/')}`); }
    else log(`${code}: новая планета, карта ${this.cfg.map}, платформ ${this.cfg.n}${this.cfg.teams.length?', команды '+this.cfg.teams.join(','):''}${this.cfg.voice?', голос стаи '+this.cfg.voice+' м':''}`);
    this.st.log({k:'start', host:'server', code, cfg:pubCfg(this.cfg), map:this.st.meta, restored:!!d, wall:new Date().toISOString()});
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
  // Одна роль — один игрок (docs/agent-api.md §3): кто держит платформу k — живой клиент (консоль в браузере или сессия агента) или сессия агента
  // из сохранения, ещё не вернувшаяся после перезапуска. Тот же игрок — тот же токен браузера или тот же id сессии, не имя
  holder(k){ for(const c of this.clients) if(c.live&&c.st===k) return {name:c.op.name, since:c.since, token:c.op.token, sid:c.sid, c};
    for(const [id,a] of Object.entries(this.agents)) if(a.st===k&&Date.now()-a.last<OP_TTL) return {name:a.name, since:a.since||a.last, sid:id};
    return null; }
  packHolder(){ const h=this.packHold; return h&&Date.now()-h.last<OP_TTL?h:null; }
  busyText(h){ return `роль занята: ${h.name}, с ${new Date(h.since).toISOString().slice(0,16).replace('T',' ')} UTC; свободна после выхода или 10 мин тишины`; }
  stationsInfo(){ const u=this.st.snapshot().units; return this.st.links.map((L,k)=>({k, name:'ARK-04'+(1+k), ops:this.ops(k), holder:(h=>h&&{name:h.name, since:h.since})(this.holder(k)), units:u.filter(x=>x.st===k).length, alive:u.filter(x=>x.st===k&&x.alive).length})); }
  info(){ const u=this.st.snapshot().units; return {code:this.code, cfg:pubCfg(this.cfg), running:!!this.timer, lastCmd:this.lastCmd||0, ops:this.ops(), t:this.st.links[0].link.t, units:u.length, alive:u.filter(x=>x.alive).length, savedAt:this.timer?Date.now():this.savedAt, stations:this.stationsInfo(), pack:(h=>h&&{name:h.name, since:h.since})(this.packHolder()), stopped:this.stopped, winner:this.winner, disputed:!this.winner&&this.history.length?this.history[this.history.length-1]:null, keys:roleKeys(this.code,this.cfg)}; }
  // «конец игры, меня мама позвала домой»: любой человек (лобби) или агент останавливает комнату для всех — консоли отключаются и не переподключаются,
  // сессии агентов закрываются, мир стоит и сохраняется. Снимает остановку человек: кнопка «продолжить» в лобби или вход консоли (hello) — так повторный вход агентов идёт по согласованию с людьми
  // Возобновляет только человек: «возобновить» в лобби или вход консоли (hello). Возобновление после объявленной победы её оспаривает: победа уходит в историю
  resume(by){ if(!this.stopped) return; const wall=new Date().toISOString(); log(`${this.code}: остановка снята — ${by}`);
    if(this.winner){ this.history.push({...this.winner, disputed:{by, wall}}); this.st.log({k:'disputed', by, winner:this.winner, wall}); this.winner=null; }
    this.st.log({k:'resume', by, wall}); this.stopped=null; this.save(); }
  // Факт мира за победой: оператору — планшет на складе его платформы; стае — живы все особи, живые при её входе. Нет факта — победа «заявлена»
  winFact(role){ const w=this.st.snapshot();
    if(role==='pack'){ const h=this.packHold, alive=h&&h.alive||[]; const ok=alive.length>0&&alive.every(i=>w.pack[i]&&w.pack[i].act!=='dead'); return {confirmed:ok, fact:ok?`все особи, живые при входе, живы (${alive.length})`:''}; }
    const S=w.stations[+String(role).slice(2)]; const ok=!!(S&&S.store&&S.store[44]>0); return {confirmed:ok, fact:ok?'планшет на складе':''}; }
  // Завершение с причиной: pause — пауза (человек из лобби, агент), win — объявление победы ролью (who: {role, name}). Всех выкидывает, мир стоит
  stop(by,opt={}){ const reason=opt.reason==='win'&&opt.who?'win':'pause', wall=new Date().toISOString(), t=+this.st.links[0].link.t.toFixed(1);
    this.stopped={by:String(by||'кто-то').slice(0,40), reason, wall, t};
    if(reason==='win'){ const role=opt.who.role; this.winner={role, side:role==='pack'?'стая':'ARK-04'+(1+ +role.slice(2)), name:opt.who.name, note:String(opt.note||'').slice(0,200), ...this.winFact(role), wall, t}; this.stopped.winner=this.winner; }
    this.st.log({k:reason, by:this.stopped.by, winner:this.winner||undefined, wall});
    const s=enc({t:'stopped', by:this.stopped.by, reason, winner:this.winner}); for(const c of [...this.clients]){ if(c.live) c.send(s); if(c.close) c.close(); else this.leave(c); }
    for(const [id,S] of opSessions) if(S.room===this){ opSessions.delete(id); stoppedSessions.set(id,{room:this, stopped:this.stopped}); } this.agents={}; this.packHold=null;
    for(const w of this.pack.waiters.splice(0)) w(); this.save(); log(`${this.code}: остановлена — ${this.stopped.by}`); }
  sendOps(){ const st=this.stationsInfo(); for(const c of this.clients) if(c.live) c.send(enc({t:'ops', ops:this.ops(c.st), stations:st})); }
  join(ws){ this.clients.add(ws); if(!this.timer){ this.schedule(); this.saveTimer=setInterval(()=>{ this.save(); this.flushLog(); },SAVE_EVERY); log(`${this.code}: мир идёт`); } }
  // лог мира (tech.md §12): JSONL, строка на запись, дописывается раз в SAVE_EVERY и при остановке; читать — tools/log-*.js
  flushLog(){ if(!this.logBuf.length) return; const s=this.logBuf.join('\n')+'\n'; this.logBuf=[]; try{ fs.appendFileSync(this.logFile,s); }catch(e){ log(`${this.code}: лог не записан: ${e.message}`); } }
  // зрители (spectate.html?room=КОД): не операторы — мир от них не идёт. При входе — хвост лога мира (файл до SPECT_TAIL байт + несброшенный буфер),
  // дальше каждая запись лога по мере появления; спектатор читает те же строки JSONL, что и из файла. Первая запись — live: число платформ, ускорение, идёт ли мир
  watch(ws){ this.watchers.add(ws); const head=JSON.stringify({t:+this.st.links[0].link.t.toFixed(1), k:'live', code:this.code, n:this.cfg.n, map:this.st.meta, speed:this.st.speed, running:!!this.timer, teams:this.cfg.teams, ops:this.st.links.map((_,k)=>this.ops(k))});   // ops — кто сейчас на платформах: хвост лога может не содержать их входа
    let tail=''; try{ const fd=fs.openSync(this.logFile,'r'); try{ const size=fs.fstatSync(fd).size, len=Math.min(size,SPECT_TAIL), b=Buffer.alloc(len); fs.readSync(fd,b,0,len,size-len); tail=b.toString('utf8'); if(len<size){ const i=tail.indexOf('\n'); tail=i<0?'':tail.slice(i+1); } } finally{ fs.closeSync(fd); } }catch(e){}
    ws.send([head, tail.trimEnd(), ...this.logBuf].filter(Boolean).join('\n')); }
  unwatch(ws){ this.watchers.delete(ws); }
  leave(ws){ this.clients.delete(ws); if(ws.live) this.st.log({k:'op', leave:ws.op.name, st:ws.st, wall:new Date().toISOString()}); this.sendOps(); if(!this.clients.size){ clearInterval(this.timer); clearInterval(this.saveTimer); this.timer=this.saveTimer=null; this.save(); this.flushLog(); log(`${this.code}: операторов нет, мир стоит`); } }
  schedule(){ if(this.timer) clearInterval(this.timer); this.timer=setInterval(()=>this.st.tick(), 100/this.st.speed); }
  hello(ws,since,op,st){   // выбор платформы, досылка пропущенного, потом — живой поток
    ws.op={ name:opName(op&&op.name), token:String(op&&op.token||'').slice(0,32) };
    ws.st=Math.max(0,Math.min(this.st.links.length-1,st|0));
    const h=this.holder(ws.st);
    if(h&&h.c!==ws){ const same=ws.sid?h.sid===ws.sid:!!ws.op.token&&h.token===ws.op.token&&!h.sid;
      if(!same){ ws.send(enc({t:'busy', st:ws.st, by:h.name, since:h.since, text:this.busyText(h)})); if(ws.close) ws.close(); return false; }
      if(h.c){ h.c.live=false; this.clients.delete(h.c); if(h.c.close) h.c.close(); } }   // тот же игрок (переподключение, вторая вкладка) — прежнее соединение закрыть
    ws.since=Date.now();
    if(ws.op.token) this.seen[ws.op.token]={name:ws.op.name, st:ws.st};
    const miss=this.rings[ws.st].filter(p=>p.n>since);
    ws.send(enc({t:'welcome', st:ws.st, name:'ARK-04'+(1+ws.st), operators:this.ops(ws.st).length+1, replay:miss.length, at:this.st.links[ws.st].link.t, speed:this.st.speed}));
    for(const p of miss) ws.send(enc({...p,replay:true}));
    ws.send(enc(this.st.modem(ws.st))); ws.live=true; this.sendOps(); this.st.log({k:'op', join:ws.op.name, st:ws.st, since, wall:new Date().toISOString()});
    if(this.stopped&&ws.close) this.resume(ws.op.name);   // консоль человека — остановка снята, агентов снова пускают
    return true;
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
  save(){ this.savedAt=Date.now();
    const agents={}; for(const [id,a] of Object.entries(this.agents)) if(this.savedAt-a.last<OP_TTL) agents[id]=a;   // ещё не вернувшиеся после перезапуска
    for(const [id,S] of opSessions) if(S.room===this) agents[id]={name:S.client.op.name, st:S.client.st, n:S.client.oc.n, last:S.client.last, since:S.client.since};
    const d={v:4, savedAt:this.savedAt, map:this.st.meta, world:this.st.snapshot(), n:this.st.rxN(), cfg:this.cfg, seen:this.seen, stopped:this.stopped, agents, packHold:this.packHold, winner:this.winner, history:this.history, rings:this.rings.map(r=>r.slice(-TAIL))};
    try{ fs.writeFileSync(this.file+'.tmp',enc(d)); fs.renameSync(this.file+'.tmp',this.file); }catch(e){ log(`${this.code}: сохранение не удалось: ${e.message}`); } }
}
const opName=s=>String(s||'').replace(/[^\p{L}\p{N} _.-]/gu,'').trim().slice(0,24)||'оператор';
const rooms=new Map(); const room=(code,cfg)=>{ if(!rooms.has(code)) rooms.set(code,new Room(code,cfg)); return rooms.get(code); };
// список станций для лобби: живые — из памяти, остальные — по файлам (читаются заново, только если файл изменился)
const diskInfo={};
function listRooms(){ const out=[]; const codes=new Set(rooms.keys());
  for(const f of fs.readdirSync(DATA)){ if(!f.endsWith('.json')) continue; const code=f.slice(0,-5); if(codes.has(code)) continue; codes.add(code);
    try{ const st=fs.statSync(path.join(DATA,f)); const c=diskInfo[code]; if(c&&c.mtime===st.mtimeMs){ out.push(c.info); continue; }
      const d=JSON.parse(fs.readFileSync(path.join(DATA,f),'utf8')); if(d.v!==4) continue; const u=d.world.units; const info={code, cfg:pubCfg(roomCfg(d.cfg||{})), ops:[], t:d.world.t||0, units:u.length, alive:u.filter(x=>x.alive).length, savedAt:d.savedAt,
        running:false, lastCmd:0, stations:(d.world.stations||[]).map(S=>({k:S.k, name:S.name, ops:[], holder:(a=>a&&{name:a.name, since:a.since||a.last})(Object.values(d.agents||{}).find(a=>a.st===S.k&&Date.now()-a.last<OP_TTL)), units:u.filter(x=>x.st===S.k).length, alive:u.filter(x=>x.st===S.k&&x.alive).length})),
        pack:d.packHold&&Date.now()-d.packHold.last<OP_TTL?{name:d.packHold.name, since:d.packHold.since}:null, stopped:d.stopped||null, winner:d.winner||null, disputed:!d.winner&&(d.history||[]).length?d.history[d.history.length-1]:null, keys:roleKeys(code,roomCfg(d.cfg||{}))}; diskInfo[code]={mtime:st.mtimeMs,info}; out.push(info); }catch(e){} }
  for(const r of rooms.values()) out.push(r.info());
  return out.sort((a,b)=>(b.ops.length-a.ops.length)||(b.savedAt-a.savedAt)); }
const log=s=>console.log(new Date().toISOString().slice(11,19)+' '+s);

// ---- HTTP-API агента-оператора: /op/join, /op/perceive, /op/act, /op/state, /op/leave (docs/agent-api.md §10). Агент — обычный клиент
// станции: виртуальная консоль (server/opconsole.js) входит в комнату как оператор платформы, получает те же пакеты, что консоль
// в браузере, и шлёт те же байты. Мир и станция разницы не видят; сессия держит мир идущим, как любой оператор.
// ответ на остановку текстом: пауза или победа — чья, подтверждена миром или заявлена
const stopText=r=>{ const w=r.winner; return w&&r.stopped.reason==='win'?`победа объявлена: ${w.side} (${w.name})${w.note?' — '+w.note:''}; ${w.confirmed?'подтверждена миром: '+w.fact:'заявлена (факта мира нет)'}; игра остановлена для всех`:'пауза: игра остановлена для всех'; };
const OP_TTL=10*60*1000, OP_MIN_MS=200; const opSessions=new Map();
class OpClient { constructor(){ this.oc=new OpConsole(); this.live=false; this.st=0; this.op={name:'агент',token:''}; this.waiters=[]; this.last=Date.now(); this.oc.onLine=()=>{ for(const w of this.waiters.splice(0)) w(); }; }
  send(s){ let m; try{ m=JSON.parse(s); }catch(e){ return; } this.oc.onMsg(m); } }
const stoppedSessions=new Map();   // id закрытой остановкой сессии → {room, stopped}: чтобы агент понял, почему сессии нет
const STOP_HINT='вход — когда человек снимет остановку: «продолжить» у планеты в лобби или вход консоли планеты';
// Сессия — id вида КОД.hex: после перезапуска сервера комната поднимает её из сохранения (Room.agents) по первому же запросу — тот же id, тот же
// курсор журнала; строки за секунды до перезапуска могут пропасть. Пропавшая или устаревшая — 404, повторный /op/join
function opSession(id){ const S=opSessions.get(id); if(S) return S; const m=/^([\w-]{1,32})\.[0-9a-f]{16}$/.exec(id); if(!m||!rooms.has(m[1])&&!fs.existsSync(path.join(DATA,m[1]+'.json'))) return null;
  const r=room(m[1]), a=r.agents[id]; if(!a||r.stopped) return null; delete r.agents[id]; if(Date.now()-a.last>OP_TTL) return null;
  const c=new OpClient(); c.last=0; c.sid=id; c.oc.n=a.n|0; opSessions.set(id,{room:r,client:c}); r.join(c); r.hello(c,0,{name:a.name,token:''},a.st); c.since=a.since||c.since;
  c.oc.say('сессия восстановлена после перезапуска сервера; строки журнала перед перезапуском могли пропасть, картина сейчас — /op/state'); log(`${r.code}: агент-оператор ${c.op.name} восстановлен на платформе ${c.st}`); return opSessions.get(id); }
setInterval(()=>{ const now=Date.now(); for(const [id,S] of opSessions) if(now-S.client.last>OP_TTL){ opSessions.delete(id); S.room.leave(S.client); log(`${S.room.code}: агент-оператор ${S.client.op.name} вышел по тишине`); } },60000);
function opApi(req,res,u,op){
  const wantText=u.searchParams.get('text')==='1'||/^text\/plain/.test(req.headers.accept||'');
  const send=(code,obj,text)=>{ if(wantText&&text!==undefined){ res.writeHead(code,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}); res.end(text); } else { res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(obj)); } };
  const withBody=cb=>{ let body=''; req.on('data',c=>{ body+=c; if(body.length>2e4) req.destroy(); }); req.on('end',()=>{ let q={}; try{ q=JSON.parse(body||'{}'); }catch(e){ q={}; } cb(q); }); };
  const sess=q=>{ const id=String(q.id||u.searchParams.get('id')||''); const S=opSession(id); if(!S){ const x=stoppedSessions.get(id), st=x&&x.room.stopped;
      if(st) send(423,{error:`игра остановлена (${st.by}); ${STOP_HINT}`, stopped:st},'игра остановлена — '+STOP_HINT);
      else send(404,{error:x?'сессия закрыта остановкой игры; остановка снята — войти заново: /op/join':'сессии нет или вышла по тишине: /op/join'},x?'сессия закрыта остановкой, войти заново':'сессии нет'); return null; }
    const now=Date.now(); if(now-S.client.last<OP_MIN_MS){ send(429,{error:'не чаще '+OP_MIN_MS+' мс'},'слишком часто'); return null; } S.client.last=now; return S; };
  const header=S=>{ const M=S.client.oc.modem; return M?`${M.up?'связь':'НЕТ СВЯЗИ'} · ${(M.cap/8).toFixed(0)} Б/с · в очереди ${M.qcmd+M.qbg} Б${M.qcmd+M.qbg?' ('+S.client.oc.loadText()+')':''}`:'модем: нет показаний'; };
  if(op==='join'&&req.method==='POST'){ withBody(q=>{ let r, st=+q.st||0;
      if(q.key){ const k=parseKey(q.key); if(!k||k.role==='pack'){ send(401,{error:'ключ не подходит (нужен ключ платформы: КОД.opN.секрет)'},'ключ не подходит'); return; } r=k.room; st=k.st; }
      else { const code=String(q.room||'').trim(); if(!/^[\w-]{1,32}$/.test(code)){ send(400,{error:'нужен ключ платформы (key) или код планеты (room)'},'нужен ключ или код планеты'); return; } r=room(code); }
      if(r.stopped){ send(423,{error:`игра остановлена (${r.stopped.by}, ${r.stopped.wall}); ${STOP_HINT}`, stopped:r.stopped},'игра остановлена — '+STOP_HINT); return; }
      // тот же агент после обрыва или перезапуска — join с id прежней сессии: та же сессия, курсор журнала цел. Без него роль, занятая кем-то (консоль или другая сессия), — 409
      const name=opName(q.name||'агент'); let id=String(q.id||''), S=id?opSession(id):null; if(S&&(S.room!==r||S.client.st!==st)) S=null;
      const resumed=!!S; if(S) S.client.last=Date.now();
      else { const h=r.holder(st); if(h){ send(409,{error:r.busyText(h), by:h.name, since:h.since},r.busyText(h)); return; }
        const c=new OpClient(); id=r.code+'.'+crypto.randomBytes(8).toString('hex'); c.sid=id; S={room:r,client:c}; opSessions.set(id,S); r.join(c); r.hello(c, 0, {name, token:''}, st); log(`${r.code}: агент-оператор ${c.op.name} на платформе ${c.st}`); r.save(); }
      const c=S.client, code=r.code, pic=c.oc.state(); send(200,{ok:true, id, resumed, room:code, st:c.st, name:c.oc.name, n:c.oc.n, replay:c.oc.replay, speed:r.st.speed, lines:pic, text:pic.join('\n')}, `сессия ${id}${resumed?' (прежняя: журнал — с курсора, perceive?since=)':''}\n`+pic.join('\n')+`\n— ${header({client:c})}, n=${c.oc.n}, досыл ${c.oc.replay} пакетов`); }); return; }
  if(op==='perceive'&&req.method==='GET'){ const S=sess({}); if(!S) return; const c=S.client, since=+u.searchParams.get('since')||0, wait=Math.max(0,Math.min(PACK_WAIT_MAX,+u.searchParams.get('wait')||0));
    const reply=()=>{ const lines=c.oc.lines.filter(l=>l.n>since); const n=lines.length?lines[lines.length-1].n:c.oc.n; const M=c.oc.modem;
      send(200,{n, at:+c.oc.tNow.toFixed(1), speed:S.room.st.speed, modem:M?{up:M.up,cap:M.cap,queue:M.qcmd+M.qbg,load:M.load||[],eta:M.queue.map(g=>({id:g.id,kind:g.kind,unit:g.unit,eta:g.eta}))}:null, lines, text:lines.map(l=>`${mmss(l.at)} ${l.text}`).join('\n')}, lines.map(l=>`${mmss(l.at)} ${l.text}`).join('\n')+(lines.length?'\n':'')+`— ${header(S)}, n=${n}`); };
    if(c.oc.lines.some(l=>l.n>since)||!wait) return reply();
    let done=false; const fire=()=>{ if(done) return; done=true; clearTimeout(tm); reply(); }; const tm=setTimeout(fire,wait*1000); c.waiters.push(fire); req.on('close',()=>{ done=true; clearTimeout(tm); }); return; }
  if(op==='act'&&req.method==='POST'){ withBody(q=>{ const S=sess(q); if(!S) return; const c=S.client; const lines=(Array.isArray(q.acts)?q.acts:String(q.acts||q.text||'').split('\n')).map(x=>x.trim()).filter(Boolean).slice(0,20); const results=[];
      for(const line of lines){ const p=c.oc.parse(line); if(p.error){ results.push({line, ok:false, why:p.error}); continue; } if(!c.oc.modem||!c.oc.modem.up){ results.push({line, ok:false, why:'нет связи со станцией'}); continue; }
        S.room.handle(c,{t:'up',bytes:p.bytes}); c.oc.say('→ '+p.label); results.push({line, ok:true, sent:p.label, bytes:p.bytes}); }
      send(200,{results}, results.map(x=>`${x.ok?'отправлено':'отказ'} — ${x.line}${x.why?' ('+x.why+')':''}${x.sent?' → '+x.sent:''}`).join('\n')); }); return; }
  if(op==='state'&&req.method==='GET'){ const S=sess({}); if(!S) return; const st=S.client.oc.state(); send(200,{n:S.client.oc.n, lines:st, text:st.join('\n')}, st.join('\n')+`\n— ${header(S)}, n=${S.client.oc.n}`); return; }
  if(op==='leave'&&req.method==='POST'){ withBody(q=>{ const id=String(q.id||''); const S=opSessions.get(id); if(S){ opSessions.delete(id); S.room.leave(S.client); } send(200,{ok:true},'вышел'); }); return; }
  if(op==='stop'&&req.method==='POST'){ withBody(q=>{ const S=opSessions.get(String(q.id||'')); if(!S){ send(404,{error:'сессии нет'},'сессии нет'); return; } const r=S.room, win=q.reason==='win';
      r.stop(`агент ${S.client.op.name} (${S.client.oc.name})`,{reason:win?'win':'pause', who:{role:'op'+S.client.st, name:S.client.op.name}, note:q.note}); send(200,{ok:true, stopped:r.stopped},stopText(r)); }); return; }
  send(404,{error:'нет такого: /op/join (POST), /op/perceive (GET), /op/act (POST), /op/state (GET), /op/leave (POST), /op/stop (POST)'},'нет такого');
}

// ---- HTTP-API агента стаи: /pack/join, /pack/perceive, /pack/act (docs/agent-api.md). Планета — по коду и токену стаи из настроек.
// Сессия RTS: если операторов нет, мир стоит — asleep:true, лента не растёт. Ответ — JSON; ?text=1 или Accept: text/plain — только текст ленты.
const mmss=at=>`${String(Math.floor(at/60)).padStart(2,'0')}:${String(Math.floor(at%60)).padStart(2,'0')}`, fmtLine=l=>`${mmss(l.at)} О${l.who}: ${l.text}`;
function packApi(req,res,u,op){
  const wantText=u.searchParams.get('text')==='1'||/^text\/plain/.test(req.headers.accept||'');
  const send=(code,obj,text)=>{ if(wantText&&text!==undefined){ res.writeHead(code,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}); res.end(text); } else { res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(obj)); } };
  const withBody=cb=>{ let body=''; req.on('data',c=>{ body+=c; if(body.length>2e4) req.destroy(); }); req.on('end',()=>{ let q={}; try{ q=JSON.parse(body||'{}'); }catch(e){ q={}; } cb(q); }); };
  const auth=(q,quiet)=>{ let r; const key=q.key||u.searchParams.get('key');
    if(key){ const k=parseKey(key); if(!k||k.role!=='pack'){ send(401,{error:'ключ не подходит (нужен ключ стаи: КОД.pack.секрет)'},'ключ не подходит'); return null; } r=k.room; }
    else { const code=String(q.room||u.searchParams.get('room')||'').trim(), token=String(q.token||u.searchParams.get('token')||'').trim();
      if(!/^[\w-]{1,32}$/.test(code)||!rooms.has(code)&&!fs.existsSync(path.join(DATA,code+'.json'))){ send(404,{error:'планеты нет: '+code},'планеты нет'); return null; }
      r=room(code); if(token!==r.cfg.pack){ send(401,{error:'токен стаи не подходит'},'токен стаи не подходит'); return null; } }
    if(r.stopped&&!quiet){ send(423,{error:`игра остановлена (${r.stopped.by}, ${r.stopped.wall}); ${STOP_HINT}`, stopped:r.stopped},'игра остановлена — '+STOP_HINT); return null; }
    const now=Date.now(); if(now-r.pack.last<PACK_MIN_MS){ send(429,{error:'не чаще '+PACK_MIN_MS+' мс'},'слишком часто'); return null; } r.pack.last=now; return r; };
  // сессия стаи: роль одна — perceive/act/stop/leave только с id сессии, выданной join. Чужая живая сессия — 409, нет сессии — 404
  const hold=(r,q)=>{ const id=String(q.id||u.searchParams.get('id')||''), h=r.packHolder();
    if(h&&h.sid===id){ h.last=Date.now(); return h; }
    if(h) send(409,{error:r.busyText(h), by:h.name, since:h.since},r.busyText(h)); else send(404,{error:'сессии стаи нет или вышла по тишине: /pack/join'},'сессии нет: /pack/join'); return null; };
  if(op==='join'&&req.method==='POST'){ withBody(q=>{ const r=auth(q); if(!r) return; const h=r.packHolder(), now=Date.now(), want=String(q.id||'');
      if(h&&h.sid!==want){ send(409,{error:r.busyText(h), by:h.name, since:h.since},r.busyText(h)); return; }
      const resumed=!!h; if(h) h.last=now;
      else { r.packHold={sid:r.code+'.'+crypto.randomBytes(8).toString('hex'), name:opName(q.name||'стая'), since:now, last:now, alive:r.st.snapshot().pack.map((p,i)=>p.act!=='dead'?i:-1).filter(i=>i>=0)}; r.save(); }   // alive — кто жив при входе: мерило победы стаи
      const s=r.packState(); r.st.log({k:'pack', join:true, name:r.packHold.name, resumed, wall:new Date().toISOString()});
      send(200,{ok:true, id:r.packHold.sid, resumed, room:r.code, ...s, text:s.lines.join('\n')}, `сессия ${r.packHold.sid}${resumed?' (прежняя)':''}\n`+s.lines.join('\n')+`\n— часы мира ${mmss(s.at)}, ${s.asleep?'стая спит: операторов нет':'мир идёт'}, n=${s.n}`); }); return; }
  if(op==='perceive'&&req.method==='GET'){ const r=auth({}); if(!r||!hold(r,{})) return; const since=+u.searchParams.get('since')||0, wait=Math.max(0,Math.min(PACK_WAIT_MAX,+u.searchParams.get('wait')||0));
    const reply=()=>{ const lines=r.packLines(since); const n=lines.length?lines[lines.length-1].n:Math.max(since,r.pack.lines.length?r.pack.lines[r.pack.lines.length-1].n:since); const at=r.st.links[0].link.t;
      send(200,{n, at:+at.toFixed(1), asleep:!r.timer, speed:r.st.speed, lines, text:lines.map(fmtLine).join('\n')}, lines.map(fmtLine).join('\n')+(lines.length?'\n':'')+`— n=${n}, ${r.timer?'мир идёт':'стая спит: операторов нет'}`); };
    if(r.packLines(since).length||!wait||!r.timer) return reply();
    let done=false; const fire=()=>{ if(done) return; done=true; clearTimeout(tm); reply(); }; const tm=setTimeout(fire,wait*1000); r.pack.waiters.push(fire); req.on('close',()=>{ done=true; clearTimeout(tm); }); return; }
  if(op==='act'&&req.method==='POST'){ withBody(q=>{ const r=auth(q); if(!r||!hold(r,q)) return; const acts=Array.isArray(q.acts)?q.acts.join('\n'):String(q.acts||q.text||''); const results=r.packAct(acts);
      for(const x of results) r.st.log({k:'pack', act:x.line, ok:x.ok, why:x.why}); send(200,{results, asleep:!r.timer}, results.map(x=>`${x.ok?'принято':'отказ'} — ${x.line}${x.why?' ('+x.why+')':''}`).join('\n')); }); return; }
  if(op==='stop'&&req.method==='POST'){ withBody(q=>{ const r=auth(q,true); if(!r) return; const h=hold(r,q); if(!h) return; const win=q.reason==='win';
      r.stop(`агент стаи ${h.name}`,{reason:win?'win':'pause', who:{role:'pack', name:h.name}, note:q.note}); send(200,{ok:true, stopped:r.stopped},stopText(r)); }); return; }
  if(op==='leave'&&req.method==='POST'){ withBody(q=>{ const r=auth(q,true); if(!r) return; const h=r.packHolder(); if(h&&h.sid===String(q.id||'')){ r.packHold=null; r.st.log({k:'pack', leave:h.name, wall:new Date().toISOString()}); r.save(); } send(200,{ok:true},'вышел'); }); return; }
  send(404,{error:'нет такого: /pack/join (POST), /pack/perceive (GET), /pack/act (POST), /pack/leave (POST), /pack/stop (POST)'},'нет такого');
}

// Спека роли: docs/agent-pack.md или docs/agent-op.md с подстановкой {{BASE}} (адрес сервера), {{KEY}}, {{ROOM}}, {{STATION}}, {{MAP}} и брифинга карты
// (docs/brief-ID.md, если есть) — агенту достаточно этой страницы, чтобы войти и играть свою роль
function roleDoc(k,req){ const r=k.room; const base=(req.headers['x-forwarded-proto']||'http')+'://'+(req.headers['x-forwarded-host']||req.headers.host||'localhost');
  const file=k.role==='pack'?'agent-pack.md':'agent-op.md'; let md=''; try{ md=fs.readFileSync(path.join(ROOT,'docs',file),'utf8'); }catch(e){ return 'спеки роли нет: docs/'+file; }
  let brief=''; try{ brief=fs.readFileSync(path.join(ROOT,'docs','brief-'+r.cfg.map+(k.role==='pack'?'-pack':'')+'.md'),'utf8'); }catch(e){}
  const vars={BASE:base, KEY:roleKey(r.code,r.cfg,k.role), ROOM:r.code, STATION:k.role==='pack'?'':'ARK-04'+(1+k.st), ST:String(k.st), MAP:MAPS[r.cfg.map].name, BRIEF:brief.trim()};
  return md.replace(/\{\{(\w+)\}\}/g,(_,v)=>vars[v]??''); }
// статика: proto/ в корне, без кэша
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon'};
const server=http.createServer((req,res)=>{
  const u=new URL(req.url,'http://x'); let f=decodeURIComponent(u.pathname); if(f==='/') f='/lobby.html';   // корень — лобби; консоль — index.html?room=КОД
  if(f==='/rooms'&&req.method==='POST'){   // создать планету с настройками (если уже есть — настройки не меняются)
    let body=''; req.on('data',c=>{ body+=c; if(body.length>1e4) req.destroy(); }); req.on('end',()=>{ let q={}; try{ q=JSON.parse(body); }catch(e){}
      const code=String(q.code||'').trim(); if(!/^[\w-]{1,32}$/.test(code)){ res.writeHead(400); res.end('bad code'); return; }
      const r=room(code,q); res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify({...r.info(), pack:r.cfg.pack})); }); return; }   // ключи ролей — в info(), как и в списке планет: они не секрет
  { const m=/^\/rooms\/([\w-]{1,32})\/(stop|resume)$/.exec(f); if(m&&req.method==='POST'){   // stop — «конец игры» для всех (лобби, любой человек); resume — снять остановку, агентов снова пускают
      let body=''; req.on('data',c=>{ body+=c; if(body.length>1e4) req.destroy(); }); req.on('end',()=>{ let q={}; try{ q=JSON.parse(body||'{}'); }catch(e){}
        const code=m[1]; if(!rooms.has(code)&&!fs.existsSync(path.join(DATA,code+'.json'))){ res.writeHead(404); res.end('нет планеты'); return; } const r=room(code);
        const by=String(q.by||'человек из лобби').slice(0,40); if(m[2]==='stop') r.stop(by); else r.resume(by);
        res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify(r.info())); }); return; } }
  { const m=/^\/agent\/([^\/]+?)(\.md)?$/.exec(f); if(m){ const k=parseKey(decodeURIComponent(m[1])); if(!k){ res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'}); res.end('ключ не подходит: нужен КОД.РОЛЬ.СЕКРЕТ из лобби'); return; }   // спека роли по ключу: страница или markdown с подставленными ключом и адресом
      if(!m[2]){ res.writeHead(200,{'Content-Type':MIME['.html'],'Cache-Control':'no-store'}); res.end(fs.readFileSync(path.join(__dirname,'agent.html'))); return; }
      res.writeHead(200,{'Content-Type':'text/markdown; charset=utf-8','Cache-Control':'no-store'}); res.end(roleDoc(k,req)); return; } }
  if(f.startsWith('/pack/')){ packApi(req,res,u,f.slice(6)); return; }
  if(f.startsWith('/op/')){ opApi(req,res,u,f.slice(4)); return; }
  if(f==='/rooms'){ res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}); res.end(JSON.stringify(listRooms())); return; }
  if(f==='/maps'){ res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}); res.end(JSON.stringify(mapsInfo())); return; }   // карты сервера: id, name, v, площадки (лобби); текст — GET /maps/ID.js
  // лог мира планеты целиком — для спектатора постфактум, с ползунком: spectate.html?log=/log/КОД.log. Правду о мире зритель и так видит живьём (?room=КОД),
  // так что лог не секрет. Файл + ещё не сброшенный буфер живой комнаты; gzip, если клиент принимает (лог — десятки МБ JSONL, сжимается в 10–20 раз)
  { const m=/^\/log\/([\w-]{1,32})\.log$/.exec(f); if(m){ const code=m[1], file=path.join(DATA,code+'.log'); const r=rooms.get(code);
      if(!fs.existsSync(file)&&!(r&&r.logBuf.length)){ res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'}); res.end('лога нет: '+code); return; }
      if(r) r.flushLog();
      const gz=/\bgzip\b/.test(req.headers['accept-encoding']||''); res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','Content-Disposition':`inline; filename="${code}.log"`,...(gz?{'Content-Encoding':'gzip'}:{})});
      const src=fs.createReadStream(file); src.on('error',()=>res.end()); (gz?src.pipe(zlib.createGzip()):src).pipe(res); return; } }
  { const m=/^\/docs\/([a-z0-9-]+\.md)$/.exec(f); if(m&&fs.existsSync(path.join(ROOT,'docs',m[1]))){ res.writeHead(200,{'Content-Type':'text/markdown; charset=utf-8','Cache-Control':'no-store'}); res.end(fs.readFileSync(path.join(ROOT,'docs',m[1]))); return; } }   // документы — как на Pages
  { const m=/^\/maps\/([a-z0-9_-]+)\.js$/.exec(f); if(m&&MAPS[m[1]]&&MAPS[m[1]].file!==P+'maps/'+m[1]+'.js'){ res.writeHead(200,{'Content-Type':MIME['.js'],'Cache-Control':'no-store'}); res.end(fs.readFileSync(MAPS[m[1]].file)); return; } }   // карта из level=ФАЙЛ — тем же путём, что и из maps/ (спектатор)
  const fp=path.normalize(path.join(P,f)); if(!fp.startsWith(P)||/editor|serve\.py/.test(f)){ res.writeHead(404); res.end(); return; }   // редактор — только локально через serve.py
  fs.readFile(fp,(e,b)=>{ if(e){ res.writeHead(404); res.end('not found'); return; } res.writeHead(200,{'Content-Type':MIME[path.extname(fp)]||'application/octet-stream','Cache-Control':'no-store'}); res.end(b); });
});
const wss=new WebSocketServer({noServer:true});
server.on('upgrade',(req,sock,head)=>{
  const u=new URL(req.url,'http://x'); const code=(u.searchParams.get('room')||'').trim();
  if(u.pathname!=='/ws'||!/^[\w-]{1,32}$/.test(code)){ sock.destroy(); return; }
  if(u.searchParams.get('spectate')){ if(!rooms.has(code)&&!fs.existsSync(path.join(DATA,code+'.json'))){ sock.destroy(); return; }   // смотреть — только существующую планету, новую зритель не создаёт
    wss.handleUpgrade(req,sock,head,ws=>{ const r=room(code); r.watch(ws); log(`${code}: зритель подключился (${r.watchers.size})`); ws.on('close',()=>{ r.unwatch(ws); log(`${code}: зритель отключился (${r.watchers.size})`); }); }); return; }   // зритель: только лог мира, мир не запускает
  wss.handleUpgrade(req,sock,head,ws=>{ const r=room(code); ws.live=false; r.join(ws); log(`${code}: оператор подключился (${r.clients.size})`);
    ws.on('message',d=>{ let m; try{ m=JSON.parse(d); }catch(e){ return; } if(m&&typeof m.t==='string') r.handle(ws,m); });
    ws.on('close',()=>{ r.leave(ws); log(`${code}: оператор отключился (${r.clients.size})`); }); });
});
// необработанное исключение вне тика (обработчик HTTP, таймер) — в консоль сервера и в лог каждой живой комнаты, процесс не ронять: комнаты
// живут в памяти, а сохранение раз в 10 с; сбои внутри такта и команд ловит сама станция (fault) и отдаёт консолям
const hostFault=(where,e)=>{ log(`СБОЙ ${where}: ${e&&e.stack||e}`); for(const r of rooms.values()) r.st.fault(where,e); };
process.on('uncaughtException',e=>hostFault('сервер',e)); process.on('unhandledRejection',e=>hostFault('сервер (promise)',e));
process.on('SIGTERM',()=>{ for(const r of rooms.values()){ r.save(); r.flushLog(); } process.exit(0); });
process.on('SIGINT',()=>{ for(const r of rooms.values()){ r.save(); r.flushLog(); } process.exit(0); });
server.listen(PORT,()=>log(`станция слушает :${PORT}, данные в ${DATA}${DEBUG?', отладка':''}, карты: ${Object.values(MAPS).map(m=>`${m.id} v${m.v} (площадок ${m.sites})`).join(', ')}, по умолчанию ${MAP_DEFAULT}`));

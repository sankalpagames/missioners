// ХОСТ СТАНЦИИ В БРАУЗЕРЕ: одиночная игра. Воркер грузит канал и станцию, текст мира — по сети, и гонит такты сам.
// Такт 100 мс реального времени / ускорение. Наружу — те же сообщения, что у серверного хоста (server/), консоль разницы не видит.
// Лог мира (tech.md §12) копится в памяти и раз в 5 с дописывается в IndexedDB кусками; переживает перезагрузку вместе с сохранением.
// Консоль: {t:'log',op:'new'} — начать новый (новый сеанс), {t:'log',op:'get'} — получить весь текст JSONL ({t:'logText'}).
// Строка запуска: ?v=ВЕРСИЯ[&lab][&map=ID] — map: карта из proto/maps/ID.js (нет — act1), консоль берёт её из своего ?map=
const Q=new URLSearchParams(self.location.search), VER=Q.get('v')||'0', MAP=/^[a-z0-9_-]{1,32}$/.test(Q.get('map')||'')?Q.get('map'):'act1';
importScripts('link.js?v='+VER,'station.js?v='+VER);
let st=null, timer=null; const inbox=[];
// ошибки самого воркера (загрузка мира, лог) — консоли той же панелью, что сбои станции
self.addEventListener('error',e=>postMessage({t:'fault', where:'воркер станции', text:e.message, stack:e.error&&e.error.stack||''}));
self.addEventListener('unhandledrejection',e=>postMessage({t:'fault', where:'воркер станции', text:e.reason&&e.reason.message||String(e.reason), stack:e.reason&&e.reason.stack||''}));
function schedule(){ if(timer) clearInterval(timer); timer=setInterval(()=>st.tick(), 100/st.speed); }

// ---- лог: память + IndexedDB (база missioners-log, хранилище chunks, ключ — по возрастанию) ----
const LOG_KEY=(Q.has('lab')?'lab':'main')+(MAP!=='act1'?':'+MAP:''); let pending=[], db=null;   // лог — свой на карту, как и сохранение
const idb=new Promise(res=>{ try{ const r=indexedDB.open('missioners-log',1); r.onupgradeneeded=()=>r.result.createObjectStore('chunks',{autoIncrement:true}); r.onsuccess=()=>res(r.result); r.onerror=()=>res(null); }catch(e){ res(null); } });
idb.then(d=>{ db=d; });
function logRec(rec){ pending.push(JSON.stringify(rec)); }
function flush(){ if(!db||!pending.length) return; const lines=pending; pending=[]; try{ db.transaction('chunks','readwrite').objectStore('chunks').add({key:LOG_KEY, at:Date.now(), lines}); }catch(e){} }
setInterval(flush,5000);
function logClear(){ pending=[]; if(!db) return; try{ const os=db.transaction('chunks','readwrite').objectStore('chunks'); os.openCursor().onsuccess=e=>{ const c=e.target.result; if(!c) return; if(c.value.key===LOG_KEY) c.delete(); c.continue(); }; }catch(e){} }
function logText(cb){ const out=[]; const done=()=>cb(out.concat(pending).join('\n')+'\n'); if(!db) return done();
  try{ db.transaction('chunks').objectStore('chunks').openCursor().onsuccess=e=>{ const c=e.target.result; if(!c) return done(); if(c.value.key===LOG_KEY) out.push(...c.value.lines); c.continue(); }; }catch(e){ done(); } }

Promise.all(['maps/'+MAP+'.js','codebook.js','terrain.js','camera.js','world.js'].map(f=>fetch(f+'?v='+VER).then(r=>{ if(!r.ok) throw new Error(f+': '+r.status); return r.text(); }))).then(srcs=>{
  if(!/^\/\/ УРОВЕНЬ/.test(srcs[0])||!/\nconst LEVEL = \{/.test(srcs[0])) throw new Error('maps/'+MAP+'.js: не файл уровня');
  st=makeStation({ worldSrc:srcs.join('\n'), search:self.location.search, out:m=>postMessage(m), debug:true, fetch:(u,o)=>fetch(u,o), log:logRec });   // отладочная шторка есть только в одиночной игре
  for(const m of inbox) handle(m); inbox.length=0; schedule(); postMessage({t:'ready'});
});
function handle(m){
  if(m.t==='log'){ if(m.op==='new'){ logClear(); st.log({k:'start', host:'worker', n:st.NST, map:st.meta, wall:new Date().toISOString()}); } if(m.op==='get') logText(text=>postMessage({t:'logText', text})); return; }
  st.handle(m); if(m.t==='speed') schedule(); }
onmessage=e=>{ if(st) handle(e.data); else inbox.push(e.data); };

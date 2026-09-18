// ХОСТ СТАНЦИИ В БРАУЗЕРЕ: одиночная игра. Воркер грузит канал и станцию, текст мира — по сети, и гонит такты сам.
// Такт 100 мс реального времени / ускорение. Наружу — те же сообщения, что у серверного хоста (server/), консоль разницы не видит.
const VER=self.location.search.slice(3).replace(/&lab\b/,'')||'0';
importScripts('link.js?v='+VER,'station.js?v='+VER);
let st=null, timer=null; const inbox=[];
function schedule(){ if(timer) clearInterval(timer); timer=setInterval(()=>st.tick(), 100/st.speed); }
Promise.all(['level.js','codebook.js','terrain.js','camera.js','world.js'].map(f=>fetch(f+'?v='+VER).then(r=>r.text()))).then(srcs=>{
  st=makeStation({ worldSrc:srcs.join('\n'), search:self.location.search, out:m=>postMessage(m), debug:true, fetch:(u,o)=>fetch(u,o) });   // отладочная шторка есть только в одиночной игре
  for(const m of inbox) handle(m); inbox.length=0; schedule(); postMessage({t:'ready'});
});
function handle(m){ st.handle(m); if(m.t==='speed') schedule(); }
onmessage=e=>{ if(st) handle(e.data); else inbox.push(e.data); };

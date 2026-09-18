// СТАНЦИЯ. Мир + каналы в одном хосте: Web Worker в одиночной игре (station-worker.js) или Node на сервере (server/).
// Мир один, платформ (станций) в нём одна или несколько — по числу операторов комнаты; у каждой платформы свой канал 512 бит/с
// (свой Link: очередь, планировщик, ARQ) и свой модем. Наружу — только сообщения с номером станции st: консоль получает
// доставленные пакеты {t:'pkt'}, потери {t:'drop'} и раз в секунду игрового времени показания своего модема {t:'modem'};
// отдаёт байты аплинка {t:'up', st}. Правда о мире (положения тел, физика линии) уходит только при debug — в отладочную шторку.
// Мир грузится текстом (level + codebook + terrain + camera + world) через new Function с шимами воркера — тем же способом,
// что headless-проверки в tools/; так один и тот же world.js работает и в браузере, и в Node.

function makeStation(opts){
  // opts: worldSrc — склеенный текст мира; search — строка ?v=…[&lab][&st=N] для world.js (st — сколько платформ поднять);
  //       out(msg) — сообщения консолям; debug — отдавать правду о мире; fetch — для атласа спрайтов в воркере (в Node атлас подаёт хост через CAM.build)
  const DT=0.1; let dbg=null, speed=1;
  const out=opts.out;
  const shims={ self:{location:{search:opts.search||'?v=0'}}, importScripts(){}, postMessage:m=>fromWorld(m),
    setInterval(){ return 1; }, clearInterval(){}, setTimeout:(f,ms)=>setTimeout(f,ms), onmessage:null,
    fetch:opts.fetch||(()=>Promise.reject(new Error('no fetch'))) };
  const W=new Function(...Object.keys(shims), opts.worldSrc+'\nreturn { tick, snapshot, restore, catchUp, CAM, NST, handle:m=>onmessage({data:m}), setSpeed:v=>{ speed=v; } };')(...Object.values(shims));

  // канал на каждую платформу
  const links=[]; for(let k=0;k<W.NST;k++){ const link=new Link(); const L={k, link, rxN:0, lastSec:-1}; links.push(L);
    link.onDeliver=p=>out({t:'pkt', st:k, n:++L.rxN, at:link.t, ...p});
    link.onDrop=p=>out({t:'drop', st:k, at:link.t, ...p});
    // команда 27 — отмена запроса: её выполняет буфер станции, до мира она не доходит; кадр отменён — миру сказать, чтобы следующий был ключевым
    link.onUplink=bytes=>{ if(bytes[0]===27){ const c=link.cancel((bytes[3]<<8)|bytes[4]); if(c&&/^IM[GD]/.test(c.kind)) W.handle({t:'imgCancel',st:k,unit:c.unit,level:+c.kind[3]}); return; } W.handle({t:'cmd',st:k,bytes}); };
    link.onFrame=(msg,ok)=>W.handle({t:'imgAck',st:k,unit:msg.unit,level:+msg.kind[3],ok}); }

  // мир → станция: пакеты в канал своей платформы, физика линии — по телам платформы, остальное — хосту
  function fromWorld(m){
    if(m.t==='msg'){ const L=links[m.st||0]; if(L) L.link.enqueue(m); }
    else if(m.t==='phys'){ for(const L of links) L.link.setPhys({extraGain:m.extraGain, units:m.units.filter(u=>(u.st||0)===L.k)}); dbg=m.dbg; }
    else if(m.t==='level'){ if(opts.debug) out(m); }
    else out(m);   // peekImg, state
  }

  // показания модема оператора: то, что терминал знает о своей линии и очереди своей станции
  function modem(k){
    const L=links[k], link=L.link, cap=link.deepCapBps(), capB=cap/8||1e-9, groups={};
    for(const p of [...link.queues.cmd, ...Object.values(link.queues.bg).flat().filter(p=>/^IM/.test(p.kind))]){ const g=groups[p.msgId]=groups[p.msgId]||{id:p.msgId,kind:p.kind,unit:p.unit,n:0,bytes:0,total:p.total,cls:p.cls}; g.n++; g.bytes+=p.size; }
    const queue=Object.values(groups).map(g=>({...g, eta:g.cls==='cmd'?link.etaFor(g.id):g.bytes/capB}));
    const m={ t:'modem', st:k, at:link.t, speed, up:link.up(), cap, orbit:link.cfg.orbit?link.orbit().tLeft:null,
      qbg:link.queueBytes('bg'), qcmd:link.queueBytes('cmd'), ncmd:link.queues.cmd.length, retry:link.retry.length,
      sec:link.stats.hist[link.stats.hist.length-1]||null, cnt:{delivered:link.stats.delivered,dropped:link.stats.dropped,retrans:link.stats.retrans}, queue };
    if(opts.debug){ const units={}; for(const id in link.phys.units) units[id]={dist:link.phys.units[id].dist, fspl:link.fsplDb(+id), obst:link.phys.units[id].obstDb, snr:link.snrDb(+id), local:link.localCapBps(+id), ber:link.ber(+id), per:link.per(+id,72)};
      m.dbg={ world:dbg, link:{units, extraGain:link.phys.extraGain}, cfg:{...link.cfg} }; }
    return m;
  }

  return {
    links, W, DT, NST:W.NST,
    get speed(){ return speed; },
    // один такт игрового времени: мир, каналы, несущие в мир; раз в секунду — модем каждой станции
    tick(){
      W.tick(); const carriers={}, snr={};
      for(const L of links){ L.link.tick(DT); for(const id in L.link.phys.units){ carriers[id]=L.link.carrier(+id); snr[id]=L.link.snrDb(+id); } }
      W.handle({t:'link',carriers,snr});
      for(const L of links){ const sec=Math.floor(L.link.t+1e-6); if(sec!==L.lastSec){ L.lastSec=sec; out(modem(L.k)); } }
    },
    modem,
    // консоль → станция; st — платформа оператора (в одиночной игре — 0)
    handle(m){
      const k=m.st||0, L=links[k]; if(!L) return;
      if(m.t==='up'){ L.link.sendUplink(m.bytes); return; }
      if(m.t==='speed'){ speed=m.v; W.setSpeed(m.v); return; }
      if(m.t==='autonomy'){ W.handle(m); return; }
      if(m.t==='save'){ W.handle(m); return; }
      if(m.t==='load'){ for(const x of links) x.link.reset(); W.handle(m); return; }
      if(!opts.debug) return;   // дальше — только отладка
      if(m.t==='cfg'){ L.link.cfg[m.k]=m.v; return; }
      if(m.t==='tp'||m.t==='peek') W.handle(m);
    },
    snapshot(){ return W.snapshot(); },
    // часы каналов — за миром; номера доставленных пакетов продолжаются (n — массив по станциям)
    restore(d,n){ for(const L of links){ L.link.reset(); L.link.t=d.t||0; if(n) L.rxN=Array.isArray(n)?(n[L.k]||0):(L.k?0:n); } W.restore(d); },
    rxN(){ return links.map(L=>L.rxN); },
  };
}

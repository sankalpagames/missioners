// СТАНЦИЯ. Мир + канал в одном хосте: Web Worker в одиночной игре (station-worker.js) или Node на сервере (server/).
// Наружу — только сообщения. Консоль получает доставленные пакеты {t:'pkt'}, потери {t:'drop'} и раз в секунду игрового
// времени показания своего модема {t:'modem'}; отдаёт байты аплинка {t:'up'}. Правда о мире (положения тел, физика линии)
// уходит только при debug — в отладочную шторку, игрок этого не видит.
// Мир грузится текстом (level + codebook + terrain + camera + world) через new Function с шимами воркера — тем же способом,
// что headless-проверки в tools/; так один и тот же world.js работает и в браузере, и в Node.

function makeStation(opts){
  // opts: worldSrc — склеенный текст мира; search — строка ?v=…[&lab] для world.js; out(msg) — сообщения консоли;
  //       debug — отдавать правду о мире; fetch — для атласа спрайтов в воркере (в Node атлас подаёт хост через CAM.build)
  const DT=0.1; const link=new Link(); let dbg=null, rxN=0, lastSec=-1, speed=1;
  const out=opts.out;
  const shims={ self:{location:{search:opts.search||'?v=0'}}, importScripts(){}, postMessage:m=>fromWorld(m),
    setInterval(){ return 1; }, clearInterval(){}, setTimeout:(f,ms)=>setTimeout(f,ms), onmessage:null,
    fetch:opts.fetch||(()=>Promise.reject(new Error('no fetch'))) };
  const W=new Function(...Object.keys(shims), opts.worldSrc+'\nreturn { tick, snapshot, restore, catchUp, CAM, handle:m=>onmessage({data:m}), setSpeed:v=>{ speed=v; } };')(...Object.values(shims));

  // мир → станция: пакеты в канал, физика линии в канал, остальное — хосту
  function fromWorld(m){
    if(m.t==='msg') link.enqueue(m);
    else if(m.t==='phys'){ link.setPhys(m); dbg=m.dbg; }
    else if(m.t==='level'){ if(opts.debug) out(m); }
    else out(m);   // peekImg, state
  }
  link.onDeliver=p=>out({t:'pkt', n:++rxN, at:link.t, ...p});
  link.onDrop=p=>out({t:'drop', at:link.t, ...p});
  link.onUplink=bytes=>W.handle({t:'cmd',bytes});
  link.onFrame=(msg,ok)=>W.handle({t:'imgAck',unit:msg.unit,level:+msg.kind[3],ok});

  // показания модема оператора: то, что терминал знает о своей линии и очереди станции
  function modem(){
    const cap=link.deepCapBps(), capB=cap/8||1e-9, groups={};
    for(const p of [...link.queues.cmd, ...Object.values(link.queues.bg).flat().filter(p=>/^IM/.test(p.kind))]){ const g=groups[p.msgId]=groups[p.msgId]||{id:p.msgId,kind:p.kind,unit:p.unit,n:0,bytes:0,total:p.total,cls:p.cls}; g.n++; g.bytes+=p.size; }
    const queue=Object.values(groups).map(g=>({...g, eta:g.cls==='cmd'?link.etaFor(g.id):g.bytes/capB}));
    const m={ t:'modem', at:link.t, speed, up:link.up(), cap, orbit:link.cfg.orbit?link.orbit().tLeft:null,
      qbg:link.queueBytes('bg'), qcmd:link.queueBytes('cmd'), ncmd:link.queues.cmd.length, retry:link.retry.length,
      sec:link.stats.hist[link.stats.hist.length-1]||null, cnt:{delivered:link.stats.delivered,dropped:link.stats.dropped,retrans:link.stats.retrans}, queue };
    if(opts.debug){ const units={}; for(const id in link.phys.units) units[id]={dist:link.phys.units[id].dist, fspl:link.fsplDb(+id), obst:link.phys.units[id].obstDb, snr:link.snrDb(+id), local:link.localCapBps(+id), ber:link.ber(+id), per:link.per(+id,72)};
      m.dbg={ world:dbg, link:{units, extraGain:link.phys.extraGain}, cfg:{...link.cfg} }; }
    return m;
  }

  return {
    link, W, DT,
    get speed(){ return speed; },
    // один такт игрового времени: мир, канал, несущие в мир; раз в секунду — модем
    tick(){
      W.tick(); link.tick(DT);
      const carriers={}, snr={}; for(const id in link.phys.units){ carriers[id]=link.carrier(+id); snr[id]=link.snrDb(+id); }
      W.handle({t:'link',carriers,snr});
      const sec=Math.floor(link.t+1e-6); if(sec!==lastSec){ lastSec=sec; out(modem()); }
    },
    modem,
    // консоль → станция
    handle(m){
      if(m.t==='up'){ link.sendUplink(m.bytes); return; }
      if(m.t==='speed'){ speed=m.v; W.setSpeed(m.v); return; }
      if(m.t==='autonomy'){ W.handle(m); return; }
      if(m.t==='save'){ W.handle(m); return; }
      if(m.t==='load'){ link.reset(); W.handle(m); return; }
      if(!opts.debug) return;   // дальше — только отладка
      if(m.t==='cfg'){ link.cfg[m.k]=m.v; return; }
      if(m.t==='tp'||m.t==='peek') W.handle(m);
    },
    snapshot(){ return W.snapshot(); },
    restore(d,n){ link.reset(); W.restore(d); link.t=d.t||0; if(n) rxN=n; },   // часы канала — за миром; номера пакетов продолжаются
    rxN(){ return rxN; },
  };
}

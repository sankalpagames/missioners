// Обвязка headless-прогонов за оператора (act1-check, channel-check): станция (мир + канал) в node, за платформу — виртуальная
// консоль server/opconsole.js, та же, что у агента (/op). Команды — текстом; всё, что видно консоли, прошло по каналу.
// Правда о мире (st.snapshot()) — только для проверок сценария, не для решений в нём.
// Math.random сидируется (mulberry32) до загрузки мира — прогон детерминирован; seed=N в argv — другой.
const fs=require('fs'), path=require('path'); const P=path.join(__dirname,'..','proto')+'/';
const read=f=>fs.readFileSync(P+f,'utf8');
const mmss=t=>`${String(Math.floor(t/60)).padStart(2,'0')}:${String(Math.floor(t%60)).padStart(2,'0')}`;

function harness({quiet=process.argv.includes('тихо'), showTlm=false}={}){
  const seedArg=process.argv.find(a=>/^seed=/.test(a)); const seed0=seedArg?+seedArg.slice(5):1; let seed=seed0;
  Math.random=()=>{ seed=(seed+0x6D2B79F5)|0; let t=Math.imul(seed^seed>>>15,1|seed); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; };
  const makeStation=new Function(read('link.js')+'\n'+read('station.js')+'\nreturn makeStation;')();
  const {OpConsole}=require('../server/opconsole.js');
  const worldSrc=[require('./map.js').mapSrc(), ...['codebook.js','terrain.js','camera.js','world.js'].map(read)].join('\n');
  const H={ notes:[], fails:[], faults:[], bytes:{}, pkts:[], seed:seed0, mmss };
  const st=makeStation({ worldSrc, search:'?v=0&st=1', debug:false,
    out:m=>{ if(m.t==='fault') H.faults.push(m.where+': '+m.text); if(m.st===undefined) return;
      if(m.t==='pkt'){ const k=m.kind.replace(/^IM[GD]\d/,'IMG'); H.bytes[k]=(H.bytes[k]||0)+m.bytes.length; H.pkts.push({at:m.at,kind:k,unit:m.unit,size:m.bytes.length}); }
      oc.onMsg(JSON.parse(JSON.stringify(m,(k,v)=>v instanceof Uint8Array?Array.from(v):v))); },
    log:r=>{ if(r.k==='note') H.notes.push(r); } });
  const oc=new OpConsole(); oc.onLine=l=>{ if(!quiet&&(showTlm||!/телеметрия:/.test(l.text))) console.log(`${mmss(l.at)}  ${l.text}`); }; oc.onMsg({t:'welcome',st:0,name:'ARK-041'});
  const T=()=>st.links[0].link.t;
  let seen=0;   // индекс журнала после последней команды: ждём строки, пришедшие после неё
  // «М: …» — первое тело платформы
  function act(line){ line=line.replace(/^М:/,'М'+[...oc.units.keys()].sort((a,b)=>a-b)[0]+':'); const p=oc.parse(line); if(p.error) throw new Error(`«${line}» — ${p.error}`);
    st.handle({t:'up',st:0,bytes:p.bytes}); oc.say('→ '+p.label); seen=oc.lines.length; }
  // крутить мир, пока в журнале не появится строка по re (после последней команды) или не выйдет срок, с игрового
  function until(re,limit){ const t0=T(); for(;;){ const L=oc.lines; for(let i=seen;i<L.length;i++) if(re.test(L[i].text)) return L[i].text;
      if(T()-t0>limit) return null; for(let i=0;i<10;i++) st.tick(); } }
  const fail=s=>H.fails.push(s);
  const run=(line,re,limit,what)=>{ act(line); const got=until(re,limit); if(!got) fail(`${what} — не дождались /${re.source}/ за ${limit} с`); return got; };
  const skip=sec=>{ for(let i=0;i<sec*10;i++) st.tick(); };
  // дойти и доложить: прибыл — true; смерть, отказ или застревание — провал шага
  function go(target,what,limit=900,unit='М'){ const got=run(unit+': идти '+target,/прибыл|жизненные функции прекращены|отказ|перекрыт/,limit,what);
    if(got&&!/прибыл/.test(got)) fail(`${what}: ${got}`); return !!got&&/прибыл/.test(got); }
  // сводка и код возврата; extra — строка сценария в сводку
  function report(ok,extra=''){ const M=st.modem(0);
    console.log(`\n— сводка (seed ${seed0}): часы мира ${mmss(T())}${extra?'; '+extra:''}`);
    console.log(`   канал: доставлено ${M.cnt.delivered}, потеряно ${M.cnt.dropped}, повторов ${M.cnt.retrans}; байты по видам: `+Object.entries(H.bytes).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k} ${v}`).join(', '));
    if(H.faults.length) fail('сбои мира: '+[...new Set(H.faults)].join('; '));
    if(H.fails.length){ console.log('НЕ СОШЛОСЬ:\n  '+H.fails.join('\n  ')+'\n  последние заметки мира:\n    '+H.notes.slice(-6).map(n=>JSON.stringify(n)).join('\n    ')); process.exit(1); }
    console.log('сошлось: '+ok); }
  return Object.assign(H,{st,oc,T,act,until,run,skip,go,fail,report});
}
module.exports={harness};

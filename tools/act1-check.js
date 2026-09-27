#!/usr/bin/env node
// Headless-прогон первого акта как регрессия (roadmap п. 2): станция (мир + канал) в node, за оператора — виртуальная консоль
// server/opconsole.js, та же, что у агента (/op). Команды — текстом; всё, что видно, прошло по каналу. Сценарий — сюжет design.md §11а:
//   1. след: надпись у ящиков → столбик у насыпей → насыпь;
//   2. связь: резак из свёртка у мачты → срастить кабель → включить ретранслятор (узел ближе к расщелине);
//   3. без узла у мачты цель в глубине не принимается (ПС-2) — проверяется до включения;
//   4. глубина: передатчик +10 дБм, скрытность, к планшету → прочитать запись (ПС-7 закрыта) → взять планшет → к шлюзу → сдать на склад.
// Math.random сидируется — прогон детерминирован (seed=N — другой). Печатает журнал консоли с часами мира; в конце — сводка
// (байты по видам, потери, смерти) и код возврата 1, если сценарий не сошёлся.
//   node tools/act1-check.js [map=act1] [seed=N] [тихо]   — «тихо»: только сводка
const fs=require('fs'), path=require('path'); const ROOT=path.join(__dirname,'..'), P=path.join(ROOT,'proto')+'/';
const read=f=>fs.readFileSync(P+f,'utf8');
const seedArg=process.argv.find(a=>/^seed=/.test(a)); let seed=seedArg?+seedArg.slice(5):1;
Math.random=()=>{ seed=(seed+0x6D2B79F5)|0; let t=Math.imul(seed^seed>>>15,1|seed); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; };   // mulberry32
const makeStation=new Function(read('link.js')+'\n'+read('station.js')+'\nreturn makeStation;')();
const {OpConsole}=require('../server/opconsole.js');
const worldSrc=[require('./map.js').mapSrc(), ...['codebook.js','terrain.js','camera.js','world.js'].map(read)].join('\n');
const quiet=process.argv.includes('тихо');
const mmss=t=>`${String(Math.floor(t/60)).padStart(2,'0')}:${String(Math.floor(t%60)).padStart(2,'0')}`;
const notes=[], fails=[], bytes={}, faults=[];
const st=makeStation({ worldSrc, search:'?v=0&st=1', debug:false,
  out:m=>{ if(m.t==='fault') faults.push(m.where+': '+m.text); if(m.st===undefined) return; if(m.t==='pkt'){ const k=m.kind.replace(/^IM[GD]\d/,'IMG'); bytes[k]=(bytes[k]||0)+m.bytes.length; }
    oc.onMsg(JSON.parse(JSON.stringify(m,(k,v)=>v instanceof Uint8Array?Array.from(v):v))); },
  log:r=>{ if(r.k==='note') notes.push(r); } });
const oc=new OpConsole(); oc.onLine=l=>{ if(!quiet&&!/телеметрия:/.test(l.text)) console.log(`${mmss(l.at)}  ${l.text}`); }; oc.onMsg({t:'welcome',st:0,name:'ARK-041'});
const T=()=>st.links[0].link.t;
let seen=0;   // индекс журнала после последней команды: ждём строки, пришедшие после неё
function act(line){ line=line.replace(/^М:/,'М'+[...oc.units.keys()].sort((a,b)=>a-b)[0]+':'); const p=oc.parse(line); if(p.error) throw new Error(`«${line}» — ${p.error}`);
  st.handle({t:'up',st:0,bytes:p.bytes}); oc.say('→ '+p.label); seen=oc.lines.length; }
// крутить мир, пока в журнале не появится строка по re (после последней команды) или не выйдет срок, с игрового
function until(re,limit){ const t0=T(); for(;;){ const L=oc.lines; for(let i=seen;i<L.length;i++) if(re.test(L[i].text)) return L[i].text;
    if(T()-t0>limit) return null; for(let i=0;i<10;i++) st.tick(); } }
const run=(line,re,limit,what)=>{ act(line); const got=until(re,limit); if(!got) fails.push(`${what} — не дождались /${re.source}/ за ${limit} с`); return got; };
const skip=sec=>{ for(let i=0;i<sec*10;i++) st.tick(); };
const DEAD=/жизненные функции прекращены/;
// дойти и доложить: прибыл — строка; смерть, отказ или застревание — провал шага и конец сценария
function go(target,what,limit=900){ const got=run('М: идти '+target,/прибыл|жизненные функции прекращены|отказ|перекрыт|застрял/,limit,what);
  if(got&&!/прибыл/.test(got)) fails.push(`${what}: ${got}`); return !!got&&/прибыл/.test(got); }

function scenario(){
  run('станция: статус',/платформа:/,20,'паспорт станции');
  skip(5);
  // ---- 1. след
  if(!go('40 16','к штабелю ящиков')) return;
  run('М: описание',/надпись/,60,'надпись в описании');
  run('М: изучить надпись',/осмотр надпись/,60,'надпись осмотрена');
  run('М: взаимодействовать надпись',/М-07/,60,'надпись разобрана');
  if(!go('96 135','к насыпям')) return;
  run('М: описание',/столбик/,60,'столбик в описании');
  run('М: взаимодействовать столбик',/Седьмого нет/,60,'провод на столбике осмотрен');
  run('М: взаимодействовать насыпь',/Лицо знакомое/,60,'насыпь раскопана');
  // ---- 2. связь
  if(!go('119 -76','к мачте')) return;
  run('М: идти 337 214',/отказ|ПС-2/,20,'глубина без узла у мачты — отказ ПС-2');
  act('М: стоп'); skip(2);
  run('М: описание',/свёрток/,60,'свёрток в описании');
  run('М: взять резак из свёртка',/взял: резак/,60,'резак из свёртка');
  run('М: срастить кабель',/срастил/,60,'кабель срощен');
  run('М: взаимодействовать ретранслятор',/включил/,60,'ретранслятор включён');
  if(!until(/ретранслятор 7: включён — узел связи|в сети: 7/,30)) fails.push('пульс не показал ретранслятор у мачты узлом');
  // ---- 3. глубина
  run('М: передатчик 10',/передатчик|команда принята/,20,'передатчик +10 дБм');
  run('М: скрытность вкл',/скрытност|команда принята/,20,'скрытность');
  if(!go('258 149','к входу в расщелину')) return;
  run('М: стойка бой',/стойка/,20,'стойка бой');
  // по коленам оси (карта act1: terrain.canyon.pts) — поиска пути нет, человек ведёт так же, по лидару
  for(const [xy,what] of [['284 158','колено 2'],['300 184','колено 3'],['321 191','колено 4'],['326 211','колено 5']]) if(!go(xy,'по расщелине: '+what,300)) return;
  if(!go('336.2 215.5','к планшету',300)) return;   // на оси дна: у стены (336, 214) тело уже вне расщелины и глубокого не видит
  run('М: описание',/планшет/,60,'планшет в описании');
  run('М: прочитать запись планшет',/ПС-7 закрыта/,60,'запись прочитана, ПС-7 закрыта');
  run('М: взять планшет',/взял: планшет/,60,'взять планшет');
  // ---- 4. домой
  if(!go('к шлюзу','обратно к шлюзу с планшетом',1500)) return;
  run('М: сдать планшет',/сдал на склад/,60,'планшет на складе');
}
try{ scenario(); }catch(e){ fails.push('сценарий: '+e.message); }

const d=st.snapshot();
console.log(`\n— сводка (seed ${seedArg?seedArg.slice(5):1}): часы мира ${mmss(T())}; `+d.units.map(u=>`М${u.id} (${u.x.toFixed(0)},${u.y.toFixed(0)})${u.alive?'':' мёртв'}${u.items.includes(44)?' с планшетом':''}`).join(', ')+
  `; планшет на складе: ${d.stations[0].store[44]||0}; заметок мира ${notes.length} (ПС-2: ${notes.filter(n=>n.refuse==='ПС-2').length}, ретрансляторы: ${notes.filter(n=>n.kind==='relay').length}, стая: ${notes.filter(n=>n.kind==='pack').length})`);
const M=st.modem(0); console.log(`   канал: доставлено ${M.cnt.delivered}, потеряно ${M.cnt.dropped}, повторов ${M.cnt.retrans}; байты по видам: `+Object.entries(bytes).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k} ${v}`).join(', '));
if(faults.length) fails.push('сбои мира: '+[...new Set(faults)].join('; '));
if(fails.length){ console.log('НЕ СОШЛОСЬ:\n  '+fails.join('\n  ')+'\n  последние заметки мира:\n    '+notes.slice(-6).map(n=>JSON.stringify(n)).join('\n    ')); process.exit(1); } else console.log('сошлось: след → связь → глубина → планшет на складе');

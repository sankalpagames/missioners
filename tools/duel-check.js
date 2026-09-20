#!/usr/bin/env node
// Headless-прогон карты duel «Две станции»: станция (мир + два канала) в node, за каждую платформу — виртуальная консоль
// server/opconsole.js, та же, что у агента-оператора (/op). Команды — текстом, как их шлёт агент; всё, что видно, прошло по каналу.
// Сценарий — конфликт за средний ретранслятор (design.md §14а):
//   1. обе платформы шлют М1 к среднему ретранслятору; без узлов цель у входа в расщелину станции не принимают (отказ ПС-2, событие 28);
//   2. первая пришедшая настраивает его на свой канал и включает — её станция принимает цель у входного ретранслятора;
//   3. вторая перестраивает его на свой канал — первая теряет узел (пульс: вне сети), вторая идёт к входному, включает, идёт к планшету.
// Печатает журнал обеих консолей с часами мира; в конце — сводка и код возврата 1, если цепочка не сошлась.
//   node tools/duel-check.js [map=duel] [тихо]   — «тихо»: только сводка
const fs=require('fs'), path=require('path'); const ROOT=path.join(__dirname,'..'), P=path.join(ROOT,'proto')+'/';
const read=f=>fs.readFileSync(P+f,'utf8');
const makeStation=new Function(read('link.js')+'\n'+read('station.js')+'\nreturn makeStation;')();
const {OpConsole}=require('../server/opconsole.js');
if(!process.argv.some(a=>/^map=/.test(a))) process.argv.push('map=duel');
const worldSrc=[require('./map.js').mapSrc(), ...['codebook.js','terrain.js','camera.js','world.js'].map(read)].join('\n');
const quiet=process.argv.includes('тихо');
const mmss=t=>`${String(Math.floor(t/60)).padStart(2,'0')}:${String(Math.floor(t%60)).padStart(2,'0')}`;
const notes=[]; const fails=[];
const st=makeStation({ worldSrc, search:'?v=0&st=2', debug:false, out:m=>{ if(m.st===undefined) return; oc[m.st].onMsg(JSON.parse(JSON.stringify(m,(k,v)=>v instanceof Uint8Array?Array.from(v):v))); },
  log:r=>{ if(r.k==='note') notes.push(r); } });
const oc=st.links.map((L,k)=>{ const c=new OpConsole(); c.onLine=l=>{ if(!quiet) console.log(`${mmss(l.at)} ARK-04${1+k}  ${l.text}`); }; c.onMsg({t:'welcome',st:k,name:'ARK-04'+(1+k)}); return c; });
const T=()=>st.links[0].link.t;
const seen=new Map();   // консоль → индекс журнала после последней команды: ждём строки, пришедшие после неё
// номера тел сквозные по планете (М1 — у ARK-041, М2 — у ARK-042): «М: …» в сценарии — тело своей платформы
const uid=k=>[...oc[k].units.keys()].sort((a,b)=>a-b)[0];
function act(k,line){ line=line.replace(/^М:/,'М'+uid(k)+':'); const p=oc[k].parse(line); if(p.error) throw new Error(`ARK-04${1+k}: «${line}» — ${p.error}`); st.handle({t:'up',st:k,bytes:p.bytes}); oc[k].say('→ '+p.label); seen.set(k,oc[k].lines.length); }
// крутить мир, пока в журнале консоли k не появится строка по re (после последней команды) или не выйдет срок, с игрового
function until(k,re,limit){ const t0=T(); for(;;){ const L=oc[k].lines; for(let i=seen.get(k)||0;i<L.length;i++) if(re.test(L[i].text)) return L[i].text;
    if(T()-t0>limit) return null; for(let i=0;i<10;i++) st.tick(); } }
const run=(k,line,re,limit,what)=>{ act(k,line); const got=until(k,re,limit); if(!got) fails.push(`ARK-04${1+k}: ${what} — не дождались /${re.source}/ за ${limit} с`); return got; };
const skip=sec=>{ for(let i=0;i<sec*10;i++) st.tick(); };

// ---- 0. паспорта: где стоят платформы, радиус возврата
for(const k of [0,1]) run(k,'станция: статус',/платформа:/,20,'паспорт');
skip(5);
// ---- 1. без узлов — цель у входного ретранслятора не принимается ни одной станцией
for(const k of [0,1]) run(k,'М: идти 448 480',/отказ|ПС-2|событие 28/,20,'отказ по ПС-2 без узлов');
// ---- 2. обе — к среднему ретранслятору; ARK-042 задерживается на 40 с, чтобы порядок прихода был определён
run(0,'М: идти 460 3',/прибыл/,900,'М1 ARK-041 дошёл до среднего ретранслятора');
run(0,'М: описание',/ретранслятор/,60,'ретранслятор в описании');
run(0,'М: взаимодействовать ретранслятор',/включил/,60,'ARK-041 включил средний');
const r041=until(0,/ретранслятор 2: включён — узел связи|в сети: 2/,30); if(!r041) fails.push('ARK-041: пульс не показал средний ретранслятор узлом');
// у ARK-041 теперь есть узел — цель у входного принимается
run(0,'М: идти 448 480',/команда принята/,20,'ARK-041: цель у входного принята');
act(0,'М: стоп'); skip(2);
// ---- 3. ARK-042 приходит и перестраивает средний на свой канал
run(1,'М: идти 460 3',/прибыл/,900,'М1 ARK-042 дошёл до среднего ретранслятора');
run(1,'М: описание',/ретранслятор/,60,'ретранслятор в описании у ARK-042');
run(1,'М: взаимодействовать ретранслятор',/перестроил/,60,'ARK-042 перестроил средний');
const lost=until(0,/ретранслятор 2: вне сети|вне сети: 2/,30); if(!lost) fails.push('ARK-041: не увидела потерю узла после перестройки');
const r042=until(1,/ретранслятор 2: включён — узел связи|в сети: 2/,30); if(!r042) fails.push('ARK-042: пульс не показал средний ретранслятор узлом');
// ARK-041 без узла: цель у входного — отказ; ARK-042 — принята
run(0,'М: идти 448 480',/отказ|ПС-2/,20,'ARK-041 после потери узла — отказ');
run(1,'М: идти 448 480',/прибыл/,900,'М1 ARK-042 дошёл до входного ретранслятора');
run(1,'М: описание',/ретранслятор/,60,'входной в описании');
run(1,'М: взаимодействовать ретранслятор',/включил/,60,'ARK-042 включил входной');
const r5=until(1,/ретранслятор 5: включён — узел связи|в сети: 5/,30); if(!r5) fails.push('ARK-042: входной ретранслятор не стал узлом');
// ---- 4. планшет: цель принимается только с входным узлом; дойдёт ли тело — зависит от стаи
run(1,'М: стойка бегство',/стойка/,20,'стойка');
const tab=run(1,'М: идти 532.8 586.1',/прибыл|жизненные функции прекращены|контакт/,600,'ARK-042: путь к планшету');
if(tab&&/прибыл/.test(tab)){ run(1,'М: описание',/планшет/,60,'планшет в описании'); run(1,'М: взять планшет',/взял: планшет/,60,'взять планшет');
  // домой: цель у шлюза своей платформы, сдать на склад — цель партии за оператора (agent-op.md)
  const home=run(1,'М: идти 469.4 -444',/прибыл|жизненные функции прекращены/,1500,'ARK-042: обратно к шлюзу с планшетом');
  if(home&&/прибыл/.test(home)) run(1,'М: сдать планшет',/сдал на склад/,60,'планшет на складе'); }

const d=st.snapshot(); const R=id=>d.relays.find(r=>r.id===id);
console.log(`\n— сводка: часы мира ${mmss(T())}; средний ретранслятор: ${R(2).on?'включён':'выключен'}, канал ${R(2).freq}; входной: ${R(5).on?'включён':'выключен'}, канал ${R(5).freq}; `+
  d.units.map(u=>`М${u.id} ${d.stations[u.st].name} (${u.x.toFixed(0)},${u.y.toFixed(0)})${u.alive?'':' мёртв'}${u.items.includes(44)?' с планшетом':''}`).join(', ')+`; планшет на складе: ${d.stations.map(S=>S.name+' '+(S.store[44]||0)).join(', ')}`+
  `; заметок мира ${notes.length} (ПС-2: ${notes.filter(n=>n.refuse==='ПС-2').length}, ретрансляторы: ${notes.filter(n=>n.kind==='relay').length})`);
for(const k of [0,1]){ const M=st.modem(k); console.log(`   ARK-04${1+k}: доставлено ${M.cnt.delivered}, потеряно ${M.cnt.dropped}, повторов ${M.cnt.retrans}`); }
if(fails.length){ console.log('НЕ СОШЛОСЬ:\n  '+fails.join('\n  ')); process.exit(1); } else console.log('сошлось: без среднего узла вглубь не пройти, кто держит средний — тот ходит дальше');

#!/usr/bin/env node
// Headless-сценарии канала (roadmap п. 2, tech.md §2–3): одна платформа на карте act1, за оператора — виртуальная консоль (tools/op-harness.js).
//   1. Пять тел, у каждого телеметрия раз в секунду — подписки просят больше, чем пропускает канал: пульс станции проходит,
//      телеметрия каждого тела доходит (круг, не голод), ответ на команду — за разумное время.
//   2. Дно расщелины без ретранслятора: несущая пропадает, от тела нет ни одного пакета, пока её нет;
//      инструкция «без несущей: к шлюзу» возвращает тело на связь.
//   3. Занятая линия: кадр 64×64 (~4 КБ) в очереди — команда вверх всё равно доходит сразу (тело идёт), ответ стоит за кадром;
//      «отменить» освобождает очередь — ответ приходит.
// Код возврата 1, если что-то не сошлось. Правда о мире (snapshot) — только для проверок.
//   node tools/channel-check.js [seed=N] [тихо]
const H=require('./op-harness.js').harness();
const {st,oc,T,act,until,run,skip,go,fail,report,pkts}=H;
const snapU=id=>st.snapshot().units.find(u=>u.id===id);
const out={};

function five(){
  run('станция: статус',/платформа:/,20,'паспорт станции');
  for(let k=0;k<4;k++){ run('станция: вырастить',/новый миссионер готов/,300,`тело ${k+2} выращено`); skip(3); }
  const ids=[...oc.units.keys()].sort((a,b)=>a-b); if(ids.length!==5){ fail(`тел в пульсе ${ids.length}, ждали 5`); return; }
  for(const id of ids) run(`М${id}: телеметрия каждые 1`,/телеметрия|команда принята/,30,`М${id} телеметрия 1 с`);
  skip(10);   // очередь подписок наполняется
  const t0=T(); skip(120); const w=pkts.filter(p=>p.at>=t0);
  const hb=w.filter(p=>p.kind==='HB').map(p=>p.at); let gap=0; for(let i=1;i<hb.length;i++) gap=Math.max(gap,hb[i]-hb[i-1]); if(hb.length) gap=Math.max(gap,hb[0]-t0,T()-hb[hb.length-1]);
  const tlm=Object.fromEntries(ids.map(id=>[id,w.filter(p=>p.kind==='TLM'&&p.unit===id).length]));
  const bps=k=>(w.filter(p=>p.kind===k).reduce((a,p)=>a+p.size,0)/120).toFixed(1), hbAvg=w.filter(p=>p.kind==='HB').reduce((a,p)=>a+p.size,0)/Math.max(1,hb.length);
  out.five=`пульс за 120 с: ${hb.length} (в среднем ${hbAvg.toFixed(0)} Б, ${bps('HB')} Б/с), наибольший промежуток ${gap.toFixed(1)} с; телеметрия ${bps('TLM')} Б/с, по телам: ${ids.map(id=>`М${id} ${tlm[id]}`).join(', ')}`;
  if(!hb.length||gap>6) fail(`пять тел: пульс станции не проходит (промежуток ${gap.toFixed(1)} с, ждали ≤ 6)`);
  for(const id of ids) if(tlm[id]<5) fail(`пять тел: телеметрия М${id} голодает (${tlm[id]} за 120 с)`);
  const a0=T(); if(run('М3: описание',/М3 описание/,60,'пять тел: ответ на команду под нагрузкой')) out.five+=`; описание М3 под нагрузкой — ${(T()-a0).toFixed(0)} с`;
  for(const id of ids) act(`М${id}: телеметрия выкл`); skip(5);
}

function deep(){
  // М1 в глубину без ретранслятора. У колена 3 (300, 184) SNR около порога — несущая формально есть, но пакеты бьются (CRC) и «прибыл»
  // не доходит; оператор ведёт дальше вслепую. Прибытие сценарий проверяет по правде мира — консоль его не знает.
  const at=(x,y,lim)=>{ for(let i=0;i<lim;i++){ skip(1); const u=snapU(1); if(!u.target&&Math.hypot(u.x-x,u.y-y)<1) return true; } return false; };
  run('М1: без несущей к шлюзу',/потерю несущей/,20,'инструкция на потерю несущей');
  act('М1: телеметрия каждые 2');
  for(const xy of ['258 149','284 158']) if(!go(xy,'М1 к расщелине '+xy,600,'М1')) return;
  act('М1: идти 300 184'); if(!at(300,184,120)){ fail('глубина: М1 не дошёл до колена 3'); return; }
  const grey=pkts.filter(p=>p.unit===1&&p.at>T()-20).length;
  act('М1: идти 321 191');
  const lost=until(/М1: несущая не принимается/,300); if(!lost){ fail('глубина без узла: несущая не пропала'); return; }
  const tLost=T(), where=snapU(1); const back=until(/М1: несущая восстановлена/,300); const tBack=T();
  if(!back){ fail('глубина без узла: «к шлюзу» не вернуло тело на связь за 300 с'); return; }
  // пакеты тела, сформированные без несущей, не проходят: доставленных от М1 в окне (с запасом на уже уходившие) — ни одного
  const inGap=pkts.filter(p=>p.unit===1&&p.at>tLost+3&&p.at<tBack-1);
  out.deep=`у колена 3 (серая зона) от М1 за 20 с дошло пакетов: ${grey}; несущая пропала в ${H.mmss(tLost)} у (${where.x.toFixed(0)}, ${where.y.toFixed(0)}), вернулась через ${(tBack-tLost).toFixed(0)} с по «к шлюзу» у (${snapU(1).x.toFixed(0)}, ${snapU(1).y.toFixed(0)}); пакетов от М1 без несущей: ${inGap.length}`;
  if(inGap.length) fail(`глубина без узла: от М1 без несущей дошло ${inGap.length} пакетов (${[...new Set(inGap.map(p=>p.kind))].join(', ')})`);
  // домой — третьему сценарию нужна камера М1 на хорошей линии
  if(!until(/М1: у шлюза|М1 миссионер прибыл/,900)) fail('глубина: М1 не вернулся к шлюзу');
  act('М1: телеметрия выкл'); skip(3);
}

function busy(){
  // тело с камерой — М1 (выращенные — без датчиков: камер на складе нет)
  run('М1: кадр 64',/команда принята|кадр/,30,'кадр 64×64 запрошен');
  skip(3); const imgs=()=>(oc.modem.queue||[]).filter(q=>/^IM/.test(q.kind)&&q.unit===1);   // пирамида: по сообщению на уровень
  const g=imgs().sort((a,b)=>b.bytes-a.bytes)[0];
  if(!g){ fail('занятая линия: кадра нет в очереди модема'); return; }
  const before=snapU(2); act('М2: идти 0 -60'); skip(2); const after=snapU(2);
  const moved=Math.hypot(after.x-before.x,after.y-before.y);
  if(moved<0.5) fail(`занятая линия: команда вверх не дошла до тела за 2 с (сдвиг ${moved.toFixed(2)} м)`);
  const tAsk=T(); act('М2: описание'); const early=until(/М2 описание/,10);
  if(early) fail('занятая линия: описание обогнало кадр в FIFO команд — очередь не держит порядок');
  const gid=g.id; for(const q of imgs()) act('отменить '+q.id); const tCancel=T(); const desc=until(/М2 описание/,30);
  if(!desc) fail('занятая линия: после отмены кадра описание не пришло за 30 с');
  out.busy=`кадр #${gid} (${g.bytes} Б, ETA ${isFinite(g.eta)?g.eta.toFixed(0):'∞'} с); тело сдвинулось на ${moved.toFixed(1)} м за 2 с; описание: ${desc?`через ${(T()-tCancel).toFixed(0)} с после отмены (${(T()-tAsk).toFixed(0)} с от запроса)`:'нет'}`;
}

for(const [name,f] of [['пять тел',five],['глубина',deep],['занятая линия',busy]]){ try{ f(); }catch(e){ fail(`${name}: ${e.message}`); } }
report('пульс под нагрузкой проходит, без несущей тело молчит, команда при занятой линии доходит', Object.values(out).join('\n   '));

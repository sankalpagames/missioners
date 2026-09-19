#!/usr/bin/env node
// Лог мира (tech.md §12) → текст для разбора глазами или агентом. Читает JSONL из файла (сервер: data/КОД.log; одиночная игра:
// кнопка «лог мира» в шторке) и печатает ленту: заметки мира (стая, крики, отказы станции, смерть, несущая), команды операторов,
// вход/выход, потери; в конце — сводка по пакетам и криками.
//   node tools/log-read.js data/test.log            — лента
//   node tools/log-read.js data/test.log stats      — только сводка
//   node tools/log-read.js data/test.log 300 900    — лента за отрезок игрового времени, с
const fs=require('fs'); const [file,...args]=process.argv.slice(2); if(!file){ console.error('нужен путь к .log / .jsonl'); process.exit(1); }
const recs=fs.readFileSync(file,'utf8').split('\n').filter(Boolean).map(l=>{ try{ return JSON.parse(l); }catch(e){ return null; } }).filter(Boolean);
const statsOnly=args[0]==='stats', t0=+args[0]||0, t1=+args[1]||Infinity;
const T=t=>{ t=Math.round(t); return `${String(Math.floor(t/60)).padStart(3)}:${String(t%60).padStart(2,'0')}`; };
const MODES={1:'исследование',2:'скрытность (старый формат)',3:'отступление',4:'отдых',5:'бой',6:'бегство'}, STANCES={0:'пассивно',1:'бегство',2:'бой'};
const ACT={sleep:'спит',idle:'стоит',freeze:'замерла',approach:'подходит',attack:'нападает',back:'отходит',flee:'бежит в логово',home:'идёт домой',rest:'лежит в логове',goto:'идёт по слову'};
function line(r){ const n=r; switch(r.k){
  case 'start': return `— начало: ${r.host}${r.code?' '+r.code:''}${r.restored?' (восстановлена)':''}, платформ ${r.n||(r.cfg&&r.cfg.n)}, ${r.wall}`;
  case 'restore': return `— мир восстановлен из сохранения`;
  case 'op': return r.join!==undefined?`— оператор ${r.join} вошёл, платформа ${r.st}`:`— оператор ${r.leave} вышел, платформа ${r.st}`;
  case 'speed': return `— ускорение ×${r.v}`;
  case 'autonomy': return `ARK-04${1+r.st}: инструкция на потерю связи М${r.unit} = ${['нет','стоп','отступление'][r.v]||r.v}`;
  case 'drop': return `   потеря ${r.kind} М${r.unit}: ${r.reason}`;
  case 'note': switch(r.kind){
    case 'cmd': { let a=''; if(r.cmd==='режим') a=MODES[r.arg]||r.arg; else if(r.cmd==='стойка') a=STANCES[r.arg]||r.arg; else if(r.cmd==='скрытность') a=r.arg?'вкл':'выкл'; else if(r.cmd==='при потере несущей') a=['продолжать','стоп','к шлюзу'][r.arg]||r.arg; else if(r.cmd==='идти'||r.cmd==='смотреть'){ const b=r.bytes; a=`(${(((b[0]<<8)|b[1])-32768)/10}, ${(((b[2]<<8)|b[3])-32768)/10})`; } else if(r.arg) a=String(r.arg); return `ARK-04${1+r.st} → ${r.unit?'М'+r.unit+' ':''}${r.cmd}${a?' '+a:''}`; }
    case 'cry': return `   #${r.who} кричит «${r.word}» из (${r.x}, ${r.y}); слышат ${r.heard.length?r.heard.map(i=>'#'+i).join(' '):'— никто'}`;
    case 'pack': if(r.sense) return `   #${r.who} ${r.sense==='see'?'увидела':'услышала'} М${r.unit} в ${r.d} м (${MODES[r.mode]||r.mode}${r.stealth?', скрытность':''}${r.light?', фонарь':''}), nerve ${r.nerve}`;
      if(r.bite) return `   #${r.who} укусила М${r.bite}: кожа ${r.skin}, кости ${r.bone}${r.reflex===5?' (тело отбивается)':r.mode===5?'':' — тело не отбивается, стойка '+(STANCES[r.stance]||'пассивно')}`;
      if(r.hitBy) return `   М${r.hitBy} ударила #${r.who}: hp ${r.hp}, страх ${r.fear}, nerve ${r.nerve}`;
      return `   #${r.who}: ${ACT[r.act]||r.act}${r.was?' (была: '+(ACT[r.was]||r.was)+')':''} — ${r.why}${r.foe?', чужой М'+r.foe:''}, hp ${r.hp}, страх ${r.fear}`;
    case 'station': return r.refuse?`ARK-04${1+r.st} отказала М${r.unit}: ${r.refuse}, ${r.d} м от узла (узлов ${r.nodes})`:`ARK-04${1+r.st}: серия закрыта — тел нет, биоматериала нет`;
    case 'unit': if(r.dead) return `!! М${r.unit}: жизненные функции прекращены — ${ {skin:'кожа',bone:'опорно-двигательный',glucose:'глюкоза',charge:'заряд'}[r.dead] } (кожа ${r.skin}, кости ${r.bone}, глюкоза ${r.glucose}, заряд ${r.charge}, психика ${r.psyche}) в (${r.x}, ${r.y})`;
      if(r.carrier!==undefined) return `   М${r.unit}: несущая ${r.carrier?'восстановлена':'потеряна'}, SNR ${r.snr} дБ, (${r.x}, ${r.y})`;
      if(r.stuck) return `   М${r.unit}: путь перекрыт в (${r.x}, ${r.y}), уклон ${r.slope}`;
      if(r.reflex) return `   М${r.unit}: рефлекс — ${r.reflex}${r.who!==undefined?', особь #'+r.who+' в '+r.d+' м':''}${r.to?', к узлу ('+r.to.x+', '+r.to.y+')':''}${r.resume!==undefined?(r.resume?', продолжает задачу':', задачи не было'):''}${r.x!==undefined&&!r.who?' в ('+r.x+', '+r.y+')':''}`;
      if(r.autonomy!==undefined) return `   М${r.unit}: 5 с без несущей, инструкция ${['продолжать','стоп','к шлюзу'][r.autonomy]||r.autonomy} в (${r.x}, ${r.y})`;
      return JSON.stringify(r);
    case 'debug': return `   [отладка] телепорт М${r.tp} в (${r.x}, ${r.y})`;
    default: return JSON.stringify(r); }
  default: return null; } }
if(!statsOnly){ for(const r of recs){ if(r.t<t0||r.t>t1) continue; const s=line(r); if(s) console.log(`${T(r.t)}  ${s}`); } console.log(); }
// сводка
const pk={}, dr={}, cr={}, cmds={}; let bytes=0, tmax=0;
for(const r of recs){ tmax=Math.max(tmax,r.t||0); if(r.k==='pkt'){ pk[r.kind]=(pk[r.kind]||0)+1; bytes+=Math.floor(r.b.length*3/4); } if(r.k==='drop') dr[r.kind]=(dr[r.kind]||0)+1; if(r.k==='note'&&r.kind==='cry') cr[r.word]=(cr[r.word]||0)+1; if(r.k==='note'&&r.kind==='cmd') cmds[r.cmd]=(cmds[r.cmd]||0)+1; }
const fmt=o=>Object.entries(o).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k} ${v}`).join(', ')||'—';
console.log(`игровое время ${T(tmax)}; записей ${recs.length}`);
console.log(`пакетов доставлено: ${fmt(pk)}; всего ${bytes} Б (${(bytes/Math.max(1,tmax)).toFixed(1)} Б/с)`);
console.log(`потерь: ${fmt(dr)}`); console.log(`команд: ${fmt(cmds)}`); console.log(`криков: ${fmt(cr)}`);
const deaths=recs.filter(r=>r.k==='note'&&r.kind==='unit'&&r.dead); console.log(`смертей: ${deaths.length}${deaths.length?' — '+deaths.map(r=>'М'+r.unit+' ('+r.dead+')').join(', '):''}`);

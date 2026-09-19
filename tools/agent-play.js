#!/usr/bin/env node
// Площадка агента стаи: станция (мир + канал) в node без сети и консоли, как на сервере. Лента восприятия печатается по мере
// появления, намерения — строками с клавиатуры. Всё пишется в лог мира (tech.md §12) — data/play-<время>.log; открыть его в
// спектаторе: proto/spectate.html. Один миссионер стоит у шлюза ARK-041 с фонарём.
//   node tools/agent-play.js [ускорение] [voice=N] — по умолчанию ×4, радиус голоса ∞
// Ввод:  О2: к обломкам      — намерение (все глаголы — в ответе на непонятное слово)
//        ?                   — картина сейчас (то, что получит join)
//        > 60                — промотать 60 с игрового
//        x 8                 — ускорение
//        где                 — правда о мире: координаты особей и тел (отладка, агент этого не видит)
//        м 100 50            — телепорт миссионера; о 2 100 50 — телепорт особи (отладка)
//        свет / тьма         — скрытность миссионера выкл / вкл (команда 24 по каналу)
//        жди [N]             — как perceive?wait: печатает «— есть» при первой новой строке ленты или «— тихо N с» (по умолчанию 60 с реального)
const fs=require('fs'), path=require('path'), readline=require('readline'); const ROOT=path.join(__dirname,'..'), P=path.join(ROOT,'proto')+'/';
const read=f=>fs.readFileSync(P+f,'utf8');
const makeStation=new Function(read('link.js')+'\n'+read('station.js')+'\nreturn makeStation;')();
const worldSrc=['level.js','codebook.js','terrain.js','camera.js','world.js'].map(read).join('\n');
const args=process.argv.slice(2); let speed=+(args.find(a=>/^\d+$/.test(a))||4); const voice=(args.find(a=>/^voice=/.test(a))||'').slice(6);
const DATA=path.join(ROOT,'data'); fs.mkdirSync(DATA,{recursive:true}); const logFile=path.join(DATA,'play-'+new Date().toISOString().slice(0,16).replace(/[-:T]/g,'')+'.log');
let logBuf=[]; const flush=()=>{ if(!logBuf.length) return; fs.appendFileSync(logFile,logBuf.join('\n')+'\n'); logBuf=[]; }; setInterval(flush,5000);
const fmt=s=>`${String(s.toFixed(0)).padStart(5)}с`; let now=0;
const st=makeStation({ worldSrc, search:'?v=0'+(voice?'&voice='+voice:''), debug:true, out(m){ if(m.t==='pkt'&&m.kind==='EVT') console.log(`${fmt(m.at)}  [событие ${m.bytes[0]} М${m.unit} — оператору]`); },
  agent(m){ if(m.t==='agent'){ console.log(`${fmt(m.at)}  О${m.who}: ${m.text}`); if(waiting){ clearTimeout(waiting); waiting=null; console.log('— есть'); } } else if(m.t==='agentAck') console.log(`       ${m.ok?'принято':'отказано'}${m.who?' О'+m.who:''}${m.why?': '+m.why:''}`); else if(m.t==='agentState') console.log(m.lines.map(l=>'       '+l).join('\n')); },
  log:r=>logBuf.push(JSON.stringify(r)) });
st.log({k:'start', host:'play', n:st.NST, wall:new Date().toISOString()}); st.handle({t:'speed',v:speed});
let waiting=null;   // «жди»: таймер до «тихо»
let timer=null; const run=()=>{ if(timer) clearInterval(timer); timer=setInterval(()=>st.tick(),100/speed); }; run();
const T=()=>st.links[0].link.t;
console.log(`площадка: ×${speed}${voice?', голос '+voice+' м':''}; лог → ${path.relative(ROOT,logFile)}. «?» — картина, «О2: домой» — намерение, «> 60» — промотать.`);
const rl=readline.createInterface({input:process.stdin, output:process.stdout, prompt:''});
rl.on('line',line=>{ const s=line.trim(); if(!s) return; let m;
  if(s==='?') st.handle({t:'agentState'});
  else if((m=/^жди\s*(\d+)?$/.exec(s))){ const n=+(m[1]||60); if(waiting) clearTimeout(waiting); waiting=setTimeout(()=>{ waiting=null; console.log(`— тихо ${n} с`); },n*1000); }
  else if((m=/^>\s*(\d+)$/.exec(s))){ clearInterval(timer); for(let i=0;i<+m[1]*10;i++) st.tick(); run(); console.log(`       … ${m[1]} с, сейчас ${fmt(T())}`); }
  else if((m=/^x\s*(\d+)$/.exec(s))){ speed=+m[1]; st.handle({t:'speed',v:speed}); run(); console.log(`       ×${speed}`); }
  else if(s==='где'){ const d=st.snapshot(); console.log('       [отладка, правда о мире] '+d.stations.filter(S=>S.turret).map(S=>`турель ${S.name} ${S.turret.tgt?'ведёт '+(S.turret.tgt.p!==undefined?'О'+(S.turret.tgt.p+1):'М'+S.turret.tgt.u)+' '+S.turret.aimT.toFixed(1)+' с':S.turret.reloadT>0?'перезарядка':'ждёт'} | `).join('')+d.pack.map(p=>`О${p.i+1}(${p.x.toFixed(0)},${p.y.toFixed(0)}) ${p.act}`).join(' ')+' | '+d.units.map(v=>`М${v.id}(${v.x.toFixed(0)},${v.y.toFixed(0)})${v.alive?'':' мёртв'}`).join(' ')); }
  else if((m=/^о\s*(\d+)\s+(-?\d+)\s+(-?\d+)$/.exec(s))){ st.handle({t:'tp',pack:+m[1]-1,x:+m[2],y:+m[3]}); console.log(`       [отладка] О${m[1]} перенесён`); }
  else if((m=/^м\s*(-?\d+)\s+(-?\d+)$/.exec(s))){ st.handle({t:'tp',unit:1,x:+m[1],y:+m[2]}); console.log('       [отладка] М1 перенесён'); }
  else if(s==='свет'||s==='тьма'){ st.W.handle({t:'cmd',st:0,bytes:new Uint8Array([24,s==='тьма'?1:0,1])}); console.log(`       скрытность М1 ${s==='тьма'?'вкл':'выкл'}`); }
  else st.handle({t:'intent', text:s}); });
const bye=()=>{ flush(); process.exit(0); }; rl.on('close',bye); process.on('SIGINT',bye);

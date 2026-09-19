#!/usr/bin/env node
// Площадка агента стаи: мир без канала и консоли, лента восприятия печатается по мере появления, намерения — строками с клавиатуры.
// Тот же текст и те же ответы, что пойдут по HTTP; отладочные команды помечены. Один миссионер стоит у шлюза ARK-041 с фонарём.
//   node tools/agent-play.js [ускорение]      — по умолчанию ×4
// Ввод:  О2: к обломкам      — намерение (все глаголы — в ответе на непонятное слово)
//        ?                   — картина сейчас (то, что получит join)
//        > 60                — промотать 60 с игрового
//        x 8                 — ускорение
//        где                 — правда о мире: координаты особей и тел (отладка, агент этого не видит)
//        м 100 50            — телепорт миссионера (отладка); о 2 100 50 — телепорт особи
//        свет / тьма         — фонарь миссионера
const fs=require('fs'), path=require('path'), readline=require('readline'); const P=path.join(__dirname,'..','proto')+'/';
const src=['level.js','codebook.js','terrain.js','camera.js','world.js'].map(f=>fs.readFileSync(P+f,'utf8')).join('\n')+'\nreturn {tick, pack, units, stations, T:()=>t, handle:m=>onmessage({data:m})};';
let W=null; const fmt=s=>`${String(s.toFixed(0)).padStart(5)}с`;
const shims={ self:{location:{search:'?v=0'}}, importScripts(){}, postMessage(m){
    if(m.t==='agent') console.log(`${fmt(m.at)}  О${m.who}: ${m.text}`);
    else if(m.t==='agentAck') console.log(`       ${m.ok?'принято':'отказано'}${m.who?' О'+m.who:''}${m.why?': '+m.why:''}`);
    else if(m.t==='agentState') console.log(m.lines.map(l=>'       '+l).join('\n'));
    else if(m.t==='msg'&&m.kind==='EVT'&&W) console.log(`${fmt(W.T())}  [событие ${m.payload[0]} М${m.unit} — оператору]`); },
  setInterval(){return 1}, clearInterval(){}, setTimeout(){return 1}, onmessage:null, fetch(){ return Promise.reject(new Error('no fetch')); } };
W=new Function(...Object.keys(shims), src)(...Object.values(shims));
let speed=+(process.argv[2]||4); let timer=null; const run=()=>{ if(timer) clearInterval(timer); timer=setInterval(()=>W.tick(),100/speed); }; run();
const u=W.units[0];
console.log(`площадка: ×${speed}; миссионер М1 у шлюза (${u.x},${u.y}), фонарь ${u.lightOn?'горит':'выключен'}. «?» — картина, «О2: домой» — намерение.`);
const rl=readline.createInterface({input:process.stdin, output:process.stdout, prompt:''});
rl.on('line',line=>{ const s=line.trim(); if(!s) return; let m;
  if(s==='?') W.handle({t:'agentState'});
  else if((m=/^>\s*(\d+)$/.exec(s))){ clearInterval(timer); for(let i=0;i<+m[1]*10;i++) W.tick(); run(); console.log(`       … ${m[1]} с, сейчас ${fmt(W.T())}`); }
  else if((m=/^x\s*(\d+)$/.exec(s))){ speed=+m[1]; run(); console.log(`       ×${speed}`); }
  else if(s==='где'){ console.log('       [отладка, правда о мире] '+W.stations.filter(S=>S.turret).map(S=>`турель ${S.name} (${S.turret.x.toFixed(0)},${S.turret.y.toFixed(0)}) ${S.turret.tgt?'ведёт '+(S.turret.tgt.p!==undefined?'О'+(S.turret.tgt.p+1):'М'+S.turret.tgt.u)+' '+S.turret.aimT.toFixed(1)+' с':S.turret.reloadT>0?'перезарядка':'ждёт'} | `).join('')+W.pack.map(p=>`О${p.i+1}(${p.x.toFixed(0)},${p.y.toFixed(0)}) ${p.act}${p.hp<=0?' мёртв':''}`).join(' ')+' | '+W.units.map(v=>`М${v.id}(${v.x.toFixed(0)},${v.y.toFixed(0)})${v.alive?'':' мёртв'}`).join(' ')); }
  else if((m=/^о\s*(\d+)\s+(-?\d+)\s+(-?\d+)$/.exec(s))){ const p=W.pack[+m[1]-1]; if(p){ p.x=+m[2]; p.y=+m[3]; p.target=null; p.act='idle'; p.told={v:'тп'}; console.log(`       [отладка] О${m[1]} перенесён`); } }
  else if((m=/^м\s*(-?\d+)\s+(-?\d+)$/.exec(s))){ u.x=+m[1]; u.y=+m[2]; u.target=null; console.log('       [отладка] М1 перенесён'); }
  else if(s==='свет'||s==='тьма'){ u.stealth=s==='тьма'; console.log(`       [отладка] скрытность ${u.stealth?'вкл':'выкл'}`); }
  else W.handle({t:'intent', text:s}); });
rl.on('close',()=>process.exit(0));

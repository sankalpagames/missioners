#!/usr/bin/env node
// Headless-прогон одичалых: тело идёт от входа расщелины к планшету, стая реагирует рефлексами. Печатает крики, события и
// состояние особей, когда оно меняется. Без браузера и канала.
//   node tools/pack-check.js            — идёт с фонарём, стойка «пассивно»: при нападении стоит
//   node tools/pack-check.js 2 2        — первый аргумент: 1 обычный шаг, 2 скрытность, 3 бег; второй — стойка при контакте: 0 пассивно, 1 бегство, 2 бой
const fs=require('fs'), path=require('path'); const P=path.join(__dirname,'..','proto')+'/';
const src=['level.js','codebook.js','terrain.js','camera.js','world.js'].map(f=>fs.readFileSync(P+f,'utf8')).join('\n')+'\nreturn {tick, pack, units, cries, T:()=>t};';
const log=[]; let W=null;
const shims={ self:{location:{search:'?v=0'}}, importScripts(){}, postMessage(m){ if(m.t==='msg'&&m.kind==='EVT') log.push(`${W.T().toFixed(0)}s событие ${m.payload[0]} М${m.unit}`); }, setInterval(){return 1}, clearInterval(){}, setTimeout(){return 1}, onmessage:null, fetch(){ return Promise.reject(new Error('no fetch')); } };
W=new Function(...Object.keys(shims), src)(...Object.values(shims));
const mode=+(process.argv[2]||1), stance=+(process.argv[3]||0), u=W.units[0]; u.mode=mode===3?3:1; u.stealth=mode===2; u.stance=stance; u.x=250; u.y=146;
const route=[{x:260,y:150},{x:284,y:158},{x:300,y:184},{x:321,y:191},{x:326,y:213},{x:336.5,y:216}]; let ri=0; u.target={...route[0]};
const seen=new Set(); let lastLine='', lastReflex=0;
for(let k=0;k<6000;k++){ W.tick(); if(u.reflex!==lastReflex){ log.push(`${W.T().toFixed(0)}s М1 рефлекс: ${u.reflex===5?'бой':u.reflex===6?'бегство':'нет'}${u.reflex?'':u.target?', продолжает':', стоит'}`); lastReflex=u.reflex; }
  if(!u.target && !u.reflex && ri<route.length-1){ ri++; u.target={...route[ri]}; }
  for(const c of W.cries){ const key=c.t+':'+c.i; if(!seen.has(key)){ seen.add(key); log.push(`${c.t.toFixed(0)}s крик #${c.i} «${c.word}» (${c.x.toFixed(0)},${c.y.toFixed(0)})`); } }
  if(k%50===0){ const line=W.pack.map(p=>`#${p.i}:${p.act}${p.hp<p.hpMax?'/hp'+p.hp:''}${p.fear>0.2?'/f'+p.fear.toFixed(1):''}`).join(' '); if(line!==lastLine){ lastLine=line; log.push(`${W.T().toFixed(0)}s М1 (${u.x.toFixed(0)},${u.y.toFixed(0)}) кожа ${u.skin.toFixed(0)} страх ${u.fear.toFixed(2)} | ${line}`); } }
  if(!u.alive){ log.push('М1: жизненные функции прекращены'); break; } }
console.log(log.join('\n'));

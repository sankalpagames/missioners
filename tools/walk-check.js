#!/usr/bin/env node
// Ступеньки на дне расщелины без браузера: из каждой точки дна (сетка 0,25 м) шаг тела 0,14 м в 16 сторон, подъём круче tg 40° —
// тело его не переступит и застрянет (TER.ledges, та же проверка, что blocked() в world.js). Завал в конце расщелины задуман крутым — в сводке, но не ошибка.
//   node tools/walk-check.js [map=ID]   — код возврата 1, если ступенька нашлась вне завала
const fs=require('fs'), path=require('path'); const P=path.join(__dirname,'..','proto')+'/';
const src=[require('./map.js').mapSrc(), ...['codebook.js','terrain.js'].map(f=>fs.readFileSync(P+f,'utf8'))].join('\n')+'\nreturn {TER, LEVEL};';
const {TER,LEVEL}=new Function(src)();
const MAX_SLOPE=0.84;   // как в world.js
const L=TER.ledges(MAX_SLOPE); const bad=L.filter(l=>!l.fall);
console.log(`${LEVEL.meta.id} v${LEVEL.meta.v}: ступенек на дне ${bad.length}${L.length>bad.length?`, в завале ${L.length-bad.length}`:''}`);
for(const l of L) console.log(`  ${l.fall?'завал ':'!     '} (${l.x.toFixed(1)}, ${l.y.toFixed(1)}) — ${l.along.toFixed(0)} м от входа, точек ${l.n}, крутизна ${l.worst.toFixed(2)} (${(Math.atan(l.worst)*180/Math.PI).toFixed(0)}°)`);
process.exit(bad.length?1:0);

#!/usr/bin/env node
// Перевод карты формата 1 (ориентиры с подобъектами, hulls, canyon/bounds в корне) в формат 2 (слои: terrain, pois, objects, decor).
//   node tools/level-convert.js СТАРЫЙ.js [НОВЫЙ.js]   — без второго аргумента пишет поверх.
// Ориентир → указатель (id 120 + k, имя и текст из старой кодовой книги — POI_TEXT ниже), подобъекты → объекты с абсолютными координатами и id 1…;
// feed.obj ретранслятора переводится на новый id; hulls → коллайдер ближайшего объекта того же места (или декор без спрайта — предупреждение).
const fs=require('fs'), path=require('path'); const CB=require(path.join(__dirname,'..','proto','codebook.js'));
const POI_TEXT={ 2:['штабель ящиков','Ящики с маркировкой корпорации. Несколько вскрыты.'], 3:['мачта ретранслятора','Мачта наклонена. У основания — кабель.'], 4:['ряд насыпей','Земляные насыпи, выровненные по линии. Шесть штук.'],
  5:['обломки','Часть корпуса. Не от нашего корабля.'], 6:['вход в расщелину','Разлом в обрыве. Стены отвесные, дно завалено осыпью. Подход расчищен.'], 7:['глубина расщелины','Стены смыкаются наверху. Дальше — завал.'] };
const [src,dst]=process.argv.slice(2); if(!src){ console.error('нужен файл карты'); process.exit(1); }
const text=fs.readFileSync(src,'utf8'); const L=new Function(text+'\nreturn LEVEL;')(); if((L.meta||{}).format!==1){ console.error('формат '+(L.meta||{}).format+', конвертер знает 1'); process.exit(1); }
const N={ meta:{...L.meta, format:2}, terrain:{ canyon:L.canyon, bounds:L.bounds, bumps:[] }, sites:L.sites, layouts:L.layouts, pois:[], objects:[], decor:L.decor||[], pack:L.pack };
const idMap={}; let nid=1;
L.pois.forEach((p,k)=>{ const t=POI_TEXT[p.id]||[('ориентир '+p.id),'']; N.pois.push({id:CB.IDS.poi[0]+k, x:p.x, y:p.y, name:t[0], text:t[1]});
  p.subs.forEach((s,i)=>{ const {dx,dy,...rest}=s; const o={id:nid, type:s.type, x:Math.round((p.x+dx)*100)/100, y:Math.round((p.y+dy)*100)/100, ...rest}; delete o.type; o.type=s.type; idMap[p.id*10+i]=nid++; N.objects.push(o); }); });
for(const o of N.objects) if(o.feed&&idMap[o.feed.obj]!==undefined) o.feed={...o.feed, obj:idMap[o.feed.obj]};
for(const h of L.hulls||[]){ const near=N.objects.filter(o=>Math.hypot(o.x-h.x,o.y-h.y)<0.5); if(near.length){ near[0].collider={r:h.r,h:h.h}; } else { console.warn(`корпус ${h.x},${h.y} r${h.r}: объекта на месте нет — стал декором без листа`); N.decor.push({id:7900+N.decor.length,type:'boulder',x:h.x,y:h.y,f:0,Hs:h.h,collider:{r:h.r,h:h.h}}); } }
const e=CB.levelCheck(N); if(e){ console.error('после перевода: '+e); process.exit(1); }
const out=CB.levelText(N); fs.writeFileSync(dst||src,out); console.log(`${src} → ${dst||src}: указателей ${N.pois.length}, объектов ${N.objects.length}, декора ${N.decor.length}`);
for(const w of CB.levelLint(N)) console.log('  '+(w.info?'· ':'! ')+w.text);

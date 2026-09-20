// База знаний станции: типы объектов, их состояния и действия. Живёт в МИРЕ.
// По каналу ходит ТЕКСТ, который станция составляет из этой базы и текущего состояния мира,
// а не id — так описание может зависеть от чего угодно и не быть заранее перечисленным.
// Консоль отсюда берёт только системные коды (события, режимы, предметы) и кодек текста.
//   states  — что видно вблизи в каждом состоянии (ответ на «изучить»)
//   actions — что можно сделать из состояния: {from, to, verb, item?, needs?, req?, fail?}
//     item  — предмет, который получает миссионер; needs — предмет, без которого нельзя;
//     req   — {obj, state}: другой объект должен быть в состоянии; fail — текст, если не выполнено
const CODEBOOK = {
  1:  { key:'airlock',      name:'шлюз станции',        states:['Наружный люк. Открыт. Уплотнитель растрескался. Обмен со складом — через консоль станции.'] },
  // 2…9 — были типы ориентиров; с формата уровня 2 указатель (LEVEL.pois) несёт имя и текст сам, типов у него нет

  10: { key:'hatch',        name:'люк',                 states:['Закрыт. Маховик заклинил.','Маховик срезан. За люком — переходной отсек, пустой. На стене мелом: «7».'], actions:[{from:0,to:1,verb:'срезал маховик',needs:41,fail:'Маховик не поддаётся. Нужен инструмент.'}] },
  11: { key:'floodlight',   name:'прожектор',           states:['Не горит. Плафон разбит изнутри.'] },
  12: { key:'footprints',   name:'следы',               states:['Отпечатки в грунте. Босые. Разного размера. Ведут в обе стороны.'] },
  13: { key:'crate',        name:'ящик',                states:['Запечатан. Пломба цела.','Вскрыт.'], actions:[{from:0,to:1,verb:'вскрыл'}], container:1 },
  14: { key:'crate_open',   name:'вскрытый ящик',       states:['На крышке процарапано слово.','Процарапано: «НЕ ЖДИТЕ».'], actions:[{from:0,to:1,verb:'прочитал надпись'}], container:0 },
  15: { key:'scrawl',       name:'надпись',             states:['Процарапано металлом по краске. Читается плохо.','«М-07 УШЁЛ ВНИЗ. НЕ ВОЗВРАЩАЙТЕСЬ ЗА НИМ.»'], actions:[{from:0,to:1,verb:'разобрал надпись'}] },
  16: { key:'cable',        name:'кабель',              states:['Тянется к мачте. Перебит.'] },
  17: { key:'mast',         name:'мачта',               states:['Держится на двух растяжках из четырёх.'] },
  18: { key:'cabinet',      name:'шкаф аппаратуры',     states:['Дверца открыта. Внутри пусто: блок снят.'] },
  19: { key:'cable_cut',    name:'оборванный кабель',   states:['Срез ровный. Инструментом.','Срощен. Изоляция — обмотка из комбинезона.'], actions:[{from:0,to:1,verb:'срастил кабель',needs:41,fail:'Жилы нужно зачистить. Нужен инструмент.'}] },
  20: { key:'mound',        name:'насыпь',              states:['Свежая. Относительно.','Под грунтом — тело в корпоративном комбинезоне. Датчиков нет. Лицо знакомое.'], actions:[{from:0,to:1,verb:'раскопал'}] },
  21: { key:'marker',       name:'столбик',             states:['Кусок трубы, воткнут вертикально. Обмотан проводом.','На проводе нацарапаны номера: 01, 02, 03, 04, 05, 06. Шесть насыпей, шесть номеров. Седьмого нет.'], actions:[{from:0,to:1,verb:'осмотрел провод'}] },
  22: { key:'bones',        name:'кости',               states:['Не человеческие. Или не совсем.'] },
  23: { key:'hull',         name:'фрагмент корпуса',    states:['Сплав неизвестен. Оплавлен.'], collider:{r:5,h:4} },   // коллайдер — см. objCollider
  24: { key:'hatch_jammed', name:'заклинивший люк',     states:['Приоткрыт на ладонь. Внутри темно.','Внутри — гнездо из проводов и ткани. Тёплое.'], actions:[{from:0,to:1,verb:'протиснулся и посмотрел'}] },
  25: { key:'scorch',       name:'гарь',                states:['Пятно выжженного грунта. Правильный круг.'] },
  26: { key:'darkness',     name:'темнота',             states:['Расщелина уходит вглубь и поворачивает; неба почти не видно. У входа на стене — прожектор, как у шлюза, снятый с чего-то и прикрученный проводом. Разбит. Вокруг него — глубокие царапины, много, по одному месту.'] },
  27: { key:'tracks',       name:'борозды',             states:['Что-то тяжёлое волокли внутрь.'] },
  28: { key:'tool',         name:'инструмент',          states:['Плоский камень у входа, на нём разложены вещи.'], container:0 },
  29: { key:'pile',         name:'груда',               states:['Сложено намеренно. Наверху что-то блестит.','Разобрана.'], actions:[{from:0,to:1,verb:'разобрал груду'}], container:1 },
  30: { key:'glyphs',       name:'знаки на стене',      states:['Повторяющийся символ.','Логотип корпорации, перевёрнутый. Повторён 41 раз. Последний — свежий.'], actions:[{from:0,to:1,verb:'срисовал знаки'}] },
  31: { key:'water',        name:'вода',                states:['Стоячая, в понижении дна. Тёплая — датчик показывает 31°.'] },
  32: { key:'tablet',       name:'планшет',             states:['Корпоративный планшет, экран треснут. Индикатор заряда мигает.','Последняя запись, 39 лет назад: «Протокол требует возврата. Не вернусь. Станция вырастит следующего, и следующего, и следующего — пока есть биоматериал. Я закопал шестерых. Больше не буду. Если это читает оператор: отключите протокол ПС-7. Я останусь здесь. М-07.» Ниже — отметки дней. Много. Последняя — сегодня.'], actions:[{from:0,to:1,verb:'прочитал запись',special:'finale'}] },

  250:{ key:'unknown',      name:'объект, класс не определён', states:['Двуногое. Кожа с тем же рисунком пор, что у миссионера. Смотрит.'] },
  251:{ key:'body',         name:'тело миссионера',     states:['Не двигается.'], container:0 },
  33: { key:'bundle',       name:'свёрток',             states:['Оставлено на грунте.'], container:0 },
  34: { key:'turret',       name:'турель',              states:['Включена. Лампа горит, ствол ведёт по сектору.','Выключена. Лампа не горит.','Повреждена. Головка сорвана с оси, лампа разбита.'] },   // действия — в мире: своя вкл/выкл, чужая — резать; патроны — «положить»
  // Ретранслятор — узел связи (tech.md §6 «Ретранслятор»): состояния 0 выключен, 1 включён, 2 без питания — ставит мир; текст осмотра составляет мир
  // (канал, питание, линия). Действие — в мире: выключенный — настроить на канал своей станции и включить; включённый на своём канале — выключить;
  // на чужом — перестроить. Свойства вида — relay: range — дальность линии до станции, м; gain — усиление антенны на плече тело ↔ узел, дБ.
  35: { key:'relay',        name:'ретранслятор',        states:['Выключен.','Включён.','Питания нет.'], relay:{range:2000, gain:6} },
  36: { key:'relay_mobile', name:'переносной ретранслятор', states:['Выключен.','Включён.','Питания нет.'], relay:{range:400, gain:0} },
  252:{ key:'missionary',   name:'миссионер',           states:['Наш. Идёт.'] },
};

const ITEMS = { 40:'пищевой брикет', 41:'резак', 42:'камера', 43:'патроны' };   // патроны — пачка на 8 выстрелов, кладётся в турель

// Спрайты для камеры (атлас sprites.png, см. tools/sprites-build.js). sheet — лист из 5 ракурсов (0°, 45°, 90°, 135°, 180°; остальные зеркалом),
// H — реальная высота в метрах (ширина — по пропорции ракурса), view — фиксированный вид, flat — декаль на земле (рисунок в terrain.js).
// Типы без записи в кадр не попадают (надпись; люк станции — часть платформы). Декор — по имени листа.
// Корпус платформы в плане: эллипс 16×9 м, длинная ось по курсу, люк на торце +x (в 2 м перед ним — ориентир «шлюз», 16,0).
// Одна геометрия для лидара, столкновений, спрайта в кадре и знака станции на карте.
const STATION = { x:6, y:0, rx:8, ry:4.5, ang:0, h:7, powerR:40 };   // powerR — зона питания вокруг корпуса, м: что внутри — запитано (турели); розетки и кабели — потом
// Штатный состав базы — то, что разворачивается на площадке уровня (LEVEL.sites), когда хост поднимает платформу: сама станция (корпус STATION),
// шлюз и точка старта, у шлюза — люк, прожектор, два ящика (провизия и патроны), перед шлюзом — турель. В уровне баз нет — только площадки
// (центр и курс) и, если нужно, сюжетные подобъекты у шлюза и своя запись турели. Смещения — в осях площадки (x — по курсу), м;
// подобъекты — от шлюза (id 160 + k·10 + индекс: сначала штатные, потом из уровня, всего не больше 10). Курс турели f — от курса площадки.
const BASE = { airlock:{dx:10,dy:0}, spawn:{dx:10,dy:0},
  subs:[ {type:10,dx:3,dy:2}, {type:11,dx:-2,dy:5}, {type:13,dx:2,dy:-4,items:[40,40,40]}, {type:13,dx:4.5,dy:-5,items:[43,43]} ],   // люк, прожектор, ящик с брикетами, ящик с патронами
  turret:{dx:16,dy:0,f:0,fov:140,range:120,aim:3,reload:10} };
// Версия формата уровня (LEVEL.meta.format): поднимать, когда world.js/terrain.js начинают ждать от карты другое; хост карту с чужим форматом не поднимает.
// Формат 2 (20.09.2026): слои — terrain {canyon, bounds, bumps}, pois (указатели: место с именем и текстом, без типа и спрайта), objects (объекты с
// абсолютными координатами и своим id; scenery — примета: объект без функции, слой редактора), decor (декор: кадр и лидар, не описание), sites, pack.
// Старые карты (ориентиры с подобъектами, hulls) переводит tools/level-convert.js.
// levelCheck — та же проверка везде, где карта попадает в руки (сервер, воркер, редактор, спектатор): текст ли это уровня и того ли формата, целы ли слои.
// levelLint — правила карты, которые редактор показывает на месте: предупреждения (не мешают поднять карту).
const LEVEL_FORMAT=2;
// Диапазоны id (в описании id — один байт): объекты уровня 1…99, свёртки на грунте 100…119, указатели 120…159, штатные и сюжетные объекты баз 160…199,
// тела 200…229, турели 230…239, шлюзы платформ 240…249, особи 250…255
const IDS={ obj:[1,99], ground:[100,119], poi:[120,159], base:160, unit:200, turret:230, station:240, pack:250 };
function levelCheck(L){ if(!L||typeof L!=='object') return 'не уровень'; const m=L.meta||{}; if(!/^[a-z0-9_-]{1,32}$/.test(m.id||'')) return 'meta.id: нужен [a-z0-9_-]{1,32}';
  if(m.format!==LEVEL_FORMAT) return `формат уровня ${m.format}, нужен ${LEVEL_FORMAT}`;
  if(!Array.isArray(L.sites)||!L.sites.length||!L.terrain||!L.terrain.canyon||!Array.isArray(L.pois)||!Array.isArray(L.objects)||!Array.isArray(L.decor)||!L.pack) return 'нет площадок, тирейна, указателей, объектов, декора или стаи';
  const seen={}; for(const o of L.objects){ if(!(o.id>=IDS.obj[0]&&o.id<=IDS.obj[1])) return `объект ${o.id}: id вне ${IDS.obj[0]}…${IDS.obj[1]}`; if(seen[o.id]) return `объект ${o.id}: id повторяется`; seen[o.id]=1; if(!CODEBOOK[o.type]) return `объект ${o.id}: тип ${o.type} не в кодовой книге`; }
  const ps={}; for(const p of L.pois){ if(!(p.id>=IDS.poi[0]&&p.id<=IDS.poi[1])) return `указатель ${p.id}: id вне ${IDS.poi[0]}…${IDS.poi[1]}`; if(ps[p.id]) return `указатель ${p.id}: id повторяется`; ps[p.id]=1; if(!p.name) return `указатель ${p.id}: нет имени`; }
  return ''; }
// Коллайдер объекта: круг {r, h} — стена для ходьбы, отражатель для лидара, преграда для обзора. Из экземпляра (collider) или из типа (CODEBOOK[type].collider); нет — предмет, через него проходят
function objCollider(o){ const c=o.collider||(CODEBOOK[o.type]||{}).collider; return c&&c.r>0?{r:c.r,h:c.h||1}:null; }
// Правила карты — что редактор показывает списком: [{text, ref}] (ref — запись уровня, чтобы выбрать её на карте)
function levelLint(L){ const out=[]; const cols=[];
  for(const o of L.objects){ const c=objCollider(o); if(c) cols.push({o,c}); }
  for(const d of L.decor||[]){ if(d.collider&&d.collider.r>0) cols.push({o:d,c:d.collider,decor:true}); }
  for(const o of L.objects){ const flat=(SPRITES[o.type]||{}).flat;   // плоское (гарь, следы) может лежать и под корпусом — тело подходит к кромке
    for(const {o:h,c} of cols){ if(h===o||flat) continue; if(Math.hypot(o.x-h.x,o.y-h.y)<c.r-0.3) out.push({text:`объект ${o.id} «${(CODEBOOK[o.type]||{}).name}» внутри коллайдера ${h.id}: тело до него не дойдёт`, ref:o}); }
    for(const st of L.sites){ const a=(st.ang||0)*Math.PI/180, lx=(o.x-st.x)*Math.cos(a)+(o.y-st.y)*Math.sin(a), ly=-(o.x-st.x)*Math.sin(a)+(o.y-st.y)*Math.cos(a); if(Math.hypot(lx/STATION.rx,ly/STATION.ry)<0.95) out.push({text:`объект ${o.id} внутри корпуса площадки ${1+L.sites.indexOf(st)}`, ref:o}); }
    if(!SPRITES[o.type]) out.push({text:`объект ${o.id} «${(CODEBOOK[o.type]||{}).name}» без спрайта — в кадр не попадает`, ref:o, info:true});
    if(o.scenery&&(CODEBOOK[o.type]||{}).actions) out.push({text:`примета ${o.id} «${(CODEBOOK[o.type]||{}).name}» имеет действия — это объект, не примета`, ref:o}); }
  for(const p of L.pois){ if(!p.text) out.push({text:`указатель ${p.id} «${p.name}» без текста осмотра`, ref:p}); }
  if((L.pack.members||[]).length>6) out.push({text:`особей ${L.pack.members.length}: id 250 + i уходит за байт, лишние в описании не адресуются`, ref:L.pack.lair});
  return out; }
// Текст файла карты (proto/maps/ID.js) из уровня в памяти — один сериализатор для редактора и tools/level-convert.js. Комментарии-имена — из кодовой книги.
function levelText(L){ const o=[]; const num=v=>String(Math.round(v*100)/100); const nm=t=>(CODEBOOK[t]||{}).name||('тип '+t); const q=s=>"'"+String(s||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/\n/g,'\\n')+"'";
  const relay=s=>{ let f=''; if(s.on) f+=', on:1'; if(s.freq) f+=`, freq:${s.freq}`; if(s.powered===0||s.powered===false) f+=', powered:0'; if(s.feed) f+=`, feed:{obj:${s.feed.obj}, state:${s.feed.state}}`; if(s.range) f+=`, range:${s.range}`; return f; };
  const col=c=>c&&c.r>0?`, collider:{r:${num(c.r)}, h:${num(c.h||1)}}`:'';
  o.push(`// УРОВЕНЬ, формат ${LEVEL_FORMAT}. Карта: где что стоит. Слои: тирейн, указатели, объекты (и приметы), декор, площадки баз, стая.
// Карты лежат в proto/maps/ID.js, хост выбирает карту по id (одиночная игра — ?map=ID, комната — cfg.map, редактор — ?map=ID).
// Подключается в мир (world.js, terrain.js), в редактор (editor.html, только localhost) и в headless-проверки; консоль этого файла не видит.
// Файл пишет редактор (сериализатор levelText в codebook.js) — комментарии-имена он восстанавливает из кодовой книги, прочие комментарии не сохраняются.
// Свойства типов (имя, состояния, действия, спрайт, коллайдер, высота отражателя) — в codebook.js и world.js; здесь только положение и начальное состояние.
//   meta     — id (имя файла без .js), name — название, v — ревизия (редактор поднимает при каждом сохранении), format — версия формата (LEVEL_FORMAT).
//   terrain  — тирейн: грунт. Высота — формула (terrain.js) плюс: canyon — расщелина: колена pts и ширина w в каждом колене, м, branch — тупиковый
//              отросток (первое колено — на оси); bumps — пятна рельефа {x, y, r, h}: купол радиуса r высотой h (h < 0 — яма);
//              bounds — край уровня, м: дальше тела и одичалые не ступают. Стены — из уклона (круче 40° — непроходимо), отдельно не задаются.
//   sites    — площадки под базы: центр и курс ang в градусах. База разворачивается по штатному составу BASE из кодовой книги; subs — сюжетные
//              объекты у шлюза сверх штатных (смещения от шлюза в осях площадки, id 160 + k·10 + i, не больше 10 вместе со штатными);
//              turret — своя турель вместо штатной: dx/dy от центра площадки, f — курс от курса площадки, fov/range/aim/reload.
//   layouts  — какие площадки заняты при n платформах: индексы площадок в порядке платформ (ARK-041, 042, …). Без записи — первые n.
//   pois     — указатели: место с именем и текстом осмотра (id 120…159). Не объект: спрайта нет, действий нет, тело к нему идёт и «изучает» —
//              получает text. Текст — про местность, без того, что может измениться.
//   objects  — объекты мира (id 1…99): type — тип из кодовой книги, x/y — м, f — курс, градусы (нет — по хешу id); state — начальное состояние;
//              items — содержимое контейнера; collider {r, h} — свой коллайдер вместо коллайдера типа; scenery:1 — примета (объект без функции,
//              слой редактора; мир разницы не видит). Ретранслятор (35, 36): on, freq, powered, feed {obj, state}, range — как в codebook.js.
//   decor    — декор: спрайт в кадре и отражатель для лидара, в описании и на карте его нет. type — лист из SPRITES, f — курс, Hs — высота, м;
//              collider {r, h} — если через него нельзя пройти. Процедурный декор (россыпи) — свойство тирейна в terrain.js.
//   pack     — одичалые: lair — логово, members — особи: лёжка x/y и черты 0…1 — size, courage, attention. Не больше 6 (id 250 + i).
const LEVEL = {`);
  const M=L.meta||{}; o.push(`  meta: { id:'${M.id}', name:${q(M.name)}, v:${M.v|0}, format:${LEVEL_FORMAT} },`);
  const T=L.terrain, pts=a=>a.map(p=>`{x:${num(p.x)},y:${num(p.y)}}`).join(', ');
  o.push(`  terrain: {`); o.push(`    canyon: {`); o.push(`      pts: [${pts(T.canyon.pts)}],`); o.push(`      w: [${T.canyon.w.map(num).join(', ')}],`);
  o.push(`      branch: { pts: [${pts(T.canyon.branch.pts)}], w: [${T.canyon.branch.w.map(num).join(', ')}] },`); o.push(`    },`);
  if(T.bounds) o.push(`    bounds: {x0:${num(T.bounds.x0)}, y0:${num(T.bounds.y0)}, x1:${num(T.bounds.x1)}, y1:${num(T.bounds.y1)}},`);
  o.push(`    bumps: [`); for(const b of T.bumps||[]) o.push(`      {x:${num(b.x)}, y:${num(b.y)}, r:${num(b.r)}, h:${num(b.h)}},`); o.push(`    ],`); o.push(`  },`);
  o.push(`  sites: [`);
  L.sites.forEach((S,i)=>{ const Tu=S.turret; const tur=Tu?`, turret:{dx:${num(Tu.dx)}, dy:${num(Tu.dy)}, f:${num(Tu.f||0)}${Tu.fov!==undefined?', fov:'+num(Tu.fov):''}${Tu.range!==undefined?', range:'+num(Tu.range):''}${Tu.aim!==undefined?', aim:'+num(Tu.aim):''}${Tu.reload!==undefined?', reload:'+num(Tu.reload):''}}`:'';
    if(!S.subs||!S.subs.length){ o.push(`    { x:${num(S.x)}, y:${num(S.y)}, ang:${num(S.ang||0)}${tur} },   // площадка ${1+i}`); return; }
    o.push(`    { x:${num(S.x)}, y:${num(S.y)}, ang:${num(S.ang||0)}${tur}, subs:[   // площадка ${1+i}`);
    for(const s of S.subs){ let f=`{type:${s.type}, dx:${num(s.dx)}, dy:${num(s.dy)}`; if(s.f!==undefined) f+=`, f:${num(s.f)}`; if(s.state) f+=`, state:${s.state}`; if(s.items&&s.items.length) f+=`, items:[${s.items.join(',')}]`; f+=relay(s)+col(s.collider); o.push(`      ${f}},   // ${nm(s.type)}`); }
    o.push(`    ] },`); });
  o.push(`  ],`);
  o.push(`  layouts: { ${Object.keys(L.layouts||{}).map(n=>`${n}:[${L.layouts[n].join(',')}]`).join(', ')} },`);
  o.push(`  pois: [`); for(const p of L.pois) o.push(`    { id:${p.id}, x:${num(p.x)}, y:${num(p.y)}, name:${q(p.name)}, text:${q(p.text)} },`); o.push(`  ],`);
  o.push(`  objects: [`);
  for(const s of L.objects){ let f=`{id:${s.id}, type:${s.type}, x:${num(s.x)}, y:${num(s.y)}`; if(s.f!==undefined) f+=`, f:${num(s.f)}`; if(s.state) f+=`, state:${s.state}`; if(s.items&&s.items.length) f+=`, items:[${s.items.join(',')}]`; f+=relay(s)+col(s.collider); if(s.scenery) f+=', scenery:1'; o.push(`    ${f}},   // ${nm(s.type)}${s.scenery?' — примета':''}`); }
  o.push(`  ],`);
  o.push(`  decor: [`); for(const d of L.decor) o.push(`    {id:${d.id}, type:'${d.type}', x:${num(d.x)}, y:${num(d.y)}, f:${num(d.f)}, Hs:${num(d.Hs)}${col(d.collider)}},`); o.push(`  ],`);
  o.push(`  pack: { lair:{x:${num(L.pack.lair.x)},y:${num(L.pack.lair.y)}}, members:[`); for(const m of L.pack.members) o.push(`    {x:${num(m.x)}, y:${num(m.y)}, size:${num(m.size)}, courage:${num(m.courage)}, attention:${num(m.attention)}},`); o.push(`  ] },`);
  o.push(`};`); o.push(`if (typeof module !== 'undefined') module.exports = { LEVEL };`); return o.join('\n')+'\n'; }
// Какие площадки заняты при n платформах: LEVEL.layouts[n] — список индексов площадок в порядке платформ (ARK-041, 042, …); нет записи — первые n
function sitesFor(L,n){ const a=(L.layouts&&L.layouts[n])||L.sites.map((_,i)=>i); return a.slice(0,n).filter(i=>L.sites[i]); }
// База на площадке: всё в мировых координатах (углы — градусы), подобъекты — смещения от шлюза, турель — из уровня или штатная
function baseAt(site){ const ang=site.ang||0, a=ang*Math.PI/180, c=Math.cos(a), s=Math.sin(a); const R=(dx,dy)=>({x:site.x+dx*c-dy*s, y:site.y+dx*s+dy*c});
  const rot=o=>({...o, dx:o.dx*c-o.dy*s, dy:o.dx*s+o.dy*c, f:o.f===undefined?undefined:o.f+ang});
  const T={...BASE.turret, ...(site.turret||{})}; const tp=R(T.dx,T.dy);
  return { x:site.x, y:site.y, ang, airlock:R(BASE.airlock.dx,BASE.airlock.dy), spawn:R(BASE.spawn.dx,BASE.spawn.dy),
    subs:[...BASE.subs, ...(site.subs||[])].slice(0,10).map(rot), turret:{x:tp.x, y:tp.y, f:T.f+ang, fov:T.fov, range:T.range, aim:T.aim, reload:T.reload} }; }
const SPRITES = {
  13:{sheet:'crates_sheet',H:1.0}, 14:{sheet:'crates_sheet',H:1.0},                          // ящики: пока лист штабеля в масштабе одного ящика (art.md §8 — свой лист)
  11:{sheet:'floodlight_sheet',H:3.0}, 12:{flat:true}, 16:{flat:true}, 17:{sheet:'mast_sheet',H:7}, 18:{sheet:'cabinet_sheet',H:1.8}, 19:{flat:true}, 35:{sheet:'cabinet_sheet',H:1.8}, 36:{sheet:'cabinet_sheet',H:0.9},
  20:{sheet:'mound_sheet',H:0.7}, 21:{sheet:'marker_sheet',H:1.1}, 22:{sheet:'bones_sheet',H:0.5}, 23:{sheet:'wreck_sheet',H:4}, 24:{sheet:'hatch_sheet',H:2.0}, 25:{flat:true},
  27:{flat:true}, 28:{sheet:'stone_sheet',H:0.4}, 29:{sheet:'pile_sheet',H:1.4}, 30:{sheet:'glyphs_hd',H:2.0}, 31:{flat:true}, 32:{sheet:'small_sheet',view:0,H:0.25}, 33:{sheet:'small_sheet',view:1,H:0.4}, 34:{sheet:'turret_sheet',H:1.6},
  250:{sheet:'creature2_sheet',H:1.6}, sleep:{sheet:'creature_sleep_sheet',H:0.6},   // существо стоит / спит
  251:{sheet:'body2_sheet',H:0.55}, 252:{sheet:'missionary5_sheet',H:1.8}, walk:{sheet:'missionary_walk_sheet',H:1.8},
  station:{sheet:'platform2_sheet',H:7},
  boulder:{sheet:'boulder_sheet',H:1.8}, boulder2:{sheet:'boulder2_sheet',H:1.2}, rocks:{sheet:'rocks_sheet',H:0.5}, stalks:{sheet:'stalks_sheet',H:1.4},
  outcrop:{sheet:'outcrop_sheet',H:5}, hoodoo:{sheet:'hoodoo_sheet',H:7}, debris:{sheet:'debris_sheet',H:1.1}, cairn:{sheet:'cairn_sheet',H:1.0}, post:{sheet:'post_sheet',H:1.5},
};
// container: с какого состояния содержимое видно и доступно (0 — всегда)

// Однобайтовая кодировка текста в духе КОИ-8: кириллица, латиница, цифры, знаки — по байту на символ.
const TXT_ALPHABET = ' абвгдеёжзийклмнопрстуфхцчшщъыьэюяАБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯabcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,;:!?-—«»()[]/+%°№…\n';
const TXT_ENC = {}; [...TXT_ALPHABET].forEach((ch,i)=>TXT_ENC[ch]=i+1);
function encText(s){ const out=new Uint8Array(s.length); let n=0; for(const ch of s){ out[n++]=TXT_ENC[ch]||TXT_ENC['?']; } return out.slice(0,n); }
function decText(b){ let s=''; for(const v of b) s+=v?TXT_ALPHABET[v-1]||'?':''; return s; }

const MODES = { 1:'исследование', 3:'отступление', 4:'отдых', 5:'бой', 6:'бегство' };   // 1, 3, 4 — команда; 5, 6 — рефлекс по стойке (tech.md §5)
const STANCES = { 0:'пассивно', 1:'бегство', 2:'бой' };
const AUTONOMY = { 0:'продолжать', 1:'стоп', 2:'к шлюзу' };   // инструкция на потерю несущей (команда 26)

const EVENTS = {
  1:'миссионер прибыл в точку',
  2:'взаимодействие: ничего не произошло',
  3:'станция: ретранслятор в сети',
  4:'миссионер получил повреждения',
  5:'жизненные функции прекращены',
  6:'новый миссионер готов',
  7:'режим переключён',
  8:'команда принята',
  9:'контакт: цель отступает',
  10:'станция: камеры на складе нет',
  11:'станция: выращивание начато, 3 мин',
  12:'камера сдана на склад станции',
  13:'камера снята с тела',
  14:'станция: биоматериала нет',
  15:'миссионер остановлен',
  16:'объект не найден рядом',
  17:'станция: задача ПС-7 закрыта. Протокол остановлен.',
  18:'съел брикет: глюкоза +50, электролиты +20',
  19:'сдал на склад',
  20:'взял со склада',
  21:'положил',
  22:'взял',
  23:'путь перекрыт, тело остановилось',
  24:'тело мертво: команда невозможна',
  25:'станция: вне зоны приёма, команда не доставлена',
  26:'приборы обесточены: заряда нет',
  27:'станция: серия 1 исчерпана. ПС-7 остаётся открытой',
  28:'станция: отказ по ПС-2 — цель дальше радиуса возврата',
  29:'контакт: тело приняло бой',
  30:'контакт: тело бежит к узлу',
  31:'контакт окончен: тело продолжает задачу',
  32:'скрытность',
  33:'стойка при контакте',
  34:'бегство окончено: тело стоит',
  35:'инструкция на потерю несущей',
  36:'турель: луч на теле',
  37:'турель: выстрел',
  38:'турель: патроны кончились',
  39:'турель повреждена',
  40:'турель переключена',
  41:'станция: ретранслятор вне сети',
  42:'ретранслятор переключён',
};

if (typeof module !== 'undefined') module.exports = { CODEBOOK, ITEMS, MODES, STANCES, AUTONOMY, EVENTS, STATION, BASE, SPRITES, LEVEL_FORMAT, IDS, levelCheck, levelLint, levelText, objCollider, sitesFor, baseAt, encText, decText };

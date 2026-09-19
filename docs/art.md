# Миссионеры — спрайты и генерация

Как делаются картинки для камеры: генератор, настройки, шаблоны промптов, что уже есть, что дальше. Цель документа — чтобы новый сеанс с тем же инструментарием (SpriteCook MCP + этот репозиторий) продолжил генерацию без повторного подбора. Дизайн местности и правила кадра — `design.md` §11б, устройство камеры — `tech.md` §6.

## 1. Пайплайн

```
SpriteCook (generate_game_art) → лист 1024², 5 ракурсов в ряд, RGBA
  → tools/raw/<имя>.png  (не в git; скачивается заново по asset_id из tools/spritecook-assets.json)
  → node tools/sprites-build.js  → proto/sprites.png + proto/sprites.json  (атлас, высота вида 96 px)
  → SPRITES в proto/codebook.js: тип → {sheet, H}  (H — реальная высота, м)
  → проверка: node tools/render-check.js  → кадры камеры headless, без браузера
```

Скачивание raw: `get_asset_metadata(asset_id)` → `raw_url` (подписанная ссылка, живёт ограниченно) → `curl -sL -o tools/raw/<имя>.png`. Пересборка атласа — секунды. Атлас режет лист на виды по пустым столбцам альфы; слипшиеся виды делит по самому пустому столбцу в середине — руками ничего не резать.

## 2. Настройки генерации (проверено)

| параметр | значение | почему |
|---|---|---|
| `model` | `gpt-image-2.5-flare` | 8 кредитов, поддерживает прозрачность, HD-режим |
| `pixel` | `false` | pixel-art режим даёт жёсткие блоки и контрастные трещины — на 64 px читается как «пиксель-арт поверх фото»; пиксельность должен давать наш сенсор, не спрайт |
| `width`/`height` | 512 / 128 (для одиночных 64/64) | только подсказка; выход всегда 1024² |
| `smart_crop` | `false` для листов | иначе обрежет ряд |
| `bg_mode` | `transparent` | альфа чистая, между видами прозрачно |
| `style` | `grayscale, muted, low contrast, like a frame from a cheap surveillance camera` | |
| `theme` | `cold dusty plain under a volcanic ridge on an alien planet` | |
| `style_asset_ids` / `reference_asset_id` | не использовать | +8 кредитов за референс, и референс полуголой фигуры режется фильтром |
| `wait_seconds` | 60 | задача идёт ~20 с; параллельно одна |

Кредиты списываются и при блокировке фильтром.

## 3. Шаблон промпта — лист ракурсов

```
turnaround sheet of one object shown from 5 angles in a single horizontal row, evenly spaced,
same scale, same ground line: front view, front-left 45 degree view, left side view,
back-left 45 degree view, back view. The object: <описание>. Monochrome grayscale only,
soft overcast lighting, no outlines, photographic shading, transparent background between the views
```

- Для персонажей — `one figure` / `one creature`, для предметов — `one object`.
- Размер задавать словами в метрах и пропорцией («about two meters across», «roughly three times wider than tall», «tall and narrow») — влияет на пропорцию вида, а реальную высоту всё равно задаёт `H` в `SPRITES`.
- **Фронт (вид 0°) — это то, куда смотрит курс объекта в мире.** У платформы — торец с люком, у фигуры — лицо. В мире `facing` у объекта, у декораций — из хеша.
- Освещение — «soft overcast»: солнце и тени добавляет рендер, запечённое направленное освещение поворачивалось бы вместе с ракурсом.
- Без «thick dark outline»: контур на 64 px ничего не даёт, а при усреднении растворяется.
- Плоские вещи (следы, гарь, кабель, вода) — не спрайты, а процедурные декали в `terrain.js` (`DECAL`).
- Одиночные виды (знаки на стене, планшет+свёрток) — без turnaround, можно несколько объектов «side by side in a row», лист разрежется так же.

## 4. Фильтр контента: что режет, как обходить

Режется: «no clothes», «hairless pale skin» в связке с телом, «emaciated humanoid … skin», «no breasts and no genitals», «no harness, no equipment at all» на фоне референса полуголой фигуры. Каждая попытка — 8–16 кредитов впустую.

Проходит: `alien creature` вместо `humanoid`; изможденность через «withered, gaunt, spine bent forward, limbs too long and slightly asymmetric, joints swollen»; нагота через «wearing only the torn rags of a grey coverall hanging from the waist and one shoulder»; бесполость через «androgynous, mannequin-like smooth body» или, лучше, через одежду («shapeless sack-like coverall»).

## 5. Канонические промпты персонажей

Решения по облику: тело — крупный костяк, а не мышцы; голова маленькая, подбородка почти нет, лицо пустое, не красивое, не женское и не мужское; одежда — бесформенный выданный мешок, не обвязка на голом теле и не «хайкер». Существо — то же тело без снаряжения, в лохмотьях того же мешка, иссохшее (это бывший миссионер, §11 дизайна).

**Миссионер, стоит** (`missionary5_sheet`, H 1,8):
> a genderless lab-grown field unit, heavy-boned and broad under its clothing, standing calmly; a small smooth hairless head with an underdeveloped chin — almost no jaw, a blank neutral face with small plain features, not attractive, not feminine, not masculine. It wears a single shapeless standard-issue coverall like a coarse grey sack thrown over the body straight from the vat: loose, baggy, no tailoring, sleeves too long, gathered at the waist by a plain strap, hem at the shins; over the sack a crude harness of straps with two sensor pods on the chest and two on the upper back joined by thin cables, a compact camera unit on the sternum, padded knee guards strapped over the cloth; bare grey feet with hardened soles

**Идёт** (`missionary_walk_sheet`): то же + «walking forward at a steady pace, mid-stride, arms swinging slightly».

**Тело** (`body2_sheet`, H 0,55, тип object): «a lab-grown field unit lying motionless on its side on dusty ground, long and low — a genderless figure with a small smooth hairless head, wearing a shapeless baggy grey coverall gathered at the waist by a strap, a crude sensor harness with pods and thin cables over it, padded knee guards, bare grey feet; dust drifted against the body … no blood».

**Существо, настороже** (`creature2_sheet`, H 1,6, тип creature):
> a lab-grown field unit gone feral after decades alone — the same design as its kind: a small smooth hairless head with almost no jaw and a blank face, but withered and gaunt, spine bent forward, limbs too long and slightly asymmetric, joints swollen, grey pore-patterned skin caked with dust and old scars; wearing only the torn rags of a grey coverall hanging from the waist and one shoulder, no harness, no equipment; hunched alert pose with one long arm reaching low and the head tilted as if listening. … soft dim lighting

**Существо спит** (`creature_sleep_sheet`, H 0,6): «asleep, curled up on its side on bare rock, low and compact — … head tucked toward the knees, overly long limbs folded in … a shallow nest of dust and scraps around it».

Пометки к версиям, чтобы не повторять: v2/v3 миссионера (обвязка на теле) вышли как пин-ап и «дева-воительница»; v4 (бедуинские обмотки) — как опытный хайкер с красивым лицом; v5 принят.

## 6. Что уже есть (листы в атласе)

| лист | тип / имя в `SPRITES` | H, м | заметки |
|---|---|---|---|
| `platform2_sheet` | `station` | 7 | посадочная платформа, утоплена по брюхо, накренена, вокруг навес, ящики, кабель, ветрозащита; люк на торце = фронт (+x) |
| `crates_sheet` | 2 (ориентир «штабель») | 2,4 | два яруса, крышки открыты; отдельные ящики 13/14/15 в кадр не идут |
| `wreck_sheet` | 23 | 4 | обломок корпуса, три раза шире высоты |
| `mound_sheet` | 20 | 0,7 | насыпь |
| `marker_sheet` | 21 | 1,1 | труба с проводом |
| `bones_sheet` | 22 | 0,5 | |
| `pile_sheet` | 29 | 1,4 | груда со «чем-то блестящим» наверху |
| `stone_sheet` | 28 | 0,4 | плоский камень с инструментом |
| `cabinet_sheet` | 18 | 1,8 | шкаф с открытой дверцей, усилитель, индикатор |
| `hatch_sheet` | 24 (заклинивший люк у обломков) | 2,0 | люк станции (10) не рисуется — он на платформе |
| `floodlight_sheet` | 11 | 3,0 | |
| `mast_sheet` | 17 | 7 | решётчатая мачта с растяжками |
| `glyphs_hd` | 30 (один вид) | 2,0 | знаки на стене |
| `small_sheet` | 32 (вид 0), 33 (вид 1) | 0,25 / 0,4 | планшет, свёрток |
| `missionary5_sheet`, `missionary_walk_sheet`, `body2_sheet` | 252, `walk`, 251 | 1,8 / 1,8 / 0,55 | |
| `creature2_sheet`, `creature_sleep_sheet` | 250, `sleep` | 1,6 / 0,6 | |
| `boulder_sheet`, `boulder2_sheet`, `rocks_sheet`, `stalks_sheet` | декорации | 1,8 / 1,2 / 0,5 / 1,4 | валун угловатый, окатанный, россыпь, сухостой на органическом мате |
| `outcrop_sheet`, `hoodoo_sheet` | декорации | 5 / 7 | скальный выход у подножия, останец на дальней равнине |
| `debris_sheet`, `cairn_sheet`, `post_sheet` | декорации | 1,1 / 1,0 / 1,5 | обломки обшивки у корабля, пирамидка тропы, столбик кабельной линии |

Расстановка декораций — `TER.decor` и `FIXED` в `terrain.js`. Старые pixel-art одиночные спрайты и ранние версии (в манифесте без `_sheet`, `missionary`…`missionary4`, `creature`, `creature_alert`, `creature_feral`, `station`, `platform`) — не используются.

## 7. Известное

- Слипшиеся виды (ступни в шаге) — сборщик делит сам; если делит неверно, проще перегенерировать, чем править.
- Кромка альфы у AI-листов шумная — это основной вес атласа (1 МБ при 133 видах). Высота вида 96 px — с запасом: объект в 3 м даёт ~40 px при 64², больше камера не покажет.
- Тон спрайта в кадре сжимается в диапазон сцены (`45 + g·0,5`): серые камни на сером грунте сливаются — это честно, но сюжетным объектам (пирамидки тропы) нужен контраст в самом спрайте: тёмный камень или лоскут наверху.
- Платформа: спрайт, корпус для лидара и столкновений и знак на карте — один эллипс `STATION` в кодовой книге (16×9 м, центр 6,0). Обломки пока круг r 4 при спрайте 12 м — при доработке свести так же.
- Кредиты SpriteCook на 13.09.2026 — 255 (`get_credit_balance`).

## 8. Что генерить дальше

1. **Вторые состояния** (по 8 кредитов, `objState` уже есть, нужен `states:[лист0, лист1]` в `SPRITES` и выбор в `camera.js`): штабель со вскрытым ящиком наверху; раскопанная насыпь; шкаф с горящим индикатором; существо «бьёт».
2. **Турель платформы** (тип 34, `turret_sheet`, высота 1,6 м; пока рисуется листом шкафа `cabinet_sheet`): тумба на треноге, поворотная головка со стволом и лампой-прожектором сверху, кабель к корпусу; второе состояние — лампа не горит.
3. Пирамидка тропы — контрастнее (см. §7).
4. Крупные обломки у подножия обрыва (2 листа), чтобы осыпь читалась с 25 м.
5. Второй лист штабеля для ящиков как отдельных объектов не нужен — ящики 13/14/15 остаются в описании и журнале, а в кадре — частью штабеля.

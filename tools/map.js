// Карта для headless-инструментов: текст proto/maps/ID.js. id — аргумент map=ID, переменная MAP или act1; путь к файлу тоже принимается (map=ПУТЬ).
// Проверка та же, что у хостов (levelCheck из codebook.js): не файл уровня или чужой формат — ошибка.
const fs=require('fs'), path=require('path'); const P=path.join(__dirname,'..','proto')+'/';
const {levelCheck}=require(P+'codebook.js');
function mapSrc(argv=process.argv){ const a=(argv.find(x=>/^map=/.test(x))||'').slice(4)||process.env.MAP||'act1';
  const file=/[\/.]/.test(a)?path.resolve(a):P+'maps/'+a+'.js'; const src=fs.readFileSync(file,'utf8');
  if(!/^\/\/ УРОВЕНЬ/.test(src)||!/\nconst LEVEL = \{/.test(src)) throw new Error(file+': не файл уровня');
  const e=levelCheck(new Function(src+'\nreturn LEVEL;')()); if(e) throw new Error(file+': '+e); return src; }
module.exports={ mapSrc };

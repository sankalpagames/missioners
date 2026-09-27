#!/usr/bin/env node
// Документы без разрастания: длина строки, бюджет размера, хроника в справочниках, ссылки «ФАЙЛ.md §N» на существующие разделы.
// Документ правится, а не дописывается: дата, «было/стало» и повод — в history.md, числа баланса — константами в коде.
//   node tools/docs-check.js [тихо]   — код возврата 1, если есть ошибки (предупреждения не валят)
const fs=require('fs'), path=require('path'); const ROOT=path.join(__dirname,'..');
const quiet=process.argv.includes('тихо');
const rd=f=>fs.readFileSync(path.join(ROOT,f),'utf8');

// Бюджет в КБ (байты UTF-8) и длина строки в знаках: предупреждение / ошибка. history.md — журнал, строки не меряем.
const DOCS={
  'CLAUDE.md':          {kb:25, warn:900, err:1500},
  'README.md':          {kb:10, warn:900, err:1500},
  'docs/codex.md':      {kb:15, warn:900, err:1500},
  'docs/design.md':     {kb:90, warn:1200, err:2000},
  'docs/tech.md':       {kb:80, warn:900, err:1500, chron:true},
  'docs/server.md':     {kb:25, warn:900, err:1500, chron:true},
  'docs/tools.md':      {kb:20, warn:900, err:1500, chron:true},
  'docs/roadmap.md':    {kb:35, warn:1200, err:2000},
  'docs/history.md':    {kb:80},
  'docs/art.md':        {kb:25, warn:900, err:1500},
  'docs/agent-api.md':  {kb:20, warn:1200, err:2000, chron:true},
  'docs/agent-op.md':   {kb:35, warn:1200, err:2000, chron:true},
  'docs/agent-pack.md': {kb:30, warn:1200, err:2000, chron:true},
};
for(const f of fs.readdirSync(path.join(ROOT,'docs'))) if(/^brief-.*\.md$/.test(f)) DOCS['docs/'+f]={kb:6, warn:900, err:1500, chron:true};

// Хроника в справочниках: даты и «было …» — место им в history.md.
const CHRON=[[/\b\d\d\.\d\d\.20\d\d\b/, 'дата'], [/\(было\b|; было\b|, было\b|\bбыло «/, '«было»'], [/\(плейтест\b/, 'повод «плейтест»']];

// Разделы файла: «## 11г. Заголовок» → '11г'; заголовки любого уровня — для «§6 «Ретранслятор»».
function sections(text){
  const ids=new Set(), names=[];
  for(const m of text.matchAll(/^(#{2,4})\s+(?:(\d+[а-я]?)\.\s*)?(.+)$/gm)){ if(m[2]) ids.add(m[2]); names.push(m[3].toLowerCase()); }
  return {ids, names};
}
const secCache={};
function secOf(md){ if(!(md in secCache)){ const p=['docs/'+md, md].find(x=>fs.existsSync(path.join(ROOT,x))); secCache[md]=p?sections(rd(p)):null; } return secCache[md]; }

let errors=0, warns=0;
const out=(lvl,where,msg)=>{ if(lvl==='!') errors++; else { warns++; if(quiet) return; } console.log(`${lvl==='!'?'ОШИБКА':'внимание'}  ${where}: ${msg}`); };

// Ссылки «X.md` §N[–M] [«Имя»]» — в документах и в комментариях кода.
const REF=/([\w-]+\.md)`?\s*§\s*(\d+[а-я]?)(?:\s*[–-]\s*(\d+[а-я]?))?(?:,?\s*«([^»]+)»)?/g;
function checkRefs(file, text){
  if(file==='docs/history.md') return;   // история ссылается на разделы того дня
  text.split('\n').forEach((line,i)=>{
    for(const m of line.matchAll(REF)){
      const [ , md, a, b, name]=m;
      const s=secOf(md); const at=`${file}:${i+1}`;
      if(!s){ out('!',at,`ссылка на несуществующий ${md}`); continue; }
      for(const id of [a,b].filter(Boolean)) if(!s.ids.has(id)) out('!',at,`${md} §${id} — такого раздела нет`);
      if(name && !s.names.some(n=>n.includes(name.toLowerCase()))) out('~',at,`${md} §${a} «${name}» — подраздела с таким именем нет`);
    }
  });
}

for(const [f,r] of Object.entries(DOCS)){
  if(!fs.existsSync(path.join(ROOT,f))){ out('!',f,'файла нет'); continue; }
  const text=rd(f), kb=Buffer.byteLength(text)/1024;
  if(kb>r.kb) out('!',f,`${kb.toFixed(0)} КБ при бюджете ${r.kb} — сначала убрать устаревшее, потом добавлять`);
  const inFence=[]; let fence=false;
  text.split('\n').forEach((line,i)=>{
    if(/^```/.test(line)) fence=!fence;
    const at=`${f}:${i+1}`, n=[...line].length;
    if(r.err && !fence){ if(n>r.err) out('!',at,`строка ${n} знаков (предел ${r.err}) — разбить на список`); else if(n>r.warn) out('~',at,`строка ${n} знаков`); }
    if(r.chron && !fence) for(const [re,what] of CHRON) if(re.test(line)) out('!',at,`${what} в справочнике — в history.md: «${line.match(re)[0]}»`);
  });
  checkRefs(f,text);
}
for(const dir of ['proto','server','tools']){
  const walk=d=>fs.readdirSync(path.join(ROOT,d),{withFileTypes:true}).flatMap(e=>e.isDirectory()?(['node_modules','out','raw'].includes(e.name)?[]:walk(d+'/'+e.name)):/\.(js|html|py)$/.test(e.name)?[d+'/'+e.name]:[]);
  for(const f of walk(dir)) checkRefs(f, rd(f));
}
console.log(`документы: ошибок ${errors}, предупреждений ${warns}`);
process.exit(errors?1:0);

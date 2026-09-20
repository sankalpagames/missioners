// РЕЛЬЕФ. Живёт в мире (см. design.md §11б). Одно поле высот: равнина с дюнами, хребет с обрывом, расщелина, вырезанная в хребте
// до уровня дна. Отсюда же — тона грунта и породы, декорации (процедурные и сюжетные), солнце и дальние планы для камеры.
// Подключается в воркер мира; консоль этого файла не видит.
const TER = (()=>{
  const ss=(a,b,x)=>{ const t=Math.max(0,Math.min(1,(x-a)/(b-a))); return t*t*(3-2*t); };
  function hash(ix,iy){ let n=ix*374761393+iy*668265263; n=(n^(n>>13))*1274126177; return ((n^(n>>16))&0xffff)/0xffff; }
  function vnoise(x,y){ const ix=Math.floor(x), iy=Math.floor(y), fx=x-ix, fy=y-iy, sx=fx*fx*(3-2*fx), sy=fy*fy*(3-2*fy);
    const a=hash(ix,iy), b=hash(ix+1,iy), c=hash(ix,iy+1), d=hash(ix+1,iy+1); const t=a+(b-a)*sx; return t+((c+(d-c)*sx)-t)*sy; }

  // ---- расщелина: ломаная с тупиковым отростком, ширина по коленам; начинается у входа. Колена и ширины — LEVEL.terrain.canyon ----
  // Производные (направление входа, длина, хребет, сюжетные декорации) считаются в reload(); редактор зовёт его после правки уровня.
  let CANYON, A0, D0, LEN, RIDGE, FIXED, CBOX, BUMPS;   // CBOX — прямоугольник, вне которого расщелина и подход не влияют; BUMPS — пятна рельефа уровня
  function reload(){ CANYON=LEVEL.terrain.canyon; BUMPS=(LEVEL.terrain.bumps||[]).filter(b=>b.r>0); A0=CANYON.pts[0]; { const q=CANYON.pts[1]; const dx=q.x-A0.x, dy=q.y-A0.y, L=Math.hypot(dx,dy)||1; D0={x:dx/L,y:dy/L}; }   // направление входа
    LEN=0; for(let i=0;i<CANYON.pts.length-1;i++) LEN+=Math.hypot(CANYON.pts[i+1].x-CANYON.pts[i].x,CANYON.pts[i+1].y-CANYON.pts[i].y);
    RIDGE={ c:{x:A0.x+D0.x*28, y:A0.y+D0.y*28}, d:{x:-D0.y,y:D0.x}, n:{x:D0.x,y:D0.y} };   // позвоночник в 28 м за входом, поперёк входа
    FIXED=LEVEL.decor.map(o=>({id:o.id,type:o.type,x:o.x,y:o.y,facing:o.f*Math.PI/180,Hs:o.Hs,collider:o.collider&&o.collider.r>0?o.collider:null,decor:true}));
    const ps=[...CANYON.pts,...CANYON.branch.pts,{x:A0.x-D0.x*60,y:A0.y-D0.y*60}]; CBOX={x0:Math.min(...ps.map(p=>p.x))-16,x1:Math.max(...ps.map(p=>p.x))+16,y0:Math.min(...ps.map(p=>p.y))-16,y1:Math.max(...ps.map(p=>p.y))+16}; }
  function segInfo(p,q,x,y){ const dx=q.x-p.x, dy=q.y-p.y, L=Math.hypot(dx,dy); const t=Math.max(0,Math.min(1,((x-p.x)*dx+(y-p.y)*dy)/(L*L))); const px=p.x+dx*t, py=p.y+dy*t; return { d:Math.hypot(x-px,y-py), t, L, perp:(-(x-p.x)*dy+(y-p.y)*dx)/L, dir:{x:dx/L,y:dy/L} }; }
  // ближайшее колено: {d — до оси, w — ширина, along — путь от входа (м), perp, dir, branch}; перед входом along < 0
  function canyon(x,y){ if(x<CBOX.x0||x>CBOX.x1||y<CBOX.y0||y>CBOX.y1) return FAR; let best=null, acc=0;
    for(let i=0;i<CANYON.pts.length-1;i++){ const si=segInfo(CANYON.pts[i],CANYON.pts[i+1],x,y); const w=CANYON.w[i]+(CANYON.w[i+1]-CANYON.w[i])*si.t; const c={d:si.d,w,along:acc+si.t*si.L,perp:si.perp,dir:si.dir,branch:false}; if(!best||si.d-w/2<best.d-best.w/2) best=c; acc+=si.L; }
    const br=CANYON.branch; let bacc=0; for(let i=0;i<br.pts.length-1;i++){ const si=segInfo(br.pts[i],br.pts[i+1],x,y); const w=br.w[i]; const c={d:si.d,w,along:60+bacc+si.t*si.L,perp:si.perp,dir:si.dir,branch:true}; if(si.d-w/2<best.d-best.w/2) best=c; bacc+=si.L; }
    const s0=segInfo({x:A0.x-D0.x*60,y:A0.y-D0.y*60},A0,x,y); if(s0.t<1 && s0.d-4.5<best.d-best.w/2) best={d:s0.d,w:9,along:-(1-s0.t)*60,perp:s0.perp,dir:D0,branch:false};
    return best; }
  const FAR={d:1e9,w:0,along:-1e9,perp:0,dir:{x:1,y:0},branch:false};
  function inside(x,y,margin=0){ const c=canyon(x,y); return c.d<c.w/2-margin ? c : null; }                   // внутри расщелины (или на подходе)
  function corridor(x,y){ const c=canyon(x,y); return c.d<c.w/2+4 ? c : null; }
  function canyonPoint(t){ const a=t*LEN; let acc=0; for(let i=0;i<CANYON.pts.length-1;i++){ const p=CANYON.pts[i], q=CANYON.pts[i+1]; const L=Math.hypot(q.x-p.x,q.y-p.y); if(a<=acc+L||i===CANYON.pts.length-2){ const k=Math.max(0,Math.min(1,(a-acc)/L)); return {x:p.x+(q.x-p.x)*k, y:p.y+(q.y-p.y)*k, dir:{x:(q.x-p.x)/L,y:(q.y-p.y)/L}}; } acc+=L; } }

  // ---- макро: равнина и хребет ----
  const WIND={x:0.94,y:0.34};
  function ridgeH(x,y){ const rx=x-RIDGE.c.x, ry=y-RIDGE.c.y; const s=rx*RIDGE.d.x+ry*RIDGE.d.y, n=rx*RIDGE.n.x+ry*RIDGE.n.y; if(n<-90||n>175) return 0;
    const crest=26+9*Math.sin(s/60+1)+4*(vnoise(s/25,3)-0.5); let k;
    if(n<0){ const edge=18+6*(vnoise(s/20,7)-0.5); const dcl=-n-edge;                          // сторона станции: гребень → обрыв с террасами → осыпь
      if(dcl<0) k=1; else if(dcl<10){ const c=1-dcl/10; k=0.28+0.72*((Math.floor(c*3)+ss(0.3,0.7,c*3-Math.floor(c*3)))/3); } else k=0.28*Math.max(0,1-(dcl-10)/45)**1.5; }
    else k=Math.max(0,1-n/170)**2;                                                               // дальняя сторона: пологий склон
    return crest*k + (k>0.02? 1.5*(vnoise(x/6,y/6)-0.5)*k : 0); }
  function landing(x,y){ return 1-ss(45,110,Math.hypot(x,y)); }                                   // посадочное поле: пусто и плоско
  function hills(x,y){ return (2.4*vnoise(x/120+7,y/120+3)+1.0*vnoise(x/35,y/35)-1.7)*(1-0.7*landing(x,y)); }
  function bumps(x,y){ let h=0; for(const b of BUMPS){ const d=Math.hypot(x-b.x,y-b.y); if(d<b.r) h+=b.h*(1-ss(0,1,d/b.r)); } return h; }   // пятна рельефа уровня (тирейн): купол радиуса r высотой h, яма при h < 0
  function dunes(x,y){ const u=-x*WIND.y+y*WIND.x; const ph=u/9+1.6*vnoise(x/45,y/45); const sh=Math.pow(1-Math.abs(Math.sin(ph)),1.7); const amp=1.1*(0.4+0.6*vnoise(x/90+2,y/90))*(1-landing(x,y)); return amp*sh; }
  function micro(x,y){ const u=-x*WIND.y+y*WIND.x; return 0.035*Math.sin(u/0.55+2*vnoise(x/3,y/3))+0.06*Math.max(0,vnoise(x/0.35,y/0.35)-0.6); }
  function rubble(a,p){ const r=0.5*Math.max(0,vnoise(a/4,p/4+9)-0.72)/0.28; const big=1.3*Math.max(0,1-Math.hypot((a-62)/6,(p-2.2)/2.6)); const fall=2.2*Math.max(0,(a-(LEN-7))/7)*(0.7+0.6*vnoise(a/1.5,p/1.5)); return r+big+fall+0.02*vnoise(a/0.3,p/0.3); }   // осыпь, обрушение, завал в конце
  function floorZ(a,p){ return 0.08*(vnoise(a/1.2,p/1.2)-0.5)+rubble(a,p); }
  // высота поверхности
  function H(x,y,lod=0){ const c=canyon(x,y); let r=ridgeH(x,y); if(c.along<0 && c.along>-60){ const strip=(1-ss(6,11,Math.abs(c.perp)))*ss(-50,-25,c.along); r*=1-strip; }   // подход через осыпь расчищен
    const h=hills(x,y)+dunes(x,y)+bumps(x,y)+(lod?0:micro(x,y))+r; if(c.d>c.w/2+4) return h;
    if(c.along>-6 && c.along<1 && Math.abs(c.perp)<5.5){ const k=ss(-6,-2,c.along)*(1-ss(4,5.5,Math.abs(c.perp))); return h*(1-k)+floorZ(c.along,c.perp)*k; }
    const wall=c.w/2; const k=1-ss(wall,wall+1.6,c.d);   // стена начинается ровно на полуширине — там же, где явная стена для лидара и ходьбы
    if(k<=0) return h; return h*(1-k)+floorZ(c.along,c.perp)*k; }
  // крутизна поверхности: tg угла наклона (для лидара — бит «сплошное», для ходьбы — непроходимый склон)
  function slope(x,y){ const e=0.3; const dx=(H(x+e,y,1)-H(x-e,y,1))/(2*e), dy=(H(x,y+e,1)-H(x,y-e,1))/(2*e); return Math.hypot(dx,dy); }

  // ---- альбедо ----
  function groundTone(x,y,nz,inC){ const c=canyon(x,y);
    if(c && c.d<c.w/2+1 && c.along>-3){ const damp=c.along>0.6*LEN? 25*ss(0.5,0.9,vnoise(c.along/0.6,c.perp*3)) : 0; return 100+30*vnoise(x/0.9,y/0.9)-damp; }
    if(nz<0.72) return rockTone(x,y,H(x,y));
    let t=138+14*vnoise(x/6,y/6)+9*(vnoise(x/0.5,y/0.5)-0.5)+6*landing(x,y);
    const low=hills(x,y)+dunes(x,y)<-0.4; const mat=ss(0.66,0.8,vnoise(x/22+5,y/22+5))*(low?1:0.25)*(1-landing(x,y)); return t-48*mat; }   // органические маты в низинах
  function rockTone(x,y,z){ return 100+28*vnoise(x/1.3+z*0.35,y/1.3-z*0.25)+12*(vnoise(x/0.35+z,y/0.35-z)-0.5); }
  function wallTone(x,y,z){ const c=canyon(x,y); const damp=c.along>0.6*LEN? 30*ss(0.5,0.9,vnoise(c.along/0.6,z*2+c.perp)) : 0; return rockTone(x,y,z)-damp; }

  // ---- плоские объекты: процедурные декали в системе объекта (u — вдоль курса, v — поперёк) → {a: альфа, d: сдвиг тона} ----
  const DECAL = {
    27:(u,v)=>{ if(u<-1||u>6) return null; const f=Math.abs(Math.abs(v)-0.6); const a=Math.max(0,1-f/0.25)*(0.6+0.4*vnoise(u*2,v*3)); return a>0.05?{a,d:-30}:null; },            // борозды: две колеи
    12:(u,v)=>{ if(u<-1||u>8) return null; const k=Math.floor(u/0.7); const cx=k*0.7+0.35, cy=(k%2?0.18:-0.18); const r=Math.hypot(u-cx,v-cy); return r<0.16?{a:0.8,d:-22}:null; },   // следы: цепочка
    25:(u,v)=>{ const r=Math.hypot(u,v); if(r>7) return null; const a=(1-ss(5.5,7,r))*(0.5+0.5*vnoise(Math.atan2(v,u)*4,r*1.5)); return {a,d:-55+25*ss(0,1.2,1.2-r)}; },           // гарь: круг 7 м, в центре зола (под обломком r 5 — виден край)
    16:(u,v)=>{ if(u<-6||u>6) return null; const w=Math.abs(v-0.25*Math.sin(u*0.9)); return w<0.09?{a:0.9,d:-40}:null; },                                                        // кабель
    19:(u,v)=>{ if(u<-3||u>3) return null; const w=Math.abs(v-0.2*Math.sin(u*1.3)); return w<0.09?{a:0.9,d:-40}:null; },
    31:(u,v)=>{ const r=Math.hypot(u/3.2,v/2.2)*(1+0.25*(vnoise(u,v)-0.5)); if(r>1) return null; const spec=ss(0.85,1,vnoise(u*3+9,v*3)); return {a:0.9*(1-ss(0.8,1,r)),d:-45+70*spec}; },   // вода: пятно с бликами
  };

  // ---- декор: объекты кадра и лидара, но не объекты мира (не в описании, не на карте); с коллайдером — стена для ходьбы (world.js HULLS);
  // процедурный (proc) — валуны, выходы породы, останцы — стена по своему радиусу отражателя (world.js solidDecor), россыпь и стебли проходятся ----
  // из уровня (FIXED, LEVEL.decor): завал в конце расщелины, обломки вокруг корабля, пирамидки по тропе ящики → расщелина, столбики кабеля станция → мачта
  function decor(u,R){ const out=FIXED.filter(o=>Math.abs(o.x-u.x)<R&&Math.abs(o.y-u.y)<R); const cell=9; const i0=Math.floor((u.x-R)/cell), i1=Math.floor((u.x+R)/cell), j0=Math.floor((u.y-R)/cell), j1=Math.floor((u.y+R)/cell);
    for(let i=i0;i<=i1;i++)for(let j=j0;j<=j1;j++){ const h=hash(i*31+7,j*17+3), h2=hash(i*13+1,j*29+5), h3=hash(i*7+11,j*3+13); const x=(i+0.15+0.7*h2)*cell, y=(j+0.15+0.7*h3)*cell;
      const rx=x-RIDGE.c.x, ry=y-RIDGE.c.y; const n=rx*RIDGE.n.x+ry*RIDGE.n.y; const c=corridor(x,y);
      const talus = n<0 ? ss(-75,-40,n)*(1-ss(-34,-26,n)) : 0;
      let dens = 0.06 + 0.5*talus; dens*=(1-landing(x,y)); if(c && c.along>-40) dens=0; if(n>-26 && n<60) dens=0;
      if(h>=dens) continue; const low=hills(x,y)+dunes(x,y)<-0.3; const kind = h2<0.4? 'rocks' : h2<0.62? 'boulder' : (h2<0.85||!low)? 'boulder2' : 'stalks';
      const Hs = kind==='boulder'? 1.0+1.6*h3 : kind==='boulder2'? 0.8+0.9*h3 : kind==='rocks'? 0.35+0.4*h3 : 1.1+0.6*h3; out.push({id:5000+i*1000+j, type:kind, x, y, facing:h3*6.28, Hs, decor:true, proc:true}); }
    // крупное — по редкой сетке: выходы породы у подножия гряды, останцы на дальней равнине
    const big=45; const bi0=Math.floor((u.x-R-big)/big), bi1=Math.floor((u.x+R+big)/big), bj0=Math.floor((u.y-R-big)/big), bj1=Math.floor((u.y+R+big)/big);
    for(let i=bi0;i<=bi1;i++)for(let j=bj0;j<=bj1;j++){ const h=hash(i*53+5,j*59+7), h2=hash(i*61+3,j*67+1), h3=hash(i*71+9,j*73+2); const x=(i+0.2+0.6*h2)*big, y=(j+0.2+0.6*h3)*big; if(Math.abs(x-u.x)>R+30||Math.abs(y-u.y)>R+30) continue;
      const rx=x-RIDGE.c.x, ry=y-RIDGE.c.y; const n=rx*RIDGE.n.x+ry*RIDGE.n.y; const c=corridor(x,y); if(c && c.along>-45) continue; if(landing(x,y)>0.05) continue; if(n>-30 && n<70) continue;
      const foot = n<0 ? ss(-110,-45,n)*(1-ss(-38,-30,n)) : 0; const far = Math.hypot(x,y)>220;
      if(foot>0 && h<0.55*foot) out.push({id:8000+i*1000+j,type:'outcrop',x,y,facing:h2*6.28,Hs:3.5+3*h3,decor:true,proc:true});
      else if(far && h2>0.5 && h<0.12) out.push({id:8500+i*1000+j,type:'hoodoo',x,y,facing:h2*6.28,Hs:5+4*h3,decor:true,proc:true}); }
    return out; }

  // ---- свет и дальние планы ----
  const SUN=(()=>{ const az=Math.PI*0.75, el=Math.PI/5; return {x:Math.cos(az)*Math.cos(el),y:Math.sin(az)*Math.cos(el),z:Math.sin(el),shx:-Math.cos(az),shy:-Math.sin(az),len:1/Math.tan(el)}; })();
  function mountains(bearing){ const b=bearing*3; return { far: 0.02+0.10*Math.pow(Math.abs(vnoise(b*1.1+40,1)*2-1),0.8)+0.025*vnoise(b*4+9,2), near: 0.005+0.035*vnoise(b*2.5+77,5)+0.012*vnoise(b*9+3,6) }; }   // угол возвышения по пеленгу

  reload();
  return { reload, ss, hash, vnoise, get CANYON(){ return CANYON; }, get LEN(){ return LEN; }, get RIDGE(){ return RIDGE; }, get FIXED(){ return FIXED; }, canyon, inside, corridor, canyonPoint, ridgeH, hills, dunes, bumps, landing, H, floorZ, slope, groundTone, rockTone, wallTone, DECAL, decor, SUN, mountains };
})();

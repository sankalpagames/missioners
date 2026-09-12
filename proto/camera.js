// КАМЕРА МИССИОНЕРА. Живёт в мире. Кадр — честный рендер сцены: рельеф лучами по полю высот (TER), объекты и декорации —
// спрайты-билборды из атласа (sprites.png, 5 ракурсов + зеркало), тени и плоские объекты — декали по точкам земли.
// Рендер идёт в удвоенном разрешении и усредняется, спрайты усредняются по всему футпринту пикселя — как на матрице.
// Наружу отдаёт только серый буфер size×size; всё остальное (пирамида, дельты, канал) — в world.js.
const CAM = (()=>{
  const FOV=50, CAM_Z=1.6; const clamp=(v)=>Math.max(0,Math.min(255,v)); const {ss,vnoise,hash}=TER;
  let atlas=null;   // {views:{sheet:[{w,h,gray,alpha,sa,sg}]}}

  // ---- атлас ----
  async function load(v){ try{
    const [png,json]=await Promise.all([fetch('sprites.png?v='+v).then(r=>r.blob()), fetch('sprites.json?v='+v).then(r=>r.json())]);
    const bmp=await createImageBitmap(png); const cv=new OffscreenCanvas(json.w,json.h); const ctx=cv.getContext('2d',{willReadFrequently:true}); ctx.drawImage(bmp,0,0); const px=ctx.getImageData(0,0,json.w,json.h).data;
    build(json,px); return true; } catch(e){ atlas=null; return false; } }
  // px — RGBA атласа; серый в R, альфа в A
  function build(json,px){ const views={}; for(const [name,list] of Object.entries(json.sheets)) views[name]=list.map(r=>{ const w=r.w,h=r.h, gray=new Uint8Array(w*h), alpha=new Uint8Array(w*h);
      for(let y=0;y<h;y++)for(let x=0;x<w;x++){ const k=((r.y+y)*json.w+r.x+x)*4; gray[y*w+x]=px[k]; alpha[y*w+x]=px[k+3]; }
      // интегральные таблицы: площадь альфы и сумма тон×альфа — для честного усреднения по футпринту
      const W1=w+1, sa=new Float64Array(W1*(h+1)), sg=new Float64Array(W1*(h+1));
      for(let y=1;y<=h;y++){ let ra=0, rg=0; for(let x=1;x<=w;x++){ const k=(y-1)*w+(x-1); const a=alpha[k]/255; ra+=a; rg+=a*gray[k]; sa[y*W1+x]=sa[(y-1)*W1+x]+ra; sg[y*W1+x]=sg[(y-1)*W1+x]+rg; } }
      return {w,h,gray,alpha,sa,sg}; });
    atlas={views}; }
  function area(s,u0,v0,u1,v1){ const W1=s.w+1; const x0=Math.max(0,Math.min(s.w,Math.floor(u0))), x1=Math.max(x0+1,Math.min(s.w,Math.ceil(u1))), y0=Math.max(0,Math.min(s.h,Math.floor(v0))), y1=Math.max(y0+1,Math.min(s.h,Math.ceil(v1)));
    const S=(t)=>t[y1*W1+x1]-t[y0*W1+x1]-t[y1*W1+x0]+t[y0*W1+x0]; const n=(x1-x0)*(y1-y0); const a=S(s.sa); return { cov:a/n, g:a>0?S(s.sg)/a:0 }; }
  // вид объекта: по курсу объекта и пеленгу на камеру; 5..7 — зеркало 3..1; без атласа — заглушка
  function viewFor(sp,o,u){ const vs=atlas&&atlas.views[sp.sheet]; if(!vs) return {s:null,mirror:false};
    if(sp.view!==undefined || vs.length<5) return {s:vs[Math.min(sp.view||0,vs.length-1)],mirror:false};
    const facing=o.facing!==undefined?o.facing:hash(o.id*7919,o.id*104729)*Math.PI*2; let a=Math.atan2(u.y-o.y,u.x-o.x)-facing; a=((a%(2*Math.PI))+2*Math.PI)%(2*Math.PI);
    const idx=Math.round(a/(Math.PI/4))%8; const k=idx<=4?idx:8-idx; return {s:vs[k],mirror:idx>4}; }
  function relAngle(a,b){ let d=a-b; while(d>Math.PI)d-=2*Math.PI; while(d<-Math.PI)d+=2*Math.PI; return d; }

  // ---- кадр ----
  // objs: [{id,type,x,y,facing?,Hs?,creature?,unit?}] — объекты мира (уже с подменой типа по состоянию) и декорации
  function render(u,size,objs){
    const big=renderRaw(u,size*2,objs); const out=new Uint8Array(size*size);
    for(let y=0;y<size;y++)for(let x=0;x<size;x++) out[y*size+x]=(big[(2*y)*size*2+2*x]+big[(2*y)*size*2+2*x+1]+big[(2*y+1)*size*2+2*x]+big[(2*y+1)*size*2+2*x+1])/4;
    for(let i=0;i<out.length;i++) out[i]=clamp(out[i]+(Math.random()-0.5)*8);   // шум матрицы
    return out; }
  function renderRaw(u,size,objs){
    const f=(size/2)/Math.tan(FOV/2*Math.PI/180); const hd=camHeading(u); const SUN=TER.SUN;
    const cU=TER.canyon(u.x,u.y); const inT=!!(cU && cU.d<cU.w/2+1 && cU.along>2); const light=u.lightOn&&u.charge>0;
    const eye=TER.H(u.x,u.y)+CAM_Z; const horizon=size/2;
    const img=new Uint8Array(size*size), depth=new Float32Array(size*size).fill(Infinity), gx=new Float32Array(size*size), gy=new Float32Array(size*size), floor=new Uint8Array(size*size);
    const lamp=(t,lam)=> (light? 1.0/(1+(t/8)**2)*(0.25+0.75*lam) : 0.8/(1+(t/1.0)**2)*(0.6+0.4*lam))+0.03;   // фонарь; без него — только ближний метр
    const fog=(v,t)=>v+(118-v)*Math.min(1,Math.pow(t/260,1.1));
    const maxT=inT?140:420; const scene=(x,y,z,lod)=>z-TER.H(x,y,lod);
    for(let y=0;y<size;y++)for(let x=0;x<size;x++){ const ax=hd+Math.atan((x-size/2+0.5)/f); const dzs=-(y-horizon)/f; const n3=Math.hypot(1,dzs);
      const dx=Math.cos(ax)/n3, dy=Math.sin(ax)/n3, dz=dzs/n3; let t=0.08, hit=false, px=0,py=0,pz=0, tp=0.08;
      for(let k=0;k<220&&t<maxT;k++){ px=u.x+dx*t; py=u.y+dy*t; pz=eye+dz*t; const lod=t>50?1:0; const d=scene(px,py,pz,lod); if(d<0.02*(1+t*0.02)){ hit=true; if(d<-0.05){ let lo=tp, hi=t; for(let b=0;b<7;b++){ const m=(lo+hi)/2; if(scene(u.x+dx*m,u.y+dy*m,eye+dz*m,lod)<0) hi=m; else lo=m; } t=hi; px=u.x+dx*t; py=u.y+dy*t; pz=eye+dz*t; } break; } tp=t; t+=Math.max(0.04, d*(t<40?(inT?0.35:0.5):0.75)); }
      const i=y*size+x; let v;
      if(!hit){ const elev=Math.atan(dzs); const m=TER.mountains(ax); floor[i]=0; const skyDark = inT? 0.35*ss(0.6,0.95,cU.along/TER.LEN) : 0;
        if(elev<m.near && elev>-0.03) v=96+6*ss(0,m.near,elev)+5*(vnoise(ax*60,1)-0.5); else if(elev<m.far && elev>-0.03) v=112+8*ss(0,m.far,elev)+3*(vnoise(ax*40,2)-0.5); else v=60+70*Math.min(1,Math.max(0,y/horizon)); v*=(1-skyDark); }
      else { const e=0.05+t*0.003, lod=t>50?1:0; const nx=scene(px+e,py,pz,lod)-scene(px-e,py,pz,lod), ny=scene(px,py+e,pz,lod)-scene(px,py-e,pz,lod), nz=scene(px,py,pz+e,lod)-scene(px,py,pz-e,lod); const nl=Math.hypot(nx,ny,nz)||1; const nzn=nz/nl;
        const c=TER.canyon(px,py); const inC = c && c.d<c.w/2+2.5 && c.along>-1; const isF=nzn>0.6;
        let sunK=1, skyK=1; if(inC){ const nx0=-c.dir.y, ny0=c.dir.x; const cxp=px-nx0*c.perp, cyp=py-ny0*c.perp; const wallH=Math.max(0,TER.ridgeH(cxp,cyp)-pz);   // глубина по оси коридора
          const ratio=wallH/Math.max(2,c.w); const deep=ss(0.55,0.95,c.along/TER.LEN); skyK=(1-ss(0.3,2.5,ratio)*0.82)*(1-0.5*deep); sunK=(1-ss(0.15,0.8,ratio))*(1-deep); sunK*=Math.max(0,Math.min(1,(4-c.along)/6+1)); }
        const tone = isF ? TER.groundTone(px,py,nzn,inC) : (inC ? TER.wallTone(px,py,pz) : (nzn<0.72 ? TER.rockTone(px,py,pz) : TER.groundTone(px,py,nzn,false)));
        const sunLam=Math.max(0,(nx*SUN.x+ny*SUN.y+nz*SUN.z)/nl); const camLam=Math.max(0,-(nx*dx+ny*dy+nz*dz)/nl);
        const I = 0.5*skyK + 0.5*sunLam*sunK + (inC ? lamp(t,camLam)*(1-skyK) : (light?0.12*lamp(t,camLam):0));
        v = fog(tone*I, t); floor[i]=isF?1:0; depth[i]=t/n3; gx[i]=px; gy[i]=py; }
      img[i]=clamp(v); }
    // ---- тени и декали по точкам земли ----
    const all=objs.map(o=>({...o,r:Math.hypot(o.x-u.x,o.y-u.y),rb:relAngle(Math.atan2(o.y-u.y,o.x-u.x),hd)})).filter(o=>SPRITES[o.type]);
    const solid=all.filter(o=>!SPRITES[o.type].flat && o.r<110); const shLen=inT?0:SUN.len; const Hof=(o)=>o.Hs||SPRITES[o.type].H;
    const casters=solid.filter(o=>o.r<60).map(o=>{ const Ho=Hof(o); const vs=viewFor(SPRITES[o.type],o,u).s; const w=Ho*(vs?vs.w/vs.h:0.6)/2; return {o,Ho,w,reach:w+Ho*1.3+1.5}; });
    const flats=all.filter(o=>SPRITES[o.type].flat && o.r<70 && TER.DECAL[o.type]).map(o=>{ const fx=o.facing!==undefined?o.facing:hash(o.id*7919,o.id*104729)*6.283; return {o,cs:Math.cos(fx),sn:Math.sin(fx),pat:TER.DECAL[o.type]}; });
    for(let i=0;i<size*size;i++){ if(depth[i]===Infinity||!floor[i]) continue; const px=gx[i], py=gy[i]; let dark=0, add=0;
      for(const {o,Ho,w,reach} of casters){ const ddx=px-o.x, ddy=py-o.y; if(Math.abs(ddx)>reach||Math.abs(ddy)>reach) continue; const d0=Math.hypot(ddx,ddy); if(d0>reach) continue;
        dark=Math.max(dark, 0.30*Math.max(0,1-d0/(w*0.75)));                                                          // контактная тень
        if(shLen){ const L=Math.min(Ho*shLen, Ho*1.3); const tt=Math.max(0,Math.min(L,ddx*SUN.shx+ddy*SUN.shy)); const dd=Math.hypot(ddx-SUN.shx*tt,ddy-SUN.shy*tt); const soft=w*(0.9+0.5*tt/L), edge=w*0.8;
          if(tt>w*0.3 && dd<soft+edge){ const k=Math.min(1,(soft+edge-dd)/edge); dark=Math.max(dark, 0.28*(1-0.75*tt/L)*k); } } }   // отбрасываемая: короткая, размытая
      for(const {o,cs,sn,pat} of flats){ const ddx=px-o.x, ddy=py-o.y; if(Math.abs(ddx)+Math.abs(ddy)>12) continue; const r=pat(ddx*cs+ddy*sn, -ddx*sn+ddy*cs); if(r) add+=r.d*r.a*(inT?0.6:1); }
      if(dark>0||add) img[i]=clamp(img[i]*(1-dark)+add); }
    // ---- спрайты: от ближних к дальним, тест глубины, усреднение по футпринту ----
    const fovR=FOV/2*Math.PI/180;
    for(const o of solid.filter(o=>Math.abs(o.rb)<fovR*1.4).sort((a,b)=>a.r-b.r)){ const sp=SPRITES[o.type]; const Ho=Hof(o); const rz=o.r*Math.cos(o.rb); if(rz<0.3) continue;
      const vf=viewFor(sp,o,u); const s=vf.s, mirror=vf.mirror; const aspect=s?s.w/s.h:0.6;
      const vx=(o.x-u.x)/o.r, vy=(o.y-u.y)/o.r; const along=vx*SUN.shx+vy*SUN.shy, side=vx*SUN.shy-vy*SUN.shx; const litFace=inT?1:0.92+0.22*along; const lit = inT ? lamp(o.r,1) : 1;
      const gz=TER.H(o.x,o.y); const yb=horizon - f*(gz-eye)/rz; const hpx=f*Ho/rz; const wpx=hpx*aspect;
      const sx=size/2+f*Math.tan(o.rb); const x0=Math.round(sx-wpx/2), x1=Math.round(sx+wpx/2), y0=Math.round(yb-hpx), y1=Math.round(yb);
      if(x1-x0<1&&y1-y0<1){ const xi=Math.round(sx), yi=Math.round(yb-0.5); if(xi>=0&&xi<size&&yi>=0&&yi<size&&o.r<depth[yi*size+xi]) img[yi*size+xi]=clamp(fog(70,o.r)*lit); continue; }
      for(let yy=Math.max(0,y0);yy<Math.min(size,y1);yy++) for(let xx=Math.max(0,x0);xx<Math.min(size,x1);xx++){ const i=yy*size+xx; if(o.r>=depth[i]) continue;
        let u0=(xx-x0)/(x1-x0), u1=(xx+1-x0)/(x1-x0); const v0=(yy-y0)/(y1-y0), v1=(yy+1-y0)/(y1-y0); if(mirror){ const t=u0; u0=1-u1; u1=1-t; }
        const A = s ? area(s, u0*s.w, v0*s.h, u1*s.w, v1*s.h) : {cov:1,g:90};   // без атласа — серый блок
        if(A.cov<0.02) continue; const uu=(xx+0.5-x0)/(x1-x0); const grad=inT?1:1+0.14*side*(1-2*uu); const g=(45+A.g*0.5)*litFace*grad; const v=inT?g*lit:fog(g,o.r);
        img[i]=clamp(img[i]*(1-A.cov)+v*A.cov); if(A.cov>0.5) depth[i]=o.r; } }
    return img; }

  return { load, build, render, get ready(){ return !!atlas; } };
})();

// КАРТА: слой высот с изогипсами и непроходимым — общий для редактора (editor.js) и спектатора (spectate.js). Инструменты, не игра:
// читают рельеф напрямую. heightmap(cv, o): рисует в cv (W×H px) поле высот TER.H в окне вида; o — {W, H, sc (px/м), iS, iSy
// (px → м), hm, iso, steep (слои), isoStep (м), MAX_SLOPE}. Стены (перепад больше 12 изогипс на клетку) изогипсами не рисуются.
const MAPDRAW = {
  heightmap(cv,o){ const {W,H,sc,iS,iSy,MAX_SLOPE}=o; const step=3, nx=Math.ceil(W/step)+2, ny=Math.ceil(H/step)+2, dm=step/sc, lod=sc>=8?0:1;
  const x0=iS(-step), y0=iSy(-step); const z=new Float32Array(nx*ny);
  for(let j=0;j<ny;j++)for(let i=0;i<nx;i++) z[j*nx+i]=TER.H(x0+i*dm,y0+j*dm,lod);
  const small=document.createElement('canvas'); small.width=nx; small.height=ny; const sctx=small.getContext('2d'); const id=sctx.createImageData(nx,ny), px=id.data; const SUN=TER.SUN;
  for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){ const k=j*nx+i; const zx=(z[k+(i<nx-1?1:0)]-z[k-(i>0?1:0)])/(dm*((i>0)+(i<nx-1))), zy=(z[k+(j<ny-1?nx:0)]-z[k-(j>0?nx:0)])/(dm*((j>0)+(j<ny-1)));
    let v=o.hm? 60+150*Math.max(0,Math.min(1,(z[k]+5)/42)) : 120; const nl=Math.hypot(zx,zy,1); const lam=(-zx*SUN.x-zy*SUN.y+SUN.z)/nl; v*=0.55+0.5*Math.max(0,lam);
    let r=v,g=v,b=v; if(o.steep && Math.hypot(zx,zy)>MAX_SLOPE){ r=v*0.5+110; g=v*0.5; b=v*0.5; } px[k*4]=r; px[k*4+1]=g; px[k*4+2]=b; px[k*4+3]=255; }
  sctx.putImageData(id,0,0); cv.width=W; cv.height=H; const c=cv.getContext('2d'); c.imageSmoothingEnabled=true; c.drawImage(small,-step,-step,nx*step,ny*step);
  if(o.iso){ const st=o.isoStep; const segs=[[],[]];   // [обычные, каждая пятая]
    for(let j=0;j<ny-1;j++)for(let i=0;i<nx-1;i++){ const a=z[j*nx+i], b=z[j*nx+i+1], cc=z[(j+1)*nx+i+1], d=z[(j+1)*nx+i]; const lo=Math.min(a,b,cc,d), hi=Math.max(a,b,cc,d); if(hi-lo>st*12) continue;   // стены: пачку изогипс не рисуем
      for(let L=Math.ceil(lo/st)*st; L<=hi; L+=st){ const idx=(a>=L?1:0)|(b>=L?2:0)|(cc>=L?4:0)|(d>=L?8:0); if(!idx||idx===15) continue;
        const X0=(i-1)*step, Y0=(j-1)*step, X1=X0+step, Y1=Y0+step; const top=[X0+step*(L-a)/((b-a)||1e-9),Y0], right=[X1,Y0+step*(L-b)/((cc-b)||1e-9)], bottom=[X0+step*(L-d)/((cc-d)||1e-9),Y1], left=[X0,Y0+step*(L-a)/((d-a)||1e-9)];
        const T={1:[left,top],2:[top,right],3:[left,right],4:[right,bottom],5:[left,top,right,bottom],6:[top,bottom],7:[left,bottom],8:[bottom,left],9:[top,bottom],10:[top,right,bottom,left],11:[right,bottom],12:[right,left],13:[top,right],14:[left,top]}[idx];
        const out=segs[Math.abs(L/(st*5)-Math.round(L/(st*5)))<1e-6?1:0]; for(let q=0;q<T.length;q+=2) out.push(T[q],T[q+1]); } }
    for(const [k,col,lw] of [[0,'rgba(255,255,255,0.22)',1],[1,'rgba(255,220,150,0.5)',1]]){ c.strokeStyle=col; c.lineWidth=lw; c.beginPath(); const s=segs[k]; for(let q=0;q<s.length;q+=2){ c.moveTo(s[q][0],s[q][1]); c.lineTo(s[q+1][0],s[q+1][1]); } c.stroke(); } }
  }
};

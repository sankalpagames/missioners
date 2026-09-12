// минимальный декодер PNG (8 бит, без интерлейса) → {w,h,gray,alpha}
const zlib=require('zlib');
function decodePNG(buf){
  let p=8, w,h,ct,bd; const idat=[]; let pal=null, trns=null;
  while(p<buf.length){ const len=buf.readUInt32BE(p); const t=buf.toString('ascii',p+4,p+8); const d=buf.subarray(p+8,p+8+len);
    if(t==='IHDR'){ w=d.readUInt32BE(0); h=d.readUInt32BE(4); bd=d[8]; ct=d[9]; if(d[12]) throw new Error('interlaced'); }
    else if(t==='IDAT') idat.push(d); else if(t==='PLTE') pal=d; else if(t==='tRNS') trns=d; p+=12+len; }
  if(bd!==8) throw new Error('bitdepth '+bd);
  const ch={0:1,2:3,3:1,4:2,6:4}[ct]; const raw=zlib.inflateSync(Buffer.concat(idat)); const stride=w*ch; const out=Buffer.alloc(h*stride);
  for(let y=0;y<h;y++){ const f=raw[y*(stride+1)]; const src=y*(stride+1)+1, dst=y*stride;
    for(let i=0;i<stride;i++){ const a=i>=ch?out[dst+i-ch]:0, b=y>0?out[dst-stride+i]:0, c=(y>0&&i>=ch)?out[dst-stride+i-ch]:0; let v=raw[src+i];
      if(f===1) v+=a; else if(f===2) v+=b; else if(f===3) v+=(a+b)>>1; else if(f===4){ const pp=a+b-c, pa=Math.abs(pp-a), pb=Math.abs(pp-b), pc=Math.abs(pp-c); v+=(pa<=pb&&pa<=pc)?a:(pb<=pc?b:c); }
      out[dst+i]=v&255; } }
  const gray=new Uint8Array(w*h), alpha=new Uint8Array(w*h);
  for(let i=0;i<w*h;i++){ let r,g,b,a=255; const o=i*ch;
    if(ct===0){ r=g=b=out[o]; } else if(ct===2){ r=out[o];g=out[o+1];b=out[o+2]; } else if(ct===3){ const k=out[o]; r=pal[k*3];g=pal[k*3+1];b=pal[k*3+2]; if(trns&&k<trns.length) a=trns[k]; }
    else if(ct===4){ r=g=b=out[o]; a=out[o+1]; } else { r=out[o];g=out[o+1];b=out[o+2];a=out[o+3]; }
    gray[i]=Math.round(0.299*r+0.587*g+0.114*b); alpha[i]=a; }
  return {w,h,gray,alpha};
}
module.exports={decodePNG};

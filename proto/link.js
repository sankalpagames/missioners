// КАНАЛ. Единственный путь из мира в консоль.
// Плечо 1 (локальное): миссионер ↔ станция — радио, честная физика по каждому миссионеру.
// Плечо 2 (дальнее): станция ↔ оператор — FTL, фиксированная узкая полоса, расстояние не влияет.
// Станция буферизует: пакет уходит оператору, когда прошёл ОБА плеча.

const HDR = 8;      // msgId(2) kind(1) unit(1) seq(2) total(2)
const PAYLOAD = 64;

function erfc(x){ const z=Math.abs(x), t=1/(1+0.5*z);
  const r=t*Math.exp(-z*z-1.26551223+t*(1.00002368+t*(0.37409196+t*(0.09678418+t*(-0.18628806+t*(0.27886807+t*(-1.13520398+t*(1.48851587+t*(-0.82215223+t*0.17087277)))))))));
  return x>=0?r:2-r; }

class Link {
  constructor(){
    this.cfg = {
      bwHz: 4000, freqMHz: 430, noiseDbm: -92, misGainDbi: -5, stGainDbi: 6, effic: 0.5, cutoffDb: -5,
      fec: true, arq: true, rtt: 0.6,
      deepCapBps: 512, deepBer: 1e-7,
      orbit: false, orbitPeriod: 420, orbitVisible: 300, orbitPhase0: 20,
    };
    this.phys = { units:{}, extraGain:0 };
    this.t = 0; this.deepBudget = 0; this.localBudget = {}; this.secBg = 0;
    this.queues = { bg:{}, cmd:[] };   // bg: по одному свежему сообщению на источник и вид
    this.retry = [];
    this.stats = { sec:this.blankSec(), hist:[], dropped:0, delivered:0, retrans:0 };
    this._secAcc = 0; this.uplinkPending = [];
    this.onDeliver=()=>{}; this.onDrop=()=>{}; this.onUplink=()=>{}; this.onFrame=()=>{};
  }
  blankSec(){ return {TLM:0,HB:0,SONAR:0,DESC:0,IMG:0,EVT:0,drop:0,cap:0}; }
  kindOf(k){ return /^IM[GD]/.test(k)?'IMG':k; }
  reset(){ this.queues={bg:{},cmd:[]}; this.retry=[]; this.uplinkPending=[]; this.deepBudget=0; this.localBudget={}; }
  setPhys(p){ this.phys.extraGain=p.extraGain; for(const u of p.units) this.phys.units[u.id]=u; }

  // --- локальное плечо, по миссионеру ---
  fsplDb(id){ const u=this.phys.units[id]; return u? 20*Math.log10(u.dist)+20*Math.log10(this.cfg.freqMHz)-27.55 : 999; }
  snrDb(id){ const u=this.phys.units[id]; if(!u) return -99; const c=this.cfg; return u.txDbm+c.misGainDbi+c.stGainDbi+this.phys.extraGain-this.fsplDb(id)-u.obstDb-c.noiseDbm; }
  localCapBps(id){ const s=this.snrDb(id); if(s<this.cfg.cutoffDb) return 0; let C=this.cfg.bwHz*Math.log2(1+Math.pow(10,s/10))*this.cfg.effic; if(this.cfg.fec) C*=0.5; return C; }
  ber(id){ const s=this.snrDb(id)+(this.cfg.fec?5:0); return 0.5*erfc(Math.sqrt(Math.max(0,Math.pow(10,s/10)))); }
  per(id,bytes){ const b = id? this.ber(id) : this.cfg.deepBer; return 1-Math.pow(1-b,bytes*8); }
  carrier(id){ return this.phys.units[id] ? this.localCapBps(id)>0 : true; }
  // --- дальнее плечо ---
  orbit(){ const c=this.cfg; if(!c.orbit) return {vis:true,elev:1,tLeft:Infinity}; const ph=(this.t+c.orbitPhase0)%c.orbitPeriod; const vis=ph<c.orbitVisible; const elev=vis?Math.sin(Math.PI*ph/c.orbitVisible):0; return {vis,elev,tLeft:vis?c.orbitVisible-ph:c.orbitPeriod-ph}; }
  deepCapBps(){ const o=this.orbit(); if(!o.vis||o.elev<0.12) return 0; return this.cfg.deepCapBps*(this.cfg.orbit?(0.55+0.45*o.elev):1); }
  up(){ return this.deepCapBps()>0; }
  capBps(id){ return Math.min(this.deepCapBps(), id?this.localCapBps(id):Infinity); }

  // --- пакетизация ---
  enqueue(msg){
    const total=Math.ceil(msg.payload.length/PAYLOAD)||1, pkts=[];
    for(let i=0;i<total;i++){ const bytes=msg.payload.slice(i*PAYLOAD,(i+1)*PAYLOAD); pkts.push({msgId:msg.id,kind:msg.kind,unit:msg.unit,seq:i,total,bytes,cls:msg.cls,size:bytes.length+HDR,tries:0,born:this.t}); }
    if(msg.cls==='bg'){
      const key=msg.unit+':'+msg.kind, pending=this.queues.bg[key];
      if(/^IM[GD]/.test(msg.kind) && pending && pending.length){   // кадр ещё уходит — новый не принимаем: канал не успевает за интервалом
        this.stats.dropped+=pkts.length; this.onDrop({msgId:msg.id,kind:msg.kind,unit:msg.unit,reason:'кадр пропущен: предыдущий ещё передаётся'}); this.onFrame(msg,false); return; }
      this.queues.bg[key]=pkts;                                   // свежий фон вытесняет старый того же вида
      if(/^IM[GD]/.test(msg.kind)) this.onFrame(msg,true);
    }
    else this.queues.cmd.push(...pkts);
  }
  queueBytes(cls){ if(cls==='bg') return Object.values(this.queues.bg).flat().reduce((a,p)=>a+p.size,0); return (this.queues[cls]||[]).reduce((a,p)=>a+p.size,0); }
  sendUplink(bytes){ if(!this.up()) return false; this.uplinkPending.push({bytes,at:this.t+this.cfg.rtt/2}); return true; }

  // --- планировщик ---
  canSend(p){ if(this.deepBudget<p.size) return false; if(!p.unit) return true; return this.localCapBps(p.unit)>0 && (this.localBudget[p.unit]||0)>=p.size; }
  spend(p){ this.deepBudget-=p.size; if(p.unit) this.localBudget[p.unit]-=p.size; }
  tick(dt){
    this.t+=dt;
    // token bucket: ёмкость не копится, пока канал молчит; но ведро должно вмещать хотя бы два пакета, иначе большой пакет не уйдёт никогда
    const BUCKET=c=>Math.max(c*0.3/8, 2*(PAYLOAD+HDR));
    const dcap=this.deepCapBps(); this.deepBudget=Math.min(this.deepBudget+dcap*dt/8, BUCKET(dcap)); if(!dcap) this.deepBudget=0;
    for(const id in this.phys.units){ const c=this.localCapBps(+id); this.localBudget[id]=Math.min((this.localBudget[id]||0)+c*dt/8, BUCKET(c)); if(!c) this.localBudget[id]=0; }
    for(let i=this.retry.length-1;i>=0;i--) if(this.retry[i].at<=this.t){ this.queues.cmd.unshift(this.retry[i].pkt); this.retry.splice(i,1); }
    while(this.uplinkPending.length && this.uplinkPending[0].at<=this.t) this.onUplink(this.uplinkPending.shift().bytes);

    let guard=0;
    while(guard++<300){
      let pick=null, q=null;
      // 1) пульс станции — всегда (крошечный резерв); 2) фон миссионеров — если нет потока
      // 1) фон (подписки) — раньше команд, но не больше 60 % полосы в секунду: команды не голодают;
      // 2) команды в порядке очереди, минуя те, чей миссионер вне зоны
      const bgAllowed = this.secBg < 0.6*dcap/8 || !this.queues.cmd.length;
      if(bgAllowed) for(const key in this.queues.bg){ const arr=this.queues.bg[key]; if(!arr.length) continue; if(this.canSend(arr[0])){ pick=arr[0]; q=arr; break; } }
      if(!pick){ const arr=this.queues.cmd;   // по порядку; пропускаем только пакеты миссионеров вне зоны, а не «маленькие, которые влезли»
        for(const p of arr){ if(this.deepBudget<p.size) break; if(p.unit && !(this.localCapBps(p.unit)>0 && (this.localBudget[p.unit]||0)>=p.size)) continue; pick=p; q=arr; break; } }
      if(!pick) break;
      q.splice(q.indexOf(pick),1); this.spend(pick); pick.tries++; if(pick.cls==='bg') this.secBg+=pick.size;
      this.stats.sec[this.kindOf(pick.kind)]+=pick.size;
      if(Math.random()<this.per(pick.unit,pick.size)){
        this.stats.sec.drop+=pick.size;
        if(pick.cls==='cmd'&&this.cfg.arq&&pick.tries<6){ this.stats.retrans++; this.retry.push({pkt:pick,at:this.t+this.cfg.rtt}); this.onDrop({...pick,reason:'CRC, повтор через '+this.cfg.rtt+' с'}); }
        else { this.stats.dropped++; this.onDrop({...pick,reason:'CRC, потерян'}); }
      } else { this.stats.delivered++; this.onDeliver({...pick,latency:this.t-pick.born}); }
    }
    this._secAcc+=dt;
    if(this._secAcc>=1){ this._secAcc-=1; this.secBg=0; this.stats.sec.cap=dcap/8; this.stats.hist.push({...this.stats.sec}); if(this.stats.hist.length>90) this.stats.hist.shift(); this.stats.sec=this.blankSec(); }
  }
  etaFor(msgId){ const cap=this.deepCapBps()/8; if(!cap) return Infinity; let last=-1; this.queues.cmd.forEach((p,i)=>{ if(p.msgId===msgId) last=i; }); if(last<0) return 0; let b=this.queueBytes('bg'); for(let i=0;i<=last;i++) b+=this.queues.cmd[i].size; return b/cap; }
}

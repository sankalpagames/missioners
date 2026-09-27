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
    this.phys = { units:{} };   // по телу: dist — до лучшего узла станции (сама станция или ретранслятор), obstDb, gain — усиление антенны узла, txDbm
    this.t = 0; this.deepBudget = 0; this.localBudget = {}; this.rr = {};
    this.queues = { bg:{}, cmd:[] };   // bg: по одному свежему сообщению на источник и вид
    this.retry = [];
    this.stats = { sec:this.blankSec(), hist:[], dropped:0, delivered:0, retrans:0 };
    this._secAcc = 0; this.uplinkPending = [];
    this.onDeliver=()=>{}; this.onDrop=()=>{}; this.onUplink=()=>{}; this.onFrame=()=>{};
  }
  blankSec(){ return {TLM:0,HB:0,SONAR:0,DESC:0,IMG:0,EVT:0,EXAM:0,ACT:0,INFO:0,CONT:0,drop:0,cap:0}; }
  kindOf(k){ return /^IM[GD]/.test(k)?'IMG':k; }
  reset(){ this.queues={bg:{},cmd:[]}; this.retry=[]; this.uplinkPending=[]; this.deepBudget=0; this.localBudget={}; }
  setPhys(p){ for(const u of p.units) this.phys.units[u.id]=u; }

  // --- локальное плечо, по миссионеру ---
  fsplDb(id){ const u=this.phys.units[id]; return u? 20*Math.log10(u.dist)+20*Math.log10(this.cfg.freqMHz)-27.55 : 999; }
  snrDb(id){ const u=this.phys.units[id]; if(!u) return -99; const c=this.cfg; return u.txDbm+c.misGainDbi+c.stGainDbi+(u.gain||0)-this.fsplDb(id)-u.obstDb-c.noiseDbm; }
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
    for(let i=0;i<total;i++){ const bytes=msg.payload.slice(i*PAYLOAD,(i+1)*PAYLOAD); pkts.push({msgId:msg.id,kind:msg.kind,unit:msg.unit,seq:i,total,bytes,cls:msg.cls,after:!!msg.after,size:bytes.length+HDR,tries:0,born:this.t}); }
    if(msg.cls==='bg'){
      const key=msg.unit+':'+msg.kind, pending=this.queues.bg[key];
      if(/^IM[GD]/.test(msg.kind) && pending && pending.length){   // кадр ещё уходит — новый не принимаем: канал не успевает за интервалом
        this.stats.dropped+=pkts.length; this.onDrop({msgId:msg.id,kind:msg.kind,unit:msg.unit,reason:'кадр пропущен: предыдущий ещё передаётся'}); this.onFrame(msg,false); return; }
      this.queues.bg[key]=pkts;                                   // свежий фон вытесняет старый того же вида
      if(/^IM[GD]/.test(msg.kind)) this.onFrame(msg,true);
    }
    else this.queues.cmd.push(...pkts);
  }
  // отмена запроса: станция выбрасывает из буфера все пакеты сообщения, включая повторы; ушедшие байты не вернуть
  cancel(msgId){ let n=0, kind=null, unit=0; const drop=p=>{ if(p.msgId!==msgId) return false; n+=p.size; kind=p.kind; unit=p.unit; return true; };
    this.queues.cmd=this.queues.cmd.filter(p=>!drop(p)); this.retry=this.retry.filter(r=>!drop(r.pkt));
    for(const k in this.queues.bg){ this.queues.bg[k]=this.queues.bg[k].filter(p=>!drop(p)); if(!this.queues.bg[k].length) delete this.queues.bg[k]; }
    return n?{bytes:n,kind,unit}:null; }
  queueBytes(cls){ if(cls==='bg') return Object.values(this.queues.bg).flat().reduce((a,p)=>a+p.size,0); return (this.queues[cls]||[]).reduce((a,p)=>a+p.size,0); }
  sendUplink(bytes){ if(!this.up()) return false; this.uplinkPending.push({bytes,at:this.t+this.cfg.rtt/2}); return true; }

  // --- планировщик ---
  // Лестница (tech.md §3): на каждый пакет — верхняя ступень, где есть что отправить. Квот нет: пакеты ≤ 64 Б, срочное вклинивается между
  // пакетами большого, большое идёт остатком полосы. 1 события · 2 сводка станции · 3 ответы на запросы, кроме кадров · 4 телеметрия ·
  // 5 прочие подписки (описание, лидар по интервалу) · 6 кадры по запросу · 7 автосъёмка. Событие-следствие ответа (after: «задача закрыта» по прочитанной записи) — на ступени 3, за ответом
  tier(p){ const img=/^IM[GD]/.test(p.kind); if(p.kind==='EVT') return p.after?3:1; if(p.kind==='HB') return 2; if(p.cls==='cmd') return img?6:3; if(p.kind==='TLM') return 4; return img?7:5; }
  // внутри ступени ответы — по порядку очереди, подписки — по кругу между «тело:вид»; пакет тела вне связи не задерживает остальных
  pickNext(){ const local=p=>!p.unit || (this.localCapBps(p.unit)>0 && (this.localBudget[p.unit]||0)>=p.size);
    const keys=Object.keys(this.queues.bg).filter(k=>this.queues.bg[k].length).sort();
    for(let s=1;s<=7;s++){
      const c=this.queues.cmd.find(p=>this.tier(p)===s && local(p)); if(c) return {p:c, q:this.queues.cmd, s};
      const ks=keys.filter(k=>{ const h=this.queues.bg[k][0]; return this.tier(h)===s && local(h); }); if(!ks.length) continue;
      const last=this.rr[s], key=ks.find(k=>last===undefined||k>last)||ks[0]; return {p:this.queues.bg[key][0], q:this.queues.bg[key], s, key}; }
    return null; }
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
      const n=this.pickNext(); if(!n) break;
      const pick=n.p; if(this.deepBudget<pick.size) break;   // ждём бюджета на верхний пакет, а не обгоняем его мелкими снизу
      n.q.splice(n.q.indexOf(pick),1); this.spend(pick); pick.tries++; if(n.key) this.rr[n.s]=n.key;
      this.stats.sec[this.kindOf(pick.kind)]+=pick.size;
      if(Math.random()<this.per(pick.unit,pick.size)){
        this.stats.sec.drop+=pick.size;
        if(pick.cls==='cmd'&&this.cfg.arq&&pick.tries<6){ this.stats.retrans++; this.retry.push({pkt:pick,at:this.t+this.cfg.rtt}); this.onDrop({...pick,reason:'CRC, повтор через '+this.cfg.rtt+' с'}); }
        else { this.stats.dropped++; this.onDrop({...pick,reason:'CRC, потерян'}); }
      } else { this.stats.delivered++; this.onDeliver({...pick,latency:this.t-pick.born}); }
    }
    this._secAcc+=dt;
    if(this._secAcc>=1){ this._secAcc-=1; this.stats.sec.cap=dcap/8; this.stats.hist.push({...this.stats.sec}); if(this.stats.hist.length>90) this.stats.hist.shift(); this.stats.sec=this.blankSec(); }
  }
  // сколько ждать ответа: всё, что сейчас в очереди на ступенях выше, и его ступень до последнего пакета включительно (новые подписки не в счёт)
  etaFor(msgId){ const cap=this.deepCapBps()/8; if(!cap) return Infinity; const Q=this.queues.cmd; let last=-1; Q.forEach((p,i)=>{ if(p.msgId===msgId) last=i; }); if(last<0) return 0;
    const s=this.tier(Q[last]); let b=0; Q.forEach((p,i)=>{ const t=this.tier(p); if(t<s||(t===s&&i<=last)) b+=p.size; });
    for(const arr of Object.values(this.queues.bg)) for(const p of arr) if(this.tier(p)<s) b+=p.size; return b/cap; }
}

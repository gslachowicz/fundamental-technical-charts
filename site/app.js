/* Ink Charts — screener + O'Neil-style chart. Reads static JSON from ./data/ */
(() => {
"use strict";
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const DATA = "data/";
const C = {ink:"#15171c", ink2:"#5a5d66", grid:"#b9b9b4", down:"#c2185b", ma50:"#d23a2a", ma200:"#15171c", ema:"#86b97f",
  blue:"#2340a0", navy:"#1f3c6e", idx:"#2b2d33", plate:"#ffffff", vavg:"#e07b1f", piv:"#3c8a3a", zone:"rgba(47,125,50,.10)"};
const FONT_D = '"Courier Prime", "Courier New", monospace', FONT_L = '"Archivo Narrow", "Arial Narrow", Arial, sans-serif';

const store = {
  get(k){ try{ const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; }catch(e){ return null; } },
  set(k,v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
};
async function getJSON(path){ const r = await fetch(DATA + path, {cache:"no-cache"}); if(!r.ok) throw new Error(r.status+" "+path); return r.json(); }

/* ---------- formatting ---------- */
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const nf2 = new Intl.NumberFormat("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
const fmtP = v => v==null||!isFinite(v) ? "—" : v>=1000 ? Math.round(v).toLocaleString("en-US") : nf2.format(v);
const fmtV = v => !isFinite(v) ? "—" : v>=1e9 ? (v/1e9).toFixed(2)+"B" : v>=1e6 ? (v/1e6).toFixed(v>=1e8?0:1)+"M" : v>=1e3 ? (v/1e3).toFixed(0)+"K" : String(Math.round(v));
const fmtPct = (v,d=1) => v==null||!isFinite(v) ? "—" : (v>0?"+":"")+v.toFixed(d)+"%";
const fmtD = t => { const d=new Date(t); return String(d.getUTCDate()).padStart(2,"0")+"-"+MON[d.getUTCMonth()]+"-"+String(d.getUTCFullYear()).slice(2); };
const fmtLong = t => { const d=new Date(t); return MON[d.getUTCMonth()]+" "+d.getUTCDate()+", "+d.getUTCFullYear(); };
const esc = s => String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const sign = v => /^\s*-/.test(v||"") ? "neg" : /^\s*\+/.test(v||"") ? "pos" : "";
const iso = s => { const [y,m,d] = s.split("-").map(Number); return Date.UTC(y,m-1,d); };
const pnum = s => { const v = parseFloat(String(s||"").replace(/[+%,]/g,"")); return isFinite(v)?v:null; };
function toast(msg){ const t=$("#toast"); t.textContent=msg; t.hidden=false; clearTimeout(toast.h); toast.h=setTimeout(()=>t.hidden=true, 4000); }

const STATUS_CLASS = {"Breakout":"s-breakout","In buy zone":"s-buy","Near pivot":"s-near","Extended":"s-ext","Below pivot":"s-below","Correcting":"s-corr","Failed breakout":"s-fail"};
const MKT_CLASS = {"Uptrend":"st-up","Uptrend under pressure":"st-press","Correction":"st-corr"};

/* ---------- app state ---------- */
let META=null, ROWS=[], BENCH=null, order=[];
const scrState = { key: store.get("ink:sortKey") || "rsRating", asc: !!store.get("ink:sortAsc"), filter: "all" };

/* ================= SCREENER ================= */
function rowVal(r, k){
  switch(k){
    case "grp": { const m=String(r.groupRank||"").match(/^(\d+)/); return m? +m[1] : null; }
    case "eps": return pnum(r.epsChg);
    case "sales": return pnum(r.salesChg);
    case "baseType": return r.base? r.base.type : null;
    case "pivot": return r.base? r.base.pivot : null;
    case "distPct": return r.base? r.base.distPct : null;
    case "status": return r.base? r.base.status : null;
    default: return r[k];
  }
}
function filtered(){
  const f = scrState.filter;
  return ROWS.filter(r => {
    const st = r.base && r.base.status;
    if(f==="setup") return st==="Breakout" || st==="In buy zone";
    if(f==="near") return st==="Near pivot" || st==="In buy zone" || st==="Breakout";
    if(f==="rs80") return (r.rsRating||0) >= 80;
    if(f==="trend") return (r.vs50Pct??-1) > 0;
    return true;
  });
}
function sparkline(cv, data){
  const dpr = window.devicePixelRatio||1, W=110, H=28; cv.width=W*dpr; cv.height=H*dpr;
  const g = cv.getContext("2d"); g.setTransform(dpr,0,0,dpr,0,0);
  if(!data || data.length<2) return;
  const lo=Math.min(...data), hi=Math.max(...data); const y=v=> H-3 - (v-lo)/((hi-lo)||1)*(H-6);
  g.strokeStyle = data[data.length-1] >= data[0] ? C.ink : C.down; g.lineWidth=1.2; g.beginPath();
  data.forEach((v,i)=>{ const x=1+i/(data.length-1)*(W-6); i? g.lineTo(x,y(v)) : g.moveTo(x,y(v)); }); g.stroke();
  g.fillStyle=g.strokeStyle; g.beginPath(); g.arc(W-5, y(data[data.length-1]), 2.2, 0, 7); g.fill();
}
function renderScreener(){
  const rows = filtered();
  const k = scrState.key, dir = scrState.asc ? 1 : -1;
  rows.sort((a,b)=>{ const x=rowVal(a,k), y=rowVal(b,k);
    if(x==null && y==null) return 0; if(x==null) return 1; if(y==null) return -1;
    return (typeof x==="string" ? x.localeCompare(y) : x-y) * dir; });
  order = rows.map(r=>r.symbol);
  $$("#scr th[data-k]").forEach(th=>{ th.classList.toggle("sorted", th.dataset.k===k); th.classList.toggle("asc", th.dataset.k===k && scrState.asc); th.tabIndex=0; });
  const tb = $("#scr tbody");
  tb.innerHTML = rows.map(r => {
    const b = r.base || {};
    const rs = r.rsRating; const stc = STATUS_CLASS[b.status] || "";
    return `<tr data-s="${esc(r.symbol)}" tabindex="0">
      <td class="l"><span class="sym">${esc(r.symbol)}</span>${r.stale?' <span class="stale">stale</span>':''}<span class="nm" title="${esc(r.name)}">${esc(r.name)}</span></td>
      <td class="spk"><canvas data-spark="${esc(r.symbol)}"></canvas></td>
      <td>${fmtP(r.close)}</td>
      <td class="${r.chgPct<0?'neg':''}">${fmtPct(r.chgPct,2)}</td>
      <td><span class="rsv ${rs>=80?'hot':''}">${rs??"—"}</span></td>
      <td title="${esc(r.group)}">${esc(r.groupRank||"—")}</td>
      <td class="${sign(r.epsChg)}">${esc(r.epsChg||"—")}</td>
      <td class="${sign(r.salesChg)}">${esc(r.salesChg||"—")}</td>
      <td class="${(r.offHighPct??0)<-15?'neg':''}">${fmtPct(r.offHighPct)}</td>
      <td class="${(r.vs50Pct??0)<0?'neg':''}">${fmtPct(r.vs50Pct)}</td>
      <td class="${(r.volVsAvgPct??0)<0?'':'pos'}">${fmtPct(r.volVsAvgPct,0)}</td>
      <td class="${(r.udRatio??1)<1?'neg':''}">${r.udRatio==null?"—":r.udRatio.toFixed(2)}</td>
      <td class="l">${b.type?`${esc(b.type)}<span class="nm">${b.weeks} wks · ${b.depthPct}% deep</span>`:"—"}</td>
      <td>${b.pivot?fmtP(b.pivot):"—"}</td>
      <td class="${(b.distPct??0)<0?'neg':''}">${b.pivot?fmtPct(b.distPct):"—"}</td>
      <td class="l">${b.status?`<span class="chip ${stc}">${esc(b.status)}</span>`:"—"}</td>
    </tr>`; }).join("") || `<tr><td colspan="16" class="l" style="padding:18px">No tickers match this filter.</td></tr>`;
  $$("canvas[data-spark]").forEach(cv=>{ const r = ROWS.find(x=>x.symbol===cv.dataset.spark); sparkline(cv, r && r.spark); });
  $("#count").textContent = `${rows.length} of ${ROWS.length} tickers`;
}
function renderPulse(){
  const el = $("#pulse");
  if(!META || !META.market || !META.market.length){ el.innerHTML=""; return; }
  el.innerHTML = META.market.map(m => `<div class="pcard">
      <div class="top"><span class="nm">${esc(m.name)}</span><span class="px">${fmtP(m.close)}</span><span class="${m.chgPct<0?'neg':''}" style="font-family:var(--f-data)">${fmtPct(m.chgPct,2)}</span>
        <span class="sp"></span><span class="chip ${MKT_CLASS[m.status]||''}">${esc(m.status)}</span></div>
      <div class="flags"><span class="flag ${m.above21?'ok':'no'}">${m.above21?'Above':'Below'} 21-day</span><span class="flag ${m.above50?'ok':'no'}">${m.above50?'Above':'Below'} 50-day</span><span class="flag ${m.above200?'ok':'no'}">${m.above200?'Above':'Below'} 200-day</span></div>
      <div class="dd" title="Distribution days in the last 25 sessions: index down 0.2% or more on higher volume">${Array.from({length:8},(_,i)=>`<i class="${i<m.distDays?'on':''}"></i>`).join("")}<span>${m.distDays} distribution day${m.distDays===1?'':'s'} (25 sessions)</span></div>
    </div>`).join("");
}
$$("#scr th[data-k]").forEach(th=>{
  const go = ()=>{ const k=th.dataset.k; if(scrState.key===k) scrState.asc=!scrState.asc; else { scrState.key=k; scrState.asc = ["symbol","baseType","status","grp","distPct"].includes(k) ? true : false; }
    store.set("ink:sortKey",scrState.key); store.set("ink:sortAsc",scrState.asc); renderScreener(); };
  th.addEventListener("click", go); th.addEventListener("keydown", e=>{ if(e.key==="Enter") go(); });
});
$$("#filters button").forEach(b=>b.onclick=()=>{ scrState.filter=b.dataset.f; $$("#filters button").forEach(x=>x.classList.toggle("on",x===b)); renderScreener(); });
$("#scr tbody").addEventListener("click", e=>{ const tr=e.target.closest("tr[data-s]"); if(tr) location.hash = tr.dataset.s; });
$("#scr tbody").addEventListener("keydown", e=>{ const tr=e.target.closest("tr[data-s]"); if(tr && e.key==="Enter") location.hash = tr.dataset.s; });
$("#jump").addEventListener("change", e=>{ const v=e.target.value.trim().toUpperCase(); if(!v) return; e.target.value="";
  if(ROWS.some(r=>r.symbol===v)) location.hash = v; else toast(`${v} is not in the watchlist. Add it to watchlist.txt and it will appear after the next update.`); });

/* ================= CHART ================= */
let S = null;               // current ticker bundle
let view = { weekly:false, months:18, box:true, piv:true, base:true };
let tool = null, geo = null, hover = -1, drag = null, pendingNote = null;
const cv = $("#cv"), ctx = cv.getContext("2d");
const marksKey = sym => "ink:marks:"+sym;

function toWeekly(px){
  const out=[]; let cur=null, key=null;
  for(const b of px){ const d=new Date(b.t); const wd=(d.getUTCDay()+6)%7; const k=b.t-wd*864e5;
    if(k!==key){ if(cur) out.push(cur); key=k; cur={...b}; }
    else { cur.t=b.t; cur.h=Math.max(cur.h,b.h); cur.l=Math.min(cur.l,b.l); cur.c=b.c; cur.v+=b.v; } }
  if(cur) out.push(cur); return out;
}
function sma(arr, n, f){ const out=new Array(arr.length).fill(null); let s=0;
  for(let i=0;i<arr.length;i++){ s+=f(arr[i]); if(i>=n) s-=f(arr[i-n]); if(i>=n-1) out[i]=s/n; } return out; }
function ema(arr, n, f){ const out=new Array(arr.length).fill(null); const k=2/(n+1); let e=null;
  for(let i=0;i<arr.length;i++){ const v=f(arr[i]); e = e==null ? v : v*k + e*(1-k); if(i>=n-1) out[i]=e; } return out; }
function alignBench(px){
  if(!BENCH) return null; const out=[]; let j=0, last=null;
  for(const b of px){ while(j<BENCH.length && BENCH[j].t<=b.t){ last=BENCH[j].c; j++; } out.push(last); }
  return out;
}
function zigzag(base, th){
  const piv=[]; if(base.length<3) return piv; let hiI=0, loI=0, trend=0;
  for(let i=1;i<base.length;i++){ const b=base[i];
    if(trend===0){ if(b.h>base[hiI].h) hiI=i; if(b.l<base[loI].l) loI=i;
      if(hiI>loI && base[hiI].h>=base[loI].l*(1+th)){ piv.push({i:loI,p:base[loI].l,hi:false}); trend=1; }
      else if(loI>hiI && base[loI].l<=base[hiI].h*(1-th)){ piv.push({i:hiI,p:base[hiI].h,hi:true}); trend=-1; }
      continue; }
    if(trend===1){ if(b.h>=base[hiI].h) hiI=i; else if(b.l<=base[hiI].h*(1-th)){ piv.push({i:hiI,p:base[hiI].h,hi:true}); trend=-1; loI=i; } }
    else { if(b.l<=base[loI].l) loI=i; else if(b.h>=base[loI].l*(1+th)){ piv.push({i:loI,p:base[loI].l,hi:false}); trend=1; hiI=i; } }
  }
  const lastI = trend===1? hiI : loI; if(trend!==0 && lastI < base.length-1) piv.push({i:lastI, p: trend===1? base[hiI].h : base[loI].l, hi: trend===1});
  return piv;
}
function qEnd(label){
  const s = String(label||"").trim(); let m; const MI = {jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};
  if((m = s.match(/([1-4])\s*Q\s*'?(\d{2,4})/i) || s.match(/Q\s*([1-4])\s*[-\s'\/]*(\d{2,4})/i))){ let y=+m[2]; if(y<100)y+=2000; return Date.UTC(y,(+m[1])*3,0); }
  if((m = s.match(/([A-Za-z]{3})[a-z]*\.?[\s\-'\/]*(\d{2,4})/)) && MI[m[1].toLowerCase()]!=null){ let y=+m[2]; if(y<100)y+=2000; return Date.UTC(y,MI[m[1].toLowerCase()]+1,0); }
  return null;
}
function logTicks(lo, hi, pxH){
  const out=[]; const pxPerLog = pxH/(Math.log(hi)-Math.log(lo)); let v = lo;
  while(v < hi && out.length<80){
    const want = Math.exp(Math.log(v) + 17/pxPerLog) - v; const mag = Math.pow(10, Math.floor(Math.log10(want))); let step = mag;
    for(const m of [1,2,2.5,5,10]){ if(m*mag>=want){ step=m*mag; break; } }
    const nv = Math.ceil((v+1e-9)/step)*step; if(nv<=hi) out.push(+nv.toFixed(6)); v = nv + step*0.001;
  }
  return out;
}
function series(){
  const base = view.weekly ? toWeekly(S.px) : S.px;
  const ma1 = sma(base, view.weekly?10:50, b=>b.c), ma2 = sma(base, view.weekly?40:200, b=>b.c);
  const e21 = view.weekly ? null : ema(base, 21, b=>b.c);
  const vma = sma(base, view.weekly?10:50, b=>b.v);
  const bA = alignBench(base);
  const rs = bA ? base.map((b,i)=> bA[i] ? b.c/bA[i] : null) : null;
  const nVis = Math.min(base.length, Math.round(view.months*(view.weekly?4.33:21)));
  return {base, ma1, ma2, e21, vma, bA, rs, s0: base.length - nVis};
}

function draw(){
  const dpr = window.devicePixelRatio||1; const W = cv.clientWidth, H = cv.clientHeight;
  if(!W || !H) return;
  if(cv.width!==Math.round(W*dpr) || cv.height!==Math.round(H*dpr)){ cv.width=Math.round(W*dpr); cv.height=Math.round(H*dpr); }
  ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,W,H);
  ctx.fillStyle = C.plate; ctx.fillRect(0,0,W,H);
  if(!S || !S.px.length) return;
  const F = S.fund || {};
  const {base,ma1,ma2,e21,vma,bA,rs,s0} = series();
  const vis = base.slice(s0); const n = vis.length;
  const narrow = W < 600;
  const L=6, R= narrow?50:66, T=20, B=18;
  const plotW = W-L-R;
  const Q = (F.quarters||[]).map(q=>({...q, end:qEnd(q.q)})).filter(q=>q.end);
  const hasMargin = Q.some(q=>q.margin);
  const rowH = narrow?11:13, stripRows = Q.length ? (narrow? 3 : (hasMargin?4:3)) : 0;
  const stripH = stripRows*rowH + (stripRows?4:0);
  const totalH = H-T-B-stripH-(stripH?4:0);
  const priceH = Math.round(totalH*0.76), volH = totalH-priceH-4;
  const pTop=T, pBot=T+priceH, vTop=pBot+4, vBot=vTop+volH, sTop=vBot+4, sBot=sTop+stripH;
  const hasIdx = !!bA;
  const prTop = pTop + (hasIdx ? priceH*0.17 : 10), prBot = rs ? pTop + priceH*0.80 : pBot - 22;
  const rsTop = pTop + priceH*0.74, rsBot = pBot - 22;
  const ixTop = pTop + 8, ixBot = pTop + priceH*0.24;
  const bw = plotW/n; const xOf = i => L + (i+0.5)*bw;
  const tDay = n>1 ? (vis[n-1].t - vis[0].t)/(n-1) : 864e5;
  const xAtT = t => { if(t<=vis[0].t) return L + (t-vis[0].t)/tDay*bw + bw/2; if(t>=vis[n-1].t) return xOf(n-1) + (t-vis[n-1].t)/tDay*bw;
    let a=0,b=n-1; while(b-a>1){ const m=(a+b)>>1; if(vis[m].t<=t) a=m; else b=m; } return xOf(a) + (t-vis[a].t)/(vis[b].t-vis[a].t)*bw; };

  let lo=Infinity, hi=-Infinity; for(const b of vis){ lo=Math.min(lo,b.l); hi=Math.max(hi,b.h); }
  const pad = Math.log(hi/lo)*0.04 || 0.01; const lLo=Math.log(lo)-pad, lHi=Math.log(hi)+pad;
  const yOf = p => prBot - (Math.log(p)-lLo)/(lHi-lLo)*(prBot-prTop);
  const pOf = y => Math.exp(lLo + (prBot-y)/(prBot-prTop)*(lHi-lLo));
  let vMax=0; for(let i=s0;i<base.length;i++) vMax=Math.max(vMax, base[i].v);
  const vY = v => vBot - v/((vMax||1)*1.28)*(volH-2);

  // month grid + labels
  const monthStarts=[]; let lastM=-1;
  for(let i=0;i<n;i++){ const d=new Date(vis[i].t); const m=d.getUTCMonth()+d.getUTCFullYear()*12; if(m!==lastM){ monthStarts.push({i,d}); lastM=m; } }
  ctx.strokeStyle=C.grid; ctx.lineWidth=1; ctx.setLineDash([1,3]);
  const skipM = (narrow && view.months>12) || view.months>24 ? 2 : 1;
  ctx.textBaseline="alphabetic"; ctx.textAlign="center"; let lastLabelX=-99;
  monthStarts.forEach(ms=>{ const x = Math.round(L + ms.i*bw)+.5; const isJan=ms.d.getUTCMonth()===0;
    if(ms.i>0){ ctx.beginPath(); ctx.moveTo(x,pTop); ctx.lineTo(x,vBot); ctx.stroke(); }
    if((ms.d.getUTCMonth()%skipM===0 || isJan) && x-lastLabelX>(narrow?28:34)){
      ctx.fillStyle = isJan? C.ink : C.ink2; ctx.font = `${isJan?700:600} ${narrow?10:11}px ${FONT_L}`;
      ctx.fillText(isJan? String(ms.d.getUTCFullYear()) : MON[ms.d.getUTCMonth()], Math.min(x+14, L+plotW-12), H-5); lastLabelX=x; } });

  // price grid + axis
  ctx.font = `${narrow?10:11}px ${FONT_D}`; ctx.textAlign="left"; ctx.textBaseline="middle"; let lastY = 1e9;
  for(const t of logTicks(Math.exp(lLo), Math.exp(lHi), prBot-prTop)){ const y=yOf(t); if(y<pTop+4||y>pBot-4 || lastY-y<13) continue; lastY=y;
    ctx.strokeStyle=C.grid; ctx.beginPath(); ctx.moveTo(L,Math.round(y)+.5); ctx.lineTo(L+plotW,Math.round(y)+.5); ctx.stroke();
    ctx.fillStyle=C.ink2; ctx.fillText(fmtP(t), L+plotW+5, y); }
  ctx.setLineDash([]);
  ctx.strokeStyle=C.ink; ctx.lineWidth=1; ctx.strokeRect(L+.5,pTop+.5,plotW,priceH); ctx.strokeRect(L+.5,vTop+.5,plotW,volH);

  ctx.save(); ctx.beginPath(); ctx.rect(L,pTop,plotW,priceH); ctx.clip();

  // index line on top
  if(hasIdx){ let a=Infinity,z=-Infinity; for(let i=s0;i<base.length;i++){ const v=bA[i]; if(v!=null){a=Math.min(a,v);z=Math.max(z,v);} }
    if(z>a){ const iy = v => ixBot - (Math.log(v)-Math.log(a))/(Math.log(z)-Math.log(a))*(ixBot-ixTop);
      ctx.strokeStyle=C.idx; ctx.lineWidth=1; ctx.beginPath(); let on=false;
      for(let i=0;i<n;i++){ const v=bA[s0+i]; if(v==null){on=false;continue;} on?ctx.lineTo(xOf(i),iy(v)):ctx.moveTo(xOf(i),iy(v)); on=true; } ctx.stroke();
      ctx.fillStyle=C.idx; ctx.font=`600 11px ${FONT_L}`; ctx.textAlign="right"; ctx.textBaseline="bottom";
      ctx.fillText("S&P 500", L+plotW-4, Math.max(ixTop+10, iy(bA[base.length-1])-4)); } }

  // auto-detected base: pivot line, buy zone, label
  const bs = S.base;
  if(view.base && bs && bs.pivot){
    const t0 = iso(bs.start), t1 = iso(bs.end), tEnd = vis[n-1].t;
    if(t1 >= vis[0].t){
      const x0 = Math.max(L, xAtT(t0)), x1 = xAtT(t1), xR = L+plotW;
      const yP = yOf(bs.pivot), yZ = yOf(bs.buyZoneTop), yLo = yOf(bs.low);
      ctx.fillStyle = C.zone; ctx.fillRect(x1, yZ, xR-x1, yP-yZ);
      ctx.strokeStyle = C.navy; ctx.lineWidth = 1; ctx.setLineDash([6,3]);
      ctx.beginPath(); ctx.moveTo(x0, yP); ctx.lineTo(xR, yP); ctx.stroke(); ctx.setLineDash([]);
      // bracket under the base
      ctx.strokeStyle = "rgba(31,60,110,.55)"; ctx.lineWidth = 1.2; const yb = Math.min(prBot+8, yLo+10);
      ctx.beginPath(); ctx.moveTo(x0, yb-5); ctx.lineTo(x0, yb); ctx.lineTo(x1, yb); ctx.lineTo(x1, yb-5); ctx.stroke();
      if(bs.handleStart){ const xh = xAtT(iso(bs.handleStart)); ctx.beginPath(); ctx.moveTo(xh, yP-14); ctx.lineTo(xh, yP-8); ctx.lineTo(x1, yP-8); ctx.lineTo(x1, yP-14); ctx.stroke(); }
      ctx.font = `600 ${narrow?10:11}px ${FONT_L}`; ctx.fillStyle = C.navy; ctx.textBaseline = "top"; ctx.textAlign = "left";
      const lbl = `${bs.type} · ${bs.weeks} wks · ${bs.depthPct}% deep`;
      const lx = Math.max(L+4, Math.min(x0, L+plotW - ctx.measureText(lbl).width - 6));
      ctx.fillText(lbl, lx, Math.min(prBot, yb + 3));
      ctx.textBaseline = "bottom"; ctx.textAlign = "left"; ctx.fillText(`Pivot ${fmtP(bs.pivot)}`, Math.min(x0+2, xR-90), yP-2);
      if(bs.breakoutDate && iso(bs.breakoutDate) >= vis[0].t){ const xb = xAtT(iso(bs.breakoutDate)); ctx.beginPath(); ctx.moveTo(xb, yP+18); ctx.lineTo(xb-4, yP+26); ctx.lineTo(xb+4, yP+26); ctx.closePath(); ctx.fill(); }
    }
  }

  // user lines
  const marks = S.marks.slice(); if(drag && drag.cur) marks.push({...drag.cur, k:"line", preview:true});
  for(const ln of marks.filter(m=>m.k==="line")){
    if(ln.t2 < vis[0].t) continue; const y=yOf(ln.p);
    ctx.strokeStyle=C.ink; ctx.lineWidth=1.4; ctx.setLineDash([4,3]); ctx.globalAlpha=ln.preview?.55:1;
    ctx.beginPath(); ctx.moveTo(xAtT(ln.t1)-bw/2,y); ctx.lineTo(xAtT(ln.t2)+bw/2,y); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha=1; }

  // moving averages
  const line = (arr, color, w) => { if(!arr) return; ctx.strokeStyle=color; ctx.lineWidth=w; ctx.beginPath(); let on=false;
    for(let i=0;i<n;i++){ const v=arr[s0+i]; if(v==null){on=false;continue;} const x=xOf(i), y=yOf(v); on? ctx.lineTo(x,y) : ctx.moveTo(x,y); on=true; } ctx.stroke(); };
  line(e21, C.ema, 1.2); line(ma2, C.ma200, 1.3); line(ma1, C.ma50, 1.4);

  // swing pivots
  if(view.piv){
    const piv = zigzag(base, view.weekly ? 0.11 : 0.065); const lastIdx = base.length-1;
    const unbroken = isHi => { for(let k=piv.length-1;k>=Math.max(0,piv.length-8);k--){ const p=piv[k]; if(p.hi!==isHi || p.i>=lastIdx-2) continue;
        let ok=true; for(let j=p.i+1;j<=lastIdx;j++){ if(isHi? base[j].h>p.p : base[j].l<p.p){ ok=false; break; } } if(ok) return p; } return null; };
    for(const isHi of [true,false]){ const p=unbroken(isHi); if(!p || p.i<s0) continue; const y=yOf(p.p);
      ctx.strokeStyle=C.piv; ctx.lineWidth=1.2; ctx.setLineDash([2,3]); ctx.beginPath(); ctx.moveTo(xOf(p.i-s0),y); ctx.lineTo(L+plotW,y); ctx.stroke(); ctx.setLineDash([]); }
    ctx.font = `${narrow?9:10}px ${FONT_D}`; ctx.fillStyle=C.ink; ctx.textAlign="center"; ctx.textBaseline="middle"; const boxes=[];
    for(const p of piv){ if(p.i<s0) continue; const label=fmtP(p.p); const w=ctx.measureText(label).width+4;
      const x=Math.max(L+w/2+1, Math.min(L+plotW-w/2-1, xOf(p.i-s0))); const y=yOf(p.p) + (p.hi? -7 : 9);
      const r={x:x-w/2,y:y-6,w,h:12}; if(boxes.some(b=>r.x<b.x+b.w && b.x<r.x+r.w && r.y<b.y+b.h && b.y<r.y+r.h)) continue; boxes.push(r);
      ctx.fillText(label, x, y); }
  }

  // price bars
  const tickW = Math.max(1, Math.min(4, bw*0.4)); ctx.lineWidth = bw>3 ? 1.5 : 1;
  for(let i=0;i<n;i++){ const b=vis[i], x=Math.round(xOf(i))+.5; const prev = s0+i>0 ? base[s0+i-1].c : b.o;
    ctx.strokeStyle = b.c < prev ? C.down : C.ink; ctx.beginPath(); ctx.moveTo(x,yOf(b.h)); ctx.lineTo(x,yOf(b.l));
    if(bw>2.4){ ctx.moveTo(x-tickW,yOf(b.o)); ctx.lineTo(x,yOf(b.o)); }
    ctx.moveTo(x,yOf(b.c)); ctx.lineTo(x+tickW,yOf(b.c)); ctx.stroke(); }

  // RS line + rating
  let rsNewHigh=false;
  if(rs){ let a=Infinity,z=-Infinity; for(let i=s0;i<base.length;i++){ const v=rs[i]; if(v!=null){a=Math.min(a,v);z=Math.max(z,v);} }
    if(isFinite(a) && z>a){ const ry = v => rsBot - (Math.log(v)-Math.log(a))/(Math.log(z)-Math.log(a))*(rsBot-rsTop);
      ctx.strokeStyle=C.blue; ctx.lineWidth=1.2; ctx.beginPath(); let on=false;
      for(let i=0;i<n;i++){ const v=rs[s0+i]; if(v==null){on=false;continue;} on?ctx.lineTo(xOf(i),ry(v)):ctx.moveTo(xOf(i),ry(v)); on=true; } ctx.stroke();
      const last=rs[base.length-1]; let mx=-Infinity;
      for(let i=Math.max(0,base.length-(view.weekly?52:252));i<base.length-1;i++) if(rs[i]!=null) mx=Math.max(mx,rs[i]);
      rsNewHigh = last!=null && last>=mx; const ey=ry(last);
      if(rsNewHigh){ ctx.fillStyle=C.blue; ctx.beginPath(); ctx.arc(xOf(n-1), ey, 4.5, 0, 7); ctx.fill(); }
      if(F.rs){ ctx.fillStyle=C.blue; ctx.font=`700 ${narrow?13:15}px ${FONT_L}`; ctx.textAlign="right"; ctx.textBaseline="middle"; ctx.fillText(F.rs, L+plotW-3, Math.max(rsTop, ey-14)); }
      ctx.fillStyle=C.blue; ctx.font=`600 10px ${FONT_L}`; ctx.textAlign="left"; ctx.textBaseline="top"; ctx.fillText("RS LINE", L+6, rsTop);
    } }

  // earnings markers
  const eY = pBot - 11;
  for(const q of Q){ let t = q.date ? iso(q.date) : null; const est = !t; if(est) t = q.end + 26*864e5;
    if(t < vis[0].t || t > vis[n-1].t + 3*864e5) continue; const x = Math.min(L+plotW-8, xAtT(t));
    ctx.strokeStyle=C.navy; ctx.lineWidth=1.2; ctx.setLineDash(est?[2,2]:[]); ctx.fillStyle="#fff";
    ctx.beginPath(); ctx.arc(x,eY,7,0,7); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle=C.navy; ctx.font=`700 10px ${FONT_L}`; ctx.textAlign="center"; ctx.textBaseline="middle"; ctx.fillText("E", x, eY+.5); }

  // notes with arrows
  for(const nt of S.marks.filter(m=>m.k==="note")){
    if(nt.t < vis[0].t || nt.t > vis[n-1].t) continue; const ax = xAtT(nt.t), ay = yOf(nt.p);
    ctx.font = `${narrow?11:12}px ${FONT_L}`; const words = nt.text.split(/\s+/); const lines=[]; let cur="";
    for(const w of words){ const tst = cur? cur+" "+w : w; if(ctx.measureText(tst).width > 150 && cur){ lines.push(cur); cur=w; } else cur=tst; } if(cur) lines.push(cur);
    const lh=13, bh=lines.length*lh; const above = ay - 60 - bh > pTop + 4; const tx = Math.max(L+4, Math.min(L+plotW-160, ax - 40));
    const ty = above ? ay - 54 - bh : ay + 54; const tw = Math.max(...lines.map(l=>ctx.measureText(l).width));
    ctx.fillStyle="rgba(255,255,255,.85)"; ctx.fillRect(tx-2, ty-2, tw+4, bh+4);
    ctx.fillStyle=C.navy; ctx.textAlign="left"; ctx.textBaseline="top"; lines.forEach((l,k)=>ctx.fillText(l, tx, ty+k*lh));
    const sx = Math.max(tx, Math.min(tx+tw, ax)), sy = above ? ty+bh+2 : ty-2; const ey2 = above ? ay-6 : ay+6;
    ctx.strokeStyle=C.navy; ctx.lineWidth=1.2; ctx.beginPath(); ctx.moveTo(sx,sy); ctx.lineTo(ax,ey2); ctx.stroke();
    const ang=Math.atan2(ey2-sy, ax-sx); ctx.beginPath(); ctx.moveTo(ax,ey2); ctx.lineTo(ax-7*Math.cos(ang-0.4), ey2-7*Math.sin(ang-0.4)); ctx.lineTo(ax-7*Math.cos(ang+0.4), ey2-7*Math.sin(ang+0.4)); ctx.closePath(); ctx.fillStyle=C.navy; ctx.fill(); }
  ctx.restore();

  // volume
  ctx.save(); ctx.beginPath(); ctx.rect(L,vTop,plotW,volH); ctx.clip();
  for(let i=0;i<n;i++){ const b=vis[i]; const prev = s0+i>0 ? base[s0+i-1].c : b.o; const x=xOf(i);
    ctx.fillStyle = b.c<prev ? C.down : C.ink; const w=Math.max(1,bw*0.6); const y=vY(b.v); ctx.fillRect(x-w/2, y, w, vBot-y); }
  ctx.strokeStyle=C.vavg; ctx.lineWidth=1.2; ctx.beginPath(); let on=false;
  for(let i=0;i<n;i++){ const v=vma[s0+i]; if(v==null){on=false;continue;} on?ctx.lineTo(xOf(i),vY(v)):ctx.moveTo(xOf(i),vY(v)); on=true; } ctx.stroke();
  if(volH>60){ ctx.font=`${narrow?9:10}px ${FONT_D}`; ctx.textAlign="center"; ctx.textBaseline="bottom"; let lastX=-999; const win = view.weekly?4:8;
    for(let i=0;i<n;i++){ const g=s0+i; const avg=vma[g]; const v=base[g].v; if(!avg || v < avg*(view.weekly?1.6:1.75)) continue;
      let isMax=true; for(let j=Math.max(0,g-win); j<=Math.min(base.length-1,g+win); j++) if(base[j].v>v){ isMax=false; break; }
      const x=xOf(i); if(!isMax || x-lastX < (narrow?44:56)) continue; lastX=x; const y=vY(v)-1;
      ctx.fillStyle=C.ink; ctx.fillText(fmtV(v), x, y-11); ctx.fillStyle=C.blue; ctx.fillText(fmtPct((v/avg-1)*100,0), x, y); } }
  ctx.restore();
  ctx.fillStyle=C.ink2; ctx.font=`${narrow?10:11}px ${FONT_D}`; ctx.textAlign="left"; ctx.textBaseline="middle";
  for(const f of [1,0.5]){ const v=vMax*1.28*f*0.78; const y=vY(v); if(y>vTop+6) ctx.fillText(fmtV(v), L+plotW+5, y); }
  ctx.fillText("Vol.", L+plotW+5, vBot-6);

  // quarterly strip
  if(stripRows){
    ctx.strokeStyle=C.ink; ctx.lineWidth=1; ctx.strokeRect(L+.5, sTop+.5, plotW, stripH);
    ctx.font=`${narrow?9:10}px ${FONT_D}`; ctx.textBaseline="middle";
    const lbls = narrow ? ["","EPS %","Sales %"] : ["","EPS","Sales"].concat(hasMargin?["Op. mgn"]:[]);
    ctx.fillStyle=C.ink2; ctx.textAlign="left"; lbls.forEach((l,k)=>{ if(l) ctx.fillText(l, L+plotW+5, sTop+2+rowH*(k+0.5)); });
    const pair = (cx, y, a, b) => { ctx.textAlign="left"; const wa = a? ctx.measureText(a+" ").width:0, wb=ctx.measureText(b||"").width; let x=cx-(wa+wb)/2;
      if(a){ ctx.fillStyle=C.ink; ctx.fillText(a+" ", x, y); x+=wa; } if(b){ ctx.fillStyle= sign(b)==="neg"? C.down : C.blue; ctx.fillText(b, x, y); } };
    for(const q of Q){ const e = new Date(q.end); const start = Date.UTC(e.getUTCFullYear(), e.getUTCMonth()-2, 1);
      let x0 = Math.max(L, xAtT(start)), x1 = Math.min(L+plotW, xAtT(q.end+864e5)); if(x1-x0 < 24) continue;
      ctx.strokeStyle=C.grid; ctx.setLineDash([1,2]); ctx.beginPath(); ctx.moveTo(Math.round(x1)+.5, sTop); ctx.lineTo(Math.round(x1)+.5, sBot); ctx.stroke(); ctx.setLineDash([]);
      const cx=(x0+x1)/2, wide = x1-x0 > 92;
      ctx.save(); ctx.beginPath(); ctx.rect(x0+1,sTop,x1-x0-2,stripH); ctx.clip();
      ctx.fillStyle=C.ink; ctx.font=`700 ${narrow?9:10}px ${FONT_L}`; ctx.textAlign="center"; ctx.fillText(q.q, cx, sTop+2+rowH*0.5);
      ctx.font=`${narrow?9:10}px ${FONT_D}`;
      pair(cx, sTop+2+rowH*1.5, wide&&!narrow? q.eps : "", q.epsChg);
      pair(cx, sTop+2+rowH*2.5, wide&&!narrow? q.sales : "", q.salesChg);
      if(hasMargin && !narrow){ ctx.fillStyle=C.ink2; ctx.textAlign="center"; ctx.fillText(q.margin||"", cx, sTop+2+rowH*3.5); }
      ctx.restore(); }
  }

  // last price tag + readout + crosshair
  const lb = vis[n-1]; const ly=yOf(lb.c);
  ctx.fillStyle=C.ink; ctx.fillRect(L+plotW+1, ly-8, R-2, 16); ctx.fillStyle="#fff"; ctx.font=`700 ${narrow?10:11}px ${FONT_D}`; ctx.textAlign="left"; ctx.textBaseline="middle"; ctx.fillText(fmtP(lb.c), L+plotW+4, ly+1);
  ctx.font=`700 ${narrow?11:12}px ${FONT_D}`; ctx.fillStyle=C.ink;
  const hi_ = hover>=0 && hover<n ? hover : n-1; const hb = vis[hi_];
  const pc = s0+hi_>0 ? base[s0+hi_-1].c : hb.o;
  const txt = `${fmtD(hb.t)}  O ${fmtP(hb.o)}  H ${fmtP(hb.h)}  L ${fmtP(hb.l)}  C ${fmtP(hb.c)}  ${fmtPct((hb.c/pc-1)*100,2)}  Vol ${fmtV(hb.v)}` + (vma[s0+hi_] ? ` (${fmtPct((hb.v/vma[s0+hi_]-1)*100,0)})` : "");
  ctx.fillText(narrow ? txt.split("  Vol")[0] : txt, L+2, 10);
  if(rsNewHigh && !narrow){ ctx.fillStyle=C.blue; ctx.textAlign="right"; ctx.fillText("● RS LINE AT NEW HIGH", L+plotW, 10); }
  if(hover>=0 && hover<n){ const x=Math.round(xOf(hover))+.5; ctx.strokeStyle="rgba(21,23,28,.35)"; ctx.lineWidth=1; ctx.setLineDash([2,3]);
    ctx.beginPath(); ctx.moveTo(x,pTop); ctx.lineTo(x,vBot); ctx.stroke(); ctx.setLineDash([]); }

  geo = {L,plotW,pTop,pBot,bw,n,vis,yOf,pOf,narrow};
}

/* ---------- drawing tools ---------- */
function idxAt(x){ if(!geo) return -1; const i=Math.floor((x-geo.L)/geo.bw); return i<0||i>=geo.n ? -1 : i; }
function snapPrice(i,y){ const b=geo.vis[i]; let p=geo.pOf(y); for(const v of [b.h,b.l,b.c]){ if(Math.abs(geo.yOf(v)-y)<8){ p=v; break; } } return p; }
function saveMarks(){ if(S) store.set(marksKey(S.symbol), S.marks); }
cv.addEventListener("pointermove", e=>{ if(!S) return;
  const r=cv.getBoundingClientRect(); const x=e.clientX-r.left; hover=idxAt(x);
  if(drag && geo){ const i=Math.max(0,Math.min(geo.n-1,Math.floor((x-geo.L)/geo.bw))); const a=drag.i0;
    drag.cur={t1:geo.vis[Math.min(a,i)].t, t2:geo.vis[Math.max(a,i)].t, p:drag.p}; drag.moved = Math.abs(x-drag.x0)>5; }
  draw(); });
cv.addEventListener("pointerleave", ()=>{ if(!drag){ hover=-1; draw(); } });
cv.addEventListener("pointerdown", e=>{
  if(!tool || !geo) return; const r=cv.getBoundingClientRect(); const x=e.clientX-r.left, y=e.clientY-r.top;
  if(y<geo.pTop || y>geo.pBot) return; const i=idxAt(x); if(i<0) return;
  if(tool==="line"){ cv.setPointerCapture(e.pointerId); drag={i0:i,x0:x,p:snapPrice(i,y)}; drag.cur={t1:geo.vis[i].t,t2:geo.vis[i].t,p:drag.p}; }
  if(tool==="note"){ pendingNote={t:geo.vis[i].t, p:snapPrice(i,y)}; const inp=$("#noteIn"); inp.hidden=false; inp.value="";
    inp.style.left = Math.max(4, Math.min(x-20, cv.clientWidth-230))+"px"; inp.style.top = Math.max(4, y-40)+"px"; setTimeout(()=>inp.focus(),0); } });
cv.addEventListener("pointerup", ()=>{ if(!drag) return;
  const ln = drag.moved ? drag.cur : {t1:drag.cur.t1, t2:geo.vis[geo.n-1].t, p:drag.p};
  S.marks.push({k:"line",...ln}); drag=null; saveMarks(); draw(); });
function commitNote(inp){ const v=inp.value.trim(); if(v && pendingNote){ S.marks.push({k:"note",...pendingNote,text:v}); saveMarks(); } pendingNote=null; inp.hidden=true; draw(); }
$("#noteIn").addEventListener("keydown", e=>{ if(e.key==="Enter") commitNote(e.target); if(e.key==="Escape"){ pendingNote=null; e.target.hidden=true; } });
$("#noteIn").addEventListener("blur", e=>setTimeout(()=>{ if(!e.target.hidden) commitNote(e.target); },120));
function setTool(t){ tool = tool===t ? null : t; $("#bLine").classList.toggle("on",tool==="line"); $("#bNote").classList.toggle("on",tool==="note"); }
$("#bLine").onclick=()=>setTool("line");
$("#bNote").onclick=()=>setTool("note");
$("#bUndo").onclick=()=>{ if(!S) return; S.marks.pop(); saveMarks(); draw(); };
$("#bClr").onclick=()=>{ if(!S) return; S.marks=[]; saveMarks(); draw(); };

/* ---------- panels ---------- */
function renderPanels(){
  const F = S.fund||{}, st = S.stats||{}, b = S.base;
  const ch = st.chgPct;
  $("#sym").textContent = S.symbol; $("#cname").textContent = S.name || "";
  document.title = `${S.symbol} · Ink Charts`;
  $("#qPx").textContent = fmtP(st.close);
  $("#qChg").innerHTML = `<span class="${ch<0?'dn':''}">${ch>=0?"+":""}${fmtP(st.close-st.prevClose)} (${fmtPct(ch,2)})</span>`;
  $("#qMeta").textContent = `${fmtLong(iso(st.date))} close · Vol ${fmtV(st.volume)}` + (F.exchange? " · "+F.exchange : "");
  const chip = $("#baseChip"); chip.hidden = !(b && b.status); if(b && b.status){ chip.textContent = b.status; chip.className = "chip " + (STATUS_CLASS[b.status]||""); }

  const tiles = [["RS Rating", F.rs, +F.rs>=80, +F.rs<50], ["Group RS", F.grpRs, /^A/.test(F.grpRs||""), /^[DE]/.test(F.grpRs||"")],
    ["U/D vol", st.udRatio!=null? st.udRatio.toFixed(2):"", st.udRatio>=1.2, st.udRatio<1],
    ["EPS Δ", (F.quarters&&F.quarters[0]&&F.quarters[0].epsChg)||"", pnum(F.quarters&&F.quarters[0]&&F.quarters[0].epsChg)>=25, pnum(F.quarters&&F.quarters[0]&&F.quarters[0].epsChg)<0],
    ["Sales Δ", (F.quarters&&F.quarters[0]&&F.quarters[0].salesChg)||"", pnum(F.quarters&&F.quarters[0]&&F.quarters[0].salesChg)>=20, pnum(F.quarters&&F.quarters[0]&&F.quarters[0].salesChg)<0],
    ["Off high", fmtPct(st.offHighPct,0), st.offHighPct>-5, st.offHighPct<-25]];
  $("#ratings").innerHTML = `<div class="ratings">${tiles.map(([k,v,hot,cold])=>`<div class="rt"><div class="stamp ${v&&hot?'hot':v&&cold?'cold':''}">${esc(v||"–")}</div><span>${k}</span></div>`).join("")}</div>`;

  const calc = [["52-week high", fmtP(st.hi52)], ["Off 52-week high", fmtPct(st.offHighPct)], ["52-week low", fmtP(st.lo52)],
    ["50-day MA", st.ma50? `${fmtP(st.ma50)} (${fmtPct(st.vs50Pct)})` : "—"], ["200-day MA", st.ma200? `${fmtP(st.ma200)} (${fmtPct(st.vs200Pct)})` : "—"],
    ["Avg volume (50d)", fmtV(st.avgVol50)], ["Avg $ volume (50d)", st.dollarVol50? "$"+fmtV(st.dollarVol50) : "—"], ["Volume vs avg", fmtPct(st.volVsAvgPct,0)],
    ["Up/down volume", st.udRatio==null? "—" : st.udRatio.toFixed(2)], ["ATR (21d)", st.atrPct==null? "—" : st.atrPct.toFixed(2)+"%"],
    ["3-month change", fmtPct(st.perf3m)], ["12-month change", fmtPct(st.perf12m)], ["RS line, 3 months", fmtPct(st.rsLine3mPct)],
    ["RS line at new high", st.rsLineNewHigh==null? "—" : st.rsLineNewHigh? "Yes ●" : "No"],
    ["Last swing high (unbroken)", fmtP(st.resistance)], ["Last swing low (unbroken)", fmtP(st.support)]];
  $("#calc").innerHTML = calc.map(([k,v])=>`<dt>${k}</dt><dd>${esc(v)}</dd>`).join("");

  const Q = (F.quarters||[]).filter(q=>q.q||q.eps);
  $("#qtrs").innerHTML = Q.length ? `<table><thead><tr><th class="l">Qtr</th><th>Reported</th><th>EPS</th><th>% chg</th><th>Sales</th><th>% chg</th><th>Op. mgn</th><th>Surprise</th></tr></thead><tbody>${Q.map(q=>`<tr><td class="l">${esc(q.q)}</td><td>${q.date?fmtD(iso(q.date)):""}</td><td>${esc(q.eps)}</td><td class="${sign(q.epsChg)}">${esc(q.epsChg)}</td><td>${esc(q.sales)}</td><td class="${sign(q.salesChg)}">${esc(q.salesChg)}</td><td>${esc(q.margin||"")}</td><td class="${sign(q.surprise)}">${esc(q.surprise||"")}</td></tr>`).join("")}</tbody></table>`
    : `<div class="empty">Yahoo did not return quarterly earnings for this ticker.</div>`;
  const A = (F.annual||[]).filter(a=>a.y||a.eps);
  $("#annual").innerHTML = A.length ? `<table><thead><tr><th class="l">Year</th><th>EPS</th><th>EPS % chg</th><th>Sales % chg</th></tr></thead><tbody>${A.map(a=>`<tr><td class="l">${esc(a.y)}</td><td>${esc(a.eps)}</td><td class="${sign(a.chg)}">${esc(a.chg)}</td><td class="${sign(a.salesChg)}">${esc(a.salesChg||"")}</td></tr>`).join("")}</tbody></table>` : `<div class="empty">No annual data.</div>`;

  const K = [["Sector · group",F.group],["Group rank",F.groupRank],["Market cap",F.mktCap],["Float",F.float],["Shares out",F.shares],["Institutional",F.inst],["ROE",F.roe],["Pretax margin",F.pretax],["Debt / equity",F.debt],["EPS growth (3y)",F.epsGrowth],["EPS surprises (8q)",F.epsSurprise],["Next earnings",F.nextEarn],["Next qtr EPS est.",F.epsDue]].filter(r=>r[1]);
  $("#keydata").innerHTML = K.map(([k,v])=>`<dt>${k}</dt><dd>${esc(v)}</dd>`).join("") || `<div class="empty" style="grid-column:1/-1">No key data.</div>`;

  $("#baseBox").innerHTML = b ? `<p class="basebig">${esc(b.type)}</p>
      <dl class="kv"><dt>Status</dt><dd><span class="chip ${STATUS_CLASS[b.status]||""}">${esc(b.status)}</span></dd>
      <dt>Length</dt><dd>${b.weeks} weeks</dd><dt>Depth</dt><dd>${b.depthPct}%</dd>
      <dt>Left-side high</dt><dd>${fmtP(b.high)} · ${fmtD(iso(b.start))}</dd><dt>Base low</dt><dd>${fmtP(b.low)} · ${fmtD(iso(b.lowDate))}</dd>
      <dt>Pivot</dt><dd>${fmtP(b.pivot)}</dd><dt>Buy zone (+5%)</dt><dd>${fmtP(b.pivot)} – ${fmtP(b.buyZoneTop)}</dd>
      <dt>Price vs pivot</dt><dd class="${b.distPct<0?'neg':''}">${fmtPct(b.distPct)}</dd>
      ${b.breakoutDate?`<dt>Breakout</dt><dd>${fmtD(iso(b.breakoutDate))}${b.breakoutVolPct!=null?` · vol ${fmtPct(b.breakoutVolPct,0)}`:""}</dd>`:""}</dl>
      <p class="basetxt">${baseNote(b)}</p>`
    : `<div class="empty">No base detected. The stock is either trending at new highs without a 5-week consolidation, or has too little history.</div>`;

  const nm = view.weekly? ["10-week","40-week","10-week"] : ["50-day","200-day","50-day"];
  $("#legend").innerHTML = (view.weekly?"":`<span><span class="sw" style="border-color:${C.ema}"></span><b>21-day EMA</b></span>`) +
    `<span><span class="sw" style="border-color:${C.ma50}"></span><b>${nm[0]} MA</b></span><span><span class="sw" style="border-color:${C.ma200}"></span><b>${nm[1]} MA</b></span>` +
    `<span><span class="sw" style="border-color:${C.blue}"></span><b>RS line</b> vs S&amp;P 500</span><span><span class="sw" style="border-color:${C.idx};border-top-width:1px"></span><b>S&amp;P 500</b></span>` +
    `<span><span class="sw" style="border-color:${C.vavg}"></span><b>${nm[2]} avg volume</b></span><span><span class="sw" style="border-color:${C.piv};border-top-style:dotted"></span><b>Unbroken swing</b></span>` +
    `<span><span class="sw" style="border-color:${C.navy};border-top-style:dashed"></span><b>Pivot · buy zone</b></span><span>Red: close below prior close · log scale</span>`;
  renderDbox();
}
function baseNote(b){
  const bits = [];
  if(b.status==="Breakout") bits.push(`Broke out above the ${fmtP(b.pivot)} pivot${b.breakoutVolPct!=null?` on volume ${fmtPct(b.breakoutVolPct,0)} vs average`:""}. Still inside the 5% buy zone.`);
  else if(b.status==="In buy zone") bits.push("Trading inside the 5% buy zone above the pivot.");
  else if(b.status==="Near pivot") bits.push("Within 5% below the pivot. Watch for a move through it on volume at least 40–50% above average.");
  else if(b.status==="Extended") bits.push("More than 5% past the pivot: extended from a proper buy point.");
  else if(b.status==="Failed breakout") bits.push("Broke out but fell back more than 3% under the pivot.");
  else if(b.status==="Correcting") bits.push("The correction is deeper than 50%; not a sound base yet.");
  else bits.push("Still below the pivot; the right side of the base is forming.");
  if(b.depthPct>35 && b.type!=="Deep correction") bits.push("Depth above 35% is on the deep side for a cup.");
  return esc(bits.join(" "));
}
function renderDbox(){
  const box=$("#dbox"); if(!S) return; const F=S.fund||{}, st=S.stats||{};
  const A=(F.annual||[]).filter(a=>a.y||a.eps).slice(0,7).reverse();
  const rows = [["RS Rating",F.rs],["Group rank",F.groupRank],["U/D vol",st.udRatio!=null?st.udRatio.toFixed(2):""],["Mkt cap",F.mktCap],["% vs 52w high",fmtPct(st.offHighPct)],["EPS growth",F.epsGrowth],["EPS surprise",F.epsSurprise]].filter(r=>r[1]);
  const show = view.box && (A.length || rows.length>2) && !(geo && geo.narrow);
  box.hidden = !show; if(!show) return;
  box.innerHTML = `<div class="hd">${esc(F.group || "")}</div>` +
    (A.length? `<table><thead><tr><th class="l">Year</th><th>EPS</th><th>EPS</th><th>Sales</th></tr></thead><tbody>${A.map(a=>`<tr><td class="l">${esc(a.y)}</td><td>${esc(a.eps)}</td><td class="${sign(a.chg)}">${esc(a.chg)}</td><td class="${sign(a.salesChg)}">${esc(a.salesChg||"")}</td></tr>`).join("")}</tbody></table>` : `<div></div>`) +
    `<dl>${rows.map(([k,v])=>`<dt>${k}</dt><dd>${esc(v)}</dd>`).join("")}</dl>`;
}

/* ---------- chart controls ---------- */
$("#pD").onclick=()=>{ view.weekly=false; $("#pD").classList.add("on"); $("#pW").classList.remove("on"); renderPanels(); draw(); };
$("#pW").onclick=()=>{ view.weekly=true; $("#pW").classList.add("on"); $("#pD").classList.remove("on"); renderPanels(); draw(); };
$$("#rangeSeg button").forEach(b=>b.onclick=()=>{ view.months=+b.dataset.r; $$("#rangeSeg button").forEach(x=>x.classList.toggle("on",x===b)); draw(); });
for(const [id,key] of [["#tBox","box"],["#tPiv","piv"],["#tBase","base"]]){
  $(id).onclick=()=>{ view[key]=!view[key]; $(id).classList.toggle("on",view[key]); $(id).setAttribute("aria-pressed",view[key]); draw(); renderDbox(); }; }
function step(d){ if(!S) return; const list = order.length ? order : ROWS.map(r=>r.symbol); const i=list.indexOf(S.symbol); if(i<0) return; location.hash = list[(i+d+list.length)%list.length]; }
$("#bPrev").onclick=()=>step(-1); $("#bNext").onclick=()=>step(1);
document.addEventListener("keydown", e=>{
  if(e.target.closest("input")) return;
  if(e.key==="Escape" && drag){ drag=null; draw(); }
  if($("#vChart").hidden) return;
  if(e.key==="ArrowRight") step(1); if(e.key==="ArrowLeft") step(-1);
});

async function openChart(sym){
  $("#vScreener").hidden = true; $("#vChart").hidden = false; $("#loading").hidden = false;
  window.scrollTo(0,0);
  try{
    const [bundle] = await Promise.all([getJSON(`t/${encodeURIComponent(sym)}.json`), BENCH ? null : getJSON("bench.json").then(b=>{ BENCH = b.prices.map(([d,c])=>({t:iso(d),c})); })]);
    S = { symbol: bundle.symbol, name: bundle.name, fund: bundle.fund||{}, stats: bundle.stats||{}, base: bundle.base,
      px: bundle.prices.map(([d,o,h,l,c,v])=>({t:iso(d),o,h,l,c,v})), marks: store.get(marksKey(bundle.symbol)) || [] };
    hover=-1; renderPanels(); draw(); renderDbox();
  }catch(e){
    S=null; draw(); $("#sym").textContent = sym; $("#cname").textContent = "";
    toast(`Could not load ${sym}. It may not be in the watchlist yet.`);
  }finally{ $("#loading").hidden = true; }
}
function route(){
  const sym = decodeURIComponent(location.hash.slice(1)).toUpperCase();
  if(sym){ openChart(sym); }
  else { $("#vChart").hidden = true; $("#vScreener").hidden = false; document.title = "Ink Charts"; renderScreener(); }
}

/* ---------- boot ---------- */
(async function boot(){
  try{
    [META, ROWS] = await Promise.all([getJSON("meta.json"), getJSON("screener.json")]);
  }catch(e){
    $("#banner").hidden=false; $("#banner").textContent = "No data yet. The first update runs automatically after the US close; you can also start it from the Actions tab on GitHub (Update data → Run workflow).";
    ROWS = []; META = null;
  }
  if(META){
    $("#asof").textContent = `Data as of ${fmtLong(iso(META.dataDate))} close · RS vs ${META.universeSize} stocks`;
    const notes = [];
    if(META.demo) notes.push("Demo data: synthetic prices and fundamentals generated for testing. The live site shows real Yahoo Finance data.");
    if(META.errors && META.errors.length) notes.push("Last update had problems with: " + META.errors.slice(0,6).join("; ") + (META.errors.length>6?"…":""));
    if(notes.length){ $("#banner").hidden=false; $("#banner").textContent = notes.join(" "); }
  }
  $("#symlist").innerHTML = ROWS.map(r=>`<option value="${esc(r.symbol)}">${esc(r.name)}</option>`).join("");
  renderPulse(); renderScreener();
  window.addEventListener("hashchange", route); route();
  let rz; new ResizeObserver(()=>{ cancelAnimationFrame(rz); rz=requestAnimationFrame(()=>{ if(S && !$("#vChart").hidden){ draw(); renderDbox(); } }); }).observe(cv);
  if(document.fonts && document.fonts.ready) document.fonts.ready.then(()=>{ if(S) draw(); });
})();
})();

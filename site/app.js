/* Ticker&Tape — screener + O'Neil-style chart. Reads static JSON from ./data/ */
(() => {
"use strict";
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const DATA = "data/";
const C = {ink:"#15171c", ink2:"#5a5d66", grid:"#c9cbd3", up:"#1d3fc4", down:"#e0337f", ma50:"#d23a2a", ma200:"#15171c", ema:"#5fa35a",
  blue:"#1d3fc4", rs:"#0b2263", navy:"#1f3c6e", idx:"#7d808a", plate:"#ffffff", vavg:"#15171c", piv:"#3c8a3a", zone:"rgba(29,63,196,.07)"};
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
let META=null, ROWS=[], UNI=null, BENCH=null, order=[];
const PAGE = 100;
const scrState = { key: store.get("ink:sortKey") || "rsRating", asc: !!store.get("ink:sortAsc"), filter: "all",
  scope: "watch", limit: PAGE, sector: null };
const list = () => scrState.scope==="all" && UNI ? UNI.filter(r=>!r.etf) : scrState.scope==="etf" && UNI ? UNI.filter(r=>r.etf) : watchRows();
/* ---------- personal watchlist (default: the house list in watchlist.txt) ---------- */
const SYM_OK = /^[A-Z0-9.\-^=]{1,15}$/;
let WL = Array.isArray(store.get("tt:wl")) ? store.get("tt:wl") : null;   // null = house list
let CUR = null;                                                         // ticker on screen
const getWL = () => WL || ROWS.map(r=>r.symbol);
const inWL = s => getWL().includes(s);
function watchRows(){
  if(!WL) return ROWS;
  const by = new Map(ROWS.map(r=>[r.symbol,r]));
  if(UNI) UNI.forEach(r=>{ if(!by.has(r.symbol)) by.set(r.symbol,r); });
  return WL.map(s => by.get(s) || {symbol:s, name: UNI ? "Loads after the next nightly update" : "Loading…", pending:true});
}
const needsUni = () => WL && WL.some(s=>!ROWS.some(r=>r.symbol===s));
let uniLoading = null;
function loadUni(){
  if(UNI) return Promise.resolve(UNI);
  if(!uniLoading) uniLoading = getJSON("universe.json").then(u=>{ UNI=u; if(LIVE) UNI.forEach(patchRow); fillSymlist(); if(needsUni() && !$("#vScreener").hidden) renderScreener(); return u; }).catch(e=>{ uniLoading=null; throw e; });
  return uniLoading;
}
function fillSymlist(){
  const src = UNI || ROWS;
  $("#symlist").innerHTML = src.map(r=>`<option value="${esc(r.symbol)}">${esc(r.name)}</option>`).join("");
}

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
  const f = scrState.filter, sec = scrState.sector;
  return list().filter(r => {
    if(sec && r.sector !== sec) return false;
    const st = r.base && r.base.status;
    if(f==="setup") return st==="Breakout" || st==="In buy zone";
    if(f==="near") return st==="Near pivot" || st==="In buy zone" || st==="Breakout";
    if(f==="rs80") return (r.rsRating||0) >= 80;
    if(f==="trend") return (r.vs50Pct??-1) > 0;
    if(f==="liquid") return (r.dollarVol50||0) >= 2e7;
    return true;
  });
}
function sparkline(cv, data){
  const dpr = window.devicePixelRatio||1, W=110, H=28; cv.width=W*dpr; cv.height=H*dpr;
  const g = cv.getContext("2d"); g.setTransform(dpr,0,0,dpr,0,0);
  if(!data || data.length<2) return;
  const lo=Math.min(...data), hi=Math.max(...data); const y=v=> H-3 - (v-lo)/((hi-lo)||1)*(H-6);
  g.strokeStyle = data[data.length-1] >= data[0] ? C.up : C.down; g.lineWidth=1.2; g.beginPath();
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
  const total = rows.length, shown = rows.slice(0, scrState.limit), all = list();
  $$("#scr th[data-k]").forEach(th=>{ th.classList.toggle("sorted", th.dataset.k===k); th.classList.toggle("asc", th.dataset.k===k && scrState.asc); th.tabIndex=0; });
  const tb = $("#scr tbody");
  tb.innerHTML = shown.map(r => {
    const b = r.base || {};
    const rs = r.rsRating; const stc = STATUS_CLASS[b.status] || "";
    return `<tr data-s="${esc(r.symbol)}" tabindex="0">
      <td class="l"><span class="sym">${esc(r.symbol)}</span>${scrState.scope!=="watch" && inWL(r.symbol)?'<span class="star" title="In your watchlist">★</span>':''}${r.stale?' <span class="stale">stale</span>':''}<span class="nm" title="${esc(r.name)}">${esc(r.name)}</span></td>
      <td class="spk">${r.pending?'<span class="pend">pending</span>':`<canvas data-spark="${esc(r.symbol)}"></canvas>`}</td>
      <td>${fmtP(r.close)}</td>
      <td class="${r.chgPct<0?'neg':''}">${fmtPct(r.chgPct,2)}</td>
      <td><span class="rsv ${rs>=80?'hot':''}">${rs??"—"}</span></td>
      <td title="${esc(r.group)}">${r.etf ? `<span class="nm">${esc(r.tracks||r.group||"")}</span>` : esc(r.groupRank||"—")}</td>
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
    </tr>`; }).join("") || `<tr><td colspan="16" class="l" style="padding:18px">${scrState.scope==="watch" && !getWL().length ? "Your watchlist is empty. Open any ticker and tap the ☆ next to its symbol to add it." : "No tickers match this filter."}</td></tr>`;
  const bySym = new Map(shown.map(r=>[r.symbol,r]));
  $$("canvas[data-spark]").forEach(cv=>{ const r = bySym.get(cv.dataset.spark); sparkline(cv, r && r.spark); });
  const noun = {all:"stocks", etf:"ETFs", watch:"tickers"}[scrState.scope];
  $("#count").textContent = total > shown.length ? `Showing ${shown.length} of ${total} · ${all.length} ${noun}` : `${total} of ${all.length} ${noun}`;
  const sc = $("#secChip"); sc.hidden = !scrState.sector;
  if(scrState.sector){ sc.innerHTML = `Sector: <b>${esc(scrState.sector)}</b> <button aria-label="Clear sector filter">×</button>`; sc.querySelector("button").onclick = ()=>{ scrState.sector=null; scrState.limit=PAGE; renderScreener(); }; }
  $("#moreWrap").hidden = total <= shown.length;
  if(total > shown.length) $("#moreBtn").textContent = `Show ${Math.min(PAGE, total-shown.length)} more`;
}
function renderPulse(){
  const els = [$("#pulse"), $("#hPulse")];
  if(!META || !META.market || !META.market.length){ els.forEach(el=>el.innerHTML=""); return; }
  const html = META.market.map(m => `<div class="pcard">
      <div class="top"><span class="nm">${esc(m.name)}</span><span class="px">${fmtP(m.close)}</span><span class="${m.chgPct<0?'neg':''}" style="font-family:var(--f-data)">${fmtPct(m.chgPct,2)}</span>
        <span class="sp"></span><span class="chip ${MKT_CLASS[m.status]||''}">${esc(m.status)}</span></div>
      <div class="flags"><span class="flag ${m.above21?'ok':'no'}">${m.above21?'Above':'Below'} 21-day</span><span class="flag ${m.above50?'ok':'no'}">${m.above50?'Above':'Below'} 50-day</span><span class="flag ${m.above200?'ok':'no'}">${m.above200?'Above':'Below'} 200-day</span></div>
      <div class="dd" title="Distribution days in the last 25 sessions: index down 0.2% or more on higher volume">${Array.from({length:8},(_,i)=>`<i class="${i<m.distDays?'on':''}"></i>`).join("")}<span>${m.distDays} distribution day${m.distDays===1?'':'s'} (25 sessions)</span></div>
    </div>`).join("");
  els.forEach(el=>el.innerHTML = html);
}
$$("#scr th[data-k]").forEach(th=>{
  const go = ()=>{ const k=th.dataset.k; if(scrState.key===k) scrState.asc=!scrState.asc; else { scrState.key=k; scrState.asc = ["symbol","baseType","status","grp","distPct"].includes(k) ? true : false; }
    store.set("ink:sortKey",scrState.key); store.set("ink:sortAsc",scrState.asc); scrState.limit=PAGE; renderScreener(); };
  th.addEventListener("click", go); th.addEventListener("keydown", e=>{ if(e.key==="Enter") go(); });
});
$$("#filters button").forEach(b=>b.onclick=()=>{ scrState.filter=b.dataset.f; scrState.limit=PAGE; $$("#filters button").forEach(x=>x.classList.toggle("on",x===b)); renderScreener(); });
async function setScope(s){
  scrState.scope = s; scrState.limit = PAGE;
  $$("#scope button").forEach(x=>x.classList.toggle("on", x.dataset.s===s));
  if((s==="all" || s==="etf") && !UNI){
    $("#count").textContent = s==="etf" ? "Loading ETFs…" : "Loading all stocks…";
    try{ await loadUni(); }catch(e){ toast("Could not load the full stock list. It appears after the next data update."); scrState.scope="watch"; $$("#scope button").forEach(x=>x.classList.toggle("on", x.dataset.s==="watch")); }
  }
  renderScreener();
}
$$("#scope button").forEach(b=>b.onclick=()=>setScope(b.dataset.s));
$("#moreBtn").onclick=()=>{ scrState.limit += PAGE; renderScreener(); };
$("#scr tbody").addEventListener("click", e=>{ const tr=e.target.closest("tr[data-s]"); if(tr) location.hash = tr.dataset.s; });
$("#scr tbody").addEventListener("keydown", e=>{ const tr=e.target.closest("tr[data-s]"); if(tr && e.key==="Enter") location.hash = tr.dataset.s; });
$("#jump").addEventListener("change", e=>{ const v=e.target.value.trim().toUpperCase().replace(/\./g,"-"); if(!v) return; e.target.value="";
  const known = ROWS.some(r=>r.symbol===v) || (UNI && UNI.some(r=>r.symbol===v));
  if(known || !UNI || SYM_OK.test(v)) location.hash = v; else toast(`${v} is not a valid ticker.`); });

/* ================= SETTINGS ================= */
const MAS = [
  {k:"d10",  n:10,  w:null, ema:false, color:"#e07b1f", d:"10-day MA"},
  {k:"e21",  n:21,  w:null, ema:true,  color:"#5fa35a", d:"21-day EMA"},
  {k:"d50",  n:50,  w:10,   ema:false, color:"#d23a2a", d:"50-day MA",  wl:"10-week MA"},
  {k:"d150", n:150, w:30,   ema:false, color:"#7b4bb3", d:"150-day MA", wl:"30-week MA"},
  {k:"d200", n:200, w:40,   ema:false, color:"#15171c", d:"200-day MA", wl:"40-week MA"}];
const DEF_COLORS = {up:"#1d3fc4", down:"#e0337f", vup:"#1d3fc4", vdown:"#e0337f", ma:Object.fromEntries(MAS.map(m=>[m.k, m.color]))};
const DEF_CFG = {scale:"log", bars:"hlc", weight:"bold", grid:"dotted", ants:"on", ma:{d10:false,e21:false,d50:true,d150:false,d200:true}, colors:DEF_COLORS};
const HEX = /^#[0-9a-f]{6}$/i;
function normCfg(c){
  c = c || {}; const col = c.colors || {};
  const pick = (v, d) => HEX.test(v||"") ? v : d;
  return {...DEF_CFG, ...c, ma:{...DEF_CFG.ma, ...(c.ma||{})},
    colors:{up:pick(col.up,DEF_COLORS.up), down:pick(col.down,DEF_COLORS.down), vup:pick(col.vup,DEF_COLORS.vup), vdown:pick(col.vdown,DEF_COLORS.vdown),
      ma:Object.fromEntries(MAS.map(m=>[m.k, pick((col.ma||{})[m.k], DEF_COLORS.ma[m.k])]))}};
}
let cfg = normCfg(store.get("ink:cfg"));
const maCol = m => (cfg.colors.ma||{})[m.k] || m.color;
function applyColors(){ C.up = cfg.colors.up; C.down = cfg.colors.down; C.vup = cfg.colors.vup; C.vdown = cfg.colors.vdown; }
applyColors();
const GRID_DASH = {dotted:[1,3], dashed:[5,4], solid:[]};
function niceStep(x){ const m=Math.pow(10,Math.floor(Math.log10(x))); for(const k of [1,2,2.5,5,10]) if(k*m>=x) return k*m; return 10*m; }
function linTicks(lo, hi, pxH){ const step=niceStep((hi-lo)/Math.max(2,Math.floor(pxH/38))); const out=[]; for(let v=Math.ceil(lo/step)*step; v<=hi; v+=step) out.push(+v.toFixed(6)); return out; }

function settingsHTML(){
  const seg = (key, opts) => `<div class="seg">${opts.map(([v,l])=>`<button data-cfg="${key}" data-v="${v}" class="${cfg[key]===v?'on':''}">${l}</button>`).join("")}</div>`;
  return `<div class="sethd"><b>Chart settings</b><button class="x" id="setClose" aria-label="Close">×</button></div>
    <div class="setrow"><span>Price scale</span>${seg("scale",[["log","Log"],["linear","Linear"]])}</div>
    <div class="setrow"><span>Price bars</span>${seg("bars",[["hlc","O'Neil (H-L-C)"],["ohlc","OHLC"],["candle","Candles"]])}</div>
    <div class="setrow"><span>Bar weight</span>${seg("weight",[["thin","Thin"],["normal","Normal"],["bold","Bold"]])}</div>
    <div class="setrow"><span title="David Ryan's Ants: up at least 12 of the last 15 sessions with volume 20%+ above its 50-day average. Gold when the stock also gained 20%+ in those 15 days.">Ants</span>${seg("ants",[["on","Show"],["off","Hide"]])}</div>
    <div class="setrow"><span>Grid lines</span>${seg("grid",[["dotted","Dotted"],["dashed","Dashed"],["solid","Solid"],["none","None"]])}</div>
    <div class="setrow col"><span>Moving averages <small class="hint">tap a swatch to change its color</small></span><div class="checks">${MAS.map(m=>`<label class="macheck"><input type="checkbox" data-ma="${m.k}" ${cfg.ma[m.k]?'checked':''}><input type="color" class="swatch" data-macol="${m.k}" value="${maCol(m)}" title="${m.d} color" aria-label="${m.d} color">${m.d}${m.wl?` <small>(${m.wl} on weekly)</small>`:` <small>(daily only)</small>`}</label>`).join("")}</div></div>
    <div class="setrow col"><span>Colors</span><div class="colgrid">
      <label><input type="color" class="swatch" data-col="up" value="${cfg.colors.up}">Up bars</label>
      <label><input type="color" class="swatch" data-col="down" value="${cfg.colors.down}">Down bars</label>
      <label><input type="color" class="swatch" data-col="vup" value="${cfg.colors.vup}">Up volume</label>
      <label><input type="color" class="swatch" data-col="vdown" value="${cfg.colors.vdown}">Down volume</label>
    </div></div>
    <div class="setft"><button class="btn" id="setReset">Reset to defaults</button></div>`;
}
function redrawAll(){ applyColors(); if(S && !$("#vChart").hidden){ renderPanels(); draw(); } if(!$("#vHome").hidden) drawHomeChart(); if(!$("#vScreener").hidden) renderScreener(); }
function applyCfg(){ store.set("ink:cfg", cfg); push("cfg", cfg); $("#settings").innerHTML = settingsHTML(); bindSettings(); redrawAll(); }
function bindSettings(){
  $$("#settings [data-cfg]").forEach(b=>b.onclick=()=>{ cfg[b.dataset.cfg]=b.dataset.v; applyCfg(); });
  $$("#settings [data-ma]").forEach(c=>c.onchange=()=>{ cfg.ma[c.dataset.ma]=c.checked; applyCfg(); });
  $("#setReset").onclick=()=>{ cfg = normCfg(JSON.parse(JSON.stringify(DEF_CFG))); applyCfg(); };
  // colors: live preview while dragging, save when the picker closes
  const setCol = (el, v) => { if(el.dataset.col) cfg.colors[el.dataset.col] = v; else cfg.colors.ma[el.dataset.macol] = v; };
  $$("#settings input[type=color]").forEach(el=>{
    el.addEventListener("click", e=>e.stopPropagation());
    el.addEventListener("input", ()=>{ setCol(el, el.value); redrawAll(); });
    el.addEventListener("change", ()=>{ setCol(el, el.value); store.set("ink:cfg", cfg); push("cfg", cfg); redrawAll(); });
  });
  $("#setClose").onclick=()=>toggleSettings(false);
}
function toggleSettings(on){ const p=$("#settings"); on = on==null ? p.hidden : on; p.hidden=!on; $("#gear").setAttribute("aria-expanded", on);
  if(on){ p.innerHTML = settingsHTML(); bindSettings(); } }
$("#gear").onclick = e => { e.stopPropagation(); toggleSettings(); };
document.addEventListener("click", e=>{ const p=$("#settings"), path=e.composedPath(); if(!p.hidden && !path.includes(p) && !path.includes($("#gear"))) toggleSettings(false); });
document.addEventListener("keydown", e=>{ if(e.key==="Escape" && !$("#settings").hidden) toggleSettings(false); });

/* ================= CHART ================= */
let S = null;               // current ticker bundle
let view = { weekly:false, months:18, box:true, piv:true, base:true, idx:true, rsl:true };
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
  const mas = MAS.filter(m=>cfg.ma[m.k] && (!view.weekly || m.w)).map(m=>{ const n = view.weekly ? m.w : m.n;
    return {...m, color: maCol(m), data: m.ema ? ema(base, n, b=>b.c) : sma(base, n, b=>b.c)}; });
  const vma = sma(base, view.weekly?10:50, b=>b.v);
  const bA = alignBench(base);
  const rs = bA ? base.map((b,i)=> bA[i] ? b.c/bA[i] : null) : null;
  const nVis = Math.min(base.length, Math.round(view.months*(view.weekly?4.33:21)));
  return {base, mas, vma, bA, rs, s0: base.length - nVis};
}

function draw(){
  const dpr = window.devicePixelRatio||1; const W = cv.clientWidth;
  if(!W) return;
  const wantH = W < 640 ? 540 : Math.round(Math.max(520, Math.min(760, W*0.47)));
  if(Math.abs(cv.clientHeight - wantH) > 1) cv.style.height = wantH + "px";
  const H = wantH;
  if(cv.width!==Math.round(W*dpr) || cv.height!==Math.round(H*dpr)){ cv.width=Math.round(W*dpr); cv.height=Math.round(H*dpr); }
  ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,W,H);
  ctx.fillStyle = C.plate; ctx.fillRect(0,0,W,H);
  if(!S || !S.px.length) return;
  const F = S.fund || {};
  const sr = series(); const {base,mas,vma,s0} = sr; const bA = view.idx ? sr.bA : null; const rs = view.rsl ? sr.rs : null;
  const vis = base.slice(s0); const n = vis.length;
  const narrow = W < 600;
  const L=6, R= narrow?50:66, T=20, B=18;
  const plotW = W-L-R;
  const Q = (F.quarters||[]).map(q=>({...q, end:qEnd(q.q)})).filter(q=>q.end);
  const hasMargin = Q.some(q=>q.margin);
  const rowH = narrow?11:13, stripRows = Q.length ? (narrow? 3 : (hasMargin?4:3)) : 0;
  const stripH = stripRows*rowH + (stripRows?4:0);
  const totalH = H-T-B-stripH-(stripH?4:0);
  const priceH = Math.round(totalH*0.72), volH = totalH-priceH-4;
  const pTop=T, pBot=T+priceH, vTop=pBot+4, vBot=vTop+volH, sTop=vBot+4, sBot=sTop+stripH;
  const hasIdx = !!bA;
  const prTop = pTop + (hasIdx ? priceH*0.13 : 12), prBot = rs ? pTop + priceH*0.86 : pBot - 24;
  const rsTop = pTop + priceH*0.78, rsBot = pBot - 24;
  const ixTop = pTop + 6, ixBot = pTop + priceH*0.14;
  const bw = plotW/n; const xOf = i => L + (i+0.5)*bw;
  const tDay = n>1 ? (vis[n-1].t - vis[0].t)/(n-1) : 864e5;
  const xAtT = t => { if(t<=vis[0].t) return L + (t-vis[0].t)/tDay*bw + bw/2; if(t>=vis[n-1].t) return xOf(n-1) + (t-vis[n-1].t)/tDay*bw;
    let a=0,b=n-1; while(b-a>1){ const m=(a+b)>>1; if(vis[m].t<=t) a=m; else b=m; } return xOf(a) + (t-vis[a].t)/(vis[b].t-vis[a].t)*bw; };

  let lo=Infinity, hi=-Infinity; for(const b of vis){ lo=Math.min(lo,b.l); hi=Math.max(hi,b.h); }
  const isLog = cfg.scale !== "linear";
  const pad = Math.log(hi/lo)*0.04 || 0.01; const lLo=Math.log(lo)-pad, lHi=Math.log(hi)+pad;
  const linPad = (hi-lo)*0.04 || hi*0.01; const pLo = Math.max(lo-linPad, lo*0.5), pHi = hi+linPad;
  const yOf = isLog ? p => prBot - (Math.log(p)-lLo)/(lHi-lLo)*(prBot-prTop) : p => prBot - (p-pLo)/(pHi-pLo)*(prBot-prTop);
  const pOf = isLog ? y => Math.exp(lLo + (prBot-y)/(prBot-prTop)*(lHi-lLo)) : y => pLo + (prBot-y)/(prBot-prTop)*(pHi-pLo);
  const gridOn = cfg.grid !== "none", gridDash = GRID_DASH[cfg.grid] || [1,3];
  let vMax=0; for(let i=s0;i<base.length;i++) vMax=Math.max(vMax, base[i].v);
  const vY = v => vBot - v/((vMax||1)*1.28)*(volH-2);

  // month grid + labels
  const monthStarts=[]; let lastM=-1;
  for(let i=0;i<n;i++){ const d=new Date(vis[i].t); const m=d.getUTCMonth()+d.getUTCFullYear()*12; if(m!==lastM){ monthStarts.push({i,d}); lastM=m; } }
  ctx.strokeStyle=C.grid; ctx.lineWidth=1; ctx.setLineDash(gridDash);
  const skipM = (narrow && view.months>12) || view.months>24 ? 2 : 1;
  ctx.textBaseline="alphabetic"; ctx.textAlign="center"; let lastLabelX=-99;
  monthStarts.forEach(ms=>{ const x = Math.round(L + ms.i*bw)+.5; const isJan=ms.d.getUTCMonth()===0;
    if(ms.i>0 && gridOn){ ctx.beginPath(); ctx.moveTo(x,pTop); ctx.lineTo(x,vBot); ctx.stroke(); }
    if((ms.d.getUTCMonth()%skipM===0 || isJan) && x-lastLabelX>(narrow?28:34)){
      ctx.fillStyle = isJan? C.ink : C.ink2; ctx.font = `${isJan?700:600} ${narrow?10:11}px ${FONT_L}`;
      ctx.fillText(isJan? String(ms.d.getUTCFullYear()) : MON[ms.d.getUTCMonth()], Math.min(x+14, L+plotW-12), H-5); lastLabelX=x; } });

  // price grid + axis
  ctx.font = `${narrow?10:11}px ${FONT_D}`; ctx.textAlign="left"; ctx.textBaseline="middle"; let lastY = 1e9;
  const ticks = isLog ? logTicks(Math.exp(lLo), Math.exp(lHi), prBot-prTop) : linTicks(pLo, pHi, prBot-prTop);
  for(const t of ticks){ const y=yOf(t); if(y<pTop+4||y>pBot-4 || lastY-y<13) continue; lastY=y;
    ctx.strokeStyle=C.grid; if(gridOn){ ctx.beginPath(); ctx.moveTo(L,Math.round(y)+.5); ctx.lineTo(L+plotW,Math.round(y)+.5); ctx.stroke(); }
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
  for(const m of mas) line(m.data, m.color, m.k==="d50" ? 1.4 : 1.3);

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
  // crisp bars on whole device pixels; blue = close above prior close, pink = below
  const LW = {thin:[1,1,1], normal:[1,2,2], bold:[1,2,3]}[cfg.weight] || [1,2,3];
  const lw = bw >= 9 ? LW[2] : bw >= 4 ? LW[1] : LW[0], off = lw % 2 ? .5 : 0;
  const tickW = Math.max(lw+1, Math.min(cfg.weight==="bold"?7:5, Math.floor(bw*(cfg.weight==="bold"?0.5:0.42))));
  const snapY = v => Math.round(yOf(v)) + off;
  ctx.lineCap = "butt";
  if(cfg.bars === "candle"){
    const bodyW = Math.max(1, Math.min(Math.floor(bw*0.7), 15));
    for(let i=0;i<n;i++){ const b=vis[i]; const prev = s0+i>0 ? base[s0+i-1].c : b.o; const col = b.c >= prev ? C.up : C.down;
      const x=Math.round(xOf(i)); ctx.strokeStyle=col; ctx.lineWidth=1;
      ctx.beginPath(); ctx.moveTo(x+.5, Math.round(yOf(b.h))); ctx.lineTo(x+.5, Math.round(yOf(b.l))); ctx.stroke();
      const yt=Math.round(yOf(Math.max(b.o,b.c))), yb=Math.max(yt+1, Math.round(yOf(Math.min(b.o,b.c)))); const x0=Math.round(x+.5-bodyW/2);
      if(b.c >= b.o && bodyW>2){ ctx.fillStyle=C.plate; ctx.fillRect(x0, yt, bodyW, yb-yt); ctx.strokeRect(x0+.5, yt+.5, bodyW-1, Math.max(0,yb-yt-1)); }
      else { ctx.fillStyle=col; ctx.fillRect(x0, yt, bodyW, yb-yt); } }
  } else {
    ctx.lineWidth = lw;
    for(const up of [true,false]){ ctx.strokeStyle = up ? C.up : C.down; ctx.beginPath();
      for(let i=0;i<n;i++){ const b=vis[i]; const prev = s0+i>0 ? base[s0+i-1].c : b.o; if((b.c >= prev) !== up) continue;
        const x=Math.round(xOf(i))+off; let yh=snapY(b.h), yl=snapY(b.l); if(yl-yh<1) yl=yh+1;
        ctx.moveTo(x,yh-off); ctx.lineTo(x,yl+off);
        if(cfg.bars==="ohlc" && bw>2.4){ ctx.moveTo(x-tickW-off,snapY(b.o)); ctx.lineTo(x,snapY(b.o)); }
        if(bw>1.6){ ctx.moveTo(x,snapY(b.c)); ctx.lineTo(x+tickW+off,snapY(b.c)); } }
      ctx.stroke(); }
  }

  // Ants (David Ryan): 12+ up days in the last 15 with volume 20%+ above its 50-day average; gold if also +20% in price
  if(cfg.ants !== "off" && !view.weekly){
    const mark = new Map();
    for(let g=Math.max(15, s0); g<base.length; g++){
      let up=0; for(let j=g-14;j<=g;j++) if(base[j].c > base[j-1].c) up++;
      if(up < 12) continue;
      let v15=0; for(let j=g-14;j<=g;j++) v15+=base[j].v; v15/=15;
      const avg = vma[g-15]; if(!avg || v15 < avg*1.2) continue;
      const strong = base[g].c / base[g-15].c >= 1.2;
      for(let j=g-14;j<=g;j++) if(j>=s0) mark.set(j, strong || mark.get(j)===true);
    }
    for(const [g, strong] of mark){ const i=g-s0; const x=xOf(i), y=Math.min(prBot+8, yOf(base[g].l)+8);
      ctx.fillStyle = strong ? "#c99a06" : "#2f9e44"; ctx.beginPath(); ctx.arc(x, y, Math.max(1.6, Math.min(2.6, bw*0.3)), 0, 7); ctx.fill(); }
  }

  // RS line + rating
  let rsNewHigh=false;
  if(rs){ let a=Infinity,z=-Infinity; for(let i=s0;i<base.length;i++){ const v=rs[i]; if(v!=null){a=Math.min(a,v);z=Math.max(z,v);} }
    if(isFinite(a) && z>a){ const ry = v => rsBot - (Math.log(v)-Math.log(a))/(Math.log(z)-Math.log(a))*(rsBot-rsTop);
      ctx.strokeStyle=C.rs; ctx.lineWidth=1.3; ctx.beginPath(); let on=false;
      for(let i=0;i<n;i++){ const v=rs[s0+i]; if(v==null){on=false;continue;} on?ctx.lineTo(xOf(i),ry(v)):ctx.moveTo(xOf(i),ry(v)); on=true; } ctx.stroke();
      const last=rs[base.length-1]; let mx=-Infinity;
      for(let i=Math.max(0,base.length-(view.weekly?52:252));i<base.length-1;i++) if(rs[i]!=null) mx=Math.max(mx,rs[i]);
      rsNewHigh = last!=null && last>=mx; const ey=ry(last);
      if(rsNewHigh){ ctx.fillStyle=C.rs; ctx.beginPath(); ctx.arc(xOf(n-1), ey, 4.5, 0, 7); ctx.fill(); }
      if(F.rs){ ctx.fillStyle=C.rs; ctx.font=`700 ${narrow?13:15}px ${FONT_L}`; ctx.textAlign="right"; ctx.textBaseline="middle"; ctx.fillText(F.rs, L+plotW-3, Math.max(rsTop, ey-14)); }
      ctx.fillStyle=C.rs; ctx.font=`600 10px ${FONT_L}`; ctx.textAlign="left"; ctx.textBaseline="top"; ctx.fillText("RS LINE", L+6, rsTop);
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
    ctx.fillStyle = b.c<prev ? C.vdown : C.vup; const w=Math.max(1,Math.round(bw*0.62)); const y=Math.round(vY(b.v)); ctx.fillRect(Math.round(x-w/2), y, w, vBot-y); }
  ctx.strokeStyle=C.vavg; ctx.lineWidth=1; ctx.beginPath(); let on=false;
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
    // last 8 quarters (4 on a phone) in equal columns, oldest on the left
    const SQ = Q.slice(0, narrow ? 4 : 8).reverse(); const cw = plotW / SQ.length;
    SQ.forEach((q, k) => {
      const x0 = L + k*cw, x1 = x0 + cw;
      if(k){ ctx.strokeStyle=C.grid; ctx.setLineDash(gridDash); ctx.beginPath(); ctx.moveTo(Math.round(x0)+.5, sTop); ctx.lineTo(Math.round(x0)+.5, sBot); ctx.stroke(); ctx.setLineDash([]); }
      const cx=(x0+x1)/2, wide = cw > 92;
      ctx.save(); ctx.beginPath(); ctx.rect(x0+1,sTop,cw-2,stripH); ctx.clip();
      ctx.fillStyle=C.ink; ctx.font=`700 ${narrow?9:10}px ${FONT_L}`; ctx.textAlign="center"; ctx.fillText(q.q, cx, sTop+2+rowH*0.5);
      ctx.font=`${narrow?9:10}px ${FONT_D}`;
      pair(cx, sTop+2+rowH*1.5, wide&&!narrow? q.eps : "", q.epsChg);
      pair(cx, sTop+2+rowH*2.5, wide&&!narrow? q.sales : "", q.salesChg);
      if(hasMargin && !narrow){ ctx.fillStyle=C.ink2; ctx.textAlign="center"; ctx.fillText(q.margin||"", cx, sTop+2+rowH*3.5); }
      ctx.restore(); });
  }

  // last price tag + readout + crosshair
  const lb = vis[n-1]; const ly=yOf(lb.c);
  ctx.fillStyle=C.ink; ctx.fillRect(L+plotW+1, ly-8, R-2, 16); ctx.fillStyle="#fff"; ctx.font=`700 ${narrow?10:11}px ${FONT_D}`; ctx.textAlign="left"; ctx.textBaseline="middle"; ctx.fillText(fmtP(lb.c), L+plotW+4, ly+1);
  ctx.font=`700 ${narrow?11:12}px ${FONT_D}`; ctx.fillStyle=C.ink;
  const hi_ = hover>=0 && hover<n ? hover : n-1; const hb = vis[hi_];
  const pc = s0+hi_>0 ? base[s0+hi_-1].c : hb.o;
  const txt = `${fmtD(hb.t)}  O ${fmtP(hb.o)}  H ${fmtP(hb.h)}  L ${fmtP(hb.l)}  C ${fmtP(hb.c)}  ${fmtPct((hb.c/pc-1)*100,2)}  Vol ${fmtV(hb.v)}` + (vma[s0+hi_] ? ` (${fmtPct((hb.v/vma[s0+hi_]-1)*100,0)})` : "");
  ctx.fillText(narrow ? txt.split("  Vol")[0] : txt, L+2, 10);
  if(rsNewHigh && !narrow){ ctx.fillStyle=C.rs; ctx.textAlign="right"; ctx.fillText("● RS LINE AT NEW HIGH", L+plotW, 10); }
  if(hover>=0 && hover<n){ const x=Math.round(xOf(hover))+.5; ctx.strokeStyle="rgba(21,23,28,.35)"; ctx.lineWidth=1; ctx.setLineDash([2,3]);
    ctx.beginPath(); ctx.moveTo(x,pTop); ctx.lineTo(x,vBot); ctx.stroke(); ctx.setLineDash([]); }

  geo = {L,plotW,pTop,pBot,bw,n,vis,yOf,pOf,narrow};
}

/* ---------- drawing tools ---------- */
function idxAt(x){ if(!geo) return -1; const i=Math.floor((x-geo.L)/geo.bw); return i<0||i>=geo.n ? -1 : i; }
function snapPrice(i,y){ const b=geo.vis[i]; let p=geo.pOf(y); for(const v of [b.h,b.l,b.c]){ if(Math.abs(geo.yOf(v)-y)<8){ p=v; break; } } return p; }
function saveMarks(){ if(S){ store.set(marksKey(S.symbol), S.marks); push("marks:"+S.symbol, S.marks); } }
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
  document.title = `${S.symbol} · Ticker&Tape`;
  $("#qPx").textContent = fmtP(st.close);
  $("#qChg").innerHTML = `<span class="${ch<0?'dn':''}">${ch>=0?"+":""}${fmtP(st.close-st.prevClose)} (${fmtPct(ch,2)})</span>`;
  $("#qMeta").textContent = (S.live ? `${fmtLong(iso(st.date))} · ${liveTime()} ET, delayed` : `${fmtLong(iso(st.date))} close`) + ` · Vol ${fmtV(st.volume)}` + (F.exchange? " · "+F.exchange : "");
  const chip = $("#baseChip"); chip.hidden = !(b && b.status); if(b && b.status){ chip.textContent = b.status; chip.className = "chip " + (STATUS_CLASS[b.status]||""); }

  renderPeers(); renderAnalysts(); renderNews();

  const calc = [["52-week high", fmtP(st.hi52)], ["Off 52-week high", fmtPct(st.offHighPct)], ["52-week low", fmtP(st.lo52)],
    ["50-day MA", st.ma50? `${fmtP(st.ma50)} (${fmtPct(st.vs50Pct)})` : "—"], ["200-day MA", st.ma200? `${fmtP(st.ma200)} (${fmtPct(st.vs200Pct)})` : "—"],
    ["Avg volume (50d)", fmtV(st.avgVol50)], ["Avg $ volume (50d)", st.dollarVol50? "$"+fmtV(st.dollarVol50) : "—"], ["Volume vs avg", fmtPct(st.volVsAvgPct,0)],
    ["Up/down volume", st.udRatio==null? "—" : st.udRatio.toFixed(2)], ["ATR (21d)", st.atrPct==null? "—" : st.atrPct.toFixed(2)+"%"],
    ["3-month change", fmtPct(st.perf3m)], ["12-month change", fmtPct(st.perf12m)], ["RS line, 3 months", fmtPct(st.rsLine3mPct)],
    ["RS line at new high", st.rsLineNewHigh==null? "—" : st.rsLineNewHigh? "Yes ●" : "No"],
    ["Last swing high (unbroken)", fmtP(st.resistance)], ["Last swing low (unbroken)", fmtP(st.support)]];
  $("#calc").innerHTML = calc.map(([k,v])=>`<dt>${k}</dt><dd>${esc(v)}</dd>`).join("");

  const Q = (F.quarters||[]).filter(q=>q.q||q.eps);
  const nx = F.nextQ;
  const d = v => esc(v)||'<span class="na">–</span>';
  // growth: blue = 25%+ (strong), plain = 0–25%, pink = decline. surprise: blue = beat, pink = miss. ▲ = faster than the quarter before
  const gc = v => { const x = pnum(v); return x==null ? "" : x < 0 ? "dn" : x >= 25 ? "up" : ""; };
  const sc = v => { const x = pnum(v); return x==null ? "" : x < 0 ? "dn" : x > 0 ? "beat" : ""; };
  const acc = (cur, prev) => { const a = pnum(cur), b = pnum(prev); return a!=null && b!=null && a > b + 0.5 && a > 0 ? '<i class="acc" title="Faster growth than the prior quarter">▲</i>' : ""; };
  const g = (q, k, i) => `<td class="${gc(q[k])}">${acc(q[k], (Q[i+1]||{})[k])}${d(q[k])}</td>`;
  if(F.etf){
    $("#qtrsH").innerHTML = `Top holdings <small>${F.etf.holdings && F.etf.holdings.length ? "by weight" : ""}</small>`;
    const Hd = F.etf.holdings || [];
    const mx = Math.max(1, ...Hd.map(h=>h.pct||0));
    $("#qtrs").innerHTML = Hd.length ? `<table class="hold"><thead><tr><th class="l">Symbol</th><th class="l">Name</th><th>Weight</th></tr></thead><tbody>${
      Hd.map(h=>`<tr data-s="${esc(h.symbol)}"><td class="l"><span class="sym">${esc(h.symbol)}</span></td><td class="l nmc">${esc(h.name)}</td><td class="wcell"><span class="wbar" style="width:${(h.pct/mx*100).toFixed(0)}%"></span><b>${(h.pct||0).toFixed(2)}%</b></td></tr>`).join("")}</tbody></table>
      <p class="tnote">Click a holding to open its chart.</p>`
      : `<div class="empty">${F.pending ? "Holdings load with the fundamentals rotation in the next updates." : "Yahoo does not publish holdings for this fund."}</div>`;
    $$("#qtrs tr[data-s]").forEach(tr=>tr.onclick=()=>{ location.hash = tr.dataset.s; });
  } else {
  $("#qtrsH").innerHTML = `Quarterly earnings &amp; sales <small>reported vs. expected · y/y growth</small>`;
  $("#qtrs").innerHTML = Q.length ? `<table class="qt"><thead><tr><th class="l" rowspan="2">Qtr</th><th colspan="4" class="hgrp">EPS</th><th colspan="4" class="hgrp">Sales</th><th rowspan="2">Op.<br>mgn</th></tr>
      <tr><th class="g0">Actual</th><th>Est.</th><th>Surp.</th><th>Y/Y</th><th class="g0">Actual</th><th>Est.</th><th>Surp.</th><th>Y/Y</th></tr></thead><tbody>${
      nx && nx.q ? `<tr class="next"><td class="l"><span class="nxt">Next</span>${esc(nx.q)}<span class="dt">${nx.date?"reports "+fmtD(iso(nx.date)):""}</span></td><td class="g0"><span class="na">–</span></td><td class="est">${d(nx.epsEst)}</td><td></td><td></td><td class="g0"><span class="na">–</span></td><td class="est">${d(nx.salesEst)}</td><td></td><td></td><td></td></tr>` : ""}${
      Q.map((q,i)=>`<tr><td class="l">${esc(q.q)}<span class="dt">${q.date?fmtD(iso(q.date)):""}</span></td><td class="g0 act">${d(q.eps)}</td><td class="est">${d(q.epsEst)}</td><td class="${sc(q.surprise)}">${d(q.surprise)}</td>${g(q,"epsChg",i)}<td class="g0 act">${d(q.sales)}</td><td class="est">${d(q.salesEst)}</td><td class="${sc(q.salesSurprise)}">${d(q.salesSurprise)}</td>${g(q,"salesChg",i)}<td>${d(q.margin)}</td></tr>`).join("")}</tbody></table>
      <p class="tnote qleg"><span><i class="k up"></i>Growth 25%+ or beat</span><span><i class="k dn"></i>Decline or miss</span><span><i class="acc">▲</i> Faster growth than the quarter before</span><span>EPS adjusted, as reported to analysts</span></p>`
    : `<div class="empty">${F.pending ? "Earnings and sales for this stock are still loading: the site fetches them for a batch of stocks each day, so they appear within the next few updates." : "Yahoo did not return quarterly earnings for this ticker."}</div>`;
  }
  const A = (F.annual||[]).filter(a=>a.y||a.eps).slice(0,10);
  if(F.etf){
    const E = F.etf, SW = E.sectors || [];
    $("#annualH").innerHTML = `Fund profile <small>${esc(E.family||"")}</small>`;
    const prof = [["Tracks", E.tracks], ["Category", E.category], ["Assets", E.aum], ["Expense ratio", E.expense], ["Yield", E.yield], ["Since", E.inception]].filter(r=>r[1]);
    $("#annual").innerHTML = `<dl class="kv in">${prof.map(([k,v])=>`<dt>${k}</dt><dd>${esc(v)}</dd>`).join("")}</dl>` +
      (SW.length ? `<div class="in"><div class="swh">Sector weights</div>${SW.slice(0,11).map(x=>`<div class="swrow"><span>${esc(x.name)}</span><i style="width:${Math.min(100,x.pct)}%"></i><b>${x.pct.toFixed(1)}%</b></div>`).join("")}</div>` : "") +
      (E.gics ? `<div class="in"><a class="btn" href="#screener" data-sector="${esc(E.gics)}">See the ${esc(E.gics)} stocks →</a></div>` : "");
  } else {
  $("#annualH").innerHTML = `Annual earnings &amp; sales <small id="annualN">${A.length ? `last ${A.length} years` : ""}</small>`;
  $("#annual").innerHTML = A.length ? `<table class="qt ann"><thead><tr><th class="l">Year</th><th>EPS</th><th>% chg</th><th>Sales</th><th>% chg</th><th>Net mgn</th></tr></thead><tbody>${A.map(a=>`<tr><td class="l">${esc(a.y)}</td><td class="act">${esc(a.eps)||"–"}</td><td class="${gc(a.chg)}">${esc(a.chg)||"–"}</td><td class="act">${esc(a.sales)||"–"}</td><td class="${gc(a.salesChg)}">${esc(a.salesChg)||"–"}</td><td>${esc(a.netMgn)||"–"}</td></tr>`).join("")}</tbody></table>`
    : `<div class="empty">${F.pending ? "Annual figures load with the fundamentals rotation in the next updates." : "No annual data."}</div>`;
  }
  renderOwnership();

  $("#aboutSec").textContent = F.group || F.sector || "";
  const ab = $("#about"); ab.classList.toggle("muted", !F.about);
  if(!F.about) ab.textContent = F.pending ? "The business description loads with the fundamentals rotation in the next updates." : "No description available.";
  else { const short = shortAbout(F.about);
    ab.innerHTML = esc(short) + (short.length < F.about.length - 20 ? ` <button class="more-link" id="aboutMore">Full description</button>` : "");
    const mb = $("#aboutMore"); if(mb) mb.onclick = () => { ab.textContent = F.about; }; }
  const site = /^https?:\/\//i.test(F.website||"") ? `<a href="${esc(F.website)}" target="_blank" rel="noopener">${esc(F.website.replace(/^https?:\/\/(www\.)?/,"").replace(/\/$/,""))}</a>` : "";
  const K = F.etf ? [["Assets",F.etf.aum],["Expense ratio",F.etf.expense],["Yield",F.etf.yield],["Category",F.etf.category],["Fund family",F.etf.family],["Exchange",F.exchange]].filter(r=>r[1]) : [["Market cap",F.mktCap],["Float",F.float],["Shares out",F.shares],["Institutional",F.inst],["ROE",F.roe],["Pretax margin",F.pretax],
    ["Debt / equity",F.debt],["EPS growth (3y)",F.epsGrowth],["EPS surprises (8q)",F.epsSurprise],["Next earnings",F.nextEarn],["Next qtr EPS est.",F.epsDue],
    ["Group rank",F.groupRank],["Employees",F.employees],["Headquarters",F.hq],["Exchange",F.exchange]].filter(r=>r[1]);
  $("#aboutSec").textContent = F.etf ? (F.etf.tracks || "ETF") : (F.group || F.sector || "");
  $("#keydata").innerHTML = K.map(([k,v])=>`<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join("") + (site?`<div><dt>Website</dt><dd>${site}</dd></div>`:"");

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
  $("#legend").innerHTML = MAS.filter(m=>cfg.ma[m.k] && (!view.weekly || m.w)).map(m=>`<span><span class="sw" style="border-color:${maCol(m)}"></span><b>${view.weekly?m.wl:m.d}</b></span>`).join("") +
    `<span><span class="sw" style="border-color:${C.rs}"></span><b>RS line</b> vs S&amp;P 500</span><span><span class="sw" style="border-color:${C.idx};border-top-width:1px"></span><b>S&amp;P 500</b></span>` +
    `<span><span class="sw" style="border-color:${C.vavg}"></span><b>${nm[2]} avg volume</b></span><span><span class="sw" style="border-color:${C.piv};border-top-style:dotted"></span><b>Unbroken swing</b></span>` +
    `<span><span class="sw" style="border-color:${C.navy};border-top-style:dashed"></span><b>Pivot · buy zone</b></span>${cfg.ants!=="off"&&!view.weekly?`<span><b style="color:#2f9e44">●</b><b style="color:#c99a06">●</b> <b>Ants</b> 12/15 up days on rising volume</span>`:""}<span><b style="color:${C.up}">Up</b> / <b style="color:${C.down}">down</b> bars: close above / below prior close · ${cfg.scale==="linear"?"linear":"log"} scale</span>`;
  renderDbox();
}
// The first one or two sentences of Yahoo's business summary: what the company does, without the history and legal boilerplate
const ABBR = /\b(?:Inc|Corp|Co|Ltd|Cos|Bros|plc|L\.P|N\.V|S\.A|U\.S|U\.K|No|St|Dr|Mr|e\.g|i\.e|etc|approx|vs|Jr|Sr|[A-Z])\.$/;
function sentences(t){ const out=[]; let start=0; const re=/[.!?](?=\s+[A-Z(“"])/g; let m;
  while((m=re.exec(t))){ const chunk=t.slice(start, m.index+1); if(ABBR.test(chunk.trim())) continue; out.push(chunk.trim()); start=m.index+1; }
  const rest=t.slice(start).trim(); if(rest) out.push(rest); return out; }
function shortAbout(t){
  const ss = sentences(String(t).replace(/\s+/g," ").trim()).filter(x=>!/\b(was founded|was incorporated|is headquartered|is based in|formerly known|changed its name|was established)\b/i.test(x));
  if(!ss.length) return t;
  let out = ss[0]; if(out.length < 170 && ss[1] && out.length + ss[1].length < 360) out += " " + ss[1];
  if(out.length > 380){ out = out.slice(0, 370).replace(/[,;:]?\s+\S*$/,"") + "…"; }
  return out;
}

/* ---------- insiders & institutions ---------- */
function renderOwnership(){
  const F = S.fund||{}, O = F.own, sec = $("#ownSec");
  sec.hidden = !!F.etf; if(F.etf) return;
  const wait = `<div class="empty">${F.pending || !O ? "Ownership data loads with the fundamentals rotation in the next updates." : "Not available."}</div>`;
  if(!O){ $("#insiders").innerHTML = wait; $("#institutions").innerHTML = wait; return; }
  const num = v => v==null ? "–" : fmtV(Math.abs(v));
  const s6 = O.insider6m || {};
  const net = s6.netShares;
  const tiles = `<div class="otiles">
      <div title="Shares insiders acquired in the last 6 months, including stock awards"><span>Acquired, 6 mo</span><b class="obuy">${s6.buyShares!=null?num(s6.buyShares):"–"}</b><small>${s6.buyShares!=null?num(s6.buyShares)+" sh · "+(s6.buyTrans??"")+" trades":""}</small></div>
      <div title="Shares insiders sold or disposed of in the last 6 months"><span>Disposed, 6 mo</span><b class="osell">${s6.sellShares!=null?num(s6.sellShares):"–"}</b><small>${s6.sellShares!=null?num(s6.sellShares)+" sh · "+(s6.sellTrans??"")+" trades":""}</small></div>
      <div><span>Net shares</span><b class="${net==null?"":net<0?"osell":"obuy"}">${net==null?"–":(net<0?"−":"+")+num(net)}</b><small>${s6.netPct!=null?fmtPct(s6.netPct,1)+" of holdings":""}</small></div>
      <div><span>Insiders own</span><b>${O.insidersPct!=null?O.insidersPct.toFixed(1)+"%":"–"}</b><small>of shares</small></div>
    </div>`;
  const T = O.insiders || [];
  $("#insiders").innerHTML = tiles + (T.length ? `<div class="tbl"><table class="otab"><thead><tr><th class="l">Date</th><th class="l">Insider</th><th class="l">Type</th><th>Shares</th><th>Value</th></tr></thead><tbody>${
      T.map(t=>`<tr><td class="l">${t.date?fmtD(iso(t.date)):""}</td><td class="l"><span class="who">${esc(t.who)}</span><span class="nm">${esc(t.pos)}</span></td><td class="l"><span class="ttag t-${esc(t.type.toLowerCase())}">${esc(t.type)}</span></td><td>${esc(t.shares)||"–"}</td><td>${t.value?"$"+esc(t.value):"–"}</td></tr>`).join("")}</tbody></table></div>
      <p class="tnote">Open-market buys and sells are what matter: awards and option exercises are pay, not a view on the stock.</p>`
    : `<div class="empty">No insider transactions reported recently.</div>`);
  const H = O.holders || [];
  $("#institutions").innerHTML = `<div class="otiles">
      <div><span>Institutions own</span><b>${O.instPct!=null?O.instPct.toFixed(1)+"%":"–"}</b><small>of shares</small></div>
      <div><span>Of the float</span><b>${O.instFloatPct!=null?O.instFloatPct.toFixed(1)+"%":"–"}</b><small>&nbsp;</small></div>
      <div><span>Institutions</span><b>${O.instCount!=null?O.instCount.toLocaleString("en-US"):"–"}</b><small>holders</small></div>
    </div>` + (H.length ? `<div class="tbl"><table class="otab"><thead><tr><th class="l">Top holders</th><th>% held</th><th>Value</th><th title="Change in the position since the previous quarter">Q/Q chg</th></tr></thead><tbody>${
      H.map(h=>`<tr><td class="l"><span class="who">${esc(h.holder)}</span>${h.date?`<span class="nm">as of ${fmtD(iso(h.date))}</span>`:""}</td><td>${h.pct!=null?h.pct.toFixed(2)+"%":"–"}</td><td>${h.value?"$"+esc(h.value):"–"}</td><td class="${h.chg==null?"":h.chg<0?"dn":"up"}">${h.chg==null?"–":fmtPct(h.chg,1)}</td></tr>`).join("")}</tbody></table></div>
      <p class="tnote">Positions from the latest 13F filings, reported up to 45 days after each quarter ends.</p>` : `<div class="empty">No institutional holders reported.</div>`);
}
/* ---------- analysts & news ---------- */
function renderAnalysts(){
  const F = S.fund||{}, a = F.analysts, tg = F.target||{}, px = (S.stats||{}).close;
  const parts = [["strongBuy","Strong buy","#14306b"],["buy","Buy","#3d63c9"],["hold","Hold","#9a9ca3"],["sell","Sell","#e46a9f"],["strongSell","Strong sell","#b0124f"]];
  const tot = a ? parts.reduce((s,[k])=>s+(a[k]||0),0) : 0;
  $("#anSub").textContent = tg.key ? tg.key.replace(/_/g," ") : "consensus";
  if(!tot && !tg.mean){ $("#analysts").innerHTML = `<div class="empty" style="padding:4px 0">${F.pending?"Loads with the fundamentals rotation.":"No analyst coverage from Yahoo."}</div>`; return; }
  const up = tg.mean && px ? (tg.mean/px-1)*100 : null;
  $("#analysts").innerHTML = (tot ? `<div class="anbar">${parts.filter(([k])=>a[k]).map(([k,l,c])=>`<i style="flex:${a[k]};background:${c}" title="${l}: ${a[k]}"></i>`).join("")}</div>
      <div class="anleg">${parts.map(([k,l,c])=>`<span><i style="background:${c}"></i>${l} <b>${a[k]||0}</b></span>`).join("")}</div>` : "") +
    (tg.mean ? `<dl class="kv" style="margin-top:6px"><dt>Mean price target</dt><dd>${fmtP(tg.mean)} <span class="${up<0?'neg':''}">(${fmtPct(up)})</span></dd>
      <dt>Target range</dt><dd>${fmtP(tg.low)} – ${fmtP(tg.high)}</dd><dt>Analysts</dt><dd>${tg.n||tot}</dd></dl>` : "");
}
function renderNews(){
  const N = (S.fund||{}).news || [];
  const ago = d => { const t = Date.parse(d.length<=19 ? d+"Z" : d); if(!isFinite(t)) return ""; const h=(Date.now()-t)/36e5;
    return h<1 ? "now" : h<24 ? Math.round(h)+"h ago" : h<24*7 ? Math.round(h/24)+"d ago" : fmtD(t); };
  $("#news").innerHTML = N.length ? `<ul class="news">${N.map(n=>`<li><a href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.title)}</a><span>${esc(n.pub||"")}${n.date?` · ${ago(n.date)}`:""}</span></li>`).join("")}</ul>`
    : `<div class="empty" style="padding:4px 0">No recent headlines.</div>`;
}

/* ---------- peers: the stock against the rest of its industry group ---------- */
function renderPeers(){
  const box = $("#peers"); if(!S) return; const me = S.symbol, F = S.fund||{}, st = S.stats||{};
  if(!UNI){ box.innerHTML = `<div class="empty">Loading peers…</div>`; loadUni().then(()=>{ if(S && S.symbol===me) renderPeers(); }).catch(()=>{ box.innerHTML = `<div class="empty">Peers are not available yet.</div>`; }); return; }
  const self = UNI.find(r=>r.symbol===me) || ROWS.find(r=>r.symbol===me);
  const grp = self && self.group;
  const q0 = (F.quarters||[])[0] || {};
  const meRow = {symbol:me, name:S.name, rsRating: F.rs!=null ? +F.rs : self && self.rsRating, smr: smrRating(F) || (self && self.smr),
    udRatio: st.udRatio, epsChg: q0.epsChg || (self && self.epsChg), salesChg: q0.salesChg || (self && self.salesChg), epsGrowth: F.epsGrowth || (self && self.epsGrowth), me:true};
  let peers = grp ? UNI.filter(r=>r.group===grp && r.symbol!==me) : [];
  $("#peersSub").textContent = grp ? `${grp}${F.groupRank?` · rank ${F.groupRank}`:""}` : "same industry group";
  if(!peers.length){ box.innerHTML = `<div class="empty">No other stocks from this industry group in the S&amp;P 1500 / Nasdaq-100.</div>`; return; }
  peers.sort((a,b)=>(b.rsRating||0)-(a.rsRating||0));
  const rows = [meRow, ...peers.slice(0, 9)].sort((a,b)=>(b.rsRating||0)-(a.rsRating||0));
  const n = v => v==null||v===""||v==="—" ? `<span class="na">–</span>` : esc(v);
  box.innerHTML = `<table class="peers"><thead><tr><th class="l">Symbol</th><th title="RS Rating 1–99">RS</th><th title="Sales growth, margins, ROE (A–E)">SMR</th><th title="Up/down volume, 50 days">U/D</th><th title="Latest quarter EPS vs year ago">EPS Δ</th><th title="Latest quarter sales vs year ago">Sales Δ</th><th title="Annual EPS growth, 3 years">EPS 3y</th></tr></thead><tbody>${
    rows.map(r=>`<tr data-s="${esc(r.symbol)}" class="${r.me?'me':''}"><td class="l"><span class="sym">${esc(r.symbol)}</span><span class="nm" title="${esc(r.name)}">${esc(r.name||"")}</span></td>
      <td><span class="rsv ${(r.rsRating||0)>=80?'hot':''}">${n(r.rsRating)}</span></td>
      <td class="${/^[AB]/.test(r.smr||"")?'pos':''}">${n(r.smr)}</td>
      <td class="${(r.udRatio??1)<1?'neg':''}">${r.udRatio==null?n(null):(+r.udRatio).toFixed(2)}</td>
      <td class="${sign(r.epsChg)}">${n(r.epsChg)}</td><td class="${sign(r.salesChg)}">${n(r.salesChg)}</td><td class="${sign(r.epsGrowth)}">${n(r.epsGrowth)}</td></tr>`).join("")}</tbody></table>
    ${peers.length > 9 ? `<p class="tnote">Top ${Math.min(9,peers.length)} of ${peers.length} peers by RS Rating.</p>` : ""}`;
  $$("#peers tr[data-s]").forEach(tr=>tr.onclick=()=>{ if(tr.dataset.s!==me) location.hash = tr.dataset.s; });
}

/* ---------- intraday prices (live.json on the "live" branch, refreshed every 15 min in market hours) ---------- */
let LIVE = null;
const LIVE_URL = (location.hostname === "localhost" || location.protocol === "file:") ? "data/live.json"
  : "https://raw.githubusercontent.com/gslachowicz/fundamental-technical-charts/live/live.json";
const liveTime = () => LIVE ? new Date(LIVE.updated).toLocaleTimeString("en-US",{timeZone:"America/New_York", hour:"numeric", minute:"2-digit"}) : "";
function patchRow(r){
  const q = LIVE && LIVE.q[r.symbol]; if(!q || !r.date) return;
  if(r._c0==null){ r._c0 = r.close; r._chg0 = r.chgPct; }
  let prev; if(LIVE.date > r.date) prev = r._c0; else if(LIVE.date === r.date) prev = r._c0/(1+(r._chg0||0)/100); else return;
  const c = q[3]; r.close = c; r.chgPct = (c/prev-1)*100; r.live = true;
  if(r.base && r.base.pivot) r.base.distPct = +((c/r.base.pivot-1)*100).toFixed(1);
}
function patchS(){
  const q = LIVE && S && LIVE.q[S.symbol]; if(!q) return;
  const t = iso(LIVE.date), last = S.px[S.px.length-1], st = S.stats;
  const bar = {t, o:q[0], h:q[1], l:q[2], c:q[3], v:q[4]};
  if(t > last.t){ S.px.push(bar); st.prevClose = last.c; } else if(t === last.t){ S.px[S.px.length-1] = bar; } else return;
  st.close = q[3]; st.chgPct = (q[3]/st.prevClose-1)*100; st.volume = q[4]; st.date = LIVE.date; S.live = true;
  if(S.base && S.base.pivot) S.base.distPct = +((q[3]/S.base.pivot-1)*100).toFixed(1);
}
function applyLive(){
  if(!LIVE) return;
  ROWS.forEach(patchRow); if(UNI) UNI.forEach(patchRow);
  if(META && META.market){ const sym = {"S&P 500":"^GSPC","Nasdaq Composite":"^IXIC"};
    META.market.forEach(m=>patchRow(Object.assign(m, {symbol: sym[m.name], date: m.date || META.dataDate}))); renderPulse(); }
  $("#asof").textContent = `Data as of ${fmtLong(iso(META.dataDate))} close · live prices ${liveTime()} ET (delayed) · RS vs ${META.universeSize} stocks`;
  if(!$("#vScreener").hidden) renderScreener();
  if(!$("#vHome").hidden) renderHome();
  if(!$("#vHeat").hidden) renderHeat();
  if(S && !$("#vChart").hidden){ patchS(); renderPanels(); draw(); }
}
async function loadLive(){
  if(!LIVE_URL || !META) return;
  try{ const r = await fetch(LIVE_URL + "?t=" + Date.now(), {cache:"no-store"}); if(!r.ok) return;
    const L = await r.json(); if(!L || !L.q || L.date < META.dataDate) return;
    if(LIVE && L.updated === LIVE.updated) return; LIVE = L; applyLive(); }catch(e){}
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
function smrRating(F){
  // Approximation of IBD's SMR (Sales growth, Margins, Return on equity), graded A–E
  const q = (F.quarters||[]).slice(0,3).map(x=>pnum(x.salesChg)).filter(v=>v!=null);
  const a = (F.annual||[]).map(x=>pnum(x.salesChg)).filter(v=>v!=null);
  const sales = q.length ? q.reduce((s,v)=>s+v,0)/q.length : a.length ? a[0] : null;
  const pts = (v, t) => v==null ? null : v>=t[0] ? 3 : v>=t[1] ? 2 : v>=t[2] ? 1 : 0;
  const sc = [pts(sales,[25,15,5]), pts(pnum(F.pretax),[25,15,8]), pts(pnum(F.roe),[25,17,10])].filter(v=>v!=null);
  if(sc.length < 2) return "";
  const avg = sc.reduce((s,v)=>s+v,0)/sc.length;
  return avg>=2.6 ? "A" : avg>=2 ? "B" : avg>=1.3 ? "C" : avg>=0.6 ? "D" : "E";
}
function renderDbox(){
  const box=$("#dbox"); if(!S) return; const F=S.fund||{}, st=S.stats||{};
  if(F.etf){
    const show = view.box && !(geo && geo.narrow); box.hidden = !show; if(!show) return;
    const E = F.etf, H = (E.holdings||[]).slice(0,7);
    const rows = [["RS Rating",F.rs],["U/D Vol Ratio",st.udRatio!=null?st.udRatio.toFixed(2):""],["% vs 52w High",fmtPct(st.offHighPct)],["Assets",E.aum],["Expense",E.expense],["Yield",E.yield]];
    const v = x => x==null||x===""||x==="—" ? `<span class="na">–</span>` : esc(x);
    box.innerHTML = `<div class="hd"><b>${esc(S.symbol)}</b> · ${esc(S.name||F.name||"")}</div><div class="sec">${esc(E.tracks||E.category||"ETF")}</div>
      <div class="cols">${H.length ? `<table><thead><tr><th class="l">Top holdings</th><th>Wt</th></tr></thead><tbody>${H.map(h=>`<tr><td class="l">${esc(h.symbol)}</td><td>${(h.pct||0).toFixed(1)}%</td></tr>`).join("")}</tbody></table>` : `<div class="pend">Holdings load<br>in the next updates</div>`}
      <dl>${rows.map(([k,x])=>`<dt>${k}</dt><dd class="${/^-/.test(x||"")?'neg':''}">${v(x)}</dd>`).join("")}</dl></div>`;
    return;
  }
  const A=(F.annual||[]).filter(a=>a.y||a.eps).slice(0,7).reverse();
  const smr = smrRating(F);
  const rows = [["RS Rating",F.rs],["Group Rank",F.groupRank],["SMR Rating",smr],["U/D Vol Ratio",st.udRatio!=null?st.udRatio.toFixed(2):""],
    ["Mkt Cap",F.mktCap],["% vs 52w High",fmtPct(st.offHighPct)],["EPS Growth Rate",F.epsGrowth],["EPS Surprise",F.epsSurprise]];
  const show = view.box && !(geo && geo.narrow);
  box.hidden = !show; if(!show) return;
  const v = x => x==null||x===""||x==="—" ? `<span class="na">–</span>` : esc(x);
  const tbl = A.length
    ? `<table><thead><tr><th class="l">Year</th><th>EPS</th><th>EPS</th><th>Sales</th></tr></thead><tbody>${A.map(a=>`<tr><td class="l">${esc(a.y)}</td><td>${esc(a.eps)||"–"}</td><td class="${sign(a.chg)}">${esc(a.chg)||"–"}</td><td class="${sign(a.salesChg)}">${esc(a.salesChg)||"–"}</td></tr>`).join("")}</tbody></table>`
    : `<div class="pend">${F.pending ? "Annual EPS &amp; sales<br>load in the next updates" : "No annual data"}</div>`;
  box.innerHTML = `<div class="hd"><b>${esc(S.symbol)}</b> · ${esc(S.name||F.name||"")}</div>` +
    `<div class="sec">Sector: ${esc(F.group || F.sector || "—")}</div>` +
    `<div class="cols">${tbl}<dl>${rows.map(([k,x])=>`<dt>${k}</dt><dd class="${/^-/.test(x||"")?'neg':''}">${v(x)}</dd>`).join("")}</dl></div>`;
}

/* ---------- chart controls ---------- */
$("#pD").onclick=()=>{ view.weekly=false; $("#pD").classList.add("on"); $("#pW").classList.remove("on"); renderPanels(); draw(); };
$("#pW").onclick=()=>{ view.weekly=true; $("#pW").classList.add("on"); $("#pD").classList.remove("on"); renderPanels(); draw(); };
$$("#rangeSeg button").forEach(b=>b.onclick=()=>{ view.months=+b.dataset.r; $$("#rangeSeg button").forEach(x=>x.classList.toggle("on",x===b)); draw(); });
for(const [id,key] of [["#tBox","box"],["#tPiv","piv"],["#tBase","base"],["#tIdx","idx"],["#tRs","rsl"]]){
  $(id).onclick=()=>{ view[key]=!view[key]; $(id).classList.toggle("on",view[key]); $(id).setAttribute("aria-pressed",view[key]); draw(); renderDbox(); }; }
function step(d){ if(!S) return; const L = order.length ? order : ROWS.map(r=>r.symbol); const i=L.indexOf(S.symbol); if(i<0) return; location.hash = L[(i+d+L.length)%L.length]; }
$("#bPrev").onclick=()=>step(-1); $("#bNext").onclick=()=>step(1);
document.addEventListener("keydown", e=>{
  if(e.target.closest("input") || TOUR_ON()) return;
  if(e.key==="Escape" && drag){ drag=null; draw(); }
  if($("#vChart").hidden) return;
  if(e.key==="ArrowRight") step(1); if(e.key==="ArrowLeft") step(-1);
});

async function openChart(sym){
  $("#vScreener").hidden = true; $("#vHome").hidden = true; $("#vChart").hidden = false; $("#loading").hidden = false;
  CUR = sym; updateStar();
  window.scrollTo(0,0);
  try{
    const [bundle] = await Promise.all([getJSON(`t/${encodeURIComponent(sym.replace(/=/g,"_"))}.json`), BENCH ? null : getJSON("bench.json").then(b=>{ BENCH = b.prices.map(([d,c])=>({t:iso(d),c})); })]);
    S = { symbol: bundle.symbol, name: bundle.name, fund: bundle.fund||{}, stats: bundle.stats||{}, base: bundle.base,
      px: bundle.prices.map(([d,o,h,l,c,v])=>({t:iso(d),o,h,l,c,v})), marks: store.get(marksKey(bundle.symbol)) || [] };
    CUR = S.symbol; updateStar(); patchS(); hover=-1; renderPanels(); draw(); renderDbox();
  }catch(e){
    S=null; draw(); $("#sym").textContent = sym; $("#cname").textContent = "";
    toast(inWL(sym) ? `${sym} is in your watchlist: its chart loads after the next nightly update.` : `No data for ${sym} yet. Tap ☆ to add it to your watchlist: it loads after the next nightly update.`);
  }finally{ $("#loading").hidden = true; }
}
const LISTS = {watchlist:"watch", screener:"all", etfs:"etf"};
let lastList = "";
function setTab(v){ $$("#tabs a").forEach(a=>a.classList.toggle("on", a.dataset.v===v)); }
function route(){
  const raw = decodeURIComponent(location.hash.slice(1)).trim();
  const low = raw.toLowerCase();
  const isList = raw === low && LISTS[low];
  const isHome = raw === "" || raw === "home";
  ["#vWelcome","#vHome","#vScreener","#vChart","#vHeat"].forEach(id=>$(id).hidden = true); $("#hmTip").hidden = true;
  document.body.classList.toggle("on-welcome", raw === "welcome");
  document.body.classList.toggle("on-home", isHome);
  if(raw === "welcome"){ $("#vWelcome").hidden = false; setTab(""); document.title = "Ticker&Tape · O'Neil-style charts, RS ratings and bases"; window.scrollTo(0,0); return; }
  if(low === "heatmap"){ lastList = "heatmap"; $("#vHeat").hidden = false; setTab("heat"); document.title = "Heatmap · Ticker&Tape"; window.scrollTo(0,0); renderHeat(); return; }
  if(isHome){ lastList = ""; $("#vHome").hidden = false; setTab("home"); document.title = "Ticker&Tape · Market dashboard"; renderHome(); return; }
  if(isList){ lastList = raw; $("#vScreener").hidden = false; setTab(LISTS[low]); document.title = `${{watch:"Watchlist",all:"Screener",etf:"ETFs"}[LISTS[low]]} · Ticker&Tape`;
    if(LISTS[low] !== "all") scrState.sector = null;
    setScope(LISTS[low]); return; }
  setTab(""); openChart(raw.toUpperCase());
}
$("#bBack").onclick = () => { location.hash = lastList; };   // back to the list (or home) the chart was opened from
$$("#tabs a").forEach(a=>a.addEventListener("click", ()=>{ if(a.dataset.v==="all") scrState.sector = null; }));
document.addEventListener("click", e=>{ const b = e.target.closest("[data-sector]"); if(!b) return; e.preventDefault(); scrState.sector = b.dataset.sector; scrState.filter = "all";
  $$("#filters button").forEach(x=>x.classList.toggle("on", x.dataset.f==="all")); if(location.hash === "#screener") setScope("all"); else location.hash = "screener"; });

/* ================= HOME DASHBOARD ================= */
let HOME = null, homeLoading = null, SPYB = null, movMode = "up";
// home chart: S&P 500 E-mini futures (falls back to SPY until the futures file exists)
const HC = {symbol:"ES=F", file:"ES_F", title:"S&amp;P 500 futures · ES"};
function loadHome(){
  if(!homeLoading) homeLoading = Promise.all([
    getJSON("home.json").then(h=>{ HOME = h; }).catch(()=>{ HOME = {market:[], sectors:[], commodities:[], news:[]}; }),
    getJSON(`t/${HC.file}.json`).catch(()=>{ Object.assign(HC, {symbol:"SPY", file:"SPY", title:"S&amp;P 500 · SPY"}); return getJSON("t/SPY.json"); })
      .then(b=>{ SPYB = b; $("#hcTitle").innerHTML = HC.title; $("#hcLink").setAttribute("href", "#"+HC.symbol); }).catch(()=>{})
  ]);
  return homeLoading;
}
function heat(v, scale){
  if(v==null) return "";
  const a = Math.min(1, Math.abs(v)/scale) * 0.32;
  return v >= 0 ? `background:rgba(29,63,196,${a.toFixed(3)})` : `background:rgba(224,51,127,${a.toFixed(3)})`;
}
const PERF = [["d1","1D",2.5],["w1","1W",5],["m3","3M",12],["m9","9M",22],["ytd","YTD",22]];
let sectSort = {k:"m3", asc:false}, comSort = {k:null, asc:false};
const COM_GROUPS = ["Metals","Energy","Agriculture"];
const fmtC = v => v==null||!isFinite(v) ? "—" : v < 20 ? v.toFixed(3) : fmtP(v);   // natural gas, copper: 3 decimals
function renderHome(){
  renderPulse();
  if(!HOME){ $("#hSect").innerHTML = `<div class="empty">Loading…</div>`; loadHome().then(()=>{ if(!$("#vHome").hidden) renderHome(); }); return; }
  // live 1-day change for the ETFs
  const live = r => { const q = LIVE && LIVE.q[r.symbol]; if(!q || !LIVE.date || LIVE.date < r.date) return r;
    const prev = LIVE.date > r.date ? r.close : r.close/(1+(r.d1||0)/100); return {...r, px:q[3], d1:(q[3]/prev-1)*100, live:true}; };
  const M = (HOME.market||[]).map(live), Sx = (HOME.sectors||[]).map(live);
  const k = sectSort.k, dir = sectSort.asc ? 1 : -1;
  Sx.sort((a,b)=>((a[k]??-1e9)-(b[k]??-1e9))*dir);
  const row = (r, sector) => `<tr data-s="${esc(r.symbol)}"><td class="l"><span class="sym">${esc(r.symbol)}</span><span class="nm">${esc(r.name)}</span></td>
      <td>${fmtP(r.px ?? r.close)}</td>${PERF.map(([k,,sc])=>`<td style="${heat(r[k],sc)}" class="${(r[k]??0)<0?'neg':''}">${fmtPct(r[k],1)}</td>`).join("")}
      <td class="spk"><canvas data-hspark="${esc(r.symbol)}"></canvas></td>
      <td class="l">${sector && r.gics ? `<a href="#screener" class="comp" data-sector="${esc(r.gics)}">Components →</a>` : ""}</td></tr>`;
  $("#hSect").innerHTML = `<table class="scr sect"><thead><tr><th class="l nosort">ETF</th><th class="nosort">Price</th>${PERF.map(([k,l])=>`<th data-hk="${k}" class="${sectSort.k===k?'sorted'+(sectSort.asc?' asc':''):''}">${l}</th>`).join("")}<th class="nosort spk">3 months</th><th class="nosort"></th></tr></thead>
    <tbody><tr class="grp"><td colspan="${PERF.length+4}">Market</td></tr>${M.map(r=>row(r,false)).join("")}
    <tr class="grp"><td colspan="${PERF.length+4}">Sectors <small>click a column to rank them</small></td></tr>${Sx.map(r=>row(r,true)).join("")}</tbody></table>`;
  const all = [...M, ...Sx];
  $$("canvas[data-hspark]").forEach(cv=>{ const r = all.find(x=>x.symbol===cv.dataset.hspark); sparkline(cv, r && r.spark); });
  $$("#hSect th[data-hk]").forEach(th=>th.onclick=()=>{ const k=th.dataset.hk; sectSort = {k, asc: sectSort.k===k ? !sectSort.asc : false}; renderHome(); });
  $$("#hSect tr[data-s]").forEach(tr=>tr.onclick=e=>{ if(e.target.closest("[data-sector]")) return; location.hash = tr.dataset.s; });
  $("#hAsOf").textContent = LIVE ? `1D live, ${liveTime()} ET (delayed)` : (Sx[0] ? `as of ${fmtLong(iso(Sx[0].date))} close` : "");
  renderCommodities(live);
  // news
  const N = HOME.news || [];
  const ago = d => { const t = Date.parse(d && d.length<=19 ? d+"Z" : d); if(!isFinite(t)) return ""; const h=(Date.now()-t)/36e5;
    return h<1 ? "now" : h<24 ? Math.round(h)+"h ago" : h<24*7 ? Math.round(h/24)+"d ago" : fmtD(t); };
  $("#hNews").innerHTML = N.length ? `<ul class="news">${N.slice(0,9).map(n=>`<li><a href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.title)}</a><span>${esc(n.pub||"")}${n.date?` · ${ago(n.date)}`:""}</span></li>`).join("")}</ul>` : `<div class="empty">No headlines right now.</div>`;
  renderHomeLists();
  drawHomeChart();
}
function renderCommodities(live){
  const Cx = (HOME.commodities||[]).map(live), box = $("#hCom");
  if(!Cx.length){ box.innerHTML = `<div class="empty">Commodity prices load after the next nightly update.</div>`; $("#hComAsOf").textContent = ""; return; }
  const k = comSort.k, dir = comSort.asc ? 1 : -1;
  const row = r => `<tr data-s="${esc(r.symbol)}"><td class="l"><span class="sym">${esc(r.name)}</span><span class="nm">${esc(r.symbol.replace("=F",""))} · ${esc(r.unit||"")}</span></td>
      <td>${fmtC(r.px ?? r.close)}</td>${PERF.map(([k,,sc])=>`<td style="${heat(r[k],sc*1.6)}" class="${(r[k]??0)<0?'neg':''}">${fmtPct(r[k],1)}</td>`).join("")}
      <td class="spk"><canvas data-cspark="${esc(r.symbol)}"></canvas></td></tr>`;
  const groups = COM_GROUPS.map(g=>[g, Cx.filter(r=>r.grp===g)]).filter(([,rs])=>rs.length);
  if(k) groups.forEach(([,rs])=>rs.sort((a,b)=>((a[k]??-1e9)-(b[k]??-1e9))*dir));
  box.innerHTML = `<table class="scr sect com"><thead><tr><th class="l nosort">Commodity</th><th class="nosort">Last</th>${PERF.map(([k,l])=>`<th data-ck="${k}" class="${comSort.k===k?'sorted'+(comSort.asc?' asc':''):''}">${l}</th>`).join("")}<th class="nosort spk">3 months</th></tr></thead>
    <tbody>${groups.map(([g,rs],i)=>`<tr class="grp"><td colspan="${PERF.length+3}">${g}${i===0?' <small>click a column to rank within each group</small>':''}</td></tr>${rs.map(row).join("")}`).join("")}</tbody></table>`;
  $$("canvas[data-cspark]").forEach(cv=>{ const r = Cx.find(x=>x.symbol===cv.dataset.cspark); sparkline(cv, r && r.spark); });
  $$("#hCom th[data-ck]").forEach(th=>th.onclick=()=>{ const k=th.dataset.ck; comSort = {k, asc: comSort.k===k ? !comSort.asc : false}; renderCommodities(live); });
  $$("#hCom tr[data-s]").forEach(tr=>tr.onclick=()=>{ location.hash = tr.dataset.s; });
  $("#hComAsOf").textContent = Cx.some(r=>r.live) ? `1D live, ${liveTime()} ET (delayed)` : `as of ${fmtLong(iso(Cx[0].date))} settle`;
}
function renderHomeLists(){
  if(!UNI){ ["#hRS","#hUD","#hMov"].forEach(id=>$(id).innerHTML = `<div class="empty">Loading…</div>`); loadUni().then(()=>{ if(!$("#vHome").hidden) renderHomeLists(); }).catch(()=>{}); return; }
  const pool = UNI.filter(r=>!r.etf && (r.dollarVol50||0) >= 2e7 && r.close);
  const top = (arr, key, desc=true) => arr.filter(r=>r[key]!=null).sort((a,b)=>desc ? b[key]-a[key] : a[key]-b[key]).slice(0,5);
  const li = (r, val, cls="", mid) => `<tr data-s="${esc(r.symbol)}"><td class="l"><span class="sym">${esc(r.symbol)}</span><span class="nm">${esc(r.name)}</span></td><td>${fmtP(r.close)}</td>${mid!==undefined ? mid : `<td class="${(r.chgPct??0)<0?'neg':''}">${fmtPct(r.chgPct,2)}</td>`}<td class="big ${cls}">${val}</td></tr>`;
  const tbl = (rows, head, midHead="Chg") => `<table class="scr mini"><thead><tr><th class="l nosort">Stock</th><th class="nosort">Price</th><th class="nosort">${midHead}</th><th class="nosort">${head}</th></tr></thead><tbody>${rows}</tbody></table>`;
  const rs = pool.filter(r=>r.rsRating!=null).sort((a,b)=>(b.rsRating-a.rsRating) || ((b.perf3m||0)-(a.perf3m||0))).slice(0,5);
  $("#hRS").innerHTML = tbl(rs.map(r=>li(r, `<span class="rsv hot">${r.rsRating}</span>`)).join(""), "RS");
  $("#hUD").innerHTML = tbl(top(pool, "udRatio").map(r=>li(r, r.udRatio.toFixed(2))).join(""), "U/D");
  const mv = top(pool, "chgPct", movMode==="up");
  $("#hMov").innerHTML = tbl(mv.map(r=>li(r, fmtPct(r.chgPct,1), r.chgPct<0?'neg':'up', `<td class="${(r.volVsAvgPct??0)>=40?'up':''}" title="Volume vs 50-day average">${fmtPct(r.volVsAvgPct,0)}</td>`)).join(""), "Chg", "Vol Δ");
  $$("#vHome .hlists tr[data-s]").forEach(tr=>tr.onclick=()=>{ location.hash = tr.dataset.s; });
}
$$("#hMovSeg button").forEach(b=>b.onclick=e=>{ e.stopPropagation(); movMode = b.dataset.m; $$("#hMovSeg button").forEach(x=>x.classList.toggle("on", x===b)); renderHomeLists(); });

// compact S&P 500 futures chart (ES=F): 9 months of daily O'Neil bars, 50/200-day lines and volume, in the user's colors
function drawHomeChart(){
  const c = $("#hcv"); if(!c || $("#vHome").hidden) return;
  const W = c.clientWidth; if(!W) return;
  const side = $(".hside"), twoCol = side && side.getBoundingClientRect().left > c.getBoundingClientRect().right - 5;
  const H = W < 600 ? 300 : twoCol ? Math.round(Math.min(620, Math.max(340, side.offsetHeight - 44))) : Math.round(Math.min(440, Math.max(320, W*0.46)));
  c.style.height = H + "px";
  const dpr = devicePixelRatio || 1; c.width = Math.round(W*dpr); c.height = Math.round(H*dpr);
  const g = c.getContext("2d"); g.setTransform(dpr,0,0,dpr,0,0); g.fillStyle = C.plate; g.fillRect(0,0,W,H);
  if(!SPYB){ g.fillStyle = C.ink2; g.font = `13px ${FONT_D}`; g.fillText("Loading…", 12, 24); return; }
  let px = SPYB.prices.map(([d,o,h,l,cl,v])=>({t:iso(d),o,h,l,c:cl,v}));
  const q = LIVE && LIVE.q[HC.symbol];
  if(q && LIVE.date){ const lt = iso(LIVE.date), last = px[px.length-1];
    if(lt > last.t) px = [...px, {t:lt, o:q[0], h:q[1], l:q[2], c:q[3], v:q[4]||0}];
    else if(lt === last.t) px[px.length-1] = {...last, h:Math.max(last.h,q[1]), l:Math.min(last.l,q[2]), c:q[3]}; }
  const ma = (n) => px.map((_,i)=> i<n-1 ? null : px.slice(i-n+1,i+1).reduce((s,b)=>s+b.c,0)/n);
  const m50 = ma(50), m200 = ma(200);
  const N = Math.min(px.length, 190), s0 = px.length - N, vis = px.slice(s0);
  const R = 58, L = 4, T = 10, B = 18, volH = Math.round((H-T-B)*0.24), pH = H-T-B-volH-6;
  const plotW = W-L-R, bw = plotW/N, x = i => L + (i+0.5)*bw;
  let lo = Infinity, hi = -Infinity; vis.forEach(b=>{ lo=Math.min(lo,b.l); hi=Math.max(hi,b.h); });
  [m50, m200].forEach(m=>m.slice(s0).forEach(v=>{ if(v!=null){ lo=Math.min(lo,v); hi=Math.max(hi,v); } }));
  const pad = (hi-lo)*0.06; lo -= pad; hi += pad;
  const y = v => T + (hi - v)/(hi - lo)*pH;
  // grid + axis
  g.strokeStyle = C.grid; g.setLineDash([1,3]); g.lineWidth = 1; g.fillStyle = C.ink2; g.font = `11px ${FONT_D}`; g.textBaseline = "middle";
  const step = niceStep((hi-lo)/6);
  for(let v = Math.ceil(lo/step)*step; v <= hi; v += step){ const yy = Math.round(y(v))+.5; g.beginPath(); g.moveTo(L,yy); g.lineTo(L+plotW,yy); g.stroke(); g.fillText(fmtP(v), L+plotW+6, yy); }
  g.setLineDash([]);
  // month labels
  g.textBaseline = "alphabetic"; g.textAlign = "center";
  let lastM = -1; vis.forEach((b,i)=>{ const d = new Date(b.t), m = d.getUTCMonth(); if(m!==lastM && i>2){ const xx = Math.round(x(i))+.5; g.strokeStyle = C.grid; g.beginPath(); g.moveTo(xx,T); g.lineTo(xx,T+pH+6+volH); g.stroke(); g.fillText(m===0 ? String(d.getUTCFullYear()) : MON[m], xx, H-5); } lastM = m; });
  // moving averages
  const line = (arr, col, w) => { g.strokeStyle = col; g.lineWidth = w; g.beginPath(); let st=false; arr.slice(s0).forEach((v,i)=>{ if(v==null) return; st ? g.lineTo(x(i),y(v)) : g.moveTo(x(i),y(v)); st=true; }); g.stroke(); };
  const mc = k => (cfg.colors.ma||{})[k] || DEF_COLORS.ma[k];
  line(m200, mc("d200"), 1.4); line(m50, mc("d50"), 1.4);
  // bars
  const lw = bw > 4 ? 2 : 1, tk = Math.max(2, Math.min(5, Math.floor(bw*0.5)));
  vis.forEach((b,i)=>{ const prev = s0+i>0 ? px[s0+i-1].c : b.o; g.strokeStyle = b.c >= prev ? C.up : C.down; g.lineWidth = lw;
    const xx = Math.round(x(i))+.5; g.beginPath(); g.moveTo(xx, y(b.h)); g.lineTo(xx, y(b.l)); g.moveTo(xx, y(b.c)); g.lineTo(xx+tk, y(b.c)); g.stroke(); });
  // last price tag
  const lb = vis[N-1], ly = y(lb.c); g.fillStyle = C.ink; g.fillRect(L+plotW+1, ly-9, R-2, 18); g.fillStyle = "#fff"; g.font = `700 11px ${FONT_D}`; g.textAlign = "left"; g.textBaseline = "middle"; g.fillText(fmtP(lb.c), L+plotW+5, ly+1);
  // volume
  const vT = T+pH+6, vMax = Math.max(...vis.map(b=>b.v||0)) || 1;
  g.strokeStyle = C.ink; g.lineWidth = 1; g.strokeRect(L+.5, T+.5, plotW, pH); g.strokeRect(L+.5, vT+.5, plotW, volH);
  vis.forEach((b,i)=>{ const prev = s0+i>0 ? px[s0+i-1].c : b.o; g.fillStyle = b.c < prev ? C.vdown : C.vup; const h = (b.v||0)/vMax*(volH-4); const w = Math.max(1, Math.round(bw*0.62)); g.fillRect(Math.round(x(i)-w/2), vT+volH-h, w, h); });
  // legend + quote
  g.font = `600 11px ${FONT_L}`; g.textBaseline = "top"; g.textAlign = "left";
  [[mc("d50"),"50-day"],[mc("d200"),"200-day"]].forEach(([col,l],k)=>{ g.fillStyle = col; g.fillRect(L+8+k*70, T+9, 14, 3); g.fillStyle = C.ink2; g.fillText(l, L+26+k*70, T+5); });
  const prevC = px[px.length-2] ? px[px.length-2].c : lb.c, ch = (lb.c/prevC-1)*100;
  $("#hSpyQ").innerHTML = `<b>${nf2.format(lb.c)}</b> <span class="${ch<0?'neg':''}">${fmtPct(ch,2)}</span>`;
}
addEventListener("resize", ()=>{ if(!$("#vHome").hidden) drawHomeChart(); });
/* ================= HEATMAP ================= */
// Squarified treemap: sectors, then stocks inside, sized by market cap and colored by the chosen measure.
const HM = {g:"sp500", c:"chgPct", z:"mcap", k:"rg", rank:"top"};
try{ Object.assign(HM, store.get("tt:heat") || {}); }catch(e){}
const HM_SCALE = {chgPct:3, perf1w:6, perf1m:10, perf3m:20, ytd:30, rsRating:49};
const HM_LABEL = {chgPct:"1-day change", perf1w:"1-week change", perf1m:"1-month change", perf3m:"3-month change", ytd:"year-to-date change", rsRating:"RS Rating"};
const HM_GROUP = {sp500:"S&P 500", ndx:"Nasdaq-100", watch:"Your watchlist"};
const SECTOR_SHORT = {"Information Technology":"Technology", "Communication Services":"Comm. Services", "Consumer Discretionary":"Discretionary",
  "Consumer Staples":"Staples", "Health Care":"Health Care", "Real Estate":"Real Estate"};
let hmTiles = [];
function hmValue(r){
  const k = HM.c; if(k === "rsRating") return r.rsRating;
  if(k === "chgPct") return r.chgPct;
  const v = r[k]; if(v == null) return null;
  // intraday: carry the live move into the longer windows too
  return (r.live && r._c0) ? ((1+v/100)*(r.close/r._c0)-1)*100 : v;
}
function hmRows(){
  if(!UNI) return [];
  if(HM.g === "watch"){ const wl = new Set(getWL()); return UNI.filter(r=>wl.has(r.symbol) && !r.etf); }
  const bit = HM.g === "ndx" ? 2 : 1;
  return UNI.filter(r=>!r.etf && (r.ix||0) & bit);
}
function hmColor(v){
  if(v == null || !isFinite(v)) return "#8d929b";
  const t = Math.max(-1, Math.min(1, (HM.c === "rsRating" ? v-50 : v) / HM_SCALE[HM.c]));
  const site = HM.k === "site";
  const neg = site ? [[224,51,127],[122,15,69]] : [[214,48,49],[110,12,18]];
  const pos = site ? [[29,63,196],[11,34,99]] : [[46,160,67],[10,80,30]];
  const mid = [141,146,155];
  const [a, b] = t < 0 ? neg : pos, u = Math.abs(t);
  // neutral -> bright at |t| = 0.6, bright -> deep at |t| = 1
  const mix = (x,y,f)=>x.map((xv,i)=>Math.round(xv+(y[i]-xv)*f));
  const c = u < 0.6 ? mix(mid, a, u/0.6) : mix(a, b, (u-0.6)/0.4);
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
function squarify(items, x, y, w, h){
  // items: [{v, ...}] sorted desc; returns [{item, x, y, w, h}]
  const out = [], total = items.reduce((s,i)=>s+i.v, 0); if(!total || w<=0 || h<=0) return out;
  const scale = w*h/total; let rest = items.map(i=>({...i, a:i.v*scale}));
  while(rest.length){
    const short = Math.min(w, h); let row = [], best = Infinity;
    for(const it of rest){
      const r2 = [...row, it], s = r2.reduce((a,b)=>a+b.a,0), mx = Math.max(...r2.map(z=>z.a)), mn = Math.min(...r2.map(z=>z.a));
      const worst = Math.max(short*short*mx/(s*s), (s*s)/(short*short*mn));
      if(worst > best) break; best = worst; row = r2;
    }
    const s = row.reduce((a,b)=>a+b.a,0);
    if(w >= h){ const cw = s/h; let yy = y; row.forEach(it=>{ const ch = it.a/cw; out.push({item:it, x, y:yy, w:cw, h:ch}); yy += ch; }); x += cw; w -= cw; }
    else { const ch = s/w; let xx = x; row.forEach(it=>{ const cw = it.a/ch; out.push({item:it, x:xx, y, w:cw, h:ch}); xx += cw; }); y += ch; h -= ch; }
    rest = rest.slice(row.length);
  }
  return out;
}
function renderHeat(){
  const box = $("#hmap"); if(!box || $("#vHeat").hidden) return;
  ["#hmGroup button","#hmColor button","#hmSize button","#hmScheme button","#hmRankSeg button"].forEach((sel,i)=>{
    const key = ["g","c","z","k","rank"][i], attr = ["g","c","z","k","r"][i];
    $$(sel).forEach(b=>b.classList.toggle("on", b.dataset[attr] === HM[key])); });
  $("#hmTitle").textContent = `${HM_GROUP[HM.g]} · ${HM_LABEL[HM.c]}`;
  if(!UNI){ box.innerHTML = `<div class="empty">Loading…</div>`; loadUni().then(()=>{ if(!$("#vHeat").hidden) renderHeat(); }).catch(()=>{ box.innerHTML = `<div class="empty">Could not load the stock list.</div>`; }); return; }
  const rows = hmRows();
  if(!rows.length){ box.innerHTML = `<div class="empty">${HM.g==="watch" ? "Your watchlist is empty. Star a few tickers (☆ next to the symbol) and they show up here." : "The index list loads after the next nightly update."}</div>`; $("#hmRank").innerHTML = ""; return; }
  const W = box.clientWidth, H = Math.max(420, Math.min(900, Math.round(innerHeight - box.getBoundingClientRect().top - 70 + scrollY), Math.round(W*0.62)));
  box.style.height = H + "px";
  const size = r => HM.z === "eq" ? 1 : Math.max(r.mcap || ((r.dollarVol50||0)/1e6*40) || 1000, 300);
  const secs = new Map(); rows.forEach(r=>{ const k = r.sector || "Other"; if(!secs.has(k)) secs.set(k, []); secs.get(k).push(r); });
  const secItems = [...secs].map(([name, rs])=>({name, rs, v: rs.reduce((s,r)=>s+size(r),0)})).sort((a,b)=>b.v-a.v);
  const HD = 17, html = []; hmTiles = [];
  squarify(secItems, 0, 0, W, H).forEach(({item:sec, x, y, w, h})=>{
    const lbl = SECTOR_SHORT[sec.name] || sec.name, showHd = h > 40 && w > 46;
    html.push(`<div class="hmsec" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px">${showHd ? `<b>${esc(lbl)}</b>` : ""}</div>`);
    const inner = squarify(sec.rs.map(r=>({r, v:size(r)})).sort((a,b)=>b.v-a.v), x+1, y+(showHd?HD:1), w-2, h-(showHd?HD:1)-1);
    inner.forEach(({item, x:tx, y:ty, w:tw, h:th})=>{
      const r = item.r, v = hmValue(r), i = hmTiles.length; hmTiles.push({r, v});
      const fs = Math.max(8, Math.min(46, tw/(r.symbol.length*0.66+0.6), th/2.3));
      const vtxt = HM.c === "rsRating" ? (v==null?"—":String(Math.round(v))) : fmtPct(v, 2);
      const lab = tw > 22 && th > 13 ? `<span class="s" style="font-size:${fs.toFixed(1)}px">${esc(r.symbol)}</span>${th > fs*2.2 && tw > 34 ? `<span class="v" style="font-size:${Math.max(8, fs*0.5).toFixed(1)}px">${vtxt}</span>` : ""}` : "";
      html.push(`<div class="hmt" data-i="${i}" style="left:${tx}px;top:${ty}px;width:${tw}px;height:${th}px;background:${hmColor(v)}">${lab}</div>`);
    });
  });
  box.innerHTML = html.join("");
  // legend
  const sc = HM_SCALE[HM.c], steps = [-1,-.75,-.5,-.25,0,.25,.5,.75,1];
  $("#hmLeg").innerHTML = steps.map(t=>{ const v = HM.c==="rsRating" ? 50+t*sc : t*sc;
    return `<span style="background:${hmColor(v)}">${HM.c==="rsRating" ? Math.round(v) : (v>0?"+":"")+(+v.toFixed(2))+"%"}</span>`; }).join("");
  $("#hmAsOf").textContent = LIVE ? `live ${liveTime()} ET (delayed)` : (META ? `as of ${fmtLong(iso(META.dataDate))} close` : "");
  renderHeatRank();
}
function renderHeatRank(){
  const list = hmTiles.filter(t=>t.v!=null).sort((a,b)=> HM.rank==="top" ? b.v-a.v : a.v-b.v).slice(0, Math.max(10, Math.min(40, Math.floor(($("#hmap").offsetHeight + 40) / 40))));
  const vt = v => HM.c === "rsRating" ? Math.round(v) : fmtPct(v, 2);
  $("#hmRank").innerHTML = `<table class="scr mini"><thead><tr><th class="l nosort">Stock</th><th class="nosort">Price</th><th class="nosort">${HM.c==="rsRating"?"RS":esc(HM_LABEL[HM.c].replace(" change",""))}</th></tr></thead><tbody>${
    list.map(t=>`<tr data-s="${esc(t.r.symbol)}"><td class="l"><span class="sym">${esc(t.r.symbol)}</span><span class="nm">${esc(t.r.name)}</span></td><td>${fmtP(t.r.close)}</td><td class="big ${t.v<(HM.c==="rsRating"?50:0)?'neg':'up'}">${vt(t.v)}</td></tr>`).join("")}</tbody></table>`;
  $$("#hmRank tr[data-s]").forEach(tr=>{ tr.onclick = ()=>{ location.hash = tr.dataset.s; };
    tr.onmouseenter = ()=>{ const i = hmTiles.findIndex(t=>t.r.symbol===tr.dataset.s); const el = $(`#hmap .hmt[data-i="${i}"]`); if(el) el.classList.add("hl"); };
    tr.onmouseleave = ()=>{ $$("#hmap .hmt.hl").forEach(e=>e.classList.remove("hl")); }; });
}
function hmTip(e){
  const tip = $("#hmTip"), el = e.target.closest(".hmt");
  if(!el){ tip.hidden = true; return; }
  const t = hmTiles[+el.dataset.i]; if(!t) return; const r = t.r;
  const cell = (l, v, cls="") => `<dt>${l}</dt><dd class="${cls}">${v}</dd>`;
  const pc = v => v==null ? "—" : fmtPct(v, 2), neg = v => (v??0) < 0 ? "neg" : "";
  tip.innerHTML = `<div class="th"><b>${esc(r.symbol)}</b> <span>${esc(r.name)}</span></div><div class="ts">${esc([SECTOR_SHORT[r.sector]||r.sector, r.group].filter(Boolean).join(" · "))}</div>
    <canvas id="hmTipCv"></canvas>
    <dl>${cell("Price", fmtP(r.close))}${cell("1D", pc(r.chgPct), neg(r.chgPct))}${cell("1W", pc(r.perf1w), neg(r.perf1w))}${cell("1M", pc(r.perf1m), neg(r.perf1m))}${cell("3M", pc(r.perf3m), neg(r.perf3m))}${cell("YTD", pc(r.ytd), neg(r.ytd))}${cell("RS Rating", r.rsRating ?? "—")}${cell("Mkt cap", r.mcap ? "$"+fmtBigM(r.mcap) : "—")}</dl>`;
  tip.hidden = false; sparkline($("#hmTipCv"), r.spark);
  const pw = tip.offsetWidth, ph = tip.offsetHeight; let x = e.clientX + 16, y = e.clientY + 16;
  if(x + pw > innerWidth - 8) x = e.clientX - pw - 16; if(y + ph > innerHeight - 8) y = innerHeight - ph - 8;
  tip.style.left = x + "px"; tip.style.top = y + "px";
}
const fmtBigM = m => m >= 1e6 ? (m/1e6).toFixed(2)+"T" : m >= 1e3 ? (m/1e3).toFixed(m>=1e5?0:1)+"B" : Math.round(m)+"M";
$("#hmap").addEventListener("mousemove", hmTip);
$("#hmap").addEventListener("mouseleave", ()=>{ $("#hmTip").hidden = true; });
$("#hmap").addEventListener("click", e=>{ const el = e.target.closest(".hmt"); if(!el) return; $("#hmTip").hidden = true; const t = hmTiles[+el.dataset.i]; if(t) location.hash = t.r.symbol; });
[["#hmGroup","g","g"],["#hmColor","c","c"],["#hmSize","z","z"],["#hmScheme","k","k"],["#hmRankSeg","rank","r"]].forEach(([sel,key,attr])=>
  $$(sel+" button").forEach(b=>b.onclick = e=>{ e.stopPropagation(); HM[key] = b.dataset[attr]; store.set("tt:heat", HM); key === "rank" ? (renderHeatRank(), $$("#hmRankSeg button").forEach(x=>x.classList.toggle("on", x===b))) : renderHeat(); }));
let hmResize = 0; addEventListener("resize", ()=>{ clearTimeout(hmResize); hmResize = setTimeout(()=>{ if(!$("#vHeat").hidden) renderHeat(); }, 120); });



/* ================= ACCOUNTS & SYNC (api.tickerandtape.com) ================= */
const API = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? "http://127.0.0.1:8787" : "https://api.tickerandtape.com";
const auth = { token: store.get("tt:token"), email: store.get("tt:email") };
async function api(path, opts={}){
  const headers = {"Content-Type":"application/json"}; if(auth.token) headers.Authorization = "Bearer " + auth.token;
  let r; try{ r = await fetch(API + path, {...opts, headers}); }catch(e){ throw new Error("Could not reach the server. Check your connection."); }
  const j = await r.json().catch(()=>({}));
  if(r.status===401 && auth.token && !path.startsWith("/auth/")){ signedOut(true); }
  if(!r.ok) throw new Error(j.error || "Something went wrong. Try again.");
  return j;
}
const pushT = {};
function push(key, value){
  if(!auth.token) return;
  clearTimeout(pushT[key]);
  pushT[key] = setTimeout(()=>api("/data/" + encodeURIComponent(key), {method:"PUT", body: JSON.stringify({value})})
    .catch(e=>toast("Could not save to your account: " + e.message)), 500);
}
function localMarkKeys(){ const out=[]; try{ for(let i=0;i<localStorage.length;i++){ const k=localStorage.key(i); if(k && k.startsWith("ink:marks:")) out.push(k); } }catch(e){} return out; }
async function pullData(fresh){
  // fresh = just signed in / signed up: anything only on this device goes up to the account
  let d; try{ d = await api("/data"); }catch(e){ return; }
  if(Array.isArray(d.watchlist)){ WL = d.watchlist; store.set("tt:wl", WL); }
  else if(fresh){ WL = getWL().slice(); store.set("tt:wl", WL); push("watchlist", WL); }
  if(d.cfg && typeof d.cfg==="object"){ cfg = normCfg(d.cfg); store.set("ink:cfg", cfg); redrawAll(); }
  else if(fresh){ push("cfg", cfg); }
  const remote = new Set();
  for(const [k,v] of Object.entries(d)){ if(k.startsWith("marks:")){ remote.add(k); store.set("ink:" + k, v); } }
  if(fresh) localMarkKeys().forEach(k=>{ const key = k.slice(4); const v = store.get(k); if(!remote.has(key) && Array.isArray(v) && v.length) push(key, v); });
  if(needsUni()) loadUni().catch(()=>{});
  if(S){ S.marks = store.get(marksKey(S.symbol)) || []; draw(); renderDbox(); }
  updateStar();
  if(!$("#vScreener").hidden) renderScreener();
}
function signedOut(expired){
  auth.token = auth.email = null;
  try{ localStorage.removeItem("tt:token"); localStorage.removeItem("tt:email"); localStorage.removeItem("tt:wl"); localMarkKeys().forEach(k=>localStorage.removeItem(k)); }catch(e){}
  WL = null; if(S){ S.marks = []; draw(); }
  renderAcct(); updateStar(); if(!$("#vScreener").hidden) renderScreener();
  if(expired) toast("Your session expired. Sign in again to sync your watchlist.");
}
function renderAcct(){
  const b = $("#acct"); b.textContent = auth.email ? auth.email.split("@")[0] : "Sign in";
  b.title = auth.email ? `Signed in as ${auth.email}` : "Sign in or create a free account";
  b.classList.toggle("on", !!auth.email);
}
function toggleMenu(on){
  const m = $("#acctMenu"); on = on==null ? m.hidden : on; m.hidden = !on; $("#acct").setAttribute("aria-expanded", on);
  if(on) m.innerHTML = `<div class="who">Signed in as<br><b>${esc(auth.email)}</b></div><button data-a="pw" role="menuitem">Change password</button><button data-a="out" role="menuitem">Sign out</button>`;
}
$("#acct").onclick = e => { e.stopPropagation(); if(auth.token) toggleMenu(); else openAuth("in"); };
$("#acctMenu").addEventListener("click", async e=>{
  const a = e.target.closest("button[data-a]"); if(!a) return; toggleMenu(false);
  if(a.dataset.a==="pw") openAuth("pw");
  if(a.dataset.a==="out"){ try{ await api("/auth/logout", {method:"POST"}); }catch(err){} signedOut(); toast("Signed out."); }
});
document.addEventListener("click", e=>{ const m=$("#acctMenu"); if(!m.hidden && !e.composedPath().includes(m)) toggleMenu(false); });

let authMode = "in";
const AUTH_TXT = {
  in:  {t:"Sign in", go:"Sign in", sw:"New here?", tg:"Create a free account", pw:"Password", ac:"current-password"},
  up:  {t:"Create your account", go:"Create account", sw:"Already have an account?", tg:"Sign in", pw:"Password (8+ characters)", ac:"new-password"},
  pw:  {t:"Change password", go:"Save new password", pw:"New password (8+ characters)", ac:"new-password"}};
function openAuth(mode){
  authMode = mode; const T = AUTH_TXT[mode];
  $("#authTitle").textContent = T.t; $("#aGo").textContent = T.go; $("#aPwLbl").textContent = T.pw; $("#aPw").autocomplete = T.ac;
  $("#fEmail").hidden = mode==="pw"; $("#fCur").hidden = mode!=="pw"; $("#aSwitch").hidden = mode==="pw";
  $("#authSub").hidden = mode==="pw";
  if(T.sw){ $("#aSwTxt").textContent = T.sw; $("#aToggle").textContent = T.tg; }
  $("#aErr").hidden = true; $("#aPw").value = ""; $("#aCur").value = "";
  $("#authModal").hidden = false; setTimeout(()=>(mode==="pw" ? $("#aCur") : $("#aEmail").value ? $("#aPw") : $("#aEmail")).focus(), 30);
}
const closeAuth = () => { $("#authModal").hidden = true; };
$("#authClose").onclick = closeAuth;
$("#authModal").addEventListener("mousedown", e=>{ if(e.target.id==="authModal") closeAuth(); });
document.addEventListener("keydown", e=>{ if(e.key==="Escape" && !$("#authModal").hidden) closeAuth(); });
$("#aToggle").onclick = () => openAuth(authMode==="in" ? "up" : "in");
$("#authForm").addEventListener("submit", async e=>{
  e.preventDefault();
  const email = $("#aEmail").value.trim(), pw = $("#aPw").value, err = $("#aErr"), go = $("#aGo");
  err.hidden = true;
  if(authMode!=="pw" && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)){ err.textContent = "Enter a valid email address."; err.hidden = false; return; }
  if(pw.length < 8 && authMode!=="in"){ err.textContent = "Use a password of at least 8 characters."; err.hidden = false; return; }
  go.disabled = true;
  try{
    if(authMode==="pw"){
      await api("/auth/password", {method:"POST", body: JSON.stringify({current: $("#aCur").value, password: pw})});
      closeAuth(); toast("Password changed.");
    } else {
      const r = await api(authMode==="up" ? "/auth/signup" : "/auth/login", {method:"POST", body: JSON.stringify({email, password: pw})});
      auth.token = r.token; auth.email = r.email; store.set("tt:token", r.token); store.set("tt:email", r.email);
      closeAuth(); renderAcct();
      toast(authMode==="up" ? "Account created. Your watchlist now syncs to every device." : `Welcome back, ${r.email}.`);
      await pullData(true);
      store.set("tt:welcomed", true);
      if(!$("#vWelcome").hidden){ location.hash = ""; if(authMode==="up" && !store.get("tt:toured")) setTimeout(startTour, 700); }
    }
  }catch(ex){ err.textContent = ex.message; err.hidden = false; }
  finally{ go.disabled = false; }
});

/* ---------- star on the chart page ---------- */
function updateStar(){
  const b = $("#star"); if(!b) return; const on = !!CUR && inWL(CUR);
  b.textContent = on ? "★" : "☆"; b.classList.toggle("on", on); b.setAttribute("aria-pressed", on);
  b.title = on ? "Remove from your watchlist" : "Add to your watchlist"; b.hidden = !CUR;
}
$("#star").onclick = () => {
  if(!CUR) return; const L = getWL().slice(); const i = L.indexOf(CUR);
  if(i >= 0){ L.splice(i,1); toast(`${CUR} removed from your watchlist.`); }
  else {
    if(L.length >= 300){ toast("Your watchlist is full (300 tickers)."); return; }
    L.push(CUR);
    const hasData = ROWS.some(r=>r.symbol===CUR) || (UNI && UNI.some(r=>r.symbol===CUR));
    toast(!hasData ? `${CUR} added. Its data loads after the next nightly update.` : auth.token ? `${CUR} added to your watchlist.` : `${CUR} added. Sign in or create a free account to keep it on every device.`);
  }
  WL = L; store.set("tt:wl", WL); push("watchlist", WL); updateStar();
};

/* ================= WELCOME PAGE ================= */
$("#vWelcome").addEventListener("click", e=>{
  const b = e.target.closest("[data-w]"); if(!b) return;
  const w = b.dataset.w;
  if(w==="up") openAuth("up");
  else if(w==="in") openAuth("in");
  else if(w==="explore"){ store.set("tt:welcomed", true); location.hash = ""; if(!store.get("tt:toured")) setTimeout(startTour, 700); }
});

/* ================= GUIDED TOUR ================= */
// v: "s" = screener, "c" = chart, "*" = any. up: highlight the whole button group.
const TOUR = [
  {v:"h", sel:"#tabs", t:"Four rooms",
   b:"Home is the market dashboard. Watchlist holds the stocks you starred. Screener lists every S&P 1500 and Nasdaq-100 stock, about 1,500 names rated every trading day. ETFs covers indexes, sectors, industries, commodities, bonds and countries. Heatmap shows the S&P 500, the Nasdaq-100 or your watchlist as a map of boxes sized by market cap and colored by performance or RS Rating."},
  {v:"h", sel:"#hSect", t:"Sector scoreboard",
   b:"The market ETFs and the eleven Select Sector SPDRs with their 1-day, 1-week, 3-month, 9-month and year-to-date change. Click a column to rank the sectors, a row to open its chart, or Components to see the stocks in that sector. Next to it, the commodities board shows metals, energy and grains futures on the same scale."},
  {v:"h", sel:".hlists", t:"What is leading",
   b:"The five highest RS Ratings, the strongest accumulation by up/down volume and the biggest movers of the day, among stocks with real liquidity."},
  {v:"h", sel:"#hPulse", t:"Market pulse",
   b:"The S&P 500 and the Nasdaq against their 21, 50 and 200-day lines, plus distribution days (heavy-volume declines) in the last 25 sessions. Most stocks follow the market's direction."},
  {v:"s", sel:"#filters", t:"Filter for setups",
   b:"Breakout / buy zone: up to 5% above the pivot. Near pivot: within 5% below it. RS ≥ 80: the strongest fifth of the market. Liquid: $20M or more traded a day."},
  {v:"s", sel:'#scr th[data-k="rsRating"]', t:"RS Rating",
   b:"Relative strength from 1 to 99: twelve-month price performance, with the last quarter counted double, ranked against about 1,500 stocks. 80 and up is leadership territory. Click any column header to sort by it."},
  {v:"s", sel:'#scr th[data-k="baseType"]', t:"Base, pivot and status",
   b:"The base the stock is building (cup, cup with handle, flat base), its pivot or buy point, how far price is from it, and the status: Near pivot, Breakout, In buy zone, Extended."},
  {v:"s", sel:"#jump", t:"Jump to any ticker",
   b:"Type a symbol and press Enter to open its chart. Tickers outside the indexes work too: star them and they load after the next nightly update."},
  {v:"c", sel:"#star", t:"Star it",
   b:"Tap the star next to the symbol to add the stock to your watchlist, or tap again to remove it."},
  {v:"c", sel:"#chartbox", t:"Reading the chart",
   b:"Up bars closed higher than the day before, down bars closed lower. The colored lines are the moving averages. The dark line under the price is the RS line against the S&P 500, with the RS Rating at its end. The dashed line marks the pivot, and each E is an earnings report. Volume sits underneath."},
  {v:"c", sel:"#pD", up:true, t:"Daily or weekly",
   b:"Switch between daily and weekly bars, and pick the time range next to it: 6 months to 3 years."},
  {v:"c", sel:"#bLine", up:true, t:"Draw and take notes",
   b:"Line: drag across the chart to draw a trendline. Note: click a bar and type. Your drawings stay with the chart, and sync to your account when you are signed in."},
  {v:"c", sel:".boxes", t:"Fundamentals under the chart",
   b:"Peers, chart statistics, annual and quarterly earnings and sales, the base analysis, analysts and news. Further down: insider buying and selling, and the largest institutional holders."},
  {v:"*", sel:"#gear", t:"Make the chart yours",
   b:"Log or linear scale, O'Neil bars, OHLC or candles, bar weight, moving averages, grid lines, and the colors of the bars, the volume and every moving average."},
  {v:"*", sel:"#acct", t:"Your account",
   b:"Sign in to keep your watchlist, chart settings and drawings on every device. You can replay this tour anytime with the ? button."}
];
let tourI = -1, tourEl = null;
const TOUR_ON = () => tourI >= 0;
const sleep = ms => new Promise(r=>setTimeout(r, ms));
async function waitFor(f, ms=6000){ const t0=Date.now(); while(!f() && Date.now()-t0 < ms) await sleep(80); }
function startTour(){
  toggleSettings(false); toggleMenu(false); closeAuth();
  tourI = 0; store.set("tt:toured", true); store.set("tt:welcomed", true);
  $("#tour").hidden = false; showStep();
}
function endTour(){ tourI = -1; tourEl = null; $("#tour").hidden = true; }
async function ensureView(v){
  if(v==="h" && $("#vHome").hidden){ location.hash = ""; await waitFor(()=>!$("#vHome").hidden && HOME); await sleep(150); }
  if(v==="s" && $("#vScreener").hidden){ location.hash = "watchlist"; await waitFor(()=>!$("#vScreener").hidden); }
  if(v==="c" && ($("#vChart").hidden || !S || (S.fund||{}).etf)){
    const have = r => r && !r.pending && !r.etf;
    const pick = (watchRows().find(have) || ROWS[0] || {symbol:"NVDA"}).symbol;
    location.hash = pick;
    await waitFor(()=>!$("#vChart").hidden && S && $("#loading").hidden);
  }
  if(v==="*" && !$("#vWelcome").hidden){ location.hash = ""; await waitFor(()=>!$("#vHome").hidden); }
}
async function showStep(){
  const i = tourI, st = TOUR[i];
  await ensureView(st.v);
  if(i !== tourI) return;
  let el = $(st.sel); if(el && st.up) el = el.closest(".seg,.grp") || el;
  if(!el || !el.getClientRects().length){ return go(tourI < TOUR.length-1 ? 1 : 0); }
  tourEl = el;
  el.scrollIntoView({block: el.offsetHeight > innerHeight*0.6 ? "start" : "center", inline:"center", behavior:"smooth"});
  $("#tNum").textContent = `Step ${i+1} of ${TOUR.length}`;
  $("#tTitle").textContent = st.t; $("#tBody").textContent = st.b;
  $("#tBack").hidden = i === 0;
  $("#tNext").textContent = i === TOUR.length-1 ? "Done" : "Next";
  placeTour(); await sleep(400); if(i === tourI) placeTour();
  $("#tNext").focus({preventScroll:true});
}
function placeTour(){
  if(!tourEl) return;
  const r = tourEl.getBoundingClientRect(), pad = 6, sp = $("#tspot"), card = $("#tcard");
  const top = Math.max(4, r.top - pad), bottom = Math.min(innerHeight - 4, r.bottom + pad);
  Object.assign(sp.style, {left:(r.left-pad)+"px", top:top+"px", width:(r.width+pad*2)+"px", height:Math.max(0,bottom-top)+"px"});
  const cw = card.offsetWidth, ch = card.offsetHeight, m = 12;
  let y = bottom + m;
  if(y + ch > innerHeight - 8) y = top - ch - m;
  if(y < 8) y = Math.max(8, innerHeight - ch - 12);
  let x = Math.min(Math.max(8, r.left + r.width/2 - cw/2), innerWidth - cw - 8);
  Object.assign(card.style, {left:x+"px", top:y+"px"});
}
function go(d){ const n = tourI + d; if(n < 0) return; if(n >= TOUR.length) return endTour(); tourI = n; showStep(); }
$("#tNext").onclick = () => go(1);
$("#tBack").onclick = () => go(-1);
$("#tSkip").onclick = endTour;
$("#help").onclick = e => { e.stopPropagation(); startTour(); };
document.addEventListener("click", e=>{ if(e.target.closest("[data-tour]")) startTour(); });
document.addEventListener("keydown", e=>{
  if(!TOUR_ON()) return;
  if(e.key==="Escape") endTour();
  else if(e.key==="ArrowRight"){ e.preventDefault(); go(1); }
  else if(e.key==="ArrowLeft"){ e.preventDefault(); go(-1); }
});
addEventListener("resize", ()=>{ if(TOUR_ON()) placeTour(); });
addEventListener("scroll", ()=>{ if(TOUR_ON()) placeTour(); }, true);

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
  fillSymlist();
  renderPulse();
  renderAcct();
  if(needsUni()) loadUni().catch(()=>{});
  if(auth.token) pullData(false);
  $("#scope").hidden = true;
  loadHome();
  setTimeout(()=>loadUni().catch(()=>{}), 400);   // background: full list for the ticker search
  if(!auth.token && !store.get("tt:welcomed") && !location.hash) history.replaceState(null, "", "#welcome");
  window.addEventListener("hashchange", route); route();
  loadLive(); setInterval(loadLive, 3*60*1000);
  document.addEventListener("visibilitychange", ()=>{ if(!document.hidden) loadLive(); });
  let rz; new ResizeObserver(()=>{ cancelAnimationFrame(rz); rz=requestAnimationFrame(()=>{ if(S && !$("#vChart").hidden){ draw(); renderDbox(); } }); }).observe(cv);
  if(document.fonts && document.fonts.ready) document.fonts.ready.then(()=>{ if(S) draw(); });
})();
})();

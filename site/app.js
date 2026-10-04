/* Ticker&Tape — screener + O'Neil-style chart. Reads static JSON from ./data/ */
(() => {
"use strict";
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const DATA = "/data/";
const C = {ink:"#15171c", ink2:"#5a5d66", grid:"#c9cbd3", up:"#1d3fc4", down:"#e0337f", ma50:"#d23a2a", ma200:"#15171c", ema:"#5fa35a",
  blue:"#1d3fc4", rs:"#0b2263", navy:"#1f3c6e", idx:"#7d808a", plate:"#ffffff", vavg:"#15171c", piv:"#3c8a3a", zone:"rgba(29,63,196,.07)"};
const FONT_D = '"Courier Prime", "Courier New", monospace', FONT_L = '"Archivo Narrow", "Arial Narrow", Arial, sans-serif';

const store = {
  get(k){ try{ const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; }catch(e){ return null; } },
  set(k,v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
};
/* ---------- clean URLs: /chart/NVDA/, /breadth/, /compare/ … (old #NVDA links still work and get rewritten) ---------- */
const SECTIONS = ["watchlist","portfolio","screener","etfs","groups","heatmap","breadth","ideas","research","macro","earnings","compare","wall","welcome"];
function keyToPath(k){
  k = String(k || "").replace(/^#/, "").trim(); const low = k.toLowerCase();
  if(!k || low === "home") return "/";
  if(k === low && SECTIONS.includes(low)) return "/" + low + "/";     // sections are lowercase, tickers uppercase
  if(low.startsWith("compare/")) return "/compare/?t=" + encodeURIComponent(k.slice(8)).replace(/%2C/gi, ",").replace(/%3A/gi, ":");
  return "/chart/" + encodeURIComponent(k.toUpperCase()).replace(/%3D/gi, "=").replace(/%5E/gi, "^") + "/";
}
function pathToKey(){
  const p = location.pathname.replace(/index\.html$/, ""); let m;
  if((m = p.match(/^\/chart\/([^\/]+)\/?$/))) return decodeURIComponent(m[1]).toUpperCase();
  if((m = p.match(/^\/([a-z]+)\/?$/)) && SECTIONS.includes(m[1])){
    if(m[1] === "compare"){ const t = new URLSearchParams(location.search).get("t"); if(t) return "compare/" + t; }
    return m[1]; }
  return "";
}
const here = () => "#" + pathToKey();          // the current view, in the old "#key" form
function go(k){ const path = keyToPath(k); if(path !== location.pathname + location.search) history.pushState(null, "", path); route(); }
async function getJSON(path){ const r = await fetch(DATA + path, {cache:"no-cache"}); if(!r.ok) throw new Error(r.status+" "+path); return r.json(); }

/* ---------- formatting ---------- */
const I18N = window.TT_I18N || {lang:"en", locale:"en-US", t:s=>s, langs:{en:"English"}};
const TX = I18N.t, LOC = I18N.locale;
const MON = I18N.mon || ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const nf2 = new Intl.NumberFormat("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
const fmtP = v => v==null||!isFinite(v) ? "—" : v>=1000 ? Math.round(v).toLocaleString("en-US") : nf2.format(v);
const fmtV = v => !isFinite(v) ? "—" : v>=1e9 ? (v/1e9).toFixed(2)+"B" : v>=1e6 ? (v/1e6).toFixed(v>=1e8?0:1)+"M" : v>=1e3 ? (v/1e3).toFixed(0)+"K" : String(Math.round(v));
const fmtPct = (v,d=1) => v==null||!isFinite(v) ? "—" : (v>0?"+":"")+v.toFixed(d)+"%";
const fmtD = t => { const d=new Date(t); return String(d.getUTCDate()).padStart(2,"0")+"-"+MON[d.getUTCMonth()]+"-"+String(d.getUTCFullYear()).slice(2); };
const fmtLong = t => { const d=new Date(t); return I18N.lang==="en" ? MON[d.getUTCMonth()]+" "+d.getUTCDate()+", "+d.getUTCFullYear() : d.getUTCDate()+" "+MON[d.getUTCMonth()]+" "+d.getUTCFullYear(); };
const esc = s => String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const sign = v => /^\s*-/.test(v||"") ? "neg" : /^\s*\+/.test(v||"") ? "pos" : "";
/* ---------- table color tiers: up/down in the chart colors, bold + shaded when the reading is strong ---------- */
const TIER = {
  chg:   v => v==null ? "" : v >= 2 ? "t-up2" : v > 0 ? "t-up" : v <= -2 ? "t-dn2" : v < 0 ? "t-dn" : "",
  eps:   v => v==null ? "" : v >= 25 ? "t-up2" : v >= 0 ? "t-up" : v <= -25 ? "t-dn2" : "t-dn",      // CAN SLIM: +25% or better
  sales: v => v==null ? "" : v >= 25 ? "t-up2" : v >= 0 ? "t-up" : v <= -15 ? "t-dn2" : "t-dn",
  high:  v => v==null ? "" : v >= -5 ? "t-up" : v <= -25 ? "t-dn2" : v <= -15 ? "t-dn" : "",        // leaders trade near their highs
  vs50:  v => v==null ? "" : v >= 25 ? "t-warn" : v > 0 ? "t-up" : v <= -8 ? "t-dn2" : "t-dn",      // 25%+ over the 50-day = extended
  ud:    v => v==null ? "" : v >= 1.5 ? "t-up2" : v >= 1 ? "t-up" : v < 0.7 ? "t-dn2" : "t-dn",
  pivot: v => v==null ? "" : v > 5 ? "t-warn" : v >= 0 ? "t-up2" : v >= -5 ? "t-up" : "t-dn",        // buy zone = 0 to +5%
  vol:   (v, chg) => v==null || v < 40 ? "t-mute" : (chg ?? 0) >= 0 ? "t-up2" : "t-dn2",           // heavy volume: accumulation or distribution
};
const iso = s => { const [y,m,d] = s.split("-").map(Number); return Date.UTC(y,m-1,d); };
const pnum = s => { const v = parseFloat(String(s||"").replace(/[+%,]/g,"")); return isFinite(v)?v:null; };
function toast(msg){ const t=$("#toast"); t.textContent=msg; t.hidden=false; clearTimeout(toast.h); toast.h=setTimeout(()=>t.hidden=true, 4000); }

const STATUS_CLASS = {"Breakout":"s-breakout","In buy zone":"s-buy","Near pivot":"s-near","Extended":"s-ext","Below pivot":"s-below","Correcting":"s-corr","Failed breakout":"s-fail"};
const MKT_CLASS = {"Uptrend":"st-up","Uptrend under pressure":"st-press","Rally attempt":"st-rally","Correction":"st-corr"};

/* ---------- app state ---------- */
let META=null, ROWS=[], UNI=null, BENCH=null, order=[];
const PAGE = 100;
const scrState = { key: store.get("ink:sortKey") || "rsRating", asc: !!store.get("ink:sortAsc"), filter: store.get("ink:filter") || "all",
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
  if(!uniLoading) uniLoading = getJSON("universe.json").then(u=>{ UNI=u; if(LIVE) UNI.forEach(patchRow); fillSymlist();
    // the 90-day sparklines come in a second, separate file so the table shows up faster
    getJSON("spark.json").then(SP=>{ UNI.forEach(r=>{ if(!r.spark && SP[r.symbol]) r.spark = SP[r.symbol]; }); if(!$("#vScreener").hidden) renderScreener(); }).catch(()=>{}); if(needsUni() && !$("#vScreener").hidden) renderScreener(); return u; }).catch(e=>{ uniLoading=null; throw e; });
  return uniLoading;
}
function fillSymlist(){
  const src = UNI || ROWS;
  $("#symlist").innerHTML = src.map(r=>`<option value="${esc(r.symbol)}">${esc(r.name)}</option>`).join("");
}

/* ================= SCREENER ================= */
function rowVal(r, k){
  switch(k){
    case "comp": return r.comp ?? null;
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
  const f = scrState.filter, sec = scrState.sector, ind = scrState.industry;
  const us = /^u:/.test(f) ? SCREENS().find(x=>"u:"+x.id===f) : null;
  return list().filter(r => {
    if(sec && r.sector !== sec) return false;
    if(ind && r.group !== ind) return false;
    if(us) return matchScreen(r, us);
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
// the header row sticks to the top of the window while scrolling, unless the table is wider than the screen
function fitTable(){ const w = $("#vScreener .tablewrap"), t = $("#scr"); if(!w || !t || $("#vScreener").hidden) return;
  w.classList.remove("fits"); w.classList.toggle("fits", t.scrollWidth <= w.clientWidth + 1); }
addEventListener("resize", ()=>{ clearTimeout(fitTable.h); fitTable.h = setTimeout(fitTable, 120); });
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
    return `<tr data-s="${esc(r.symbol)}" tabindex="0"${b.type || b.status ? "" : ' class="nob"'}>
      <td class="l"><span class="sym">${esc(r.symbol)}</span>${scrState.scope!=="watch" && inWL(r.symbol)?'<span class="star" title="In your watchlist">★</span>':''}${earnBadge(r.symbol)}${r.stale?' <span class="stale">stale</span>':''}<span class="nm" title="${esc(r.name)}">${esc(r.name)}</span>${NOTES[r.symbol] ? `<span class="wnote" title="${esc(NOTES[r.symbol])}">✎ ${esc(NOTES[r.symbol])}</span>` : ""}</td>
      <td class="spk">${r.pending?'<span class="pend">pending</span>':`<canvas data-spark="${esc(r.symbol)}"></canvas>`}</td>
      <td>${fmtP(r.close)}</td>
      <td class="${TIER.chg(r.chgPct)}" data-l="Chg">${fmtPct(r.chgPct,2)}</td>
      <td><span class="rsv ${rs>=80?'hot':''}">${rs??"—"}</span></td>
      <td class="${(r.comp??0)>=80?'t-up2':''}">${r.comp??"—"}</td>
      <td title="${esc(r.group)}">${r.etf ? `<span class="nm">${esc(r.tracks||r.group||"")}</span>` : esc(r.groupRank||"—")}</td>
      <td class="${TIER.eps(pnum(r.epsChg))}" data-l="EPS Δ">${esc(r.epsChg||"—")}</td>
      <td class="${TIER.sales(pnum(r.salesChg))}" data-l="Sales Δ">${esc(r.salesChg||"—")}</td>
      <td class="${TIER.high(r.offHighPct)}">${fmtPct(r.offHighPct)}</td>
      <td class="${TIER.vs50(r.vs50Pct)}" ${(r.vs50Pct??0)>=25?'title="25%+ above the 50-day line: extended"':''}>${fmtPct(r.vs50Pct)}</td>
      <td class="${TIER.vol(r.volVsAvgPct, r.chgPct)}">${fmtPct(r.volVsAvgPct,0)}</td>
      <td class="${TIER.ud(r.udRatio)}">${r.udRatio==null?"—":r.udRatio.toFixed(2)}</td>
      <td class="l">${b.type?`${esc(b.type)}<span class="nm">${b.weeks} wks · ${b.depthPct}% deep</span>`:"—"}</td>
      <td>${b.pivot?fmtP(b.pivot):"—"}</td>
      <td class="${b.pivot ? TIER.pivot(b.distPct) : ""}" data-l="To pivot">${b.pivot?fmtPct(b.distPct):"—"}</td>
      <td class="l">${b.status?`<span class="chip ${stc}">${esc(b.status)}</span>`:"—"}</td>
    </tr>`; }).join("") || `<tr><td colspan="17" class="l" style="padding:18px">${scrState.scope==="watch" && !getWL().length ? `Your watchlist is empty. Open any ticker and tap the ☆ next to its symbol to add it.<span class="wlgo"><a class="btn" href="/screener/">Browse the screener →</a><a class="btn" href="/ideas/">See trade ideas →</a><a class="btn" href="/heatmap/">Open the heatmap →</a></span>` : "No tickers match this filter."}</td></tr>`;
  const bySym = new Map(shown.map(r=>[r.symbol,r]));
  $$("canvas[data-spark]").forEach(cv=>{ const r = bySym.get(cv.dataset.spark); sparkline(cv, r && r.spark); });
  const noun = {all:"stocks", etf:"ETFs", watch:"tickers"}[scrState.scope];
  $("#count").textContent = total > shown.length ? `Showing ${shown.length} of ${total} · ${all.length} ${noun}` : `${total} of ${all.length} ${noun}`;
  const sc = $("#secChip"); sc.hidden = !scrState.sector && !scrState.industry;
  if(!sc.hidden){ sc.innerHTML = `${scrState.industry ? "Group" : "Sector"}: <b>${esc(scrState.industry || scrState.sector)}</b> <button aria-label="Clear sector filter">×</button>`;
    sc.querySelector("button").onclick = ()=>{ scrState.sector = null; scrState.industry = null; scrState.limit=PAGE; renderScreener(); }; }
  fitTable();
  renderWlCtl();
  $("#moreWrap").hidden = total <= shown.length;
  if(total > shown.length) $("#moreBtn").textContent = `Show ${Math.min(PAGE, total-shown.length)} more`;
}
const MKT_SHORT = {"Uptrend":"Uptrend","Uptrend under pressure":"Under pressure","Rally attempt":"Rally attempt","Correction":"Correction"};
function renderMktChip(){
  const el = $("#mktChip"); if(!el) return;
  const M = (META && META.market) || []; el.hidden = !M.length;
  el.innerHTML = M.map(m=>`<span title="${esc(m.name)}: ${esc(TX(m.status))}"><i class="${MKT_CLASS[m.status]||''}"></i>${esc(m.name.replace(" Composite",""))} <b>${esc(MKT_SHORT[m.status]||m.status)}</b></span>`).join("");
}
function renderPulse(){
  renderMktChip();
  const els = [$("#pulse"), $("#hPulse")].filter(Boolean);
  if(!META || !META.market || !META.market.length){ els.forEach(el=>el.innerHTML=""); return; }
  const html = META.market.map(m => `<div class="pcard">
      <div class="top"><span class="nm">${esc(m.name)}</span><span class="px">${fmtP(m.close)}</span><span class="${m.chgPct<0?'neg':''}" style="font-family:var(--f-data)">${fmtPct(m.chgPct,2)}</span>
        <span class="sp"></span><span class="chip ${MKT_CLASS[m.status]||''}">${esc(m.status)}</span></div>
      <div class="flags"><span class="flag ${m.above21?'ok':'no'}">${m.above21?'Above':'Below'} 21-day</span><span class="flag ${m.above50?'ok':'no'}">${m.above50?'Above':'Below'} 50-day</span><span class="flag ${m.above200?'ok':'no'}">${m.above200?'Above':'Below'} 200-day</span></div>
      <div class="dd" title="Distribution days in the last 25 sessions: index down 0.2% or more on higher volume">${Array.from({length:8},(_,i)=>`<i class="${i<m.distDays?'on':''}"></i>`).join("")}<span>${m.distDays} distribution day${m.distDays===1?'':'s'}${m.rallyDay?` · rally day ${m.rallyDay}`:''}</span><span class="sp"></span><a class="plink" href="/breadth/">Breadth →</a></div>
    </div>`).join("");
  els.forEach(el=>el.innerHTML = html);
}
$$("#scr th[data-k]").forEach(th=>{
  const go = ()=>{ const k=th.dataset.k; if(scrState.key===k) scrState.asc=!scrState.asc; else { scrState.key=k; scrState.asc = ["symbol","baseType","status","grp","distPct"].includes(k) ? true : false; }
    store.set("ink:sortKey",scrState.key); store.set("ink:sortAsc",scrState.asc); scrState.limit=PAGE; renderScreener(); };
  th.addEventListener("click", go); th.addEventListener("keydown", e=>{ if(e.key==="Enter") go(); });
});
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
$("#scr tbody").addEventListener("click", e=>{ const tr=e.target.closest("tr[data-s]"); if(tr) go(tr.dataset.s); });
$("#scr tbody").addEventListener("keydown", e=>{ const tr=e.target.closest("tr[data-s]"); if(tr && e.key==="Enter") go(tr.dataset.s); });
$("#jump").addEventListener("change", e=>{ const v=e.target.value.trim().toUpperCase().replace(/\./g,"-"); if(!v) return; e.target.value="";
  const known = ROWS.some(r=>r.symbol===v) || (UNI && UNI.some(r=>r.symbol===v));
  if(known || !UNI || SYM_OK.test(v)) go(v); else toast(`${v} is not a valid ticker.`); });

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
function applyColors(){ C.up = cfg.colors.up; C.down = cfg.colors.down; C.vup = cfg.colors.vup; C.vdown = cfg.colors.vdown;
  // tables use the same up/down colors as the chart bars
  const st = document.documentElement.style; st.setProperty("--up", C.up); st.setProperty("--down", C.down); }
applyColors();
const GRID_DASH = {dotted:[1,3], dashed:[5,4], solid:[]};
function niceStep(x){ const m=Math.pow(10,Math.floor(Math.log10(x))); for(const k of [1,2,2.5,5,10]) if(k*m>=x) return k*m; return 10*m; }
function linTicks(lo, hi, pxH){ const step=niceStep((hi-lo)/Math.max(2,Math.floor(pxH/38))); const out=[]; for(let v=Math.ceil(lo/step)*step; v<=hi; v+=step) out.push(+v.toFixed(6)); return out; }

function settingsHTML(){
  const seg = (key, opts) => `<div class="seg">${opts.map(([v,l])=>`<button data-cfg="${key}" data-v="${v}" class="${cfg[key]===v?'on':''}">${l}</button>`).join("")}</div>`;
  return `<div class="sethd"><b>Settings</b><button class="x" id="setClose" aria-label="Close">×</button></div>
    <div class="setrow"><span>Language</span><div class="seg" data-noi18n>${Object.entries(I18N.langs).map(([v,l])=>`<button data-lang="${v}" class="${I18N.lang===v?'on':''}">${l}</button>`).join("")}</div></div>
    <div class="setrow"><span>Price scale</span>${seg("scale",[["log","Log"],["linear","Linear"]])}</div>
    <div class="setrow"><span>Price bars</span>${seg("bars",[["hlc","O'Neil (H-L-C)"],["ohlc","OHLC"],["candle","Candles"]])}</div>
    <div class="setrow"><span>Bar weight</span>${seg("weight",[["thin","Thin"],["normal","Normal"],["bold","Bold"]])}</div>
    <div class="setrow"><span title="David Ryan's Ants: up at least 12 of the last 15 sessions with volume 20%+ above its 50-day average. Gold when the stock also gained 20%+ in those 15 days.">Ants</span>${seg("ants",[["on","Show"],["off","Hide"]])}</div>
    <div class="setrow"><span>Grid lines</span>${seg("grid",[["dotted","Dotted"],["dashed","Dashed"],["solid","Solid"],["none","None"]])}</div>
    <div class="setrow"><span>Indicators</span><button class="btn" id="setInd">${esc(TX("Moving averages and studies…"))}</button></div>
    <div class="setrow col"><span>Colors</span><div class="colgrid">
      <label><input type="color" class="swatch" data-col="up" value="${cfg.colors.up}">Up bars</label>
      <label><input type="color" class="swatch" data-col="down" value="${cfg.colors.down}">Down bars</label>
      <label><input type="color" class="swatch" data-col="vup" value="${cfg.colors.vup}">Up volume</label>
      <label><input type="color" class="swatch" data-col="vdown" value="${cfg.colors.vdown}">Down volume</label>
    </div></div>
    <div class="setft"><button class="btn" id="setReset">Reset to defaults</button></div>`;
}
function redrawAll(){ applyColors(); if(S && !$("#vChart").hidden){ renderPanels(); draw(); } if(!$("#vHome").hidden) drawHomeChart(); if(!$("#vScreener").hidden) renderScreener(); if(!$("#vCmp").hidden){ CMP = normCmp(cfg.cmp); renderCmp(); } }
function applyCfg(){ store.set("ink:cfg", cfg); push("cfg", cfg); $("#settings").innerHTML = settingsHTML(); bindSettings(); redrawAll(); }
function bindSettings(){
  $$("#settings [data-cfg]").forEach(b=>b.onclick=()=>{ cfg[b.dataset.cfg]=b.dataset.v; applyCfg(); });
  $$("#settings [data-lang]").forEach(b=>b.onclick=()=>{ const l = b.dataset.lang; if(l === I18N.lang) return; cfg.lang = l; store.set("ink:cfg", cfg); push("cfg", cfg); setTimeout(()=>I18N.setLang && I18N.setLang(l), 250); });
  $("#setInd").onclick=()=>{ toggleSettings(false); openInd(); };
  $("#setReset").onclick=()=>{ const keep = {screens: cfg.screens, cols: cfg.cols, lang: cfg.lang, cmp: cfg.cmp}; cfg = normCfg({...JSON.parse(JSON.stringify(DEF_CFG)), ...keep, tpl: cfg.tpl}); cfg.ind = normInd(JSON.parse(JSON.stringify(IND_DEF))); cfg.tpl = normTpl(cfg.tpl); cfg.draw = normDraw(cfg.draw); syncBox(); applyCfg(); };
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

/* ================= CHART INDICATORS ================= */
// cfg.ind: the user's own studies on the stock chart (follows the account). Templates live in cfg.tpl.
const IND_PAL = ["#d23a2a","#15171c","#5fa35a","#e07b1f","#7b4bb3","#1d3fc4","#0f7c86","#a0306a"];
const PANES = {rsi:"RSI", macd:"MACD", adr:"ADR %", atr:"ATR", rvol:"Relative volume"};
const IND_MAX_MA = 8, IND_MAX_PANES = 3;
const RS_BENCH = {spx:"S&P 500", qqq:"Nasdaq-100", sector:"Sector ETF"};
const SECTOR_ETF = {"Information Technology":"XLK","Technology":"XLK","Financials":"XLF","Financial Services":"XLF","Health Care":"XLV","Healthcare":"XLV",
  "Energy":"XLE","Consumer Discretionary":"XLY","Consumer Cyclical":"XLY","Consumer Staples":"XLP","Consumer Defensive":"XLP","Industrials":"XLI",
  "Materials":"XLB","Basic Materials":"XLB","Utilities":"XLU","Real Estate":"XLRE","Communication Services":"XLC"};
const IND_DEF = {mas:[{t:"sma",n:50,c:"#d23a2a",w:2},{t:"sma",n:200,c:"#15171c",w:1}],
  bb:{on:false,n:20,k:2,c:"#7b4bb3"}, kc:{on:false,n:20,k:1.5,c:"#0f7c86"}, vwap:{on:false,a:"earn",c:"#a86a00"},
  vol:true, box:true, strip:true, piv:true, base:true, idx:true, rsl:true, panes:[], rsi:{n:14}, macd:{f:12,s:26,g:9}, adr:{n:20}, atr:{n:14}, rvol:{n:50}, rs:"spx"};
const clampN = (v, lo, hi, d) => { v = Math.round(+v); return v >= lo && v <= hi ? v : d; };
function normInd(o){
  const legacy = !o || typeof o !== "object";
  o = legacy ? {} : o;
  // first time: carry over the moving averages switched on in the old Settings panel
  const mas = Array.isArray(o.mas) ? o.mas : legacy ? MAS.filter(m=>cfg.ma[m.k]).map(m=>({t:m.ema?"ema":"sma", n:m.n, c:maCol(m), w:m.k==="d50"?2:1})) : IND_DEF.mas;
  const sub = (k, f) => { const d = IND_DEF[k], v = o[k] && typeof o[k] === "object" ? o[k] : {}; return f(v, d); };
  return {
    mas: mas.filter(m=>m && (m.t==="sma"||m.t==="ema")).slice(0, IND_MAX_MA).map((m,i)=>({t:m.t, n:clampN(m.n,2,400,50), c:HEX.test(m.c||"")?m.c:IND_PAL[i%IND_PAL.length], w:[1,2,3].includes(m.w)?m.w:1})),
    bb: sub("bb", (v,d)=>({on:!!v.on, n:clampN(v.n,5,100,d.n), k:[1,1.5,2,2.5,3].includes(+v.k)?+v.k:d.k, c:HEX.test(v.c||"")?v.c:d.c})),
    kc: sub("kc", (v,d)=>({on:!!v.on, n:clampN(v.n,5,100,d.n), k:[1,1.5,2,2.5,3].includes(+v.k)?+v.k:d.k, c:HEX.test(v.c||"")?v.c:d.c})),
    vwap: sub("vwap", (v,d)=>({on:!!v.on, a:["earn","base","hi","lo"].includes(v.a)?v.a:d.a, c:HEX.test(v.c||"")?v.c:d.c})),
    vol: o.vol !== false, box: o.box !== false, strip: o.strip !== false,
    piv: o.piv !== false, base: o.base !== false, idx: o.idx !== false, rsl: o.rsl !== false,
    panes: (Array.isArray(o.panes) ? o.panes : []).filter((p,i,a)=>PANES[p] && a.indexOf(p)===i).slice(0, IND_MAX_PANES),
    rsi: {n: clampN((o.rsi||{}).n, 2, 50, 14)}, macd: {f: clampN((o.macd||{}).f, 2, 50, 12), s: clampN((o.macd||{}).s, 3, 100, 26), g: clampN((o.macd||{}).g, 2, 50, 9)},
    adr: {n: clampN((o.adr||{}).n, 2, 100, 20)}, atr: {n: clampN((o.atr||{}).n, 2, 100, 14)}, rvol: {n: clampN((o.rvol||{}).n, 5, 200, 50)},
    rs: RS_BENCH[o.rs] ? o.rs : "spx"};
}
function normTpl(t){ return (Array.isArray(t) ? t : []).filter(x=>x && typeof x.name === "string" && x.name.trim()).slice(0, 12).map(x=>({name: x.name.trim().slice(0, 30), ind: normInd(x.ind)})); }
cfg.ind = normInd(cfg.ind); cfg.tpl = normTpl(cfg.tpl);
const maName = (m, weekly) => weekly ? `${Math.round(m.n/5)}-week ${m.t==="ema"?"EMA":"MA"}` : `${m.n}-day ${m.t==="ema"?"EMA":"MA"}`;
const maOnWeekly = m => m.n >= 25;
const LW_MA = {1:1.2, 2:1.6, 3:2.3};
function saveInd(){ store.set("ink:cfg", cfg); push("cfg", cfg); }
// the data box follows the user's style (cfg.ind.box); the Data box button switches it and saves it
function syncBox(){ for(const k of ["box","piv","base","idx","rsl"]) view[k] = cfg.ind[k]; if(S && !$("#vChart").hidden) renderDbox(); }

// benchmark for the RS line and the index line on top: the S&P 500 (bench.json) or another ETF's prices
const benchX = new Map();
function rsBenchSym(){ const k = cfg.ind.rs; if(k === "qqq") return "QQQ"; if(k === "sector" && S){ const F = S.fund || {}; return SECTOR_ETF[F.sector] || SECTOR_ETF[F.group] || null; } return null; }
function rsBenchName(){ const s = rsBenchSym(); return s && benchX.has(s) ? (cfg.ind.rs === "qqq" ? "Nasdaq-100" : s) : "S&P 500"; }
function loadBenchX(){ const s = rsBenchSym(); if(!s || benchX.has(s)) return Promise.resolve();
  return getBundle(s).then(b=>{ if(b && b.prices) benchX.set(s, b.prices.map(([d,o,h,l,c])=>({t:iso(d), c}))); }); }

// study math on bars {t,o,h,l,c,v}
function stdev(arr, n, f, mid){ const out = new Array(arr.length).fill(null);
  for(let i=n-1;i<arr.length;i++){ const m = mid[i]; if(m==null) continue; let s=0; for(let j=i-n+1;j<=i;j++){ const d=f(arr[j])-m; s+=d*d; } out[i]=Math.sqrt(s/n); } return out; }
function trueRange(b){ return b.map((x,i)=> i ? Math.max(x.h, b[i-1].c) - Math.min(x.l, b[i-1].c) : x.h - x.l); }
function wilder(vals, n){ const out = new Array(vals.length).fill(null); let a = null, s = 0;
  for(let i=0;i<vals.length;i++){ if(i < n){ s += vals[i]; if(i === n-1){ a = s/n; out[i] = a; } continue; } a = (a*(n-1) + vals[i])/n; out[i] = a; } return out; }
function rsiOf(b, n){ const up = [], dn = []; for(let i=0;i<b.length;i++){ const d = i ? b[i].c - b[i-1].c : 0; up.push(Math.max(d,0)); dn.push(Math.max(-d,0)); }
  const au = wilder(up.slice(1), n), ad = wilder(dn.slice(1), n); return [null, ...au.map((u,i)=> u==null ? null : ad[i] === 0 ? 100 : 100 - 100/(1 + u/ad[i]))]; }
function macdOf(b, f, s, g){ const ef = ema(b, f, x=>x.c), es = ema(b, s, x=>x.c); const m = ef.map((v,i)=> v!=null && es[i]!=null ? v - es[i] : null);
  const first = m.findIndex(v=>v!=null); const sig = new Array(b.length).fill(null);
  if(first >= 0){ const e = ema(m.slice(first).map(v=>({c:v})), g, x=>x.c); e.forEach((v,i)=>{ sig[first+i] = v; }); }
  return {m, sig, h: m.map((v,i)=> v!=null && sig[i]!=null ? v - sig[i] : null)}; }
function avwapOf(b, i0){ const out = new Array(b.length).fill(null); if(i0 == null || i0 < 0) return out; let pv=0, vv=0;
  for(let i=i0;i<b.length;i++){ const tp=(b[i].h+b[i].l+b[i].c)/3; pv+=tp*b[i].v; vv+=b[i].v; out[i] = vv ? pv/vv : tp; } return out; }
function vwapAnchor(base){
  const I = cfg.ind, firstAt = t => { const i = base.findIndex(x=>x.t >= t); return i < 0 ? null : i; };
  if(I.vwap.a === "earn"){ const q = ((S.fund||{}).quarters||[]).find(q=>q.date && iso(q.date) <= base[base.length-1].t); return q ? firstAt(iso(q.date)) : null; }
  if(I.vwap.a === "base") return S.base && S.base.start ? firstAt(iso(S.base.start)) : null;
  const k = Math.max(0, base.length - (view.weekly ? 52 : 252)); let j = k;
  for(let i=k;i<base.length;i++) if(I.vwap.a === "hi" ? base[i].h > base[j].h : base[i].l < base[j].l) j = i;
  return j;
}
const VWAP_A = {earn:"last earnings", base:"start of the base", hi:"52-week high", lo:"52-week low"};
function studies(base){
  const I = cfg.ind, out = {over:[], panes:[]}, closeF = x=>x.c;
  if(I.bb.on){ const m = sma(base, I.bb.n, closeF), sd = stdev(base, I.bb.n, closeF, m);
    out.over.push({kind:"band", c:I.bb.c, mid:m, up:m.map((v,i)=>v==null||sd[i]==null?null:v+I.bb.k*sd[i]), lo:m.map((v,i)=>v==null||sd[i]==null?null:v-I.bb.k*sd[i]), name:`Bollinger (${I.bb.n}, ${I.bb.k})`}); }
  if(I.kc.on){ const m = ema(base, I.kc.n, closeF), at = wilder(trueRange(base), I.kc.n);
    out.over.push({kind:"band", c:I.kc.c, mid:m, up:m.map((v,i)=>v==null||at[i]==null?null:v+I.kc.k*at[i]), lo:m.map((v,i)=>v==null||at[i]==null?null:v-I.kc.k*at[i]), name:`Keltner (${I.kc.n}, ${I.kc.k})`}); }
  if(I.vwap.on){ out.over.push({kind:"line", c:I.vwap.c, data:avwapOf(base, vwapAnchor(base)), name:`VWAP from ${VWAP_A[I.vwap.a]}`}); }
  for(const p of I.panes){
    if(p === "rsi") out.panes.push({k:p, name:`RSI (${I.rsi.n})`, lines:[{d:rsiOf(base, I.rsi.n), c:C.navy}], fix:[0,100], guides:[30,70], fmt:v=>v.toFixed(0)});
    if(p === "macd"){ const r = macdOf(base, I.macd.f, I.macd.s, I.macd.g); out.panes.push({k:p, name:`MACD (${I.macd.f}, ${I.macd.s}, ${I.macd.g})`, hist:r.h, lines:[{d:r.m, c:C.navy},{d:r.sig, c:"#e07b1f"}], guides:[0], fmt:v=>v.toFixed(2)}); }
    if(p === "adr"){ const d = sma(base, I.adr.n, x=>(x.h/x.l - 1)*100); out.panes.push({k:p, name:`ADR % (${I.adr.n})`, lines:[{d, c:"#0f7c86"}], fmt:v=>v.toFixed(2)+"%"}); }
    if(p === "atr"){ const d = wilder(trueRange(base), I.atr.n); out.panes.push({k:p, name:`ATR (${I.atr.n})`, lines:[{d, c:"#7b4bb3"}], fmt:v=>fmtP(v)}); }
    if(p === "rvol"){ const avg = sma(base, I.rvol.n, x=>x.v); out.panes.push({k:p, name:`Relative volume (${I.rvol.n})`, bars:base.map((x,i)=>avg[i] ? x.v/avg[i] : null), guides:[1], fmt:v=>v.toFixed(2)+"×"}); }
  }
  return out;
}

// the Indicators dialog
function openInd(){
  const I = JSON.parse(JSON.stringify(cfg.ind));
  const apply = () => { cfg.ind = normInd(I); saveInd(); syncBox(); loadBenchX().then(()=>{ if(S && !$("#vChart").hidden){ renderPanels(); draw(); } }); };
  const num = (k, f, v, lo, hi, lbl) => `<label class="inum"><span>${esc(TX(lbl))}</span><input type="number" min="${lo}" max="${hi}" step="${f==="k"?0.5:1}" data-ik="${k}" data-if="${f}" value="${v}"></label>`;
  const body = () => `
    <div class="indtpl"><label><span>${esc(TX("Template"))}</span><select id="iTpl"><option value="">${esc(TX("Choose a template…"))}</option><option value="__def">${esc(TX("Default (O'Neil)"))}</option>
      ${cfg.tpl.map((t,i)=>`<option value="${i}">${esc(t.name)}</option>`).join("")}</select></label>
      <button class="btn sm" id="iSave">${esc(TX("Save as template"))}</button>${cfg.tpl.length ? `<button class="btn sm" id="iDelTpl">${esc(TX("Delete a template"))}</button>` : ""}</div>
    <h5 class="indh">${esc(TX("Moving averages"))}</h5>
    <div class="indmas">${I.mas.map((m,i)=>`<div class="indma"><input type="color" class="swatch" data-mc="${i}" value="${m.c}" aria-label="${esc(TX("Color"))}">
      <select data-mt="${i}" aria-label="${esc(TX("Type"))}"><option value="sma" ${m.t==="sma"?"selected":""}>SMA</option><option value="ema" ${m.t==="ema"?"selected":""}>EMA</option></select>
      <input type="number" min="2" max="400" data-mn="${i}" value="${m.n}" aria-label="${esc(TX("Length (days)"))}"><span class="fine">${esc(TX("days"))}</span>
      <div class="seg wseg" role="group" aria-label="${esc(TX("Line width"))}">${[1,2,3].map(w=>`<button data-mw="${i}" data-v="${w}" class="${m.w===w?"on":""}" title="${esc(TX("Line width"))} ${w}"><i style="height:${w}px"></i></button>`).join("")}</div>
      <button class="cx" data-mdel="${i}" aria-label="${esc(TX("Remove"))}">×</button></div>`).join("")}
      ${I.mas.length < IND_MAX_MA ? `<button class="btn sm" id="iMaAdd">＋ ${esc(TX("Add moving average"))}</button>` : ""}</div>
    <p class="fine">${esc(TX("On the weekly chart each average becomes its weekly equivalent (50 days = 10 weeks); averages shorter than 25 days show on the daily chart only."))}</p>
    <h5 class="indh">${esc(TX("On the price"))}</h5>
    <div class="indrow"><label class="chk"><input type="checkbox" data-on="bb" ${I.bb.on?"checked":""}> ${esc(TX("Bollinger Bands"))}</label>${num("bb","n",I.bb.n,5,100,"Length")}${num("bb","k",I.bb.k,1,3,"Std. dev.")}<input type="color" class="swatch" data-oc="bb" value="${I.bb.c}" aria-label="${esc(TX("Color"))}"></div>
    <div class="indrow"><label class="chk"><input type="checkbox" data-on="kc" ${I.kc.on?"checked":""}> ${esc(TX("Keltner Channels"))}</label>${num("kc","n",I.kc.n,5,100,"Length")}${num("kc","k",I.kc.k,1,3,"ATR ×")}<input type="color" class="swatch" data-oc="kc" value="${I.kc.c}" aria-label="${esc(TX("Color"))}"></div>
    <div class="indrow"><label class="chk"><input type="checkbox" data-on="vwap" ${I.vwap.on?"checked":""}> ${esc(TX("Anchored VWAP"))}</label>
      <label class="inum"><span>${esc(TX("From"))}</span><select data-va>${Object.entries(VWAP_A).map(([k,l])=>`<option value="${k}" ${I.vwap.a===k?"selected":""}>${esc(TX(l))}</option>`).join("")}</select></label><input type="color" class="swatch" data-oc="vwap" value="${I.vwap.c}" aria-label="${esc(TX("Color"))}"></div>
    <h5 class="indh">${esc(TX("Below the price"))} <small>${esc(TX("up to 3 panels"))}</small></h5>
    <div class="indrow"><label class="chk"><input type="checkbox" id="iVol" ${I.vol?"checked":""}> ${esc(TX("Volume"))}</label></div>
    ${Object.entries(PANES).map(([k,l])=>`<div class="indrow"><label class="chk"><input type="checkbox" data-pane="${k}" ${I.panes.includes(k)?"checked":""} ${!I.panes.includes(k)&&I.panes.length>=IND_MAX_PANES?"disabled":""}> ${esc(TX(l))}</label>
      ${k==="macd" ? num("macd","f",I.macd.f,2,50,"Fast")+num("macd","s",I.macd.s,3,100,"Slow")+num("macd","g",I.macd.g,2,50,"Signal") : num(k,"n",I[k].n,2,200,"Length")}</div>`).join("")}
    <h5 class="indh">${esc(TX("Chart elements"))}</h5>
    <div class="indchk">${[["piv","Swing pivots (unbroken highs and lows)"],["base","Base, pivot and buy zone"],["idx","S&P 500 line at the top"],["rsl","RS line and RS Rating"]].map(([k,l])=>`<label class="chk"><input type="checkbox" data-el="${k}" ${I[k]?"checked":""}> ${esc(TX(l))}</label>`).join("")}</div>
    <h5 class="indh">${esc(TX("Fundamentals on the chart"))}</h5>
    <div class="indrow"><label class="chk"><input type="checkbox" id="iBox" ${I.box?"checked":""}> ${esc(TX("Data box (annual EPS and sales, ratings)"))}</label></div>
    <div class="indrow"><label class="chk"><input type="checkbox" id="iStrip" ${I.strip?"checked":""}> ${esc(TX("Quarterly table under the volume (EPS, sales, margin)"))}</label></div>
    <h5 class="indh">${esc(TX("RS line"))}</h5>
    <div class="seg" role="group" aria-label="${esc(TX("RS line compared with"))}">${Object.entries(RS_BENCH).map(([k,l])=>`<button data-rs="${k}" class="${I.rs===k?"on":""}">${esc(TX(l))}</button>`).join("")}</div>
    <p class="fine">${esc(TX("Sector ETF compares the stock with the SPDR fund of its sector, to see if it leads its own group."))}</p>
    <div class="indft"><button class="btn" id="iReset">${esc(TX("Back to the default"))}</button><button class="btn on" id="iDone">${esc(TX("Done"))}</button></div>`;
  const bind = B => {
    B.innerHTML = body();
    const re = () => { apply(); bind(B); };
    B.querySelector("#iMaAdd")?.addEventListener("click", ()=>{ const used = I.mas.map(m=>m.n), n = [10,21,50,150,200,100,20,65].find(x=>!used.includes(x)) || 100;
      I.mas.push({t: n===21 ? "ema" : "sma", n, c: IND_PAL.find(c=>!I.mas.some(m=>m.c===c)) || IND_PAL[0], w:1}); re(); });
    B.querySelectorAll("[data-mdel]").forEach(b=>b.onclick = ()=>{ I.mas.splice(+b.dataset.mdel, 1); re(); });
    B.querySelectorAll("[data-mw]").forEach(b=>b.onclick = ()=>{ I.mas[+b.dataset.mw].w = +b.dataset.v; re(); });
    B.querySelectorAll("[data-mt]").forEach(s=>s.onchange = ()=>{ I.mas[+s.dataset.mt].t = s.value; re(); });
    B.querySelectorAll("[data-mn]").forEach(s=>s.onchange = ()=>{ const v = clampN(s.value, 2, 400, null); if(v == null){ toast(TX("Use a length between 2 and 400 days.")); s.value = I.mas[+s.dataset.mn].n; return; } I.mas[+s.dataset.mn].n = v; re(); });
    B.querySelectorAll("input[type=color]").forEach(el=>{ const set = () => { if(el.dataset.mc != null) I.mas[+el.dataset.mc].c = el.value; else I[el.dataset.oc].c = el.value; };
      el.addEventListener("input", ()=>{ set(); cfg.ind = normInd(I); draw(); }); el.addEventListener("change", ()=>{ set(); apply(); }); });
    B.querySelectorAll("[data-on]").forEach(c=>c.onchange = ()=>{ I[c.dataset.on].on = c.checked; re(); });
    B.querySelectorAll("[data-ik]").forEach(s=>s.onchange = ()=>{ I[s.dataset.ik][s.dataset.if] = +s.value; cfg.ind = normInd(I); Object.assign(I, JSON.parse(JSON.stringify(cfg.ind))); re(); });
    B.querySelector("[data-va]").onchange = e => { I.vwap.a = e.target.value; I.vwap.on = true; re(); };
    B.querySelector("#iVol").onchange = e => { I.vol = e.target.checked; re(); };
    B.querySelector("#iBox").onchange = e => { I.box = e.target.checked; re(); };
    B.querySelectorAll("[data-el]").forEach(c=>c.onchange = ()=>{ I[c.dataset.el] = c.checked; re(); });
    B.querySelector("#iStrip").onchange = e => { I.strip = e.target.checked; re(); };
    B.querySelectorAll("[data-pane]").forEach(c=>c.onchange = ()=>{ const k = c.dataset.pane; I.panes = c.checked ? [...I.panes, k] : I.panes.filter(p=>p!==k); re(); });
    B.querySelectorAll("[data-rs]").forEach(b=>b.onclick = ()=>{ I.rs = b.dataset.rs; re(); });
    B.querySelector("#iTpl").onchange = e => { const v = e.target.value; if(!v) return;
      const src = v === "__def" ? normInd(JSON.parse(JSON.stringify(IND_DEF))) : cfg.tpl[+v].ind; Object.keys(I).forEach(k=>delete I[k]); Object.assign(I, JSON.parse(JSON.stringify(src))); re();
      toast(`${TX("Template loaded")}: ${v === "__def" ? TX("Default (O'Neil)") : cfg.tpl[+v].name}`); };
    B.querySelector("#iSave").onclick = () => { const name = (prompt(TX("Name this template (for example Swing or Long term):")) || "").trim(); if(!name) return;
      const i = cfg.tpl.findIndex(t=>t.name.toLowerCase() === name.toLowerCase()); const t = {name: name.slice(0,30), ind: normInd(I)};
      if(i >= 0) cfg.tpl[i] = t; else { if(cfg.tpl.length >= 12){ toast(TX("Up to 12 templates. Delete one first.")); return; } cfg.tpl.push(t); }
      saveInd(); bind(B); toast(`${TX("Template saved")}: ${t.name}`); };
    B.querySelector("#iDelTpl")?.addEventListener("click", ()=>{ const name = (prompt(`${TX("Type the name of the template to delete")}: ${cfg.tpl.map(t=>t.name).join(", ")}`) || "").trim().toLowerCase(); if(!name) return;
      const i = cfg.tpl.findIndex(t=>t.name.toLowerCase() === name); if(i < 0){ toast(TX("No template with that name.")); return; } cfg.tpl.splice(i, 1); saveInd(); bind(B); });
    B.querySelector("#iReset").onclick = () => { Object.keys(I).forEach(k=>delete I[k]); Object.assign(I, normInd(JSON.parse(JSON.stringify(IND_DEF)))); re(); };
    B.querySelector("#iDone").onclick = closeDlg;
  };
  dlg(TX("Indicators"), "", bind);
  $("#dlg").classList.add("wide");
}

/* ================= CHART ================= */
let S = null;               // current ticker bundle
let view = { weekly:false, months:18, box:cfg.ind.box, piv:cfg.ind.piv, base:cfg.ind.base, idx:cfg.ind.idx, rsl:cfg.ind.rsl };
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
function alignBench(px, src){
  src = src || BENCH; if(!src) return null; const out=[]; let j=0, last=null;
  for(const b of px){ while(j<src.length && src[j].t<=b.t){ last=src[j].c; j++; } out.push(last); }
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
  const mas = cfg.ind.mas.filter(m=>!view.weekly || maOnWeekly(m)).map(m=>{ const n = view.weekly ? Math.round(m.n/5) : m.n;
    return {...m, color: m.c, lw: LW_MA[m.w] || 1.2, name: maName(m, view.weekly), data: m.t==="ema" ? ema(base, n, b=>b.c) : sma(base, n, b=>b.c)}; });
  const vma = sma(base, view.weekly?10:50, b=>b.v);
  const bx = rsBenchSym(), bA = alignBench(base, bx ? benchX.get(bx) : null);
  const rs = bA ? base.map((b,i)=> bA[i] ? b.c/bA[i] : null) : null;
  const nVis = Math.min(base.length, Math.round(view.months*(view.weekly?4.33:21)));
  return {base, mas, vma, bA, rs, st: studies(base), s0: base.length - nVis};
}

function draw(){
  const dpr = window.devicePixelRatio||1; const W = cv.clientWidth;
  if(!W) return;
  const nPanes = cfg.ind.panes.length, paneH = W < 640 ? 74 : 92;
  const wantH = (W < 640 ? 540 : Math.round(Math.max(520, Math.min(760, W*0.47)))) + nPanes*(paneH+4) - (cfg.ind.vol ? 0 : 40);
  if(Math.abs(cv.clientHeight - wantH) > 1) cv.style.height = wantH + "px";
  const H = wantH;
  if(cv.width!==Math.round(W*dpr) || cv.height!==Math.round(H*dpr)){ cv.width=Math.round(W*dpr); cv.height=Math.round(H*dpr); }
  ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,W,H);
  ctx.fillStyle = C.plate; ctx.fillRect(0,0,W,H);
  if(!S || !S.px.length) return;
  const F = S.fund || {};
  const sr = series(); const {base,mas,vma,s0,st} = sr; const bA = view.idx ? sr.bA : null; const rs = view.rsl ? sr.rs : null;
  const vis = base.slice(s0); const n = vis.length;
  const narrow = W < 600;
  const L=6, R= narrow?50:66, T=20, B=18;
  const plotW = W-L-R;
  const Q = (F.quarters||[]).map(q=>({...q, end:qEnd(q.q)})).filter(q=>q.end);
  const hasMargin = Q.some(q=>q.margin);
  const rowH = narrow?11:13, stripRows = Q.length && cfg.ind.strip ? (narrow? 3 : (hasMargin?4:3)) : 0;
  const stripH = stripRows*rowH + (stripRows?4:0);
  const panesH = nPanes*(paneH+4);
  const totalH = H-T-B-stripH-(stripH?4:0)-panesH;
  const showVol = cfg.ind.vol;
  const priceH = showVol ? Math.round(totalH*0.72) : totalH, volH = showVol ? totalH-priceH-4 : 0;
  const pTop=T, pBot=T+priceH, vTop=showVol ? pBot+4 : pBot, vBot=vTop+volH, paneTop=vBot+4, aBot=vBot+panesH, sTop=aBot+4, sBot=sTop+stripH;
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
    if(ms.i>0 && gridOn){ ctx.beginPath(); ctx.moveTo(x,pTop); ctx.lineTo(x,aBot); ctx.stroke(); }
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
  ctx.strokeStyle=C.ink; ctx.lineWidth=1; ctx.strokeRect(L+.5,pTop+.5,plotW,priceH); if(showVol) ctx.strokeRect(L+.5,vTop+.5,plotW,volH);

  ctx.save(); ctx.beginPath(); ctx.rect(L,pTop,plotW,priceH); ctx.clip();

  // index line on top
  if(hasIdx){ let a=Infinity,z=-Infinity; for(let i=s0;i<base.length;i++){ const v=bA[i]; if(v!=null){a=Math.min(a,v);z=Math.max(z,v);} }
    if(z>a){ const iy = v => ixBot - (Math.log(v)-Math.log(a))/(Math.log(z)-Math.log(a))*(ixBot-ixTop);
      ctx.strokeStyle=C.idx; ctx.lineWidth=1; ctx.beginPath(); let on=false;
      for(let i=0;i<n;i++){ const v=bA[s0+i]; if(v==null){on=false;continue;} on?ctx.lineTo(xOf(i),iy(v)):ctx.moveTo(xOf(i),iy(v)); on=true; } ctx.stroke();
      ctx.fillStyle=C.idx; ctx.font=`600 11px ${FONT_L}`; ctx.textAlign="right"; ctx.textBaseline="bottom";
      ctx.fillText(rsBenchName(), L+plotW-4, Math.max(ixTop+10, iy(bA[base.length-1])-4)); } }

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
      const lbl = TX(`${bs.type} · ${bs.weeks} wks · ${bs.depthPct}% deep`);
      const lx = Math.max(L+4, Math.min(x0, L+plotW - ctx.measureText(lbl).width - 6));
      ctx.fillText(lbl, lx, Math.min(prBot, yb + 3));
      ctx.textBaseline = "bottom"; ctx.textAlign = "left"; ctx.fillText(`${TX("Pivot")} ${fmtP(bs.pivot)}`, Math.min(x0+2, xR-90), yP-2);
      if(bs.breakoutDate && iso(bs.breakoutDate) >= vis[0].t){ const xb = xAtT(iso(bs.breakoutDate)); ctx.beginPath(); ctx.moveTo(xb, yP+18); ctx.lineTo(xb-4, yP+26); ctx.lineTo(xb+4, yP+26); ctx.closePath(); ctx.fill(); }
    }
  }

  // user drawings: horizontal lines, trendlines and rectangles
  const marks = S.marks.slice(); if(drag && drag.cur) marks.push({...drag.cur, preview:true});
  drawMarks(ctx, marks, {xAtT, yOf, bw, L, plotW, pTop, pBot, vis});

  drawAlerts(ctx, yOf, L, plotW, pTop, pBot);

  // moving averages
  const line = (arr, color, w) => { if(!arr) return; ctx.strokeStyle=color; ctx.lineWidth=w; ctx.beginPath(); let on=false;
    for(let i=0;i<n;i++){ const v=arr[s0+i]; if(v==null){on=false;continue;} const x=xOf(i), y=yOf(v); on? ctx.lineTo(x,y) : ctx.moveTo(x,y); on=true; } ctx.stroke(); };
  for(const m of mas) line(m.data, m.color, m.lw);
  // studies on the price: bands (Bollinger, Keltner) and the anchored VWAP
  for(const o of st.over){
    if(o.kind === "band"){ ctx.globalAlpha = .08; ctx.fillStyle = o.c; ctx.beginPath(); let on=false;
        for(let i=0;i<n;i++){ const v=o.up[s0+i]; if(v==null) continue; on ? ctx.lineTo(xOf(i),yOf(v)) : ctx.moveTo(xOf(i),yOf(v)); on=true; }
        for(let i=n-1;i>=0;i--){ const v=o.lo[s0+i]; if(v==null) continue; ctx.lineTo(xOf(i),yOf(v)); } ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;
      line(o.up, o.c, 1); line(o.lo, o.c, 1); ctx.setLineDash([3,3]); line(o.mid, o.c, 1); ctx.setLineDash([]); }
    else line(o.data, o.c, 1.6);
  }

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
      ctx.fillStyle=C.rs; ctx.font=`600 10px ${FONT_L}`; ctx.textAlign="left"; ctx.textBaseline="top"; ctx.fillText(TX("RS LINE"), L+6, rsTop);
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
  if(showVol){
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
  }

  // study panels under the price (RSI, MACD, ADR %, ATR, relative volume)
  st.panes.forEach((pn, k)=>{
    const top = paneTop + k*(paneH+4), bot = top + paneH, inT = top + 16, inB = bot - 4;
    ctx.strokeStyle=C.ink; ctx.lineWidth=1; ctx.strokeRect(L+.5, top+.5, plotW, paneH);
    let lo = Infinity, hi = -Infinity; const scan = a => { for(let i=s0;i<base.length;i++){ const v=a[i]; if(v!=null && isFinite(v)){ lo=Math.min(lo,v); hi=Math.max(hi,v); } } };
    (pn.lines||[]).forEach(l=>scan(l.d)); if(pn.hist) scan(pn.hist); if(pn.bars){ scan(pn.bars); lo = Math.min(lo, 0); }
    (pn.guides||[]).forEach(g=>{ lo=Math.min(lo,g); hi=Math.max(hi,g); });
    if(pn.fix){ lo = pn.fix[0]; hi = pn.fix[1]; }
    if(!isFinite(lo) || hi <= lo){ hi = (isFinite(hi) ? hi : 1) + 1; lo = hi - 2; }
    const y = v => inB - (v-lo)/(hi-lo)*(inB-inT);
    ctx.save(); ctx.beginPath(); ctx.rect(L, top, plotW, paneH); ctx.clip();
    (pn.guides||[]).forEach(g=>{ ctx.strokeStyle=C.grid; ctx.setLineDash([3,3]); ctx.beginPath(); ctx.moveTo(L, Math.round(y(g))+.5); ctx.lineTo(L+plotW, Math.round(y(g))+.5); ctx.stroke(); ctx.setLineDash([]); });
    if(pn.hist){ const y0 = y(0); for(let i=0;i<n;i++){ const v=pn.hist[s0+i]; if(v==null) continue; ctx.fillStyle = v>=0 ? "rgba(29,63,196,.45)" : "rgba(224,51,127,.45)";
      const w=Math.max(1,Math.round(bw*0.62)); ctx.fillRect(Math.round(xOf(i)-w/2), Math.min(y0,y(v)), w, Math.max(1,Math.abs(y(v)-y0))); } }
    if(pn.bars){ const y0 = y(0); for(let i=0;i<n;i++){ const v=pn.bars[s0+i]; if(v==null) continue; ctx.fillStyle = v>=1.5 ? C.blue : v>=1 ? "rgba(29,63,196,.55)" : "rgba(90,93,102,.45)";
      const w=Math.max(1,Math.round(bw*0.62)); ctx.fillRect(Math.round(xOf(i)-w/2), y(v), w, y0-y(v)); } }
    (pn.lines||[]).forEach(l=>{ ctx.strokeStyle=l.c; ctx.lineWidth=1.3; ctx.beginPath(); let on=false;
      for(let i=0;i<n;i++){ const v=l.d[s0+i]; if(v==null){ on=false; continue; } on ? ctx.lineTo(xOf(i),y(v)) : ctx.moveTo(xOf(i),y(v)); on=true; } ctx.stroke(); });
    ctx.restore();
    const hiI = hover>=0 && hover<n ? s0+hover : base.length-1, main = pn.lines ? pn.lines[0].d[hiI] : pn.bars[hiI];
    ctx.font=`600 ${narrow?10:11}px ${FONT_L}`; ctx.fillStyle=C.ink; ctx.textAlign="left"; ctx.textBaseline="top";
    ctx.fillText(TX(pn.name) + (main!=null && isFinite(main) ? "  " + pn.fmt(main) : ""), L+5, top+3);
    ctx.font=`${narrow?9:10}px ${FONT_D}`; ctx.fillStyle=C.ink2; ctx.textBaseline="middle";
    (pn.guides && pn.guides.length ? pn.guides : [lo + (hi-lo)/2]).forEach(g=>{ const yy=y(g); if(yy>inT && yy<inB+2) ctx.fillText(pn.fmt(g), L+plotW+5, yy); });
  });

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
  if(rsNewHigh && !narrow){ ctx.fillStyle=C.rs; ctx.textAlign="right"; ctx.fillText(TX("● RS LINE AT NEW HIGH"), L+plotW, 10); }
  if(hover>=0 && hover<n){ const x=Math.round(xOf(hover))+.5; ctx.strokeStyle="rgba(21,23,28,.35)"; ctx.lineWidth=1; ctx.setLineDash([2,3]);
    ctx.beginPath(); ctx.moveTo(x,pTop); ctx.lineTo(x,aBot); ctx.stroke(); ctx.setLineDash([]); }

  geo = {L,plotW,pTop,pBot,bw,n,vis,yOf,pOf,narrow,xAtT,base,s0,isLog};
}

/* ---------- drawing tools ---------- */
// marks: {k:"line"} horizontal level, {k:"tl"} trendline, {k:"rect"} rectangle, {k:"note"} note with an arrow.
// Style per mark: c color, w width (1-3), s "solid" | "dash" | "dot", a arrow at the end, x extend to the right edge.
const DRAW_COLORS = ["#15171c","#1f3c6e","#1d3fc4","#2f7d32","#e0337f","#d23a2a","#e07b1f","#7b4bb3"];
const DRAW_DASH = {solid:[], dash:[7,4], dot:[2,3]}, DRAW_W = {1:1.1, 2:1.9, 3:2.9};
const normDraw = d => { d = d && typeof d === "object" ? d : {}; return {c: DRAW_COLORS.includes(d.c) ? d.c : DRAW_COLORS[0], w: [1,2,3].includes(d.w) ? d.w : 2,
  s: DRAW_DASH[d.s] ? d.s : "solid", a: !!d.a, x: !!d.x}; };
cfg.draw = normDraw(cfg.draw);
let sel = -1;   // index of the selected drawing in S.marks
function markStyle(g, m){ const legacy = m.k === "line" && !m.c;
  g.strokeStyle = legacy ? C.ink : m.c; g.lineWidth = legacy ? 1.4 : DRAW_W[m.w] || 1.9; g.setLineDash(legacy ? [4,3] : DRAW_DASH[m.s] || []); }
function markPts(m, G){   // screen coordinates of a mark
  if(m.k === "line"){ const y = G.yOf(m.p); return {x1: G.xAtT(m.t1) - G.bw/2, y1: y, x2: G.xAtT(m.t2) + G.bw/2, y2: y}; }
  const p = {x1: G.xAtT(m.t1), y1: G.yOf(m.p1), x2: G.xAtT(m.t2), y2: G.yOf(m.p2)};
  if(m.k === "tl" && m.x && p.x2 !== p.x1){ const xe = G.L + G.plotW; if(xe > p.x2){ p.y2 = p.y1 + (p.y2 - p.y1) * (xe - p.x1) / (p.x2 - p.x1); p.x2 = xe; } }
  return p;
}
function drawMarks(g, marks, G){
  marks.forEach((m, idx)=>{
    if(m.k === "note") return;
    const t2 = m.k === "line" ? m.t2 : Math.max(m.t1, m.t2); if(t2 < G.vis[0].t && !(m.k === "tl" && m.x)) return;
    const P = markPts(m, G); g.globalAlpha = m.preview ? .6 : 1; markStyle(g, m);
    if(m.k === "rect"){ const x = Math.min(P.x1, P.x2), y = Math.min(P.y1, P.y2), w = Math.abs(P.x2 - P.x1), h = Math.abs(P.y2 - P.y1);
      g.fillStyle = m.c; g.globalAlpha = (m.preview ? .6 : 1) * .1; g.fillRect(x, y, w, h); g.globalAlpha = m.preview ? .6 : 1; g.strokeRect(x, y, w, h); }
    else { g.beginPath(); g.moveTo(P.x1, P.y1); g.lineTo(P.x2, P.y2); g.stroke();
      if(m.a && m.k === "tl"){ const ang = Math.atan2(P.y2 - P.y1, P.x2 - P.x1), s = 6 + (m.w || 2) * 2; g.setLineDash([]); g.fillStyle = m.c; g.beginPath();
        g.moveTo(P.x2, P.y2); g.lineTo(P.x2 - s*Math.cos(ang - .45), P.y2 - s*Math.sin(ang - .45)); g.lineTo(P.x2 - s*Math.cos(ang + .45), P.y2 - s*Math.sin(ang + .45)); g.closePath(); g.fill(); } }
    g.setLineDash([]); g.globalAlpha = 1;
    if(idx === sel && !m.preview){ g.fillStyle = "#fff"; g.strokeStyle = C.navy; g.lineWidth = 1.5;
      for(const [x, y] of [[P.x1, P.y1], [P.x2, P.y2]]){ g.fillRect(x-4, y-4, 8, 8); g.strokeRect(x-4, y-4, 8, 8); } }
  });
}
function hitMark(x, y){
  if(!geo || !S) return -1; let best = -1, bd = 7;
  const segD = (P) => { const dx = P.x2 - P.x1, dy = P.y2 - P.y1, L2 = dx*dx + dy*dy; let t = L2 ? ((x - P.x1)*dx + (y - P.y1)*dy) / L2 : 0; t = Math.max(0, Math.min(1, t));
    return Math.hypot(x - (P.x1 + t*dx), y - (P.y1 + t*dy)); };
  S.marks.forEach((m, i)=>{ if(m.k === "note") return; const P = markPts(m, geo); let d;
    if(m.k === "rect"){ const xa = Math.min(P.x1,P.x2), xb = Math.max(P.x1,P.x2), ya = Math.min(P.y1,P.y2), yb = Math.max(P.y1,P.y2);
      d = Math.min(segD({x1:xa,y1:ya,x2:xb,y2:ya}), segD({x1:xa,y1:yb,x2:xb,y2:yb}), segD({x1:xa,y1:ya,x2:xa,y2:yb}), segD({x1:xb,y1:ya,x2:xb,y2:yb})); }
    else d = segD(P);
    if(d < bd){ bd = d; best = i; } });
  return best;
}
function idxAt(x){ if(!geo) return -1; const i=Math.floor((x-geo.L)/geo.bw); return i<0||i>=geo.n ? -1 : i; }
function idxClamp(x){ return Math.max(0, Math.min(geo.n-1, Math.floor((x-geo.L)/geo.bw))); }
function snapPrice(i,y){ const b=geo.vis[i]; let p=geo.pOf(y); for(const v of [b.h,b.l,b.c]){ if(Math.abs(geo.yOf(v)-y)<8){ p=v; break; } } return p; }
function saveMarks(){ if(S){ store.set(marksKey(S.symbol), S.marks); push("marks:"+S.symbol, S.marks); } }
const ptAt = (x, y) => { const i = idxClamp(x); return {t: geo.vis[i].t, p: snapPrice(i, Math.max(geo.pTop, Math.min(geo.pBot, y))), i}; };
function dragShape(x, y){   // the mark being drawn, from the start point to the pointer
  const D = cfg.draw, a = drag.a, b = ptAt(x, y);
  if(drag.k === "hl"){ const i = idxClamp(x); return {k:"line", t1: geo.vis[Math.min(a.i,i)].t, t2: geo.vis[Math.max(a.i,i)].t, p: a.p, c: D.c, w: D.w, s: D.s}; }
  if(drag.k === "rect") return {k:"rect", t1: a.t, p1: a.p, t2: b.t, p2: b.p, c: D.c, w: D.w, s: D.s};
  return {k:"tl", t1: a.t, p1: a.p, t2: b.t, p2: b.p, c: D.c, w: D.w, s: D.s, a: D.a, x: D.x};
}
function finishDrag(x, y){
  let m = drag.cur || dragShape(x, y);
  if(drag.k === "hl" && !drag.moved) m = {...m, t2: geo.vis[geo.n-1].t};   // a click draws the level to today
  if(m.k !== "line" && m.t1 === m.t2 && Math.abs(geo.yOf(m.p1) - geo.yOf(m.p2)) < 4){ drag = null; draw(); return; }   // nothing drawn
  if(m.k !== "line" && m.t1 > m.t2) m = {...m, t1: m.t2, p1: m.p2, t2: m.t1, p2: m.p1};
  delete m.preview; S.marks.push(m); sel = -1; drag = null; saveMarks(); draw(); updDrawBar();
}
cv.addEventListener("pointermove", e=>{ if(!S) return;
  const r=cv.getBoundingClientRect(); const x=e.clientX-r.left, y=e.clientY-r.top; hover=idxAt(x);
  if(drag && geo){ drag.cur = dragShape(x, y); if(Math.abs(x-drag.x0)>5 || Math.abs(y-drag.y0)>5) drag.moved = true; }
  cv.style.cursor = tool ? "crosshair" : (geo && hitMark(x, y) >= 0 ? "pointer" : "");
  draw(); });
cv.addEventListener("pointerleave", ()=>{ if(!drag){ hover=-1; draw(); } });
cv.addEventListener("pointerdown", e=>{
  if(!geo || !S) return; const r=cv.getBoundingClientRect(); const x=e.clientX-r.left, y=e.clientY-r.top;
  if(!tool){ const h = hitMark(x, y); if(h !== sel){ sel = h; draw(); updDrawBar(); } return; }
  if(y<geo.pTop || y>geo.pBot) return; const i=idxAt(x); if(i<0 && !drag) return;
  if(tool==="note"){ pendingNote={t:geo.vis[i].t, p:snapPrice(i,y)}; const inp=$("#noteIn"); inp.hidden=false; inp.value="";
    inp.style.left = Math.max(4, Math.min(x-20, cv.clientWidth-230))+"px"; inp.style.top = Math.max(4, y-40)+"px"; setTimeout(()=>inp.focus(),0); return; }
  if(drag && drag.two){ finishDrag(x, y); return; }   // second click of a two-click trendline or rectangle
  cv.setPointerCapture(e.pointerId);
  drag = {k: tool, x0: x, y0: y, a: ptAt(x, y)}; drag.cur = dragShape(x, y); });
cv.addEventListener("pointerup", e=>{ if(!drag || !geo) return; const r=cv.getBoundingClientRect(); const x=e.clientX-r.left, y=e.clientY-r.top;
  if(!drag.moved && drag.k !== "hl"){ drag.two = true; return; }   // a click without dragging: the next click sets the end point
  finishDrag(x, y); });
function commitNote(inp){ const v=inp.value.trim(); if(v && pendingNote){ S.marks.push({k:"note",...pendingNote,text:v}); saveMarks(); } pendingNote=null; inp.hidden=true; draw(); }
$("#noteIn").addEventListener("keydown", e=>{ if(e.key==="Enter") commitNote(e.target); if(e.key==="Escape"){ pendingNote=null; e.target.hidden=true; } });
$("#noteIn").addEventListener("blur", e=>setTimeout(()=>{ if(!e.target.hidden) commitNote(e.target); },120));
const TOOL_BTN = {tl:"#bTrend", hl:"#bLine", rect:"#bRect", note:"#bNote"};
const TOOL_NAME = {tl:"Trend", hl:"Level", rect:"Box", note:"Note"};
function setTool(t){ tool = tool===t ? null : t; drag = null; Object.entries(TOOL_BTN).forEach(([k,id])=>{ $(id).classList.toggle("on", tool===k); $(id).setAttribute("aria-pressed", tool===k); });
  if(tool){ sel = -1; drawMenu(false); }
  const b = $("#bDraw"); b.classList.toggle("on", !!tool); b.querySelector("span").textContent = tool ? `${TX("Drawing")}: ${TX(TOOL_NAME[tool])}` : TX("Draw");
  updDrawBar(); draw(); }
function drawMenu(open){ const m = $("#drawMenu"); open = open == null ? m.hidden : open; m.hidden = !open; $("#bDraw").setAttribute("aria-expanded", open); if(!open) $("#drawPop").hidden = true; }
$("#bDraw").onclick = e => { e.stopPropagation(); if(tool){ setTool(tool); return; } drawMenu(); };
$("#drawMenu").addEventListener("click", e=>e.stopPropagation());
document.addEventListener("click", ()=>{ if(!$("#drawMenu").hidden) drawMenu(false); });
Object.entries(TOOL_BTN).forEach(([k,id])=>$(id).onclick=()=>setTool(k));
function delSel(){ if(!S || sel < 0 || !S.marks[sel]) return; S.marks.splice(sel, 1); sel = -1; saveMarks(); draw(); updDrawBar(); }
$("#bUndo").onclick=()=>{ if(!S) return; S.marks.pop(); sel = -1; saveMarks(); draw(); updDrawBar(); };
$("#bClr").onclick=()=>{ if(!S || !S.marks.length) return; if(!confirm(TX("Delete every drawing on this chart?"))) return; S.marks=[]; sel = -1; saveMarks(); draw(); updDrawBar(); };
$("#bDel").onclick = ()=>{ delSel(); drawMenu(false); };
// the style bar: color, width, line style, arrow and extend. It styles the next drawing, or the selected one.
function updDrawBar(){
  const m = S && sel >= 0 ? S.marks[sel] : null, D = m && m.k !== "note" ? {...cfg.draw, ...normDraw(m)} : cfg.draw;
  $("#bDel").hidden = !m;
  $("#dSw").style.background = D.c;
  const pop = $("#drawPop");
  pop.innerHTML = `<div class="dprow">${DRAW_COLORS.map(c=>`<button class="dcol ${D.c===c?"on":""}" data-dc="${c}" style="--c:${c}" aria-label="${esc(TX("Color"))} ${c}"></button>`).join("")}</div>
    <div class="dprow"><span>${esc(TX("Width"))}</span>${[1,2,3].map(w=>`<button class="dopt ${D.w===w?"on":""}" data-dw="${w}" aria-label="${esc(TX("Line width"))} ${w}"><i style="border-top-width:${w}px"></i></button>`).join("")}</div>
    <div class="dprow"><span>${esc(TX("Style"))}</span>${Object.keys(DRAW_DASH).map(s=>`<button class="dopt ${D.s===s?"on":""}" data-ds="${s}" aria-label="${esc(TX(s==="solid"?"Solid":s==="dash"?"Dashed":"Dotted"))}"><i style="border-top-style:${s==="solid"?"solid":s==="dash"?"dashed":"dotted"}"></i></button>`).join("")}</div>
    <div class="dprow"><label class="chk"><input type="checkbox" data-da ${D.a?"checked":""}> ${esc(TX("Arrow at the end"))}</label><label class="chk"><input type="checkbox" data-dx ${D.x?"checked":""}> ${esc(TX("Extend to the right"))}</label></div>
    <p class="fine">${esc(TX(m ? "Changes apply to the selected drawing." : "Applies to your next drawing. Click a drawing to select it."))}</p>`;
}
function setDraw(k, v){
  cfg.draw = normDraw({...cfg.draw, [k]: v}); store.set("ink:cfg", cfg); push("cfg", cfg);
  if(S && sel >= 0 && S.marks[sel] && S.marks[sel].k !== "note"){ const m = S.marks[sel]; if(k === "a" || k === "x"){ if(m.k === "tl") m[k] = v; } else m[k] = v; saveMarks(); }
  updDrawBar(); draw();
}
$("#dStyle").onclick = e => { e.stopPropagation(); const p = $("#drawPop"); p.hidden = !p.hidden; $("#dStyle").setAttribute("aria-expanded", !p.hidden); if(!p.hidden) updDrawBar(); };
$("#drawPop").addEventListener("click", e=>{ e.stopPropagation(); const b = e.target.closest("button"); if(!b) return;
  if(b.dataset.dc) setDraw("c", b.dataset.dc); if(b.dataset.dw) setDraw("w", +b.dataset.dw); if(b.dataset.ds) setDraw("s", b.dataset.ds); });
$("#drawPop").addEventListener("change", e=>{ const t = e.target; if(t.matches("[data-da]")) setDraw("a", t.checked); if(t.matches("[data-dx]")) setDraw("x", t.checked); });
document.addEventListener("click", e=>{ const p = $("#drawPop"); if(!p.hidden && !e.composedPath().includes(p)){ p.hidden = true; $("#dStyle").setAttribute("aria-expanded", false); } });
$("#bInd").onclick = openInd;
updDrawBar();
syncBox();

/* ---------- panels ---------- */
function renderPanels(){
  const F = S.fund||{}, st = S.stats||{}, b = S.base;
  const ch = st.chgPct;
  $("#sym").textContent = S.symbol; $("#cname").textContent = S.name || "";
  document.title = `${S.symbol}${S.name ? " · " + S.name : ""} stock chart · Ticker&Tape`;
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
    $$("#qtrs tr[data-s]").forEach(tr=>tr.onclick=()=>{ go(tr.dataset.s); });
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
      (E.gics ? `<div class="in"><a class="btn" href="/screener/" data-sector="${esc(E.gics)}">See the ${esc(E.gics)} stocks →</a></div>` : "");
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
  const bnm = esc(rsBenchName()), ov = [cfg.ind.bb.on && [cfg.ind.bb.c, `Bollinger (${cfg.ind.bb.n}, ${cfg.ind.bb.k})`], cfg.ind.kc.on && [cfg.ind.kc.c, `Keltner (${cfg.ind.kc.n}, ${cfg.ind.kc.k})`],
    cfg.ind.vwap.on && [cfg.ind.vwap.c, `VWAP from ${VWAP_A[cfg.ind.vwap.a]}`]].filter(Boolean);
  $("#legend").innerHTML = cfg.ind.mas.filter(m=>!view.weekly || maOnWeekly(m)).map(m=>`<span><span class="sw" style="border-color:${m.c};border-top-width:${m.w+1}px"></span><b>${esc(maName(m, view.weekly))}</b></span>`).join("") +
    ov.map(([c,t])=>`<span><span class="sw" style="border-color:${c}"></span><b>${esc(t)}</b></span>`).join("") +
    `<span><span class="sw" style="border-color:${C.rs}"></span><b>RS line</b> vs ${bnm}</span><span><span class="sw" style="border-color:${C.idx};border-top-width:1px"></span><b>${bnm}</b></span>` +
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
  if(!peers.length){ box.innerHTML = `<div class="empty">No other stocks from this industry group on the site.</div>`; return; }
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
  $$("#peers tr[data-s]").forEach(tr=>tr.onclick=()=>{ if(tr.dataset.s!==me) go(tr.dataset.s); });
}

/* ---------- intraday prices (live.json on the "live" branch, refreshed every 15 min in market hours) ---------- */
let LIVE = null;
const LIVE_URL = (location.hostname === "localhost" || location.protocol === "file:") ? "/data/live.json"
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
  if(!$("#vCmp").hidden) renderCmp();
  if(!$("#vWelcome").hidden) renderWelcome();
  if(!$("#vPortfolio").hidden && PF.trades.length) pfCompute().then(c=>{ if(c){ pfCalc = c; renderPortfolio(); } });
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
  const rw = rowOf(S.symbol);
  const rows = [["RS Rating",F.rs],["Composite Rating", rw && rw.comp != null ? String(rw.comp) : ""],["Group Rank",F.groupRank],["SMR Rating",smr],["U/D Vol Ratio",st.udRatio!=null?st.udRatio.toFixed(2):""],
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
function step(d){ const cur = CUR || (S && S.symbol); if(!cur) return; const L = order.length ? order : ROWS.map(r=>r.symbol); const i=L.indexOf(cur); if(i<0) return; go(L[(i+d+L.length)%L.length]); }
function setNavPos(){   // "3 of 30 · Trade ideas" next to the ‹ › arrows
  const el = $("#bPos"); if(!el || !S) return; const L = order.length ? order : ROWS.map(r=>r.symbol); const i = L.indexOf(S.symbol);
  const name = {ideas:"Trade ideas", heatmap:"Heatmap", earnings:"Earnings", watchlist:"Watchlist", screener:"Screener", etfs:"ETFs"}[lastList] || "";
  el.textContent = i < 0 ? "" : `${i+1} of ${L.length}${name ? " · " + name : ""}`;
}
$("#bPrev").onclick=()=>step(-1); $("#bNext").onclick=()=>step(1);
// keyboard: ← → next ticker, T/H/R/N drawing tools, Delete removes the selected drawing, Ctrl+Z undo, D/W daily/weekly, I indicators, A alert
document.addEventListener("keydown", e=>{
  if(e.target.closest('input:not([type=checkbox]):not([type=color]),select,textarea') || TOUR_ON() || !$("#dlg").hidden) return;
  if(e.key==="Escape"){ if(drag){ drag=null; draw(); } else if(tool) setTool(tool); else if(sel >= 0){ sel = -1; draw(); updDrawBar(); } }
  if($("#vChart").hidden) return;
  const k = e.key.toLowerCase();
  if((e.ctrlKey || e.metaKey) && k === "z"){ e.preventDefault(); $("#bUndo").click(); return; }
  if(e.ctrlKey || e.metaKey || e.altKey) return;
  if(e.key==="ArrowRight") step(1); else if(e.key==="ArrowLeft") step(-1);
  else if((e.key==="Delete" || e.key==="Backspace") && sel >= 0){ e.preventDefault(); delSel(); }
  else if(k==="t") setTool("tl"); else if(k==="h") setTool("hl"); else if(k==="r") setTool("rect"); else if(k==="n") setTool("note");
  else if(k==="d") $("#pD").click(); else if(k==="w") $("#pW").click(); else if(k==="i") openInd(); else if(k==="a") openAlert();
});

async function openChart(sym){
  $("#vScreener").hidden = true; $("#vHome").hidden = true; $("#vChart").hidden = false; $("#loading").hidden = false;
  CUR = sym; updateStar(); sel = -1; drag = null;
  window.scrollTo(0,0);
  try{
    const [bundle] = await Promise.all([getJSON(`t/${encodeURIComponent(sym.replace(/=/g,"_"))}.json`), BENCH ? null : getJSON("bench.json").then(b=>{ BENCH = b.prices.map(([d,c])=>({t:iso(d),c})); }), cfg.ind.rs === "qqq" ? loadBenchX() : null]);
    S = { symbol: bundle.symbol, name: bundle.name, fund: bundle.fund||{}, stats: bundle.stats||{}, base: bundle.base,
      px: bundle.prices.map(([d,o,h,l,c,v])=>({t:iso(d),o,h,l,c,v})), marks: store.get(marksKey(bundle.symbol)) || [] };
    CUR = S.symbol; updateStar(); renderTkNote(); $("#bAlert").classList.toggle("on", ALERTS.some(a=>a.symbol===CUR && !a.fired)); patchS(); hover=-1; renderPanels(); draw(); renderDbox(); setShare(); setEarnChip(); setNavPos();
    if(cfg.ind.rs === "sector" && rsBenchSym() && !benchX.has(rsBenchSym())) loadBenchX().then(()=>{ if(S && S.symbol === CUR){ draw(); renderPanels(); } });
  }catch(e){
    S=null; draw(); $("#sym").textContent = sym; $("#cname").textContent = "";
    toast(inWL(sym) ? `${sym} is in your watchlist: its chart loads after the next nightly update.` : `No data for ${sym} yet. Tap ☆ to add it to your watchlist: it loads after the next nightly update.`);
  }finally{ $("#loading").hidden = true; }
}
const ROUTES = {watchlist:"watch", screener:"all", etfs:"etf"};
let lastList = "";
function setTab(v){ $$("#tabs a").forEach(a=>a.classList.toggle("on", a.dataset.v===v));
  const on = $("#tabs a.on"); $("#tabsCur").textContent = on ? on.textContent : TX("Sections"); tabsMenu(false); }
function tabsMenu(open){ $("#tabs").classList.toggle("open", open); $("#tabsBtn").setAttribute("aria-expanded", open); }
$("#tabsBtn").onclick = e => { e.stopPropagation(); tabsMenu(!$("#tabs").classList.contains("open")); };
document.addEventListener("click", e=>{ if($("#tabs").classList.contains("open") && !e.target.closest("#tabs,#tabsBtn")) tabsMenu(false); });
// anonymous usage statistics: one beacon per page view (section, ticker, language, screen width, where the visit came from).
// No cookies and no identifiers; the API counts unique visitors with a hash that changes every day.
let trackFirst = true;
function track(p, s){
  try{
    if(/^(localhost|127\.)/.test(location.hostname) || navigator.doNotTrack === "1" || !navigator.sendBeacon) return;
    let r = "";
    if(trackFirst){
      const via = new URLSearchParams(location.search).get("via");
      if(via){ r = via.slice(0, 20); const q = new URLSearchParams(location.search); q.delete("via"); history.replaceState(null, "", location.pathname + (q.toString() ? "?" + q : "") + location.hash); }
      else if(document.referrer){ const h = new URL(document.referrer).hostname; r = /(^|\.)tickerandtape\.com$/.test(h) ? "" : h; }
      else r = "direct";
      trackFirst = false;
    }
    navigator.sendBeacon(API + "/t", new Blob([JSON.stringify({p, s: p === "chart" ? s : "", r, l: I18N.lang, w: innerWidth, u: auth.token ? 1 : 0})], {type:"text/plain"}));
  }catch(e){}
}
function route(){
  const chartPath = location.hash.length <= 1 && /^\/chart\//.test(location.pathname);
  let raw = location.hash.length > 1 ? decodeURIComponent(location.hash.slice(1)).trim() : pathToKey();
  if(/^reset=[0-9a-f]{48}$/.test(raw)){   // link from the password reset email
    resetToken = raw.slice(6); history.replaceState(null, "", location.pathname); openAuth("reset"); raw = ""; }
  if(raw.toLowerCase() === "alerts"){ history.replaceState(null, "", location.pathname); raw = ""; setTimeout(()=>{ if(auth.token) loadAlerts().then(openAlertsList); else openAuth("in"); }, 300); }
  // a path the site doesn't know (old or mistyped link): page not found, for visitors and members alike
  if(!location.hash && raw === "" && !/^\/(index\.html)?$/.test(location.pathname)){
    ["#vWelcome","#vHome","#vScreener","#vChart","#vHeat","#vIdeas","#vResearch","#vMacro","#vPortfolio","#vEarn","#vBreadth","#vGroups","#vWall","#vCmp"].forEach(id=>$(id).hidden = true);
    $("#vNotFound").hidden = false; document.body.classList.add("on-welcome"); setTab(""); document.title = TX("Page not found · Ticker&Tape"); window.scrollTo(0,0); return; }
  if(location.hash) history.replaceState(null, "", keyToPath(raw));   // old #links → clean URL
  // signed-out visitors only get the welcome page, except for a chart link (shared on X, found on Google), which opens with a sign-up bar
  { const l = raw.toLowerCase(), chartish = chartPath || (raw !== "" && l !== "home" && !SECTIONS.includes(l) && !l.startsWith("compare/"));
    if(!auth.token && l !== "welcome" && !chartish){ history.replaceState(null, "", "/welcome/"); raw = "welcome"; } }
  const low = raw.toLowerCase();
  const isList = raw === low && ROUTES[low];
  track(low === "" || low === "home" ? "home" : isList ? low : ["groups","heatmap","breadth","ideas","research","macro","portfolio","earnings","wall","welcome"].includes(low) ? low : low === "compare" || low.startsWith("compare/") ? "compare" : "chart", raw.toUpperCase());
  const isHome = raw === "" || raw === "home";
  ["#vWelcome","#vHome","#vScreener","#vChart","#vHeat","#vIdeas","#vResearch","#vMacro","#vPortfolio","#vEarn","#vBreadth","#vGroups","#vWall","#vCmp","#vNotFound"].forEach(id=>$(id).hidden = true); $("#hmTip").hidden = true; $("#gateBar").hidden = true;
  $("#vNotFound").hidden = true; document.body.classList.toggle("on-welcome", raw === "welcome"); if(raw !== "welcome") $("#wSticky").classList.remove("on");
  document.body.classList.toggle("on-home", isHome);
  if(chartPath && raw){ setTab(""); $("#gateBar").hidden = !!auth.token; openChart(raw.toUpperCase()); return; }
  if(raw === "welcome"){ $("#vWelcome").hidden = false; setTab(""); document.title = "Ticker&Tape · The complete research platform for stock traders"; window.scrollTo(0,0); renderWelcome(); return; }
  if(low === "earnings"){ lastList = "earnings"; $("#vEarn").hidden = false; setTab("earn"); document.title = "Earnings calendar · Ticker&Tape"; window.scrollTo(0,0); renderEarn(); return; }
  if(low === "portfolio"){ lastList = "portfolio"; $("#vPortfolio").hidden = false; setTab("pf"); document.title = "Portfolio · Ticker&Tape"; window.scrollTo(0,0); renderPortfolio(); return; }
  if(low === "macro"){ lastList = "macro"; $("#vMacro").hidden = false; setTab("macro"); document.title = "Macro calendar and Fed odds · Ticker&Tape"; window.scrollTo(0,0); renderMacro(); return; }
  if(low === "research"){ lastList = "research"; $("#vResearch").hidden = false; setTab("research"); document.title = "Research · Ticker&Tape"; window.scrollTo(0,0); renderResearch(); return; }
  if(low === "ideas"){ lastList = "ideas"; $("#vIdeas").hidden = false; setTab("ideas"); document.title = "Trade ideas · Ticker&Tape"; window.scrollTo(0,0); renderIdeas(); return; }
  if(low === "groups"){ lastList = "groups"; $("#vGroups").hidden = false; setTab("groups"); document.title = "Industry groups · Ticker&Tape"; window.scrollTo(0,0); renderGroups(); return; }
  if(low === "wall"){ lastList = "wall"; $("#vWall").hidden = false; setTab(""); document.title = "Chart wall · Ticker&Tape"; window.scrollTo(0,0); renderWall(); return; }
  if(low === "breadth"){ lastList = "breadth"; $("#vBreadth").hidden = false; setTab("breadth"); document.title = "Market breadth · Ticker&Tape"; window.scrollTo(0,0); renderBreadth(); return; }
  if(low === "compare" || low.startsWith("compare/")){ lastList = "compare"; $("#vCmp").hidden = false; setTab("cmp"); document.title = "Comparative charts · Ticker&Tape"; window.scrollTo(0,0); openCmp(raw.slice(8)); return; }
  if(low === "heatmap"){ lastList = "heatmap"; $("#vHeat").hidden = false; setTab("heat"); document.title = "Heatmap · Ticker&Tape"; window.scrollTo(0,0); renderHeat(); return; }
  if(isHome){ lastList = ""; $("#vHome").hidden = false; setTab("home"); document.title = "Ticker&Tape · Market dashboard"; renderHome(); return; }
  if(isList){ lastList = raw; $("#vScreener").hidden = false; setTab(ROUTES[low]); document.title = `${{watch:"Watchlist",all:"Screener",etf:"ETFs"}[ROUTES[low]]} · Ticker&Tape`;
    if(ROUTES[low] !== "all"){ scrState.sector = null; scrState.industry = null; }
    setScope(ROUTES[low]); return; }
  setTab(""); $("#gateBar").hidden = !!auth.token; openChart(raw.toUpperCase());
}
$("#bBack").onclick = () => { go(lastList); };   // back to the list (or home) the chart was opened from
$$("#tabs a").forEach(a=>a.addEventListener("click", ()=>{ if(a.dataset.v==="all"){ scrState.sector = null; scrState.industry = null; } }));
document.addEventListener("click", e=>{ const b = e.target.closest("[data-sector]"); if(!b) return; e.preventDefault(); scrState.sector = b.dataset.sector; scrState.industry = null; scrState.filter = "all"; store.set("ink:filter", "all");
  $$("#filters button").forEach(x=>x.classList.toggle("on", x.dataset.f==="all")); if(here() === "#screener") setScope("all"); else go("screener"); });

// warns when the nightly data is older than the last session that should already be in (NYSE holidays skipped)
const NYSE_HOLIDAYS = new Set(["2026-01-01","2026-01-19","2026-02-16","2026-04-03","2026-05-25","2026-06-19","2026-07-03","2026-09-07","2026-11-26","2026-12-25",
  "2027-01-01","2027-01-18","2027-02-15","2027-03-26","2027-05-31","2027-06-18","2027-07-05","2027-09-06","2027-11-25","2027-12-24"]);
function staleNote(dataDate){
  try{
    const et = new Date(new Date().toLocaleString("en-US", {timeZone:"America/New_York"}));
    const d = new Date(Date.UTC(et.getFullYear(), et.getMonth(), et.getDate()));
    if(et.getHours() < 20) d.setUTCDate(d.getUTCDate() - 1);          // tonight's update is usually in by 8 p.m. New York time
    const isSession = x => x.getUTCDay() % 6 !== 0 && !NYSE_HOLIDAYS.has(x.toISOString().slice(0,10));
    while(!isSession(d)) d.setUTCDate(d.getUTCDate() - 1);
    const want = d.toISOString().slice(0,10);
    return dataDate < want ? TX(`Heads up: charts and ratings are from the ${fmtLong(iso(dataDate))} close. The latest update is running late and will appear here automatically.`) : "";
  }catch(e){ return ""; }
}

/* ================= HOME DASHBOARD ================= */
let HOME = null, homeLoading = null, SPYB = null, movMode = "up";
// home chart: S&P 500 E-mini futures (falls back to SPY until the futures file exists)
const HC = {symbol:"ES=F", file:"ES_F", title:"S&amp;P 500 futures · ES"};
function loadHome(){
  if(!homeLoading) homeLoading = Promise.all([
    getJSON("home.json").then(h=>{ HOME = h; }).catch(()=>{ HOME = {market:[], sectors:[], commodities:[], news:[]}; }),
    getJSON(`t/${HC.file}.json`).catch(()=>{ Object.assign(HC, {symbol:"SPY", file:"SPY", title:"S&amp;P 500 · SPY"}); return getJSON("t/SPY.json"); })
      .then(b=>{ SPYB = b; $("#hcTitle").innerHTML = HC.title; $("#hcLink").setAttribute("href", keyToPath(HC.symbol)); }).catch(()=>{})
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
      <td class="l">${sector && r.gics ? `<a href="/screener/" class="comp" data-sector="${esc(r.gics)}">Components →</a>` : ""}</td></tr>`;
  $("#hSect").innerHTML = `<table class="scr sect"><thead><tr><th class="l nosort">ETF</th><th class="nosort">Price</th>${PERF.map(([k,l])=>`<th data-hk="${k}" class="${sectSort.k===k?'sorted'+(sectSort.asc?' asc':''):''}">${l}</th>`).join("")}<th class="nosort spk">3 months</th><th class="nosort"></th></tr></thead>
    <tbody><tr class="grp"><td colspan="${PERF.length+4}">Market</td></tr>${M.map(r=>row(r,false)).join("")}
    <tr class="grp"><td colspan="${PERF.length+4}">Sectors <small>click a column to rank them</small></td></tr>${Sx.map(r=>row(r,true)).join("")}</tbody></table>`;
  const all = [...M, ...Sx];
  $$("canvas[data-hspark]").forEach(cv=>{ const r = all.find(x=>x.symbol===cv.dataset.hspark); sparkline(cv, r && r.spark); });
  $$("#hSect th[data-hk]").forEach(th=>th.onclick=()=>{ const k=th.dataset.hk; sectSort = {k, asc: sectSort.k===k ? !sectSort.asc : false}; renderHome(); });
  $$("#hSect tr[data-s]").forEach(tr=>tr.onclick=e=>{ if(e.target.closest("[data-sector]")) return; go(tr.dataset.s); });
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
  $$("#hCom tr[data-s]").forEach(tr=>tr.onclick=()=>{ go(tr.dataset.s); });
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
  $$("#vHome .hlists tr[data-s]").forEach(tr=>tr.onclick=()=>{ go(tr.dataset.s); });
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
  if(!SPYB){ g.fillStyle = C.ink2; g.font = `13px ${FONT_D}`; g.fillText(TX("Loading…"), 12, 24); return; }
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
  [[mc("d50"),"50-day"],[mc("d200"),"200-day"]].forEach(([col,l],k)=>{ g.fillStyle = col; g.fillRect(L+8+k*70, T+9, 14, 3); g.fillStyle = C.ink2; g.fillText(TX(l), L+26+k*70, T+5); });
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
  if(v == null || !isFinite(v)) return "#3a3d46";
  const t = Math.max(-1, Math.min(1, (HM.c === "rsRating" ? v-50 : v) / HM_SCALE[HM.c]));
  // dark neutral, color gets stronger with the size of the move; every stop keeps white type readable
  const site = HM.k === "site";
  const mid = [62,66,79];
  const neg = site ? [[118,52,92],[170,42,104],[214,40,116]] : [[132,66,76],[180,58,64],[226,52,55]];
  const pos = site ? [[44,66,128],[34,76,178],[26,88,226]] : [[50,106,74],[42,134,70],[34,160,72]];
  const ramp = t < 0 ? neg : pos, u = Math.abs(t);
  const mix = (x,y,f)=>x.map((xv,i)=>Math.round(xv+(y[i]-xv)*f));
  const stops = [mid, ...ramp], seg = Math.min(2.999, u*3), k = Math.floor(seg);
  const c = mix(stops[k], stops[k+1], seg-k);
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
      // type scales with the box but stays restrained: room on the sides, capped size, hidden when it would not fit
      const fs = Math.min(28, (tw - 10)/(r.symbol.length*0.62 + 0.3), th*0.36);
      const vfs = Math.max(9, Math.min(15, fs*0.52));
      const vtxt = HM.c === "rsRating" ? (v==null?"—":String(Math.round(v))) : fmtPct(v, HM.c === "chgPct" ? 2 : 1);
      const lab = fs >= 9 ? `<span class="s" style="font-size:${fs.toFixed(1)}px">${esc(r.symbol)}</span>${th >= fs*1.1 + vfs + 10 && tw >= vtxt.length*vfs*0.62 + 8 ? `<span class="v" style="font-size:${vfs.toFixed(1)}px">${vtxt}</span>` : ""}` : "";
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
  order = hmTiles.filter(t=>t.v!=null).sort((a,b)=> HM.rank==="top" ? b.v-a.v : a.v-b.v).map(t=>t.r.symbol);
  const list = hmTiles.filter(t=>t.v!=null).sort((a,b)=> HM.rank==="top" ? b.v-a.v : a.v-b.v).slice(0, Math.max(10, Math.min(40, Math.floor(($("#hmap").offsetHeight + 40) / 40))));
  const vt = v => HM.c === "rsRating" ? Math.round(v) : fmtPct(v, 2);
  $("#hmRank").innerHTML = `<table class="scr mini"><thead><tr><th class="l nosort">Stock</th><th class="nosort">Price</th><th class="nosort">${HM.c==="rsRating"?"RS":esc(HM_LABEL[HM.c].replace(" change",""))}</th></tr></thead><tbody>${
    list.map(t=>`<tr data-s="${esc(t.r.symbol)}"><td class="l"><span class="sym">${esc(t.r.symbol)}</span><span class="nm">${esc(t.r.name)}</span></td><td>${fmtP(t.r.close)}</td><td class="big ${t.v<(HM.c==="rsRating"?50:0)?'neg':'up'}">${vt(t.v)}</td></tr>`).join("")}</tbody></table>`;
  $$("#hmRank tr[data-s]").forEach(tr=>{ tr.onclick = ()=>{ go(tr.dataset.s); };
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
$("#hmap").addEventListener("click", e=>{ const el = e.target.closest(".hmt"); if(!el) return; $("#hmTip").hidden = true; const t = hmTiles[+el.dataset.i]; if(t) go(t.r.symbol); });
[["#hmGroup","g","g"],["#hmColor","c","c"],["#hmSize","z","z"],["#hmScheme","k","k"],["#hmRankSeg","rank","r"]].forEach(([sel,key,attr])=>
  $$(sel+" button").forEach(b=>b.onclick = e=>{ e.stopPropagation(); HM[key] = b.dataset[attr]; store.set("tt:heat", HM); key === "rank" ? (renderHeatRank(), $$("#hmRankSeg button").forEach(x=>x.classList.toggle("on", x===b))) : renderHeat(); }));
/* ================= EARNINGS CALENDAR ================= */
let EARN = null, earnLoading = null, earnWeek = null, earnFilter = store.get("tt:earnF") || "all";
const EARN_NEXT = new Map();   // symbol -> next upcoming report
const etToday = () => new Date().toLocaleDateString("en-CA", {timeZone:"America/New_York"});
function loadEarn(){
  if(!earnLoading) earnLoading = getJSON("earnings.json").then(d=>{
    EARN = d; const t = etToday();
    (d.events||[]).filter(e=>e.date >= t).forEach(e=>{ if(!EARN_NEXT.has(e.symbol)) EARN_NEXT.set(e.symbol, e); });
  }).catch(()=>{ EARN = {weeks:[], events:[]}; });
  return earnLoading;
}
const tradingDaysUntil = d => { let n = 0; const a = new Date(etToday()+"T12:00:00Z"), b = new Date(d+"T12:00:00Z");
  for(const x = new Date(a); x < b; x.setUTCDate(x.getUTCDate()+1)){ const w = x.getUTCDay(); if(w && w < 6) n++; } return n; };
const whenTxt = e => { const d = new Date(e.date+"T12:00:00Z");
  return `${d.toLocaleDateString(LOC,{weekday:"short", month:"short", day:"numeric", timeZone:"UTC"})}${e.time==="bmo" ? " · before open" : e.time==="amc" ? " · after close" : ""}`; };
function earnBadge(sym){   // for the screener: an "E" when the report is 7 trading days away or less
  const e = EARN_NEXT.get(sym); if(!e) return "";
  const n = tradingDaysUntil(e.date); return n <= 7 ? `<span class="ebadge" title="Earnings ${esc(whenTxt(e))}">E${n<=0?"":n}</span>` : "";
}
function setEarnChip(){
  const c = $("#earnChip"); if(!c || !S) return; c.hidden = true;
  let e = EARN_NEXT.get(S.symbol);
  if(!e && S.fund && S.fund.nextEarnDate && S.fund.nextEarnDate >= etToday()) e = {date:S.fund.nextEarnDate, time:""};
  if(!e) return;
  const n = tradingDaysUntil(e.date); if(n > 20) return;
  c.textContent = n <= 0 ? `Earnings today${e.time==="amc"?" after close":e.time==="bmo"?" before open":""}` : `Earnings in ${n} day${n===1?"":"s"} · ${whenTxt(e)}`;
  c.className = "chip echip" + (n <= 5 ? " soon" : ""); c.title = "Reporting soon: a gap on the report can skip right past a stop."; c.hidden = false;
}
function renderEarn(){
  if(!EARN){ $("#eCal").innerHTML = `<div class="empty">Loading…</div>`; loadEarn().then(()=>{ if(!$("#vEarn").hidden) renderEarn(); }); return; }
  const W = EARN.weeks || [];
  if(!earnWeek){   // the week that contains today; on a weekend, the coming one
    const t = new Date(etToday()+"T12:00:00Z"); while(t.getUTCDay()===0 || t.getUTCDay()===6) t.setUTCDate(t.getUTCDate()+1);
    const ts = t.toISOString().slice(0,10);
    const hit = W.find(w=>{ const e = new Date(w.start+"T12:00:00Z"); e.setUTCDate(e.getUTCDate()+4); return w.start <= ts && ts <= e.toISOString().slice(0,10); });
    earnWeek = (hit || W[1] || W[0] || {}).key; }
  $("#eWeek").innerHTML = W.map(w=>{ const d = new Date(w.start+"T12:00:00Z"); return `<button data-w="${w.key}" class="${w.key===earnWeek?"on":""}">${esc(w.label)} <small>${d.toLocaleDateString(LOC,{month:"short", day:"numeric", timeZone:"UTC"})}</small></button>`; }).join("");
  $$("#eWeek button").forEach(b=>b.onclick = ()=>{ earnWeek = b.dataset.w; renderEarn(); });
  $$("#eFilter button").forEach(b=>b.classList.toggle("on", b.dataset.f === earnFilter));
  const wk = W.find(w=>w.key===earnWeek); if(!wk){ $("#eCal").innerHTML = `<div class="empty">The calendar loads after the next nightly update.</div>`; return; }
  const days = [...Array(5)].map((_,i)=>{ const d = new Date(wk.start+"T12:00:00Z"); d.setUTCDate(d.getUTCDate()+i); return d.toISOString().slice(0,10); });
  const wl = new Set(getWL());
  const keep = e => earnFilter === "lead" ? (e.rs||0) >= 80 : earnFilter === "watch" ? wl.has(e.symbol) : true;
  const evs = (EARN.events||[]).filter(e=>days.includes(e.date) && keep(e));
  order = [...new Set(days.flatMap(d=>["bmo","amc",""].flatMap(t=>evs.filter(e=>e.date===d && e.time===t).map(e=>e.symbol))))];
  const today = etToday();
  // stats
  const past = evs.filter(e=>e.epsAct!=null && e.surprise!=null), beat = past.filter(e=>e.surprise>0).length;
  const lead = evs.filter(e=>(e.rs||0)>=80).length, rx = evs.filter(e=>e.reactPct!=null);
  $("#eStats").innerHTML = `<div><b>${evs.length}</b><span>reports ${earnFilter==="all"?"":"(filtered)"}</span></div><div><b>${lead}</b><span>leaders (RS ≥ 80)</span></div>`
    + (past.length ? `<div><b>${Math.round(100*beat/past.length)}%</b><span>beat estimates (${past.length} so far)</span></div><div><b class="${rx.length && rx.reduce((s,e)=>s+e.reactPct,0)<0?'neg':''}">${rx.length ? fmtPct(rx.reduce((s,e)=>s+e.reactPct,0)/rx.length,1) : "—"}</b><span>average reaction</span></div>`
      : `<div class="wide" style="grid-column:span 2"><span>Results, surprises and reactions fill in as companies report.</span></div>`);
  $("#eCount").textContent = "Reported: EPS surprise · reaction   ·   Upcoming: consensus EPS · growth vs a year ago" + (EARN.dataDate ? `   ·   updated ${fmtLong(iso(EARN.dataDate))}` : "");
  const item = e => {
    const lead = (e.rs||0) >= 80, done = e.epsAct != null;
    const g = (!done && e.epsEst!=null && e.epsLY) ? ((e.epsEst - e.epsLY)/Math.abs(e.epsLY))*100 : null;
    const right = done
      ? `<span class="${(e.surprise??0)<0?'neg':'up'}" title="EPS ${e.epsAct} vs ${e.epsEst ?? "—"} expected">${e.surprise!=null ? fmtPct(e.surprise,0) : "—"}</span>${e.reactPct!=null ? `<b class="${e.reactPct<0?'neg':'up'}" title="Reaction in the first session after the report">${fmtPct(e.reactPct,1)}</b>` : ""}`
      : `<span title="Consensus EPS${e.epsLY?` vs ${e.epsLY} a year ago`:""}">${e.epsEst!=null ? "$"+(+e.epsEst).toFixed(2) : ""}</span>${g!=null && isFinite(g) ? `<b class="${g<0?'neg':'up'}" title="Expected EPS growth vs the same quarter last year">${fmtPct(g,0)}</b>` : ""}`;
    const res = done ? ((e.surprise ?? 0) > 0 ? " beat" : (e.surprise ?? 0) < 0 ? " miss" : "") : "";
    return `<a class="eitem${lead?" lead":""}${wl.has(e.symbol)?" mine":""}${res}" href="/chart/${esc(e.symbol)}/" title="${esc(e.name)}${e.groupRank?` · group ${esc(e.groupRank)}`:""}">
      <span class="es">${esc(e.symbol)}</span><span class="ers${lead?" hot":""}">${e.rs ?? "—"}</span><span class="ev">${right}</span></a>`;
  };
  const ICON = {
    bmo: `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M12 7a5 5 0 0 1 5 5H7a5 5 0 0 1 5-5Zm-1-5h2v3h-2V2ZM4.2 5.6l1.4-1.4 2.1 2.1-1.4 1.4-2.1-2.1Zm12.1.7 2.1-2.1 1.4 1.4-2.1 2.1-1.4-1.4ZM2 14h20v2H2v-2Zm4 4h12v2H6v-2Z"/></svg>`,
    amc: `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M14.5 2A9 9 0 1 0 22 15.6 7.5 7.5 0 0 1 14.5 2Z"/></svg>`,
    "": `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20Zm0 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm-1 3h2v6h-2V7Zm0 8h2v2h-2v-2Z"/></svg>`};
  const block = (title, list, key, kind) => {
    if(!list.length) return "";
    const LIM = 14, more = list.length - LIM, id = key;
    return `<div class="eblk k-${kind||"na"}"><h5><span>${ICON[kind||""]}${title}</span><small>${list.length}</small></h5>${list.slice(0, LIM).map(item).join("")}${more>0 ? `<div class="emore" id="${id}" hidden>${list.slice(LIM).map(item).join("")}</div><button class="lnk etog" data-t="${id}">+ ${more} more</button>` : ""}</div>`;
  };
  $("#eCal").innerHTML = days.map((d,i)=>{
    const L = evs.filter(e=>e.date===d), dd = new Date(d+"T12:00:00Z");
    const by = t => L.filter(e=>e.time===t);
    const nLead = L.filter(e=>(e.rs||0)>=80).length;
    return `<div class="eday${d===today?" today":""}${d<today?" past":""}"><header>
        <span class="edn">${dd.getUTCDate()}</span>
        <span class="edw"><b>${dd.toLocaleDateString(LOC,{weekday:"long", timeZone:"UTC"})}</b><small>${dd.toLocaleDateString(LOC,{month:"long", timeZone:"UTC"})}${d===today?" · today":""}</small></span>
        <span class="edc">${L.length}<small>${L.length===1?"report":"reports"}${nLead?` · ${nLead} lead`:""}</small></span></header>
      ${L.length ? block("Before open", by("bmo"), `e${i}b`, "bmo") + block("After close", by("amc"), `e${i}a`, "amc") + block("Time not set", by(""), `e${i}n`, "") : `<div class="enone">No reports${earnFilter!=="all"?" in this filter":""}</div>`}</div>`;
  }).join("");
  $$("#eCal .etog").forEach(b=>b.onclick = ()=>{ const m = document.getElementById(b.dataset.t); m.hidden = false; b.remove(); });
}
$$("#eFilter button").forEach(b=>b.onclick = ()=>{ earnFilter = b.dataset.f; store.set("tt:earnF", earnFilter); renderEarn(); });

/* ================= NEWSLETTER SIGN-UP ================= */
// switched on once the API's /subscribe endpoint and the email sender are live
const NEWSLETTER_ON = true;
if(!NEWSLETTER_ON) $$("form[data-nl]").forEach(f=>f.remove());
$$("form[data-nl]").forEach(f=>f.addEventListener("submit", async e=>{
  e.preventDefault();
  const inp = f.querySelector("input"), btn = f.querySelector("button"), email = inp.value.trim();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)){ toast("Enter a valid email address."); inp.focus(); return; }
  btn.disabled = true;
  try{
    const r = await api("/subscribe", {method:"POST", body: JSON.stringify({email})});
    inp.value = "";
    toast(r.already ? "You are already subscribed. See you Friday." : `Almost done: check ${email} and click the confirmation link.`);
  }catch(ex){ toast(ex.message); }
  finally{ btn.disabled = false; }
}));
$$("form[data-nl] input").forEach(i=>i.addEventListener("focus", ()=>{ if(auth.email && !i.value) i.value = auth.email; }));

/* ================= SHARE ON X ================= */
function xShareUrl(sym, extra){
  const text = `$${sym.replace(/=F$/,"")}${extra ? " · " + extra : ""}`;
  return "https://x.com/intent/post?" + new URLSearchParams({text, url: `https://tickerandtape.com${keyToPath(sym)}`, via:"Tickerandtape"}).toString();
}
function setShare(){
  const a = $("#bShare"); if(!a || !S) return;
  const b = S.base, st = S.stats || {}, bits = [];
  if(st.rsRating != null) bits.push(`RS ${st.rsRating}`);
  if(b && b.status && b.type !== "Deep correction") bits.push(`${b.type}, ${b.status.toLowerCase()} (pivot ${fmtP(b.pivot)})`);
  a.href = xShareUrl(S.symbol, bits.join(" · ") + (bits.length ? " — " : "") + "daily chart on Ticker&Tape");
}

/* ================= PORTFOLIO AND TRADE JOURNAL ================= */
// PF = {trades:[{id, s, side:"buy"|"sell", d:"YYYY-MM-DD", q, p, fee, stop, setup, note}], bench:"SPY", hide:false}
// Saved on this device and in the account ("portfolio" in user_data). Positions, P&L and stats are calculated from the trades
// (FIFO lots), with quantities adjusted for stock splits and the latest price (live during the session).
const PF_SETUPS = ["Breakout", "Pullback to 21-day EMA", "Pullback to 50-day line", "Earnings gap", "Base on base", "High tight flag", "Reversal", "Other"];
const PF_BENCH = ["SPY", "QQQ", "IWM", "RSP", "DIA"];
const PF_RANGES = {"3M":63, "6M":126, "YTD":"ytd", "1Y":252, "All":0};
let PF = normPf(store.get("tt:pf")), pfCalc = null, pfTok = 0, pfRange = store.get("tt:pfRange") || "All", pfTab = "pos";
function normPf(o){
  o = o && typeof o === "object" ? o : {};
  const T = Array.isArray(o.trades) ? o.trades.filter(t=>t && /^[A-Z0-9.\-^=]{1,15}$/.test(t.s||"") && (t.side==="buy"||t.side==="sell") && /^\d{4}-\d{2}-\d{2}$/.test(t.d||"") && t.q>0 && t.p>0) : [];
  return {trades: T.map(t=>({id: t.id || Math.random().toString(36).slice(2,10), s:t.s, side:t.side, d:t.d, q:+t.q, p:+t.p, fee:+t.fee||0,
    stop: t.stop>0 ? +t.stop : null, setup: String(t.setup||"").slice(0,40), note: String(t.note||"").slice(0,500), ...(t.est ? {est: true} : {})})),
    bench: PF_BENCH.includes(o.bench) ? o.bench : "SPY", hide: !!o.hide};
}
let pfWarned = false;
function savePf(){
  store.set("tt:pf", PF); pfCalc = null;
  if(!auth.token) return;
  clearTimeout(savePf.t);
  savePf.t = setTimeout(()=>api("/data/portfolio", {method:"PUT", body: JSON.stringify({value: PF})})
    .catch(()=>{ if(!pfWarned){ pfWarned = true; toast(TX("Your portfolio is saved on this device. It will sync to your account shortly.")); } }), 600);
}
const pfMoney = v => PF.hide ? "•••" : v==null || !isFinite(v) ? "—" : (v < 0 ? "−$" : "$") + Math.abs(v).toLocaleString("en-US", {minimumFractionDigits: 2, maximumFractionDigits: 2});
const pfSigned = v => PF.hide ? "•••" : v==null || !isFinite(v) ? "—" : (v > 0 ? "+" : v < 0 ? "−" : "") + "$" + Math.abs(v).toLocaleString("en-US", {minimumFractionDigits: 2, maximumFractionDigits: 2});
const pfQty = q => PF.hide ? "•••" : (+q).toLocaleString("en-US", {maximumFractionDigits: 4});
const cls_ = v => v == null ? "" : v < 0 ? "neg" : v > 0 ? "pos" : "";

// split factor between a trade date and today: a 10-for-1 split after the trade turns 1 share at $500 into 10 at $50
function splitFactor(bundle, d){ let f = 1; for(const [sd, r] of (bundle && bundle.splits) || []) if(sd > d && r > 0) f *= r; return f; }

async function pfCompute(){
  const tok = ++pfTok;
  const syms = [...new Set(PF.trades.map(t=>t.s))], bsym = PF.bench;
  const B = {}; await Promise.all([...syms, bsym].map(async s=>{ B[s] = await getBundle(s); }));
  if(tok !== pfTok) return null;
  const trades = PF.trades.map((t, i)=>({...t, i})).sort((a,b)=> a.d < b.d ? -1 : a.d > b.d ? 1 : (a.side === "buy" ? -1 : 1) - (b.side === "buy" ? -1 : 1) || a.i - b.i)
    .map(t=>{ const f = splitFactor(B[t.s], t.d); return {...t, qa: t.q * f, pa: t.p / f}; });
  // FIFO lots
  const lots = {}, closed = [], realizedBy = {};
  for(const t of trades){
    lots[t.s] = lots[t.s] || [];
    if(t.side === "buy"){ lots[t.s].push({q: t.qa, cost: (t.pa * t.qa + t.fee) / t.qa, d: t.d, setup: t.setup, id: t.id, stop: t.stop}); continue; }
    let left = t.qa; const net = (t.pa * t.qa - t.fee) / t.qa; let pnl = 0, costSum = 0, firstD = null, setup = "", qty = 0;
    while(left > 1e-9 && lots[t.s].length){ const l = lots[t.s][0], take = Math.min(left, l.q);
      pnl += (net - l.cost) * take; costSum += l.cost * take; qty += take; firstD = firstD || l.d; setup = setup || l.setup; l.q -= take; left -= take; if(l.q <= 1e-9) lots[t.s].shift(); }
    if(qty > 0){ closed.push({s: t.s, id: t.id, entry: firstD, exit: t.d, q: qty, pnl, pct: costSum ? pnl / costSum * 100 : 0, setup,
      days: Math.round((iso(t.d) - iso(firstD)) / 864e5)}); realizedBy[t.id] = pnl; }
  }
  // price series per symbol (with today's live bar) and the daily valuation from the first trade
  const px = {}; for(const s of [...syms, bsym]) if(B[s] && B[s].prices) px[s] = cmpPx(B[s], s);
  const first = trades.length ? trades[0].d : null;
  const days = new Set(); for(const s of syms) (px[s] || []).forEach(b=>{ if(first && b.t >= iso(first)) days.add(b.t); });
  (px[bsym] || []).forEach(b=>{ if(first && b.t >= iso(first)) days.add(b.t); });
  const D = [...days].sort((a,b)=>a-b);
  const close = {}; for(const s of Object.keys(px)){ const m = new Map(px[s].map(b=>[b.t, b.c])); close[s] = m; }
  const last = {}, held = {}; let ti = 0, prevV = 0, eq = 1, beq = 1, bprev = null, peak = 1, maxDD = 0;
  const series = [];
  for(const t of D){
    let cf = 0;
    while(ti < trades.length && iso(trades[ti].d) <= t){ const x = trades[ti]; held[x.s] = (held[x.s] || 0) + (x.side === "buy" ? x.qa : -x.qa);
      cf += x.side === "buy" ? x.pa * x.qa + x.fee : -(x.pa * x.qa - x.fee); ti++; }
    let v = 0;
    for(const s of Object.keys(held)){ const c = close[s] && close[s].get(t); if(c != null) last[s] = c; if(held[s] > 1e-9 && last[s] != null) v += held[s] * last[s]; }
    const base = prevV + Math.max(cf, 0);   // money at work today: yesterday's value plus new buys
    const pnl = v - prevV - cf;
    if(base > 0) eq *= 1 + pnl / base;
    const bc = close[bsym] && close[bsym].get(t); if(bc != null){ if(bprev != null) beq *= bc / bprev; bprev = bc; }
    peak = Math.max(peak, eq); maxDD = Math.min(maxDD, eq / peak - 1);
    series.push({t, v, cf, pnl, eq, beq});
    prevV = v;
  }
  // open positions
  const pos = [];
  for(const s of Object.keys(lots)){ const L = lots[s].filter(l=>l.q > 1e-9); if(!L.length) continue;
    const q = L.reduce((a,l)=>a + l.q, 0), cost = L.reduce((a,l)=>a + l.q * l.cost, 0), P = px[s];
    const lastPx = P && P.length ? P[P.length-1].c : null, prevPx = P && P.length > 1 ? P[P.length-2].c : null;
    const stop = [...L].reverse().find(l=>l.stop)?.stop || null;
    pos.push({s, q, avg: cost / q, cost, last: lastPx, value: lastPx != null ? q * lastPx : null, upnl: lastPx != null ? q * lastPx - cost : null,
      upct: lastPx != null ? (lastPx / (cost / q) - 1) * 100 : null, day: lastPx != null && prevPx ? (lastPx / prevPx - 1) * 100 : null,
      dayPnl: lastPx != null && prevPx ? q * (lastPx - prevPx) : null, stop, toStop: stop && lastPx ? (lastPx / stop - 1) * 100 : null, since: L[0].d, missing: !P}); }
  const mv = pos.reduce((a,p)=>a + (p.value || 0), 0);
  pos.forEach(p=>{ p.w = mv && p.value ? p.value / mv * 100 : null; });
  pos.sort((a,b)=>(b.value||0) - (a.value||0));
  return {trades, closed, realizedBy, pos, series, mv, maxDD: maxDD * 100, px};
}
// P&L over a window ending today: dollars and time-weighted %
function pfPeriod(series, fromT){
  const S = series.filter(x=>x.t >= fromT); if(!S.length) return {usd: null, pct: null};
  const i0 = series.indexOf(S[0]), e0 = i0 > 0 ? series[i0-1].eq : 1, e1 = series[series.length-1].eq;
  return {usd: S.reduce((a,x)=>a + x.pnl, 0), pct: (e1 / e0 - 1) * 100};
}
function pfStats(c){
  const W = c.closed.filter(x=>x.pnl > 0), Lo = c.closed.filter(x=>x.pnl <= 0);
  const avg = a => a.length ? a.reduce((s,x)=>s + x.pct, 0) / a.length : null;
  const gw = W.reduce((s,x)=>s + x.pnl, 0), gl = -Lo.reduce((s,x)=>s + x.pnl, 0);
  const bySetup = {}; c.closed.forEach(x=>{ const k = x.setup || TX("No setup"); (bySetup[k] = bySetup[k] || []).push(x); });
  return {n: c.closed.length, win: c.closed.length ? W.length / c.closed.length * 100 : null, avgW: avg(W), avgL: avg(Lo),
    ratio: avg(W) != null && avg(Lo) ? Math.abs(avg(W) / avg(Lo)) : null, pf: gl ? gw / gl : null,
    days: c.closed.length ? c.closed.reduce((s,x)=>s + x.days, 0) / c.closed.length : null,
    best: c.closed.slice().sort((a,b)=>b.pct - a.pct)[0], worst: c.closed.slice().sort((a,b)=>a.pct - b.pct)[0],
    setups: Object.entries(bySetup).map(([k,a])=>({k, n:a.length, win: a.filter(x=>x.pnl > 0).length / a.length * 100, avg: avg(a), pnl: a.reduce((s,x)=>s + x.pnl, 0)})).sort((a,b)=>b.n - a.n)};
}

async function renderPortfolio(){
  $("#pfHide").classList.toggle("on", PF.hide); $("#pfHide").setAttribute("aria-pressed", PF.hide); $("#pfHide").textContent = TX(PF.hide ? "Show amounts" : "Hide amounts");
  $("#pfBench").innerHTML = PF_BENCH.map(b=>`<option value="${b}" ${b===PF.bench?"selected":""}>${b}</option>`).join("");
  $$("#pfTabs button").forEach(b=>b.classList.toggle("on", b.dataset.t === pfTab));
  $$("#pfRange button").forEach(b=>b.classList.toggle("on", b.dataset.r === pfRange));
  if(!PF.trades.length){
    $("#pfKpis").innerHTML = ""; $("#pfChartBox").hidden = true; $("#pfBody").innerHTML = `<div class="pfempty"><h3>${esc(TX("Start your portfolio"))}</h3>
      <p>${esc(TX("Add your trades (date, price and quantity) and Ticker&Tape keeps your positions, P&L, stats and journal up to date, and compares you with the market."))}</p>
      <div class="ctas"><button class="btn on" data-pf="add">＋ ${esc(TX("Add a trade"))}</button><button class="btn" data-pf="quick">${esc(TX("Quick build"))}</button><button class="btn" data-pf="import">${esc(TX("Import a CSV from your broker"))}</button></div>
      <p class="fine">${esc(TX("Your portfolio is private: only you can see it."))}</p></div>`; return; }
  if(!pfCalc){ $("#pfBody").innerHTML = `<div class="empty">${esc(TX("Loading…"))}</div>`; const c = await pfCompute(); if(!c) return; pfCalc = c; }
  const c = pfCalc, S = c.series, nowT = S.length ? S[S.length-1].t : Date.now(), dd = new Date(nowT);
  const yStart = Date.UTC(dd.getUTCFullYear(), 0, 1), mStart = Date.UTC(dd.getUTCFullYear(), dd.getUTCMonth(), 1), qStart = Date.UTC(dd.getUTCFullYear(), Math.floor(dd.getUTCMonth()/3)*3, 1);
  const wStart = nowT - ((dd.getUTCDay() + 6) % 7) * 864e5;
  const P = {day: S.length ? {usd: S[S.length-1].pnl, pct: S.length > 1 && S[S.length-2].eq ? (S[S.length-1].eq / S[S.length-2].eq - 1) * 100 : null} : {}, week: pfPeriod(S, wStart), month: pfPeriod(S, mStart), quarter: pfPeriod(S, qStart), year: pfPeriod(S, yStart), all: pfPeriod(S, 0)};
  const realized = c.closed.reduce((a,x)=>a + x.pnl, 0), unreal = c.pos.reduce((a,p)=>a + (p.upnl || 0), 0);
  const kpi = (l, usd, pct, sub) => `<div class="pfk"><span>${esc(TX(l))}</span><b class="${cls_(usd ?? pct)}">${usd !== undefined ? pfSigned(usd) : ""}</b><small class="${cls_(pct)}">${pct != null ? fmtPct(pct, 2) : ""}${sub ? " " + sub : ""}</small></div>`;
  $("#pfKpis").innerHTML = `<div class="pfk big"><span>${esc(TX("Market value"))}</span><b>${PF.hide ? "•••" : "$" + Math.round(c.mv).toLocaleString("en-US")}</b><small>${c.pos.length} ${esc(TX(c.pos.length === 1 ? "position" : "positions"))}</small></div>`
    + kpi("Today", P.day.usd, P.day.pct) + kpi("This week", P.week.usd, P.week.pct) + kpi("This month", P.month.usd, P.month.pct) + kpi("This quarter", P.quarter.usd, P.quarter.pct)
    + kpi("Year to date", P.year.usd, P.year.pct) + kpi("Realized P&L", realized, null) + kpi("Unrealized P&L", unreal, null);
  $("#pfChartBox").hidden = false; drawPfChart();
  const st = pfStats(c);
  if(pfTab === "pos"){
    $("#pfBody").innerHTML = c.pos.length ? `<div class="tablewrap"><table class="tbl pftbl"><thead><tr><th>${esc(TX("Ticker"))}</th><th>${esc(TX("Qty"))}</th><th>${esc(TX("Avg cost"))}</th><th>${esc(TX("Last"))}</th><th>${esc(TX("Day"))}</th><th>${esc(TX("Value"))}</th><th>${esc(TX("P&L"))}</th><th>%</th><th>${esc(TX("Weight"))}</th><th>${esc(TX("Stop"))}</th><th>${esc(TX("To stop"))}</th><th>RS</th><th>${esc(TX("Setup"))}</th><th></th></tr></thead><tbody>
      ${c.pos.map(p=>{ const r = rowOf(p.s) || {}, b = r.base || {}; const near = p.toStop != null && p.toStop < 3, broke = p.toStop != null && p.toStop < 0;
        return `<tr data-go="${esc(p.s)}" tabindex="0"><td><b>${esc(p.s)}</b>${p.missing ? `<small class="pfmiss" title="${esc(TX("Price loads after the next nightly update"))}"> ⏳</small>` : ""}<br><small>${esc((r.name||"").slice(0,24))}</small></td>
          <td>${pfQty(p.q)}</td><td>${fmtP(p.avg)}</td><td>${fmtP(p.last)}</td><td class="${cls_(p.day)}">${fmtPct(p.day, 2)}</td><td>${pfMoney(p.value)}</td>
          <td class="${cls_(p.upnl)}">${pfSigned(p.upnl)}</td><td class="${cls_(p.upct)}">${fmtPct(p.upct, 1)}</td><td>${p.w != null ? p.w.toFixed(1) + "%" : "—"}</td>
          <td>${p.stop ? fmtP(p.stop) : `<button class="lnk" data-pfstop="${esc(p.s)}">${esc(TX("Set"))}</button>`}</td><td class="${near ? "neg pfwarn" : ""}" title="${esc(TX(broke ? "The price is below your stop" : "Room between the price and your stop"))}">${p.toStop != null ? (broke ? "⚠ " : "") + fmtPct(p.toStop, 1) : "—"}</td>
          <td>${r.rsRating ?? "—"}</td><td>${esc(b.status || "")}</td><td class="pfact"><button class="btn sm" data-pfsell="${esc(p.s)}">${esc(TX("Sell ›"))}</button></td></tr>`; }).join("")}
      </tbody></table></div>` : `<div class="empty">${esc(TX("No open positions. Your closed trades are in the journal."))}</div>`;
  } else if(pfTab === "journal"){
    const T = PF.trades.slice().sort((a,b)=>b.d.localeCompare(a.d));
    $("#pfBody").innerHTML = `<div class="tablewrap"><table class="tbl pftbl"><thead><tr><th>${esc(TX("Date"))}</th><th>${esc(TX("Side"))}</th><th>${esc(TX("Ticker"))}</th><th>${esc(TX("Qty"))}</th><th>${esc(TX("Price"))}</th><th>${esc(TX("Fee"))}</th><th>${esc(TX("Stop"))}</th><th class="l">${esc(TX("Setup"))}</th><th>${esc(TX("Realized"))}</th><th class="l">${esc(TX("Note"))}</th><th></th></tr></thead><tbody>
      ${T.map(t=>`<tr><td>${esc(fmtLong(iso(t.d)))}</td><td><span class="pfside ${t.side}">${esc(TX(t.side === "buy" ? "Buy" : "Sell"))}</span></td><td><b>${esc(t.s)}</b></td><td>${pfQty(t.q)}</td><td>${t.est ? `<small class="pfest" title="${esc(TX("Estimated price: the average of that day"))}">≈</small> ` : ""}${fmtP(t.p)}</td><td>${t.fee ? pfMoney(t.fee) : ""}</td>
        <td>${t.stop ? fmtP(t.stop) : ""}</td><td class="l">${esc(t.setup)}</td><td class="${cls_(c.realizedBy[t.id])}">${c.realizedBy[t.id] != null ? pfSigned(c.realizedBy[t.id]) : ""}</td><td class="pfnote">${esc(t.note)}</td>
        <td class="pfact"><button class="lnk" data-pfedit="${t.id}">${esc(TX("Edit"))}</button></td></tr>`).join("")}</tbody></table></div>`;
  } else {
    const secMap = {}; c.pos.forEach(p=>{ const k = (rowOf(p.s) || {}).sector || TX("Other"); secMap[k] = (secMap[k] || 0) + (p.w || 0); });
    const sec = Object.entries(secMap).sort((a,b)=>b[1]-a[1]);
    const box = (l, v, sub) => `<div class="pfk"><span>${esc(TX(l))}</span><b>${v}</b>${sub ? `<small>${sub}</small>` : ""}</div>`;
    $("#pfBody").innerHTML = `<div class="pfkpis pfstats">${box("Closed trades", st.n)}${box("Win rate", st.win != null ? st.win.toFixed(0) + "%" : "—")}${box("Average gain", fmtPct(st.avgW, 1))}${box("Average loss", fmtPct(st.avgL, 1))}
        ${box("Gain / loss ratio", st.ratio != null ? st.ratio.toFixed(2) : "—")}${box("Profit factor", st.pf != null ? st.pf.toFixed(2) : "—")}${box("Average days held", st.days != null ? st.days.toFixed(0) : "—")}${box("Max drawdown", fmtPct(c.maxDD, 1))}
        ${box("Best trade", st.best ? `${esc(st.best.s)} ${fmtPct(st.best.pct, 1)}` : "—")}${box("Worst trade", st.worst ? `${esc(st.worst.s)} ${fmtPct(st.worst.pct, 1)}` : "—")}</div>
      <div class="pfcols"><div class="box"><h3>${esc(TX("Results by setup"))}</h3><div class="tablewrap"><table class="tbl"><thead><tr><th class="l">${esc(TX("Setup"))}</th><th>${esc(TX("Trades"))}</th><th>${esc(TX("Win rate"))}</th><th>${esc(TX("Average"))}</th><th>${esc(TX("P&L"))}</th></tr></thead><tbody>
        ${st.setups.map(x=>`<tr><td class="l">${esc(x.k)}</td><td>${x.n}</td><td>${x.win.toFixed(0)}%</td><td class="${cls_(x.avg)}">${fmtPct(x.avg, 1)}</td><td class="${cls_(x.pnl)}">${pfSigned(x.pnl)}</td></tr>`).join("") || `<tr><td colspan="5">${esc(TX("Close a trade to see results by setup."))}</td></tr>`}</tbody></table></div></div>
      <div class="box"><h3>${esc(TX("Exposure by sector"))}</h3><div class="in">${sec.map(([k,w])=>`<div class="pfbar"><span>${esc(TX(k))}</span><i style="width:${Math.max(2, w).toFixed(1)}%"></i><b>${w.toFixed(1)}%</b></div>`).join("") || esc(TX("No open positions."))}</div></div></div>
      <h3 class="mch">${esc(TX("Closed trades"))}</h3><div class="tablewrap"><table class="tbl pftbl"><thead><tr><th>${esc(TX("Ticker"))}</th><th>${esc(TX("Entry"))}</th><th>${esc(TX("Exit"))}</th><th>${esc(TX("Days"))}</th><th>${esc(TX("Qty"))}</th><th>${esc(TX("P&L"))}</th><th>%</th><th>${esc(TX("Setup"))}</th></tr></thead><tbody>
        ${c.closed.slice().reverse().map(x=>`<tr><td><b>${esc(x.s)}</b></td><td>${esc(fmtLong(iso(x.entry)))}</td><td>${esc(fmtLong(iso(x.exit)))}</td><td>${x.days}</td><td>${pfQty(x.q)}</td><td class="${cls_(x.pnl)}">${pfSigned(x.pnl)}</td><td class="${cls_(x.pct)}">${fmtPct(x.pct, 1)}</td><td>${esc(x.setup)}</td></tr>`).join("") || `<tr><td colspan="8">${esc(TX("No closed trades yet."))}</td></tr>`}</tbody></table></div>`;
  }
}
// portfolio vs benchmark, time-weighted, from the start of the range
function drawPfChart(){
  const cv = $("#pfcv"); if(!cv || !pfCalc) return; const W = cv.clientWidth; if(!W) return;
  const H = W < 600 ? 220 : 280, dpr = devicePixelRatio || 1; cv.style.height = H + "px"; cv.width = W * dpr; cv.height = H * dpr;
  const g = cv.getContext("2d"); g.setTransform(dpr,0,0,dpr,0,0); g.fillStyle = C.plate; g.fillRect(0,0,W,H);
  let S = pfCalc.series; if(!S.length) return;
  const r = PF_RANGES[pfRange], lastT = S[S.length-1].t;
  if(r === "ytd"){ const y0 = Date.UTC(new Date(lastT).getUTCFullYear(), 0, 1); S = S.filter(x=>x.t >= y0); } else if(r) S = S.slice(-r);
  if(S.length < 2){ g.fillStyle = C.ink2; g.font = `14px ${FONT_L}`; g.fillText(TX("The chart appears after your first full day."), 14, 24); return; }
  const e0 = S[0].eq, b0 = S[0].beq, a = S.map(x=>(x.eq / e0 - 1) * 100), b = S.map(x=>(x.beq / b0 - 1) * 100);
  const L = 6, R = 62, T = 26, B = 22, pw = W - L - R, ph = H - T - B;
  let lo = Math.min(0, ...a, ...b), hi = Math.max(0, ...a, ...b); const pad = (hi - lo) * .08 || 1; lo -= pad; hi += pad;
  const x = i => L + i / (S.length - 1) * pw, y = v => T + (hi - v) / (hi - lo) * ph;
  g.strokeStyle = C.grid; g.setLineDash([1,3]); g.font = `11px ${FONT_D}`; g.fillStyle = C.ink2; g.textBaseline = "middle"; g.textAlign = "left";
  for(const v of linTicks(lo, hi, ph)){ g.beginPath(); g.moveTo(L, y(v)); g.lineTo(L + pw, y(v)); g.stroke(); g.fillText((v > 0 ? "+" : "") + v.toFixed(Math.abs(hi - lo) < 6 ? 1 : 0) + "%", L + pw + 5, y(v)); }
  g.setLineDash([]); g.strokeStyle = C.ink2; g.beginPath(); g.moveTo(L, y(0)); g.lineTo(L + pw, y(0)); g.stroke();
  let lm = -1; g.textAlign = "center"; g.textBaseline = "alphabetic";
  let lx = -99; S.forEach((s, i)=>{ const d = new Date(s.t), m = d.getUTCMonth(); if(m !== lm && i && x(i) - lx > 40){ g.fillStyle = C.ink2; g.fillText(m === 0 ? String(d.getUTCFullYear()) : MON[m], x(i), H - 6); lx = x(i); } lm = m; });
  const line = (arr, col, w) => { g.strokeStyle = col; g.lineWidth = w; g.beginPath(); arr.forEach((v,i)=> i ? g.lineTo(x(i), y(v)) : g.moveTo(x(i), y(v))); g.stroke(); };
  line(b, "#8a8f9c", 1.4); line(a, C.navy, 2);
  g.font = `700 12px ${FONT_L}`; g.textAlign = "left"; g.textBaseline = "top";
  g.fillStyle = C.navy; g.fillText(`${TX("My portfolio")} ${fmtPct(a[a.length-1], 1)}`, L + 4, 6);
  const t1 = `${TX("My portfolio")} ${fmtPct(a[a.length-1], 1)}`; g.fillStyle = "#6b6f7a"; g.fillText(`${PF.bench} ${fmtPct(b[b.length-1], 1)}`, L + 18 + g.measureText(t1).width, 6);
  g.lineWidth = 1;
}

// the prices of a day (or of the next session when the market was closed), as they were that day: before any later split
async function pfDayPx(sym, d){
  const b = await getBundle(sym); if(!b || !b.prices || !b.prices.length) return null;
  const P = b.prices; if(P[0][0] > d) return null;
  const i = P.findIndex(x=>x[0] >= d);
  if(i < 0){ const q = LIVE && LIVE.q && LIVE.q[sym]; if(q && LIVE.date >= d) return {d: LIVE.date, o:q[0], h:q[1], l:q[2], c:q[3], avg:(q[1]+q[2]+q[3])/3, shifted: LIVE.date !== d}; return null; }
  const [bd, o, h, l, c] = P[i], f = splitFactor(b, bd);
  return {d: bd, o: o*f, h: h*f, l: l*f, c: c*f, avg: (h + l + c) / 3 * f, shifted: bd !== d};
}
// shares for an amount: whole shares, or a fraction when the amount buys less than one
const pfShares = (amt, px) => { const q = amt / px; return q >= 1 ? Math.floor(q) : +q.toFixed(4); };
// "NVDA", "AAPL 2026-03-15", "MSFT, 15/01/2026, 25000", "AMZN 10k"
function pfQuickParse(txt, defD, defA){
  const dayFirst = I18N.lang !== "en";
  const date = v => { let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/); if(m) return `${m[1]}-${m[2].padStart(2,"0")}-${m[3].padStart(2,"0")}`;
    m = v.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2}|\d{4})$/); if(!m) return null;
    let [a, b2, y] = [+m[1], +m[2], m[3].length === 2 ? 2000 + +m[3] : +m[3]]; let dd = dayFirst ? a : b2, mm = dayFirst ? b2 : a; if(mm > 12 && dd <= 12) [dd, mm] = [mm, dd];
    if(mm < 1 || mm > 12 || dd < 1 || dd > 31) return null; return `${y}-${String(mm).padStart(2,"0")}-${String(dd).padStart(2,"0")}`; };
  const amount = v => { v = v.toLowerCase().replace(/usd|u\$s|\$/g, ""); const k = /k$/.test(v) ? 1000 : /m$/.test(v) ? 1e6 : 1; v = v.replace(/[km]$/, "");
    if(/^\d{1,3}([.,]\d{3})+$/.test(v)) v = v.replace(/[.,]/g, ""); else v = v.replace(",", "."); const n = parseFloat(v); return isFinite(n) && n > 0 && /^[\d.]+$/.test(v) ? n * k : null; };
  const out = [];
  for(const line of txt.split(/\n/)){ const toks = line.split(/[,;\t ]+/).map(x=>x.trim()).filter(Boolean); if(!toks.length) continue;
    const s = toks[0].toUpperCase().replace(/\./g, "-"); let d = null, a = null, bad = !/^[A-Z0-9\-^=]{1,15}$/.test(s);
    for(const x of toks.slice(1)){ const dt = date(x); if(dt && !d){ d = dt; continue; } const am = amount(x); if(am && !a){ a = am; continue; } bad = true; }
    out.push({s, d: d || defD, a: a || defA, bad}); }
  return out;
}
function pfQuickDlg(){
  dlg(TX("Quick build"), `<p class="msub">${esc(TX("One line per position: the ticker and, if you want, the purchase date and the amount invested. Ticker&Tape uses the average price of that day, so you can build your portfolio in a minute."))}</p>
    <div class="pfform"><label class="fld"><span>${esc(TX("Purchase date"))}</span><input id="qD" type="date" value="${esc(nyToday())}" max="${esc(nyToday())}"></label>
      <label class="fld"><span>${esc(TX("Amount per position (USD)"))}</span><input id="qA" type="number" min="0" step="any" value="10000"></label>
      <label class="fld pfwide"><span>${esc(TX("Positions"))}</span><textarea id="qT" rows="6" spellcheck="false" placeholder="NVDA&#10;AAPL 2026-03-15&#10;MSFT, 2026-01-10, 25000"></textarea></label></div>
    <div class="pfqprev" id="qPrev"></div>
    <button class="btn on wide" id="qOk" disabled>${esc(TX("Add trades"))}</button>`, B=>{
    let rows = [], tok = 0;
    const run = async () => { const my = ++tok, defD = B.querySelector("#qD").value, defA = +B.querySelector("#qA").value || null;
      const L = pfQuickParse(B.querySelector("#qT").value, defD, defA);
      const R = await Promise.all(L.map(async r=>{ if(r.bad || !r.a || !r.d || r.d > nyToday()) return {...r, err: r.bad ? "Could not read this line" : !r.a ? "Missing the amount" : "Invalid date"};
        const b = await pfDayPx(r.s, r.d); if(!b) return {...r, err: "No price for this ticker and date"};
        return {...r, bar: b, q: pfShares(r.a, b.avg)}; }));
      if(my !== tok) return; rows = R.filter(r=>r.bar);
      B.querySelector("#qPrev").innerHTML = R.length ? `<div class="tablewrap"><table class="tbl pftbl"><thead><tr><th>${esc(TX("Ticker"))}</th><th>${esc(TX("Date"))}</th><th>${esc(TX("Day average"))}</th><th>${esc(TX("Shares"))}</th><th>${esc(TX("Amount"))}</th></tr></thead><tbody>
        ${R.map(r=>r.bar ? `<tr><td><b>${esc(r.s)}</b></td><td>${esc(fmtLong(iso(r.bar.d)))}</td><td>${fmtP(r.bar.avg)}</td><td>${r.q.toLocaleString("en-US")}</td><td>$${Math.round(r.q * r.bar.avg).toLocaleString("en-US")}</td></tr>`
          : `<tr class="pfqbad"><td><b>${esc(r.s)}</b></td><td colspan="4" class="l">${esc(TX(r.err))}</td></tr>`).join("")}</tbody></table></div>` : "";
      const ok = B.querySelector("#qOk"); ok.disabled = !rows.length; ok.textContent = rows.length ? `${TX("Add trades")} (${rows.length})` : TX("Add trades"); };
    let t0; const later = () => { clearTimeout(t0); t0 = setTimeout(run, 350); };
    ["#qT","#qD","#qA"].forEach(id=>B.querySelector(id).addEventListener("input", later));
    B.querySelector("#qOk").onclick = ()=>{ if(!rows.length) return;
      PF.trades = [...PF.trades, ...rows.map(r=>({id: Math.random().toString(36).slice(2,10), s: r.s, side: "buy", d: r.bar.d, q: r.q, p: +r.bar.avg.toFixed(2), fee: 0, stop: null, setup: "", note: "", est: true}))];
      PF = normPf(PF); savePf(); closeDlg(); toast(`${rows.length} ${TX("trades added.")}`); renderPortfolio(); };
    setTimeout(()=>B.querySelector("#qT").focus(), 50);
  });
}

// add, edit, sell, stop
function pfTradeDlg(init){
  const t = {side:"buy", d: nyToday(), q:"", p:"", fee:"", stop:"", setup:"", note:"", s:"", ...(init||{})}, editing = !!(init && init.id);
  dlg(TX(editing ? "Edit trade" : "Add a trade"), `
    <div class="seg aseg"><button data-side="buy" class="${t.side==="buy"?"on":""}">${esc(TX("Buy"))}</button><button data-side="sell" class="${t.side==="sell"?"on":""}">${esc(TX("Sell"))}</button></div>
    <div class="pfform">
      <label class="fld"><span>${esc(TX("Ticker"))}</span><input id="tS" value="${esc(t.s)}" maxlength="15" spellcheck="false" autocomplete="off" list="symlist" style="text-transform:uppercase"></label>
      <label class="fld"><span>${esc(TX("Date"))}</span><input id="tD" type="date" value="${esc(t.d)}" max="${esc(nyToday())}"></label>
      <div class="pfpx pfwide" id="tPx" hidden></div>
      <label class="fld"><span>${esc(TX("Price"))}</span><input id="tP" type="number" min="0" step="any" value="${esc(t.p)}"></label>
      <label class="fld"><span>${esc(TX("Amount invested (optional)"))}</span><input id="tA" type="number" min="0" step="any" placeholder="${esc(TX("USD, calculates the shares"))}"></label>
      <label class="fld"><span>${esc(TX("Quantity"))}</span><input id="tQ" type="number" min="0" step="any" value="${esc(t.q)}"></label>
      <label class="fld"><span>${esc(TX("Fees (optional)"))}</span><input id="tF" type="number" min="0" step="any" value="${esc(t.fee || "")}"></label>
      <label class="fld"><span>${esc(TX("Stop (optional)"))}</span><input id="tStop" type="number" min="0" step="any" value="${esc(t.stop || "")}" placeholder="${esc(TX("7–8% below your price"))}"></label>
      <label class="fld"><span>${esc(TX("Setup"))}</span><input id="tSet" value="${esc(t.setup)}" list="pfSetups" maxlength="40"><datalist id="pfSetups">${PF_SETUPS.map(x=>`<option value="${esc(x)}">`).join("")}</datalist></label>
      <label class="fld pfwide"><span>${esc(TX("Note (optional)"))}</span><input id="tN" value="${esc(t.note)}" maxlength="500" placeholder="${esc(TX("Why you took it, what you expect, what you learned"))}"></label>
    </div>
    <label class="chk" id="tAlertRow"><input type="checkbox" id="tAlert" ${auth.token ? "checked" : "disabled"}> ${esc(TX("Alert me if the price falls to my stop"))}</label>
    <button class="btn on wide" id="tOk">${esc(TX(editing ? "Save" : "Add trade"))}</button>
    ${editing ? `<button class="lnk pfdel" id="tDel">${esc(TX("Delete this trade"))}</button>` : ""}`, B=>{
    let side = t.side;
    const sync = () => { B.querySelectorAll("[data-side]").forEach(b=>b.classList.toggle("on", b.dataset.side === side)); B.querySelector("#tAlertRow").hidden = side !== "buy"; };
    B.querySelectorAll("[data-side]").forEach(b=>b.onclick = ()=>{ side = b.dataset.side; sync(); }); sync();
    const $b = q => B.querySelector(q), sP = $b("#tP"), sA = $b("#tA"), sQ = $b("#tQ");
    let est = !!t.est, pxTok = 0;
    const autoStop = () => { const st = $b("#tStop"); if(side === "buy" && !st.value && +sP.value > 0) st.value = (+sP.value * 0.92).toFixed(2); };
    const fromAmount = () => { const a = +sA.value, pr = +sP.value; if(a > 0 && pr > 0) sQ.value = pfShares(a, pr); };
    const setPx = (v, isEst) => { sP.value = (+v).toFixed(2); est = isEst; fromAmount(); autoStop(); paint(); };
    let bar = null;
    const paint = () => { const box = $b("#tPx"); if(!bar){ box.hidden = true; return; } box.hidden = false;
      const chip = (k, l, v) => `<button type="button" class="pfchip ${est && Math.abs(+sP.value - v) < 0.005 ? "on" : ""}" data-px="${v}">${esc(TX(l))} <b>${fmtP(v)}</b></button>`;
      box.innerHTML = `<span class="pfpxh">${esc(TX("Don't remember the price?"))}${bar.shifted ? ` <small>${esc(TX("Market closed that day: prices of"))} ${esc(fmtLong(iso(bar.d)))}</small>` : ""}</span>
        ${chip("avg", "Day average", bar.avg)}${chip("o", "At the open", bar.o)}${chip("c", "At the close", bar.c)}<span class="pfrng">${esc(TX("Day range"))} ${fmtP(bar.l)} – ${fmtP(bar.h)}</span>`;
      box.querySelectorAll("[data-px]").forEach(x=>x.onclick = ()=> setPx(+x.dataset.px, true)); };
    const lookUp = async () => { const sym = $b("#tS").value.trim().toUpperCase().replace(/\./g, "-"), d = $b("#tD").value, tok = ++pxTok;
      if(!/^[A-Z0-9\-^=]{1,15}$/.test(sym) || !/^\d{4}-\d{2}-\d{2}$/.test(d)){ bar = null; paint(); return; }
      const r = await pfDayPx(sym, d); if(tok !== pxTok) return; bar = r; 
      if(bar && (!(+sP.value > 0) || est)) setPx(bar.avg, true); else paint();
      if(!bar){ const box = $b("#tPx"); box.hidden = false; box.innerHTML = `<span class="pfpxh"><small>${esc(TX("No price for this ticker and date yet: enter it by hand."))}</small></span>`; } };
    $b("#tS").addEventListener("change", lookUp); $b("#tD").addEventListener("change", lookUp);
    sP.addEventListener("input", ()=>{ est = false; fromAmount(); paint(); }); sP.addEventListener("change", autoStop);
    sA.addEventListener("input", fromAmount);
    if(t.s && t.d) lookUp();
    B.querySelector("#tOk").onclick = async ()=>{
      const s = B.querySelector("#tS").value.trim().toUpperCase().replace(/\./g, "-"), d = B.querySelector("#tD").value, q = +B.querySelector("#tQ").value, p = +B.querySelector("#tP").value;
      if(!/^[A-Z0-9\-^=]{1,15}$/.test(s)){ toast(TX("Enter a valid ticker.")); return; }
      if(!/^\d{4}-\d{2}-\d{2}$/.test(d) || d > nyToday()){ toast(TX("Enter a valid date.")); return; }
      if(!(q > 0) || !(p > 0)){ toast(TX("Enter the quantity and the price.")); return; }
      const rec = {id: t.id || Math.random().toString(36).slice(2,10), s, side, d, q, p, fee: +B.querySelector("#tF").value || 0, stop: +B.querySelector("#tStop").value || null,
        setup: B.querySelector("#tSet").value.trim(), note: B.querySelector("#tN").value.trim(), ...(est ? {est: true} : {})};
      if(side === "sell" && !editing){ const held = PF.trades.filter(x=>x.s === s && x.d <= d).reduce((a,x)=>a + (x.side === "buy" ? x.q : -x.q), 0);
        if(q > held + 1e-9){ toast(`${TX("You only hold")} ${held} ${s}.`); return; } }
      PF.trades = editing ? PF.trades.map(x=>x.id === rec.id ? rec : x) : [...PF.trades, rec];
      PF = normPf(PF); savePf(); closeDlg(); renderPortfolio();
      if(side === "buy" && rec.stop && B.querySelector("#tAlert") && B.querySelector("#tAlert").checked && auth.token){
        try{ await api("/alerts", {method:"POST", body: JSON.stringify({symbol: s, kind:"price", level: rec.stop, dir:"below", note: TX("Stop on my position"), email: true})}); loadAlerts(); toast(`${TX("Trade saved and stop alert set at")} ${fmtP(rec.stop)}.`); }
        catch(e){ toast(TX("Trade saved.")); }
      } else toast(TX("Trade saved."));
    };
    const del = B.querySelector("#tDel"); if(del) del.onclick = ()=>{ if(!confirm(TX("Delete this trade?"))) return; PF.trades = PF.trades.filter(x=>x.id !== t.id); savePf(); closeDlg(); renderPortfolio(); };
  });
}
// CSV: Date, Symbol, Side, Quantity, Price, Fees (column names in English or Spanish; a negative quantity is a sale)
function pfParseCsv(txt){
  const lines = txt.replace(/\r/g, "").split("\n").filter(l=>l.trim()); if(lines.length < 2) return [];
  const sep = [",", ";", "\t"].sort((a,b)=>lines[0].split(b).length - lines[0].split(a).length)[0];
  const split = l => { const out = []; let cur = "", q = false; for(const ch of l){ if(ch === '"') q = !q; else if(ch === sep && !q){ out.push(cur); cur = ""; } else cur += ch; } out.push(cur); return out.map(x=>x.trim()); };
  const H = split(lines[0]).map(h=>h.toLowerCase());
  const col = re => H.findIndex(h=>re.test(h));
  const ci = {d: col(/date|fecha|trade date/), s: col(/symbol|ticker|s[ií]mbolo|especie/), side: col(/side|action|type|operaci|tipo/), q: col(/quantity|qty|shares|cantidad|nominales/), p: col(/price|precio/), fee: col(/fee|commission|comisi/)};
  if(ci.d < 0 || ci.s < 0 || ci.q < 0 || ci.p < 0) return null;
  const num = v => +String(v || "").replace(/[$\s]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  const date = v => { v = String(v || "").trim(); let m;
    if((m = v.match(/^(\d{4})-(\d{2})-(\d{2})/))) return `${m[1]}-${m[2]}-${m[3]}`;
    if((m = v.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/))){ let [, a, b, y] = m; y = y.length === 2 ? "20" + y : y; const us = +a <= 12 && +b > 12 ? true : !(+a > 12);
      const mo = us ? a : b, da = us ? b : a; return `${y}-${String(mo).padStart(2,"0")}-${String(da).padStart(2,"0")}`; }
    const t = Date.parse(v); return isFinite(t) ? new Date(t).toISOString().slice(0,10) : null; };
  const out = [];
  for(const l of lines.slice(1)){ const c = split(l), q = num(c[ci.q]), p = num(c[ci.p]), d = date(c[ci.d]), s = String(c[ci.s] || "").toUpperCase().replace(/\./g, "-").trim();
    let side = ci.side >= 0 ? String(c[ci.side]).toLowerCase() : ""; side = /sell|venta|vend/.test(side) || q < 0 ? "sell" : "buy";
    if(d && s && Math.abs(q) > 0 && p > 0) out.push({s, side, d, q: Math.abs(q), p, fee: ci.fee >= 0 ? Math.abs(num(c[ci.fee])) || 0 : 0}); }
  return out;
}
function pfImport(){
  dlg(TX("Import trades"), `<p class="msub">${esc(TX("Upload the CSV your broker exports with your trades. It needs columns for date, ticker, quantity and price; side (buy or sell) and fees are optional, and a negative quantity counts as a sale."))}</p>
    <label class="fld"><span>${esc(TX("CSV file"))}</span><input type="file" id="pfFile" accept=".csv,text/csv,.txt"></label><p class="msub" id="pfPrev"></p>
    <button class="btn on wide" id="pfImp" disabled>${esc(TX("Import"))}</button>`, B=>{
    let rows = [];
    B.querySelector("#pfFile").onchange = async e => { const f = e.target.files[0]; if(!f) return; const r = pfParseCsv(await f.text());
      if(r === null){ B.querySelector("#pfPrev").textContent = TX("We could not find the date, ticker, quantity and price columns in this file."); return; }
      rows = r; B.querySelector("#pfPrev").textContent = `${rows.length} ${TX("trades found")}${rows.length ? ": " + rows.slice(0,3).map(x=>`${x.d} ${x.side} ${x.q} ${x.s} @ ${x.p}`).join(" · ") + (rows.length > 3 ? " …" : "") : ""}`;
      B.querySelector("#pfImp").disabled = !rows.length; };
    B.querySelector("#pfImp").onclick = ()=>{ PF.trades = [...PF.trades, ...rows.map(x=>({...x, id: Math.random().toString(36).slice(2,10)}))]; PF = normPf(PF); savePf(); closeDlg(); toast(`${rows.length} ${TX("trades imported.")}`); renderPortfolio(); };
  });
}
function pfExport(){
  const rows = [["Date","Symbol","Side","Quantity","Price","Fees","Stop","Setup","Note"], ...PF.trades.slice().sort((a,b)=>a.d.localeCompare(b.d)).map(t=>[t.d, t.s, t.side, t.q, t.p, t.fee || 0, t.stop || "", t.setup, t.note])];
  const csv = rows.map(r=>r.map(v=>/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v).join(",")).join("\n");
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], {type:"text/csv"})); a.download = `tickerandtape-trades-${nyToday()}.csv`; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href), 2000);
}
$("#vPortfolio").addEventListener("click", e=>{
  const b = e.target.closest("button,[data-go]"); if(!b) return; const d = b.dataset;
  if(d.pf === "add" || b.id === "pfAdd") pfTradeDlg();
  else if(d.pf === "import" || b.id === "pfImport") pfImport();
  else if(d.pf === "quick" || b.id === "pfQuick") pfQuickDlg();
  else if(b.id === "pfExport") pfExport();
  else if(b.id === "pfHide"){ PF.hide = !PF.hide; savePf(); renderPortfolio(); }
  else if(d.t){ pfTab = d.t; renderPortfolio(); }
  else if(d.r){ pfRange = d.r; store.set("tt:pfRange", pfRange); $$("#pfRange button").forEach(x=>x.classList.toggle("on", x.dataset.r === pfRange)); drawPfChart(); }
  else if(d.pfsell){ e.stopPropagation(); const p = pfCalc && pfCalc.pos.find(x=>x.s === d.pfsell); pfTradeDlg({side:"sell", s: d.pfsell, q: p ? +p.q.toFixed(4) : "", p: p && p.last ? +p.last.toFixed(2) : ""}); }
  else if(d.pfstop){ e.stopPropagation(); const buys = PF.trades.filter(x=>x.s === d.pfstop && x.side === "buy"); const lastBuy = buys[buys.length-1]; if(lastBuy) pfTradeDlg({...lastBuy}); }
  else if(d.pfedit){ const t = PF.trades.find(x=>x.id === d.pfedit); if(t) pfTradeDlg({...t}); }
  else if(d.go){ go(d.go); }
});
$("#pfBench").onchange = e => { PF.bench = e.target.value; savePf(); renderPortfolio(); };
addEventListener("resize", ()=>{ if(!$("#vPortfolio").hidden) drawPfChart(); });

/* ================= MACRO CALENDAR ================= */
// data/macro.json, written every night by scripts/macro.py: official release dates, FRED values and the Fed odds
let MAC = null, macLoading = null, macWeek = 0, macImp = +store.get("tt:macImp") || 1;
function loadMacro(){ if(!macLoading) macLoading = getJSON("macro.json").then(d=>{ MAC = d; }).catch(()=>{ MAC = {events:[], indicators:{}}; }); return macLoading; }
const nyToday = () => new Intl.DateTimeFormat("en-CA", {timeZone:"America/New_York"}).format(new Date());
const nyClock = () => new Intl.DateTimeFormat("en-GB", {timeZone:"America/New_York", hour:"2-digit", minute:"2-digit", hour12:false}).format(new Date());
const addDays = (iso_, n) => { const d = new Date(iso_ + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0,10); };
const fmtT12 = t => { const [h,m] = t.split(":").map(Number); return `${((h+11)%12)+1}:${String(m).padStart(2,"0")} ${h<12?"a.m.":"p.m."}`; };
function macVal(v, x){ if(x == null || !isFinite(x)) return "—"; const u = v.unit;
  return u === "%" ? (v.name.includes("change") && x > 0 ? "+" : "") + x.toFixed(1) + "%" : u === "k" ? (v.name.includes("change") && x > 0 ? "+" : "") + Math.round(x) + "k" : u === "M" ? x.toFixed(2) + "M" : x.toFixed(2); }
function macSpark(arr, w=120, h=30){ const a = (arr||[]).filter(v=>v!=null); if(a.length < 2) return ""; const lo = Math.min(...a), hi = Math.max(...a), r = (hi-lo)||1;
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><polyline fill="none" stroke="#1f3c6e" stroke-width="1.5" points="${a.map((v,i)=>`${(i*(w-2)/(a.length-1)+1).toFixed(1)},${(h-2-(v-lo)/r*(h-4)).toFixed(1)}`).join(" ")}"/></svg>`; }
function renderMacro(){
  if(!MAC){ $("#mcCal").innerHTML = `<div class="empty">${esc(TX("Loading…"))}</div>`; loadMacro().then(()=>{ if(!$("#vMacro").hidden) renderMacro(); }); return; }
  const today = nyToday(), now = nyClock();
  $$("#mcWeek button").forEach(b=>b.classList.toggle("on", +b.dataset.w === macWeek));
  $$("#mcImp button").forEach(b=>b.classList.toggle("on", +b.dataset.i === macImp));
  const F = MAC.fed, fomc = (MAC.fomc || []).filter(d=>d >= today);
  // next FOMC
  const nf = fomc[0];
  $("#mcNext").innerHTML = nf ? `<div class="rsn"><span>${esc(TX("Next FOMC decision"))}</span><b>${esc(fmtLong(iso(nf)))} · 2:00 p.m. ET</b></div>
    <div class="rsn"><span>${esc(TX("Countdown"))}</span><b>${Math.round((Date.parse(nf) - Date.parse(today)) / 864e5)} ${esc(TX("days"))}</b></div>` : "";
  // the Fed card
  if(F && F.meetings && F.meetings.length){
    const m0 = F.meetings[0], mv = Object.entries(m0.move || {}).map(([k,p])=>({bp:+k, p})).sort((a,b)=>a.bp-b.bp);
    const lbl = bp => bp < 0 ? `${TX("Cut")} ${-bp} bp` : bp > 0 ? `${TX("Hike")} ${bp} bp` : TX("Hold");
    const col = bp => bp < 0 ? "var(--green)" : bp > 0 ? "var(--down)" : "var(--navy)";
    const top = mv.slice().sort((a,b)=>b.p-a.p)[0];
    const wk = m0.cumWeekAgo != null ? `<p class="fine">${esc(TX("A week ago the market priced"))} ${m0.cumWeekAgo > 0 ? "+" : ""}${m0.cumWeekAgo.toFixed(0)} bp ${esc(TX("by this meeting; today"))} ${m0.cum > 0 ? "+" : ""}${m0.cum.toFixed(0)} bp.</p>` : "";
    $("#mcFed").innerHTML = `<div class="box mcfedl"><h3>${esc(TX("The Fed today"))}</h3><div class="in">
        <div class="mcrate"><span>${esc(TX("Target range"))}</span><b>${F.lower.toFixed(2)}% – ${F.upper.toFixed(2)}%</b><small>${esc(TX("Effective fed funds rate"))} ${F.effr.toFixed(2)}%</small></div>
        <h4>${esc(TX("Odds for the"))} ${esc(fmtLong(iso(m0.date)))} ${esc(TX("meeting"))}</h4>
        <div class="mcbar">${mv.map(x=>`<span style="flex:${x.p};background:${col(x.bp)}" title="${esc(lbl(x.bp))} ${x.p.toFixed(0)}%">${x.p >= 12 ? `${esc(lbl(x.bp))} ${x.p.toFixed(0)}%` : ""}</span>`).join("")}</div>
        <p class="mcsay">${esc(TX("The futures market sees a"))} <b>${top.p.toFixed(0)}%</b> ${esc(TX("chance of"))} <b>${esc(lbl(top.bp).toLowerCase())}</b>.</p>${wk}</div></div>
      <div class="box mcfedr"><h3>${esc(TX("Rate path by meeting"))} <small>${esc(TX("implied by fed funds futures"))}</small></h3><div class="tablewrap"><table class="tbl mctbl"><thead><tr><th>${esc(TX("Meeting"))}</th><th>${esc(TX("Implied rate"))}</th><th>${esc(TX("vs today"))}</th><th>${esc(TX("Most likely range"))}</th><th>${esc(TX("Odds"))}</th></tr></thead><tbody>
        ${F.meetings.map(m=>{ const r = (m.ranges||[]).slice().sort((a,b)=>b.prob-a.prob); const best = r[0];
          return `<tr><td><b>${esc(fmtLong(iso(m.date)))}</b>${(MAC.sep||[]).includes(m.date) ? ` <small class="mcsep" title="${esc(TX("With economic projections and the dot plot"))}">SEP</small>` : ""}</td><td>${m.implied.toFixed(2)}%</td>
            <td class="${m.cum < 0 ? "pos" : m.cum > 0 ? "neg" : ""}">${m.cum > 0 ? "+" : ""}${m.cum.toFixed(0)} bp</td><td>${best ? `${best.lower.toFixed(2)}–${best.upper.toFixed(2)}%` : "—"}</td>
            <td><div class="mcmini">${r.slice().sort((a,b)=>a.lower-b.lower).map(x=>`<i style="flex:${x.prob};background:${x.lower < F.lower ? "var(--green)" : x.lower > F.lower ? "var(--down)" : "var(--navy)"}" title="${x.lower.toFixed(2)}–${x.upper.toFixed(2)}%: ${x.prob.toFixed(0)}%"></i>`).join("")}</div><small>${best ? best.prob.toFixed(0) + "%" : ""}</small></td></tr>`; }).join("")}
        </tbody></table></div></div>`;
  } else $("#mcFed").innerHTML = "";
  // calendar
  const dow = new Date(today + "T12:00:00Z").getUTCDay(), mon = addDays(today, -((dow + 6) % 7));
  const from = macWeek === 0 ? mon : macWeek === 1 ? addDays(mon, 7) : addDays(mon, 14), to = macWeek === 2 ? addDays(mon, 60) : addDays(from, 6);
  const E = (MAC.events || []).filter(e=>e.date >= from && e.date <= to && e.imp >= macImp);
  const byDay = {}; E.forEach(e=>(byDay[e.date] = byDay[e.date] || []).push(e));
  const done = e => e.date < today || (e.date === today && e.time <= now);
  $("#mcCal").innerHTML = Object.keys(byDay).sort().map(d=>`<div class="mcday ${d === today ? "today" : ""}"><h4>${esc(new Date(d + "T12:00:00Z").toLocaleDateString(LOC, {weekday:"long", month:"long", day:"numeric", timeZone:"UTC"}))}${d === today ? ` <span>${esc(TX("Today"))}</span>` : ""}</h4>
      ${byDay[d].map(e=>{ const vals = e.values || [];
        return `<div class="mcev imp${e.imp} ${done(e) ? "done" : ""}"><span class="mct">${esc(fmtT12(e.time))}</span><span class="mci" title="${esc(TX(["","Low","Medium","High"][e.imp] + " importance"))}">${"●".repeat(e.imp)}${"○".repeat(3 - e.imp)}</span>
          <span class="mcn"><b>${esc(TX(e.name))}</b>${e.period ? `<small>${esc(e.period)}</small>` : ""}</span>
          <span class="mcv">${vals.map(v=>`<span><em>${esc(TX(v.name))}</em> ${done(e) ? `${esc(TX("Latest"))} <b>${macVal(v, v.last)}</b> · ${esc(TX("prior"))} ${macVal(v, v.prior)}` : `${esc(TX("Prior"))} <b>${macVal(v, v.last)}</b>`}</span>`).join("")}</span></div>`; }).join("")}</div>`).join("")
    || `<div class="empty">${esc(TX("No releases in this period."))}</div>`;
  // key indicators
  const I = MAC.indicators || {};
  $("#mcInd").innerHTML = ["cpi","core_cpi","pce","unrate","nfp","gdp","retail","claims","t2","t10"].filter(k=>I[k]).map(k=>{ const v = I[k], ch = v.prior != null ? v.last - v.prior : null;
    return `<div class="mccard"><span>${esc(TX(v.name))}</span><b>${macVal(v, v.last)}</b><small>${esc(fmtLong(iso(v.lastDate)))}${ch != null ? ` · ${esc(TX("prior"))} ${macVal(v, v.prior)}` : ""}</small>${macSpark(v.spark)}</div>`; }).join("");
}
$$("#mcWeek button").forEach(b=>b.onclick = ()=>{ macWeek = +b.dataset.w; renderMacro(); });
$$("#mcImp button").forEach(b=>b.onclick = ()=>{ macImp = +b.dataset.i; store.set("tt:macImp", macImp); renderMacro(); });

/* ================= RESEARCH REPORTS ================= */
// index.json on the "research" branch, written by .github/workflows/research.yml; PDFs and covers are served by jsDelivr
const RESEARCH_URL = (location.hostname === "localhost" || location.hostname === "127.0.0.1" || location.protocol === "file:") ? "/data/research.json"
  : "https://raw.githubusercontent.com/gslachowicz/fundamental-technical-charts/research/index.json";
let RS = null, rsLoading = null, rsFilter = store.get("tt:rsF") || "all";
function loadResearch(){
  if(!rsLoading) rsLoading = fetch(RESEARCH_URL + "?t=" + Math.floor(Date.now()/3e5), {cache:"no-store"}).then(r=>r.ok ? r.json() : {reports:[]}).catch(()=>({reports:[]})).then(d=>{ RS = d; });
  return rsLoading;
}
const rsKind = k => k === "weekly" ? "The Weekly Tape" : "The Daily Tape";
const rsDate = r => r.kind === "weekly" ? `${TX("Week ending")} ${fmtLong(iso(r.date))}` : fmtLong(iso(r.date));
function renderResearch(){
  if(!RS){ $("#rsGrid").innerHTML = `<div class="empty">${esc(TX("Loading…"))}</div>`; loadResearch().then(()=>{ if(!$("#vResearch").hidden) renderResearch(); }); return; }
  $$("#rsFilter button").forEach(b=>b.classList.toggle("on", b.dataset.k === rsFilter));
  const all = (RS.reports || []).filter(r=>r && r.pdf), L = all.filter(r=>rsFilter === "all" || r.kind === rsFilter);
  $("#rsCount").textContent = L.length ? `${L.length} ${TX(L.length === 1 ? "report" : "reports")}` : "";
  // next editions: weekdays before the open, Saturday for the weekly
  const now = new Date(), d = now.getUTCDay();
  $("#rsNext").innerHTML = `<div class="rsn"><span>${esc(TX("Next Daily"))}</span><b>${esc(TX(d === 5 || d === 6 ? "Monday" : "Tomorrow"))}, ${esc(TX("before the open"))}</b></div><div class="rsn"><span>${esc(TX("Next Weekly"))}</span><b>${esc(TX("Saturday morning"))}</b></div>`;
  if(!L.length){ $("#rsFeat").innerHTML = ""; $("#rsGrid").innerHTML = `<div class="empty rsempty"><b>${esc(TX("The first reports are on their way."))}</b> ${esc(TX("The Daily Tape comes out every trading morning before the open and The Weekly Tape every Saturday. They will all be here."))}</div>`; return; }
  const f = L[0];
  $("#rsFeat").innerHTML = `<a class="rscover big" href="${esc(f.pdf)}" target="_blank" rel="noopener"><img src="${esc(f.cover)}" alt="${esc(f.title)}" loading="lazy"></a>
    <div class="rsfx"><p class="kicker">${esc(TX("Latest"))} · ${esc(TX(rsKind(f.kind)))} · No. ${String(f.no||0).padStart(3,"0")}</p><h3>${esc(TX(rsKind(f.kind)))}</h3><p class="rsd">${esc(rsDate(f))}</p>
      ${(f.summary||[]).length ? `<ul>${f.summary.map(t=>`<li>${esc(t)}</li>`).join("")}</ul>` : ""}
      <div class="ctas"><a class="btn on" href="${esc(f.pdf)}" target="_blank" rel="noopener">${esc(TX("Read the report"))} (PDF)</a><a class="btn xshare" target="_blank" rel="noopener" href="https://x.com/intent/post?text=${encodeURIComponent(rsKind(f.kind) + " · " + rsDate(f) + " by @Tickerandtape")}&url=${encodeURIComponent(location.origin + "/research/")}">${esc(TX("Share on X"))}</a></div></div>`;
  $("#rsGrid").innerHTML = L.slice(1).map(r=>`<a class="rscard" href="${esc(r.pdf)}" target="_blank" rel="noopener"><span class="rscover"><img src="${esc(r.cover)}" alt="" loading="lazy"></span>
      <span class="rsk ${r.kind}">${esc(TX(r.kind === "weekly" ? "Weekly" : "Daily"))} · No. ${String(r.no||0).padStart(3,"0")}</span><b>${esc(rsDate(r))}</b>${r.summary && r.summary[0] ? `<small>${esc(r.summary[0])}</small>` : ""}</a>`).join("");
}
$$("#rsFilter button").forEach(b=>b.onclick = ()=>{ rsFilter = b.dataset.k; store.set("tt:rsF", rsFilter); renderResearch(); });

/* ================= TRADE IDEAS ================= */
/* ================= MARKET BREADTH ================= */
let BR = null, brLoading = null;
const brState = {g: store.get("tt:brG") || "all", r: +store.get("tt:brR") || 252, hover: -1};
const BR_TXT = {
  "Uptrend": "Confirmed uptrend. The backdrop favors buying breakouts from sound bases.",
  "Uptrend under pressure": "Uptrend under pressure. Be selective with new buys and keep stops tight.",
  "Rally attempt": "Rally attempt. Wait for a follow-through day before buying aggressively.",
  "Correction": "Market in correction. Protect capital; most breakouts fail in this phase."};
const BR_COL = {U:"#2f7d32", P:"#a86a00", R:"#8a8f9c", C:"#e0337f"};
function loadBreadth(){
  if(!brLoading) brLoading = getJSON("breadth.json").then(d=>{ BR = d; }).catch(()=>{ BR = {dates:[], groups:{}, indexes:{}}; });
  return brLoading;
}
function renderBreadth(){
  if(!BR){ $("#bStatus").innerHTML = `<div class="empty">Loading…</div>`; loadBreadth().then(()=>{ if(!$("#vBreadth").hidden) renderBreadth(); }); return; }
  $$("#bGroup button").forEach(b=>b.classList.toggle("on", b.dataset.g===brState.g));
  $$("#bRange button").forEach(b=>b.classList.toggle("on", +b.dataset.r===brState.r));
  const G = BR.groups[brState.g] || BR.groups.all;
  if(!G || !BR.dates.length){ $("#bStatus").innerHTML = `<div class="empty">Breadth data appears after the next nightly update.</div>`; $("#bStats").innerHTML = ""; return; }
  const L = BR.dates.length - 1, last = k => G[k][L];
  const nh = last("nh"), nl = last("nl"), mco = last("mco");
  $("#bStats").innerHTML = `<div><b>${last("a50")}%</b><span>above the 50-day line</span></div><div><b>${last("a200")}%</b><span>above the 200-day line</span></div>
    <div><b class="${nh<nl?'neg':''}">${nh} / ${nl}</b><span>new 52-week highs / lows</span></div><div><b class="${mco<0?'neg':''}">${mco>0?'+':''}${mco}</b><span>McClellan oscillator</span></div>`;
  $("#bStatus").innerHTML = Object.values(BR.indexes).map(m=>{
    const cl = m.close.filter(x=>x!=null), px = cl[cl.length-1], ch = cl.length>1 ? (px/cl[cl.length-2]-1)*100 : null;
    const det = m.status==="Rally attempt" ? `Day ${m.rallyDay} of the rally attempt off the ${fmtLong(iso(m.lowDate))} low.`
      : m.status==="Correction" ? (m.lowDate ? `Low so far: ${fmtLong(iso(m.lowDate))}. A rally attempt starts with the first up day.` : "")
      : m.ftdDate ? `Follow-through day: ${fmtLong(iso(m.ftdDate))}.` : "";
    return `<div class="pcard bcard">
      <div class="top"><span class="nm">${esc(m.name)}</span><span class="px">${fmtP(px)}</span><span class="${ch<0?'neg':''}" style="font-family:var(--f-data)">${fmtPct(ch,2)}</span>
        <span class="sp"></span><span class="chip ${MKT_CLASS[m.status]||''}">${esc(m.status)}</span></div>
      <p class="bwhy">${esc(BR_TXT[m.status]||"")} ${esc(det)}</p>
      <div class="dd" title="Distribution days that still count">${Array.from({length:8},(_,i)=>`<i class="${i<m.distDays?'on':''}"></i>`).join("")}<span>${m.distDays} distribution day${m.distDays===1?'':'s'}${m.distDates.length?': '+m.distDates.map(d=>fmtD(iso(d)).slice(0,6)).join(", "):''}</span></div>
    </div>`; }).join("");
  $("#bTitle").innerHTML = `${esc(G.label)} <small>${G.count.toLocaleString("en-US")} stocks</small>`;
  $("#bAsOf").textContent = `as of ${fmtLong(iso(BR.dates[L]))} close`;
  $("#bCount").textContent = "";
  drawBreadth();
}
function drawBreadth(){
  const c = $("#bcv"); if(!c || $("#vBreadth").hidden || !BR || !BR.dates.length) return;
  const G = BR.groups[brState.g] || BR.groups.all, ix = BR.indexes[brState.g==="ndx" ? "^IXIC" : "^GSPC"] || Object.values(BR.indexes)[0];
  const W = c.clientWidth; if(!W) return;
  const narrow = W < 600, H = narrow ? 760 : 900, dpr = devicePixelRatio || 1;
  c.style.height = H+"px"; c.width = W*dpr; c.height = H*dpr; const g = c.getContext("2d"); g.setTransform(dpr,0,0,dpr,0,0);
  g.fillStyle = C.plate; g.fillRect(0,0,W,H);
  const n = Math.min(brState.r, BR.dates.length), s0 = BR.dates.length - n, D = BR.dates.slice(s0);
  const Lm = 8, R = narrow ? 44 : 56, plotW = W - Lm - R, T0 = 8, B = 20, gap = 8;
  const panels = [
    {k:"idx", w:.30, title: ix ? ix.name : "Index"},
    {k:"ma", w:.20, title: narrow ? "% above MAs" : "% of stocks above moving averages"},
    {k:"hl", w:.17, title: narrow ? "52-wk highs / lows" : "New 52-week highs / lows"},
    {k:"ad", w:.16, title: narrow ? "A/D line" : "Advance / decline line"},
    {k:"mco", w:.17, title: narrow ? "McClellan" : "McClellan oscillator"}];
  const avail = H - T0 - B - gap*(panels.length-1);
  let y0 = T0; panels.forEach(p=>{ p.top = y0; p.h = Math.round(avail*p.w); y0 += p.h + gap; });
  const x = i => Lm + (i + .5) / n * plotW, bw = plotW / n;
  const sl = k => G[k].slice(s0);
  const hv = brState.hover >= 0 && brState.hover < n ? brState.hover : n-1;
  g.font = `11px ${FONT_D}`;
  // month grid + labels
  g.textAlign = "center"; g.textBaseline = "alphabetic";
  let lastM = -1; D.forEach((d,i)=>{ const dt = new Date(iso(d)), m = dt.getUTCMonth(); if(m!==lastM && i>0){
      const step = n > 300 ? 3 : 1; if(m % step === 0 || n <= 300){ const xx = Math.round(x(i))+.5; g.strokeStyle = C.grid; g.setLineDash([1,3]); g.beginPath(); g.moveTo(xx,T0); g.lineTo(xx,H-B); g.stroke(); g.setLineDash([]);
      g.fillStyle = C.ink2; g.fillText(m===0 ? String(dt.getUTCFullYear()) : MON[m], xx, H-5); } } lastM = m; });
  const frame = (p, lo, hi, fmt, zero) => {
    const y = v => p.top + 4 + (hi - v) / ((hi - lo) || 1) * (p.h - 8);
    g.strokeStyle = C.grid; g.setLineDash([1,3]); g.lineWidth = 1; g.fillStyle = C.ink2; g.textAlign = "left"; g.textBaseline = "middle"; g.font = `11px ${FONT_D}`;
    linTicks(lo, hi, p.h).forEach(v=>{ const yy = Math.round(y(v))+.5; if(yy < p.top+8 || yy > p.top+p.h-4) return; g.beginPath(); g.moveTo(Lm,yy); g.lineTo(Lm+plotW,yy); g.stroke(); g.fillText(fmt(v), Lm+plotW+5, yy); });
    g.setLineDash([]);
    if(zero!=null && zero>lo && zero<hi){ g.strokeStyle = C.ink2; g.beginPath(); g.moveTo(Lm, Math.round(y(zero))+.5); g.lineTo(Lm+plotW, Math.round(y(zero))+.5); g.stroke(); }
    return y; };
  const line = (arr, y, col, w=1.4) => { g.strokeStyle = col; g.lineWidth = w; g.beginPath(); let st = false; arr.forEach((v,i)=>{ if(v==null) return; st ? g.lineTo(x(i),y(v)) : g.moveTo(x(i),y(v)); st = true; }); g.stroke(); };
  const legend = (p, items0) => { g.font = `600 11px ${FONT_L}`; g.textBaseline = "top"; g.textAlign = "left"; let xx = Lm + 6;
    const title = TX(p.title), items = items0.map(([c,t])=>[c, TX(String(t))]);
    g.fillStyle = "rgba(255,255,255,.85)"; const tw = items.reduce((a,[,t])=>a + g.measureText(t).width + 26, g.measureText(title).width + 14);
    g.fillRect(Lm+1, p.top+1, Math.min(tw, plotW-2), 17);
    g.fillStyle = C.navy; g.fillText(title, xx, p.top + 4); xx += g.measureText(title).width + 12;
    items.forEach(([col, t])=>{ if(col){ g.fillStyle = col; g.fillRect(xx, p.top+8, 10, 3); xx += 14; } g.fillStyle = C.ink; g.fillText(t, xx, p.top + 4); xx += g.measureText(t).width + 12; }); };
  const rng = arr => { const v = arr.filter(a=>a!=null); return [Math.min(...v), Math.max(...v)]; };
  for(const p of panels){
    g.save(); g.beginPath(); g.rect(Lm, p.top, plotW, p.h); g.clip();
    if(p.k === "idx" && ix){
      const cl = ix.close.slice(s0), [lo, hi] = rng(cl), pad = (hi-lo)*.06;
      g.restore(); const y = frame(p, lo-pad, hi+pad, fmtP); g.save(); g.beginPath(); g.rect(Lm, p.top, plotW, p.h); g.clip();
      // market direction strip along the bottom of the panel
      const codes = ix.codes.slice(s0); for(let i=0;i<n;i++){ g.fillStyle = BR_COL[codes[i]] || "transparent"; g.fillRect(x(i)-bw/2, p.top+p.h-6, Math.ceil(bw)+.5, 6); }
      line(cl, y, C.ink, 1.5);
      // distribution days that still count
      const dset = new Set(ix.distDates); g.fillStyle = C.down;
      D.forEach((d,i)=>{ if(dset.has(d) && cl[i]!=null){ const xx = x(i), yy = y(cl[i]) - 7; g.beginPath(); g.moveTo(xx-4, yy-6); g.lineTo(xx+4, yy-6); g.lineTo(xx, yy); g.fill(); } });
      if(ix.ftdDate){ const i = D.indexOf(ix.ftdDate); if(i>=0 && cl[i]!=null){ g.fillStyle = C.piv; const xx = x(i), yy = y(cl[i]) + 7; g.beginPath(); g.moveTo(xx-4, yy+6); g.lineTo(xx+4, yy+6); g.lineTo(xx, yy); g.fill(); } }
      g.restore(); g.save();
      const cd = ix.codes.slice(s0)[hv], st = {U:"Uptrend",P:"Under pressure",R:"Rally attempt",C:"Correction"}[cd] || "";
      legend(p, [[null, fmtP(cl[hv])], [BR_COL[cd], st], ...(narrow ? [] : [[C.down, "▼ distribution"], ...(ix.ftdDate ? [[C.piv, "▲ follow-through"]] : [])])]);
    }
    if(p.k === "ma"){
      g.restore(); const y = frame(p, 0, 100, v=>v+"%", 50); g.save(); g.beginPath(); g.rect(Lm, p.top, plotW, p.h); g.clip();
      g.fillStyle = "rgba(224,51,127,.06)"; g.fillRect(Lm, y(20), plotW, y(0)-y(20)); g.fillStyle = "rgba(29,63,196,.06)"; g.fillRect(Lm, y(100), plotW, y(80)-y(100));
      line(sl("a20"), y, C.ema, 1.1); line(sl("a50"), y, C.ma50, 1.5); line(sl("a200"), y, C.ink, 1.5);
      g.restore(); g.save();
      const v = k => (sl(k)[hv] ?? "—") + "%";
      legend(p, [[C.ema, (narrow?"20d ":"20-day ")+v("a20")], [C.ma50, (narrow?"50d ":"50-day ")+v("a50")], [C.ink, (narrow?"200d ":"200-day ")+v("a200")]]);
    }
    if(p.k === "hl"){
      const NH = sl("nh"), NL = sl("nl"), mx = Math.max(5, ...NH, ...NL);
      g.restore(); const y = frame(p, -mx*1.08, mx*1.08, v=>String(Math.abs(Math.round(v))), 0); g.save(); g.beginPath(); g.rect(Lm, p.top, plotW, p.h); g.clip();
      const w = Math.max(1, bw*.7);
      for(let i=0;i<n;i++){ g.fillStyle = C.up; g.fillRect(x(i)-w/2, y(NH[i]), w, y(0)-y(NH[i])); g.fillStyle = C.down; g.fillRect(x(i)-w/2, y(0), w, y(-NL[i])-y(0)); }
      // 10-day average of the net (highs minus lows)
      const net = NH.map((h,i)=>h-NL[i]), avg = net.map((_,i)=> i<9 ? null : net.slice(i-9,i+1).reduce((a,b)=>a+b,0)/10);
      line(avg, y, C.ink, 1.3);
      g.restore(); g.save();
      legend(p, [[C.up, (narrow?"":"Highs ")+NH[hv]], [C.down, (narrow?"":"Lows ")+NL[hv]], ...(narrow ? [] : [[C.ink, "Net, 10-day avg"]])]);
    }
    if(p.k === "ad"){
      const A = sl("ad"), base = A[0], AA = A.map(v=>v-base), [lo, hi] = rng(AA), pad = (hi-lo)*.08 || 10;
      g.restore(); const y = frame(p, lo-pad, hi+pad, v=>Math.round(v).toLocaleString("en-US")); g.save(); g.beginPath(); g.rect(Lm, p.top, plotW, p.h); g.clip();
      const ma = AA.map((_,i)=> i<49 ? null : AA.slice(i-49,i+1).reduce((a,b)=>a+b,0)/50);
      line(ma, y, C.ma50, 1.1); line(AA, y, C.navy, 1.5);
      g.restore(); g.save();
      const adv = sl("adv")[hv], dec = sl("dec")[hv];
      legend(p, narrow ? [[null, `${adv} up · ${dec} down`]] : [[C.navy, "Cumulative"], [C.ma50, "50-day avg"], [null, `Day: ${adv} up · ${dec} down`]]);
    }
    if(p.k === "mco"){
      const M = sl("mco"), mx = Math.max(20, ...M.map(Math.abs));
      g.restore(); const y = frame(p, -mx*1.08, mx*1.08, v=>String(Math.round(v)), 0); g.save(); g.beginPath(); g.rect(Lm, p.top, plotW, p.h); g.clip();
      const w = Math.max(1, bw*.7);
      for(let i=0;i<n;i++){ const v = M[i]; if(v==null) continue; g.fillStyle = v >= 0 ? C.up : C.down; g.fillRect(x(i)-w/2, Math.min(y(v), y(0)), w, Math.abs(y(v)-y(0))); }
      g.restore(); g.save();
      legend(p, [[null, (M[hv]>0?"+":"")+M[hv]]]);
    }
    g.restore();
    g.strokeStyle = C.ink; g.lineWidth = 1; g.strokeRect(Lm+.5, p.top+.5, plotW, p.h);
  }
  // crosshair + date tag
  if(brState.hover >= 0 && brState.hover < n){
    const xx = Math.round(x(hv))+.5; g.strokeStyle = "rgba(21,23,28,.45)"; g.setLineDash([3,3]); g.beginPath(); g.moveTo(xx, T0); g.lineTo(xx, H-B); g.stroke(); g.setLineDash([]);
    const t = fmtLong(iso(D[hv])); g.font = `700 11px ${FONT_D}`; const tw = g.measureText(t).width + 10, tx = Math.min(Math.max(xx - tw/2, Lm), Lm+plotW-tw);
    g.fillStyle = C.ink; g.fillRect(tx, H-B+2, tw, 16); g.fillStyle = "#fff"; g.textAlign = "left"; g.textBaseline = "middle"; g.fillText(t, tx+5, H-B+10);
  }
  c._bx = {Lm, plotW, n};
}
(()=>{
  const c = $("#bcv"); if(!c) return;
  const at = e => { const b = c._bx; if(!b) return -1; const r = c.getBoundingClientRect(), px = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
    if(px < b.Lm || px > b.Lm + b.plotW) return -1; return Math.min(b.n-1, Math.max(0, Math.floor((px - b.Lm) / b.plotW * b.n))); };
  let raf = 0; const mv = e => { const i = at(e); if(i === brState.hover) return; brState.hover = i; cancelAnimationFrame(raf); raf = requestAnimationFrame(drawBreadth); };
  c.addEventListener("mousemove", mv); c.addEventListener("touchmove", mv, {passive:true});
  c.addEventListener("mouseleave", ()=>{ brState.hover = -1; drawBreadth(); });
})();
$$("#bGroup button").forEach(b=>b.onclick = ()=>{ brState.g = b.dataset.g; store.set("tt:brG", brState.g); renderBreadth(); });
$$("#bRange button").forEach(b=>b.onclick = ()=>{ brState.r = +b.dataset.r; store.set("tt:brR", brState.r); renderBreadth(); });
let brResize = 0; addEventListener("resize", ()=>{ clearTimeout(brResize); brResize = setTimeout(()=>{ if(!$("#vBreadth").hidden) drawBreadth(); }, 120); });

let IDEAS = null, ideasLoading = null, ideaFilter = store.get("tt:ideaF") || "all", ideaSmr = store.get("tt:ideaSmr") || "all";
const ideaSmrOf = it => it.smr || (UNI && (UNI.find(r=>r.symbol===it.symbol)||{}).smr) || "";
function loadIdeas(){
  if(!ideasLoading) ideasLoading = getJSON("ideas.json").then(d=>{ IDEAS = d; }).catch(()=>{ IDEAS = {ideas:[], history:[], stats:{}}; });
  return ideasLoading;
}
function ideaChart(cv, it){
  const dpr = devicePixelRatio || 1, W = cv.clientWidth || 300, H = cv.clientHeight || 110;
  cv.width = W*dpr; cv.height = H*dpr; const g = cv.getContext("2d"); g.setTransform(dpr,0,0,dpr,0,0);
  const d = it.spark || []; if(d.length < 2) return;
  const lo = Math.min(...d, it.stop), hi = Math.max(...d, it.buyZoneTop), pad = (hi-lo)*0.06;
  const R = 46, y = v => 4 + (hi+pad - v)/((hi-lo)+2*pad)*(H-8), x = i => 2 + i/(d.length-1)*(W-R-6);
  // buy zone band, pivot and stop
  g.fillStyle = "rgba(29,63,196,.09)"; g.fillRect(0, y(it.buyZoneTop), W-R, y(it.pivot)-y(it.buyZoneTop));
  const hl = (v, col, dash, lbl) => { g.strokeStyle = col; g.setLineDash(dash); g.lineWidth = 1; g.beginPath(); g.moveTo(0, Math.round(y(v))+.5); g.lineTo(W-R, Math.round(y(v))+.5); g.stroke(); g.setLineDash([]);
    g.fillStyle = col; g.font = `600 10px ${FONT_L}`; g.textBaseline = "middle"; g.fillText(lbl, W-R+4, y(v)); };
  hl(it.pivot, C.piv, [4,3], fmtP(it.pivot)); hl(it.stop, C.down, [2,3], "stop");
  g.strokeStyle = C.ink; g.lineWidth = 1.4; g.beginPath(); d.forEach((v,i)=> i ? g.lineTo(x(i), y(v)) : g.moveTo(x(i), y(v))); g.stroke();
  g.fillStyle = C.ink; g.beginPath(); g.arc(x(d.length-1), y(d[d.length-1]), 2.6, 0, 7); g.fill();
}
function renderIdeas(){
  if(!IDEAS){ $("#iCards").innerHTML = `<div class="empty">Loading…</div>`; loadIdeas().then(()=>{ if(!$("#vIdeas").hidden) renderIdeas(); }); return; }
  $$("#iFilter button").forEach(b=>b.classList.toggle("on", b.dataset.f === ideaFilter));
  const R = IDEAS.rules || {}; if(R.minRs) $("#iRs").textContent = R.minRs;
  $$("#iSmr button").forEach(b=>b.classList.toggle("on", b.dataset.q === ideaSmr));
  if(!UNI && (IDEAS.ideas||[]).some(i=>!i.smr)) loadUni().then(()=>{ if(!$("#vIdeas").hidden) renderIdeas(); }).catch(()=>{});
  const all = IDEAS.ideas || [], list = all.filter(i=>(ideaFilter === "all" || i.status === ideaFilter) && (ideaSmr === "all" || /^[AB]/.test(ideaSmrOf(i))));
  order = list.map(i=>i.symbol);   // the chart's ‹ › arrows step through these ideas
  const signed = !!auth.token;
  $("#iCount").textContent = IDEAS.date ? `${list.length} setup${list.length===1?"":"s"} · ${fmtLong(iso(IDEAS.date))} close` : "";
  const st = IDEAS.stats || {};
  $("#iStats").innerHTML = st.count ? `<div><b>${st.count}</b><span>ideas tracked</span></div><div><b>${st.winPct ?? "—"}%</b><span>in the green</span></div><div><b class="${(st.avgPct??0)<0?'neg':''}">${fmtPct(st.avgPct,1)}</b><span>average return</span></div><div><b>${fmtPct(st.avgMaxPct,1)}</b><span>average best gain</span></div>`
    : `<div><b>${all.length}</b><span>setups today</span></div><div class="wide"><span>The track record fills in as ideas age: every one is followed for 8 weeks or until its stop.</span></div>`;
  const pc = v => v==null || v==="" ? "—" : (typeof v === "number" ? fmtPct(v,1) : esc(v));
  $("#iCards").innerHTML = list.length ? list.map((it,k)=>`
    <article class="icard" data-s="${esc(it.symbol)}">
      <header><div><span class="sym">${esc(it.symbol)}</span><span class="nm">${esc(it.name)}</span></div><span class="rsv hot" title="RS Rating">${it.rs ?? "—"}</span></header>
      <div class="imeta"><span class="chip ${STATUS_CLASS[it.status]||""}">${esc(it.status)}</span><span>${esc(it.type||"")}${it.weeks?` · ${it.weeks} wks`:""}${it.depthPct!=null?` · ${it.depthPct}% deep`:""}</span></div>
      <canvas class="icv" data-k="${k}"></canvas>
      <dl class="ifacts">
        <dt>Price</dt><dd>${fmtP(it.close)} <small class="${(it.chgPct??0)<0?'neg':'up'}">${fmtPct(it.chgPct,1)}</small></dd>
        <dt>vs pivot</dt><dd class="${(it.distPct??0)<0?'neg':''}">${fmtPct(it.distPct,1)}</dd>
        <dt>Group</dt><dd title="${esc(it.group)}">${esc(it.groupRank || "—")}</dd>
        <dt>EPS / Sales</dt><dd><span class="${TIER.eps(pnum(it.epsChg))}">${pc(it.epsChg)}</span> / <span class="${TIER.sales(pnum(it.salesChg))}">${pc(it.salesChg)}</span></dd>
        <dt title="Sales growth, profit margins and return on equity, A (best) to E">SMR</dt><dd>${(()=>{ const g = ideaSmrOf(it); return g ? `<span class="smrg smr-${esc(g[0].toLowerCase())}">${esc(g)}</span>` : "—"; })()}</dd>
        <dt>RS</dt><dd>${it.rs ?? "—"}</dd>
      </dl>
      <div class="iplan ${signed ? "" : "locked"}">
        <div><span>Buy point</span><b>${signed ? fmtP(it.pivot) : "000.00"}</b></div>
        <div><span>Buy zone to</span><b>${signed ? fmtP(it.buyZoneTop) : "000.00"}</b></div>
        <div><span>Stop (−7%)</span><b class="neg">${signed ? fmtP(it.stop) : "000.00"}</b></div>
        ${signed ? "" : `<button class="btn on ilock" data-w="up">Free account: see the trade plan</button>`}
      </div>
      <footer><a href="/chart/${esc(it.symbol)}/" class="btn">Open chart →</a><a class="btn xshare" target="_blank" rel="noopener" href="${esc(xShareUrl(it.symbol, `RS ${it.rs} · ${it.type}, ${it.status.toLowerCase()} (pivot ${fmtP(it.pivot)}) — today's trade ideas on Ticker&Tape`))}">Share on X</a></footer>
    </article>`).join("") : `<div class="empty">No stock passes every filter today${ideaFilter!=="all" ? " in this group" : ""}. In weak markets that is normal: fewer leaders set up.</div>`;
  $$("#iCards canvas.icv").forEach(cv=>ideaChart(cv, list[+cv.dataset.k]));
  $$("#iCards .icard").forEach(c=>c.onclick = e=>{ if(e.target.closest("a,button")) return; go(c.dataset.s); });
  $$("#iCards [data-w=up]").forEach(b=>b.onclick = e=>{ e.stopPropagation(); openAuth("up"); });
  // track record
  const H = (IDEAS.history || []).filter(h=>h.date < (IDEAS.date||"9")).slice(0, 60);
  $("#iTrack").innerHTML = H.length ? `<table class="scr itr"><thead><tr><th class="l nosort">Stock</th><th class="nosort">Flagged</th><th class="l nosort">Setup</th><th class="nosort">Price then</th><th class="nosort">Last</th><th class="nosort">Return</th><th class="nosort">Best</th><th class="l nosort">Status</th></tr></thead><tbody>${
    H.map(h=>`<tr data-s="${esc(h.symbol)}"><td class="l"><span class="sym">${esc(h.symbol)}</span><span class="nm">${esc(h.name||"")}</span></td><td>${fmtD(Date.parse(h.date))}</td><td class="l">${esc(h.status)}</td><td>${fmtP(h.price)}</td><td>${fmtP(h.last)}</td>
      <td class="${h.retPct<0?'neg':'up'}"><b>${fmtPct(h.retPct,1)}</b></td><td>${fmtPct(h.maxPct,1)}</td><td class="l"><span class="res r-${esc(h.result.toLowerCase())}">${esc(h.result)}${h.closed?` · ${fmtD(Date.parse(h.closed))}`:""}</span></td></tr>`).join("")}</tbody></table>`
    : `<div class="empty">The first ideas enter the track record after their first full trading day.</div>`;
  $$("#iTrack tr[data-s]").forEach(tr=>tr.onclick = ()=>{ go(tr.dataset.s); });
}
$$("#iFilter button").forEach(b=>b.onclick = ()=>{ ideaFilter = b.dataset.f; store.set("tt:ideaF", ideaFilter); renderIdeas(); });
$$("#iSmr button").forEach(b=>b.onclick = ()=>{ ideaSmr = b.dataset.q; store.set("tt:ideaSmr", ideaSmr); renderIdeas(); });
let ideaResize = 0; addEventListener("resize", ()=>{ clearTimeout(ideaResize); ideaResize = setTimeout(()=>{ if(!$("#vIdeas").hidden && IDEAS) $$("#iCards canvas.icv").forEach(cv=>{ const all = IDEAS.ideas||[], list = ideaFilter==="all"?all:all.filter(i=>i.status===ideaFilter); ideaChart(cv, list[+cv.dataset.k]); }); }, 150); });
let hmResize = 0; addEventListener("resize", ()=>{ clearTimeout(hmResize); hmResize = setTimeout(()=>{ if(!$("#vHeat").hidden) renderHeat(); }, 120); });



/* ================= ACCOUNTS & SYNC (api.tickerandtape.com) ================= */
const API = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? "http://127.0.0.1:8787" : "https://api.tickerandtape.com";
const auth = { token: store.get("tt:token"), email: store.get("tt:email") };
// sessions on this device: sign in again after closing the site (no open tab for 3 minutes) and every 2 hours
const SESSION_MAX = 2*60*60*1000, CLOSED_AFTER = 3*60*1000;
function sessionEnd(onLoad){
  if(!auth.token) return "";
  const now = Date.now(), at = +store.get("tt:loginAt") || 0, alive = +store.get("tt:alive") || 0;
  if(!at || now - at > SESSION_MAX) return "Your session ended after 2 hours. Sign in again to continue.";
  if(onLoad && alive && now - alive > CLOSED_AFTER) return "Welcome back. Sign in to continue.";
  return "";
}
let SESSION_MSG = sessionEnd(true);
if(SESSION_MSG){   // ended while the site was closed: drop the token before anything loads
  const tk = auth.token;
  fetch((/^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? "http://127.0.0.1:8787" : "https://api.tickerandtape.com") + "/auth/logout",
    {method:"POST", headers:{"Content-Type":"application/json", Authorization:"Bearer " + tk}}).catch(()=>{});
  auth.token = auth.email = null;
  try{ ["tt:token","tt:email","tt:wl","tt:lists","tt:notes","tt:notifSeen","tt:loginAt","tt:pf"].forEach(k=>localStorage.removeItem(k)); }catch(e){}
}
const beat = () => store.set("tt:alive", Date.now());
let ending = false;
function checkSession(){
  const m = sessionEnd(false); if(!m || ending) return; ending = true;
  api("/auth/logout", {method:"POST"}).catch(()=>{}).finally(()=>{ ending = false; signedOut(); toast(TX(m)); openAuth("in"); });
}
beat(); setInterval(()=>{ checkSession(); beat(); }, 30*1000);
addEventListener("pagehide", beat);
document.addEventListener("visibilitychange", ()=>{ if(document.visibilityState === "visible") checkSession(); beat(); });
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
async function pullData(fresh, isNew){
  // fresh = just signed in / signed up: anything only on this device goes up to the account
  let d; try{ d = await api("/data"); }catch(e){ return; }
  if(d.lists && Array.isArray(d.lists.lists) && d.lists.lists.length){ LISTS = d.lists; ensureLists(); WL = activeList().t.slice(); store.set("tt:wl", WL); store.set("tt:lists", LISTS); }
  else if(Array.isArray(d.watchlist)){ WL = d.watchlist; store.set("tt:wl", WL); LISTS = null; ensureLists(); store.set("tt:lists", LISTS); push("lists", LISTS); }
  else { WL = fresh && WL ? WL.slice() : []; store.set("tt:wl", WL); push("watchlist", WL); if(!(fresh && LISTS)) LISTS = null; ensureLists(); activeList().t = WL.slice(); saveLists(); }   // accounts never use the sample list; lists made before signing up are kept
  if(d.notes && typeof d.notes === "object"){ NOTES = fresh ? {...d.notes, ...NOTES} : d.notes; store.set("tt:notes", NOTES); if(fresh) push("notes", NOTES); }
  else if(fresh && Object.keys(NOTES).length) push("notes", NOTES);   // new accounts start empty; the sample list is only for visitors
  if(d.cfg && typeof d.cfg==="object"){ cfg = normCfg(d.cfg); cfg.ind = normInd(cfg.ind); cfg.tpl = normTpl(cfg.tpl); cfg.draw = normDraw(cfg.draw); syncBox(); store.set("ink:cfg", cfg); redrawAll(); renderScreenBtns(); applyCols();
    if(cfg.lang && cfg.lang !== I18N.lang && I18N.setLang) I18N.setLang(cfg.lang); }
  else if(fresh){ push("cfg", cfg); }
  if(d.portfolio && typeof d.portfolio === "object" && Array.isArray(d.portfolio.trades) && (d.portfolio.trades.length || !(fresh && PF.trades.length))){ PF = normPf(d.portfolio); store.set("tt:pf", PF); pfCalc = null; if(!$("#vPortfolio").hidden) renderPortfolio(); }
  else if(fresh && PF.trades.length) savePf();
  const remote = new Set();
  for(const [k,v] of Object.entries(d)){ if(k.startsWith("marks:")){ remote.add(k); store.set("ink:" + k, v); } }
  if(fresh) localMarkKeys().forEach(k=>{ const key = k.slice(4); const v = store.get(k); if(!remote.has(key) && Array.isArray(v) && v.length) push(key, v); });
  if(needsUni()) loadUni().catch(()=>{});
  if(S){ S.marks = store.get(marksKey(S.symbol)) || []; draw(); renderDbox(); }
  updateStar(); if(S) renderTkNote();
  if(!$("#vScreener").hidden) renderScreener();
  loadAlerts(); startNotifs(); checkMe(isNew);
}
function signedOut(expired){
  auth.token = auth.email = null;
  try{ ["tt:token","tt:email","tt:wl","tt:lists","tt:notes","tt:notifSeen","tt:loginAt","tt:pf"].forEach(k=>localStorage.removeItem(k)); localMarkKeys().forEach(k=>localStorage.removeItem(k)); }catch(e){}
  WL = null; LISTS = null; NOTES = {}; PF = normPf(null); pfCalc = null; ALERTS = []; NOTIF = {items:[], unread:0}; clearInterval(notifTimer); $("#vBar").hidden = true; renderBell(); if(S) renderTkNote(); if(S){ S.marks = []; draw(); } if(!$("#vIdeas").hidden) renderIdeas();
  renderAcct(); updateStar(); if(!$("#vScreener").hidden) renderScreener();
  if(expired) toast("Your session expired. Sign in again to sync your watchlist.");
  route();
}
function renderAcct(){
  if(auth.token) $("#gateBar").hidden = true;
  const b = $("#acct"); b.textContent = auth.email ? auth.email.split("@")[0] : "Sign in";
  b.title = auth.email ? `Signed in as ${auth.email}` : "Sign in or create a free account";
  b.classList.toggle("on", !!auth.email);
  renderBell();
}
function toggleMenu(on){
  const m = $("#acctMenu"); on = on==null ? m.hidden : on; m.hidden = !on; $("#acct").setAttribute("aria-expanded", on);
  if(on) m.innerHTML = `<div class="who">Signed in as<br><b>${esc(auth.email)}</b></div><button data-a="alerts" role="menuitem">My alerts</button><button data-a="pw" role="menuitem">Change password</button><button data-a="out" role="menuitem">Sign out</button>`;
}
$("#acct").onclick = e => { e.stopPropagation(); if(auth.token) toggleMenu(); else openAuth("in"); };
$("#acctMenu").addEventListener("click", async e=>{
  const a = e.target.closest("button[data-a]"); if(!a) return; toggleMenu(false);
  if(a.dataset.a==="pw") openAuth("pw");
  if(a.dataset.a==="alerts") openAlertsList();
  if(a.dataset.a==="out"){ try{ await api("/auth/logout", {method:"POST"}); }catch(err){} signedOut(); toast("Signed out."); }
});
document.addEventListener("click", e=>{ const m=$("#acctMenu"); if(!m.hidden && !e.composedPath().includes(m)) toggleMenu(false); });

let authMode = "in";
const AUTH_TXT = {
  in:  {t:"Sign in", go:"Sign in", sw:"New here?", tg:"Create a free account", pw:"Password", ac:"current-password"},
  up:  {t:"Create your account", go:"Create account", sw:"Already have an account?", tg:"Sign in", pw:"Password (8+ characters)", ac:"new-password"},
  pw:  {t:"Change password", go:"Save new password", pw:"New password (8+ characters)", ac:"new-password"},
  forgot: {t:"Reset your password", go:"Email me a reset link", sw:"Remembered it?", tg:"Sign in", pw:"", ac:"off"},
  reset:  {t:"Choose a new password", go:"Save and sign in", pw:"New password (8+ characters)", ac:"new-password"}};
let resetToken = null;
function openAuth(mode){
  authMode = mode; const T = AUTH_TXT[mode];
  $("#authTitle").textContent = T.t; $("#aGo").textContent = T.go; $("#aPwLbl").textContent = T.pw; $("#aPw").autocomplete = T.ac;
  $("#fEmail").hidden = mode==="pw" || mode==="reset"; $("#fCur").hidden = mode!=="pw"; $("#aSwitch").hidden = mode==="pw" || mode==="reset";
  $("#fPw").hidden = mode==="forgot"; $("#aForgot").hidden = mode!=="in"; $("#aLegal").hidden = mode!=="up";
  $("#authSub").hidden = mode!=="in" && mode!=="up";
  if(T.sw){ $("#aSwTxt").textContent = T.sw; $("#aToggle").textContent = T.tg; }
  $("#aErr").hidden = true; $("#aPw").value = ""; $("#aCur").value = "";
  $("#authModal").hidden = false; setTimeout(()=>(mode==="pw" ? $("#aCur") : mode==="reset" ? $("#aPw") : mode==="forgot" ? $("#aEmail") : $("#aEmail").value ? $("#aPw") : $("#aEmail")).focus(), 30);
}
const closeAuth = () => { $("#authModal").hidden = true; };
$("#authClose").onclick = closeAuth;
$("#authModal").addEventListener("mousedown", e=>{ if(e.target.id==="authModal") closeAuth(); });
document.addEventListener("keydown", e=>{ if(e.key==="Escape" && !$("#authModal").hidden) closeAuth(); });
$("#aToggle").onclick = () => openAuth(authMode==="in" ? "up" : "in");
$("#aForgotBtn").onclick = () => openAuth("forgot");
$("#authForm").addEventListener("submit", async e=>{
  e.preventDefault();
  const email = $("#aEmail").value.trim(), pw = $("#aPw").value, err = $("#aErr"), go = $("#aGo");
  err.hidden = true;
  if(authMode!=="pw" && authMode!=="reset" && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)){ err.textContent = "Enter a valid email address."; err.hidden = false; return; }
  if(pw.length < 8 && authMode!=="in" && authMode!=="forgot"){ err.textContent = "Use a password of at least 8 characters."; err.hidden = false; return; }
  go.disabled = true;
  try{
    if(authMode==="forgot"){
      await api("/auth/forgot", {method:"POST", body: JSON.stringify({email})});
      closeAuth(); toast(`If ${email} has an account, a reset link is on its way. It works for one hour.`);
    } else if(authMode==="reset"){
      const r = await api("/auth/reset", {method:"POST", body: JSON.stringify({token: resetToken, password: pw})});
      resetToken = null;
      auth.token = r.token; auth.email = r.email; store.set("tt:token", r.token); store.set("tt:email", r.email); store.set("tt:loginAt", Date.now());
      closeAuth(); renderAcct(); toast("Password updated. You are signed in.");
      await pullData(true); store.set("tt:welcomed", true);
    } else if(authMode==="pw"){
      await api("/auth/password", {method:"POST", body: JSON.stringify({current: $("#aCur").value, password: pw})});
      closeAuth(); toast("Password changed.");
    } else {
      const r = await api(authMode==="up" ? "/auth/signup" : "/auth/login", {method:"POST", body: JSON.stringify({email, password: pw})});
      auth.token = r.token; auth.email = r.email; store.set("tt:token", r.token); store.set("tt:email", r.email); store.set("tt:loginAt", Date.now());
      closeAuth(); renderAcct(); if(!$("#vIdeas").hidden) renderIdeas();
      toast(authMode==="up" ? "Account created. Your watchlist now syncs to every device." : `Welcome back, ${r.email}.`);
      await pullData(true, authMode==="up");
      store.set("tt:welcomed", true);
      if(!$("#vWelcome").hidden){ go(""); if(authMode==="up" && !store.get("tt:toured")) setTimeout(startTour, 700); }
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
  if(!CUR) return; const L = WL ? WL.slice() : inWL(CUR) ? getWL().slice() : []; const i = L.indexOf(CUR);
  if(i >= 0){ L.splice(i,1); toast(`${CUR} removed from your watchlist.`); }
  else {
    if(L.length >= 300){ toast("Your watchlist is full (300 tickers)."); return; }
    L.push(CUR);
    const hasData = ROWS.some(r=>r.symbol===CUR) || (UNI && UNI.some(r=>r.symbol===CUR));
    toast(!hasData ? `${CUR} added. Its data loads after the next nightly update.` : auth.token ? `${CUR} added to your watchlist.` : `${CUR} added. Sign in or create a free account to keep it on every device.`);
  }
  setWL(L); updateStar(); if(!$("#vScreener").hidden) renderScreener();
};


/* ================= DIALOG (generic) ================= */
function dlg(title, html, bind){
  $("#dlgT").textContent = title; $("#dlgB").innerHTML = html; $("#dlg").hidden = false;
  if(bind) bind($("#dlgB"));
  const f = $("#dlgB").querySelector("input:not([type=checkbox]),textarea,select,button.on"); if(f) setTimeout(()=>f.focus(), 30);
}
function closeDlg(){ $("#dlg").hidden = true; $("#dlg").classList.remove("wide"); $("#dlgB").innerHTML = ""; }
$("#dlgX").onclick = closeDlg;
$("#dlg").addEventListener("click", e=>{ if(e.target.id === "dlg") closeDlg(); });
document.addEventListener("keydown", e=>{ if(e.key === "Escape" && !$("#dlg").hidden) closeDlg(); });

/* ================= SEVERAL WATCHLISTS ================= */
// LISTS = {active, lists:[{id, name, t:[tickers]}]}; WL always mirrors the active list
let LISTS = (()=>{ const L = store.get("tt:lists"); return L && Array.isArray(L.lists) && L.lists.length ? L : null; })();
const newId = () => "l" + Date.now().toString(36) + Math.random().toString(36).slice(2,5);
function ensureLists(){
  if(!LISTS) LISTS = {active:"l1", lists:[{id:"l1", name:"My watchlist", t: WL ? WL.slice() : []}]};
  if(!LISTS.lists.some(l=>l.id===LISTS.active)) LISTS.active = LISTS.lists[0].id;
  return LISTS;
}
const activeList = () => ensureLists().lists.find(l=>l.id===LISTS.active);
function saveLists(){ store.set("tt:lists", LISTS); push("lists", LISTS); }
function setWL(L){   // replaces the tickers of the active list
  const a = activeList(); a.t = L.slice(0, 300); WL = a.t.slice();
  store.set("tt:wl", WL); push("watchlist", WL); saveLists();
}
function switchList(id){
  ensureLists(); const l = LISTS.lists.find(x=>x.id===id); if(!l) return;
  LISTS.active = id; WL = l.t.slice(); store.set("tt:wl", WL); push("watchlist", WL); saveLists();
  scrState.limit = PAGE; updateStar(); if(needsUni()) loadUni().then(()=>renderScreener()).catch(()=>{}); renderScreener();
}
function renderWlCtl(){
  const box = $("#wlCtl"); if(!box) return; box.hidden = scrState.scope !== "watch";
  if(box.hidden) return;
  $("#wlSel").innerHTML = LISTS ? LISTS.lists.map(l=>`<option value="${esc(l.id)}" ${l.id===LISTS.active?"selected":""}>${esc(l.name==="My watchlist" ? TX("My watchlist") : l.name)} (${l.t.length})</option>`).join("")
    : `<option>${esc(TX("Sample watchlist"))}</option>`;
}
$("#wlSel").onchange = e => switchList(e.target.value);
function wlMenu(on){
  const m = $("#wlMenu"); on = on==null ? m.hidden : on; m.hidden = !on; $("#wlMenuBtn").setAttribute("aria-expanded", on);
  if(on) m.innerHTML = [["new","New list"],["rename","Rename list"],["del","Delete list"],["imp","Import tickers"],["exp","Export to CSV"],["clear","Clear this list"]]
    .map(([a,l])=>`<button data-w="${a}" role="menuitem" class="${a==="del"||a==="clear"?"danger":""}">${l}</button>`).join("");
}
$("#wlMenuBtn").onclick = e => { e.stopPropagation(); wlMenu(); };
document.addEventListener("click", e=>{ if(!$("#wlMenu").hidden && !e.target.closest("#wlMenu,#wlMenuBtn")) wlMenu(false); });
$("#wlMenu").addEventListener("click", e=>{
  const b = e.target.closest("button[data-w]"); if(!b) return; wlMenu(false); const a = b.dataset.w;
  if(a === "new" || a === "rename"){
    const cur = a === "rename" && LISTS ? activeList().name : "";
    dlg(TX(a === "new" ? "New list" : "Rename list"), `<label class="fld"><span>${esc(TX("Name"))}</span><input id="lName" maxlength="40" value="${esc(cur)}" placeholder="${esc(TX("e.g. Swing trades"))}"></label>
      <button class="btn on wide" id="lOk">${esc(TX(a === "new" ? "Create list" : "Save"))}</button>`, B=>{
      const go = ()=>{ const n = B.querySelector("#lName").value.trim().slice(0,40); if(!n){ B.querySelector("#lName").focus(); return; }
        ensureLists();
        if(a === "new"){ if(LISTS.lists.length >= 20){ toast("You can have up to 20 lists."); return; } const id = newId(); LISTS.lists.push({id, name:n, t:[]}); closeDlg(); switchList(id); toast(`List “${n}” created. Star tickers to fill it.`); }
        else { activeList().name = n; saveLists(); closeDlg(); renderWlCtl(); } };
      B.querySelector("#lOk").onclick = go; B.querySelector("#lName").onkeydown = ev=>{ if(ev.key==="Enter") go(); }; });
  }
  if(a === "del"){
    if(!LISTS || LISTS.lists.length < 2){ toast("This is your only list. Use Clear this list to empty it."); return; }
    const l = activeList();
    if(!confirm(TX(`Delete the list “${l.name}” and its ${l.t.length} tickers? This cannot be undone.`))) return;
    LISTS.lists = LISTS.lists.filter(x=>x.id!==l.id); switchList(LISTS.lists[0].id); toast("List deleted.");
  }
  if(a === "clear"){
    const n = getWL().length; if(!n){ toast("This list is already empty."); return; }
    if(!confirm(TX(`Remove all ${n} tickers from your watchlist? This cannot be undone.`))) return;
    setWL([]); updateStar(); scrState.limit = PAGE; renderScreener(); toast("Your watchlist is empty now.");
  }
  if(a === "imp") openImport();
  if(a === "exp") exportCsv();
});
function openImport(){
  dlg(TX("Import tickers"), `<p class="msub">${esc(TX("Paste symbols separated by spaces, commas or new lines, for example from TradingView or a spreadsheet. They are added to the list you have open."))}</p>
    <label class="fld"><textarea id="impT" rows="6" spellcheck="false" placeholder="NVDA, AVGO, META&#10;ANET&#10;NASDAQ:CRWD"></textarea></label>
    <button class="btn on wide" id="impOk">${esc(TX("Add to the list"))}</button>`, B=>{
    B.querySelector("#impOk").onclick = ()=>{
      const raw = B.querySelector("#impT").value.toUpperCase().split(/[\s,;|]+/).map(x=>x.replace(/^[A-Z]+:/,"").replace(/\./g,"-").trim()).filter(Boolean);
      const ok = [...new Set(raw.filter(x=>SYM_OK.test(x)))], bad = raw.length - raw.filter(x=>SYM_OK.test(x)).length;
      const L = (WL ? WL.slice() : []); let added = 0;
      for(const s of ok){ if(L.length >= 300) break; if(!L.includes(s)){ L.push(s); added++; } }
      setWL(L); closeDlg(); updateStar(); if(needsUni()) loadUni().then(()=>renderScreener()).catch(()=>{}); renderScreener();
      toast(TX(`Added ${added} tickers`) + (bad ? " · " + TX(`${bad} skipped`) : "") + ".");
    }; });
}
function exportCsv(){
  const rows = watchRows(); if(!rows.length){ toast("This list is empty."); return; }
  const q = v => { const s = v==null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s; };
  const head = ["Symbol","Name","Price","Chg %","RS Rating","EPS chg","Sales chg","Base","Pivot","To pivot %","Status","Note"];
  const lines = [head.join(",")].concat(rows.map(r=>{ const b = r.base || {}; return [r.symbol, r.name, r.close, r.chgPct!=null ? r.chgPct.toFixed(2) : "", r.rsRating, r.epsChg, r.salesChg,
    b.type, b.pivot, b.distPct, b.status, NOTES[r.symbol]].map(q).join(","); }));
  const name = (LISTS ? activeList().name : "watchlist").replace(/[^\w\- ]+/g,"").trim().replace(/\s+/g,"-") || "watchlist";
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + lines.join("\n")], {type:"text/csv"}));
  a.download = `${name}-${new Date().toISOString().slice(0,10)}.csv`; document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

/* ================= NOTES PER TICKER ================= */
let NOTES = store.get("tt:notes") || {};
function saveNotes(){ store.set("tt:notes", NOTES); push("notes", NOTES); }
function renderTkNote(){
  const p = $("#tkNote"), n = CUR && NOTES[CUR];
  p.hidden = !n; if(n) p.innerHTML = `<span>✎</span> ${esc(n)} <button class="lnk" id="tkNoteEdit">${esc(TX("Edit"))}</button>`;
  if(n) $("#tkNoteEdit").onclick = openNote;
  $("#tkNoteBtn").classList.toggle("on", !!n);
}
function openNote(){
  if(!CUR) return; const sym = CUR, cur = NOTES[sym] || "";
  dlg(`${TX("Note")} · ${sym}`, `<p class="msub">${esc(TX("A private note for this ticker. It shows on the chart and in your watchlist."))}</p>
    <label class="fld"><textarea id="nT" rows="3" maxlength="280" placeholder="${esc(TX("e.g. Wait for a move through the pivot on volume"))}">${esc(cur)}</textarea></label>
    <div class="dlgbtns"><button class="btn on" id="nOk">${esc(TX("Save"))}</button>${cur ? `<button class="btn ghost" id="nDel">${esc(TX("Delete note"))}</button>` : ""}</div>`, B=>{
    B.querySelector("#nOk").onclick = ()=>{ const v = B.querySelector("#nT").value.trim().slice(0,280); if(v) NOTES[sym] = v; else delete NOTES[sym];
      if(Object.keys(NOTES).length > 500){ toast("You can keep up to 500 notes."); return; } saveNotes(); closeDlg(); renderTkNote(); };
    const d = B.querySelector("#nDel"); if(d) d.onclick = ()=>{ delete NOTES[sym]; saveNotes(); closeDlg(); renderTkNote(); }; });
}
$("#tkNoteBtn").onclick = openNote;

/* ================= ALERTS ================= */
let ALERTS = [], VERIFIED = true;
const MA_LBL = {e21:"21-day EMA", d50:"50-day line", d200:"200-day line"};
function alertDesc(a){
  if(a.kind === "trend") return `${a.dir === "above" ? "Crosses above" : "Crosses below"} a trendline (${fmtP(a.level)} when set)`;
  if(a.kind === "ma") return `${a.dir === "above" ? "Crosses above" : "Crosses below"} the ${MA_LBL[a.ma]}`;
  if(a.kind === "pivot") return `Breakout above the ${fmtP(a.level)} pivot`;
  return `Price ${a.dir === "above" ? "above" : "below"} ${fmtP(a.level)}`;
}
async function loadAlerts(){
  if(!auth.token){ ALERTS = []; return; }
  try{ const r = await api("/alerts"); ALERTS = r.alerts || []; VERIFIED = r.verified !== false; }catch(e){}
  if(S && !$("#vChart").hidden) draw();
  $("#bAlert").classList.toggle("on", !!(CUR && ALERTS.some(a=>a.symbol===CUR && !a.fired)));
}
function chartRefs(){
  // last close and the 21-day EMA / 50- and 200-day lines of the chart on screen
  if(!S || !S.px.length) return {};
  const px = S.px, last = px[px.length-1].c, at = arr => arr[arr.length-1];
  return {last, e21: at(ema(px,21,b=>b.c)), d50: at(sma(px,50,b=>b.c)), d200: at(sma(px,200,b=>b.c)), pivot: S.base && S.base.pivot};
}
// a trendline as the server needs it: the two prices, the trading days between them, the end date and the scale
function trendRef(m){
  const px = S.px, idx = t => { let j = 0; for(let i=0;i<px.length;i++){ if(px[i].t <= t) j = i; else break; } return j; };
  const i1 = idx(m.t1), i2 = idx(m.t2); if(i2 <= i1) return null;
  const log = cfg.scale !== "linear", N = px.length - 1, k = N - i2;
  const f = log ? Math.exp(Math.log(m.p2) + (Math.log(m.p2) - Math.log(m.p1)) / (i2 - i1) * k) : m.p2 + (m.p2 - m.p1) / (i2 - i1) * k;
  if(!(f > 0)) return null;
  const d = new Date(px[i2].t).toISOString().slice(0, 10);
  return {p1: +m.p1.toPrecision(7), p2: +m.p2.toPrecision(7), nb: i2 - i1, t2: d, log, now: f};
}
function openAlert(){
  if(!S) return;
  if(!auth.token){ toast("Create a free account or sign in to set alerts."); openAuth("up"); return; }
  const sym = S.symbol, R = chartRefs(), mine = ALERTS.filter(a=>a.symbol===sym && !a.fired);
  const lines = (S.marks||[]).filter(m=>m.k==="line").map(m=>m.p).filter((v,i,a)=>a.indexOf(v)===i).slice(-6);
  const st = {kind:"price", ma:"d50", level: +R.last.toFixed(R.last < 20 ? 3 : 2), dir:null, tl:0};
  const tls = (S.marks||[]).filter(m=>m.k==="tl").map(m=>({m, r: trendRef(m)})).filter(x=>x.r).slice(-6);
  const dirFor = lv => lv >= R.last ? "above" : "below";
  const body = () => {
    const maV = R[st.ma];
    const maDir = st.dir || (R.last > maV ? "below" : "above");
    return `<div class="seg aseg">${[["price","Price"],["trend","Trendline"],["ma","Moving average"],["pivot","Pivot breakout"]].map(([k,l])=>`<button data-k="${k}" class="${st.kind===k?"on":""}" ${(k==="pivot"&&!R.pivot)||(k==="trend"&&!tls.length)?"disabled":""} ${k==="trend"&&!tls.length?`title="${esc(TX("Draw a trendline on the chart first"))}"`:""}>${esc(TX(l))}</button>`).join("")}</div>
      ${st.kind==="price" ? `<label class="fld"><span>${esc(TX("Price level"))}</span><input id="aLv" type="number" step="any" min="0" value="${st.level}"></label>
        <p class="msub ahint" id="aHint"></p>
        ${lines.length ? `<p class="msub">${esc(TX("Your lines on this chart"))}: ${lines.map(v=>`<button class="lnk aline" data-v="${v}">${fmtP(v)}</button>`).join(" · ")}</p>` : ""}`
      : st.kind==="trend" ? `<div class="seg aseg2">${tls.map((x,i)=>`<button data-tl="${i}" class="${st.tl===i?"on":""}"><i class="dsw" style="background:${x.m.c}"></i> ${esc(TX("Line"))} ${i+1} · ${fmtP(x.r.now)}</button>`).join("")}</div>
        <p class="msub">${esc(TX(`Fires when ${sym} ${R.last < tls[st.tl].r.now ? "rises above" : "falls below"} the line, which is at ${fmtP(tls[st.tl].r.now)} today and moves with it every session (now ${fmtP(R.last)}).`))}</p>`
      : st.kind==="ma" ? `<div class="seg aseg2">${Object.keys(MA_LBL).map(k=>`<button data-ma="${k}" class="${st.ma===k?"on":""}" ${R[k]==null?"disabled":""}>${esc(TX(MA_LBL[k]))}</button>`).join("")}</div>
        <div class="seg aseg2">${["above","below"].map(d=>`<button data-d="${d}" class="${maDir===d?"on":""}">${esc(TX(d==="above"?"Crosses above":"Crosses below"))}</button>`).join("")}</div>
        <p class="msub">${esc(TX("Today"))}: ${esc(TX(MA_LBL[st.ma]))} ${fmtP(maV)} · ${esc(TX("last"))} ${fmtP(R.last)}</p>`
      : `<p class="msub">${esc(TX(`Alert when ${sym} trades above its ${fmtP(R.pivot)} pivot with volume running at least 40% above average.`))}</p>`}
      <label class="fld"><span>${esc(TX("Note (optional)"))}</span><input id="aNote" maxlength="140" placeholder="${esc(TX("e.g. Buy half on the breakout"))}"></label>
      <label class="chk"><input type="checkbox" id="aMail" ${VERIFIED?"checked":"disabled"}> ${esc(TX("Email me too"))}${VERIFIED ? "" : ` <small>(${esc(TX("confirm your email first"))})</small>`}</label>
      <button class="btn on wide" id="aOk">${esc(TX("Create alert"))}</button>
      <p class="msub afine">${esc(TX("Checked every 15 minutes during the session with delayed prices. Each alert fires once."))}</p>
      ${mine.length ? `<div class="alist"><h5>${esc(TX("Active alerts for"))} ${esc(sym)}</h5>${mine.map(a=>`<div class="arow"><span>${esc(TX(alertDesc(a)))}${a.note?` <i>${esc(a.note)}</i>`:""}</span><button class="lnk" data-del="${a.id}" aria-label="${esc(TX("Delete alert"))}">×</button></div>`).join("")}</div>` : ""}`;
  };
  const bind = B => {
    B.innerHTML = body();
    const hint = () => { const h = B.querySelector("#aHint"), v = parseFloat(B.querySelector("#aLv").value); if(h) h.textContent = isFinite(v) && v>0 ? TX(`Fires when ${sym} ${dirFor(v)==="above" ? "rises to" : "falls to"} ${fmtP(v)} (now ${fmtP(R.last)}).`) : ""; };
    B.querySelectorAll(".aseg button").forEach(b=>b.onclick = ()=>{ st.kind = b.dataset.k; st.dir = null; bind(B); });
    B.querySelectorAll("[data-ma]").forEach(b=>b.onclick = ()=>{ st.ma = b.dataset.ma; st.dir = null; bind(B); });
    B.querySelectorAll("[data-d]").forEach(b=>b.onclick = ()=>{ st.dir = b.dataset.d; bind(B); });
    B.querySelectorAll("[data-tl]").forEach(b=>b.onclick = ()=>{ st.tl = +b.dataset.tl; bind(B); });
    B.querySelectorAll(".aline").forEach(b=>b.onclick = ()=>{ B.querySelector("#aLv").value = b.dataset.v; st.level = +b.dataset.v; hint(); });
    const lv = B.querySelector("#aLv"); if(lv){ lv.oninput = ()=>{ st.level = parseFloat(lv.value); hint(); }; hint(); }
    B.querySelectorAll("[data-del]").forEach(b=>b.onclick = async ()=>{ try{ await api("/alerts/"+b.dataset.del, {method:"DELETE"}); await loadAlerts(); openAlert(); }catch(e){ toast(e.message); } });
    B.querySelector("#aOk").onclick = async ()=>{
      const note = B.querySelector("#aNote").value.trim(), email = B.querySelector("#aMail").checked;
      let req;
      if(st.kind === "price"){ const v = parseFloat(B.querySelector("#aLv").value); if(!(v > 0)){ toast("Enter a valid price."); return; } req = {kind:"price", level:v, dir:dirFor(v)}; }
      else if(st.kind === "ma") req = {kind:"ma", ma:st.ma, dir: st.dir || (R.last > R[st.ma] ? "below" : "above")};
      else if(st.kind === "trend"){ const r = tls[st.tl].r; req = {kind:"trend", level: +r.now.toPrecision(7), dir: R.last < r.now ? "above" : "below", line: {p1:r.p1, p2:r.p2, nb:r.nb, t2:r.t2, log:r.log}}; }
      else req = {kind:"pivot", level:R.pivot, dir:"above"};
      const ok = B.querySelector("#aOk"); ok.disabled = true;
      try{ await api("/alerts", {method:"POST", body: JSON.stringify({symbol:sym, note: note || null, email, ...req})}); await loadAlerts(); closeDlg();
        toast(`Alert set: ${sym} · ${TX(alertDesc({...req, symbol:sym}))}`); }
      catch(e){ toast(e.message); ok.disabled = false; }
    };
  };
  dlg(`${TX("New alert")} · ${sym}`, "", bind);
}
$("#bAlert").onclick = openAlert;
function openAlertsList(){
  if(!auth.token){ openAuth("in"); return; }
  const fmtT = t => t ? fmtLong(t*1000) : "";
  const act = ALERTS.filter(a=>!a.fired), done = ALERTS.filter(a=>a.fired);
  const row = a => `<div class="arow"><a href="/chart/${esc(a.symbol)}/" class="asym">${esc(a.symbol)}</a><span>${esc(TX(alertDesc(a)))}${a.note?` <i>${esc(a.note)}</i>`:""}${a.fired?`<small>${esc(TX("Fired"))} ${fmtT(a.fired)} · ${fmtP(a.fired_px)}</small>`:""}</span><button class="lnk" data-del="${a.id}" aria-label="${esc(TX("Delete alert"))}">×</button></div>`;
  dlg(TX("My alerts"), `<div class="alist">${act.length ? act.map(row).join("") : `<p class="msub">${esc(TX("No active alerts. Open any chart and tap 🔔 Alert to set one."))}</p>`}
    ${done.length ? `<h5>${esc(TX("Fired in the last 30 days"))}</h5>${done.map(row).join("")}` : ""}</div>
    ${VERIFIED ? "" : `<p class="msub">${esc(TX("Confirm your email to also get alerts by email."))}</p>`}`, B=>{
    B.querySelectorAll("a.asym").forEach(a=>a.onclick = ()=>closeDlg());
    B.querySelectorAll("[data-del]").forEach(b=>b.onclick = async ()=>{ try{ await api("/alerts/"+b.dataset.del, {method:"DELETE"}); await loadAlerts(); openAlertsList(); }catch(e){ toast(e.message); } });
  });
}
// active price and pivot alerts drawn on the chart
function drawAlerts(g, yOf, L, plotW, pTop, pBot){
  if(!S) return;
  for(const a of ALERTS){ if(a.symbol !== S.symbol || a.fired || a.kind === "ma" || a.kind === "trend" || !a.level) continue;
    const y = Math.round(yOf(a.level)) + .5; if(y < pTop || y > pBot) continue;
    g.strokeStyle = "#a86a00"; g.lineWidth = 1; g.setLineDash([6,4]); g.beginPath(); g.moveTo(L, y); g.lineTo(L+plotW, y); g.stroke(); g.setLineDash([]);
    g.font = `600 10px ${FONT_L}`; g.fillStyle = "#a86a00"; g.textAlign = "right"; g.textBaseline = "bottom"; g.fillText(`🔔 ${fmtP(a.level)}`, L+plotW-4, y-2); }
}

/* ================= NOTIFICATIONS (bell) ================= */
let NOTIF = {items:[], unread:0}, notifSeen = +store.get("tt:notifSeen") || 0, notifTimer = null;
function notifText(n){
  let o; try{ o = JSON.parse(n.msg); }catch(e){ return n.msg; }
  const lv = fmtP(o.lv);
  const s = o.k === "trend" ? `${o.s} crossed ${o.d} your trendline (${lv})` : o.k === "ma" ? `${o.s} crossed ${o.d} its ${MA_LBL[o.ma]} (${lv})` : o.k === "pivot" ? `${o.s} broke out above its ${lv} pivot` : `${o.s} ${o.d === "above" ? "rose above" : "fell below"} ${lv}`;
  return {txt: TX(s), last: fmtP(o.px), note: o.n};
}
function renderBell(){
  const b = $("#bell"); b.hidden = !auth.token; if(b.hidden) return;
  $("#bellN").hidden = !NOTIF.unread; $("#bellN").textContent = NOTIF.unread > 9 ? "9+" : NOTIF.unread;
}
async function pollNotifs(first){
  if(!auth.token) return;
  try{ NOTIF = await api("/notifications"); }catch(e){ return; }
  const fresh = NOTIF.items.filter(n=>!n.read && n.id > notifSeen);
  if(fresh.length && !first){
    const t = notifText(fresh[0]); toast(`🔔 ${t.txt}`);
    if("Notification" in window && Notification.permission === "granted") fresh.slice(0,3).forEach(n=>{ const x = notifText(n);
      try{ const no = new Notification("Ticker&Tape", {body: `${x.txt} · ${TX("last")} ${x.last}`, tag:"tt"+n.id}); no.onclick = ()=>{ focus(); go(n.symbol); }; }catch(e){} });
    loadAlerts();
  }
  if(NOTIF.items.length){ notifSeen = Math.max(notifSeen, ...NOTIF.items.map(n=>n.id)); store.set("tt:notifSeen", notifSeen); }
  renderBell();
}
function startNotifs(){ clearInterval(notifTimer); if(!auth.token) return; pollNotifs(true); notifTimer = setInterval(()=>{ if(document.visibilityState === "visible") pollNotifs(); }, 3*60*1000); }
document.addEventListener("visibilitychange", ()=>{ if(document.visibilityState === "visible" && auth.token) pollNotifs(); });
function bellMenu(on){
  const m = $("#bellMenu"); on = on==null ? m.hidden : on; m.hidden = !on; $("#bell").setAttribute("aria-expanded", on);
  if(!on) return;
  const ago = t => { const h = (Date.now()/1000 - t)/3600; return h < 1 ? TX("now") : h < 24 ? TX(`${Math.round(h)}h ago`) : fmtLong(t*1000); };
  m.innerHTML = `<div class="who">${esc(TX("Notifications"))}</div>${NOTIF.items.length ? NOTIF.items.slice(0,15).map(n=>{ const x = notifText(n);
      return `<a class="nitem ${n.read?"":"new"}" href="/chart/${esc(n.symbol)}/"><b>${esc(x.txt)}</b><small>${esc(TX("last"))} ${x.last} · ${ago(n.created)}${x.note?` · ${esc(x.note)}`:""}</small></a>`; }).join("")
    : `<p class="nempty">${esc(TX("No notifications yet. Set an alert from any chart with 🔔 Alert."))}</p>`}
    ${"Notification" in window && Notification.permission === "default" ? `<button data-n="perm">${esc(TX("Enable browser notifications"))}</button>` : ""}
    <button data-n="list">${esc(TX("My alerts"))}</button>`;
  if(NOTIF.unread){ api("/notifications/read", {method:"POST"}).then(()=>{ NOTIF.unread = 0; NOTIF.items.forEach(n=>n.read = 1); renderBell(); }).catch(()=>{}); }
}
$("#bell").onclick = e => { e.stopPropagation(); bellMenu(); };
document.addEventListener("click", e=>{ if(!$("#bellMenu").hidden && !e.target.closest("#bellMenu,#bell")) bellMenu(false); });
$("#bellMenu").addEventListener("click", e=>{
  if(e.target.closest("a.nitem")){ bellMenu(false); return; }
  const b = e.target.closest("button[data-n]"); if(!b) return;
  if(b.dataset.n === "perm") Notification.requestPermission().then(()=>bellMenu(true));
  if(b.dataset.n === "list"){ bellMenu(false); openAlertsList(); }
});

/* ================= EMAIL VERIFICATION + DELETE ACCOUNT ================= */
async function checkMe(isNew){
  if(!auth.token) return;
  let me; try{ me = await api("/me"); }catch(e){ return; }
  VERIFIED = !!me.verified;
  const v = $("#vBar"); v.hidden = VERIFIED || sessionStorage.getItem("tt:vbarOff") === "1";
  if(!v.hidden) v.innerHTML = `<span>${esc(TX(isNew ? `Welcome! We sent a link to ${auth.email}: confirm your email to get alerts by email.` : `Confirm your email (${auth.email}) to get alerts by email.`))}</span>
    <button class="lnk" id="vResend">${esc(TX("Send the link again"))}</button><button class="x" id="vClose" aria-label="${esc(TX("Close"))}">×</button>`;
  if(!v.hidden){
    $("#vResend").onclick = async ()=>{ try{ await api("/auth/verify", {method:"POST"}); toast(`Link sent to ${auth.email}.`); }catch(e){ toast(e.message); } };
    $("#vClose").onclick = ()=>{ v.hidden = true; try{ sessionStorage.setItem("tt:vbarOff","1"); }catch(e){} };
  }
}
function openDelete(){
  dlg(TX("Delete account"), `<p class="msub">${esc(TX("This deletes your account, watchlists, notes, drawings and alerts for good. It cannot be undone."))}</p>
    <label class="fld"><span>${esc(TX("Password"))}</span><input type="password" id="dPw" autocomplete="current-password"></label>
    <button class="btn wide danger" id="dOk">${esc(TX("Delete my account"))}</button>`, B=>{
    B.querySelector("#dOk").onclick = async ()=>{ const b = B.querySelector("#dOk"); b.disabled = true;
      try{ await api("/auth/delete", {method:"POST", body: JSON.stringify({password: B.querySelector("#dPw").value})});
        closeDlg(); signedOut(); toast("Your account was deleted."); }
      catch(e){ toast(e.message); b.disabled = false; } }; });
}

/* ================= COMPOSITE RATING (from the nightly rows) ================= */
function rowOf(sym){ return ROWS.find(r=>r.symbol===sym) || (UNI && UNI.find(r=>r.symbol===sym)) || null; }

/* ================= SAVED SCREENS ================= */
const SCREENS = () => Array.isArray(cfg.screens) ? cfg.screens : [];
const SCR_ST = ["Near pivot","Breakout","In buy zone","Extended","Below pivot","Correcting","Base forming"];
function saveCfg(){ store.set("ink:cfg", cfg); push("cfg", cfg); }
function syncFilters(){ $$("#filters button").forEach(x=>x.classList.toggle("on", x.dataset.f===scrState.filter)); }
function renderScreenBtns(){
  $$("#filters button[data-u]").forEach(b=>b.remove());
  const f = $("#filters");
  SCREENS().forEach(sc=>{ const b = document.createElement("button"); b.dataset.f = "u:"+sc.id; b.dataset.u = "1"; b.className = "ubtn";
    b.textContent = sc.name; b.title = TX("Your screen · click it again to edit"); f.appendChild(b); });
  if(/^u:/.test(scrState.filter) && !SCREENS().some(s=>"u:"+s.id===scrState.filter)) scrState.filter = "all";
  syncFilters();
}
function matchScreen(r, c){
  const has = v => v !== null && v !== undefined && v !== "" && isFinite(v);
  if(has(c.rs) && (r.rsRating ?? -1) < c.rs) return false;
  if(has(c.comp) && (r.comp ?? -1) < c.comp) return false;
  if(has(c.eps) && (pnum(r.epsChg) ?? -1e9) < c.eps) return false;
  if(has(c.sales) && (pnum(r.salesChg) ?? -1e9) < c.sales) return false;
  if(has(c.offHigh) && (r.offHighPct ?? -1e9) < -Math.abs(c.offHigh)) return false;
  if(c.a50 && !((r.vs50Pct ?? -1) > 0)) return false;
  if(c.a200 && !((r.vs200Pct ?? -1) > 0)) return false;
  if(has(c.dvol) && (r.dollarVol50 || 0) < c.dvol * 1e6) return false;
  if(c.sector && r.sector !== c.sector) return false;
  if(c.smrAB && !/^[AB]/.test(r.smr || "")) return false;
  if(c.listing === "adr" && !r.adr) return false;
  if(c.listing === "us" && r.adr) return false;
  if(c.st && c.st.length && !(r.base && c.st.includes(r.base.status))) return false;
  if(has(c.pmin) || has(c.pmax)){ const d = r.base && r.base.pivot ? r.base.distPct : null; if(d == null) return false;
    if(has(c.pmin) && d < c.pmin) return false; if(has(c.pmax) && d > c.pmax) return false; }
  return true;
}
function openScreen(id){
  const cur = SCREENS().find(s=>s.id===id) || {name:"", rs:80, comp:null, eps:25, sales:null, offHigh:15, a50:true, a200:false, dvol:20, sector:"", smrAB:false, st:[], pmin:null, pmax:null};
  const secs = [...new Set(((UNI||[]).concat(ROWS)).map(r=>r.sector).filter(Boolean))].sort();
  const num = (k, lbl, ph) => `<label class="fld sm"><span>${esc(TX(lbl))}</span><input type="number" step="any" data-k="${k}" value="${cur[k]??""}" placeholder="${esc(ph||TX("any"))}"></label>`;
  dlg(TX(id ? "Edit screen" : "New screen"), `<div class="scrform">
    <label class="fld"><span>${esc(TX("Name"))}</span><input id="sName" maxlength="24" value="${esc(cur.name)}" placeholder="${esc(TX("e.g. CAN SLIM leaders"))}"></label>
    <div class="fgrid">${num("rs","RS Rating at least")}${num("comp","Composite at least")}${num("eps","EPS growth at least (%)")}${num("sales","Sales growth at least (%)")}
      ${num("offHigh","At most % off the high")}${num("dvol","Traded a day at least ($M)")}${num("pmin","To pivot from (%)","-5")}${num("pmax","To pivot up to (%)","5")}</div>
    <label class="fld"><span>${esc(TX("Listing"))}</span><select id="sList">${[["","All stocks"],["us","U.S. companies"],["adr","ADRs only"]].map(([v,l])=>`<option value="${v}" ${(cur.listing||"")===v?"selected":""}>${esc(TX(l))}</option>`).join("")}</select></label>
    <label class="fld"><span>${esc(TX("Sector"))}</span><select id="sSec"><option value="">${esc(TX("All sectors"))}</option>${secs.map(s=>`<option value="${esc(s)}" ${cur.sector===s?"selected":""}>${esc(TX(s))}</option>`).join("")}</select></label>
    <div class="chks"><label class="chk"><input type="checkbox" data-c="a50" ${cur.a50?"checked":""}> ${esc(TX("Above the 50-day line"))}</label><label class="chk"><input type="checkbox" data-c="a200" ${cur.a200?"checked":""}> ${esc(TX("Above the 200-day line"))}</label>
      <label class="chk"><input type="checkbox" data-c="smrAB" ${cur.smrAB?"checked":""}> ${esc(TX("SMR A or B"))}</label></div>
    <p class="msub">${esc(TX("Base status (none checked = any)"))}</p>
    <div class="chks">${SCR_ST.map(s=>`<label class="chk"><input type="checkbox" data-st="${esc(s)}" ${(cur.st||[]).includes(s)?"checked":""}> ${esc(TX(s))}</label>`).join("")}</div>
    <p class="msub" id="sPrev"></p>
    <div class="dlgbtns"><button class="btn on" id="sOk">${esc(TX("Save screen"))}</button>${id?`<button class="btn ghost" id="sDel">${esc(TX("Delete screen"))}</button>`:""}</div></div>`, B=>{
    const read = () => { const c = {id: id || "s"+Date.now().toString(36), name: B.querySelector("#sName").value.trim().slice(0,24)};
      B.querySelectorAll("[data-k]").forEach(i=>{ c[i.dataset.k] = i.value === "" ? null : +i.value; });
      B.querySelectorAll("[data-c]").forEach(i=>{ c[i.dataset.c] = i.checked; });
      c.sector = B.querySelector("#sSec").value; c.listing = B.querySelector("#sList").value; c.st = [...B.querySelectorAll("[data-st]:checked")].map(i=>i.dataset.st); return c; };
    const prev = () => { const c = read(), pool = (UNI ? UNI.filter(r=>!r.etf) : ROWS); B.querySelector("#sPrev").textContent = TX(`${pool.filter(r=>matchScreen(r,c)).length} of ${pool.length} stocks pass today`); };
    B.querySelectorAll("input,select").forEach(i=>i.addEventListener("input", prev)); prev();
    B.querySelector("#sOk").onclick = () => { const c = read(); if(!c.name){ B.querySelector("#sName").focus(); return; }
      const L = SCREENS().filter(s=>s.id!==c.id); if(L.length >= 12){ toast("You can save up to 12 screens."); return; }
      const i = SCREENS().findIndex(s=>s.id===c.id); cfg.screens = SCREENS().slice(); if(i >= 0) cfg.screens[i] = c; else cfg.screens.push(c);
      saveCfg(); closeDlg(); scrState.filter = "u:"+c.id; store.set("ink:filter", scrState.filter); scrState.limit = PAGE; renderScreenBtns(); renderScreener(); };
    const d = B.querySelector("#sDel"); if(d) d.onclick = () => { cfg.screens = SCREENS().filter(s=>s.id!==id); saveCfg(); closeDlg(); scrState.filter = "all"; store.set("ink:filter","all"); renderScreenBtns(); renderScreener(); };
  });
  if(!UNI) loadUni().catch(()=>{});
}
$("#bScreen").onclick = () => openScreen(null);
$("#filters").addEventListener("click", e=>{
  const b = e.target.closest("button[data-f]"); if(!b) return;
  if(b.dataset.u && scrState.filter === b.dataset.f){ openScreen(b.dataset.f.slice(2)); return; }
  scrState.filter = b.dataset.f; store.set("ink:filter", scrState.filter); scrState.limit = PAGE; syncFilters(); renderScreener();
});

/* ================= COLUMNS ================= */
function colList(){ return $$("#scr thead th").map((th,i)=>({i:i+1, k: th.dataset.k || (th.classList.contains("spk") ? "spark" : "c"+i), label: th.textContent.replace(/[▾▴]/g,"").trim()})); }
function applyCols(){
  const hid = new Set(cfg.cols || []);
  const sel = colList().filter(c=>hid.has(c.k) && c.k !== "symbol").map(c=>`#scr th:nth-child(${c.i}),#scr td:nth-child(${c.i})`).join(",");
  $("#colcss").textContent = sel ? `@media (min-width:641px){${sel}{display:none}}` : "";
  fitTable();
}
function colMenu(on){
  const m = $("#colMenu"); on = on==null ? m.hidden : on; m.hidden = !on; $("#bCols").setAttribute("aria-expanded", on);
  if(!on) return; const hid = new Set(cfg.cols || []);
  m.innerHTML = `<div class="who">${esc(TX("Columns"))}</div>` + colList().filter(c=>c.k!=="symbol").map(c=>`<label class="chk"><input type="checkbox" data-col="${esc(c.k)}" ${hid.has(c.k)?"":"checked"}> ${esc(c.label || "—")}</label>`).join("")
    + `<button data-reset="1">${esc(TX("Show all columns"))}</button>`;
}
$("#bCols").onclick = e => { e.stopPropagation(); colMenu(); };
document.addEventListener("click", e=>{ if(!$("#colMenu").hidden && !e.target.closest("#colMenu,#bCols")) colMenu(false); });
$("#colMenu").addEventListener("change", e=>{ const i = e.target.closest("[data-col]"); if(!i) return;
  const hid = new Set(cfg.cols || []); i.checked ? hid.delete(i.dataset.col) : hid.add(i.dataset.col); cfg.cols = [...hid]; saveCfg(); applyCols(); });
$("#colMenu").addEventListener("click", e=>{ if(e.target.closest("[data-reset]")){ cfg.cols = []; saveCfg(); applyCols(); colMenu(true); } });

/* ================= INDUSTRY GROUPS ================= */
let GROUPS = null, groupsLoading = null, gSort = {k:"rank", asc:true}, gShow = "all";
function loadGroups(){ if(!groupsLoading) groupsLoading = getJSON("groups.json").then(d=>{ GROUPS = d; }).catch(()=>{ GROUPS = {groups:[], total:0}; }); return groupsLoading; }
function renderGroups(){
  if(!GROUPS){ $("#gTbl").innerHTML = `<div class="empty">Loading…</div>`; loadGroups().then(()=>{ if(!$("#vGroups").hidden) renderGroups(); }); return; }
  const G = GROUPS.groups || [], T = GROUPS.total || G.length;
  if(!G.length){ $("#gTbl").innerHTML = `<div class="empty">The group ranking appears after the next nightly update.</div>`; $("#gStats").innerHTML = ""; return; }
  const sel = $("#gSector"), secs = [...new Set(G.map(g=>g.sector).filter(Boolean))].sort(), cur = store.get("tt:gSec") || "";
  sel.innerHTML = `<option value="">${esc(TX("All sectors"))}</option>` + secs.map(s=>`<option value="${esc(s)}" ${s===cur?"selected":""}>${esc(TX(s))}</option>`).join("");
  $$("#gShow button").forEach(b=>b.classList.toggle("on", b.dataset.n===gShow));
  const d6 = g => g.r6w ? g.r6w - g.rank : null;
  const best = G[0], climb = G.filter(g=>d6(g)!=null).sort((a,b)=>d6(b)-d6(a))[0];
  const strongSec = Object.entries(G.slice(0, Math.max(10, Math.round(T/5))).reduce((m,g)=>(m[g.sector]=(m[g.sector]||0)+1, m), {})).sort((a,b)=>b[1]-a[1])[0];
  $("#gStats").innerHTML = `<div><b>${T}</b><span>${esc(TX("groups ranked"))}</span></div><div class="wide2"><b class="gname">${esc(best.name)}</b><span>${esc(TX("strongest group"))}</span></div>`
    + (climb ? `<div class="wide2"><b class="gname">${esc(climb.name)}</b><span>${esc(TX("biggest climber, 6 weeks"))} (+${d6(climb)})</span></div>` : "")
    + (strongSec ? `<div><b class="gname">${esc(TX(strongSec[0]))}</b><span>${esc(TX("leading sector"))}</span></div>` : "");
  let L = G.filter(g=>!cur || g.sector===cur);
  if(gShow === "top") L = L.filter(g=>g.rank <= 40);
  if(gShow === "up") L = L.filter(g=>(d6(g)||0) >= 10);
  const k = gSort.k, dir = gSort.asc ? 1 : -1, val = g => k === "d6" ? d6(g) : g[k];
  L = L.slice().sort((a,b)=>{ const x = val(a), y = val(b); if(x==null) return 1; if(y==null) return -1; return (typeof x === "string" ? x.localeCompare(y) : x - y) * dir; });
  const arrow = (prev, now) => { if(!prev) return `<span class="gd">—</span>`; const d = prev - now; return d === 0 ? `<span class="gd">=</span>` : `<span class="gd ${d>0?"up":"dn"}">${d>0?"▲":"▼"}${Math.abs(d)}</span>`; };
  const pc = (v, sc) => `<td style="${heat(v, sc)}" class="${(v??0)<0?'neg':''}">${fmtPct(v,1)}</td>`;
  const th = (key, lbl, cls="") => `<th data-gk="${key}" class="${cls} ${gSort.k===key?'sorted'+(gSort.asc?' asc':''):''}">${lbl}</th>`;
  $("#gTbl").innerHTML = `<table class="scr gtbl"><thead><tr>${th("rank","Rank")}${th("d6","6 wks")}<th class="nosort">1 wk</th><th class="nosort">3 wks</th>${th("name","Group","l")}${th("n","Stocks")}${th("chg1w","1W")}${th("chg1m","1M")}${th("chg3m","3M")}${th("ytd","YTD")}${th("above50","&gt; 50-day")}<th class="l nosort">Leaders · RS</th></tr></thead><tbody>
    ${L.map(g=>`<tr data-g="${esc(g.name)}" tabindex="0"><td class="big"><b>${g.rank}</b></td><td>${arrow(g.r6w, g.rank)}</td><td>${arrow(g.r1w, g.rank)}</td><td>${arrow(g.r3w, g.rank)}</td>
      <td class="l"><span class="sym">${esc(g.name)}</span><span class="nm">${esc(TX(g.sector))}</span></td><td>${g.n}</td>${pc(g.chg1w,4)}${pc(g.chg1m,8)}${pc(g.chg3m,16)}${pc(g.ytd,30)}
      <td><span class="gbar"><i style="width:${g.above50??0}%"></i></span>${g.above50==null?"—":g.above50+"%"}</td>
      <td class="l">${(g.leaders||[]).map(([s,rs])=>`<a class="glead" href="/chart/${esc(s)}/">${esc(s)} <b>${rs??"—"}</b></a>`).join("")}</td></tr>`).join("")}</tbody></table>`;
  $("#gCount").textContent = `${L.length} ${TX("of")} ${T} · ${GROUPS.date ? fmtLong(iso(GROUPS.date)) : ""}`;
  $$("#gTbl th[data-gk]").forEach(t=>t.onclick = ()=>{ const k = t.dataset.gk; gSort = {k, asc: gSort.k===k ? !gSort.asc : ["rank","name"].includes(k)}; renderGroups(); });
  $$("#gTbl tr[data-g]").forEach(tr=>tr.onclick = e=>{ if(e.target.closest("a")) return; scrState.industry = tr.dataset.g; scrState.sector = null; scrState.filter = "all"; syncFilters();
    if(here() === "#screener") setScope("all"); else go("screener"); });
}
$("#gSector").onchange = e => { store.set("tt:gSec", e.target.value); renderGroups(); };
$$("#gShow button").forEach(b=>b.onclick = ()=>{ gShow = b.dataset.n; renderGroups(); });

/* ================= CHART WALL ================= */
const WALL = {n:24, range: +store.get("tt:wRange") || 126, syms:[], title:"", from:""};
const bundles = new Map();
function getBundle(sym){
  if(!bundles.has(sym)) bundles.set(sym, getJSON(`t/${encodeURIComponent(sym.replace(/=/g,"_"))}.json`).catch(()=>null));
  if(bundles.size > 150) bundles.delete(bundles.keys().next().value);
  return bundles.get(sym);
}
function openWall(syms, title){ WALL.syms = syms.slice(0, 300); WALL.title = title; WALL.from = here(); WALL.n = 24; go("wall"); }
$("#bWall").onclick = () => { if(!order.length){ toast("This list is empty."); return; }
  const t = scrState.scope === "watch" ? (LISTS ? activeList().name : "Watchlist") : scrState.scope === "etf" ? "ETFs" : "Screener";
  openWall(order, t === "My watchlist" ? TX(t) : t); };
$("#iWall").onclick = () => { const L = (IDEAS && IDEAS.ideas || []).filter(i=>ideaFilter==="all" || i.status===ideaFilter).map(i=>i.symbol); if(!L.length) return; openWall(L, TX("Trade ideas")); };
$("#wBack").onclick = () => { go(WALL.from && WALL.from !== "#wall" ? WALL.from : "watchlist"); };
$$("#wRange button").forEach(b=>b.onclick = ()=>{ WALL.range = +b.dataset.r; store.set("tt:wRange", WALL.range); renderWall(); });
$("#wMoreBtn").onclick = () => { WALL.n += 24; renderWall(); };
let wallIO = null;
function renderWall(){
  if(!WALL.syms.length){ WALL.syms = getWL().slice(); WALL.title = TX("Watchlist"); }
  if(!UNI){ loadUni().then(()=>{ if(!$("#vWall").hidden) renderWall(); }).catch(()=>{}); }
  order = WALL.syms.slice();
  $("#wTitle").textContent = `${TX("Chart wall")} · ${WALL.title}`;
  $$("#wRange button").forEach(b=>b.classList.toggle("on", +b.dataset.r === WALL.range));
  const show = WALL.syms.slice(0, WALL.n);
  $("#wCount").textContent = TX(`${show.length} of ${WALL.syms.length} charts`);
  $("#wMore").hidden = WALL.syms.length <= WALL.n;
  $("#wGrid").innerHTML = show.map(s=>{ const r = rowOf(s) || {symbol:s}, b = r.base || {}, stc = STATUS_CLASS[b.status] || "";
    return `<article class="wtile" data-s="${esc(s)}" tabindex="0"><header><span class="sym">${esc(s)}</span><span class="nm">${esc(r.name||"")}</span><span class="sp"></span>
      ${r.rsRating!=null?`<span class="rsv ${r.rsRating>=80?'hot':''}" title="RS Rating">RS ${r.rsRating}</span>`:""}${r.comp!=null?`<span class="cmp" title="Composite Rating">Comp ${r.comp}</span>`:""}</header>
      <div class="wq"><b>${fmtP(r.close)}</b> <span class="${(r.chgPct??0)<0?'neg':''}">${fmtPct(r.chgPct,2)}</span>${b.status?` <span class="chip ${stc}">${esc(b.status)}</span>`:""}${NOTES[s]?` <span class="wnote" title="${esc(NOTES[s])}">✎ ${esc(NOTES[s])}</span>`:""}</div>
      <canvas class="wcv"></canvas></article>`; }).join("") || `<div class="empty">${esc(TX("This list is empty."))}</div>`;
  $$("#wGrid .wtile").forEach(t=>t.onclick = ()=>{ go(t.dataset.s); });
  if(wallIO) wallIO.disconnect();
  wallIO = new IntersectionObserver(es=>es.forEach(en=>{ if(!en.isIntersecting) return; wallIO.unobserve(en.target); const t = en.target;
    getBundle(t.dataset.s).then(bd=>{ if(bd) drawMini(t.querySelector("canvas"), bd); else t.querySelector("canvas").replaceWith(Object.assign(document.createElement("div"), {className:"empty", textContent: TX("Loads after the next nightly update")})); }); }), {rootMargin:"300px"});
  $$("#wGrid .wtile").forEach(t=>wallIO.observe(t));
}
function drawMini(cv, bd){
  const dpr = devicePixelRatio || 1, W = cv.clientWidth || 300, H = cv.clientHeight || 200;
  cv.width = W*dpr; cv.height = H*dpr; const g = cv.getContext("2d"); g.setTransform(dpr,0,0,dpr,0,0);
  const px = bd.prices.map(([d,o,h,l,c,v])=>({t:iso(d),h,l,c,v})); if(px.length < 10) return;
  const m50 = sma(px,50,b=>b.c), m200 = sma(px,200,b=>b.c);
  const s0 = Math.max(0, px.length - WALL.range), P = px.slice(s0), n = P.length, R = 40, pH = Math.round(H*0.76), vT = pH + 3;
  const piv = bd.base && bd.base.pivot;
  let lo = Math.min(...P.map(b=>b.l)), hi = Math.max(...P.map(b=>b.h)); if(piv && piv < hi*1.25 && piv > lo*0.8){ hi = Math.max(hi, piv); lo = Math.min(lo, piv); }
  const pad = (hi-lo)*0.05, y = v => 3 + (hi+pad - v)/((hi-lo)+2*pad) * (pH-6), x = i => 2 + (i+.5)/n*(W-R-4), bw = (W-R-4)/n;
  g.strokeStyle = C.grid; g.setLineDash([1,3]); g.lineWidth = 1; g.fillStyle = C.ink2; g.font = `10px ${FONT_D}`; g.textBaseline = "middle";
  linTicks(lo, hi, pH).filter((_,i,a)=>a.length < 5 || i % 2 === 0).forEach(v=>{ const yy = Math.round(y(v))+.5; g.beginPath(); g.moveTo(0,yy); g.lineTo(W-R,yy); g.stroke(); g.fillText(fmtP(v), W-R+3, yy); });
  g.setLineDash([]);
  if(piv){ g.strokeStyle = C.piv; g.setLineDash([4,3]); g.beginPath(); g.moveTo(0, Math.round(y(piv))+.5); g.lineTo(W-R, Math.round(y(piv))+.5); g.stroke(); g.setLineDash([]); }
  const line = (arr, col) => { g.strokeStyle = col; g.lineWidth = 1.2; g.beginPath(); let on = false; for(let i=0;i<n;i++){ const v = arr[s0+i]; if(v==null){ on = false; continue; } on ? g.lineTo(x(i),y(v)) : g.moveTo(x(i),y(v)); on = true; } g.stroke(); };
  g.save(); g.beginPath(); g.rect(0, 0, W-R, pH); g.clip();
  line(m200, maCol(MAS.find(m=>m.k==="d200"))); line(m50, maCol(MAS.find(m=>m.k==="d50")));
  const tk = Math.max(1, Math.min(3, bw*0.45)); g.lineWidth = bw > 3 ? 1.3 : 1;
  P.forEach((b,i)=>{ const pc = s0+i>0 ? px[s0+i-1].c : b.c; g.strokeStyle = b.c >= pc ? C.up : C.down; const xx = Math.round(x(i))+.5;
    g.beginPath(); g.moveTo(xx, y(b.h)); g.lineTo(xx, y(b.l)); g.moveTo(xx, y(b.c)); g.lineTo(xx+tk, y(b.c)); g.stroke(); });
  g.restore();
  const vm = Math.max(...P.map(b=>b.v||0)) || 1, vh = H - vT - 2;
  P.forEach((b,i)=>{ const pc = s0+i>0 ? px[s0+i-1].c : b.c; g.fillStyle = b.c >= pc ? C.vup : C.vdown; const h = (b.v||0)/vm*vh; g.fillRect(Math.round(x(i)-bw*0.3), vT+vh-h, Math.max(1, bw*0.6), h); });
  g.strokeStyle = C.ink; g.lineWidth = 1; g.strokeRect(.5,.5,W-R,pH); g.strokeRect(.5,vT+.5,W-R,vh);
}
let wallResize = 0; addEventListener("resize", ()=>{ clearTimeout(wallResize); wallResize = setTimeout(()=>{ if(!$("#vWall").hidden) $$("#wGrid .wtile").forEach(t=>{ const c = t.querySelector("canvas"); if(c) getBundle(t.dataset.s).then(bd=>bd && drawMini(c, bd)); }); }, 150); });

/* ================= COMPARATIVE CHARTS ================= */
// Several tickers stacked on one timeline (StockCharts style) or on one performance chart.
// "A:B" charts the ratio of two tickers. Settings live in cfg.cmp, so they follow the account.
const CMP_PAL = ["#15171c","#1f3c6e","#2f6b2f","#8a5a00","#0f7c86","#6b3f99","#a0306a","#5a5d66"];
const CMP_MA_PAL = ["#d23a2a","#e07b1f","#1d3fc4","#5fa35a"];
const CMP_SYM = /^[A-Z0-9.\-^=]{1,15}(:[A-Z0-9.\-^=]{1,15})?$/;
const CMP_MAX = 8, CMP_MAX_IND = 4;
const CMP_RANGES = {63:"3M", 126:"6M", 252:"1Y", 504:"2Y", 756:"3Y"};
const CMP_PRESETS = [
  {name:"Market breadth", hint:"cap weight, equal weight and the Magnificent Seven", s:["SPY","RSP","MAGS"]},
  {name:"Size", hint:"large, mid and small caps", s:["SPY","QQQ","MDY","IWM"]},
  {name:"Equal vs cap weight", hint:"ratios: rising = the average stock leads", s:["RSP:SPY","QQQE:QQQ"]},
  {name:"Risk appetite", hint:"ratios: rising = risk on", s:["XLY:XLP","SPHB:SPLV","HYG:IEF"]},
  {name:"Growth vs value", hint:"Russell 1000 growth and value", s:["IWF","IWD","IWF:IWD"]},
  {name:"Cross-asset", hint:"stocks, bonds, gold and the dollar", s:["SPY","TLT","GLD","UUP"]},
  {name:"Semis leadership", hint:"ratios: rising = chips lead the market", s:["SMH","SMH:SPY","SOXX:QQQ"]},
  {name:"Small vs large", hint:"ratios: rising = small caps lead", s:["IWM:SPY","IWM:QQQ"]},
  {name:"Offense vs defense", hint:"ratios: rising = growth sectors over utilities and staples", s:["XLK:XLU","XLF:XLU","XLY:XLP"]},
  {name:"Credit", hint:"ratios: rising = investors take credit risk", s:["HYG:LQD","HYG:IEF"]},
  {name:"Global growth", hint:"copper over gold and emerging markets over the U.S.", s:["HG=F:GC=F","EEM:SPY"]},
  {name:"Gold and miners", hint:"ratios: miners vs gold, gold vs stocks", s:["GDX:GLD","GLD:SPY"]},
  {name:"Inflation", hint:"ratios: rising = inflation expectations up", s:["TIP:IEF","DBC:SPY"]},
  {name:"Cyclicals", hint:"energy, homebuilders and regional banks", s:["XLE:SPY","XHB:SPY","KRE:XLF"]},
  {name:"Momentum", hint:"ratios: rising = momentum and high beta lead", s:["MTUM:SPY","SPHB:SPLV"]},
  {name:"International", hint:"developed, Brazil and Argentina against their benchmarks", s:["EFA:SPY","EWZ:EEM","ARGT:SPY"]},
  {name:"Crypto", hint:"Bitcoin against stocks", s:["IBIT","IBIT:SPY"]}];
const CMP_PRE_SHOW = 6;
let cmpPreAll = false, cmpAnchor = null;   // anchor: the day the Performance % view starts from (null = start of the range)
const CMP_DEF = {items:[{s:"SPY",c:CMP_PAL[0]},{s:"RSP",c:CMP_PAL[1]},{s:"MAGS",c:CMP_PAL[2]}], ind:[{t:"sma",n:50,c:CMP_MA_PAL[0]}]};
function normCmp(c){
  c = c && typeof c === "object" ? c : {};
  const normMas = a => a.filter(m=>m && (m.t==="sma" || m.t==="ema") && m.n>=2 && m.n<=400).slice(0, CMP_MAX_IND)
    .map((m,i)=>({t:m.t, n:Math.round(m.n), c: HEX.test(m.c||"") ? m.c : CMP_MA_PAL[i % CMP_MA_PAL.length]}));
  const items = Array.isArray(c.items) ? c.items.filter(x=>x && CMP_SYM.test(x.s||"")).slice(0, CMP_MAX).map((x,i)=>{
    const o = {s:x.s, c: HEX.test(x.c||"") ? x.c : CMP_PAL[i % CMP_PAL.length]};
    if(Array.isArray(x.ind)) o.ind = normMas(x.ind);   // its own moving averages (an empty list = none); missing = the default ones
    if(x.vol && !x.s.includes(":")) o.vol = true;      // volume under the price (tickers only)
    return o; }) : null;
  const ind = Array.isArray(c.ind) ? normMas(c.ind) : null;
  return {items: items || CMP_DEF.items.map(x=>({...x})), ind: ind || CMP_DEF.ind.map(m=>({...m})),
    range: CMP_RANGES[c.range] ? +c.range : 252, mode: c.mode === "perf" ? "perf" : "panels", style: c.style === "line" ? "line" : "bars",
    color: c.color === "ud" ? "ud" : "sym", scale: c.scale === "linear" ? "linear" : c.scale === "log" ? "log" : (cfg.scale === "linear" ? "linear" : "log")};
}
let CMP = normCmp(cfg.cmp), CM = null, cmpTok = 0, cmpHover = -1, cmpY = -1;
function saveCmp(){ cfg.cmp = JSON.parse(JSON.stringify(CMP)); saveCfg(); }
const cmpNextColor = () => CMP_PAL.find(c=>!CMP.items.some(x=>x.c===c)) || CMP_PAL[CMP.items.length % CMP_PAL.length];
const maLabel = m => `${m.t.toUpperCase()}(${m.n})`;
const itemInd = it => Array.isArray(it.ind) ? it.ind : CMP.ind;
function cmpPx(bd, sym){
  const px = bd.prices.map(([d,o,h,l,c,v])=>({t:iso(d),o,h,l,c,v}));
  const q = LIVE && LIVE.q[sym];   // delayed intraday price for today's bar
  if(q && px.length){ const t = iso(LIVE.date), last = px[px.length-1], bar = {t, o:q[0], h:q[1], l:q[2], c:q[3], v:q[4]||0};
    if(t > last.t) px.push(bar); else if(t === last.t) px[px.length-1] = bar; }
  return px;
}

function renderCmpCtl(){
  $("#cChips").innerHTML = CMP.items.map((it,i)=>{ const ratio = it.s.includes(":");
    return `<span class="cchip" style="--c:${it.c}"><input type="color" class="swatch" data-ccol="${i}" value="${it.c}" title="Color" aria-label="${esc(it.s)} color">`
      + (ratio ? `<b>${esc(it.s)}</b>` : `<a href="/chart/${esc(it.s)}/" title="Open chart">${esc(it.s)}</a>`)
      + `<button class="cgear ${Array.isArray(it.ind) || it.vol ? "on" : ""}" data-cset="${i}" title="${esc(TX("Moving averages and volume for this chart"))}" aria-label="${esc(TX("Settings for"))} ${esc(it.s)}">⚙</button>`
      + `<button class="cmv" data-cmv="${i}" title="Move up" aria-label="Move ${esc(it.s)} up" ${i?"":"disabled"}>↑</button><button class="cx" data-cdel="${i}" title="Remove" aria-label="Remove ${esc(it.s)}">×</button></span>`; }).join("")
    || `<span class="fine">${esc(TX("Add a ticker to start comparing."))}</span>`;
  $("#cInd").innerHTML = CMP.ind.map((m,i)=>`<span class="cma" style="--c:${m.c}">
      <select data-it="${i}" aria-label="Type"><option value="sma" ${m.t==="sma"?"selected":""}>SMA</option><option value="ema" ${m.t==="ema"?"selected":""}>EMA</option></select>
      <input type="number" min="2" max="400" step="1" data-in="${i}" value="${m.n}" aria-label="Length (days)">
      <input type="color" class="swatch" data-ic="${i}" value="${m.c}" title="Color" aria-label="Color"><button class="cx" data-idel="${i}" title="Remove" aria-label="Remove">×</button></span>`).join("")
    + (CMP.ind.length < CMP_MAX_IND ? `<button class="btn sm" id="cIndAdd">＋ ${esc(TX("Add moving average"))}</button>` : "");
  $$("#cMode button").forEach(b=>b.classList.toggle("on", b.dataset.m === CMP.mode));
  $$("#cRange button").forEach(b=>b.classList.toggle("on", +b.dataset.r === CMP.range));
  $$("#cScale button").forEach(b=>b.classList.toggle("on", b.dataset.s === CMP.scale));
  $$("#cStyle button").forEach(b=>b.classList.toggle("on", b.dataset.s === CMP.style));
  $$("#cColor button").forEach(b=>b.classList.toggle("on", b.dataset.c === CMP.color));
  const perf = CMP.mode === "perf";
  ["#cScale","#cStyle","#cColor"].forEach(s=>$(s).hidden = perf);
  $("#cIndRow").classList.toggle("off", perf);
  $("#cIndNote").hidden = !perf;
  $("#cAnchor").hidden = !perf; $("#cAnchor").innerHTML = cmpAnchor != null ? `${esc(TX("Starting at zero from"))} <b>${esc(fmtLong(cmpAnchor))}</b> <button class="lnk" id="cAnchorX">${esc(TX("Back to the start of the range"))}</button>` : esc(TX("Click a day on the chart to start every line at zero from there."));
  $("#cPre").closest(".ihead").classList.toggle("preall", cmpPreAll);
  $("#cPre").innerHTML = CMP_PRESETS.slice(0, cmpPreAll ? CMP_PRESETS.length : CMP_PRE_SHOW).map((p,i)=>`<button class="cpre" data-pre="${i}"><b>${esc(TX(p.name))}</b><span>${esc(p.s.map(x=>x.replace(/=F/g,"")).join(" · "))}</span><small>${esc(TX(p.hint))}</small></button>`).join("")
    + `<button class="cpremore" id="cPreMore">${esc(TX(cmpPreAll ? "Show fewer presets" : `Show all ${CMP_PRESETS.length} presets`))}</button>`;
  $("#cTitle").textContent = CMP.items.length ? CMP.items.map(x=>x.s).join(" · ") : TX("Comparative charts");
}

async function renderCmp(){
  renderCmpCtl();
  const tok = ++cmpTok;
  if(!CM) drawCmp();
  if(!UNI) loadUni().then(()=>{ if(!$("#vCmp").hidden) renderCmpTable(); }).catch(()=>{});
  const rows = await Promise.all(CMP.items.map(async it=>{
    const [a, b] = it.s.split(":"), [A, B] = await Promise.all([getBundle(a), b ? getBundle(b) : null]);
    let px = A ? cmpPx(A, a) : null;
    if(b){ if(px && B){ const m = new Map(cmpPx(B, b).map(x=>[x.t, x.c]));
        px = px.filter(x=>m.get(x.t)).map(x=>{ const c = x.c / m.get(x.t); return {t:x.t, o:c, h:c, l:c, c}; }); } else px = null; }
    if(px && !px.length) px = null;
    return {s:it.s, color:it.c, ratio:!!b, a, b, px, name: b ? `${a} ÷ ${b}` : ((rowOf(a)||{}).name || (A && A.name) || ""),
      missing: px ? [] : [a, b].filter((s,i)=>s && !(i ? B : A))};
  }));
  if(tok !== cmpTok) return;
  const all = new Set(); rows.forEach(r=>r.px && r.px.forEach(b=>all.add(b.t)));
  const D = [...all].sort((p,q)=>p-q), pos = new Map(D.map((t,i)=>[t,i]));
  rows.forEach(r=>{ if(!r.px) return;
    r.px.forEach((b,j)=>{ b.pc = j ? r.px[j-1].c : b.c; });
    r.bars = new Array(D.length).fill(null); r.px.forEach(b=>{ r.bars[pos.get(b.t)] = b; });
    const it = CMP.items.find(x=>x.s === r.s) || {};
    const calc = m => { const v = m.t === "ema" ? ema(r.px, m.n, b=>b.c) : sma(r.px, m.n, b=>b.c), out = new Array(D.length).fill(null);
      r.px.forEach((b,j)=>{ out[pos.get(b.t)] = v[j]; }); return out; };
    r.ind = itemInd(it); r.mas = r.ind.map(calc); r.gmas = CMP.ind.map(calc);
    r.vol = !!it.vol && !r.ratio;
    if(r.vol){ r.v = new Array(D.length).fill(null); r.px.forEach(b=>{ r.v[pos.get(b.t)] = b.v; }); const va = sma(r.px, 50, b=>b.v); r.vavg = new Array(D.length).fill(null); r.px.forEach((b,j)=>{ r.vavg[pos.get(b.t)] = va[j]; }); } });
  CM = {D, rows}; cmpHover = -1;
  const last = D.length ? D[D.length-1] : null;
  $("#cAsOf").textContent = last ? TX("as of") + " " + fmtLong(last) + (LIVE && iso(LIVE.date) === last ? ` · ${TX("live")} ${liveTime()} ET` : "") : "";
  drawCmp(); renderCmpTable();
}

function cmpWindow(){
  const D = CM.D, n = Math.min(CMP.range, D.length);
  return {n, s0: D.length - n};
}
function lastIdx(arr, s0, upto){ for(let i=upto; i>=s0; i--) if(arr[i]!=null) return i; return -1; }

function drawCmp(){
  const c = $("#ccv"); if(!c || $("#vCmp").hidden) return;
  const W = c.clientWidth; if(!W) return;
  const narrow = W < 600, dpr = devicePixelRatio || 1, perf = CMP.mode === "perf";
  const rows = CM ? CM.rows : [], k = rows.length;
  const Lm = 4, R = narrow ? 58 : 70, T0 = 4, B = 22, gap = 6;
  const nP = perf ? 1 : Math.max(1, k);
  const pH = perf ? (narrow ? 380 : 560) : narrow ? 200 : k <= 1 ? 460 : k === 2 ? 330 : k === 3 ? 270 : k === 4 ? 230 : 200;
  const H = T0 + nP*pH + (nP-1)*gap + B;
  c.style.height = H + "px"; c.width = Math.round(W*dpr); c.height = Math.round(H*dpr);
  const g = c.getContext("2d"); g.setTransform(dpr,0,0,dpr,0,0); g.fillStyle = C.plate; g.fillRect(0,0,W,H);
  const say = (t, yy=18) => { g.fillStyle = C.ink2; g.font = `14px ${FONT_L}`; g.textAlign = "left"; g.textBaseline = "top"; g.fillText(t, 14, yy); };
  c._cx = null;
  if(!CM){ say(TX("Loading…")); return; }
  if(!k){ say(TX("Add a ticker to start comparing.")); return; }
  if(!CM.D.length){ say(TX("No data for these tickers yet.")); return; }
  const D = CM.D, {n, s0} = cmpWindow(), plotW = W - Lm - R, bw = plotW / n, x = i => Lm + (i + .5) * bw;
  const hv = cmpHover >= 0 && cmpHover < n ? cmpHover : -1, at = s0 + (hv >= 0 ? hv : n - 1);
  const dash = GRID_DASH[cfg.grid];
  const P = []; for(let p=0; p<nP; p++) P.push({top: T0 + p*(pH + gap), h: pH});
  g.lineWidth = 1;

  // month grid and labels
  const monthPx = plotW / (n / 21), mStep = monthPx >= 40 ? 1 : monthPx*3 >= 40 ? 3 : 6;
  g.font = `11px ${FONT_D}`; g.textAlign = "center"; g.textBaseline = "alphabetic";
  let lastM = -1;
  for(let i=0;i<n;i++){ const dt = new Date(D[s0+i]), m = dt.getUTCMonth();
    if(m !== lastM && i > 0 && m % mStep === 0){ const xx = Math.round(x(i)) + .5;
      if(dash){ g.strokeStyle = C.grid; g.setLineDash(dash); P.forEach(p=>{ g.beginPath(); g.moveTo(xx, p.top); g.lineTo(xx, p.top + p.h); g.stroke(); }); g.setLineDash([]); }
      g.fillStyle = m === 0 ? C.ink : C.ink2; g.fillText(m === 0 ? String(dt.getUTCFullYear()) : MON[m], xx, H - 6); }
    lastM = m; }

  const tickFmt = ticks => { let st = Infinity; for(let i=1;i<ticks.length;i++) st = Math.min(st, Math.abs(ticks[i]-ticks[i-1]));
    if(!isFinite(st)) st = Math.abs(ticks[0]||1);
    const dec = st >= 1 ? (Number.isInteger(+st.toFixed(6)) ? 0 : 1) : Math.min(5, (String(+st.toFixed(6)).split(".")[1] || "").length);
    return v => v.toLocaleString("en-US", {minimumFractionDigits:dec, maximumFractionDigits:dec}); };
  const valFmt = (v, small) => small ? v.toFixed(v < 0.1 ? 5 : v < 10 ? 4 : 3) : fmtP(v);
  const lineOf = (get, y, col, w) => { g.strokeStyle = col; g.lineWidth = w; g.beginPath(); let st = false;
    for(let i=0;i<n;i++){ const v = get(s0+i); if(v == null) continue; const yy = y(v); st ? g.lineTo(x(i), yy) : g.moveTo(x(i), yy); st = true; } g.stroke(); };
  const tagsAt = (p, tags) => {   // value tags on the right axis, pushed apart so they never overlap
    tags = tags.filter(t=>t.y != null && isFinite(t.y)).map(t=>({...t, y: Math.min(Math.max(t.y, p.top + 8), p.top + p.h - 8)})).sort((a,b)=>a.y-b.y);
    for(let i=1;i<tags.length;i++) if(tags[i].y - tags[i-1].y < 15) tags[i].y = tags[i-1].y + 15;
    const over = tags.length ? tags[tags.length-1].y - (p.top + p.h - 8) : 0; if(over > 0) tags.forEach(t=>t.y -= over);
    g.font = `700 11px ${FONT_D}`; g.textAlign = "left"; g.textBaseline = "middle";
    tags.forEach(t=>{ g.fillStyle = t.col; g.fillRect(Lm + plotW + 1, t.y - 7, R - 2, 14); g.fillStyle = "#fff"; g.fillText(t.txt, Lm + plotW + 4, t.y + .5); }); };
  const legend = (p, parts) => {   // [color|null, text, bold?]
    g.textBaseline = "top"; g.textAlign = "left"; let xx = Lm + 6, yy = p.top + 4; const maxX = Lm + plotW - 6;
    const meas = parts.map(([col, t, bold])=>{ g.font = `${bold ? "700 13px" : "12px"} ${bold ? FONT_D : FONT_L}`; return g.measureText(t).width + (col && !bold ? 14 : 0) + 10; });
    let lines = 1, run = 0; meas.forEach(w=>{ if(run + w > plotW - 12 && run > 0){ lines++; run = 0; } run += w; });
    g.fillStyle = "rgba(255,255,255,.88)"; g.fillRect(Lm + 1, p.top + 1, Math.min(plotW - 2, lines > 1 ? plotW - 2 : run + 8), 17*lines + 3);
    parts.forEach(([col, t, bold], i)=>{ if(xx + meas[i] > maxX && xx > Lm + 6){ xx = Lm + 6; yy += 17; }
      g.font = `${bold ? "700 13px" : "12px"} ${bold ? FONT_D : FONT_L}`;
      if(col && !bold){ g.fillStyle = col; g.fillRect(xx, yy + 6, 10, 3); xx += 14; }
      g.fillStyle = bold && col ? col : C.ink; g.fillText(t, xx, yy + 1); xx += meas[i] - (col && !bold ? 14 : 0); });
    return yy - p.top + 18; };
  const hGrid = (p, ticks, y, fmt, inT, inB) => {
    g.font = `11px ${FONT_D}`; g.textAlign = "left"; g.textBaseline = "middle"; g.fillStyle = C.ink2;
    ticks.forEach(v=>{ const yy = Math.round(y(v)) + .5; if(yy < inT - 2 || yy > inB + 2) return;
      if(dash){ g.strokeStyle = C.grid; g.setLineDash(dash); g.beginPath(); g.moveTo(Lm, yy); g.lineTo(Lm + plotW, yy); g.stroke(); g.setLineDash([]); }
      g.fillText(fmt(v), Lm + plotW + 5, yy); }); };

  if(perf){
    const p = P[0], inT = p.top + 8, inB = p.top + p.h - 8;
    const aI = cmpAnchor != null ? D.findIndex(t=>t >= cmpAnchor) : -1, b0 = aI >= s0 ? aI : s0;
    rows.forEach(r=>{ r.base = null; if(!r.bars) return; for(let i=b0;i<s0+n;i++) if(r.bars[i]){ r.base = r.bars[i].c; break; } });
    const pv = (r, i) => { const b = r.bars && r.bars[i]; return b && r.base ? (b.c / r.base - 1) * 100 : null; };
    let lo = 0, hi = 0; rows.forEach(r=>{ for(let i=s0;i<s0+n;i++){ const v = pv(r, i); if(v != null){ lo = Math.min(lo, v); hi = Math.max(hi, v); } } });
    const pad = (hi - lo) * .07 || 1, a = lo - pad, z = hi + pad, y = v => inT + (z - v) / (z - a) * (inB - inT);
    const ticks = linTicks(a, z, inB - inT), tf = tickFmt(ticks);
    hGrid(p, ticks, y, v=>(v > 0 ? "+" : "") + tf(v) + "%", inT, inB);
    g.strokeStyle = C.ink2; g.lineWidth = 1; g.beginPath(); g.moveTo(Lm, Math.round(y(0)) + .5); g.lineTo(Lm + plotW, Math.round(y(0)) + .5); g.stroke();
    g.save(); g.beginPath(); g.rect(Lm, p.top, plotW, p.h); g.clip();
    rows.forEach(r=>{ if(r.bars) lineOf(i=>pv(r, i), y, r.color, 1.8); });
    if(b0 > s0){ const xa = Math.round(x(b0 - s0)) + .5; g.strokeStyle = C.navy; g.setLineDash([5,4]); g.lineWidth = 1.2; g.beginPath(); g.moveTo(xa, p.top); g.lineTo(xa, p.top + p.h); g.stroke(); g.setLineDash([]);
      g.fillStyle = C.navy; g.font = `700 11px ${FONT_L}`; g.textAlign = xa > Lm + plotW - 120 ? "right" : "left"; g.textBaseline = "bottom"; g.fillText(`${TX("From")} ${fmtLong(D[b0])}`, xa + (g.textAlign === "left" ? 5 : -5), p.top + p.h - 6); }
    g.restore();
    legend(p, rows.flatMap(r=>{ if(!r.bars) return [[r.color, `${r.s} ${TX("no data")}`]]; const j = lastIdx(r.bars, s0, at), v = j >= 0 ? pv(r, j) : null;
      return [[r.color, `${r.s} ${fmtPct(v, 1)}`]]; }));
    tagsAt(p, rows.filter(r=>r.bars).map(r=>{ const j = lastIdx(r.bars, s0, s0 + n - 1), v = j >= 0 ? pv(r, j) : null;
      return {y: v == null ? null : y(v), col: r.color, txt: (v > 0 ? "+" : "") + (v == null ? "" : v.toFixed(1)) + "%"}; }));
    p.inv = yy => a + (inB - yy) / (inB - inT) * (z - a); p.fmt = v => (v > 0 ? "+" : "") + v.toFixed(2) + "%";
  } else rows.forEach((r, pi)=>{
    const p = P[pi], inT = p.top + 26, vH = r.vol ? Math.round(p.h * .2) : 0, inB = p.top + p.h - 6 - (vH ? vH + 6 : 0);
    if(!r.bars){ legend(p, [[r.color, r.s, true]]);
      say(r.missing.length ? `${TX("No data for")} ${r.missing.join(", ")} ${TX("yet. Add it to a watchlist with ☆ and it loads after the next nightly update.")}` : TX("No data yet."), p.top + 30);
      g.strokeStyle = C.ink; g.lineWidth = 1; g.strokeRect(Lm + .5, p.top + .5, plotW, p.h); return; }
    const useLine = r.ratio || CMP.style === "line";
    let lo = Infinity, hi = -Infinity;
    for(let i=s0;i<s0+n;i++){ const b = r.bars[i]; if(b){ lo = Math.min(lo, useLine ? b.c : b.l); hi = Math.max(hi, useLine ? b.c : b.h); }
      r.mas.forEach(m=>{ const v = m[i]; if(v != null){ lo = Math.min(lo, v); hi = Math.max(hi, v); } }); }
    if(!isFinite(lo)){ legend(p, [[r.color, r.s, true]]); say(TX("No data in this range."), p.top + 30); g.strokeStyle = C.ink; g.strokeRect(Lm + .5, p.top + .5, plotW, p.h); return; }
    if(hi === lo){ hi *= 1.01; lo *= .99; }
    const log = CMP.scale === "log" && lo > 0;
    let y, inv, ticks;
    if(log){ const pad = (Math.log(hi) - Math.log(lo)) * .05, a = Math.log(lo) - pad, z = Math.log(hi) + pad;
      y = v => inT + (z - Math.log(v)) / (z - a) * (inB - inT); inv = yy => Math.exp(a + (inB - yy) / (inB - inT) * (z - a)); ticks = logTicks(Math.exp(a), Math.exp(z), inB - inT); }
    else { const pad = (hi - lo) * .05, a = lo - pad, z = hi + pad;
      y = v => inT + (z - v) / (z - a) * (inB - inT); inv = yy => a + (inB - yy) / (inB - inT) * (z - a); ticks = linTicks(a, z, inB - inT); }
    const small = hi < 20 && r.ratio || hi < 1;
    hGrid(p, ticks, y, tickFmt(ticks), inT, inB);
    g.save(); g.beginPath(); g.rect(Lm, p.top, plotW, p.h); g.clip();
    r.mas.forEach((m, k)=>lineOf(i=>m[i], y, r.ind[k].c, 1.4));
    if(vH){ const vT = inB + 6, vB = p.top + p.h - 2; let vm = 0; for(let i=s0;i<s0+n;i++) if(r.v[i]) vm = Math.max(vm, r.v[i]);
      const vy = v => vB - v / (vm * 1.08 || 1) * (vB - vT), w = Math.max(1, Math.round(bw * .62));
      g.strokeStyle = C.grid; g.beginPath(); g.moveTo(Lm, vT - 3 + .5); g.lineTo(Lm + plotW, vT - 3 + .5); g.stroke();
      for(let i=0;i<n;i++){ const b = r.bars[s0+i], v = r.v[s0+i]; if(!b || !v) continue; g.fillStyle = b.c >= b.pc ? C.vup : C.vdown; g.globalAlpha = .75;
        g.fillRect(Math.round(x(i) - w/2), vy(v), w, vB - vy(v)); }
      g.globalAlpha = 1; lineOf(i=>r.vavg[i], vy, C.vavg, 1);
      g.fillStyle = C.ink2; g.font = `10px ${FONT_D}`; g.textAlign = "left"; g.textBaseline = "middle"; g.fillText(fmtV(vm), Lm + plotW + 5, vT + 4); g.fillText("Vol.", Lm + plotW + 5, vB - 6); }
    if(useLine) lineOf(i=>r.bars[i] && r.bars[i].c, y, r.color, 1.6);
    else {
      const lw = cfg.weight === "thin" ? 1 : cfg.weight === "normal" ? 1.3 : 1.8, tk = Math.max(1, Math.min(4, bw * .4));
      g.lineWidth = bw > 4 ? lw : Math.min(lw, 1.2);
      for(let i=0;i<n;i++){ const b = r.bars[s0+i]; if(!b) continue;
        const col = CMP.color === "ud" ? (b.c >= b.pc ? C.up : C.down) : r.color, xx = Math.round(x(i)) + .5;
        g.strokeStyle = col; g.fillStyle = col;
        if(cfg.bars === "candle"){ const t = y(Math.max(b.o, b.c)), bt = y(Math.min(b.o, b.c)), w = Math.max(1, bw * .62);
          g.beginPath(); g.moveTo(xx, y(b.h)); g.lineTo(xx, t); g.moveTo(xx, bt); g.lineTo(xx, y(b.l)); g.stroke();
          if(b.c >= b.o){ g.fillStyle = C.plate; g.fillRect(xx - w/2, t, w, Math.max(1, bt - t)); g.strokeRect(xx - w/2, t, w, Math.max(1, bt - t)); }
          else g.fillRect(xx - w/2, t, w, Math.max(1, bt - t)); }
        else { g.beginPath(); g.moveTo(xx, y(b.h)); g.lineTo(xx, y(b.l)); g.moveTo(xx, y(b.c)); g.lineTo(xx + tk, y(b.c));
          if(cfg.bars === "ohlc"){ g.moveTo(xx - tk, y(b.o)); g.lineTo(xx, y(b.o)); } g.stroke(); } }
    }
    g.restore();
    // legend: ticker, close and change at the hovered (or last) bar, then each moving average
    const j = lastIdx(r.bars, s0, at), b = j >= 0 ? r.bars[j] : null;
    const parts = [[r.color, r.s, true]];
    if(r.name && !narrow && !r.ratio) parts.push([null, r.name]);
    if(b){ parts.push([null, `${hv >= 0 ? fmtD(D[j]) + "  " : ""}${valFmt(b.c, small)}  ${fmtPct((b.c / b.pc - 1) * 100, 2)}`]); }
    r.mas.forEach((m, k)=>{ const v = j >= 0 ? m[j] : null; parts.push([r.ind[k].c, `${maLabel(r.ind[k])} ${v == null ? "—" : valFmt(v, small)}`]); });
    legend(p, parts);
    const jl = lastIdx(r.bars, s0, s0 + n - 1);
    tagsAt(p, [{y: y(r.bars[jl].c), col: r.color, txt: valFmt(r.bars[jl].c, small)},
      ...r.mas.map((m, k)=>{ const v = m[jl]; return {y: v == null ? null : y(v), col: r.ind[k].c, txt: v == null ? "" : valFmt(v, small)}; })]);
    p.inv = inv; p.fmt = v => valFmt(v, small);
    g.strokeStyle = C.ink; g.lineWidth = 1; g.strokeRect(Lm + .5, p.top + .5, plotW, p.h);
  });
  if(perf){ g.strokeStyle = C.ink; g.lineWidth = 1; g.strokeRect(Lm + .5, P[0].top + .5, plotW, P[0].h); }

  // crosshair: date across every panel, price in the panel under the pointer
  if(hv >= 0){
    const xx = Math.round(x(hv)) + .5; g.strokeStyle = "rgba(21,23,28,.45)"; g.setLineDash([3,3]); g.lineWidth = 1;
    g.beginPath(); g.moveTo(xx, T0); g.lineTo(xx, H - B); g.stroke();
    const p = P.find(q=>cmpY >= q.top && cmpY <= q.top + q.h);
    if(p && p.inv){ const yy = Math.round(cmpY) + .5; g.beginPath(); g.moveTo(Lm, yy); g.lineTo(Lm + plotW, yy); g.stroke(); g.setLineDash([]);
      g.fillStyle = C.ink; g.fillRect(Lm + plotW + 1, yy - 7, R - 2, 14); g.fillStyle = "#fff"; g.font = `700 11px ${FONT_D}`; g.textAlign = "left"; g.textBaseline = "middle";
      g.fillText(p.fmt(p.inv(yy)), Lm + plotW + 4, yy + .5); }
    g.setLineDash([]);
    const t = fmtLong(D[s0 + hv]); g.font = `700 11px ${FONT_D}`; const tw = g.measureText(t).width + 10, tx = Math.min(Math.max(xx - tw/2, Lm), Lm + plotW - tw);
    g.fillStyle = C.ink; g.fillRect(tx, H - B + 2, tw, 16); g.fillStyle = "#fff"; g.textAlign = "left"; g.textBaseline = "middle"; g.fillText(t, tx + 5, H - B + 10);
  }
  c._cx = {Lm, plotW, n, P, rows};
}

function renderCmpTable(){
  const el = $("#cTbl"); if(!el) return;
  if(!CM || !CM.rows.length || !CM.D.length){ el.innerHTML = ""; return; }
  const {n, s0} = cmpWindow(), rl = CMP_RANGES[CMP.range];
  const head = `<tr><th>${esc(TX("Ticker"))}</th><th class="nm">${esc(TX("Name"))}</th><th>${esc(TX("Last"))}</th><th>${esc(TX("Day"))}</th><th>${esc(rl)}</th>`
    + CMP.ind.map(m=>`<th title="${esc(TX("Distance from the moving average"))}">vs ${maLabel(m)}</th>`).join("") + `<th title="${esc(TX("Distance from the highest close in the range"))}">${esc(TX("Off high"))}</th></tr>`;
  const cell = v => `<td class="${v == null ? "" : v < 0 ? "neg" : "pos"}">${fmtPct(v, 1)}</td>`;
  const body = CM.rows.map(r=>{
    if(!r.bars) return `<tr><td><span class="csw" style="--c:${r.color}"></span>${esc(r.s)}</td><td class="nm" colspan="${5 + CMP.ind.length}">${esc(TX("No data yet."))}</td></tr>`;
    const j = lastIdx(r.bars, s0, s0 + n - 1); if(j < 0) return "";
    const b = r.bars[j]; let base = null, hi = -Infinity;
    for(let i=s0;i<=j;i++){ const x = r.bars[i]; if(!x) continue; if(base == null) base = x.c; hi = Math.max(hi, x.c); }
    const small = r.ratio || b.c < 1;
    return `<tr ${r.ratio ? "" : `data-go="${esc(r.s)}" tabindex="0"`}><td><span class="csw" style="--c:${r.color}"></span><b>${esc(r.s)}</b></td><td class="nm">${esc(r.name)}</td>
      <td>${small ? b.c.toFixed(4) : fmtP(b.c)}</td>${cell((b.c / b.pc - 1) * 100)}${cell(base ? (b.c / base - 1) * 100 : null)}
      ${r.gmas.map(m=>cell(m[j] ? (b.c / m[j] - 1) * 100 : null)).join("")}${cell(isFinite(hi) ? (b.c / hi - 1) * 100 : null)}</tr>`; }).join("");
  el.innerHTML = `<table class="tbl ctbl"><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

// one chart's own moving averages and volume
function openCmpItem(i){
  const it = CMP.items[i]; if(!it) return;
  const ratio = it.s.includes(":");
  let L = JSON.parse(JSON.stringify(itemInd(it))), own = Array.isArray(it.ind), vol = !!it.vol;
  const save = () => { if(own) it.ind = L; else delete it.ind; if(vol && !ratio) it.vol = true; else delete it.vol; saveCmp(); renderCmp(); };
  const body = () => `<div class="seg aseg2"><button data-own="0" class="${own?"":"on"}">${esc(TX("Same as the others"))}</button><button data-own="1" class="${own?"on":""}">${esc(TX("Own moving averages"))}</button></div>
    ${own ? `<div class="indmas">${L.map((m,k)=>`<div class="indma"><input type="color" class="swatch" data-qc="${k}" value="${m.c}" aria-label="${esc(TX("Color"))}">
      <select data-qt="${k}" aria-label="${esc(TX("Type"))}"><option value="sma" ${m.t==="sma"?"selected":""}>SMA</option><option value="ema" ${m.t==="ema"?"selected":""}>EMA</option></select>
      <input type="number" min="2" max="400" data-qn="${k}" value="${m.n}" aria-label="${esc(TX("Length (days)"))}"><span class="fine">${esc(TX("days"))}</span>
      <button class="cx" data-qdel="${k}" aria-label="${esc(TX("Remove"))}">×</button></div>`).join("") || `<p class="fine">${esc(TX("No moving averages on this chart."))}</p>`}
      ${L.length < CMP_MAX_IND ? `<button class="btn sm" id="qAdd">＋ ${esc(TX("Add moving average"))}</button>` : ""}</div>`
      : `<p class="msub">${esc(TX("This chart uses the moving averages set for every chart:"))} <b>${CMP.ind.map(maLabel).join(", ") || esc(TX("none"))}</b></p>`}
    <label class="chk"><input type="checkbox" id="qVol" ${vol?"checked":""} ${ratio?"disabled":""}> ${esc(TX("Show volume under the price"))}${ratio ? ` <small>(${esc(TX("not for ratios"))})</small>` : ""}</label>
    <div class="indft"><button class="btn on" id="qDone">${esc(TX("Done"))}</button></div>`;
  const bind = B => {
    B.innerHTML = body();
    const re = () => { save(); bind(B); };
    B.querySelectorAll("[data-own]").forEach(b=>b.onclick = ()=>{ own = b.dataset.own === "1"; if(own && !Array.isArray(it.ind)) L = JSON.parse(JSON.stringify(CMP.ind)); re(); });
    B.querySelector("#qAdd")?.addEventListener("click", ()=>{ const opts = [{t:"sma",n:50},{t:"sma",n:200},{t:"ema",n:21},{t:"sma",n:10},{t:"sma",n:150}];
      const nx = opts.find(o=>!L.some(m=>m.t === o.t && m.n === o.n)) || {t:"sma", n:100}; L.push({...nx, c: CMP_MA_PAL.find(c=>!L.some(m=>m.c === c)) || CMP_MA_PAL[0]}); re(); });
    B.querySelectorAll("[data-qdel]").forEach(b=>b.onclick = ()=>{ L.splice(+b.dataset.qdel, 1); re(); });
    B.querySelectorAll("[data-qt]").forEach(x=>x.onchange = ()=>{ L[+x.dataset.qt].t = x.value; re(); });
    B.querySelectorAll("[data-qn]").forEach(x=>x.onchange = ()=>{ const v = clampN(x.value, 2, 400, null); if(v == null){ toast(TX("Use a length between 2 and 400 days.")); x.value = L[+x.dataset.qn].n; return; } L[+x.dataset.qn].n = v; re(); });
    B.querySelectorAll("[data-qc]").forEach(x=>x.onchange = ()=>{ L[+x.dataset.qc].c = x.value; re(); });
    B.querySelector("#qVol").onchange = e => { vol = e.target.checked; re(); };
    B.querySelector("#qDone").onclick = closeDlg;
  };
  dlg(`${it.s} · ${TX("chart settings")}`, "", bind);
}

// controls
function cmpAdd(raw){
  const v = String(raw || "").toUpperCase().replace(/\s+/g, "").replace(/[\/÷]/g, ":");
  if(!v) return;
  if(!CMP_SYM.test(v)){ toast(TX("Invalid ticker.")); return; }
  if(CMP.items.some(x=>x.s === v)){ toast(`${v} ${TX("is already on the chart.")}`); return; }
  if(CMP.items.length >= CMP_MAX){ toast(TX("Up to 8 tickers. Remove one first.")); return; }
  CMP.items.push({s:v, c:cmpNextColor()}); saveCmp(); renderCmp();
}
$("#cAdd").addEventListener("submit", e=>{ e.preventDefault(); const i = $("#cIn"); cmpAdd(i.value); i.value = ""; });
$("#vCmp").addEventListener("click", e=>{
  const t = e.target.closest("button,[data-go]"); if(!t || !$("#vCmp").contains(t)) return;
  const d = t.dataset;
  if(d.cdel != null){ CMP.items.splice(+d.cdel, 1); saveCmp(); renderCmp(); return; }
  if(d.cset != null){ openCmpItem(+d.cset); return; }
  if(t.id === "cPreMore"){ cmpPreAll = !cmpPreAll; renderCmpCtl(); return; }
  if(t.id === "cAnchorX"){ cmpAnchor = null; renderCmpCtl(); drawCmp(); return; }
  if(d.cmv != null){ const i = +d.cmv; if(i > 0){ const [it] = CMP.items.splice(i, 1); CMP.items.splice(i - 1, 0, it); saveCmp(); renderCmp(); } return; }
  if(d.idel != null){ CMP.ind.splice(+d.idel, 1); saveCmp(); renderCmp(); return; }
  if(t.id === "cIndAdd"){ const opts = [{t:"sma",n:200},{t:"ema",n:21},{t:"sma",n:10},{t:"sma",n:150},{t:"sma",n:50}];
    const nx = opts.find(o=>!CMP.ind.some(m=>m.t === o.t && m.n === o.n)) || {t:"sma", n:100};
    CMP.ind.push({...nx, c: CMP_MA_PAL.find(c=>!CMP.ind.some(m=>m.c === c)) || CMP_MA_PAL[0]}); saveCmp(); renderCmp(); return; }
  if(d.pre != null){ const p = CMP_PRESETS[+d.pre]; cmpAnchor = null; CMP.items = p.s.map((s,i)=>({s, c:CMP_PAL[i]})); saveCmp(); renderCmp(); window.scrollTo({top:0, behavior:"smooth"}); return; }
  if(d.m){ CMP.mode = d.m; saveCmp(); renderCmpCtl(); drawCmp(); return; }
  if(d.r){ CMP.range = +d.r; cmpAnchor = null; saveCmp(); renderCmpCtl(); drawCmp(); renderCmpTable(); return; }
  if(t.closest("#cScale")){ CMP.scale = d.s; saveCmp(); renderCmpCtl(); drawCmp(); return; }
  if(t.closest("#cStyle")){ CMP.style = d.s; saveCmp(); renderCmpCtl(); drawCmp(); return; }
  if(t.closest("#cColor")){ CMP.color = d.c; saveCmp(); renderCmpCtl(); drawCmp(); return; }
  if(t.id === "cLink"){ const url = location.origin + keyToPath("compare/" + CMP.items.map(x=>x.s).join(","));
    (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(()=>toast(TX("Link copied."))).catch(()=>prompt(TX("Copy this link:"), url)); return; }
  if(t.id === "cReset"){ CMP = normCmp({range: CMP.range, mode: CMP.mode}); saveCmp(); renderCmp(); return; }
  if(d.go){ go(d.go); }
});
$("#vCmp").addEventListener("keydown", e=>{ const r = e.target.closest("[data-go]"); if(r && e.key === "Enter") go(r.dataset.go); });
$("#vCmp").addEventListener("change", e=>{
  const t = e.target, d = t.dataset;
  if(d.it != null){ CMP.ind[+d.it].t = t.value; saveCmp(); renderCmp(); }
  if(d.in != null){ const v = Math.round(+t.value); if(!(v >= 2 && v <= 400)){ toast(TX("Use a length between 2 and 400 days.")); t.value = CMP.ind[+d.in].n; return; }
    CMP.ind[+d.in].n = v; saveCmp(); renderCmp(); }
  if(d.ic != null){ CMP.ind[+d.ic].c = t.value; saveCmp(); renderCmpCtl(); drawCmp(); }
  if(d.ccol != null){ CMP.items[+d.ccol].c = t.value; saveCmp(); renderCmpCtl(); if(CM) CM.rows.forEach((r,i)=>{ if(CMP.items[i]) r.color = CMP.items[i].c; }); drawCmp(); renderCmpTable(); }
});
$("#vCmp").addEventListener("input", e=>{   // live color preview while the picker is open
  const t = e.target, d = t.dataset; if(t.type !== "color") return;
  if(d.ic != null){ CMP.ind[+d.ic].c = t.value; drawCmp(); }
  if(d.ccol != null && CM && CM.rows[+d.ccol]){ CM.rows[+d.ccol].color = t.value; drawCmp(); }
});
(()=>{
  const c = $("#ccv"); if(!c) return;
  const at = e => { const b = c._cx; if(!b) return -1; const r = c.getBoundingClientRect(), pt = e.touches ? e.touches[0] : e, px = pt.clientX - r.left;
    cmpY = pt.clientY - r.top; if(px < b.Lm || px > b.Lm + b.plotW) return -1; return Math.min(b.n - 1, Math.max(0, Math.floor((px - b.Lm) / b.plotW * b.n))); };
  let raf = 0; const mv = e => { cmpHover = at(e); cancelAnimationFrame(raf); raf = requestAnimationFrame(drawCmp); };
  c.addEventListener("mousemove", mv); c.addEventListener("touchmove", mv, {passive:true});
  c.addEventListener("mouseleave", ()=>{ cmpHover = -1; cmpY = -1; drawCmp(); });
  c.addEventListener("click", e=>{ if(CMP.mode !== "perf" || !CM) return; const i = at(e); if(i < 0) return;   // Performance %: start every line at zero from this day
    const {s0} = cmpWindow(); cmpAnchor = CM.D[s0 + i]; renderCmpCtl(); drawCmp(); });
  c.addEventListener("dblclick", ()=>{ const b = c._cx; if(!b || CMP.mode === "perf") return; const i = b.P.findIndex(p=>cmpY >= p.top && cmpY <= p.top + p.h), r = b.rows[i];
    if(r && !r.ratio) go(r.s); });
})();
let cmpResize = 0; addEventListener("resize", ()=>{ clearTimeout(cmpResize); cmpResize = setTimeout(()=>{ if(!$("#vCmp").hidden) drawCmp(); }, 120); });
function openCmp(spec){
  CMP = normCmp(cfg.cmp);
  if(spec){ const syms = [...new Set(spec.toUpperCase().split(/[,\s]+/).map(s=>s.replace(/[\/÷]/g, ":")).filter(s=>CMP_SYM.test(s)))].slice(0, CMP_MAX);
    if(syms.length){ CMP.items = syms.map((s,i)=>({s, c: (CMP.items.find(x=>x.s === s) || {}).c || CMP_PAL[i % CMP_PAL.length]})); saveCmp(); }
    history.replaceState(null, "", "/compare/"); }
  renderCmp();
}

/* ================= WELCOME PAGE ================= */
// rotating showcase: screenshots of each tool, taken every night by scripts/showcase.mjs
const SHOW = [
  {k:"wall", t:"Chart wall", c:"Your whole watchlist as a wall of O'Neil-style charts, with RS Rating, Composite and base status on every one."},
  {k:"screener", t:"Screener", c:"Every U.S. stock and ADR worth $1 billion or more, ranked by RS Rating, with EPS and sales growth, bases, pivots and status."},
  {k:"heatmap", t:"Heatmap", c:"The S&P 500 and Nasdaq-100 by sector, colored by daily, weekly or year-to-date change, or by RS Rating."},
  {k:"breadth", t:"Breadth", c:"Market direction the O'Neil way, plus stocks above their moving averages, new highs and lows and the A/D line."},
  {k:"ideas", t:"Trade ideas", c:"Leaders near a buy point every day, with the pivot, buy zone and a stop 7% below, tracked for 8 weeks."},
  {k:"earnings", t:"Earnings", c:"Who reports this week, with each stock's RS Rating, expected EPS and how the stock reacted last time."},
  {k:"compare", t:"Compare", c:"SPY vs RSP vs MAGS on one timeline, or ratios like RSP:SPY, with your own moving averages."},
  {k:"chart", t:"Charts", c:"Daily and weekly charts with the RS line, labeled volume, the earnings strip and the current base with its pivot."}];
const show = {i:0, list:SHOW.slice(), timer:0, paused:false, dur:5500, built:false};
function showImg(k){ let im = $(`#wStage img[data-k="${k}"]`);
  if(!im){ im = new Image(); im.dataset.k = k; im.width = 1440; im.height = 900; im.alt = (SHOW.find(x=>x.k===k)||{}).t || "";
    im.decoding = "async"; showSrc(im, k); $("#wStage").appendChild(im); }
  return im; }
// WebP (about a third of the size) when the nightly build made it, else the JPEG; a slide with neither is dropped
function showSrc(im, k){
  im.onerror = () => { if(/\.webp$/.test(im.src)){ im.src = `/img/showcase/${k}.jpg`; return; }
    show.list = show.list.filter(x=>x.k!==k); im.remove(); buildShowTabs(); if(!show.list.length) noShow(); };
  if(!im.src || !/\/img\/showcase\//.test(im.src)) im.src = `/img/showcase/${k}.webp`;
}
function noShow(){ clearTimeout(show.timer); $("#wStage").innerHTML = `<img class="on" src="/img/hero-chart.jpg" alt="Ticker&Tape daily chart of NVDA" width="1380" height="654" style="object-fit:contain">`; $("#wTabs").innerHTML = ""; $("#wShowName").textContent = "NVDA · Daily";
  $("#wCap").textContent = TX("NVDA, daily: cup base with pivot and buy zone, 50- and 200-day lines, RS line, labeled volume and the quarterly earnings strip."); }
function buildShowTabs(){ const cur = show.list[show.i] && show.list[show.i].k;
  $("#wTabs").innerHTML = show.list.map(x=>`<button role="tab" data-k="${x.k}" aria-selected="${x.k===cur}"><i></i>${esc(TX(x.t))}</button>`).join(""); setShow(Math.max(0, show.list.findIndex(x=>x.k===cur)), true); }
function setShow(i, keep){
  if(!show.list.length) return;
  show.i = (i + show.list.length) % show.list.length; const s = show.list[show.i];
  const im = showImg(s.k); showImg(show.list[(show.i+1) % show.list.length].k);   // preload the next one
  $$("#wStage img").forEach(x=>x.classList.toggle("on", x === im));
  $$("#wTabs button").forEach(b=>{ const on = b.dataset.k === s.k; b.classList.toggle("on", on); b.setAttribute("aria-selected", on);
    if(on && !keep){ const bar = b.querySelector("i"); bar.style.animation = "none"; void bar.offsetWidth; bar.style.animation = ""; } });
  $("#wShowName").textContent = TX(s.t); $("#wCap").textContent = TX(s.c);
  clearTimeout(show.timer); if(!show.paused) show.timer = setTimeout(()=>{ if(!$("#vWelcome").hidden) setShow(show.i + 1); }, show.dur);
}
function startShow(){
  if(!show.built){ show.built = true;
    const fig = $("#wShow"); fig.style.setProperty("--dur", show.dur/1000 + "s");
    const pause = on => { show.paused = on; fig.classList.toggle("w2show-paused", on); if(on) clearTimeout(show.timer); else setShow(show.i, true); };
    fig.addEventListener("mouseenter", ()=>pause(true)); fig.addEventListener("mouseleave", ()=>pause(false));
    $("#wTabs").addEventListener("click", e=>{ const b = e.target.closest("button[data-k]"); if(b) setShow(show.list.findIndex(x=>x.k===b.dataset.k)); });
    const first = $("#wStage img");
    if(first){ showSrc(first, "wall"); if(first.complete && !first.naturalWidth) first.onerror(); }
    buildShowTabs(); return; }
  setShow(show.i);
}
// ticker tape (index ETFs, sectors and commodities, with delayed intraday prices when the market is open) and the market board
function renderWelcome(){
  startShow();
  if(!HOME){ loadHome().then(()=>{ if(!$("#vWelcome").hidden) renderWelcome(); }).catch(()=>{}); }
  else {
    const rows = [...(HOME.market||[]), ...(HOME.sectors||[]), ...(HOME.commodities||[])].map(r=>{
      let c = r.close, ch = r.d1; const q = LIVE && LIVE.q[r.symbol];
      if(q && LIVE.date && r.date){ const prev = LIVE.date > r.date ? r.close : LIVE.date === r.date && r.d1 != null ? r.close / (1 + r.d1/100) : null;
        if(prev){ c = q[3]; ch = (c / prev - 1) * 100; } }
      return {s: r.symbol, c, ch}; }).filter(r=>r.c != null);
    const one = rows.map(r=>`<a href="${keyToPath(r.s)}"><b>${esc(r.s.replace(/=F$/,""))}</b><span class="px">${r.c < 20 ? r.c.toFixed(3) : fmtP(r.c)}</span><span class="${(r.ch??0) < 0 ? "d" : "u"}">${(r.ch??0) < 0 ? "▼" : "▲"} ${Math.abs(r.ch??0).toFixed(2)}%</span></a>`).join("");
    $("#wTape").innerHTML = one + one;   // twice, so the loop is seamless
  }
  const tiles = $$("#wBoard > div");
  if(META){
    const M = META.market || [], dir = n => M.find(m=>m.name.startsWith(n));
    [["S&P",0],["Nasdaq",1]].forEach(([n,i])=>{ const m = dir(n); if(!m) return;
      const b = tiles[i].querySelector("b"); b.textContent = TX(MKT_SHORT[m.status] || m.status); b.className = m.status === "Uptrend" ? "u" : m.status === "Correction" ? "d" : "";
      tiles[i].querySelector("small").textContent = `${m.distDays} ${TX(m.distDays === 1 ? "distribution day" : "distribution days")}`; });
    if(META.allStocks) tiles[2].querySelector("b").textContent = Number(META.allStocks).toLocaleString("en-US");
    if(META.groups) tiles[3].querySelector("b").textContent = META.groups;
    $("#wBoardAsOf").textContent = `${TX("As of")} ${fmtLong(iso(META.dataDate))} ${TX("close")}`;
  }
  loadIdeas().then(()=>{ const L = (IDEAS && IDEAS.ideas || []), n = L.length;
    tiles[4].querySelector("b").textContent = n; if(!n) tiles[4].querySelector("small").textContent = TX("a quiet tape: no setups today");
    renderWelcomeIdeas(L); }).catch(()=>{});
  // a tile whose number never arrives is hidden instead of showing an empty slot
  clearTimeout(renderWelcome.t); renderWelcome.t = setTimeout(()=>tiles.forEach(t=>t.classList.toggle("w2off", !t.querySelector("b").textContent.trim())), 9000);
  stickyWatch();
}
// three of today's ideas as a teaser; the buy points stay hidden until the visitor has an account
function renderWelcomeIdeas(L){
  const box = $("#wIdeas"); if(!L.length){ box.hidden = true; return; }
  const top = L.slice().sort((a,b)=>(b.rs||0)-(a.rs||0)).slice(0, 3), rest = L.length - top.length;
  $("#wIdeasT").textContent = L.length === 1 ? TX("1 leader near a buy point today") : `${L.length} ${TX("leaders near a buy point today")}`;
  $("#wIcards").innerHTML = top.map(it=>`<a class="w2icard" href="/chart/${esc(it.symbol)}/">
      <header><span class="sym">${esc(it.symbol)}</span><span class="rsv" title="RS Rating">RS ${it.rs ?? ""}</span></header>
      <span class="nm">${esc(it.name || "")}</span><span class="st">${esc(TX(it.status || ""))}</span>
      <span class="pv">${esc(TX("Buy point"))}<b aria-hidden="true">000.00</b></span></a>`).join("")
    + `<button class="w2icard more" data-w="up"><b>${rest > 0 ? "+" + rest : "→"}</b><span>${esc(TX(rest > 0 ? "more, with buy points and stops" : "See buy points and stops"))}</span><span>${esc(TX("Open a free account"))}</span></button>`;
  box.hidden = false;
}
// once the hero buttons scroll out of view, a slim sign-up bar slides in at the top
let stickyObs = null;
function stickyWatch(){
  if(stickyObs || !("IntersectionObserver" in window)) return;
  stickyObs = new IntersectionObserver(([e])=>{ const on = !e.isIntersecting && e.boundingClientRect.top < 0 && !$("#vWelcome").hidden, bar = $("#wSticky");
    bar.classList.toggle("on", on); bar.setAttribute("aria-hidden", !on); bar.querySelectorAll("button").forEach(b=>b.tabIndex = on ? 0 : -1); });
  stickyObs.observe($("#wCtas"));
}
$("#wSticky").addEventListener("click", e=>{ const b = e.target.closest("[data-ws]"); if(b) openAuth(b.dataset.ws); });
$("#gateBar").addEventListener("click", e=>{ const b = e.target.closest("[data-g]"); if(b) openAuth(b.dataset.g); });
$("#vWelcome").addEventListener("click", e=>{
  const b = e.target.closest("[data-w]"); if(!b) return;
  const w = b.dataset.w;
  if(w==="up") openAuth("up");
  else if(w==="in") openAuth("in");
  else if(w==="explore"){ store.set("tt:welcomed", true); go(""); if(!store.get("tt:toured")) setTimeout(startTour, 700); }
});

/* ================= GUIDED TOUR ================= */
// v: "s" = screener, "c" = chart, "*" = any. up: highlight the whole button group.
const TOUR = [
  {v:"h", sel:"#tabs", t:"Four rooms",
   b:"Home is the market dashboard. Watchlist holds the stocks you starred. Screener lists every U.S. stock and ADR worth $1 billion or more, over 2,500 names rated every trading day. ETFs covers indexes, sectors, industries, commodities, bonds and countries. Heatmap shows the S&P 500, the Nasdaq-100 or your watchlist as a map of boxes sized by market cap and colored by performance or RS Rating."},
  {v:"h", sel:"#hSect", t:"Sector scoreboard",
   b:"The market ETFs and the eleven Select Sector SPDRs with their 1-day, 1-week, 3-month, 9-month and year-to-date change. Click a column to rank the sectors, a row to open its chart, or Components to see the stocks in that sector. Next to it, the commodities board shows metals, energy and grains futures on the same scale."},
  {v:"h", sel:".hlists", t:"What is leading",
   b:"The five highest RS Ratings, the strongest accumulation by up/down volume and the biggest movers of the day, among stocks with real liquidity."},
  {v:"h", sel:"#hPulse", t:"Market pulse",
   b:"The S&P 500 and the Nasdaq against their 21, 50 and 200-day lines, plus distribution days (heavy-volume declines) in the last 25 sessions. Most stocks follow the market's direction."},
  {v:"s", sel:"#filters", t:"Filter for setups",
   b:"Breakout / buy zone: up to 5% above the pivot. Near pivot: within 5% below it. RS ≥ 80: the strongest fifth of the market. Liquid: $20M or more traded a day."},
  {v:"s", sel:'#scr th[data-k="rsRating"]', t:"RS Rating",
   b:"Relative strength from 1 to 99: twelve-month price performance, with the last quarter counted double, ranked against every stock on the site. 80 and up is leadership territory. Click any column header to sort by it."},
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
  {v:"c", sel:"#bInd", t:"Your own indicators",
   b:"Add any moving average, Bollinger Bands, Keltner Channels, an anchored VWAP, and panels with RSI, MACD, ADR %, ATR or relative volume. Save your setup as a template."},
  {v:"c", sel:"#bDraw", t:"Draw and take notes",
   b:"Draw opens the tools: Trend, Level, Box and Note, plus the color, width and style. Click a drawing to restyle or delete it. Shortcuts: T, H, R, N, Delete and Ctrl+Z. Your drawings sync to your account."},
  {v:"c", sel:".boxes", t:"Fundamentals under the chart",
   b:"Peers, chart statistics, annual and quarterly earnings and sales, the base analysis, analysts and news. Further down: insider buying and selling, and the largest institutional holders."},
  {v:"*", sel:"#gear", t:"Make the chart yours",
   b:"Log or linear scale, O'Neil bars, OHLC or candles, bar weight, moving averages, grid lines, and the colors of the bars, the volume and every moving average. You also pick the language here."},
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
  if(v==="h" && $("#vHome").hidden){ go(""); await waitFor(()=>!$("#vHome").hidden && HOME); await sleep(150); }
  if(v==="s" && $("#vScreener").hidden){ go("watchlist"); await waitFor(()=>!$("#vScreener").hidden); }
  if(v==="c" && ($("#vChart").hidden || !S || (S.fund||{}).etf)){
    const have = r => r && !r.pending && !r.etf;
    const pick = (watchRows().find(have) || ROWS[0] || {symbol:"NVDA"}).symbol;
    go(pick);
    await waitFor(()=>!$("#vChart").hidden && S && $("#loading").hidden);
  }
  if(v==="*" && !$("#vWelcome").hidden){ go(""); await waitFor(()=>!$("#vHome").hidden); }
}
async function showStep(){
  const i = tourI, st = TOUR[i];
  await ensureView(st.v);
  if(i !== tourI) return;
  let el = $(st.sel); if(el && st.up) el = el.closest(".seg,.grp") || el;
  if(!el || !el.getClientRects().length){ return tourGo(tourI < TOUR.length-1 ? 1 : 0); }
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
function tourGo(d){ const n = tourI + d; if(n < 0) return; if(n >= TOUR.length) return endTour(); tourI = n; showStep(); }
$("#tNext").onclick = () => tourGo(1);
$("#tBack").onclick = () => tourGo(-1);
$("#tSkip").onclick = endTour;
$("#help").onclick = e => { e.stopPropagation(); startTour(); };
document.addEventListener("click", e=>{ if(e.target.closest("[data-tour]")) startTour(); });
{ const fy = document.getElementById("fYear"); if(fy) fy.textContent = String(new Date().getFullYear()); }
document.addEventListener("keydown", e=>{
  if(!TOUR_ON()) return;
  if(e.key==="Escape") endTour();
  else if(e.key==="ArrowRight"){ e.preventDefault(); tourGo(1); }
  else if(e.key==="ArrowLeft"){ e.preventDefault(); tourGo(-1); }
});
addEventListener("resize", ()=>{ if(TOUR_ON()) placeTour(); });
addEventListener("scroll", ()=>{ if(TOUR_ON()) placeTour(); }, true);

/* ---------- boot ---------- */
(async function boot(){
  try{
    [META, ROWS] = await Promise.all([getJSON("meta.json"), getJSON("screener.json")]);
  }catch(e){
    $("#banner").hidden=false; $("#banner").textContent = TX("Market data is being updated. Please check back in a few minutes.");
    ROWS = []; META = null;
  }
  if(META){
    $("#asof").textContent = `Data as of ${fmtLong(iso(META.dataDate))} close · RS vs ${META.universeSize} stocks`;
    const notes = [];
    if(META.demo) notes.push("Demo data: synthetic prices and fundamentals generated for testing. The live site shows real Yahoo Finance data.");
    if(META.errors && META.errors.length) notes.push("Last update had problems with: " + META.errors.slice(0,6).join("; ") + (META.errors.length>6?"…":""));
    const late = staleNote(META.dataDate); if(late) notes.push(late);
    if(notes.length){ $("#banner").hidden=false; $("#banner").textContent = notes.join(" "); $("#banner").classList.toggle("stale", !!late); }
  }
  fillSymlist();
  renderPulse();
  renderAcct();
  if(needsUni()) loadUni().catch(()=>{});
  renderScreenBtns(); applyCols();
  if(auth.token) pullData(false);
  $("#scope").hidden = true;
  loadHome(); loadEarn().then(()=>{ if(!$("#vScreener").hidden) renderScreener(); if(S && !$("#vChart").hidden) setEarnChip(); });
  setTimeout(()=>loadUni().catch(()=>{}), 400);   // background: full list for the ticker search

  window.addEventListener("hashchange", route); window.addEventListener("popstate", route);
  if(SESSION_MSG) setTimeout(()=>{ toast(TX(SESSION_MSG)); openAuth("in"); }, 400);
  // in-site links navigate without reloading the page
  document.addEventListener("click", e=>{
    if(e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest("a[href]"); if(!a || a.target || a.hasAttribute("download")) return;
    const href = a.getAttribute("href");
    if(href.startsWith("#")){ e.preventDefault(); go(href); return; }
    const u = new URL(a.href, location.href); if(u.origin !== location.origin) return;
    const seg = u.pathname.replace(/^\/|\/$/g, "");
    if(u.pathname === "/" || /^chart\/[^\/]+$/.test(seg) || SECTIONS.includes(seg)){ e.preventDefault();
      if(u.pathname + u.search !== location.pathname + location.search) history.pushState(null, "", u.pathname + u.search); route(); }
  });
  route();
  loadLive(); setInterval(loadLive, 3*60*1000);
  document.addEventListener("visibilitychange", ()=>{ if(!document.hidden) loadLive(); });
  let rz; new ResizeObserver(()=>{ cancelAnimationFrame(rz); rz=requestAnimationFrame(()=>{ if(S && !$("#vChart").hidden){ draw(); renderDbox(); } }); }).observe(cv);
  if(document.fonts && document.fonts.ready) document.fonts.ready.then(()=>{ if(S) draw(); });
})();
})();
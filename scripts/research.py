#!/usr/bin/env python3
"""
Ticker&Tape research reports: "The Daily Tape" (every trading morning, before the open) and
"The Weekly Tape" (Saturday). Short by design: four or five pages of charts, tables and precise ideas.

  python scripts/research.py daily  --out build/research      # HTML + data for the PDF step
  python scripts/research.py weekly --out build/research
  python scripts/research.py daily  --data site/data --demo  # offline test with the demo data

Everything comes from the data the site already publishes (tickerandtape.com/data/*.json), plus, for the
Daily, the after-hours and pre-market prices of the leaders from Yahoo Finance. The commentary is written
from the numbers (no paid services). Desk notes: an optional paragraph from the editor, taken from
research/notes.md (a line "## YYYY-MM-DD" followed by the text, for the date of the report).
scripts/research_pdf.mjs then prints the HTML to PDF and takes a cover thumbnail.
"""
from __future__ import annotations

import argparse
import base64
import datetime as dt
import hashlib
import html
import json
import math
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SITE = "https://tickerandtape.com"
E = html.escape

NAVY, AMBER, INK, INK2, RULE, UP, DOWN, GREEN = "#1f3c6e", "#f2b134", "#15171c", "#5a5d66", "#d9d6cc", "#1d3fc4", "#e0337f", "#2f7d32"
# U.S. market holidays (NYSE): no Daily on these days
HOLIDAYS = {"2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07",
            "2026-11-26", "2026-12-25", "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18",
            "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24"}


# ---------------------------------------------------------------- data
class Data:
    def __init__(self, src: str):
        self.src = src.rstrip("/")
        self._cache: dict[str, object] = {}

    def get(self, name: str, default=None):
        if name in self._cache:
            return self._cache[name]
        try:
            if self.src.startswith("http"):
                import requests
                r = requests.get(f"{self.src}/{name}", timeout=30, headers={"User-Agent": "Ticker&Tape research"})
                r.raise_for_status()
                v = r.json()
            else:
                v = json.loads((Path(self.src) / name).read_text())
        except Exception as e:  # a missing file leaves its section out of the report
            print(f"research: could not load {name}: {e}", file=sys.stderr)
            v = default
        self._cache[name] = v
        return v

    def bundle(self, sym: str):
        return self.get(f"t/{sym.replace('=', '_')}.json")


def pct(v, d=1, sign=True):
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return "—"
    return f"{v:+.{d}f}%" if sign else f"{v:.{d}f}%"


def px(v):
    if v is None:
        return "—"
    return f"{v:,.2f}" if v >= 1 else f"{v:.4f}"


def cls(v):
    return "" if v is None else ("dn" if v < 0 else "up")


def fdate(d: str, fmt="%A, %B %-d, %Y"):
    return dt.date.fromisoformat(d[:10]).strftime(fmt)


def n2(v):
    return "—" if v is None else f"{v:.2f}"


def mcap_txt(m):   # market value in $ millions
    if not m:
        return ""
    return f"${m/1e6:.2f}T" if m >= 1e6 else f"${m/1e3:.0f}B" if m >= 1e4 else f"${m/1e3:.1f}B"


def leaders_of(uni, min_rs=80, min_dv=2e7):
    return [r for r in uni if not r.get("etf") and (r.get("rsRating") or 0) >= min_rs and (r.get("dollarVol50") or 0) >= min_dv]


# ---------------------------------------------------------------- extended hours (Daily)
def ext_moves(symbols: list[str], today: dt.date, demo=False) -> dict[str, dict]:
    """After-hours (yesterday) and pre-market (today) prices against yesterday's 4:00 p.m. close."""
    if demo:
        out = {}
        for s in symbols:
            h = int(hashlib.md5(s.encode()).hexdigest()[:8], 16)
            ah = ((h % 1000) / 1000 - 0.5) * 6 * (3 if h % 17 == 0 else 1)
            pm = ah + (((h >> 10) % 1000) / 1000 - 0.5) * 2
            out[s] = {"ah": round(ah, 2), "pm": round(pm, 2), "close": None, "pre": None, "post": None}
        return out
    import pandas as pd
    import yfinance as yf
    out: dict[str, dict] = {}
    for k in range(0, len(symbols), 150):
        chunk = symbols[k:k + 150]
        try:
            df = yf.download(chunk, period="5d", interval="5m", prepost=True, group_by="ticker", threads=True, progress=False, auto_adjust=False)
        except Exception as e:
            print(f"research: extended-hours download failed: {e}", file=sys.stderr)
            continue
        for s in chunk:
            try:
                sub = df[s] if isinstance(df.columns, pd.MultiIndex) else df
                c = sub["Close"].dropna()
                if c.empty:
                    continue
                idx = c.index.tz_convert("America/New_York") if c.index.tz is not None else c.index.tz_localize("UTC").tz_convert("America/New_York")
                c.index = idx
                days = sorted({t.date() for t in idx if t.date() < today and t.weekday() < 5})
                if not days:
                    continue
                prev = days[-1]
                reg = c[(idx.date == prev) & (idx.hour * 60 + idx.minute < 16 * 60) & (idx.hour * 60 + idx.minute >= 9 * 60 + 30)]
                if reg.empty:
                    continue
                close = float(reg.iloc[-1])
                post = c[(idx.date == prev) & (idx.hour >= 16)]
                pre = c[(idx.date == today) & (idx.hour * 60 + idx.minute < 9 * 60 + 30)]
                p_post = float(post.iloc[-1]) if not post.empty else None
                p_pre = float(pre.iloc[-1]) if not pre.empty else None
                out[s] = {"close": close, "post": p_post, "pre": p_pre,
                          "ah": None if p_post is None else round((p_post / close - 1) * 100, 2),
                          "pm": None if p_pre is None else round((p_pre / close - 1) * 100, 2)}
            except Exception:
                continue
    return out


# ---------------------------------------------------------------- charts (inline SVG)
def sma(vals, n):
    out, s = [], 0.0
    for i, v in enumerate(vals):
        s += v
        if i >= n:
            s -= vals[i - n]
        out.append(s / n if i >= n - 1 else None)
    return out


def price_chart(b, w=360, h=200, bars=126, title=True):
    """O'Neil-style mini chart: high-low-close bars, 50- and 200-day lines, the pivot and volume."""
    if not b or not b.get("prices"):
        return ""
    P = b["prices"]
    closes = [p[4] for p in P]
    m50, m200 = sma(closes, 50), sma(closes, 200)
    P, m50, m200 = P[-bars:], m50[-bars:], m200[-bars:]
    n = len(P)
    top, vol_h, pad_r = 26 if title else 6, 34, 46
    ph = h - top - vol_h - 14
    lo = min(min(p[3] for p in P), *(v for v in m50 if v), *(v for v in m200 if v)) if any(m200) else min(p[3] for p in P)
    hi = max(max(p[2] for p in P), *(v for v in m50 if v))
    base = b.get("base") or {}
    piv = base.get("pivot")
    if piv and lo < piv < hi * 1.15:
        hi = max(hi, piv)
    lo, hi = math.log(lo * 0.985), math.log(hi * 1.015)
    pw = w - pad_r - 4
    x = lambda i: 4 + (i + 0.5) * pw / n
    y = lambda v: top + (hi - math.log(v)) / (hi - lo) * ph
    vmax = max(p[5] for p in P) or 1
    vy = lambda v: h - 12 - v / vmax * (vol_h - 4)
    out = [f'<svg viewBox="0 0 {w} {h}" width="{w}" height="{h}" class="pc" xmlns="http://www.w3.org/2000/svg">',
           f'<rect x="4" y="{top}" width="{pw}" height="{ph}" fill="#fff" stroke="{INK}" stroke-width=".6"/>']
    # price grid: 4 levels
    for k in range(1, 4):
        v = math.exp(lo + (hi - lo) * k / 4)
        yy = y(v)
        out.append(f'<line x1="4" x2="{4+pw}" y1="{yy:.1f}" y2="{yy:.1f}" stroke="{RULE}" stroke-dasharray="1 2" stroke-width=".6"/>'
                   f'<text x="{w-pad_r+3}" y="{yy+3:.1f}" class="ax">{v:,.0f}</text>')
    # months
    last_m = None
    for i, p in enumerate(P):
        m = p[0][5:7]
        if m != last_m and i:
            out.append(f'<line x1="{x(i):.1f}" x2="{x(i):.1f}" y1="{top}" y2="{top+ph}" stroke="{RULE}" stroke-dasharray="1 2" stroke-width=".6"/>'
                       f'<text x="{x(i)+2:.1f}" y="{h-2}" class="ax">{dt.date.fromisoformat(p[0]).strftime("%b")}</text>')
        last_m = m
    if piv and math.exp(lo) < piv < math.exp(hi):
        out.append(f'<line x1="4" x2="{4+pw}" y1="{y(piv):.1f}" y2="{y(piv):.1f}" stroke="{NAVY}" stroke-dasharray="4 2" stroke-width=".9"/>'
                   f'<text x="8" y="{(y(piv)-2) if y(piv)-top > 11 else (y(piv)+9):.1f}" class="pv">Pivot {piv:,.2f}</text>')
    for arr, col, sw in ((m200, INK, 1), (m50, "#d23a2a", 1.2)):
        pts = " ".join(f"{x(i):.1f},{y(v):.1f}" for i, v in enumerate(arr) if v)
        if pts:
            out.append(f'<polyline points="{pts}" fill="none" stroke="{col}" stroke-width="{sw}"/>')
    bw = max(0.6, min(2.2, pw / n * 0.45))
    for i, p in enumerate(P):
        prev = P[i - 1][4] if i else p[1]
        col = UP if p[4] >= prev else DOWN
        xx = x(i)
        out.append(f'<path d="M{xx:.1f} {y(p[2]):.1f}V{y(p[3]):.1f}M{xx:.1f} {y(p[4]):.1f}h{bw+0.8:.1f}" stroke="{col}" stroke-width="{bw:.1f}"/>')
        out.append(f'<rect x="{xx-bw/2:.1f}" y="{vy(p[5]):.1f}" width="{max(.6, pw/n*0.6):.1f}" height="{h-12-vy(p[5]):.1f}" fill="{col}" opacity=".55"/>')
    last = P[-1][4]
    out.append(f'<rect x="{w-pad_r+1}" y="{y(last)-6:.1f}" width="{pad_r-2}" height="12" fill="{INK}"/><text x="{w-pad_r+3}" y="{y(last)+3:.1f}" class="lt">{last:,.2f}</text>')
    if title:
        row = b.get("row") or {}
        rs = (b.get("fund") or {}).get("rs") or row.get("rsRating")
        st = base.get("status") or ""
        nm = (b.get("name") or "")[:34]
        out.append(f'<text x="4" y="13" class="ct"><tspan class="cs">{E(b.get("symbol",""))}</tspan>  {E(nm)}</text>'
                   f'<text x="{w-2}" y="13" class="cr" text-anchor="end">{("RS " + str(rs)) if rs else ""}{("  ·  " + E(st)) if st else ""}</text>')
    out.append("</svg>")
    return "".join(out)


def spark(vals, w=90, h=22, col=NAVY):
    vals = [v for v in vals if v is not None]
    if len(vals) < 2:
        return ""
    lo, hi = min(vals), max(vals)
    rng = (hi - lo) or 1
    pts = " ".join(f"{i*(w-2)/(len(vals)-1)+1:.1f},{h-2-(v-lo)/rng*(h-4):.1f}" for i, v in enumerate(vals))
    c = GREEN if vals[-1] >= vals[0] else DOWN
    return f'<svg viewBox="0 0 {w} {h}" width="{w}" height="{h}"><polyline points="{pts}" fill="none" stroke="{c}" stroke-width="1.3"/></svg>'


def hbars(rows, w=330, row_h=17, label_w=110, fmt=lambda v: pct(v)):
    """Horizontal bars around zero: rows = [(label, value)]."""
    if not rows:
        return ""
    vmax = max(abs(v) for _, v in rows if v is not None) or 1
    h = row_h * len(rows) + 4
    mid = label_w + (w - label_w - 44) / 2
    half = (w - label_w - 44) / 2
    out = [f'<svg viewBox="0 0 {w} {h}" width="{w}" height="{h}" class="hb"><line x1="{mid}" x2="{mid}" y1="0" y2="{h}" stroke="{INK2}" stroke-width=".6"/>']
    for k, (lab, v) in enumerate(rows):
        yy = 2 + k * row_h
        v = v or 0
        bw = abs(v) / vmax * half
        x0 = mid if v >= 0 else mid - bw
        out.append(f'<text x="0" y="{yy+12}" class="hl">{E(lab)}</text>'
                   f'<rect x="{x0:.1f}" y="{yy+3}" width="{max(bw, .8):.1f}" height="{row_h-6}" fill="{GREEN if v >= 0 else DOWN}"/>'
                   f'<text x="{(mid+bw+4) if v >= 0 else (mid-bw-4):.1f}" y="{yy+12}" class="hv" text-anchor="{"start" if v >= 0 else "end"}">{fmt(v)}</text>')
    out.append("</svg>")
    return "".join(out)


def line_chart(series, w=330, h=120, labels=None, fmt=lambda v: f"{v:.0f}%", lo=None, hi=None):
    """Simple multi-line chart: series = [(name, color, values)]."""
    vals = [v for _, _, s in series for v in s if v is not None]
    if not vals:
        return ""
    lo = min(vals) if lo is None else lo
    hi = max(vals) if hi is None else hi
    rng = (hi - lo) or 1
    n = max(len(s) for _, _, s in series)
    pw, top, bot = w - 34, 16, h - 14
    x = lambda i: 2 + i * pw / max(1, n - 1)
    y = lambda v: bot - (v - lo) / rng * (bot - top)
    out = [f'<svg viewBox="0 0 {w} {h}" width="{w}" height="{h}" class="lc"><rect x="2" y="{top}" width="{pw}" height="{bot-top}" fill="#fff" stroke="{INK}" stroke-width=".6"/>']
    for k in range(0, 5):
        v = lo + rng * k / 4
        out.append(f'<line x1="2" x2="{2+pw}" y1="{y(v):.1f}" y2="{y(v):.1f}" stroke="{RULE}" stroke-dasharray="1 2" stroke-width=".6"/><text x="{pw+5}" y="{y(v)+3:.1f}" class="ax">{fmt(v)}</text>')
    lx = 4
    for name, col, s in series:
        pts = " ".join(f"{x(i):.1f},{y(v):.1f}" for i, v in enumerate(s) if v is not None)
        out.append(f'<polyline points="{pts}" fill="none" stroke="{col}" stroke-width="1.4"/><rect x="{lx}" y="5" width="9" height="3" fill="{col}"/><text x="{lx+12}" y="10" class="ax">{E(name)}</text>')
        lx += 14 + len(name) * 5.2
    if labels:
        for i in (0, n // 2, n - 1):
            if i < len(labels):
                out.append(f'<text x="{x(i):.1f}" y="{h-2}" class="ax" text-anchor="{"start" if i == 0 else "end" if i == n-1 else "middle"}">{E(labels[i])}</text>')
    out.append("</svg>")
    return "".join(out)


def perf_series(D, syms, start: str, step=1):
    """Performance % since `start` for each symbol, aligned on the first symbol's dates."""
    data = {}
    for s in syms:
        b = D.bundle(s)
        if b and b.get("prices"):
            data[s] = {p[0]: p[4] for p in b["prices"] if p[0] >= start}
    if not data:
        return [], []
    dates = sorted(set().union(*[set(v) for v in data.values()]))
    out = []
    for s, v in data.items():
        base, last, ser = None, None, []
        for d in dates:
            c = v.get(d, last)
            last = c
            if c is not None and base is None:
                base = c
            ser.append(None if c is None or base is None else (c / base - 1) * 100)
        out.append((s, ser[::step]))
    return dates[::step], out


CMP_COL = {"SPY": INK, "QQQ": NAVY, "IWM": GREEN, "RSP": AMBER, "DIA": "#7b4bb3", "MAGS": DOWN}


def ytd_chart(D, syms, year: int, w=700, h=210):
    dates, ser = perf_series(D, syms, f"{year}-01-01")
    if not ser:
        return ""
    labs = [dt.date.fromisoformat(d).strftime("%b %-d") for d in dates]
    return line_chart([(f"{s} {pct(v[-1]) if v and v[-1] is not None else ''}", CMP_COL.get(s, INK2), v) for s, v in ser], w=w, h=h, labels=labs,
                      fmt=lambda v: f"{v:+.0f}%")


def commodities_table(com, X=None, weekly=False):
    rows = []
    for r in com:
        x = (X or {}).get(r.get("symbol")) or {}
        unit = E(r.get("unit") or "")
        if weekly:
            rows.append(f'<tr><td><b>{E(r.get("name",""))}</b> <small>{E(r.get("symbol","").replace("=F",""))} · {unit}</small></td><td>{px(r.get("close"))}</td>'
                        f'<td class="{cls(r.get("w1"))}">{pct(r.get("w1"))}</td><td class="{cls(r.get("m3"))}">{pct(r.get("m3"))}</td><td class="{cls(r.get("ytd"))}">{pct(r.get("ytd"))}</td><td>{spark(r.get("spark",[])[-63:])}</td></tr>')
        else:
            rows.append(f'<tr><td><b>{E(r.get("name",""))}</b> <small>{E(r.get("symbol","").replace("=F",""))} · {unit}</small></td><td>{px(r.get("close"))}</td>'
                        f'<td class="{cls(r.get("d1"))}">{pct(r.get("d1"))}</td><td class="{cls(x.get("pm"))}">{pct(x.get("pm"))}</td><td class="{cls(r.get("ytd"))}">{pct(r.get("ytd"))}</td><td>{spark(r.get("spark",[])[-40:])}</td></tr>')
    head = ["Futures", "Last", "Week", "3 months", "YTD", "Trend"] if weekly else ["Futures", "Last", "Yesterday", "Overnight", "YTD", "Trend"]
    return table(head, rows)


def t12(t):
    h, m = map(int, t.split(":"))
    return f"{(h + 11) % 12 + 1}:{m:02d} {'a.m.' if h < 12 else 'p.m.'}"


def mval(v, x):
    if x is None:
        return "—"
    u, chg = v.get("unit"), "change" in v.get("name", "")
    if u == "%":
        return f"{x:+.1f}%" if chg else f"{x:.1f}%"
    if u == "k":
        return f"{x:+.0f}k" if chg else f"{x:.0f}k"
    if u == "M":
        return f"{x:.2f}M"
    return f"{x:.2f}"


def macro_rows(events, show_day=False):
    rows = []
    for e in events:
        vals = "<br>".join(f'<small>{E(v["name"])}</small> {mval(v, v.get("last"))}' for v in e.get("values", []))
        imp = "●" * e["imp"] + "○" * (3 - e["imp"])
        day = f'{dt.date.fromisoformat(e["date"]).strftime("%a %b %-d")} · ' if show_day else ""
        rows.append(f'<tr class="{"hi" if e["imp"] == 3 else ""}"><td>{day}{t12(e["time"])}</td><td class="imp">{imp}</td><td><b class="ev">{E(e["name"])}</b>{f" <small>{E(e["period"])}</small>" if e.get("period") else ""}</td><td>{vals}</td></tr>')
    return rows


def fed_block(fed, sep=()):
    """The Fed odds: next meeting bar and the rate path table."""
    if not fed or not fed.get("meetings"):
        return ""
    m0 = fed["meetings"][0]
    mv = sorted(((int(k), p) for k, p in (m0.get("move") or {}).items()), key=lambda t: t[0])
    lbl = lambda bp: f"Cut {-bp} bp" if bp < 0 else f"Hike {bp} bp" if bp > 0 else "Hold"
    col = lambda bp: GREEN if bp < 0 else DOWN if bp > 0 else NAVY
    bar = "".join(f'<span style="flex:{p};background:{col(bp)}">{lbl(bp) + f" {p:.0f}%" if p >= 12 else ""}</span>' for bp, p in mv)
    rows = []
    for m in fed["meetings"][:6]:
        best = max(m.get("ranges") or [{"lower": 0, "upper": 0, "prob": 0}], key=lambda r: r["prob"])
        rows.append(f'<tr><td><b>{dt.date.fromisoformat(m["date"]).strftime("%b %-d, %Y")}</b>{" <span class=tag>SEP</span>" if m["date"] in sep else ""}</td><td>{m["implied"]:.2f}%</td>'
                    f'<td class="{"up" if m["cum"] < 0 else "dn" if m["cum"] > 0 else ""}">{m["cum"]:+.0f} bp</td><td>{best["lower"]:.2f}–{best["upper"]:.2f}%</td><td>{best["prob"]:.0f}%</td></tr>')
    return (f'<div class="g2"><div><div class="msx g"><span>Fed target range</span><b>{fed["lower"]:.2f}% – {fed["upper"]:.2f}%</b><small>Effective rate {fed["effr"]:.2f}%</small></div>'
            f'<p class="h3s">Odds for the {dt.date.fromisoformat(m0["date"]).strftime("%B %-d")} meeting</p><div class="fbar">{bar}</div></div>'
            f'<div>{table(["Meeting", "Implied", "vs today", "Most likely", "Odds"], rows)}</div></div>')


# ---------------------------------------------------------------- desk notes
def desk_note(date: str) -> str:
    p = ROOT / "research" / "notes.md"
    if not p.exists():
        return ""
    m = re.search(rf"^##\s*{re.escape(date)}\s*$(.*?)(?=^##\s|\Z)", p.read_text(), flags=re.M | re.S)
    if not m:
        return ""
    txt = m.group(1).strip()
    return "".join(f"<p>{E(par.strip())}</p>" for par in re.split(r"\n\s*\n", txt) if par.strip())


# ---------------------------------------------------------------- building blocks
def logo_uri():
    p = ROOT / "site" / "img" / "logo.svg"
    return "data:image/svg+xml;base64," + base64.b64encode(p.read_bytes()).decode() if p.exists() else ""


def masthead(kind: str, date: str, no: int, sub: str) -> str:
    title = "The Daily Tape" if kind == "daily" else "The Weekly Tape"
    return f"""<header class="mast"><div class="brand"><img src="{logo_uri()}" alt=""><div><b>Ticker&amp;Tape</b><span>Research</span></div></div>
      <div class="mt"><h1>{title}</h1><p>{E(sub)}</p></div>
      <div class="ed"><b>No. {no:03d}</b><span>{fdate(date, "%b %-d, %Y")}</span></div></header>"""


def foot(page: int, pages: int, date: str) -> str:
    return f"""<footer class="pf"><span>Ticker&amp;Tape · tickerandtape.com · @Tickerandtape</span><span>{fdate(date, "%B %-d, %Y")}</span><span>{page} / {pages}</span></footer>"""


def market_status(meta) -> list[dict]:
    return (meta or {}).get("market") or []


def status_chip(m):
    st = m.get("status", "")
    c = {"Uptrend": "g", "Uptrend under pressure": "a", "Rally attempt": "n", "Correction": "r"}.get(st, "n")
    return f'<div class="msx {c}"><span>{E(m.get("name",""))}</span><b>{E(st)}</b><small>{m.get("distDays", 0)} distribution day{"s" if m.get("distDays") != 1 else ""}</small></div>'


STATUS_LINE = {"Uptrend": "a confirmed uptrend: the backdrop favors buying breakouts from sound bases",
               "Uptrend under pressure": "an uptrend under pressure: be selective and keep stops tight",
               "Rally attempt": "a rally attempt: wait for a follow-through day before buying aggressively",
               "Correction": "a correction: protect capital, most breakouts fail in this phase"}


def table(head, rows, cls_=""):
    th = "".join(f"<th>{h}</th>" for h in head)
    return f'<table class="t {cls_}"><thead><tr>{th}</tr></thead><tbody>{"".join(rows)}</tbody></table>' if rows else ""


def empty(msg):
    return f'<p class="none">{E(msg)}</p>'


def th(rows: int) -> int:
    """Rough height in px of a section heading plus a table of single-line rows (an empty note when there are none)."""
    return 34 + (24 + 23 * rows if rows else 22)


PAGE_ROOM = 800     # px of content under the masthead on a Letter page
MAX_PAGES = 5


def paginate(kind: str, date: str, no: int, first: str, secs: list, disc: str, first_h: int = PAGE_ROOM) -> str:
    """Page 1 as given (first_h: its estimated height), then the sections packed onto as few pages as fit (at most five),
    starting in the room left on page 1; the disclaimer closes the last page."""
    pages, cur, room, title = [], [], PAGE_ROOM - first_h, "__first"
    for t, h_, est in secs:
        if est > room and cur:
            if len(pages) + 1 >= MAX_PAGES:
                continue          # the last page is full: skip this section, a smaller one may still fit
            pages.append((title, cur)); cur, room, title = [], PAGE_ROOM, None
        elif est > room and not cur and title == "__first":
            pages.append((title, cur)); cur, room, title = [], PAGE_ROOM, None
        cur.append(h_); room -= est + 8; title = title or t
    if cur and len(pages) < MAX_PAGES:
        pages.append((title, cur))
    if not pages or pages[0][0] != "__first":
        pages.insert(0, ("__first", []))
    n = len(pages)
    out = []
    for i, pg in enumerate(pages):
        body = (first if i == 0 else masthead(kind, date, no, pg[0])) + "".join(pg[1])
        last = i == n - 1
        out.append(f'<section class="page">{body}{f"<div class=disc>{disc}</div>" if last else ""}{foot(i + 1, n, date)}</section>')
    return "".join(out)


# ---------------------------------------------------------------- the Daily
def build_daily(D: Data, today: dt.date, no: int, demo=False) -> tuple[str, dict]:
    meta, uni, earn, ideas, home = D.get("meta.json", {}), D.get("universe.json", []), D.get("earnings.json", {}), D.get("ideas.json", {}), D.get("home.json", {})
    mac = D.get("macro.json", {}) or {}
    date = today.isoformat()
    cal_today = [e for e in mac.get("events", []) if e.get("date") == date and e.get("imp", 0) >= 2]
    ddate = (meta or {}).get("dataDate") or ""
    by_sym = {r["symbol"]: r for r in uni}
    lead = leaders_of(uni, 70)
    events = (earn or {}).get("events") or []
    prev_rep = [e for e in events if e.get("date") == ddate and e.get("time") != "bmo"]          # after yesterday's close (or time unknown)
    today_rep = [e for e in events if e.get("date") == date]
    com = (home or {}).get("commodities") or []
    syms = sorted({r["symbol"] for r in lead} | {e["symbol"] for e in prev_rep + today_rep} | {"SPY", "QQQ", "IWM", "ES=F", "NQ=F", "RTY=F"} | {r["symbol"] for r in com if r.get("symbol")})
    X = ext_moves(syms, today, demo)

    # futures and indexes
    fut = [(n, X.get(s, {}).get("pm")) for s, n in (("ES=F", "S&P 500 futures"), ("NQ=F", "Nasdaq-100 futures"), ("RTY=F", "Russell 2000 futures"))]
    mkt = {r["symbol"]: r for r in (home or {}).get("market", [])}
    idx_rows = []
    for s in ("SPY", "QQQ", "IWM", "DIA", "RSP"):
        r = mkt.get(s)
        if r:
            idx_rows.append(f'<tr><td><b>{s}</b> <small>{E(r.get("name",""))}</small></td><td>{px(r.get("close"))}</td><td class="{cls(r.get("d1"))}">{pct(r.get("d1"),2)}</td>'
                            f'<td class="{cls(X.get(s,{}).get("pm"))}">{pct(X.get(s,{}).get("pm"),2)}</td><td>{spark(r.get("spark",[])[-40:])}</td></tr>')

    # overnight movers among leaders
    mv = []
    for r in lead:
        x = X.get(r["symbol"]) or {}
        mvv = x.get("pm") if x.get("pm") is not None else x.get("ah")
        if mvv is not None and abs(mvv) >= 2:
            mv.append((r, x, mvv))
    mv.sort(key=lambda t: -abs(t[2]))
    rep_syms = {e["symbol"] for e in prev_rep + today_rep}
    mv_up = [t for t in mv if t[2] > 0][:7]
    mv_dn = [t for t in mv if t[2] < 0][:7]

    def mv_row(t):
        r, x, v = t
        tag = '<span class="tag">Earnings</span>' if r["symbol"] in rep_syms else ""
        return (f'<tr><td><b>{E(r["symbol"])}</b> {tag} <small>{E((r.get("name") or "")[:26])}</small></td><td>{r.get("rsRating","")}</td>'
                f'<td class="{cls(x.get("ah"))}">{pct(x.get("ah"))}</td><td class="{cls(x.get("pm"))}">{pct(x.get("pm"))}</td><td>{E((r.get("base") or {}).get("status") or "")}</td></tr>')

    # earnings
    def rep_row(e, show_act=True):
        x = X.get(e["symbol"]) or {}
        react = x.get("pm") if x.get("pm") is not None else x.get("ah")
        r = by_sym.get(e["symbol"]) or {}
        st = (r.get("base") or {}).get("status") or ""
        if show_act:
            res = "—" if e.get("epsAct") is None else f'{e["epsAct"]:.2f} vs {e.get("epsEst") or 0:.2f}'
            sur = e.get("surprise")
            verdict = "" if sur is None else ('<span class="beat">Beat</span>' if sur > 0 else '<span class="miss">Miss</span>' if sur < 0 else "In line")
            return (f'<tr><td><b>{E(e["symbol"])}</b> <small>{E((e.get("name") or "")[:24])}</small></td><td>{e.get("rs") or ""}</td><td>{res}</td>'
                    f'<td class="{cls(sur)}">{pct(sur)} {verdict}</td><td class="{cls(react)}">{pct(react)}</td></tr>')
        when = {"bmo": "Before open", "amc": "After close"}.get(e.get("time"), "—")
        return (f'<tr><td><b>{E(e["symbol"])}</b> <small>{E((e.get("name") or "")[:24])}</small></td><td>{when}</td><td>{e.get("rs") or ""}</td>'
                f'<td>{n2(e.get("epsEst"))}</td><td class="{cls(react)}">{pct(react) if e.get("time") == "bmo" else ""}</td><td>{E(st)}</td></tr>')

    imp = lambda e: (e.get("rs") or 0) + (math.log10(e["mcap"]) * 10 if e.get("mcap") else 0)
    prev_rep.sort(key=lambda e: -imp(e))
    today_rep.sort(key=lambda e: -imp(e))

    # breakouts and near pivot
    brk = [r for r in uni if not r.get("etf") and (r.get("base") or {}).get("status") == "Breakout" and (r.get("base") or {}).get("breakoutDate") == ddate]
    brk.sort(key=lambda r: -(r.get("rsRating") or 0))
    near = [r for r in leaders_of(uni, 80) if (r.get("base") or {}).get("status") == "Near pivot"]
    near.sort(key=lambda r: (-(r.get("rsRating") or 0)))
    near = near[:10]
    charts = [r["symbol"] for r in brk[:2]] + [r["symbol"] for r in near[:4]]
    charts = list(dict.fromkeys(charts))[:4]

    # sectors yesterday
    sec = sorted(((r.get("name", ""), r.get("d1")) for r in (home or {}).get("sectors", [])), key=lambda t: -(t[1] or 0))

    # takeaways written from the numbers
    tk = []
    ms = market_status(meta)
    if ms:
        nas = next((m for m in ms if m["name"].startswith("Nasdaq")), ms[0])
        tk.append(f'The Nasdaq is in {STATUS_LINE.get(nas.get("status"), nas.get("status","").lower())}.')
    f0 = fut[0][1]
    if f0 is not None:
        tk.append(f'S&amp;P 500 futures are {"up" if f0 >= 0 else "down"} {abs(f0):.1f}% before the open.')
    if sec:
        tk.append(f'{E(sec[0][0])} led yesterday ({pct(sec[0][1])}) and {E(sec[-1][0])} lagged ({pct(sec[-1][1])}).')
    if com:
        cm = max(com, key=lambda r: abs(r.get("d1") or 0))
        if cm.get("d1") is not None and abs(cm["d1"]) >= 1:
            tk.append(f'In commodities, {E(cm.get("name","").lower())} moved {pct(cm["d1"])} yesterday.')
    if mv:
        t = mv[0]
        tk.append(f'Biggest overnight move among leaders: <b>{E(t[0]["symbol"])}</b> {pct(t[2])}{" on earnings" if t[0]["symbol"] in rep_syms else ""}.')
    if brk:
        tk.append(f'{len(brk)} stock{"s" if len(brk) != 1 else ""} broke out yesterday' + (f', led by <b>{E(brk[0]["symbol"])}</b> (RS {brk[0].get("rsRating")})' if brk else "") + '.')
    if near:
        tk.append(f'{len(near)} leaders sit within 5% of a buy point: ' + ", ".join(f"<b>{E(r['symbol'])}</b>" for r in near[:4]) + '.')
    hi_today = [e for e in cal_today if e["imp"] == 3]
    if hi_today:
        tk.insert(min(2, len(tk)), "On the macro calendar today: " + ", ".join(f"<b>{E(e['name'])}</b> at {t12(e['time'])} ET" for e in hi_today[:3]) + ".")
    fed = mac.get("fed") or {}
    if fed.get("meetings"):
        m0 = fed["meetings"][0]
        if (dt.date.fromisoformat(m0["date"]) - today).days <= 14:
            mvs = sorted(((int(k), p) for k, p in (m0.get("move") or {}).items()), key=lambda t: -t[1])
            if mvs:
                bp, p = mvs[0]
                tk.insert(min(3, len(tk)), f'Fed on {dt.date.fromisoformat(m0["date"]).strftime("%B %-d")}: futures price a {p:.0f}% chance of {"a " + str(-bp) + " bp cut" if bp < 0 else "a " + str(bp) + " bp hike" if bp > 0 else "no change"}.')
    if today_rep:
        big = today_rep[:3]
        tk.append("Reporting today: " + ", ".join(f"<b>{E(e['symbol'])}</b>" for e in big) + (f" and {len(today_rep)-3} more" if len(today_rep) > 3 else "") + ".")

    note = desk_note(date)
    news = ((home or {}).get("news") or [])[:5]

    p1 = f"""{masthead("daily", date, no, "Before the bell · " + fdate(date))}
      <div class="g2"><div>
        <h2>Five things to know</h2><ul class="tk">{"".join(f"<li>{t}</li>" for t in tk[:6])}</ul>
        {f'<div class="desk"><h3>Desk notes</h3>{note}<p class="sig">— Gonzalo Sanchez Lachowicz</p></div>' if note else ""}
      </div><div>
        <h2>Market direction</h2><div class="msr">{"".join(status_chip(m) for m in ms)}</div>
        <h2>Futures before the open</h2><div class="fut">{"".join(f'<div><span>{E(n)}</span><b class="{cls(v)}">{pct(v,2)}</b></div>' for n, v in fut)}</div>
        <h2>Indexes</h2>{table(["", "Close", "Day", "Pre-mkt", "2 months"], idx_rows, "idx")}
      </div></div>
      <h2>Sectors yesterday</h2>{hbars(sec, w=700, row_h=15, label_w=170)}
      {f'<h2>Headlines</h2><ul class="news">{"".join(f"<li><b>{E(n.get("title",""))}</b> <small>{E(n.get("pub",""))}</small></li>" for n in news)}</ul>' if news else ""}"""

    brk_rows = [f'<tr><td><b>{E(r["symbol"])}</b> <small>{E((r.get("name") or "")[:26])}</small></td><td>{r.get("rsRating","")}</td><td>{px(r.get("close"))}</td><td>{px((r.get("base") or {}).get("pivot"))}</td><td class="{cls(r.get("volVsAvgPct"))}">{pct(r.get("volVsAvgPct"),0)}</td><td>{E((r.get("base") or {}).get("type") or "")}, {(r.get("base") or {}).get("weeks") or "?"} wks</td></tr>' for r in brk[:8]]
    near_rows = [f'<tr><td><b>{E(r["symbol"])}</b> <small>{E((r.get("name") or "")[:26])}</small></td><td>{r.get("rsRating","")}</td><td>{px(r.get("close"))}</td><td>{px((r.get("base") or {}).get("pivot"))}</td><td>{pct((r.get("base") or {}).get("distPct"))}</td><td>{E(r.get("groupRank") or "")}</td></tr>' for r in near[:8]]
    mvh = ["Stock", "RS", "After hrs", "Pre-mkt", "Setup"]
    chart_html = "".join(f'<div class="ch">{price_chart(D.bundle(s))}</div>' for s in charts)
    secs = [
        ("Overnight movers", f"""<p class="lede">Leaders (RS Rating 70+ and $20M+ traded a day) moving 2% or more after yesterday's close or before today's open.</p>
          <div class="g2"><div><h2 class="up">Higher</h2>{table(mvh, [mv_row(t) for t in mv_up]) or empty("No leader is up 2% or more overnight.")}</div>
          <div><h2 class="dn">Lower</h2>{table(mvh, [mv_row(t) for t in mv_dn]) or empty("No leader is down 2% or more overnight.")}</div></div>""", 40 + th(max(len(mv_up), len(mv_dn)))),
        ("Macro calendar today", f"""<h2>Macro calendar today · New York time</h2>{table(["Time", "", "Release", "Prior"], macro_rows(cal_today)) or empty("No major economic release today.")}""", th(len(cal_today))),
        ("Commodities", f"""<h2>Commodities · futures</h2>{commodities_table(com, X) or empty("No futures data.")}""", 58 + 34 * len(com)),
        ("Earnings after yesterday's close", f"""<h2>Earnings after yesterday's close</h2>{table(["Company", "RS", "EPS vs est.", "Surprise", "Reaction"], [rep_row(e) for e in prev_rep[:8]]) or empty("No company in our coverage reported after yesterday's close.")}""", th(len(prev_rep[:8]))),
        ("Reporting today", f"""<h2>Reporting today</h2>{table(["Company", "When", "RS", "EPS est.", "Pre-mkt", "Setup"], [rep_row(e, False) for e in today_rep[:12]]) or empty("No company in our coverage reports today.")}""", th(len(today_rep[:12]))),
        ("Breakouts yesterday", f"""<h2>Breakouts yesterday</h2>{table(["Stock", "RS", "Close", "Pivot", "Vol vs avg", "Base"], brk_rows) or empty("No stock in our coverage broke out of a base yesterday.")}""", th(len(brk_rows))),
        ("Watch list", f"""<h2>Near a buy point · within 5% of the pivot</h2>{table(["Stock", "RS", "Close", "Pivot", "To pivot", "Group"], near_rows) or empty("No leader is within 5% of a pivot today.")}""", th(len(near_rows))),
    ]
    if chart_html:
        secs.append(("Charts to watch", f'<h2>Charts to watch</h2><div class="charts">{chart_html}</div>', 34 + 214 * ((len(charts) + 1) // 2)))
    disc = f"""<b>About this report.</b> The Daily Tape is generated automatically from Ticker&amp;Tape data: end-of-day prices, ratings and bases from the last close, and after-hours and pre-market prices as of {E(X_TIME)} ET. RS Rating ranks 12-month performance from 1 to 99. Ratings, bases and pivots are calculated automatically and can be wrong. This is a research tool, not investment advice; do your own analysis before you trade."""
    summary = [re.sub("<[^>]+>", "", t).replace("&amp;", "&") for t in tk[:3]]
    return wrap(f"The Daily Tape · {fdate(date, '%b %-d, %Y')}", paginate("daily", date, no, p1, secs, disc, first_h=640)), {"kind": "daily", "date": date, "no": no,
            "title": f"The Daily Tape · {fdate(date, '%A, %B %-d, %Y')}", "summary": summary}


X_TIME = "8:15 a.m."


# ---------------------------------------------------------------- the Weekly
def build_weekly(D: Data, today: dt.date, no: int, demo=False) -> tuple[str, dict]:
    mac = D.get("macro.json", {}) or {}
    meta, uni, earn, ideas, home, groups, br = (D.get("meta.json", {}), D.get("universe.json", []), D.get("earnings.json", {}), D.get("ideas.json", {}),
                                               D.get("home.json", {}), D.get("groups.json", {}), D.get("breadth.json", {}))
    date = today.isoformat()
    ddate = (meta or {}).get("dataDate") or date
    end = dt.date.fromisoformat(ddate)
    start = end - dt.timedelta(days=end.weekday())
    wk = f"Week of {start.strftime('%B %-d')} – {end.strftime('%B %-d, %Y')}"
    ms = market_status(meta)
    mkt = (home or {}).get("market", [])
    sec = sorted(((r.get("name", ""), r.get("w1")) for r in (home or {}).get("sectors", [])), key=lambda t: -(t[1] or 0))
    com = (home or {}).get("commodities", [])
    idx_rows = [f'<tr><td><b>{E(r["symbol"])}</b> <small>{E(r.get("name",""))}</small></td><td>{px(r.get("close"))}</td><td class="{cls(r.get("w1"))}">{pct(r.get("w1"),2)}</td>'
                f'<td class="{cls(r.get("ytd"))}">{pct(r.get("ytd"))}</td><td>{spark(r.get("spark",[])[-63:])}</td></tr>' for r in mkt]
    lead = leaders_of(uni, 80)
    best = sorted([r for r in lead if r.get("perf1w") is not None], key=lambda r: -r["perf1w"])[:8]
    weekbrk = [r for r in uni if not r.get("etf") and (r.get("base") or {}).get("breakoutDate") and str((r.get("base") or {}).get("breakoutDate")) >= start.isoformat()
               and (r.get("base") or {}).get("status") in ("Breakout", "In buy zone")]
    weekbrk.sort(key=lambda r: -(r.get("rsRating") or 0))
    near = sorted([r for r in lead if (r.get("base") or {}).get("status") == "Near pivot"], key=lambda r: -(r.get("rsRating") or 0))[:8]
    g = (groups or {}).get("groups", [])
    for x in g:
        x["move"] = (x.get("r1w") or x.get("rank")) - x.get("rank", 0)
    g_up = sorted(g, key=lambda x: -x["move"])[:5]
    g_top = sorted(g, key=lambda x: x.get("rank", 999))[:5]
    events = (earn or {}).get("events") or []
    this_w = [e for e in events if e.get("w") == 1 or (start.isoformat() <= (e.get("date") or "") <= end.isoformat())]
    this_w = [e for e in this_w if e.get("epsAct") is not None]
    imp = lambda e: (e.get("rs") or 0) + (math.log10(e["mcap"]) * 10 if e.get("mcap") else 0)
    this_w.sort(key=lambda e: -imp(e))
    nxt = sorted([e for e in events if e.get("w") == 2 or (e.get("date") or "") > end.isoformat()], key=lambda e: -imp(e))[:12]
    beats = [e for e in this_w if (e.get("surprise") or 0) > 0]

    # breadth, last 3 months
    bg = ((br or {}).get("groups") or {}).get("all") or {}
    dates = (br or {}).get("dates") or []
    k0 = max(0, len(dates) - 63)
    a50 = (bg.get("a50") or [])[k0:]
    a200 = (bg.get("a200") or [])[k0:]
    labs = [dt.date.fromisoformat(d).strftime("%b %-d") for d in dates[k0:]] if dates else None
    nh, nl = (bg.get("nh") or [])[-5:], (bg.get("nl") or [])[-5:]

    tk = []
    if ms:
        nas = next((m for m in ms if m["name"].startswith("Nasdaq")), ms[0])
        tk.append(f'The Nasdaq ends the week in {STATUS_LINE.get(nas.get("status"), nas.get("status","").lower())}.')
    spy = next((r for r in mkt if r["symbol"] == "SPY"), None)
    qqq = next((r for r in mkt if r["symbol"] == "QQQ"), None)
    if spy and qqq:
        tk.append(f'SPY {pct(spy.get("w1"))} and QQQ {pct(qqq.get("w1"))} on the week.')
    rsp = next((r for r in mkt if r["symbol"] == "RSP"), None)
    if spy and rsp and spy.get("w1") is not None and rsp.get("w1") is not None:
        tk.append("The average stock " + ("beat" if rsp["w1"] > spy["w1"] else "lagged") + f' the index: RSP {pct(rsp["w1"])} vs SPY {pct(spy["w1"])}.')
    if sec:
        tk.append(f'{E(sec[0][0])} was the best sector ({pct(sec[0][1])}); {E(sec[-1][0])} the worst ({pct(sec[-1][1])}).')
    if a50:
        tk.append(f'{a50[-1]:.0f}% of stocks trade above their 50-day line' + (f', {"up" if a50[-1] >= a50[-6] else "down"} from {a50[-6]:.0f}% a week ago' if len(a50) > 6 else "") + ".")
    if com:
        cm = max(com, key=lambda r: abs(r.get("w1") or 0))
        if cm.get("w1") is not None:
            tk.append(f'Biggest move in commodities: {E(cm.get("name","").lower())} {pct(cm["w1"])} on the week.')
    if this_w:
        tk.append(f'{len(beats)} of {len(this_w)} companies we cover beat EPS estimates this week.')
    if weekbrk:
        tk.append(f'{len(weekbrk)} breakouts held this week, led by <b>{E(weekbrk[0]["symbol"])}</b>.')
    note = desk_note(date)
    stats = (ideas or {}).get("stats") or {}
    hist = [h for h in (ideas or {}).get("history") or [] if h.get("result") != "Active"][-8:]
    cotw = (weekbrk[:1] or best[:1] or near[:1])
    cotw_sym = cotw[0]["symbol"] if cotw else None
    p1 = f"""{masthead("weekly", date, no, wk)}
      <div class="g2"><div>
        <h2>The week in eight lines</h2><ul class="tk">{"".join(f"<li>{t}</li>" for t in tk[:8])}</ul>
        {f'<div class="desk"><h3>Desk notes</h3>{note}<p class="sig">— Gonzalo Sanchez Lachowicz</p></div>' if note else ""}
      </div><div>
        <h2>Market direction</h2><div class="msr">{"".join(status_chip(m) for m in ms)}</div>
        <h2>Indexes</h2>{table(["", "Close", "Week", "YTD", "3 months"], idx_rows, "idx")}
      </div></div>
      <h2>Sectors this week</h2>{hbars(sec, w=700, row_h=15, label_w=170)}"""

    def er(e):
        sur = e.get("surprise")
        return (f'<tr><td><b>{E(e["symbol"])}</b> <small>{E((e.get("name") or "")[:22])}</small></td><td>{e.get("rs") or ""}</td><td>{"—" if e.get("epsAct") is None else n2(e.get("epsAct")) + " vs " + n2(e.get("epsEst"))}</td>'
                f'<td class="{cls(sur)}">{pct(sur)}</td><td class="{cls(e.get("reactPct"))}">{pct(e.get("reactPct"))}</td></tr>')

    by_sym = {x["symbol"]: x for x in uni}

    def en(e):
        when = {"bmo": "Before open", "amc": "After close"}.get(e.get("time"), "")
        r = by_sym.get(e["symbol"]) or {}
        return (f'<tr><td><b>{E(e["symbol"])}</b> <small>{E((e.get("name") or "")[:22])}</small></td><td>{fdate(e["date"], "%a %b %-d")} {when}</td><td>{e.get("rs") or ""}</td>'
                f'<td>{n2(e.get("epsEst"))}</td><td>{E((r.get("base") or {}).get("status") or "")}</td></tr>')

    climb = [x for x in g_up if x["move"] > 0]
    best_rows = [f'<tr><td><b>{E(r["symbol"])}</b> <small>{E((r.get("name") or "")[:28])}</small></td><td>{r.get("rsRating","")}</td><td>{px(r.get("close"))}</td><td class="{cls(r.get("perf1w"))}">{pct(r.get("perf1w"))}</td><td>{E(r.get("groupRank") or "")}</td><td>{E((r.get("base") or {}).get("status") or "")}</td></tr>' for r in best]
    wb_rows = [f'<tr><td><b>{E(r["symbol"])}</b> <small>{E((r.get("name") or "")[:28])}</small></td><td>{r.get("rsRating","")}</td><td>{px(r.get("close"))}</td><td>{px((r.get("base") or {}).get("pivot"))}</td><td>{pct((r.get("base") or {}).get("distPct"))}</td><td>{E((r.get("base") or {}).get("type") or "")}</td></tr>' for r in weekbrk[:8]]
    hist_rows = [f'<tr><td><b>{E(h["symbol"])}</b></td><td>{fdate(h["date"], "%b %-d")}</td><td>{px(h.get("pivot"))}</td><td class="{cls(h.get("maxPct"))}">{pct(h.get("maxPct"))}</td><td class="{cls(h.get("retPct"))}">{pct(h.get("retPct"))}</td><td>{E(h.get("result",""))}</td></tr>' for h in hist]
    news = ((home or {}).get("news") or [])[:6]
    near_ch = [r for r in near[:4] if r["symbol"] != cotw_sym]
    ad = (bg.get("ad") or [])[k0:]
    mco = (bg.get("mco") or [])[k0:]
    nhl = [None if h is None or l is None else h - l for h, l in zip((bg.get("nh") or [])[k0:], (bg.get("nl") or [])[k0:])]
    nhl10 = [None if i < 9 or any(v is None for v in nhl[i-9:i+1]) else sum(nhl[i-9:i+1]) / 10 for i in range(len(nhl))]
    yr = end.year
    nmon = end + dt.timedelta(days=7 - end.weekday())
    nxt_cal = [e for e in mac.get("events", []) if nmon.isoformat() <= e.get("date", "") <= (nmon + dt.timedelta(days=4)).isoformat() and e.get("imp", 0) >= 2][:14]
    secs = [
        ("Indexes year to date", f"""<h2>Indexes year to date · performance %</h2>{ytd_chart(D, ["SPY", "QQQ", "IWM", "RSP", "DIA"], yr) or empty("No index data.")}
          <p class="lede">Cap weight (SPY), the Nasdaq-100 (QQQ), small caps (IWM), the equal-weight S&amp;P 500 (RSP) and the Dow (DIA), all from zero on January 1. When RSP and IWM keep up with SPY, the rally is broad.</p>""", 300),
        ("Market breadth", f"""<h2>Market breadth · last 3 months</h2><div class="g2"><div>
          <h3 class="h3s">Stocks above their 50- and 200-day lines</h3>{line_chart([("50-day", NAVY, a50), ("200-day", AMBER, a200)], w=340, h=140, labels=labs, lo=0, hi=100) or empty("No breadth data.")}
          <h3 class="h3s">New highs minus new lows · 10-day average</h3>{line_chart([("NH − NL", GREEN, nhl10)], w=340, h=120, labels=labs, fmt=lambda v: f"{v:+.0f}") or empty("No data.")}</div><div>
          <h3 class="h3s">Advance / decline line</h3>{line_chart([("A/D line", NAVY, ad)], w=340, h=140, labels=labs, fmt=lambda v: f"{v/1000:.2f}k" if abs(v) >= 1000 else f"{v:.0f}") or empty("No data.")}
          <h3 class="h3s">McClellan oscillator</h3>{line_chart([("McClellan", "#7b4bb3", mco)], w=340, h=120, labels=labs, fmt=lambda v: f"{v:+.0f}") or empty("No data.")}</div></div>
          <div class="fut">{"".join(f'<div><span>{dt.date.fromisoformat(d).strftime("%a %b %-d")} · new 52-wk highs / lows</span><b>{h} / {l}</b></div>' for d, h, l in zip(dates[-5:], nh, nl))}</div>""", 420),
        ("The Fed", f"""<h2>The Fed · odds implied by fed funds futures</h2>{fed_block(mac.get("fed"), set(mac.get("sep") or [])) or empty("No Fed data this week.")}""", 190),
        ("Next week's calendar", f"""<h2>Next week's macro calendar · New York time</h2>{table(["Day and time", "", "Release", "Prior"], macro_rows(nxt_cal, True)) or empty("No major economic release next week.")}""", th(len(nxt_cal))),
        ("Commodities", f"""<h2>Commodities · futures</h2>{commodities_table(com, weekly=True) or empty("No futures data.")}""", 58 + 34 * len(com)),
        ("Breadth and leadership", f"""<div class="g2"><div><h2>Top industry groups</h2>{table(["#", "Group", "Week", "Leaders"], [f'<tr><td>{x.get("rank")}</td><td>{E(x.get("name",""))}</td><td class="{cls(x.get("chg1w"))}">{pct(x.get("chg1w"))}</td><td>{", ".join(E(l[0]) for l in (x.get("leaders") or [])[:3])}</td></tr>' for x in g_top])}
          </div><div><h2>Biggest climbers in the ranking</h2>{table(["Group", "Rank", "Up"], [f'<tr><td>{E(x.get("name",""))}</td><td>{x.get("rank")}</td><td class="up">+{x["move"]}</td></tr>' for x in climb]) or empty("No group climbed the ranking this week.")}</div></div>""",
         max(th(len(g_top)), th(len(climb)))),
        ("Best leaders of the week", f"""<h2>Best leaders this week · RS 80+</h2>{table(["Stock", "RS", "Close", "Week", "Group", "Setup"], best_rows) or empty("No leader data this week.")}""", th(len(best_rows))),
    ]
    if cotw_sym:
        b0 = cotw[0].get("base") or {}
        secs.append(("Chart of the week", f"""<h2>Chart of the week · {E(cotw_sym)}</h2><div class="cotw">{price_chart(D.bundle(cotw_sym), w=700, h=300, bars=190)}</div>
          <p class="lede">{E(cotw_sym)}: RS {cotw[0].get("rsRating")}, {E(b0.get("type") or "base")} of {b0.get("weeks") or "?"} weeks with a pivot at {px(b0.get("pivot"))}, now {E((b0.get("status") or "").lower())}, {pct(b0.get("distPct"))} from the buy point.</p>""", 372))
    secs += [
        ("Breakouts of the week", f"""<h2>Breakouts of the week</h2>{table(["Stock", "RS", "Close", "Pivot", "From pivot", "Base"], wb_rows) or empty("No breakout held this week.")}""", th(len(wb_rows))),
        ("Earnings this week", f"""<h2>Reported this week</h2>{table(["Company", "RS", "EPS vs est.", "Surprise", "Next day"], [er(e) for e in this_w[:10]]) or empty("No company in our coverage reported this week.")}""", th(len(this_w[:10]))),
        ("Earnings next week", f"""<h2>Coming next week</h2>{table(["Company", "Date", "RS", "EPS est.", "Setup"], [en(e) for e in nxt[:10]]) or empty("No report scheduled next week in our coverage.")}""", th(len(nxt[:10]))),
    ]
    secs.append(("Trade ideas scorecard", f"""<h2>Trade ideas scorecard</h2><div class="kpis"><div><b>{stats.get("count", 0)}</b><span>ideas tracked</span></div><div><b>{stats.get("active", 0)}</b><span>still active</span></div>
        <div><b>{"—" if stats.get("winPct") is None else f'{stats["winPct"]:.0f}%'}</b><span>closed with a gain</span></div><div><b>{pct(stats.get("avgPct"))}</b><span>average result</span></div>
        <div><b>{pct(stats.get("avgMaxPct"))}</b><span>average best gain</span></div></div>
        {table(["Stock", "Idea", "Pivot", "Best", "Result", "Outcome"], hist_rows) or empty("No idea has closed yet: each one is tracked for 8 weeks or until the 7% stop.")}""", 90 + th(len(hist_rows))))
    if near_ch:
        secs.append(("Near a buy point for next week", f'<h2>Near a buy point for next week</h2><div class="charts">{"".join(f"<div class=ch>{price_chart(D.bundle(r["symbol"]))}</div>" for r in near_ch)}</div>', 34 + 214 * ((len(near_ch) + 1) // 2)))
    if news:
        secs.append(("Headlines of the week", f'<h2>Headlines of the week</h2><ul class="news">{"".join(f"<li><b>{E(n.get("title", ""))}</b></li>" for n in news)}</ul>', 34 + 20 * len(news)))
    disc = f"""<b>About this report.</b> The Weekly Tape is generated automatically from Ticker&amp;Tape data as of the {fdate(ddate, "%B %-d")} close. RS Rating ranks 12-month performance from 1 to 99; trade ideas are leaders with an RS Rating of 80 or more near a buy point, tracked for 8 weeks with a stop 7% below the pivot. Ratings, bases and pivots are calculated automatically and can be wrong. This is a research tool, not investment advice; do your own analysis before you trade."""
    summary = [re.sub("<[^>]+>", "", t).replace("&amp;", "&") for t in tk[:3]]
    return wrap(f"The Weekly Tape · {wk}", paginate("weekly", date, no, p1, secs, disc, first_h=490)), {"kind": "weekly", "date": date, "no": no, "title": f"The Weekly Tape · {wk}", "summary": summary}


# ---------------------------------------------------------------- page
CSS = f"""
@page {{ size: Letter; margin: 0 }}
* {{ box-sizing: border-box }}
html, body {{ margin: 0; background: #fff; color: {INK}; font: 10.5px/1.4 "Archivo Narrow", "Arial Narrow", Arial, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact }}
.page {{ width: 8.5in; height: 11in; padding: .42in .5in .55in; position: relative; page-break-after: always; overflow: hidden }}
.page:last-child {{ page-break-after: auto }}
.mast {{ display: flex; align-items: center; gap: 18px; background: {NAVY}; color: #fff; margin: -.42in -.5in 16px; padding: 16px .5in 14px; border-bottom: 5px double {AMBER} }}
.brand {{ display: flex; align-items: center; gap: 9px }}
.brand img {{ width: 34px; height: 34px }}
.brand b {{ display: block; font: 700 17px "Old Standard TT", Georgia, serif }}
.brand span {{ display: block; font: 700 8.5px "Archivo Narrow", sans-serif; letter-spacing: .24em; text-transform: uppercase; color: {AMBER} }}
.mt {{ flex: 1; border-left: 1px solid rgba(242,177,52,.5); padding-left: 18px }}
.mt h1 {{ margin: 0; font: 700 25px/1 "Old Standard TT", Georgia, serif; letter-spacing: -.01em }}
.mt p {{ margin: 4px 0 0; font: 600 10px "Archivo Narrow", sans-serif; letter-spacing: .14em; text-transform: uppercase; color: #c9d3e6 }}
.ed {{ text-align: right; font: 700 10px "Courier Prime", monospace }}
.ed b {{ display: block; font-size: 15px; color: {AMBER} }}
h2 {{ font: 700 10px "Archivo Narrow", sans-serif; letter-spacing: .16em; text-transform: uppercase; color: {NAVY}; margin: 13px 0 6px; padding-bottom: 3px; border-bottom: 2px solid {NAVY} }}
.fbar {{ display: flex; height: 22px; border: 1px solid {INK}; overflow: hidden }}
.fbar span {{ display: flex; align-items: center; justify-content: center; color: #fff; font: 700 9.5px "Archivo Narrow"; white-space: nowrap }}
.t tr.hi td {{ background: #fdf6e3 !important }} .t td.imp {{ color: #c98a00; letter-spacing: 1px; font-size: 9px }} .t b.ev {{ font: 700 10.5px "Archivo Narrow", sans-serif; color: {INK} }}
.h3s {{ margin: 6px 0 3px; font: 700 9.5px "Archivo Narrow"; color: {INK2}; letter-spacing: .04em }}
h2.up {{ color: {GREEN}; border-color: {GREEN} }} h2.dn {{ color: {DOWN}; border-color: {DOWN} }}
.g2 {{ display: grid; grid-template-columns: 1fr 1fr; gap: 22px }}
.g2 > div > h2:first-child {{ margin-top: 0 }}
.tk {{ margin: 0; padding: 0; list-style: none; counter-reset: k }}
.tk li {{ counter-increment: k; position: relative; padding: 6px 0 6px 26px; border-bottom: 1px dotted {RULE}; font-size: 11.5px; line-height: 1.38 }}
.tk li::before {{ content: counter(k); position: absolute; left: 0; top: 6px; width: 18px; height: 18px; background: {NAVY}; color: #fff; font: 700 10px/18px "Courier Prime", monospace; text-align: center }}
.desk {{ margin-top: 12px; background: #f6f3ea; border-left: 4px solid {AMBER}; padding: 9px 12px }}
.desk h3 {{ margin: 0 0 4px; font: 700 9px "Archivo Narrow"; letter-spacing: .18em; text-transform: uppercase; color: {NAVY} }}
.desk p {{ margin: 0 0 5px; font-size: 11px }}
.desk .sig {{ font: italic 11px "Old Standard TT", Georgia, serif; color: {NAVY}; margin: 4px 0 0 }}
.msr {{ display: grid; grid-template-columns: 1fr 1fr; gap: 8px }}
.msx {{ border: 1px solid {INK}; padding: 7px 9px; border-top: 4px solid {INK2} }}
.msx.g {{ border-top-color: {GREEN} }} .msx.a {{ border-top-color: #c98a00 }} .msx.r {{ border-top-color: {DOWN} }}
.msx span {{ display: block; font: 700 8.5px "Archivo Narrow"; letter-spacing: .12em; text-transform: uppercase; color: {INK2} }}
.msx b {{ display: block; font: 700 14px "Old Standard TT", Georgia, serif; color: {NAVY}; margin: 2px 0 }}
.msx small {{ font-size: 9.5px; color: {INK2} }}
.fut {{ display: flex; gap: 0; flex-wrap: wrap; border: 1px solid {INK} }}
.fut > div {{ flex: 1 1 30%; padding: 6px 8px; border-right: 1px dotted {RULE} }}
.fut > div:last-child {{ border-right: 0 }}
.fut span {{ display: block; font-size: 9px; color: {INK2}; text-transform: uppercase; letter-spacing: .06em }}
.fut b {{ font: 700 14px "Courier Prime", monospace }}
.t {{ width: 100%; border-collapse: collapse; font-size: 10px }}
.t th {{ text-align: left; font: 700 8.5px "Archivo Narrow"; letter-spacing: .1em; text-transform: uppercase; color: {INK2}; border-bottom: 1px solid {INK}; padding: 3px 4px }}
.t td {{ padding: 4px; border-bottom: 1px dotted {RULE}; vertical-align: middle; font-family: "Courier Prime", monospace }}
.t td:first-child {{ font-family: "Archivo Narrow", sans-serif }}
.t td b {{ font: 700 11px "Courier Prime", monospace; color: {NAVY} }}
.t small {{ color: {INK2}; font: 9px "Archivo Narrow", sans-serif }}
.t tr:nth-child(even) td {{ background: #faf9f5 }}
.up {{ color: {GREEN} }} .dn {{ color: {DOWN} }}
.tag {{ font: 700 7.5px "Archivo Narrow"; letter-spacing: .08em; text-transform: uppercase; background: {AMBER}; color: {INK}; padding: 1px 4px; vertical-align: 1px }}
.beat {{ font: 700 8px "Archivo Narrow"; text-transform: uppercase; color: #fff; background: {GREEN}; padding: 1px 4px }}
.miss {{ font: 700 8px "Archivo Narrow"; text-transform: uppercase; color: #fff; background: {DOWN}; padding: 1px 4px }}
.lede {{ font-size: 11.5px; color: #2c2f36; margin: 0 0 4px }}
.none {{ color: {INK2}; font-style: italic; margin: 4px 0 }}
.charts {{ display: grid; grid-template-columns: 1fr 1fr; gap: 14px 18px }}
.ch, .cotw {{ border: 1px solid {RULE}; padding: 6px; background: #fff }}
.ch svg, .cotw svg {{ width: 100%; height: auto; display: block }}
.pc text, .lc text, .hb text {{ font-family: "Courier Prime", monospace }}
.ax {{ font-size: 7.5px; fill: {INK2} }} .lt {{ font-size: 8px; fill: #fff; font-weight: 700 }} .pv {{ font-size: 7.5px; fill: {NAVY}; font-weight: 700 }}
.ct {{ font-size: 9px; fill: {INK2}; font-family: "Archivo Narrow", sans-serif !important }} .cs {{ font-size: 12px; font-weight: 700; fill: {NAVY}; font-family: "Courier Prime", monospace }}
.cr {{ font-size: 9px; fill: {NAVY}; font-weight: 700; font-family: "Archivo Narrow", sans-serif !important }}
.hl {{ font-size: 9.5px; fill: {INK}; font-family: "Archivo Narrow", sans-serif !important }} .hv {{ font-size: 9px; fill: {INK}; font-weight: 700 }}
.news {{ margin: 0; padding-left: 16px }} .news li {{ margin: 0 0 4px; font-size: 10.5px }} .news small {{ color: {INK2} }}
.kpis {{ display: grid; grid-template-columns: repeat(5, 1fr); border: 1px solid {INK}; margin-top: 4px }}
.kpis div {{ padding: 9px; border-right: 1px dotted {RULE}; text-align: center }} .kpis div:last-child {{ border-right: 0 }}
.kpis b {{ display: block; font: 700 20px "Courier Prime", monospace; color: {NAVY} }} .kpis span {{ font-size: 9px; color: {INK2}; text-transform: uppercase; letter-spacing: .06em }}
.disc {{ margin-top: 14px; font-size: 8.5px; color: {INK2}; border-top: 1px solid {RULE}; padding-top: 6px; line-height: 1.45 }}
.pf {{ position: absolute; left: .5in; right: .5in; bottom: .3in; display: flex; justify-content: space-between; font: 700 8px "Archivo Narrow"; letter-spacing: .12em; text-transform: uppercase; color: {INK2}; border-top: 3px double {NAVY}; padding-top: 5px }}
"""


def wrap(title: str, body: str) -> str:
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><title>{E(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Courier+Prime:wght@400;700&family=Archivo+Narrow:wght@400;600;700&family=Old+Standard+TT:ital,wght@0,400;0,700;1,400&display=swap">
<style>{CSS}</style></head><body>{body}</body></html>"""


# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("kind", choices=["daily", "weekly"])
    ap.add_argument("--data", default=f"{SITE}/data", help="folder or URL with the site's data files")
    ap.add_argument("--out", default="build/research")
    ap.add_argument("--date", help="report date YYYY-MM-DD (default: today in New York)")
    ap.add_argument("--no", type=int, default=0, help="edition number (default: from the published index)")
    ap.add_argument("--index", help="the published index.json, to number the edition")
    ap.add_argument("--demo", action="store_true", help="synthetic after-hours prices, no internet")
    ap.add_argument("--force", action="store_true", help="build even on a market holiday")
    a = ap.parse_args()
    try:
        from zoneinfo import ZoneInfo
        now = dt.datetime.now(ZoneInfo("America/New_York"))
    except Exception:
        now = dt.datetime.utcnow() - dt.timedelta(hours=4)
    today = dt.date.fromisoformat(a.date) if a.date else now.date()
    if a.kind == "daily" and not a.force and (today.weekday() >= 5 or today.isoformat() in HOLIDAYS):
        print("research: market closed today, no Daily")
        return 2
    global X_TIME
    X_TIME = now.strftime("%-I:%M %p").lower().replace("am", "a.m.").replace("pm", "p.m.") if not a.date else "8:15 a.m."
    no = a.no
    if not no:
        prev = []
        if a.index and Path(a.index).exists():
            prev = json.loads(Path(a.index).read_text()).get("reports", [])
        no = 1 + sum(1 for r in prev if r.get("kind") == a.kind and r.get("date") != today.isoformat())
    D = Data(a.data)
    meta = D.get("meta.json", {})
    if not meta or not D.get("universe.json"):
        print("research: no site data, nothing to build", file=sys.stderr)
        return 1
    html_, info = (build_daily if a.kind == "daily" else build_weekly)(D, today, no, a.demo)
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / "report.html").write_text(html_)
    (out / "report.json").write_text(json.dumps(info, indent=1))
    print(f"research: {info['title']} (No. {no}) -> {out}/report.html")
    return 0


if __name__ == "__main__":
    sys.exit(main())

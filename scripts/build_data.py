#!/usr/bin/env python3
"""
Ticker&Tape — data builder.

Downloads end-of-day prices and fundamentals from Yahoo Finance (via yfinance),
computes O'Neil-style analytics and writes static JSON files for the website:

  site/data/meta.json        last update, market pulse, errors
  site/data/screener.json    one row per watchlist ticker
  site/data/bench.json       S&P 500 closes (index line + RS line)
  site/data/t/<SYM>.json     full bundle per watchlist ticker (prices, fundamentals, base)

Usage:
  python scripts/build_data.py                 # real data from Yahoo
  python scripts/build_data.py --demo          # synthetic data, no internet (for testing)
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import re
import sys
import time
import traceback
from io import StringIO
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
OUT_DEFAULT = ROOT / "site" / "data"
CACHE = ROOT / "cache"
BENCH = "^GSPC"
INDEXES = {"^GSPC": "S&P 500", "^IXIC": "Nasdaq Composite"}
UA = {"User-Agent": "Mozilla/5.0 (Ticker&Tape data builder; +https://tickerandtape.com)"}

# ETFs shown on the site: symbol -> (group, short name, GICS sector it tracks or "")
ETFS = {
    "SPY": ("Market", "S&P 500", ""), "QQQ": ("Market", "Nasdaq-100", ""), "DIA": ("Market", "Dow Jones Industrial Average", ""),
    "IWM": ("Market", "Russell 2000", ""), "MDY": ("Market", "S&P MidCap 400", ""), "RSP": ("Market", "S&P 500 Equal Weight", ""),
    "MAGS": ("Market", "Magnificent Seven", ""), "QQQE": ("Market", "Nasdaq-100 Equal Weight", ""),
    "IWF": ("Factor", "Russell 1000 Growth", ""), "IWD": ("Factor", "Russell 1000 Value", ""), "MTUM": ("Factor", "Momentum", ""),
    "SPHB": ("Factor", "S&P 500 High Beta", ""), "SPLV": ("Factor", "S&P 500 Low Volatility", ""),
    "XLK": ("Sector", "Technology", "Information Technology"), "XLF": ("Sector", "Financials", "Financials"),
    "XLV": ("Sector", "Health Care", "Health Care"), "XLE": ("Sector", "Energy", "Energy"),
    "XLY": ("Sector", "Consumer Discretionary", "Consumer Discretionary"), "XLP": ("Sector", "Consumer Staples", "Consumer Staples"),
    "XLI": ("Sector", "Industrials", "Industrials"), "XLB": ("Sector", "Materials", "Materials"),
    "XLU": ("Sector", "Utilities", "Utilities"), "XLRE": ("Sector", "Real Estate", "Real Estate"),
    "XLC": ("Sector", "Communication Services", "Communication Services"),
    "SMH": ("Industry", "Semiconductors", ""), "SOXX": ("Industry", "Semiconductors", ""), "IGV": ("Industry", "Software", ""),
    "XBI": ("Industry", "Biotech (equal weight)", ""), "IBB": ("Industry", "Biotech", ""), "KRE": ("Industry", "Regional Banks", ""),
    "KBE": ("Industry", "Banks", ""), "XHB": ("Industry", "Homebuilders", ""), "ITB": ("Industry", "Home Construction", ""),
    "XRT": ("Industry", "Retail", ""), "XOP": ("Industry", "Oil & Gas E&P", ""), "OIH": ("Industry", "Oil Services", ""),
    "XME": ("Industry", "Metals & Mining", ""), "XAR": ("Industry", "Aerospace & Defense", ""), "ITA": ("Industry", "Aerospace & Defense", ""),
    "JETS": ("Industry", "Airlines", ""), "IYT": ("Industry", "Transportation", ""), "TAN": ("Industry", "Solar", ""),
    "ICLN": ("Industry", "Clean Energy", ""), "URA": ("Industry", "Uranium", ""), "LIT": ("Industry", "Lithium & Battery", ""),
    "CIBR": ("Industry", "Cybersecurity", ""), "SKYY": ("Industry", "Cloud Computing", ""), "BOTZ": ("Industry", "Robotics & AI", ""),
    "ARKK": ("Industry", "Disruptive Innovation", ""), "KWEB": ("Industry", "China Internet", ""), "GDX": ("Industry", "Gold Miners", ""),
    "GDXJ": ("Industry", "Junior Gold Miners", ""), "COPX": ("Industry", "Copper Miners", ""),
    "GLD": ("Commodity", "Gold", ""), "SLV": ("Commodity", "Silver", ""), "USO": ("Commodity", "Crude Oil", ""),
    "UNG": ("Commodity", "Natural Gas", ""), "DBA": ("Commodity", "Agriculture", ""), "DBC": ("Commodity", "Broad Commodities", ""),
    "TLT": ("Bonds", "20+ Year Treasury", ""), "IEF": ("Bonds", "7-10 Year Treasury", ""), "SHY": ("Bonds", "1-3 Year Treasury", ""),
    "HYG": ("Bonds", "High Yield Corporate", ""), "LQD": ("Bonds", "Investment Grade Corporate", ""), "TIP": ("Bonds", "TIPS", ""),
    "EFA": ("International", "Developed Markets", ""), "EEM": ("International", "Emerging Markets", ""), "FXI": ("International", "China Large-Cap", ""),
    "EWJ": ("International", "Japan", ""), "EWZ": ("International", "Brazil", ""), "EWW": ("International", "Mexico", ""),
    "INDA": ("International", "India", ""), "ARGT": ("International", "Argentina", ""), "EWG": ("International", "Germany", ""),
    "EWU": ("International", "United Kingdom", ""),
    "IBIT": ("Crypto", "Bitcoin", ""), "ETHA": ("Crypto", "Ether", ""), "UUP": ("Currency", "U.S. Dollar", ""),
}
# Futures (Yahoo continuous front-month contracts): symbol -> (group, name, unit)
FUTURES = {
    "ES=F": ("Index", "S&P 500 E-mini", "index pts"),
    "GC=F": ("Metals", "Gold", "$/oz"), "SI=F": ("Metals", "Silver", "$/oz"),
    "HG=F": ("Metals", "Copper", "$/lb"), "PL=F": ("Metals", "Platinum", "$/oz"),
    "CL=F": ("Energy", "Crude Oil WTI", "$/bbl"), "BZ=F": ("Energy", "Brent Crude", "$/bbl"),
    "NG=F": ("Energy", "Natural Gas", "$/MMBtu"), "RB=F": ("Energy", "Gasoline RBOB", "$/gal"),
    "ZC=F": ("Agriculture", "Corn", "¢/bu"), "ZW=F": ("Agriculture", "Wheat", "¢/bu"),
    "ZS=F": ("Agriculture", "Soybeans", "¢/bu"), "KC=F": ("Agriculture", "Coffee", "¢/lb"),
    "LE=F": ("Agriculture", "Live Cattle", "¢/lb"),
}
HOME_CHART = "ES=F"
HOME_COMMODITIES = [s for s in FUTURES if FUTURES[s][0] != "Index"]
HOME_MARKET = ["SPY", "QQQ", "DIA", "IWM", "RSP"]
HOME_SECTORS = ["XLK", "XLC", "XLY", "XLF", "XLI", "XLV", "XLE", "XLB", "XLP", "XLU", "XLRE"]

log_lines: list[str] = []


def jdumps(obj, **kw):
    kw.setdefault("default", lambda o: o.item() if hasattr(o, "item") else str(o))
    return json.dumps(obj, **kw)


def log(msg: str) -> None:
    print(msg, flush=True)
    log_lines.append(msg)


# ---------------------------------------------------------------- helpers
def fnum(x):
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    return None if (math.isnan(v) or math.isinf(v)) else v


def pct_change(new, old):
    new, old = fnum(new), fnum(old)
    if new is None or old is None or old == 0:
        return None
    return (new - old) / abs(old) * 100


def fmt_pct(v, digits=0):
    if v is None:
        return ""
    if round(v, digits) == 0:
        return "0%"
    return f"{v:+.{digits}f}%"


def fmt_big(v):
    v = fnum(v)
    if v is None:
        return ""
    a = abs(v)
    for div, suf in ((1e12, "T"), (1e9, "B"), (1e6, "M"), (1e3, "K")):
        if a >= div:
            return f"{v / div:.2f}{suf}" if a / div < 100 else f"{v / div:.0f}{suf}"
    return f"{v:.0f}"


def parse_big(txt) -> float | None:
    """Inverse of fmt_big: "41.2B" -> 4.12e10."""
    if txt is None or txt == "":
        return None
    if isinstance(txt, (int, float)):
        return float(txt)
    m = re.fullmatch(r"\s*(-?[\d.]+)\s*([KMBT]?)\s*", str(txt))
    if not m:
        return None
    return float(m.group(1)) * {"": 1, "K": 1e3, "M": 1e6, "B": 1e9, "T": 1e12}[m.group(2)]


# heatmap index membership bits
IDX_BITS = {"sp500": 1, "ndx": 2, "sp400": 4, "sp600": 8}


def qlabel(ts: pd.Timestamp) -> str:
    if ts.month in (3, 6, 9, 12):
        return f"{(ts.month - 1) // 3 + 1}Q{ts.year % 100:02d}"
    return ts.strftime("%b-%y")


def month_end(ts: pd.Timestamp) -> pd.Timestamp:
    return (pd.Timestamp(ts.year, ts.month, 1) + pd.offsets.MonthEnd(0)).normalize()


def file_symbol(s: str) -> str:
    """Chart file name for a symbol ("ES=F" -> "ES_F"; the page does the same mapping)."""
    return s.replace("=", "_")


def clean_futures(df: pd.DataFrame) -> pd.DataFrame:
    """Yahoo futures dailies can carry weekend stubs, duplicate dates and missing volume."""
    df = df[~df.index.duplicated(keep="last")]
    df = df[df.index.dayofweek < 5].copy()
    df["Volume"] = df["Volume"].fillna(0)
    for k in ("Open", "High", "Low"):
        df[k] = df[k].fillna(df["Close"])
    return df


def yf_symbol(s: str) -> str:
    return s.strip().upper().replace(".", "-")


USER_TICKERS_URL = "https://api.tickerandtape.com/tickers"
USER_TICKERS_MAX = 400


def fetch_user_tickers() -> list[str]:
    """Tickers that site users starred (union of every account's watchlist), so the nightly build covers them."""
    import os
    import urllib.request
    url = os.environ.get("TT_TICKERS_URL", USER_TICKERS_URL)
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=20) as r:
            data = json.loads(r.read().decode())
    except Exception as e:  # noqa: BLE001
        log(f"user tickers: could not fetch ({e}), skipping")
        return []
    ok = [yf_symbol(s) for s in data if isinstance(s, str) and re.fullmatch(r"[A-Za-z0-9.\-^=]{1,15}", s)]
    return list(dict.fromkeys(ok))[:USER_TICKERS_MAX]


def read_list(path: Path) -> list[str]:
    if not path.exists():
        return []
    out = []
    for line in path.read_text().splitlines():
        line = line.split("#", 1)[0].strip()
        if line:
            out.extend(yf_symbol(p) for p in line.replace(",", " ").split())
    return list(dict.fromkeys(out))


def find_col(df: pd.DataFrame, *keys):
    for c in df.columns:
        lc = str(c).lower().replace(" ", "")
        if all(k in lc for k in keys):
            return c
    return None


def row_val(df: pd.DataFrame | None, names, col):
    if df is None or df.empty:
        return None
    for n in names:
        if n in df.index:
            v = fnum(df.at[n, col])
            if v is not None:
                return v
    return None


# ---------------------------------------------------------------- universe
def fetch_universe() -> dict[str, dict]:
    """S&P 500 + S&P 400 + S&P 600 (= S&P 1500) + Nasdaq-100 constituents with GICS sector /
    sub-industry and company name (from Wikipedia)."""
    import requests

    uni: dict[str, dict] = {}
    pages = [
        ("https://en.wikipedia.org/wiki/List_of_S%26P_500_companies", "sp500"),
        ("https://en.wikipedia.org/wiki/List_of_S%26P_400_companies", "sp400"),
        ("https://en.wikipedia.org/wiki/List_of_S%26P_600_companies", "sp600"),
        ("https://en.wikipedia.org/wiki/List_of_NASDAQ-100_companies", "ndx"),
    ]
    for url, tag in pages:
        try:
            html = requests.get(url, headers=UA, timeout=30).text
            for t in pd.read_html(StringIO(html)):
                cols = {re.sub(r"\[.*?\]", "", str(c)).strip().lower(): c for c in t.columns}
                sym_col = cols.get("symbol") or cols.get("ticker")
                if sym_col is None or len(t) < 80:
                    continue
                sec = cols.get("gics sector") or cols.get("icb industry")
                sub = cols.get("gics sub-industry") or cols.get("gics sub‑industry") or cols.get("icb subsector")
                nm = cols.get("security") or cols.get("company")
                for _, r in t.iterrows():
                    s = yf_symbol(str(r[sym_col]))
                    if not s or s == "NAN":
                        continue
                    d = uni.setdefault(s, {"sector": "", "industry": ""})
                    d["ix"] = d.get("ix", 0) | IDX_BITS[tag]
                    if nm is not None and isinstance(r[nm], str) and not d.get("name"):
                        d["name"] = r[nm]
                    if sec is not None and isinstance(r[sec], str):
                        d["sector"] = d["sector"] or r[sec]
                    if sub is not None and isinstance(r[sub], str):
                        d["industry"] = d["industry"] or r[sub]
                break
            log(f"universe: {tag} ok ({len(uni)} total)")
        except Exception as e:  # noqa: BLE001
            log(f"universe: {tag} failed: {e}")
    return uni


# ---------------------------------------------------------------- broader market: every U.S.-listed stock and ADR above $1B
BROAD_MIN_CAP = 1e9
BROAD_MIN_PRICE = 5.0
NASDAQ_SECTOR = {"Technology": "Information Technology", "Finance": "Financials", "Basic Materials": "Materials",
                 "Telecommunications": "Communication Services", "Health Care": "Health Care", "Consumer Discretionary": "Consumer Discretionary",
                 "Consumer Staples": "Consumer Staples", "Industrials": "Industrials", "Energy": "Energy", "Utilities": "Utilities",
                 "Real Estate": "Real Estate"}
BROAD_SKIP = re.compile(r"warrant|\bunits?\b|\brights?\b|preferred|\bnotes? due\b|debenture|acquisition corp|% |depositary shares,? each representing (a )?1/", re.I)
NAME_TAIL = re.compile(r"\s+(-\s+)?(Class [A-Z]\s+)?(Common Stock|Common Shares|Ordinary Shares|American Depositary Shares|American Depository Shares|"
                       r"Sponsored ADR|ADS|Depositary Shares|Subordinate Voting Shares|Shares of Beneficial Interest)\b.*$", re.I)


def fetch_broad_market() -> dict[str, dict]:
    """U.S.-listed common stocks and ADRs with a market cap of $1B+ and a price of $5+, from Nasdaq's public stock screener
    (NYSE, Nasdaq and NYSE American). Falls back to the last good list when the request fails."""
    import requests
    cache = CACHE / "broad.json"
    out: dict[str, dict] = {}
    try:
        r = requests.get("https://api.nasdaq.com/api/screener/stocks", params={"tableonly": "true", "download": "true"},
                         headers=NASDAQ_UA, timeout=60)
        rows = ((r.json().get("data") or {}).get("rows")) or []
        for x in rows:
            raw = str(x.get("symbol") or "").strip().upper()
            name = str(x.get("name") or "").strip()
            if not raw or "^" in raw or BROAD_SKIP.search(name):
                continue
            sym = yf_symbol(raw.replace("/", "-"))
            cap = _pnum(x.get("marketCap"))
            price = _pnum(str(x.get("lastsale") or "").replace("$", ""))
            if not re.fullmatch(r"[A-Z0-9\-]{1,10}", sym) or not cap or cap < BROAD_MIN_CAP or not price or price < BROAD_MIN_PRICE:
                continue
            out[sym] = {"sector": NASDAQ_SECTOR.get(str(x.get("sector") or ""), ""), "industry": "",
                        "name": NAME_TAIL.sub("", name).strip(" ,.") or sym,
                        "adr": 1 if re.search(r"depositary|depository|\bADS\b|\bADR\b", name, re.I) else 0,
                        "country": str(x.get("country") or "")}
        if len(out) >= 1000:
            cache.write_text(jdumps(out))
            log(f"broad market: {len(out)} stocks and ADRs over $1B ({sum(d['adr'] for d in out.values())} ADRs)")
            return out
        log(f"broad market: only {len(out)} rows from Nasdaq, using the cached list")
    except Exception as e:  # noqa: BLE001
        log(f"broad market failed: {e}")
    try:
        return json.loads(cache.read_text()) if cache.exists() else {}
    except Exception:  # noqa: BLE001
        return {}


def map_gics(uni: dict) -> int:
    """Stocks outside the S&P indexes get the GICS sector and sub-industry that S&P members with the same Yahoo industry
    most often have, so they join the same industry groups. Needs their fundamentals (fetched in rotation)."""
    from collections import Counter
    best_by: dict[str, Counter] = {}
    for s, d in uni.items():
        if d.get("industry") and not d.get("broad"):
            f, _ = fund_cache_get(s)
            yi = (f or {}).get("industryYahoo")
            if yi:
                best_by.setdefault(yi, Counter())[(d.get("sector", ""), d["industry"])] += 1
    best = {yi: c.most_common(1)[0][0] for yi, c in best_by.items()}
    n = 0
    for s, d in uni.items():
        if d.get("broad") and not d.get("industry"):
            f, _ = fund_cache_get(s)
            yi = (f or {}).get("industryYahoo")
            if yi in best:
                d["sector"], d["industry"] = best[yi]
                n += 1
    return n


# ---------------------------------------------------------------- prices
def download_prices(symbols: list[str], period: str = "3y") -> dict[str, pd.DataFrame]:
    import yfinance as yf

    out: dict[str, pd.DataFrame] = {}
    chunk = 80
    for i in range(0, len(symbols), chunk):
        batch = symbols[i : i + chunk]
        for attempt in (1, 2):
            try:
                df = yf.download(batch, period=period, interval="1d", auto_adjust=False,
                                 group_by="ticker", threads=True, progress=False, multi_level_index=True)
                break
            except Exception as e:  # noqa: BLE001
                log(f"download batch {i // chunk + 1} attempt {attempt} failed: {e}")
                df = None
                time.sleep(10)
        if df is None or df.empty:
            continue
        for s in batch:
            try:
                sub = df[s] if isinstance(df.columns, pd.MultiIndex) else df
                sub = sub[["Open", "High", "Low", "Close", "Volume"]].dropna(subset=["Close"])
                if len(sub) >= 30:
                    sub.index = pd.to_datetime(sub.index).tz_localize(None).normalize()
                    out[s] = sub.astype(float)
            except Exception:  # noqa: BLE001
                pass
        time.sleep(1.5)
    log(f"prices: {len(out)}/{len(symbols)} symbols downloaded")
    return out


# ---------------------------------------------------------------- analytics
def rs_score(close: np.ndarray):
    """IBD-style weighted relative performance: 40% last quarter, 20% each of the three before."""
    n = len(close)
    if n < 64:
        return None
    parts, weights = [], []
    for lag, w in ((63, 0.4), (126, 0.2), (189, 0.2), (252, 0.2)):
        if n > lag and close[-1 - lag] > 0:
            parts.append(close[-1] / close[-1 - lag] - 1)
            weights.append(w)
    if not parts:
        return None
    return float(np.dot(parts, weights) / sum(weights))


def rs_rating(score, ref_sorted: np.ndarray):
    if score is None or len(ref_sorted) == 0:
        return None
    frac = np.searchsorted(ref_sorted, score, side="right") / len(ref_sorted)
    return int(min(99, max(1, round(1 + 98 * frac))))


def sma(a: np.ndarray, n: int):
    return float(a[-n:].mean()) if len(a) >= n else None


def market_pulse(df: pd.DataFrame | None, name: str):
    if df is None or len(df) < 60:
        return None
    c, v = df["Close"].to_numpy(), df["Volume"].to_numpy()
    ma50, ma200 = sma(c, 50), sma(c, 200)
    ema21 = float(pd.Series(c).ewm(span=21, adjust=False).mean().iloc[-1])
    # distribution day: index down >= 0.2% on higher volume than the prior session, last 25 sessions
    dd = []
    for i in range(max(1, len(c) - 25), len(c)):
        if c[i] <= c[i - 1] * 0.998 and v[i] > v[i - 1] > 0:
            dd.append(df.index[i].strftime("%Y-%m-%d"))
    above50 = ma50 is not None and c[-1] > ma50
    above200 = ma200 is not None and c[-1] > ma200
    if not above50 and ma50 and ma200 and ma50 < ma200:
        status = "Correction"
    elif len(dd) >= 6 or not above50:
        status = "Uptrend under pressure"
    else:
        status = "Uptrend"
    return {
        "name": name, "close": round(float(c[-1]), 2), "chgPct": round((c[-1] / c[-2] - 1) * 100, 2),
        "above50": above50, "above200": above200, "above21": c[-1] > ema21,
        "distDays": len(dd), "distDates": dd, "status": status,
    }


# ---------------------------------------------------------------- market breadth
BREADTH_DAYS = 504          # two years of daily history in breadth.json
BREADTH_GROUPS = {"all": ("S&P 1500 + Nasdaq-100", 0), "sp500": ("S&P 500", 1), "ndx": ("Nasdaq-100", 2)}
STATUS_CODE = {"Uptrend": "U", "Uptrend under pressure": "P", "Correction": "C", "Rally attempt": "R"}


def market_state(df: pd.DataFrame) -> dict | None:
    """O'Neil-style market direction, replayed day by day over the whole history (a heuristic, not IBD's call).

    - Distribution day: index down 0.2%+ on higher volume than the day before. It counts for 25 sessions,
      or until the index closes 5% above that day's close. The count restarts at every follow-through day.
    - Uptrend -> under pressure: 5+ distribution days, or a close under the 50-day line.
    - -> Correction: 8% off the uptrend's peak close, or 6+ distribution days while under the 50-day line.
    - Rally attempt: first up close after the correction low. A new low (undercut) restarts it.
    - Follow-through day: day 4 or later of the attempt, index up 1.25%+ on higher volume -> confirmed uptrend.
    """
    if df is None or len(df) < 260:
        return None
    df = df.dropna(subset=["Close"])
    c, v = df["Close"].to_numpy(float), df["Volume"].fillna(0).to_numpy(float)
    lo = df["Low"].fillna(df["Close"]).to_numpy(float)
    ma50 = pd.Series(c).rolling(50).mean().to_numpy()
    dates = [d.strftime("%Y-%m-%d") for d in df.index]
    start = 200
    state = "Uptrend" if c[start] > ma50[start] else "Correction"
    peak, low_px, low_i, rally_day, ftd_i = c[start], lo[start], start, 0, None
    dd: list[int] = []
    codes = []
    for i in range(start + 1, len(c)):
        chg = c[i] / c[i - 1] - 1
        if chg <= -0.002 and v[i] > v[i - 1] > 0:
            dd.append(i)
        dd = [k for k in dd if i - k < 25 and c[i] < c[k] * 1.05]
        if state in ("Uptrend", "Uptrend under pressure"):
            peak = max(peak, c[i])
            if c[i] <= peak * 0.92 or (c[i] < ma50[i] and len(dd) >= 6):
                state, low_px, low_i, rally_day = "Correction", lo[i], i, 0
            elif len(dd) >= 5 or c[i] < ma50[i]:
                state = "Uptrend under pressure"
            else:
                state = "Uptrend"
        else:
            if lo[i] < low_px:                       # new low: the rally attempt (if any) failed
                low_px, low_i, rally_day, state = lo[i], i, 0, "Correction"
                if chg > 0:                          # reversal day off a new low counts as day 1
                    rally_day, state = 1, "Rally attempt"
            elif rally_day == 0:
                if chg > 0:
                    rally_day, state = 1, "Rally attempt"
            else:
                rally_day += 1
                if rally_day >= 4 and chg >= 0.0125 and v[i] > v[i - 1] > 0:
                    state, peak, ftd_i, rally_day, dd = "Uptrend", c[i], i, 0, []
                elif rally_day >= 30 and c[i] > ma50[i]:   # long grind higher without a textbook FTD
                    state, peak, rally_day, dd = "Uptrend", c[i], 0, []
        codes.append(STATUS_CODE[state])
    return {
        "status": state, "distDays": len(dd), "distDates": [dates[k] for k in dd],
        "rallyDay": rally_day if state == "Rally attempt" else None,
        "lowDate": dates[low_i] if state in ("Correction", "Rally attempt") else None,
        "ftdDate": dates[ftd_i] if ftd_i is not None and state != "Correction" and state != "Rally attempt" else None,
        "dates": dates[start + 1:], "codes": "".join(codes),
    }


def build_breadth(out: Path, prices: dict, uni: dict, ref_syms: list[str], now_iso: str) -> dict:
    """breadth.json: % of stocks above their 20/50/200-day lines, 52-week highs and lows, advances and
    declines (A/D line, McClellan oscillator) for three groups, plus the O'Neil market state of both indexes."""
    bench = prices[BENCH]
    idx = bench.index
    syms = [s for s in ref_syms if s in prices]
    close = pd.DataFrame({s: prices[s]["Close"] for s in syms}).reindex(idx)
    high = pd.DataFrame({s: prices[s]["High"] for s in syms}).reindex(idx)
    low = pd.DataFrame({s: prices[s]["Low"] for s in syms}).reindex(idx)
    close = close.ffill(limit=3)
    n = min(BREADTH_DAYS, len(idx) - 1)
    keep = idx[-n:]

    def pct(mask, valid):
        cnt = valid.sum(axis=1)
        return (mask.sum(axis=1) / cnt.where(cnt > 0) * 100).round(1)

    groups = {}
    for key, (label, bit) in BREADTH_GROUPS.items():
        # breadth stays on the index members (S&P 1500 + Nasdaq-100), the standard universe for these indicators
        cols = [s for s in syms if uni.get(s, {}).get("ix", 0) & (bit or 0xFF)]
        if len(cols) < 20:
            continue
        cl, hi, lw = close[cols], high[cols], low[cols]
        ser = {}
        for p in (20, 50, 200):
            ma = cl.rolling(p, min_periods=p).mean()
            ser[f"a{p}"] = pct(cl > ma, ma.notna() & cl.notna())
        hh = hi.rolling(252, min_periods=240).max()
        ll = lw.rolling(252, min_periods=240).min()
        ser["nh"] = ((hi >= hh) & hh.notna()).sum(axis=1)
        ser["nl"] = ((lw <= ll) & ll.notna()).sum(axis=1)
        d = cl.diff()
        adv, dec = (d > 0).sum(axis=1), (d < 0).sum(axis=1)
        ser["adv"], ser["dec"] = adv, dec
        # ratio-adjusted net advances, so the oscillator does not drift with the number of stocks
        rana = ((adv - dec) / (adv + dec).where(adv + dec > 0) * 1000).fillna(0)
        ser["mco"] = (rana.ewm(span=19, adjust=False).mean() - rana.ewm(span=39, adjust=False).mean()).round(1)
        frame = pd.DataFrame(ser).loc[keep]
        frame["ad"] = (frame["adv"] - frame["dec"]).cumsum()
        groups[key] = {"label": label, "count": len(cols),
                       **{k: [None if pd.isna(x) else (round(float(x), 1) if k in ("a20", "a50", "a200", "mco") else int(x))
                              for x in frame[k].to_numpy()] for k in frame.columns}}

    indexes = {}
    for sym, name in INDEXES.items():
        df = prices.get(sym)
        st = market_state(df)
        if not st:
            continue
        cmap = dict(zip(st.pop("dates"), st.pop("codes")))
        c = df["Close"].reindex(keep)
        st.update({"symbol": sym, "name": name,
                   "close": [None if pd.isna(x) else round(float(x), 2) for x in c.to_numpy()],
                   "codes": "".join(cmap.get(d.strftime("%Y-%m-%d"), "-") for d in keep)})
        indexes[sym] = st

    data = {"updated": now_iso, "dates": [d.strftime("%Y-%m-%d") for d in keep], "groups": groups, "indexes": indexes}
    (out / "breadth.json").write_text(jdumps(data, separators=(",", ":")))
    g = groups.get("all")
    if g:
        log(f"breadth: {g['count']} stocks, {g['a50'][-1]}% above 50-day, NH {g['nh'][-1]} / NL {g['nl'][-1]}")
    return indexes


def detect_base(df: pd.DataFrame):
    """Heuristic base / pivot detection on daily bars. Returns a dict or None.

    Base = from the highest high of the last ~65 weeks (left side) to today, at least 5 weeks long.
    If the stock just broke out, the base that it left is reported with status Breakout/Extended.
    """
    h, l, c, v = (df[k].to_numpy() for k in ("High", "Low", "Close", "Volume"))
    n = len(c)
    if n < 60:
        return None
    vavg = pd.Series(v).rolling(50, min_periods=20).mean().to_numpy()

    def base_until(end):  # base over bars [pk, end)
        start = max(0, end - 325)
        if end - start < 30:
            return None
        pk = start + int(np.argmax(h[start:end]))
        length = end - pk
        if length < 25:
            return None
        hi = h[pk]
        lo_i = pk + int(np.argmin(l[pk:end]))
        depth = (hi - l[lo_i]) / hi
        weeks = round(length / 5)
        # handle: highest point of the right half, followed by a modest pullback in the upper half of the base
        mid = pk + length // 2
        r = mid + int(np.argmax(h[mid:end]))
        handle = None
        if r < end - 4 and r > lo_i and h[r] >= hi * 0.85:
            pull = (h[r] - l[r:end].min()) / h[r]
            mid_price = l[lo_i] + (hi - l[lo_i]) / 2
            if 0.02 <= pull <= 0.15 and l[r:end].min() > mid_price and end - r <= 30:
                handle = {"start": r, "depth": pull}
        if depth <= 0.15:
            kind = "Flat base"
        elif depth <= 0.50:
            if handle:
                kind = "Cup with handle"
            elif c[end - 1] >= hi * 0.90:
                kind = "Cup"
            else:
                kind = "Base forming"
        else:
            kind = "Deep correction"
        pivot = (h[handle["start"]] if handle else hi) + 0.10
        return {"pk": pk, "lo": lo_i, "end": end, "kind": kind, "depth": depth, "weeks": weeks,
                "pivot": pivot, "handle": handle, "high": hi, "low": l[lo_i]}

    def pack(b, status, extra=None):
        d = df.index
        out = {
            "type": b["kind"], "start": d[b["pk"]].strftime("%Y-%m-%d"), "end": d[b["end"] - 1].strftime("%Y-%m-%d"),
            "low": round(float(b["low"]), 2), "lowDate": d[b["lo"]].strftime("%Y-%m-%d"),
            "high": round(float(b["high"]), 2), "depthPct": round(b["depth"] * 100, 1), "weeks": b["weeks"],
            "pivot": round(float(b["pivot"]), 2), "buyZoneTop": round(float(b["pivot"]) * 1.05, 2),
            "handleStart": d[b["handle"]["start"]].strftime("%Y-%m-%d") if b["handle"] else None,
            "status": status, "distPct": round((c[-1] / b["pivot"] - 1) * 100, 1),
        }
        if extra:
            out.update(extra)
        return out

    # 1) latest breakout from a base in the last 25 sessions
    latest = None
    for e in range(n - 1, n - 26, -1):
        b = base_until(e)
        if b and b["kind"] != "Deep correction" and c[e] > b["pivot"] and c[e - 1] <= b["pivot"]:
            volpct = (v[e] / vavg[e - 1] - 1) * 100 if vavg[e - 1] and vavg[e - 1] > 0 else None
            dist = c[-1] / b["pivot"] - 1
            status = "Failed breakout" if c[-1] < b["pivot"] * 0.97 else ("Breakout" if dist <= 0.05 else "Extended")
            latest = pack(b, status, {"breakoutDate": df.index[e].strftime("%Y-%m-%d"),
                                      "breakoutVolPct": None if volpct is None else round(float(volpct))})
            break

    # 2) current base (stock still inside)
    cur = base_until(n)
    if cur:
        dist = c[-1] / cur["pivot"] - 1
        if dist > 0.05:
            status = "Extended"
        elif dist > 0:
            status = "In buy zone"
        elif dist >= -0.05:
            status = "Near pivot"
        else:
            status = "Below pivot"
        if cur["kind"] == "Deep correction":
            status = "Correcting"
        current = pack(cur, status)
        # a breakout above a handle pivot that is still inside the left-side high counts as current base
        if latest and latest["start"] == current["start"]:
            return latest
        return current
    return latest


def zigzag_levels(df: pd.DataFrame, th=0.065):
    """Unbroken last swing high / low (for screener 'resistance' / 'support')."""
    h, l = df["High"].to_numpy(), df["Low"].to_numpy()
    piv, hi_i, lo_i, trend = [], 0, 0, 0
    for i in range(1, len(h)):
        if trend == 0:
            hi_i = i if h[i] > h[hi_i] else hi_i
            lo_i = i if l[i] < l[lo_i] else lo_i
            if hi_i > lo_i and h[hi_i] >= l[lo_i] * (1 + th):
                piv.append((lo_i, l[lo_i], False)); trend = 1
            elif lo_i > hi_i and l[lo_i] <= h[hi_i] * (1 - th):
                piv.append((hi_i, h[hi_i], True)); trend = -1
        elif trend == 1:
            if h[i] >= h[hi_i]:
                hi_i = i
            elif l[i] <= h[hi_i] * (1 - th):
                piv.append((hi_i, h[hi_i], True)); trend = -1; lo_i = i
        else:
            if l[i] <= l[lo_i]:
                lo_i = i
            elif h[i] >= l[lo_i] * (1 + th):
                piv.append((lo_i, l[lo_i], False)); trend = 1; hi_i = i
    return piv


def price_stats(df: pd.DataFrame, bench: pd.Series | None):
    c, h, l, v = (df[k].to_numpy() for k in ("Close", "High", "Low", "Volume"))
    n = len(c)
    yr = slice(max(0, n - 252), n)
    hi52, lo52 = float(h[yr].max()), float(l[yr].min())
    ma50, ma200 = sma(c, 50), sma(c, 200)
    v50 = sma(v, 50)
    up = dn = 0.0
    for i in range(max(1, n - 50), n):
        if c[i] >= c[i - 1]:
            up += v[i]
        else:
            dn += v[i]
    tr = [max(h[i], c[i - 1]) - min(l[i], c[i - 1]) for i in range(max(1, n - 21), n)]
    st = {
        "close": round(float(c[-1]), 2), "prevClose": round(float(c[-2]), 2),
        "chgPct": round((c[-1] / c[-2] - 1) * 100, 2), "volume": int(v[-1]),
        "hi52": round(hi52, 2), "lo52": round(lo52, 2), "offHighPct": round((c[-1] / hi52 - 1) * 100, 1),
        "ma50": None if ma50 is None else round(ma50, 2), "ma200": None if ma200 is None else round(ma200, 2),
        "vs50Pct": None if not ma50 else round((c[-1] / ma50 - 1) * 100, 1),
        "vs200Pct": None if not ma200 else round((c[-1] / ma200 - 1) * 100, 1),
        "avgVol50": None if v50 is None else int(v50),
        "volVsAvgPct": None if not v50 else round((v[-1] / v50 - 1) * 100),
        "dollarVol50": None if v50 is None else round(v50 * float(c[-1])),
        "udRatio": round(up / dn, 2) if dn else None,
        "atrPct": round(float(np.mean(tr)) / c[-1] * 100, 2) if tr else None,
        "perf3m": round((c[-1] / c[-64] - 1) * 100, 1) if n > 64 else None,
        "perf12m": round((c[-1] / c[-253] - 1) * 100, 1) if n > 253 else None,
        "date": df.index[-1].strftime("%Y-%m-%d"),
    }
    if bench is not None:
        b = bench.reindex(df.index).ffill().to_numpy()
        if not np.isnan(b[-1]):
            rs = c / b
            lb = rs[max(0, n - 252) : n - 1]
            lb = lb[~np.isnan(lb)]
            st["rsLineNewHigh"] = bool(len(lb) and rs[-1] >= lb.max())
            if n > 64 and not np.isnan(rs[-64]):
                st["rsLine3mPct"] = round((rs[-1] / rs[-64] - 1) * 100, 1)
    piv = zigzag_levels(df)
    res = sup = None
    for i, p, is_hi in reversed(piv):
        if is_hi and res is None and i < n - 2 and h[i + 1 :].max() <= p:
            res = round(float(p), 2)
        if (not is_hi) and sup is None and i < n - 2 and l[i + 1 :].min() >= p:
            sup = round(float(p), 2)
        if res is not None and sup is not None:
            break
    st["resistance"], st["support"] = res, sup
    return st


# ---------------------------------------------------------------- SEC EDGAR (10+ years of annual data)
SEC_UA = __import__("os").environ.get(
    "SEC_USER_AGENT", "Ticker&Tape research contacto@tickerandtape.com")
_sec_map: dict | None = None
REV_TAGS = ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "SalesRevenueNet",
            "RevenueFromContractWithCustomerIncludingAssessedTax", "SalesRevenueGoodsNet", "RevenuesNetOfInterestExpense"]
EPS_TAGS = ["EarningsPerShareDiluted", "EarningsPerShareBasicAndDiluted", "EarningsPerShareBasic"]
NI_TAGS = ["NetIncomeLoss", "ProfitLoss"]
OP_TAGS = ["OperatingIncomeLoss"]


def sec_cik(sym: str):
    global _sec_map
    if _sec_map is None:
        import requests
        _sec_map = {}
        try:
            r = requests.get("https://www.sec.gov/files/company_tickers.json", headers={"User-Agent": SEC_UA}, timeout=30)
            r.raise_for_status()
            for v in r.json().values():
                _sec_map[str(v["ticker"]).upper().replace(".", "-")] = int(v["cik_str"])
            log(f"SEC: {len(_sec_map)} tickers mapped")
        except Exception as e:  # noqa: BLE001
            log(f"SEC ticker map failed: {e}")
    return _sec_map.get(sym)


def sec_facts(sym: str):
    import requests
    cik = sec_cik(sym)
    if not cik:
        return None
    time.sleep(0.15)   # SEC asks for at most 10 requests a second
    r = requests.get(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json",
                     headers={"User-Agent": SEC_UA}, timeout=60)
    if r.status_code != 200:
        return None
    return (r.json().get("facts") or {}).get("us-gaap")


def sec_periods(g: dict, tags: list[str], unit: str, take_max: bool = True) -> dict:
    """{(start, end): (value, filed)} — the latest filing of each period wins inside a tag;
    across tags the largest value (revenue: the total) or the first tag that has it."""
    out: dict = {}
    for prio, tag in enumerate(tags):
        rows = ((g.get(tag) or {}).get("units") or {}).get(unit) or []
        best: dict = {}
        for x in rows:
            if not str(x.get("form", "")).startswith(("10-K", "10-Q")):
                continue
            s, e, v = x.get("start"), x.get("end"), fnum(x.get("val"))
            if not s or not e or v is None:
                continue
            k = (s, e)
            if k not in best or str(x.get("filed", "")) >= best[k][1]:
                best[k] = (v, str(x.get("filed", "")))
        for k, val in best.items():
            if k not in out or (take_max and val[0] > out[k][0]):
                out[k] = val
    return out


def _days(k) -> int:
    return (pd.Timestamp(k[1]) - pd.Timestamp(k[0])).days


def sec_annual(g: dict) -> dict:
    """{fiscal-year end: {"rev", "eps", "ni", "epsFiled"}} from 10-K full-year facts."""
    out: dict = {}
    for name, tags, unit, mx in (("rev", REV_TAGS, "USD", True), ("eps", EPS_TAGS, "USD/shares", False),
                                 ("ni", NI_TAGS, "USD", False)):
        for k, (v, filed) in sec_periods(g, tags, unit, mx).items():
            if 340 <= _days(k) <= 380:
                d = out.setdefault(pd.Timestamp(k[1]), {})
                d[name] = v
                if name == "eps":
                    d["epsFiled"] = filed
    return out


def sec_quarterly(g: dict, tags: list[str], take_max: bool = True) -> dict:
    """{quarter end: value}; Q4 is derived as full year minus the 9-month year-to-date figure."""
    per = sec_periods(g, tags, "USD", take_max)
    q = {pd.Timestamp(k[1]): v for k, (v, _) in per.items() if 80 <= _days(k) <= 100}
    nine = {k[0]: (k, v) for k, (v, _) in per.items() if 260 <= _days(k) <= 290}
    for k, (v, _) in per.items():
        if 340 <= _days(k) <= 380 and k[0] in nine:
            e = pd.Timestamp(k[1])
            if not any(abs((e - x).days) <= 20 for x in q):
                q[e] = v - nine[k[0]][1]
    return q


def split_factor_after(splits: pd.Series | None, filed: str) -> float:
    """Splits that happened after a value was filed: divide that EPS by this to make it comparable today."""
    if splits is None or splits.empty or not filed:
        return 1.0
    f = 1.0
    for d, ratio in splits.items():
        if d > pd.Timestamp(filed) and fnum(ratio):
            f *= float(ratio)
    return f


# ---------------------------------------------------------------- fundamentals
def yf_news(t, n=8) -> list[dict]:
    news = []
    try:
        for it in (t.news or [])[:14]:
            c = it.get("content") if isinstance(it.get("content"), dict) else it
            title = c.get("title")
            url = ((c.get("canonicalUrl") or {}).get("url") or (c.get("clickThroughUrl") or {}).get("url")
                   or it.get("link") or "")
            pub = (c.get("provider") or {}).get("displayName") or it.get("publisher") or ""
            when = c.get("pubDate") or c.get("displayTime") or ""
            if not when and it.get("providerPublishTime"):
                when = dt.datetime.fromtimestamp(int(it["providerPublishTime"]), dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            if title and url.startswith("http"):
                news.append({"title": title, "url": url, "pub": pub, "date": str(when)[:19]})
    except Exception as e:  # noqa: BLE001
        log(f"news failed: {e}")
    return news[:n]


def _date(v) -> str:
    try:
        return pd.Timestamp(v).strftime("%Y-%m-%d")
    except Exception:  # noqa: BLE001
        return ""


def fetch_ownership(t, sym: str) -> dict:
    """Insider transactions (Form 4 via Yahoo) and institutional holders (13F via Yahoo)."""
    o: dict = {}
    # --- headline percentages
    try:
        mh = t.major_holders
        if mh is not None and not mh.empty:
            col = mh.columns[0]
            def mv(key):
                return fnum(mh.loc[key, col]) if key in mh.index else None
            ins, inst, instf, cnt = mv("insidersPercentHeld"), mv("institutionsPercentHeld"), mv("institutionsFloatPercentHeld"), mv("institutionsCount")
            o["insidersPct"] = None if ins is None else round(ins * 100, 2)
            o["instPct"] = None if inst is None else round(inst * 100, 1)
            o["instFloatPct"] = None if instf is None else round(instf * 100, 1)
            o["instCount"] = None if cnt is None else int(cnt)
    except Exception as e:  # noqa: BLE001
        log(f"{sym}: major holders failed: {e}")
    # --- top institutional holders
    try:
        ih = t.institutional_holders
        if ih is not None and not ih.empty:
            c_h, c_p, c_s, c_v, c_c, c_d = (find_col(ih, k) for k in ("holder", "pctheld", "shares", "value", "pctchange", "date"))
            rows = []
            for _, r in ih.head(10).iterrows():
                pct, chg = fnum(r[c_p]) if c_p else None, fnum(r[c_c]) if c_c else None
                rows.append({"holder": str(r[c_h]) if c_h else "", "pct": None if pct is None else round(pct * 100, 2),
                             "shares": fmt_big(fnum(r[c_s])) if c_s else "", "value": fmt_big(fnum(r[c_v])) if c_v else "",
                             "chg": None if chg is None else round(chg * 100, 1), "date": _date(r[c_d]) if c_d else ""})
            o["holders"] = rows
    except Exception as e:  # noqa: BLE001
        log(f"{sym}: institutional holders failed: {e}")
    # --- insider summary, last 6 months
    try:
        ip = t.insider_purchases
        if ip is not None and not ip.empty:
            lab = ip.columns[0]
            c_s, c_t = find_col(ip, "shares"), find_col(ip, "trans")
            summ = {}
            for _, r in ip.iterrows():
                k = str(r[lab]).lower()
                sh = fnum(r[c_s]) if c_s else None
                tr = fnum(r[c_t]) if c_t else None
                if k.startswith("purchases"):
                    summ["buyShares"], summ["buyTrans"] = sh, tr
                elif k.startswith("sales"):
                    summ["sellShares"], summ["sellTrans"] = sh, tr
                elif k.startswith("net shares"):
                    summ["netShares"] = sh
                elif k.startswith("% net"):
                    summ["netPct"] = None if sh is None else round(sh * 100, 2)
            if summ:
                o["insider6m"] = summ
    except Exception as e:  # noqa: BLE001
        log(f"{sym}: insider purchases failed: {e}")
    # --- individual insider transactions
    try:
        it = t.insider_transactions
        if it is not None and not it.empty:
            c_i, c_p, c_tx, c_tr, c_s, c_v, c_d = (find_col(it, k) for k in ("insider", "position", "text", "transaction", "shares", "value", "start"))
            rows = []
            for _, r in it.head(40).iterrows():
                txt = (str(r[c_tx]) if c_tx and pd.notna(r[c_tx]) else "") + " " + (str(r[c_tr]) if c_tr and pd.notna(r[c_tr]) else "")
                tl = txt.lower()
                kind = ("Buy" if "purchase" in tl or "buy" in tl else "Sell" if "sale" in tl or "sell" in tl
                        else "Award" if "award" in tl or "grant" in tl else "Exercise" if "exercise" in tl or "conversion" in tl
                        else "Gift" if "gift" in tl else "Other")
                rows.append({"date": _date(r[c_d]) if c_d else "", "who": str(r[c_i]).title() if c_i else "",
                             "pos": str(r[c_p]) if c_p and pd.notna(r[c_p]) else "", "type": kind,
                             "shares": fmt_big(fnum(r[c_s])) if c_s else "", "value": fmt_big(fnum(r[c_v])) if c_v else ""})
            # buys and sells first: awards and exercises are compensation, not conviction
            key = {"Buy": 0, "Sell": 0}
            rows.sort(key=lambda x: (key.get(x["type"], 1), "".join(chr(255 - ord(ch)) for ch in x["date"])))
            o["insiders"] = sorted(rows[:14], key=lambda x: x["date"], reverse=True)
    except Exception as e:  # noqa: BLE001
        log(f"{sym}: insider transactions failed: {e}")
    return o


def fetch_etf(t, sym: str, info: dict) -> dict:
    grp, short, gics = ETFS.get(sym, ("ETF", "", ""))
    f: dict = {"name": info.get("longName") or info.get("shortName") or sym, "exchange": info.get("fullExchangeName") or "",
               "mktCap": fmt_big(info.get("totalAssets") or info.get("netAssets")), "about": (info.get("longBusinessSummary") or "").strip()}
    e = {"group": grp, "tracks": short, "gics": gics, "aum": fmt_big(info.get("totalAssets") or info.get("netAssets"))}
    er = fnum(info.get("netExpenseRatio"))
    if er is None:
        er2 = fnum(info.get("annualReportExpenseRatio"))
        er = None if er2 is None else er2 * 100
    e["expense"] = "" if er is None else f"{er:.2f}%"
    y = fnum(info.get("yield")) or fnum(info.get("dividendYield"))
    e["yield"] = "" if y is None else (f"{y * 100:.2f}%" if y < 1 else f"{y:.2f}%")
    inc = info.get("fundInceptionDate")
    if inc:
        try:
            e["inception"] = dt.datetime.fromtimestamp(int(inc), dt.timezone.utc).strftime("%Y")
        except Exception:  # noqa: BLE001
            pass
    try:
        fd = t.funds_data
        try:
            ov = fd.fund_overview or {}
            e["category"] = ov.get("categoryName") or ""
            e["family"] = ov.get("family") or ""
        except Exception:  # noqa: BLE001
            pass
        try:
            th = fd.top_holdings
            if th is not None and not th.empty:
                c_n, c_p = find_col(th, "name"), find_col(th, "percent")
                e["holdings"] = [{"symbol": str(ix).replace(".", "-"), "name": str(r[c_n]) if c_n else "",
                                  "pct": round((fnum(r[c_p]) or 0) * 100, 2)} for ix, r in th.head(15).iterrows()]
        except Exception as ex:  # noqa: BLE001
            log(f"{sym}: top holdings failed: {ex}")
        try:
            sw = fd.sector_weightings or {}
            e["sectors"] = sorted(({"name": k.replace("_", " ").title(), "pct": round(float(v) * 100, 1)}
                                   for k, v in sw.items() if fnum(v)), key=lambda x: -x["pct"])
        except Exception:  # noqa: BLE001
            pass
    except Exception as ex:  # noqa: BLE001
        log(f"{sym}: funds data failed: {ex}")
    f["etf"] = e
    f["news"] = yf_news(t) or rss_news(sym)
    return f


def fetch_fundamentals(sym: str) -> dict:
    import yfinance as yf

    t = yf.Ticker(sym)
    f: dict = {}
    info = {}
    try:
        info = t.get_info() or {}
    except Exception as e:  # noqa: BLE001
        log(f"{sym}: info failed: {e}")
    if sym in ETFS or str(info.get("quoteType", "")).upper() == "ETF":
        return fetch_etf(t, sym, info)
    f["name"] = info.get("longName") or info.get("shortName") or sym
    f["exchange"] = info.get("fullExchangeName") or info.get("exchange") or ""
    f["sector"] = info.get("sector") or ""
    f["industryYahoo"] = info.get("industry") or ""
    f["mktCap"] = fmt_big(info.get("marketCap"))
    f["float"] = fmt_big(info.get("floatShares"))
    f["shares"] = fmt_big(info.get("sharesOutstanding"))
    inst = fnum(info.get("heldPercentInstitutions"))
    f["inst"] = "" if inst is None else f"{inst * 100:.0f}%"
    roe = fnum(info.get("returnOnEquity"))
    f["roe"] = "" if roe is None else f"{roe * 100:.0f}%"
    de = fnum(info.get("debtToEquity"))
    f["debt"] = "" if de is None else f"{de:.0f}%"
    f["about"] = (info.get("longBusinessSummary") or "").strip()
    f["website"] = info.get("website") or ""
    emp = fnum(info.get("fullTimeEmployees"))
    f["employees"] = "" if emp is None else f"{emp:,.0f}"
    f["hq"] = ", ".join(x for x in (info.get("city"), info.get("state"), info.get("country")) if x)

    # --- analyst ratings and price targets
    try:
        rec = t.recommendations
        if rec is not None and not rec.empty:
            r0 = rec[rec["period"] == "0m"].iloc[0] if "period" in rec.columns and (rec["period"] == "0m").any() else rec.iloc[0]
            f["analysts"] = {k: int(fnum(r0.get(k)) or 0) for k in ("strongBuy", "buy", "hold", "sell", "strongSell")}
    except Exception as e:  # noqa: BLE001
        log(f"{sym}: recommendations failed: {e}")
    f["target"] = {"mean": fnum(info.get("targetMeanPrice")), "high": fnum(info.get("targetHighPrice")),
                   "low": fnum(info.get("targetLowPrice")), "n": fnum(info.get("numberOfAnalystOpinions")),
                   "key": info.get("recommendationKey") or ""}

    # --- latest headlines
    news = yf_news(t)
    if not news:
        news = rss_news(sym)
    f["news"] = news[:8]

    # --- insiders and institutions
    try:
        f["own"] = fetch_ownership(t, sym)
    except Exception as e:  # noqa: BLE001
        log(f"{sym}: ownership failed: {e}")

    # --- SEC filings: 10+ years of annual figures and quarterly sales / operating income
    g = None
    try:
        g = sec_facts(sym)
    except Exception as e:  # noqa: BLE001
        log(f"{sym}: SEC facts failed: {e}")
    sec_q_rev = sec_quarterly(g, REV_TAGS) if g else {}
    sec_q_op = sec_quarterly(g, OP_TAGS, take_max=False) if g else {}
    splits = None
    try:
        splits = t.splits
        if splits is not None and not splits.empty:
            splits = splits.copy()
            splits.index = pd.to_datetime(splits.index).tz_localize(None)
    except Exception:  # noqa: BLE001
        splits = None

    # --- quarterly EPS from earnings dates (adjusted EPS, like IBD)
    ed = None
    try:
        ed = t.get_earnings_dates(limit=20)
    except Exception as e:  # noqa: BLE001
        log(f"{sym}: earnings dates failed: {e}")
    reports, next_earn = [], None
    if ed is not None and not ed.empty:
        ed = ed.copy()
        ed.index = pd.to_datetime(ed.index).tz_localize(None)
        c_rep, c_est, c_sur = find_col(ed, "reported"), find_col(ed, "estimate"), find_col(ed, "surprise")
        c_typ = find_col(ed, "event")
        if c_typ is not None:
            ed = ed[ed[c_typ].astype(str).str.contains("Earn", case=False) | ed[c_typ].isna()]
        today = pd.Timestamp.today().normalize()
        fut = ed[(ed.index >= today)]
        if c_rep is not None:
            fut = fut[fut[c_rep].isna()]
        if len(fut):
            nd = fut.index.min()
            next_earn = {"date": nd.strftime("%Y-%m-%d"), "est": fnum(fut.loc[nd, c_est]) if c_est else None}
            if isinstance(next_earn["est"], pd.Series):
                next_earn["est"] = fnum(next_earn["est"].iloc[0])
        if c_rep is not None:
            past = ed[ed[c_rep].notna() & (ed.index < today + pd.Timedelta(days=1))].sort_index(ascending=False)
            past = past[~past.index.normalize().duplicated()]
            for d, r in past.iterrows():
                reports.append({"date": d, "eps": fnum(r[c_rep]), "est": fnum(r[c_est]) if c_est else None,
                                "surprise": fnum(r[c_sur]) if c_sur else None})

    qis = None
    try:
        qis = t.quarterly_income_stmt
        if qis is not None and not qis.empty:
            qis = qis.copy()
            qis.columns = pd.to_datetime(qis.columns).tz_localize(None)
            qis = qis.sort_index(axis=1, ascending=False)
    except Exception as e:  # noqa: BLE001
        log(f"{sym}: quarterly income failed: {e}")
        qis = None

    # period end for each report: anchor on income statement period ends, step back 3 months
    q_ends = list(qis.columns) if qis is not None and not qis.empty else []

    def period_end_for(report_date, k):
        cands = [e for e in q_ends if pd.Timedelta(days=5) <= report_date - e <= pd.Timedelta(days=110)]
        if cands:
            return max(cands)
        if k == 0 or not reports:
            prev_q = pd.Timestamp(report_date.year, ((report_date.month - 1) // 3) * 3 + 1, 1) - pd.Timedelta(days=1)
            return prev_q.normalize()
        return None

    ends = []
    for k, r in enumerate(reports):
        e = period_end_for(r["date"], k)
        if e is None and ends and ends[-1] is not None:
            e = month_end(ends[-1] - pd.DateOffset(months=3))
        ends.append(e)

    def near(m: dict, end):
        for k, v in m.items():
            if abs((k - end).days) <= 20:
                return v
        return None

    def rev_at(end):
        if end is None:
            return None, None, None
        rev = op = dil = None
        if qis is not None:
            for col in qis.columns:
                if abs((col - end).days) <= 20:
                    rev = row_val(qis, ["Total Revenue", "Operating Revenue"], col)
                    op = row_val(qis, ["Operating Income", "EBIT"], col)
                    dil = row_val(qis, ["Diluted EPS"], col)
                    break
        # SEC filings fill the quarters Yahoo no longer returns (Yahoo keeps ~5)
        if rev is None:
            rev = near(sec_q_rev, end)
        if op is None:
            op = near(sec_q_op, end)
        return rev, op, dil

    # --- consensus estimates. Yahoo only gives the estimate for the quarter not yet reported, so each run
    # keeps a snapshot per quarter; once the quarter is reported the last snapshot is the expectation it faced.
    est_store = est_cache_get(sym)
    next_lbl = None
    if ends and ends[0] is not None and next_earn:
        next_lbl = qlabel(month_end(ends[0] + pd.DateOffset(months=3)))
        snap = {"seen": pd.Timestamp.today().strftime("%Y-%m-%d")}
        try:
            re_ = t.revenue_estimate
            if re_ is not None and "0q" in re_.index:
                snap["rev"] = fnum(re_.loc["0q"].get("avg"))
        except Exception:  # noqa: BLE001
            pass
        if next_earn.get("est") is not None:
            snap["eps"] = next_earn["est"]
        if snap.get("rev") is not None or snap.get("eps") is not None:
            est_store[next_lbl] = snap
            est_cache_put(sym, est_store)
        f["nextQ"] = {"q": next_lbl, "date": next_earn["date"],
                      "epsEst": "" if snap.get("eps") is None else f"{snap['eps']:.2f}",
                      "salesEst": fmt_big(snap.get("rev"))}

    quarters = []
    for k, r in enumerate(reports[:8]):
        end = ends[k]
        rev, op, _ = rev_at(end)
        yago = reports[k + 4]["eps"] if k + 4 < len(reports) else None
        rev_y = None
        if end is not None:
            rev_y, _, _ = rev_at(month_end(end - pd.DateOffset(months=12)))
        quarters.append({
            "q": qlabel(end) if end is not None else r["date"].strftime("%b-%y"),
            "date": r["date"].strftime("%Y-%m-%d"),
            "eps": "" if r["eps"] is None else f"{r['eps']:.2f}",
            "epsChg": fmt_pct(pct_change(r["eps"], yago)),
            "sales": fmt_big(rev),
            "salesChg": fmt_pct(pct_change(rev, rev_y)),
            "margin": "" if (rev in (None, 0) or op is None) else f"{op / rev * 100:.1f}%",
            "surprise": fmt_pct(r["surprise"], 1),
            "epsEst": "" if r["est"] is None else f"{r['est']:.2f}",
        })
        se = (est_store.get(quarters[-1]["q"]) or {}).get("rev")
        if se and rev is not None:
            quarters[-1]["salesEst"] = fmt_big(se)
            quarters[-1]["salesSurprise"] = fmt_pct(pct_change(rev, se), 1)
    f["quarters"] = quarters
    beats = [r for r in reports[:8] if r["surprise"] is not None]
    if beats:
        n_beat = sum(1 for r in beats if r["surprise"] > 0)
        f["epsSurprise"] = f"{n_beat}/{len(beats)} {fmt_pct(beats[0]['surprise'], 0)}"
    if next_earn:
        f["nextEarn"] = pd.Timestamp(next_earn["date"]).strftime("%d-%b-%y")
        f["nextEarnDate"] = next_earn["date"]
        f["nextEarnEst"] = next_earn["est"]
        if next_earn["est"] is not None and len(reports) >= 4:
            f["epsDue"] = fmt_pct(pct_change(next_earn["est"], reports[3]["eps"]))

    # --- annual
    ais = None
    try:
        ais = t.income_stmt
        if ais is not None and not ais.empty:
            ais = ais.copy()
            ais.columns = pd.to_datetime(ais.columns).tz_localize(None)
            ais = ais.sort_index(axis=1, ascending=False)
    except Exception as e:  # noqa: BLE001
        log(f"{sym}: annual income failed: {e}")
        ais = None
    annual = []
    if ais is not None and not ais.empty:
        cols = list(ais.columns)
        for i, col in enumerate(cols):
            eps = row_val(ais, ["Diluted EPS", "Basic EPS"], col)
            rev = row_val(ais, ["Total Revenue", "Operating Revenue"], col)
            prev = cols[i + 1] if i + 1 < len(cols) else None
            peps = row_val(ais, ["Diluted EPS", "Basic EPS"], prev) if prev is not None else None
            prev_rev = row_val(ais, ["Total Revenue", "Operating Revenue"], prev) if prev is not None else None
            if eps is None and rev is None:
                continue
            ni = row_val(ais, ["Net Income", "Net Income Common Stockholders"], col)
            annual.append({"y": str(col.year), "eps": "" if eps is None else f"{eps:.2f}",
                           "chg": fmt_pct(pct_change(eps, peps)), "sales": fmt_big(rev),
                           "salesChg": fmt_pct(pct_change(rev, prev_rev)),
                           "netMgn": "" if (not rev or ni is None) else f"{ni / rev * 100:.1f}%"})
        pre = row_val(ais, ["Pretax Income"], cols[0])
        rev0 = row_val(ais, ["Total Revenue", "Operating Revenue"], cols[0])
        if pre is not None and rev0:
            f["pretax"] = f"{pre / rev0 * 100:.0f}%"
        e0 = row_val(ais, ["Diluted EPS"], cols[0])
        e3 = row_val(ais, ["Diluted EPS"], cols[3]) if len(cols) > 3 else None
        if e0 and e3 and e0 > 0 and e3 > 0:
            f["epsGrowth"] = fmt_pct(((e0 / e3) ** (1 / 3) - 1) * 100)

    # SEC 10-K history (up to 10 years) replaces Yahoo's 4 years when it is longer
    if g:
        sa = sec_annual(g)
        ends = sorted((e for e in sa if sa[e].get("rev") is not None or sa[e].get("eps") is not None), reverse=True)
        if ends and pd.Timestamp.today() - ends[0] < pd.Timedelta(days=550):
            def eps_adj(e):
                d = sa[e]
                v = d.get("eps")
                return None if v is None else v / split_factor_after(splits, d.get("epsFiled", ""))
            sec_rows = []
            for i, e in enumerate(ends[:11]):
                d = sa[e]
                prev = ends[i + 1] if i + 1 < len(ends) and (e - ends[i + 1]).days < 400 else None
                eps, peps = eps_adj(e), eps_adj(prev) if prev is not None else None
                rev, prev_rev = d.get("rev"), sa[prev].get("rev") if prev is not None else None
                ni = d.get("ni")
                sec_rows.append({"y": str((e - pd.Timedelta(days=20)).year), "eps": "" if eps is None else f"{eps:.2f}",
                                 "chg": fmt_pct(pct_change(eps, peps)), "sales": fmt_big(rev),
                                 "salesChg": fmt_pct(pct_change(rev, prev_rev)),
                                 "netMgn": "" if (not rev or ni is None) else f"{ni / rev * 100:.1f}%"})
            if len(sec_rows) > len(annual):
                annual = sec_rows
                if not f.get("epsGrowth") and len(ends) > 3:
                    e0, e3 = eps_adj(ends[0]), eps_adj(ends[3])
                    if e0 and e3 and e0 > 0 and e3 > 0:
                        f["epsGrowth"] = fmt_pct(((e0 / e3) ** (1 / 3) - 1) * 100)
    f["annual"] = annual[:10]
    return f


def _pnum(x):
    try:
        return float(str(x).replace("+", "").replace("%", "").replace(",", ""))
    except (TypeError, ValueError):
        return None


def rss_news(sym: str) -> list[dict]:
    """Headlines from Yahoo Finance's RSS feed (fallback when yfinance returns none), then Google News."""
    import requests
    import xml.etree.ElementTree as ET
    from email.utils import parsedate_to_datetime
    feeds = [f"https://feeds.finance.yahoo.com/rss/2.0/headline?s={sym}&region=US&lang=en-US",
             f"https://news.google.com/rss/search?q={sym}+stock&hl=en-US&gl=US&ceid=US:en"]
    for url in feeds:
        try:
            r = requests.get(url, headers=UA, timeout=20)
            if r.status_code != 200:
                continue
            out = []
            for it in ET.fromstring(r.content).iter("item"):
                title = (it.findtext("title") or "").strip()
                link = (it.findtext("link") or "").strip()
                src = it.find("source")
                pub = (src.text if src is not None and src.text else "").strip()
                if not pub and " - " in title and "google" in url:
                    title, pub = title.rsplit(" - ", 1)
                when = ""
                try:
                    when = parsedate_to_datetime(it.findtext("pubDate") or "").astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
                except Exception:  # noqa: BLE001
                    pass
                if title and link.startswith("http"):
                    out.append({"title": title, "url": link, "pub": pub or ("Yahoo Finance" if "yahoo" in url else ""), "date": when})
            if out:
                out.sort(key=lambda n: n["date"], reverse=True)
                return out[:8]
        except Exception:  # noqa: BLE001
            continue
    return []


def smr_rating(f: dict) -> str:
    """Approximation of IBD's SMR (Sales growth, profit Margins, Return on equity), graded A-E."""
    q = [v for v in (_pnum(x.get("salesChg")) for x in (f.get("quarters") or [])[:3]) if v is not None]
    a = [v for v in (_pnum(x.get("salesChg")) for x in (f.get("annual") or [])) if v is not None]
    sales = sum(q) / len(q) if q else (a[0] if a else None)

    def pts(v, t):
        return None if v is None else 3 if v >= t[0] else 2 if v >= t[1] else 1 if v >= t[2] else 0
    sc = [x for x in (pts(sales, (25, 15, 5)), pts(_pnum(f.get("pretax")), (25, 15, 8)), pts(_pnum(f.get("roe")), (25, 17, 10)))
          if x is not None]
    if len(sc) < 2:
        return ""
    avg = sum(sc) / len(sc)
    return "A" if avg >= 2.6 else "B" if avg >= 2 else "C" if avg >= 1.3 else "D" if avg >= 0.6 else "E"


# ---------------------------------------------------------------- demo data
def demo_inputs(watch: list[str]):
    """Synthetic market so the whole pipeline and site can be tested offline."""
    rng = np.random.default_rng(7)
    days = pd.bdate_range(end=pd.Timestamp("2026-09-30"), periods=760)
    sectors = ["Information Technology", "Health Care", "Industrials", "Financials", "Energy", "Consumer Discretionary"]
    subs = {s: [f"{s.split()[0]} Group {k}" for k in "ABC"] for s in sectors}

    def walk(p0, drift, vol, vol0):
        regimes, out, p = [], [], p0
        i = 0
        while i < len(days):
            n = int(rng.integers(30, 90))
            mu = drift + rng.normal(0, 0.0015)
            sig = vol * rng.uniform(0.7, 1.3)
            for _ in range(min(n, len(days) - i)):
                r = mu + sig * rng.normal()
                o = p * (1 + sig * 0.3 * rng.normal())
                c = p * (1 + r)
                hi = max(o, c) * (1 + abs(sig * 0.5 * rng.normal()))
                lo = min(o, c) * (1 - abs(sig * 0.5 * rng.normal()))
                big = abs(r) > sig * 1.6
                vv = vol0 * (0.7 + 0.5 * rng.random()) * (2.2 if big else 1) * (1.08 if r > 0 else 0.95)
                out.append((o, hi, lo, c, vv))
                p = c
                i += 1
        return pd.DataFrame(out, index=days, columns=["Open", "High", "Low", "Close", "Volume"])

    prices: dict[str, pd.DataFrame] = {}
    uni: dict[str, dict] = {}
    for k in range(160):
        s = f"U{k:03d}"
        sec = sectors[k % len(sectors)]
        uni[s] = {"sector": sec, "industry": subs[sec][k % 3], "ix": 1 | (2 if k % 4 == 0 else 0)}
        prices[s] = walk(rng.uniform(20, 300), rng.normal(0.0004, 0.0009), rng.uniform(0.012, 0.03), 3e6)
    for e_sym, (grp, short, gics) in ETFS.items():
        uni[e_sym] = {"sector": "ETF", "industry": grp, "name": short, "etf": True}
        prices[e_sym] = walk(rng.uniform(20, 600), rng.normal(0.0003, 0.0006), rng.uniform(0.008, 0.018), 2e7)
    for f_sym in FUTURES:
        prices[f_sym] = walk(rng.uniform(3, 3000), rng.normal(0.0002, 0.0008), rng.uniform(0.01, 0.022), 2e5)
    idx = walk(4200, 0.0005, 0.009, 3.5e9)
    prices["^GSPC"] = idx
    prices["^IXIC"] = walk(13000, 0.0006, 0.011, 5e9)
    fund = {}
    for j, s in enumerate(watch):
        sec = sectors[j % len(sectors)]
        prices[s] = walk(rng.uniform(40, 400), 0.0009 + 0.0004 * rng.random(), rng.uniform(0.013, 0.022), rng.uniform(2e6, 2e7))
        if j % 3 == 0:
            uni[s] = {"sector": sec, "industry": subs[sec][j % 3]}
        eps = rng.uniform(0.5, 3)
        reps = []
        for q in range(48):
            reps.append(eps)
            eps *= 1 / (1 + rng.uniform(-0.03, 0.12))
        rev = rng.uniform(1e9, 2e10)
        last_q = pd.Timestamp("2026-06-30")
        quarters = []
        for q in range(8):
            end = month_end(last_q - pd.DateOffset(months=3 * q))
            e, ey = reps[q], reps[q + 4]
            quarters.append({"q": qlabel(end), "date": (end + pd.Timedelta(days=24)).strftime("%Y-%m-%d"),
                             "eps": f"{e:.2f}", "epsChg": fmt_pct(pct_change(e, ey)), "sales": fmt_big(rev * (0.93 ** q)),
                             "salesChg": fmt_pct(rng.uniform(-5, 45)), "margin": f"{rng.uniform(10, 45):.1f}%",
                             "surprise": fmt_pct(rng.uniform(-4, 12), 1), "epsEst": f"{e / 1.04:.2f}",
                             "salesEst": fmt_big(rev * (0.93 ** q) / 1.02), "salesSurprise": fmt_pct(rng.uniform(-3, 6), 1)})
        annual = [{"y": str(2025 - k), "eps": f"{sum(reps[4 * k:4 * k + 4]):.2f}",
                   "chg": fmt_pct(rng.uniform(-10, 60)), "sales": fmt_big(rev * 4 * (0.85 ** k)),
                   "salesChg": fmt_pct(rng.uniform(-5, 40)), "netMgn": f"{rng.uniform(5, 30):.1f}%"} for k in range(10)]
        fund[s] = {"name": f"Demo Company {s}", "exchange": "NYSE", "sector": sec, "industryYahoo": subs[sec][j % 3],
                   "mktCap": fmt_big(rng.uniform(5e9, 9e11)), "float": fmt_big(rng.uniform(1e8, 3e9)),
                   "shares": fmt_big(rng.uniform(1e8, 3e9)), "inst": f"{rng.uniform(40, 85):.0f}%",
                   "roe": f"{rng.uniform(8, 45):.0f}%", "debt": f"{rng.uniform(0, 80):.0f}%", "pretax": f"{rng.uniform(10, 45):.0f}%",
                   "epsGrowth": fmt_pct(rng.uniform(5, 45)), "epsSurprise": "7/8 +5%", "nextEarn": "22-Oct-26",
                   "epsDue": fmt_pct(rng.uniform(5, 40)), "quarters": quarters, "annual": annual,
                   "about": f"Demo Company {s} designs, manufactures and sells widgets for industrial and consumer markets "
                            "worldwide. It operates through Data Center, Client and Embedded segments, and sells through "
                            "distributors, OEMs and directly to large customers. The company was founded in 1969 and is "
                            "headquartered in Santa Clara, California.",
                   "website": "https://example.com", "employees": "28,000", "hq": "Santa Clara, CA, United States",
                   "analysts": {"strongBuy": 12, "buy": 25, "hold": 9, "sell": 1, "strongSell": 1},
                   "target": {"mean": 250.0, "high": 320.0, "low": 150.0, "n": 44, "key": "buy"},
                   "news": [{"title": f"Demo headline {k} about {s}", "url": "https://example.com", "pub": "Demo Wire",
                             "date": f"2026-09-{28 - k:02d}T13:00:00"} for k in range(6)]}
    for e_sym, (grp, short, gics) in ETFS.items():
        fund[e_sym] = {"name": f"Demo {short} ETF", "exchange": "NYSE Arca", "mktCap": "41.2B",
                       "about": f"The fund seeks to track the {short} index.",
                       "etf": {"group": grp, "tracks": short, "gics": gics, "aum": "41.2B", "expense": "0.09%", "yield": "1.35%",
                               "inception": "1998", "category": f"{short}", "family": "Demo Funds",
                               "holdings": [{"symbol": w, "name": f"Demo Company {w}", "pct": round(12 - i * 0.7, 2)} for i, w in enumerate(watch[:12])],
                               "sectors": [{"name": n, "pct": p} for n, p in (("Technology", 41.2), ("Communication Services", 12.1), ("Consumer Cyclical", 10.4), ("Financial Services", 9.8), ("Healthcare", 8.7))]},
                       "news": []}
    for s_ in watch:
        fund[s_]["own"] = {"insidersPct": 3.9, "instPct": 67.4, "instFloatPct": 70.1, "instCount": 4812,
                           "insider6m": {"buyShares": 12000, "buyTrans": 2, "sellShares": 1450000, "sellTrans": 31, "netShares": -1438000, "netPct": -2.1},
                           "insiders": [{"date": f"2026-09-{25 - k * 3:02d}", "who": ["Huang Jen-Hsun", "Kress Colette", "Puri Ajay", "Stevens Mark A"][k % 4],
                                         "pos": ["Chief Executive Officer", "Chief Financial Officer", "Officer", "Director"][k % 4],
                                         "type": ["Sell", "Sell", "Buy", "Award", "Sell", "Exercise"][k % 6],
                                         "shares": ["240K", "35K", "10K", "120K", "60K", "80K"][k % 6], "value": ["42.1M", "6.2M", "1.8M", "", "10.4M", ""][k % 6]} for k in range(8)],
                           "holders": [{"holder": h, "pct": p, "shares": sh, "value": v, "chg": c, "date": "2026-06-30"} for h, p, sh, v, c in (
                               ("Vanguard Group Inc", 9.1, "2.22B", "390.5B", 1.2), ("Blackrock Inc.", 7.8, "1.90B", "334.0B", -0.4),
                               ("State Street Corporation", 4.0, "975M", "171.3B", 2.6), ("FMR, LLC", 3.6, "880M", "154.6B", -5.1),
                               ("Geode Capital Management, LLC", 2.3, "561M", "98.6B", 3.3))]}
    return uni, prices, fund


# ---------------------------------------------------------------- fundamentals cache (rotation)
FUND_MAX_AGE_DAYS = 7      # universe fundamentals older than this get refreshed
FUND_VERSION = 4          # bump when fetch_fundamentals gains new fields
FUND_BATCH = int(__import__("os").environ.get("INK_FUND_BATCH", "150"))  # universe tickers refreshed per run


def est_cache_get(sym: str) -> dict:
    p = CACHE / "est" / f"{sym}.json"
    try:
        return json.loads(p.read_text()) if p.exists() else {}
    except Exception:  # noqa: BLE001
        return {}


def est_cache_put(sym: str, d: dict) -> None:
    (CACHE / "est").mkdir(parents=True, exist_ok=True)
    keep = dict(sorted(d.items(), key=lambda kv: kv[1].get("seen", ""))[-16:])
    (CACHE / "est" / f"{sym}.json").write_text(jdumps(keep, separators=(",", ":")))


def fund_cache_get(sym: str):
    p = CACHE / "fund" / f"{sym}.json"
    if not p.exists():
        return None, None
    try:
        d = json.loads(p.read_text())
        # entries saved by an older version of this script count as due for a refresh
        return d.get("fund"), (d.get("ts") if d.get("v") == FUND_VERSION else 0)
    except Exception:  # noqa: BLE001
        return None, None


def fund_cache_put(sym: str, fund: dict) -> None:
    (CACHE / "fund").mkdir(parents=True, exist_ok=True)
    (CACHE / "fund" / f"{sym}.json").write_text(jdumps({"ts": time.time(), "v": FUND_VERSION, "fund": fund}, separators=(",", ":")))


def has_fund_data(f: dict | None) -> bool:
    return bool(f and (f.get("quarters") or f.get("annual") or f.get("mktCap")))


# ---------------------------------------------------------------- main
# ---------------------------------------------------------------- trade ideas
IDEA_STATUSES = ("Breakout", "In buy zone", "Near pivot")
IDEA_MIN_RS, IDEA_MIN_DVOL, IDEA_MIN_PX = 80, 2e7, 10
IDEA_STOP_PCT = 0.07       # O'Neil rule: cut losses 7% below the buy point
IDEA_MAX_DAYS = 40         # a flagged idea is tracked for 8 weeks
IDEA_MAX = 30
IDEAS_URL = "https://tickerandtape.com/data/ideas.json"


def idea_ok(r: dict) -> bool:
    b = r.get("base") or {}
    return bool(
        not r.get("etf") and (r.get("rsRating") or 0) >= IDEA_MIN_RS and b.get("status") in IDEA_STATUSES
        and b.get("type") != "Deep correction" and (r.get("dollarVol50") or 0) >= IDEA_MIN_DVOL
        and (r.get("close") or 0) >= IDEA_MIN_PX
        and (r.get("vs50Pct") is None or r["vs50Pct"] > 0) and (r.get("vs200Pct") is None or r["vs200Pct"] > 0))


# ---------------------------------------------------------------- earnings calendar
NASDAQ_UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
             "Accept": "application/json, text/plain, */*", "Origin": "https://www.nasdaq.com", "Referer": "https://www.nasdaq.com/"}


def _timing(v) -> str:
    """Normalize report timing to "bmo" (before the open), "amc" (after the close) or ""."""
    t = str(v or "").lower()
    if any(k in t for k in ("bmo", "pre-market", "pre market", "before")):
        return "bmo"
    if any(k in t for k in ("amc", "after", "post")):
        return "amc"
    return ""


def earnings_from_nasdaq(days: list[pd.Timestamp]) -> dict:
    """{(symbol, date): {...}} from Nasdaq's public earnings calendar, one request per weekday."""
    import requests
    out = {}
    for d in days:
        try:
            r = requests.get("https://api.nasdaq.com/api/calendar/earnings", params={"date": d.strftime("%Y-%m-%d")},
                             headers=NASDAQ_UA, timeout=20)
            rows = ((r.json().get("data") or {}).get("rows")) or []
        except Exception as e:  # noqa: BLE001
            log(f"earnings (nasdaq) {d.date()}: {e}")
            continue
        for x in rows:
            sym = yf_symbol(str(x.get("symbol") or ""))
            if not sym:
                continue
            money = lambda v: fnum(str(v or "").replace("$", "").replace(",", "").replace("(", "-").replace(")", ""))
            out[(sym, d.strftime("%Y-%m-%d"))] = {
                "time": _timing(x.get("time")), "epsEst": money(x.get("epsForecast")), "epsLY": money(x.get("lastYearEPS")),
                "epsAct": money(x.get("eps")),
                "surprise": fnum(str(x.get("surprise") or "").replace("%", "")), "quarter": x.get("fiscalQuarterEnding") or ""}
        time.sleep(0.6)
    log(f"earnings (nasdaq): {len(out)} events")
    return out


def earnings_from_yahoo(start: pd.Timestamp, end: pd.Timestamp) -> dict:
    """Same shape from Yahoo's earnings calendar (yfinance >= 1.x), paged 100 at a time."""
    import yfinance as yf
    out = {}
    try:
        cal = yf.Calendars(start=start.strftime("%Y-%m-%d"), end=end.strftime("%Y-%m-%d"))
        for page in range(40):
            df = cal.get_earnings_calendar(limit=100, offset=page * 100, filter_most_active=False, force=True)
            if df is None or df.empty:
                break
            df = df.reset_index()
            c_sym, c_dt = find_col(df, "symbol"), find_col(df, "startdate") or find_col(df, "date")
            c_tim, c_est = find_col(df, "timing") or find_col(df, "calltime"), find_col(df, "estimate")
            c_act, c_sur = find_col(df, "reported"), find_col(df, "surprise")
            if c_sym is None or c_dt is None:
                break
            for _, x in df.iterrows():
                ts = pd.Timestamp(x[c_dt])
                if ts.tzinfo is not None:
                    ts = ts.tz_convert("America/New_York").tz_localize(None)
                tim = _timing(x[c_tim]) if c_tim is not None else ("bmo" if ts.hour and ts.hour < 12 else "amc" if ts.hour >= 15 else "")
                out[(yf_symbol(str(x[c_sym])), ts.strftime("%Y-%m-%d"))] = {
                    "time": tim, "epsEst": fnum(x[c_est]) if c_est is not None else None,
                    "epsAct": fnum(x[c_act]) if c_act is not None else None,
                    "surprise": fnum(x[c_sur]) if c_sur is not None else None, "quarter": ""}
            if len(df) < 100:
                break
            time.sleep(1)
    except Exception as e:  # noqa: BLE001
        log(f"earnings (yahoo): {e}")
    log(f"earnings (yahoo): {len(out)} events")
    return out


def build_earnings(out: Path, rows: list[dict], prices: dict, data_day: pd.Timestamp, now_iso: str, demo=False) -> None:
    """earnings.json: who reports from last Monday to next Friday, before the open or after the close, with estimates,
    results and the stock's reaction. Only stocks the site covers (index members, watchlists, starred tickers)."""
    by_sym = {r["symbol"]: r for r in rows if not r.get("etf")}
    mon = (data_day - pd.Timedelta(days=data_day.weekday())).normalize()
    if data_day.weekday() >= 4:   # from Friday's close on, "this week" is the coming one
        mon += pd.Timedelta(days=7)
    start, end = mon - pd.Timedelta(days=7), mon + pd.Timedelta(days=11)
    days = [d for d in pd.date_range(start, end) if d.weekday() < 5]

    events: dict = {}
    if demo:
        rng = np.random.default_rng(3)
        for s in list(by_sym)[::4]:
            d = days[int(rng.integers(0, len(days)))]
            past = d <= data_day
            est = round(float(rng.uniform(0.2, 3)), 2)
            act = round(est * float(rng.uniform(0.85, 1.25)), 2) if past else None
            events[(s, d.strftime("%Y-%m-%d"))] = {"time": ["bmo", "amc", ""][int(rng.integers(0, 3))], "epsEst": est, "epsAct": act,
                                                   "surprise": round((act / est - 1) * 100, 1) if act else None, "quarter": ""}
    else:
        events = earnings_from_nasdaq(days)
        for k, v in earnings_from_yahoo(start, end + pd.Timedelta(days=1)).items():
            if k in events:
                e = events[k]
                for f in ("time", "epsEst", "epsAct", "surprise"):
                    if e.get(f) in (None, "") and v.get(f) not in (None, ""):
                        e[f] = v[f]
            else:
                events[k] = v
    # fallback: next report date stored with each stock's fundamentals
    seen = {s for s, _ in events}
    for s in by_sym:
        if s in seen:
            continue
        f = fund_cache_get(s)[0] or {}
        d = f.get("nextEarnDate")
        if d and start.strftime("%Y-%m-%d") <= d <= end.strftime("%Y-%m-%d"):
            events[(s, d)] = {"time": "", "epsEst": f.get("nextEarnEst"), "epsAct": None, "surprise": None, "quarter": ""}

    out_rows = []
    for (s, d), e in events.items():
        r = by_sym.get(s)
        if r is None:
            continue
        ev = {"symbol": s, "name": r.get("name", ""), "date": d, "time": e.get("time", ""),
              "epsEst": e.get("epsEst"), "epsAct": e.get("epsAct"), "surprise": e.get("surprise"), "epsLY": e.get("epsLY"),
              "rs": r.get("rsRating"), "mcap": r.get("mcap"), "close": r.get("close"), "sector": r.get("sector", ""),
              "group": r.get("group", ""), "groupRank": r.get("groupRank", ""), "w": 1 if r.get("w") else 0}
        if ev["surprise"] is None and ev["epsAct"] is not None and ev["epsEst"] not in (None, 0):
            ev["surprise"] = round((ev["epsAct"] - ev["epsEst"]) / abs(ev["epsEst"]) * 100, 1)
        # reaction: first full session that traded on the news (same day before the open, next day after the close)
        df = prices.get(s)
        if df is not None and pd.Timestamp(d) <= data_day:
            c = df["Close"]
            i = c.index.searchsorted(pd.Timestamp(d))
            j = i if ev["time"] == "bmo" else i + 1
            if 0 < j < len(c) and i < len(c):
                ev["reactPct"] = round((float(c.iloc[j]) / float(c.iloc[j - 1]) - 1) * 100, 1)
        out_rows.append(ev)
    out_rows.sort(key=lambda e: (e["date"], -(e["mcap"] or 0)))
    weeks = [{"key": k, "start": (mon + pd.Timedelta(days=7 * o)).strftime("%Y-%m-%d"), "label": lbl}
             for k, o, lbl in (("last", -1, "Last week"), ("this", 0, "This week"), ("next", 1, "Next week"))]
    (out / "earnings.json").write_text(jdumps({"updated": now_iso, "dataDate": data_day.strftime("%Y-%m-%d"), "weeks": weeks,
                                                "events": out_rows}, separators=(",", ":")))
    log(f"earnings calendar: {len(out_rows)} reports between {start.date()} and {end.date()}")


def build_ideas(out: Path, rows: list[dict], prices: dict, day: str, now_iso: str) -> None:
    """ideas.json: today's setups (RS >= 80 near or just above a pivot) and how every flagged idea did since."""
    order = {s: i for i, s in enumerate(IDEA_STATUSES)}
    picks = sorted((r for r in rows if idea_ok(r)), key=lambda r: (order[r["base"]["status"]], -(r.get("rsRating") or 0)))[:IDEA_MAX]
    ideas = []
    for r in picks:
        b = r["base"]
        buy = b["pivot"]   # the buy point is the pivot; the stop sits 7% under it
        ideas.append({
            "symbol": r["symbol"], "name": r.get("name", ""), "group": r.get("group", ""), "sector": r.get("sector", ""),
            "groupRank": r.get("groupRank", ""), "rs": r.get("rsRating"), "close": r.get("close"), "chgPct": r.get("chgPct"),
            "status": b["status"], "type": b.get("type"), "weeks": b.get("weeks"), "depthPct": b.get("depthPct"),
            "pivot": b["pivot"], "buyZoneTop": b.get("buyZoneTop") or round(b["pivot"] * 1.05, 2),
            "stop": round(buy * (1 - IDEA_STOP_PCT), 2), "distPct": b.get("distPct"),
            "breakoutDate": b.get("breakoutDate"), "breakoutVolPct": b.get("breakoutVolPct"),
            "epsChg": r.get("epsChg", ""), "salesChg": r.get("salesChg", ""), "volVsAvgPct": r.get("volVsAvgPct"),
            "offHighPct": r.get("offHighPct"), "spark": r.get("spark"), "smr": r.get("smr", ""),
        })

    # track record: kept in the build cache; if the cache was lost, start from the published file
    hist_path = CACHE / "ideas_history.json"
    hist: dict = {}
    if hist_path.exists():
        hist = json.loads(hist_path.read_text())
    else:
        try:
            import requests
            hist = {h["key"]: h for h in requests.get(IDEAS_URL, headers=UA, timeout=30).json().get("history", [])}
        except Exception:  # noqa: BLE001
            hist = {}
    active = {h["symbol"] for h in hist.values() if h.get("result") == "Active"}
    for i in ideas:   # newly flagged
        if i["symbol"] in active:
            continue
        key = f'{i["symbol"]}:{day}'
        hist[key] = {"key": key, "symbol": i["symbol"], "name": i["name"], "date": day, "status": i["status"],
                     "price": i["close"], "pivot": i["pivot"], "stop": round(min(i["pivot"], i["close"]) * (1 - IDEA_STOP_PCT), 2),
                     "last": i["close"], "maxPct": 0.0, "retPct": 0.0, "result": "Active", "closed": None}
    for h in hist.values():   # mark to market
        if h.get("result") != "Active":
            continue
        df = prices.get(h["symbol"])
        if df is None:
            continue
        seg = df[df.index > pd.Timestamp(h["date"])]
        for d, bar in seg.iterrows():
            ret = (float(bar["Close"]) / h["price"] - 1) * 100
            h["maxPct"] = round(max(h["maxPct"], (float(bar["High"]) / h["price"] - 1) * 100), 1)
            h["last"], h["retPct"] = round(float(bar["Close"]), 2), round(ret, 1)
            if float(bar["Close"]) < h["stop"]:
                h["result"], h["closed"] = "Stopped", d.strftime("%Y-%m-%d")
                break
        if h["result"] == "Active" and len(seg) >= IDEA_MAX_DAYS:
            h["result"], h["closed"] = "Expired", seg.index[IDEA_MAX_DAYS - 1].strftime("%Y-%m-%d")
    hist = dict(sorted(hist.items(), key=lambda kv: kv[1]["date"], reverse=True)[:400])
    hist_path.write_text(jdumps(hist))
    done = [h for h in hist.values() if h["date"] < day]
    stats = {"count": len(done), "active": sum(h["result"] == "Active" for h in done),
             "winPct": round(100 * sum(h["retPct"] > 0 for h in done) / len(done)) if done else None,
             "avgPct": round(float(np.mean([h["retPct"] for h in done])), 1) if done else None,
             "avgMaxPct": round(float(np.mean([h["maxPct"] for h in done])), 1) if done else None}
    rules = {"minRs": IDEA_MIN_RS, "minDollarVol": IDEA_MIN_DVOL, "minPrice": IDEA_MIN_PX, "stopPct": IDEA_STOP_PCT * 100,
             "trackDays": IDEA_MAX_DAYS}
    (out / "ideas.json").write_text(jdumps({"updated": now_iso, "date": day, "rules": rules, "ideas": ideas,
                                             "history": list(hist.values())[:150], "stats": stats}, separators=(",", ":")))
    log(f"ideas: {len(ideas)} setups today, {len(hist)} in the track record")


# ---------------------------------------------------------------- composite rating, industry groups, share cards
SMR_PTS = {"A": 1.0, "B": 0.75, "C": 0.5, "D": 0.25, "E": 0.0}


def _ranks(vals: dict) -> dict:
    """Percentile (0..1) of each value among the non-missing ones."""
    good = {k: v for k, v in vals.items() if v is not None and v == v}
    if not good:
        return {}
    srt = np.sort(np.array(list(good.values()), dtype=float))
    return {k: float(np.searchsorted(srt, v, side="right")) / len(srt) for k, v in good.items()}


def add_composite(all_rows: list[dict]) -> None:
    """Composite Rating 1-99, in the spirit of IBD's: EPS growth counts double, then RS Rating, industry group rank,
    SMR and how close the stock trades to its 52-week high. Ranked against every stock on the site (ETFs excluded)."""
    pool = {}
    for r in all_rows:
        if not r.get("etf") and r.get("symbol") and r.get("rsRating") is not None:
            pool.setdefault(r["symbol"], r)
    def eps_val(r):
        v = [x for x in (_pnum(r.get("epsChg")), _pnum(r.get("epsGrowth"))) if x is not None]
        return None if not v else float(np.mean([max(-100.0, min(300.0, x)) for x in v]))
    def grp_val(r):
        m = re.match(r"(\d+) of (\d+)", str(r.get("groupRank") or ""))
        return None if not m else 1 - (int(m.group(1)) - 1) / max(1, int(m.group(2)))
    comps = {"eps": (2.0, _ranks({s: eps_val(r) for s, r in pool.items()})),
             "rs": (1.0, _ranks({s: r.get("rsRating") for s, r in pool.items()})),
             "grp": (1.0, _ranks({s: grp_val(r) for s, r in pool.items()})),
             "smr": (1.0, _ranks({s: SMR_PTS.get(r.get("smr") or "") for s, r in pool.items()})),
             "high": (1.0, _ranks({s: r.get("offHighPct") for s, r in pool.items()}))}
    raw = {}
    for s in pool:
        got = [(w, d[s]) for w, d in comps.values() if s in d]
        if len(got) >= 3:
            raw[s] = sum(w * v for w, v in got) / sum(w for w, _ in got)
    final = {s: int(min(99, max(1, round(1 + 98 * p)))) for s, p in _ranks(raw).items()}
    for r in all_rows:
        if r.get("symbol") in final:
            r["comp"] = final[r["symbol"]]


def build_groups(out: Path, prices: dict, uni: dict, ref_syms: list[str], all_rows: list[dict], now_iso: str, day: str) -> None:
    """groups.json: every GICS sub-industry ranked by the average RS score of its members today and 1, 3 and 6 weeks ago,
    with equal-weight performance, breadth (% above the 50-day line) and its three strongest stocks."""
    members: dict[str, list[str]] = {}
    for s in ref_syms:
        ind = uni.get(s, {}).get("industry")
        if ind and s in prices:
            members.setdefault(ind, []).append(s)
    members = {g: m for g, m in members.items() if len(m) >= 2}
    closes = {s: prices[s]["Close"].dropna().to_numpy(dtype=float) for m in members.values() for s in m}
    ranks = {}
    for lag in (0, 5, 15, 30):
        avg = {}
        for g, mem in members.items():
            sc = [x for x in (rs_score(closes[s][:len(closes[s]) - lag] if lag else closes[s]) for s in mem) if x is not None]
            if len(sc) >= 2:
                avg[g] = float(np.mean(sc))
        ranks[lag] = {g: i + 1 for i, g in enumerate(sorted(avg, key=lambda g: -avg[g]))}
    by_sym = {}
    for r in all_rows:
        by_sym.setdefault(r.get("symbol"), r)
    total = len(ranks[0])
    out_groups = []
    for g, rank in ranks[0].items():
        mem = members[g]
        def chg(n):
            v = [c[-1] / c[-1 - n] - 1 for c in (closes[s] for s in mem) if len(c) > n and c[-1 - n] > 0]
            return None if not v else round(float(np.mean(v)) * 100, 2)
        ytd = []
        above = []
        for s in mem:
            ser = prices[s]["Close"].dropna()
            prev = ser[ser.index < pd.Timestamp(ser.index[-1].year, 1, 1)]
            if len(prev):
                ytd.append(float(ser.iloc[-1] / prev.iloc[-1] - 1))
            if len(ser) >= 50:
                above.append(float(ser.iloc[-1]) > float(ser.tail(50).mean()))
        lead = sorted((by_sym[s] for s in mem if s in by_sym and by_sym[s].get("rsRating") is not None),
                      key=lambda r: -(r.get("rsRating") or 0))[:3]
        out_groups.append({
            "name": g, "sector": uni[mem[0]].get("sector", ""), "n": len(mem), "rank": rank,
            "r1w": ranks[5].get(g), "r3w": ranks[15].get(g), "r6w": ranks[30].get(g),
            "chg1w": chg(5), "chg1m": chg(21), "chg3m": chg(63),
            "ytd": None if not ytd else round(float(np.mean(ytd)) * 100, 2),
            "above50": None if not above else round(100 * sum(above) / len(above)),
            "leaders": [[r["symbol"], r.get("rsRating"), r.get("chgPct"), r.get("comp")] for r in lead]})
    out_groups.sort(key=lambda x: x["rank"])
    (out / "groups.json").write_text(jdumps({"updated": now_iso, "date": day, "total": total, "groups": out_groups}, separators=(",", ":")))
    log(f"groups: {total} industry groups ranked")


def build_share_cards(out: Path, prices: dict, all_rows: list[dict], day: str) -> None:
    """For every ticker on the site: a 1200x630 chart image (og/SYMBOL.png) and a small page (c/SYMBOL/index.html)
    whose preview shows that chart when the link is shared on X, WhatsApp or Telegram. People who open the link land
    on the interactive chart."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.collections import LineCollection
    from PIL import Image
    import html as _h

    root = out.parent            # site/ (the data folder is site/data): cards live at /og/SYMBOL.png and /c/SYMBOL/
    (root / "og").mkdir(exist_ok=True)
    (root / "c").mkdir(exist_ok=True)
    INK, NAVY, UP, DOWN, PAPER, GRID = "#15171c", "#1f3c6e", "#1d3fc4", "#e0337f", "#f3f1ea", "#c9cbd3"
    fig = plt.figure(figsize=(12, 6.3), dpi=100, facecolor=PAPER)
    seen, made = set(), 0
    t0 = time.time()
    for r in all_rows:
        s = r.get("symbol")
        df = prices.get(s)
        if not s or s in seen or s.startswith("^") or "=" in s or df is None or len(df) < 60:
            continue
        seen.add(s)
        try:
            d = df.dropna(subset=["Close"]).tail(190)
            c = d["Close"].to_numpy(float); h = d["High"].fillna(d["Close"]).to_numpy(float)
            lo = d["Low"].fillna(d["Close"]).to_numpy(float); v = d["Volume"].fillna(0).to_numpy(float)
            full = df["Close"].dropna().astype(float)
            m50 = full.rolling(50).mean().tail(len(d)).to_numpy(); m200 = full.rolling(200).mean().tail(len(d)).to_numpy()
            fig.clf()
            ax = fig.add_axes([0.04, 0.27, 0.86, 0.5], facecolor="white"); axv = fig.add_axes([0.04, 0.08, 0.86, 0.17], facecolor="white", sharex=ax)
            x = np.arange(len(c)); up = np.r_[True, c[1:] >= c[:-1]]
            segs = [[(i, lo[i]), (i, h[i])] for i in x] + [[(i, c[i]), (i + 0.45, c[i])] for i in x]
            cols = [UP if u else DOWN for u in up] * 2
            ax.add_collection(LineCollection(segs, colors=cols, linewidths=1.4))
            ax.plot(x, m50, color="#d23a2a", lw=1.3); ax.plot(x, m200, color=INK, lw=1.3)
            piv = (r.get("base") or {}).get("pivot")
            ymin, ymax = np.nanmin(lo), np.nanmax(h)
            if piv and ymin * 0.8 < piv < ymax * 1.25:
                ax.axhline(piv, color="#3c8a3a", lw=1.2, ls=(0, (4, 3))); ymax = max(ymax, piv)
            pad = (ymax - ymin) * 0.06
            ax.set_xlim(-1, len(c) + 1); ax.set_ylim(ymin - pad, ymax + pad)
            axv.bar(x, v, color=cols[:len(x)], width=0.7)
            for a in (ax, axv):
                a.grid(True, color=GRID, ls=(0, (1, 3)), lw=0.8); a.tick_params(labelsize=10, colors="#5a5d66", length=0)
                for sp in a.spines.values(): sp.set_color(INK)
                a.yaxis.tick_right()
            axv.set_yticks([]); plt.setp(ax.get_xticklabels(), visible=False)
            months = [i for i in range(1, len(d)) if d.index[i].month != d.index[i - 1].month]
            axv.set_xticks(months); axv.set_xticklabels([d.index[i].strftime("%b") for i in months])
            chg = r.get("chgPct")
            fig.text(0.04, 0.88, s, fontsize=40, fontweight="bold", color=NAVY, va="baseline")
            fig.text(0.04 + 0.032 * len(s) + 0.02, 0.88, str(r.get("name") or "")[:44], fontsize=17, color=INK, va="baseline", family="serif")
            fig.text(0.04, 0.815, f"{c[-1]:,.2f}" + ("" if chg is None else f"   {chg:+.2f}%") + f"   ·   {d.index[-1].strftime('%b %d, %Y')}",
                     fontsize=15, color=INK, family="monospace", va="baseline")
            badges = []
            if r.get("rsRating") is not None: badges.append(f"RS {r['rsRating']}")
            if r.get("comp") is not None: badges.append(f"Comp {r['comp']}")
            b = r.get("base") or {}
            if b.get("type") and b.get("status") and b.get("type") != "Deep correction":
                badges.append(f"{b['type']} · {b['status']}" + (f" · pivot {b['pivot']:,.2f}" if b.get("pivot") else ""))
            fig.text(0.96, 0.88, "   ".join(badges[:2]), fontsize=17, fontweight="bold", color=NAVY, ha="right", va="baseline")
            if len(badges) > 2: fig.text(0.96, 0.815, badges[2], fontsize=13, color="#3c8a3a", ha="right", va="baseline")
            fig.text(0.96, 0.025, "Ticker&Tape · tickerandtape.com", fontsize=12, fontweight="bold", color=NAVY, ha="right")
            fig.text(0.04, 0.025, "Daily · 50- and 200-day lines" + (" · pivot" if piv else ""), fontsize=10, color="#5a5d66")
            fs = file_symbol(s)
            p = root / "og" / f"{fs}.png"
            fig.savefig(p, dpi=100, facecolor=PAPER)
            Image.open(p).convert("RGB").quantize(colors=48, method=Image.Quantize.MEDIANCUT).save(p, optimize=True)
            # the page behind the shared link
            title = f"{s} chart · " + (f"RS Rating {r['rsRating']} · " if r.get("rsRating") is not None else "") + "Ticker&Tape"
            desc = f"{r.get('name') or s}: O'Neil-style daily chart" + "".join(f", {x}" for x in badges) + \
                (f". EPS {r['epsChg']}, sales {r['salesChg']} last quarter" if r.get("epsChg") and r.get("salesChg") else "") + ". Free on Ticker&Tape."
            E = _h.escape
            (root / "c" / fs).mkdir(exist_ok=True)
            (root / "c" / fs / "index.html").write_text(f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>{E(title)}</title>
<meta name="description" content="{E(desc)}"><link rel="canonical" href="https://tickerandtape.com/chart/{E(s)}/">
<meta property="og:type" content="website"><meta property="og:site_name" content="Ticker&amp;Tape"><meta property="og:title" content="{E(title)}">
<meta property="og:description" content="{E(desc)}"><meta property="og:url" content="https://tickerandtape.com/c/{E(fs)}/">
<meta property="og:image" content="https://tickerandtape.com/og/{E(fs)}.png?d={day}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:site" content="@Tickerandtape"><meta name="twitter:image" content="https://tickerandtape.com/og/{E(fs)}.png?d={day}">
<link rel="icon" href="/favicon.ico"><script>location.replace("/chart/" + {jdumps(s)} + "/?via=card");</script></head>
<body style="font:16px Arial,sans-serif;background:#f3f1ea;color:#15171c;padding:24px"><h1 style="color:#1f3c6e">{E(s)} · {E(str(r.get('name') or ''))}</h1>
<p>{E(desc)}</p><p><a href="/chart/{E(s)}/">Open the interactive chart on Ticker&amp;Tape →</a></p><img src="/og/{E(fs)}.png" alt="{E(s)} daily chart" width="600"></body></html>""")
            made += 1
        except Exception as e:  # noqa: BLE001
            log(f"{s}: share card failed: {e}")
    plt.close(fig)
    log(f"share cards: {made} in {time.time() - t0:.0f}s")


SITE_URL = "https://tickerandtape.com"
# every section of the app gets its own page (title, description, link preview). Sections need an account, so only the
# home page (welcome for visitors) and the chart pages are offered to search engines
SECTION_PAGES = {
    "watchlist": ("Watchlist · Ticker&Tape", "Your watchlist with RS Ratings, EPS and sales growth, bases, pivots and buy-zone status, updated every trading day.", False),
    "screener": ("Stock screener: RS Rating, Composite, bases and pivots · Ticker&Tape", "Screen every U.S. stock and ADR worth $1 billion or more by RS Rating, Composite Rating, EPS and sales growth, distance from the high and base status.", False),
    "etfs": ("ETF screener: sectors, industries, bonds, commodities · Ticker&Tape", "Sector, industry, factor, bond, commodity and country ETFs ranked by relative strength and performance, with O'Neil-style charts.", False),
    "groups": ("Industry group rankings · Ticker&Tape", "Every GICS sub-industry ranked by the relative strength of its stocks, with rank changes over 1, 3 and 6 weeks and the leaders of each group.", False),
    "heatmap": ("Stock market heatmap · Ticker&Tape", "S&P 500 and Nasdaq-100 heatmap by sector, colored by daily, weekly, monthly or year-to-date change or by RS Rating.", False),
    "breadth": ("Market breadth and market direction · Ticker&Tape", "Market direction read the O'Neil way, with distribution and follow-through days, stocks above their moving averages, new highs and lows, the A/D line and the McClellan oscillator.", False),
    "compare": ("Comparative charts: SPY vs RSP vs MAGS and ratios · Ticker&Tape", "Stack several tickers on one timeline or chart ratios like RSP:SPY to see who leads the market. Custom moving averages and performance view.", False),
    "ideas": ("Trade ideas: leaders near a buy point · Ticker&Tape", "Stocks with an RS Rating of 80 or more near a pivot, in the buy zone or just out of a base, found automatically every trading day.", False),
    "earnings": ("Earnings calendar · Ticker&Tape", "This week's and next week's earnings reports with RS Ratings, expected EPS and the stocks' chart setups.", False),
    "wall": ("Chart wall · Ticker&Tape", "", False),
    "welcome": ("Ticker&Tape · The complete research platform for stock traders", "", False),
}
STATIC_PAGES = ["about/", "methodology/", "glossary/", "changelog/", "privacy.html", "terms.html"]


def build_pages(root: Path, all_rows: list[dict], day: str) -> None:
    """Static copies of the app page with their own title, description, link preview and canonical URL:
    one per section (/breadth/, /compare/ …) and one per ticker (/chart/NVDA/), plus 404.html and sitemap.xml.
    The app reads the path and opens the right view, so each URL works on its own and can be indexed."""
    import html as _h
    E = _h.escape
    tpl = (root / "index.html").read_text()

    def page(path: str, title: str, desc: str, image: str | None = None, index: bool = True) -> str:
        url = SITE_URL + path
        t = tpl
        t = re.sub(r"<title>.*?</title>", f"<title>{E(title)}</title>\n<link rel=\"canonical\" href=\"{E(url)}\">" +
                   ("" if index else '\n<meta name="robots" content="noindex">'), t, count=1, flags=re.S)
        if desc:
            t = re.sub(r'(<meta name="description" content=")[^"]*', lambda m: m.group(1) + E(desc), t, count=1)
            t = re.sub(r'(<meta property="og:description" content=")[^"]*', lambda m: m.group(1) + E(desc), t, count=1)
        t = re.sub(r'(<meta property="og:title" content=")[^"]*', lambda m: m.group(1) + E(title), t, count=1)
        t = re.sub(r'(<meta property="og:url" content=")[^"]*', lambda m: m.group(1) + E(url), t, count=1)
        if image:
            t = re.sub(r'(<meta property="og:image" content=")[^"]*', lambda m: m.group(1) + E(image), t, count=1)
        return t

    def write(rel: str, txt: str) -> None:
        d = root / rel
        d.mkdir(parents=True, exist_ok=True)
        (d / "index.html").write_text(txt)

    urls = [(SITE_URL + "/", "daily", "1.0")]
    for key, (title, desc, idx) in SECTION_PAGES.items():
        write(key, page(f"/{key}/", title, desc, index=idx))
        if idx:
            urls.append((f"{SITE_URL}/{key}/", "daily", "0.8"))
    seen = set()
    for r in all_rows:
        s = r.get("symbol")
        if not s or s in seen or s.startswith("^") or "/" in s:
            continue
        seen.add(s)
        name = str(r.get("name") or "")
        bits = []
        if r.get("rsRating") is not None: bits.append(f"RS Rating {r['rsRating']}")
        if r.get("comp") is not None: bits.append(f"Composite {r['comp']}")
        b = r.get("base") or {}
        if b.get("type") and b.get("status") and b.get("type") != "Deep correction":
            bits.append(f"{b['type'].lower()}, {b['status'].lower()}" + (f", pivot {b['pivot']:,.2f}" if b.get("pivot") else ""))
        if r.get("epsChg") and r.get("salesChg"): bits.append(f"EPS {r['epsChg']} and sales {r['salesChg']} last quarter")
        title = f"{s} stock chart" + (f": {name}" if name else "") + " · Ticker&Tape"
        desc = (f"{name} ({s}): " if name else f"{s}: ") + "O'Neil-style daily chart with RS line, moving averages, volume and automatic base and pivot detection" + \
            ("".join(f"; {x}" for x in bits)) + ". Free on Ticker&Tape."
        fs = file_symbol(s)
        img = f"{SITE_URL}/og/{fs}.png?d={day}" if (root / "og" / f"{fs}.png").exists() else None
        write(f"chart/{s}", page(f"/chart/{s}/", title, desc, img))
        urls.append((f"{SITE_URL}/chart/{s}/", "daily", "0.6" if not r.get("etf") else "0.5"))
    (root / "404.html").write_text(page("/404.html", "Ticker&Tape", "", index=False))
    for sp in STATIC_PAGES:
        if (root / sp.rstrip("/")).exists() or (root / sp).exists():
            urls.append((f"{SITE_URL}/{sp}", "monthly", "0.4"))
    sm = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    sm += [f"<url><loc>{E(u)}</loc><lastmod>{day}</lastmod><changefreq>{f}</changefreq><priority>{p}</priority></url>" for u, f, p in urls]
    sm.append("</urlset>")
    (root / "sitemap.xml").write_text("\n".join(sm))
    log(f"pages: {len(SECTION_PAGES)} sections, {len(seen)} charts, sitemap with {len(urls)} URLs")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--demo", action="store_true", help="synthetic data, no internet")
    ap.add_argument("--out", default=str(OUT_DEFAULT))
    ap.add_argument("--watchlist", default=str(ROOT / "watchlist.txt"))
    ap.add_argument("--no-universe", action="store_true", help="skip the S&P 1500 / Nasdaq-100 download")
    args = ap.parse_args()

    out = Path(args.out)
    (out / "t").mkdir(parents=True, exist_ok=True)
    CACHE.mkdir(exist_ok=True)
    watch = read_list(Path(args.watchlist))
    if not watch:
        sys.exit("watchlist.txt is empty")
    log(f"watchlist: {len(watch)} tickers")

    if args.demo:
        uni, prices, demo_fund = demo_inputs(watch)
    else:
        demo_fund = None
        uni = {} if args.no_universe else fetch_universe()
        cache_uni = CACHE / "universe.json"
        cached_uni = json.loads(cache_uni.read_text()) if cache_uni.exists() else {}
        if len(uni) >= max(300, 0.8 * len(cached_uni)):
            cache_uni.write_text(jdumps(uni))
        elif cached_uni:
            # one Wikipedia page failed: keep what we got and fill the gaps from the last good list
            for s, d in cached_uni.items():
                uni.setdefault(s, d)
            log(f"universe: completed from cached list ({len(uni)})")
        broad = {} if args.no_universe else fetch_broad_market()
        for s, d in broad.items():
            if s not in uni:
                uni[s] = {**d, "broad": True}
        log(f"universe: {sum(1 for d in uni.values() if d.get('broad'))} stocks added from the broad market, "
            f"{map_gics(uni)} of them placed in GICS groups")
        extra = read_list(ROOT / "universe_extra.txt")
        for s in extra:
            uni.setdefault(s, {"sector": "", "industry": ""})
        # tickers starred by site users that the indexes and watchlist.txt do not cover: chart + rotation
        # fundamentals like any universe stock, but kept out of the RS reference set and group ranks
        for s in ETFS:
            uni[s] = {"sector": "ETF", "industry": ETFS[s][0], "name": ETFS[s][1], "etf": True}
        user_extra = [s for s in fetch_user_tickers() if s not in uni and s not in watch]
        for s in user_extra:
            uni[s] = {"sector": "", "industry": "", "user": True}
        log(f"user tickers: {len(user_extra)} added")
        log(f"universe: {len(uni)} stocks")
        symbols = list(dict.fromkeys(watch + list(INDEXES) + list(FUTURES) + list(uni)))
        prices = download_prices(symbols, "3y")
    for f_sym in FUTURES:
        if f_sym in prices:
            prices[f_sym] = clean_futures(prices[f_sym])

    bench_df = prices.get(BENCH)
    if bench_df is None:
        sys.exit("Could not download the S&P 500 (^GSPC). Yahoo may be rate-limiting; try again later.")
    bench = bench_df["Close"]
    # Globex reopens at 6 pm ET, so Yahoo may already carry a stub bar for the next session: cut it
    for f_sym in FUTURES:
        if f_sym in prices:
            prices[f_sym] = prices[f_sym][prices[f_sym].index <= bench.index[-1]]

    # RS ratings against the universe (plus watchlist so the scale is never empty)
    scores = {s: rs_score(df["Close"].to_numpy()) for s, df in prices.items() if not s.startswith("^") and s not in FUTURES}
    ref_syms = [s for s in uni if scores.get(s) is not None and not uni[s].get("user") and not uni[s].get("etf")] or [s for s in scores if scores[s] is not None]
    ref = np.sort(np.array([scores[s] for s in ref_syms]))
    log(f"RS reference set: {len(ref)} stocks")

    # industry group ranking (GICS sub-industry, by average RS score of members)
    groups: dict[str, list[float]] = {}
    for s in ref_syms:
        ind = uni.get(s, {}).get("industry")
        if ind:
            groups.setdefault(ind, []).append(scores[s])
    grp_avg = {g: float(np.mean(v)) for g, v in groups.items() if len(v) >= 2}
    grp_order = sorted(grp_avg, key=lambda g: -grp_avg[g])
    grp_rank = {g: i + 1 for i, g in enumerate(grp_order)}

    def grp_letter(rank, total):
        p = rank / total
        return "A" if p <= 0.2 else "B" if p <= 0.4 else "C" if p <= 0.6 else "D" if p <= 0.8 else "E"

    market = [dict(m, symbol=k) for k, v in INDEXES.items() if (m := market_pulse(prices.get(k), v))]

    # ---------- market breadth + O'Neil market state (the state also drives the market pulse cards)
    try:
        states = build_breadth(out, prices, uni, ref_syms, dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%MZ"))
        for m in market:
            st = states.get(m["symbol"])
            if st:
                m.update({"status": st["status"], "distDays": st["distDays"], "distDates": st["distDates"],
                          "rallyDay": st["rallyDay"], "ftdDate": st["ftdDate"]})
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        log(f"breadth failed: {e}")

    # benchmark file
    bjson = {"name": "S&P 500", "symbol": BENCH,
             "prices": [[d.strftime("%Y-%m-%d"), round(float(x), 2)] for d, x in bench.items()]}
    (out / "bench.json").write_text(jdumps(bjson, separators=(",", ":")))

    now_iso = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%MZ")

    def heat_fields(df: pd.DataFrame, fund: dict, gi: dict) -> dict:
        """Extra columns for the heatmap: 1W / 1M / YTD change, market cap (shares x last close) and index bits."""
        c = df["Close"].to_numpy()
        last = float(c[-1])
        def back(n):
            return None if len(c) <= n else round((last / float(c[-1 - n]) - 1) * 100, 2)
        prev_year = df["Close"][df.index < pd.Timestamp(df.index[-1].year, 1, 1)]
        shares = parse_big((fund or {}).get("shares"))
        mcap = shares * last if shares else parse_big((fund or {}).get("mktCap"))
        out = {"perf1w": back(5), "perf1m": back(21),
               "ytd": round((last / float(prev_year.iloc[-1]) - 1) * 100, 2) if len(prev_year) else None,
               "mcap": round(mcap / 1e6) if mcap else None}   # millions of dollars
        if gi.get("ix"):
            out["ix"] = gi["ix"]
        return out

    def build(s: str, df: pd.DataFrame, fund: dict):
        """Price analytics + fundamentals -> (screener row, chart bundle)."""
        fund = dict(fund or {})
        gi = uni.get(s, {})
        fund.setdefault("name", gi.get("name") or s)
        if not fund.get("name") or fund.get("name") == s:
            fund["name"] = gi.get("name") or s
        st = price_stats(df, bench)
        st["rsRating"] = rs_rating(scores.get(s), ref)
        base = detect_base(df)
        group = gi.get("industry") or fund.get("industryYahoo") or ""
        fund.pop("groupRank", None), fund.pop("grpRs", None)
        if gi.get("industry") in grp_rank:
            r = grp_rank[gi["industry"]]
            fund["groupRank"] = f"{r} of {len(grp_rank)}"
            fund["grpRs"] = grp_letter(r, len(grp_rank))
        fund["group"] = " · ".join(x for x in (gi.get("sector") or fund.get("sector"), group) if x)
        if st["rsRating"] is not None:
            fund["rs"] = str(st["rsRating"])
        q0 = (fund.get("quarters") or [{}])[0]
        row = {
            "symbol": s, "name": fund.get("name", s), "group": group, "sector": gi.get("sector") or fund.get("sector", ""),
            "groupRank": fund.get("groupRank", ""), **{k: st.get(k) for k in (
                "close", "chgPct", "rsRating", "offHighPct", "vs50Pct", "vs200Pct", "volVsAvgPct", "udRatio",
                "atrPct", "perf3m", "perf12m", "rsLineNewHigh", "dollarVol50", "date")},
            "epsChg": q0.get("epsChg", ""), "salesChg": q0.get("salesChg", ""),
            "smr": smr_rating(fund), "epsGrowth": fund.get("epsGrowth", ""),
            "base": None if not base else {k: base.get(k) for k in ("type", "pivot", "distPct", "status", "weeks", "depthPct",
                                                                   "buyZoneTop", "breakoutDate", "breakoutVolPct")},
            "spark": [round(float(x), 2) for x in df["Close"].to_numpy()[-90:]],
            **heat_fields(df, fund, gi),
        }
        if gi.get("adr"):
            row["adr"] = 1
        if gi.get("etf"):
            row["etf"] = 1
            row["group"] = ETFS.get(s, ("ETF",))[0]
            row["sector"] = "ETF"
            row["tracks"] = ETFS.get(s, ("", ""))[1]
        bundle = {
            "symbol": s, "name": fund.get("name", s), "updated": now_iso,
            "prices": [[d.strftime("%Y-%m-%d"), round(r.Open, 2), round(r.High, 2), round(r.Low, 2), round(r.Close, 2), int(r.Volume)]
                       for d, r in df.iterrows()],
            "fund": fund, "stats": st, "base": base, "row": row,
        }
        return row, bundle, base

    def write_bundle(s, bundle, keep_cache=False):
        txt = jdumps(bundle, separators=(",", ":"))
        (out / "t" / f"{file_symbol(s)}.json").write_text(txt)
        if keep_cache:
            (CACHE / "t").mkdir(exist_ok=True)
            (CACHE / "t" / f"{file_symbol(s)}.json").write_text(txt)

    # ---------- 1) watchlist: fresh fundamentals every run
    rows, errors = [], []
    fresh: set[str] = set()
    for s in watch:
        df = prices.get(s)
        if df is None:
            cached = CACHE / "t" / f"{s}.json"
            errors.append(f"{s}: no price data from Yahoo" + (" (showing cached data)" if cached.exists() else ""))
            if cached.exists():
                bundle = json.loads(cached.read_text())
                (out / "t" / f"{s}.json").write_text(jdumps(bundle, separators=(",", ":")))
                if bundle.get("row"):
                    rows.append({**bundle["row"], "stale": True})
            continue
        try:
            if demo_fund is not None:
                fund = demo_fund.get(s, {})
            else:
                try:
                    fund = fetch_fundamentals(s)
                    if has_fund_data(fund):
                        fund_cache_put(s, fund)
                        fresh.add(s)
                    else:
                        fund = fund_cache_get(s)[0] or fund
                except Exception as e:  # noqa: BLE001
                    log(f"{s}: fundamentals failed: {e}")
                    errors.append(f"{s}: fundamentals unavailable")
                    fund = fund_cache_get(s)[0] or {"name": s}
                time.sleep(0.8)
            row, bundle, base = build(s, df, fund)
            write_bundle(s, bundle, keep_cache=True)
            rows.append(row)
            log(f"{s}: ok  RS {row['rsRating']}  base {base['type'] + ' / ' + base['status'] if base else '-'}")
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            errors.append(f"{s}: {e}")

    # ---------- 2) universe: refresh the oldest fundamentals in rotation
    watch_set = set(watch)
    uni_syms = [s for s in uni if s not in watch_set and s in prices]
    if demo_fund is None and uni_syms and FUND_BATCH > 0:
        ages = []
        for s in uni_syms:
            f, ts = fund_cache_get(s)
            ages.append((ts or 0, s))
        due = [s for ts, s in sorted(ages) if time.time() - ts > FUND_MAX_AGE_DAYS * 86400][:FUND_BATCH]
        log(f"fundamentals rotation: refreshing {len(due)} of {len(uni_syms)} universe stocks")
        fails = 0
        for s in due:
            try:
                f = fetch_fundamentals(s)
                if has_fund_data(f):
                    fund_cache_put(s, f)
                    fresh.add(s)
                    fails = 0
                else:
                    fails += 1
            except Exception as e:  # noqa: BLE001
                log(f"{s}: fundamentals failed: {e}")
                fails += 1
            if fails >= 12:
                log("fundamentals rotation: too many failures in a row (Yahoo rate limit?), stopping for today")
                break
            time.sleep(0.8)

    # ---------- 3) universe screener + chart files for every stock
    uni_rows = []
    with_fund = 0
    for s in list(dict.fromkeys(watch + uni_syms)):
        if s in watch_set:
            r = next((x for x in rows if x["symbol"] == s), None)
            if r:
                uni_rows.append({**r, "w": 1})
            continue
        df = prices.get(s)
        if df is None:
            continue
        try:
            fund = fund_cache_get(s)[0] if demo_fund is None else demo_fund.get(s)
            if has_fund_data(fund):
                with_fund += 1
            else:
                fund = {"name": uni.get(s, {}).get("name") or s, "pending": True}
            row, bundle, _ = build(s, df, fund)
            write_bundle(s, bundle)
            uni_rows.append(row)
        except Exception as e:  # noqa: BLE001
            log(f"{s}: universe row failed: {e}")
    log(f"universe screener: {len(uni_rows)} stocks, {with_fund + len(watch)} with fundamentals")

    # ---------- 4) futures: chart files only (not in the screener, RS or group ranks)
    for f_sym, (f_grp, f_name, f_unit) in FUTURES.items():
        df = prices.get(f_sym)
        if df is None:
            cached = CACHE / "t" / f"{file_symbol(f_sym)}.json"
            errors.append(f"{f_sym}: no price data from Yahoo" + (" (showing cached data)" if cached.exists() else ""))
            if cached.exists():
                (out / "t" / cached.name).write_text(cached.read_text())
            continue
        try:
            _, bundle, _ = build(f_sym, df, {"name": f"{f_name} futures", "futures": {"group": f_grp, "unit": f_unit}})
            bundle["stats"].pop("rsRating", None)
            bundle["row"]["rsRating"] = None
            write_bundle(f_sym, bundle, keep_cache=True)
        except Exception as e:  # noqa: BLE001
            log(f"{f_sym}: futures chart failed: {e}")

    try:
        add_composite(rows + uni_rows)
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        log(f"composite rating failed: {e}")
    (out / "screener.json").write_text(jdumps(rows, separators=(",", ":")))
    (out / "universe.json").write_text(jdumps([{k: v for k, v in r.items() if k != "spark"} for r in uni_rows], separators=(",", ":")))
    (out / "spark.json").write_text(jdumps({r["symbol"]: r.get("spark") for r in uni_rows if r.get("spark")}, separators=(",", ":")))

    # ---------- reference levels for alerts: 21-day EMA, 50/200-day lines, pivot and average volume per ticker.
    # The API checks alerts against the delayed intraday prices every 15 minutes during the session.
    try:
        aref = {}
        for r in rows + uni_rows:
            sym = r.get("symbol")
            adf = prices.get(sym)
            if not sym or sym in aref or adf is None or len(adf) < 30:
                continue
            ac = adf["Close"].astype(float)
            e21 = float(ac.ewm(span=21, adjust=False).mean().iloc[-1])
            s50 = float(ac.tail(50).mean()) if len(ac) >= 50 else None
            s200 = float(ac.tail(200).mean()) if len(ac) >= 200 else None
            v50 = float(adf["Volume"].tail(50).mean())
            piv = (r.get("base") or {}).get("pivot")
            rnd = lambda x: None if x is None or x != x else round(float(x), 4)
            aref[sym] = [rnd(e21), rnd(s50), rnd(s200), rnd(piv), None if v50 != v50 else int(v50), rnd(ac.iloc[-1])]
        (out / "alertref.json").write_text(jdumps({"updated": now_iso, "date": bench.index[-1].strftime("%Y-%m-%d"),
                                                   "cols": ["ema21", "sma50", "sma200", "pivot", "avgVol50", "close"], "s": aref},
                                                  separators=(",", ":")))
        log(f"alert levels: {len(aref)} tickers")
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        log(f"alert levels failed: {e}")

    # ---------- industry group ranking page and the share cards (chart image + page per ticker)
    day = bench.index[-1].strftime("%Y-%m-%d")
    try:
        build_groups(out, prices, uni, ref_syms, rows + uni_rows, now_iso, day)
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        log(f"groups failed: {e}")
    try:
        build_share_cards(out, prices, rows + uni_rows, day)
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        log(f"share cards failed: {e}")
    try:
        build_pages(out.parent, rows + uni_rows, day)
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        log(f"pages failed: {e}")
    meta = {
        "updated": now_iso,
        "dataDate": bench.index[-1].strftime("%Y-%m-%d"),
        "demo": bool(args.demo), "universeSize": int(len(ref)), "groups": len(grp_rank),
        "allStocks": len(uni_rows), "withFundamentals": with_fund + len([s for s in watch if s in prices]),
        "market": market, "errors": errors,
    }
    (out / "meta.json").write_text(jdumps(meta, indent=1))

    # ---------- trade ideas: automatic setups + track record
    try:
        build_ideas(out, uni_rows, prices, bench.index[-1].strftime("%Y-%m-%d"), now_iso)
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        log(f"ideas failed: {e}")

    # ---------- earnings calendar: last week, this week and next week for every stock on the site
    try:
        build_earnings(out, uni_rows, prices, bench.index[-1], now_iso, demo=bool(args.demo))
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        log(f"earnings calendar failed: {e}")

    # ---------- home page: market and sector ETFs performance + market headlines
    def perf_row(sym):
        df = prices.get(sym)
        if df is None or df.empty:
            return None
        c = df["Close"].dropna()
        last = float(c.iloc[-1])
        def rnd(v):
            return None if v is None else round(v, 2)
        def back(n):
            return None if len(c) <= n else rnd(pct_change(last, float(c.iloc[-1 - n])))
        prev_year = c[c.index < pd.Timestamp(c.index[-1].year, 1, 1)]
        ytd = rnd(pct_change(last, float(prev_year.iloc[-1]))) if len(prev_year) else None
        grp, short, gics = ETFS.get(sym, ("", sym, ""))
        unit = ""
        if sym in FUTURES:
            grp, short, unit = FUTURES[sym]
        return {"symbol": sym, "name": short, "gics": gics, "grp": grp, "unit": unit, "close": round(last, 3 if last < 20 else 2), "date": c.index[-1].strftime("%Y-%m-%d"),
                "d1": back(1), "w1": back(5), "m3": back(63), "m9": back(189), "ytd": ytd, "m12": back(252),
                "spark": [round(float(x), 2) for x in c.to_numpy()[-63:]]}
    home = {"updated": now_iso, "market": [r for r in map(perf_row, HOME_MARKET) if r],
            "sectors": [r for r in map(perf_row, HOME_SECTORS) if r],
            "commodities": [r for r in map(perf_row, HOME_COMMODITIES) if r],
            "chart": {"symbol": HOME_CHART, "file": file_symbol(HOME_CHART), "name": FUTURES[HOME_CHART][1]}, "news": []}
    if not args.demo:
        try:
            import yfinance as yf
            seen, news = set(), []
            for sym in ("SPY", "QQQ", "^GSPC"):
                for n in yf_news(yf.Ticker(sym), 10):
                    if n["title"] not in seen:
                        seen.add(n["title"]); news.append(n)
            news.sort(key=lambda n: n.get("date", ""), reverse=True)
            home["news"] = news[:12] or rss_news("^GSPC")
        except Exception as e:  # noqa: BLE001
            log(f"market news failed: {e}")
    else:
        home["news"] = [{"title": f"Demo market headline {k}", "url": "https://example.com", "pub": "Demo Wire",
                         "date": f"2026-09-{29 - k:02d}T14:00:00"} for k in range(8)]
    (out / "home.json").write_text(jdumps(home, separators=(",", ":")))
    log(f"done: {len(rows)} watchlist tickers, {len(uni_rows)} in universe, {len(errors)} errors")


if __name__ == "__main__":
    main()

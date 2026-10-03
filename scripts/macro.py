#!/usr/bin/env python3
"""
Ticker&Tape — macro calendar and Fed rate odds  ->  site/data/macro.json

  python scripts/macro.py --out site/data/macro.json --cache cache
  python scripts/macro.py --out /tmp/macro.json --demo        # offline test

Everything is free and official, with times in New York (ET):
  * release calendars of the BLS (CPI, jobs, PPI, JOLTS…), BEA (GDP, PCE) and Census (retail sales, housing…),
    the FOMC meeting calendar of the Federal Reserve, plus the fixed weekly and monthly releases
    (jobless claims every Thursday, ISM on the first and third business days);
  * the latest values of each indicator from FRED (St. Louis Fed), to show the prior and the actual;
  * the odds of a cut, hold or hike at each FOMC meeting, calculated by us from the prices of the 30-day
    fed funds futures (CME ZQ contracts, via Yahoo Finance) with the standard method: the average rate a
    contract implies for its month, split between the days before and after the meeting.
A source that fails is skipped; the page shows what was found.
"""
from __future__ import annotations

import argparse
import calendar
import datetime as dt
import io
import json
import math
import re
import sys
from pathlib import Path

UA = {"User-Agent": "Mozilla/5.0 (Ticker&Tape macro calendar; contacto@tickerandtape.com)"}
NY = "America/New_York"
HOLIDAYS = {"2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07",
            "2026-11-26", "2026-12-25", "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18",
            "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24"}
FOMC_STATIC = ["2026-01-28", "2026-03-18", "2026-04-29", "2026-06-17", "2026-07-29", "2026-09-16", "2026-10-28", "2026-12-09"]   # decision days
SEP_STATIC = {"2026-03-18", "2026-06-17", "2026-09-16", "2026-12-09"}   # meetings with projections (dot plot)

# official releases we show: (pattern on the release title, key, display name, importance)
CATALOG = [
    (r"consumer price index", "cpi", "CPI inflation", 3),
    (r"employment situation", "nfp", "Jobs report: payrolls and unemployment", 3),
    (r"producer price index", "ppi", "PPI inflation", 2),
    (r"job openings and labor turnover", "jolts", "JOLTS job openings", 2),
    (r"employment cost index", "eci", "Employment cost index", 2),
    (r"productivity and costs", "prod", "Productivity and labor costs", 1),
    (r"import and export price", "impx", "Import and export prices", 1),
    (r"gross domestic product|\bgdp\b", "gdp", "GDP", 3),
    (r"personal income and outlays", "pce", "PCE inflation, income and spending", 3),
    (r"advance monthly sales for retail", "retail", "Retail sales", 3),
    (r"advance report on durable goods", "durable", "Durable goods orders", 2),
    (r"new residential construction", "starts", "Housing starts and permits", 2),
    (r"new residential sales", "newhome", "New home sales", 2),
    (r"international trade in goods and services", "trade", "Trade balance", 1),
    (r"construction spending", "constr", "Construction spending", 1),
]
# FRED series for the values: key -> (name, series, transform, unit)
INDIC = {
    "cpi": ("CPI, year over year", "CPIAUCSL", "yoy", "%"),
    "core_cpi": ("Core CPI, year over year", "CPILFESL", "yoy", "%"),
    "pce": ("Core PCE, year over year", "PCEPILFE", "yoy", "%"),
    "unrate": ("Unemployment rate", "UNRATE", "level", "%"),
    "nfp": ("Nonfarm payrolls, monthly change", "PAYEMS", "diff", "k"),
    "gdp": ("GDP growth, annualized", "A191RL1Q225SBEA", "level", "%"),
    "retail": ("Retail sales, monthly change", "RSAFS", "mom", "%"),
    "claims": ("Initial jobless claims", "ICSA", "thousands", "k"),
    "ppi": ("PPI final demand, year over year", "PPIFIS", "yoy", "%"),
    "jolts": ("Job openings", "JTSJOL", "millions", "M"),
    "starts": ("Housing starts, annual rate", "HOUST", "level", "k"),
    "newhome": ("New home sales, annual rate", "HSN1F", "level", "k"),
    "durable": ("Durable goods orders, monthly change", "DGORDER", "mom", "%"),
    "t10": ("10-year Treasury yield", "DGS10", "level", "%"),
    "t2": ("2-year Treasury yield", "DGS2", "level", "%"),
}
EVENT_VALUES = {"cpi": ["cpi", "core_cpi"], "nfp": ["nfp", "unrate"], "pce": ["pce"], "gdp": ["gdp"], "retail": ["retail"], "claims": ["claims"],
                "ppi": ["ppi"], "jolts": ["jolts"], "starts": ["starts"], "newhome": ["newhome"], "durable": ["durable"]}
MONTH_CODE = "FGHJKMNQUVXZ"


def log(m):
    print(f"macro: {m}", flush=True)


def get(url, timeout=30):
    import requests
    r = requests.get(url, headers=UA, timeout=timeout)
    r.raise_for_status()
    return r


def ny_now():
    from zoneinfo import ZoneInfo
    return dt.datetime.now(ZoneInfo(NY))


def biz_days(y, m):
    n = calendar.monthrange(y, m)[1]
    return [dt.date(y, m, d) for d in range(1, n + 1) if dt.date(y, m, d).weekday() < 5 and dt.date(y, m, d).isoformat() not in HOLIDAYS]


# ---------------------------------------------------------------- calendar sources
def parse_ics(text: str):
    """(title, local NY datetime) for each event of an iCalendar file."""
    from zoneinfo import ZoneInfo
    text = re.sub(r"\r?\n[ \t]", "", text)
    out = []
    for block in text.split("BEGIN:VEVENT")[1:]:
        title = re.search(r"^SUMMARY[^:]*:(.*)$", block, re.M)
        start = re.search(r"^DTSTART([^:]*):(\d{8})(T(\d{6})(Z)?)?", block, re.M)
        if not title or not start:
            continue
        d = start.group(2)
        t = start.group(4) or "083000"
        when = dt.datetime.strptime(d + t, "%Y%m%d%H%M%S")
        if start.group(5) == "Z":
            when = when.replace(tzinfo=dt.timezone.utc).astimezone(ZoneInfo(NY))
        else:
            when = when.replace(tzinfo=ZoneInfo(NY))
        out.append((title.group(1).replace("\\,", ",").strip(), when))
    return out


def census_events():
    import pandas as pd
    from zoneinfo import ZoneInfo
    html = get("https://www.census.gov/economic-indicators/calendar-listview.html").text
    out = []
    for tb in pd.read_html(io.StringIO(html)):
        cols = [str(c).lower() for c in tb.columns]
        if not any("release" in c for c in cols):
            continue
        for _, r in tb.iterrows():
            vals = [str(v) for v in r.values]
            if len(vals) < 3:
                continue
            title, date_s, time_s = vals[0], vals[1], vals[2]
            period = vals[3] if len(vals) > 3 else ""
            try:
                d = dt.datetime.strptime(date_s.strip(), "%B %d, %Y")
                t = dt.datetime.strptime(time_s.strip(), "%I:%M %p")
            except ValueError:
                continue   # "Suspended" or a missing date
            out.append((title, d.replace(hour=t.hour, minute=t.minute, tzinfo=ZoneInfo(NY)), period))
    return out


def fomc_meetings(today: dt.date):
    """Decision days of the FOMC (the second day of each meeting), from the Fed's calendar page."""
    days, seps = set(FOMC_STATIC), set(SEP_STATIC)
    try:
        html = get("https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm").text
        for m in re.finditer(r"(\d{4}) FOMC Meetings(.*?)(?=\d{4} FOMC Meetings|\Z)", html, flags=re.S):
            year, body = int(m.group(1)), m.group(2)
            if year < today.year - 1:
                continue
            for mm in re.finditer(r'fomc-meeting__month[^>]*>\s*<strong>([A-Za-z/]+)</strong>.*?fomc-meeting__date[^>]*>\s*([\d\-–]+)(\*?)', body, flags=re.S):
                mon = mm.group(1).split("/")[-1]
                dd = re.split(r"[-–]", mm.group(2))[-1]
                try:
                    mo = dt.datetime.strptime(mon[:3], "%b").month
                    d = dt.date(year, mo, int(dd))
                except ValueError:
                    continue
                days.add(d.isoformat())
                if mm.group(3) == "*":
                    seps.add(d.isoformat())
    except Exception as e:
        log(f"FOMC calendar: {e}")
    return sorted(days), seps


def build_calendar(today: dt.date, demo=False):
    from zoneinfo import ZoneInfo
    tz = ZoneInfo(NY)
    events = []

    def add(key, name, imp, when, period="", src=""):
        events.append({"key": key, "name": name, "imp": imp, "date": when.date().isoformat(), "time": when.strftime("%H:%M"), "period": period, "src": src})

    def match(title):
        t = title.lower()
        for pat, key, name, imp in CATALOG:
            if re.search(pat, t):
                return key, name, imp
        return None

    if not demo:
        for src, url in (("BLS", "https://www.bls.gov/schedule/news_release/bls.ics"),
                         ("BEA", "https://www.bea.gov/news/schedule/ics/online-calendar-subscription.ics")):
            try:
                for title, when in parse_ics(get(url).text):
                    m = match(title)
                    if m and not (src == "BEA" and m[0] in ("trade",)):
                        period = (re.search(r"(January|February|March|April|May|June|July|August|September|October|November|December|[1-4]\w* Quarter)[^,]*\d{4}", title) or [""])[0]
                        add(m[0], m[1], m[2], when, period, src)
            except Exception as e:
                log(f"{src} calendar: {e}")
        try:
            for title, when, period in census_events():
                m = match(title)
                if m:
                    add(m[0], m[1], m[2], when, period, "Census")
        except Exception as e:
            log(f"Census calendar: {e}")
    else:
        base = today - dt.timedelta(days=today.weekday())
        for k, (key, name, imp, wd, hh) in enumerate([("cpi", "CPI inflation", 3, 1, "08:30"), ("ppi", "PPI inflation", 2, 2, "08:30"), ("retail", "Retail sales", 3, 3, "08:30"),
                                                       ("jolts", "JOLTS job openings", 2, 8, "10:00"), ("nfp", "Jobs report: payrolls and unemployment", 3, 11, "08:30"),
                                                       ("gdp", "GDP", 3, 10, "08:30"), ("pce", "PCE inflation, income and spending", 3, 11, "08:30")]):
            when = dt.datetime.combine(base + dt.timedelta(days=wd), dt.time(int(hh[:2]), int(hh[3:])), tz)
            add(key, name, imp, when, "", "demo")

    # fixed releases: jobless claims (Thursday 8:30, Wednesday when Thursday is a holiday), ISM (1st and 3rd business days, 10:00)
    start = today - dt.timedelta(days=21)
    for i in range(0, 90):
        d = start + dt.timedelta(days=i)
        if d.weekday() == 3:
            dd = d if d.isoformat() not in HOLIDAYS else d - dt.timedelta(days=1)
            add("claims", "Initial jobless claims", 2, dt.datetime.combine(dd, dt.time(8, 30), tz), "Weekly", "DOL")
    for y, m in {(start.year, start.month), (today.year, today.month), ((today.replace(day=28) + dt.timedelta(days=5)).year, (today.replace(day=28) + dt.timedelta(days=5)).month),
                 ((today.replace(day=28) + dt.timedelta(days=35)).year, (today.replace(day=28) + dt.timedelta(days=35)).month)}:
        b = biz_days(y, m)
        if len(b) >= 3:
            add("ism_m", "ISM manufacturing PMI", 3, dt.datetime.combine(b[0], dt.time(10, 0), tz), "", "ISM")
            add("ism_s", "ISM services PMI", 2, dt.datetime.combine(b[2], dt.time(10, 0), tz), "", "ISM")

    # the Fed
    meetings, seps = fomc_meetings(today)
    for d in meetings:
        dd = dt.date.fromisoformat(d)
        add("fomc", "FOMC rate decision" + (" and projections" if d in seps else ""), 3, dt.datetime.combine(dd, dt.time(14, 0), tz), "", "Fed")
        add("fomc_pc", "Fed chair press conference", 3, dt.datetime.combine(dd, dt.time(14, 30), tz), "", "Fed")
        mins = dd + dt.timedelta(days=21)
        add("minutes", "FOMC minutes", 2, dt.datetime.combine(mins, dt.time(14, 0), tz), f"Meeting of {dd.strftime('%B %-d')}", "Fed")

    # keep a window around today and drop duplicates (the same release listed twice)
    lo, hi = (today - dt.timedelta(days=today.weekday() + 7)).isoformat(), (today + dt.timedelta(days=35)).isoformat()
    seen, out = set(), []
    for e in sorted(events, key=lambda e: (e["date"], e["time"], -e["imp"])):
        k = (e["key"], e["date"])
        if k in seen or not (lo <= e["date"] <= hi):
            continue
        seen.add(k)
        out.append(e)
    return out, meetings, seps


# ---------------------------------------------------------------- values from FRED
def fred_series(sid: str):
    import pandas as pd
    df = pd.read_csv(io.StringIO(get(f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={sid}").text))
    df.columns = ["date", "value"]
    df["value"] = pd.to_numeric(df["value"], errors="coerce")
    return [(str(d)[:10], float(v)) for d, v in zip(df["date"], df["value"]) if v == v]


def transform(obs, how):
    if how == "level":
        return obs
    if how == "thousands":
        return [(d, v / 1000) for d, v in obs]
    if how == "millions":
        return [(d, v / 1000) for d, v in obs]
    if how == "diff":
        return [(obs[i][0], obs[i][1] - obs[i - 1][1]) for i in range(1, len(obs))]
    if how == "mom":
        return [(obs[i][0], (obs[i][1] / obs[i - 1][1] - 1) * 100) for i in range(1, len(obs)) if obs[i - 1][1]]
    if how == "yoy":
        m = {d: v for d, v in obs}
        out = []
        for d, v in obs:
            prev = m.get(f"{int(d[:4]) - 1}{d[4:]}")
            if prev:
                out.append((d, (v / prev - 1) * 100))
        return out
    return obs


def indicators(demo=False):
    out = {}
    for key, (name, sid, how, unit) in INDIC.items():
        try:
            if demo:
                import random
                rnd = random.Random(key)
                base = {"%": 3.0, "k": 200.0, "M": 7.5}.get(unit, 1.0)
                obs = [((dt.date(2024, 1, 1) + dt.timedelta(days=31 * i)).isoformat(), base * (1 + rnd.uniform(-0.15, 0.15))) for i in range(30)]
            else:
                obs = transform(fred_series(sid), how)
            if sid in ("DGS10", "DGS2", "ICSA"):
                obs = obs[-260:] if sid != "ICSA" else obs[-52:]
            last = obs[-25:] if sid not in ("DGS10", "DGS2") else obs[-130:]
            out[key] = {"name": name, "unit": unit, "series": sid, "last": round(obs[-1][1], 2), "lastDate": obs[-1][0],
                        "prior": round(obs[-2][1], 2) if len(obs) > 1 else None, "priorDate": obs[-2][0] if len(obs) > 1 else None,
                        "spark": [round(v, 2) for _, v in last]}
        except Exception as e:
            log(f"FRED {sid}: {e}")
    return out


# ---------------------------------------------------------------- Fed rate odds
def fed_odds(today: dt.date, meetings: list[str], demo=False):
    """Implied fed funds path and the odds of each target range after every upcoming meeting."""
    if demo:
        lower, upper, effr = 3.75, 4.00, 3.88
        prices = {}
        r = effr
        for k in range(14):
            y, m = today.year + (today.month - 1 + k) // 12, (today.month - 1 + k) % 12 + 1
            r -= 0.06 if k else 0
            prices[(y, m)] = 100 - r
    else:
        try:
            lower = fred_series("DFEDTARL")[-1][1]
            upper = fred_series("DFEDTARU")[-1][1]
            effr = fred_series("EFFR")[-1][1]
        except Exception as e:
            log(f"Fed target range: {e}")
            return None
        import yfinance as yf
        syms = {}
        for k in range(14):
            y, m = today.year + (today.month - 1 + k) // 12, (today.month - 1 + k) % 12 + 1
            syms[f"ZQ{MONTH_CODE[m - 1]}{str(y)[2:]}.CBT"] = (y, m)
        prices = {}
        try:
            df = yf.download(list(syms), period="10d", interval="1d", group_by="ticker", progress=False, auto_adjust=False, threads=True)
            for s, ym in syms.items():
                try:
                    c = df[s]["Close"].dropna()
                    if len(c):
                        prices[ym] = float(c.iloc[-1])
                except Exception:
                    pass
        except Exception as e:
            log(f"fed funds futures: {e}")
        if not prices:
            return None
    rate_m = {ym: 100 - p for ym, p in prices.items()}
    up = [dt.date.fromisoformat(d) for d in meetings if d >= today.isoformat()]
    meet_months = {(d.year, d.month) for d in up}
    path, pre = [], effr
    for d in up[:8]:
        ym = (d.year, d.month)
        nxt = (d.year + d.month // 12, d.month % 12 + 1)
        n = calendar.monthrange(*ym)[1]
        day = d.day   # the new rate applies from the day after the decision
        if nxt in rate_m and nxt not in meet_months:
            post = rate_m[nxt]
        elif ym in rate_m and n - day > 0:
            post = (rate_m[ym] - pre * day / n) / ((n - day) / n)
        else:
            break
        chg = post - pre
        steps = chg / 0.25
        # odds of the move at this meeting, spread over the two nearest 25 bp outcomes
        lo_s = math.floor(steps + 1e-9)
        p_hi = steps - lo_s
        move = {}
        for s, p in ((lo_s, 1 - p_hi), (lo_s + 1, p_hi)):
            if p > 0.005:
                move[int(s * 25)] = round(p * 100, 1)
        # odds of each target range after the meeting, against today's range
        tot = (post - effr) / 0.25
        lo_t = math.floor(tot + 1e-9)
        p_t = tot - lo_t
        ranges = []
        for s, p in ((lo_t, 1 - p_t), (lo_t + 1, p_t)):
            if p > 0.005:
                ranges.append({"lower": round(lower + s * 0.25, 2), "upper": round(upper + s * 0.25, 2), "prob": round(p * 100, 1)})
        path.append({"date": d.isoformat(), "implied": round(post, 3), "change": round(chg * 100, 1), "cum": round((post - effr) * 100, 1),
                     "move": move, "ranges": ranges})
        pre = post
    return {"lower": lower, "upper": upper, "effr": effr, "meetings": path, "contracts": {f"{y}-{m:02d}": round(p, 3) for (y, m), p in sorted(prices.items())}}


# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="site/data/macro.json")
    ap.add_argument("--cache", default="cache", help="folder kept between runs (history of the rate odds)")
    ap.add_argument("--demo", action="store_true")
    a = ap.parse_args()
    now = ny_now()
    today = now.date()
    cal, meetings, seps = build_calendar(today, a.demo)
    ind = indicators(a.demo)
    for e in cal:   # prior / actual for the releases we have values for
        vals = []
        for k in EVENT_VALUES.get(e["key"], []):
            v = ind.get(k)
            if v:
                vals.append({"name": v["name"], "unit": v["unit"], "last": v["last"], "lastDate": v["lastDate"], "prior": v["prior"]})
        if vals:
            e["values"] = vals
    odds = fed_odds(today, meetings, a.demo)
    # history of the odds for the next meeting (one point per day), to show how expectations moved
    hist = []
    hp = Path(a.cache) / "fed_odds_history.json"
    try:
        hist = json.loads(hp.read_text()) if hp.exists() else []
    except Exception:
        hist = []
    if odds and odds["meetings"]:
        nm = odds["meetings"][0]
        hist = [h for h in hist if h.get("day") != today.isoformat()] + [{"day": today.isoformat(), "meeting": nm["date"], "implied": nm["implied"], "cum": nm["cum"]}]
        hist = hist[-120:]
        try:
            hp.parent.mkdir(parents=True, exist_ok=True)
            hp.write_text(json.dumps(hist))
        except Exception:
            pass
        wk = next((h for h in reversed(hist) if h["day"] <= (today - dt.timedelta(days=7)).isoformat() and h["meeting"] == nm["date"]), None)
        if wk:
            nm["cumWeekAgo"] = wk["cum"]
    out = {"updated": now.strftime("%Y-%m-%dT%H:%M"), "today": today.isoformat(), "tz": "America/New_York", "demo": a.demo,
           "events": cal, "indicators": ind, "fed": odds, "fedHistory": hist, "fomc": meetings, "sep": sorted(seps)}
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    Path(a.out).write_text(json.dumps(out, separators=(",", ":")))
    log(f"{len(cal)} events, {len(ind)} indicators, {len(odds['meetings']) if odds else 0} FOMC meetings priced -> {a.out}")


if __name__ == "__main__":
    main()

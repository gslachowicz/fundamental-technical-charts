#!/usr/bin/env python3
"""
Ink Charts — intraday prices.

Runs every 15 minutes during US market hours (see .github/workflows/live.yml) and writes live.json:
today's open / high / low / last / volume for every stock on the site, plus the two market indexes.
The page merges these into the end-of-day data, so charts and the screener show (delayed) prices
during the session without rebuilding the whole site.
"""
from __future__ import annotations

import datetime as dt
import json
import math
import os
import sys
from pathlib import Path

import pandas as pd
import requests
import yfinance as yf

ROOT = Path(__file__).resolve().parents[1]
INDEXES = ["^GSPC", "^IXIC"]
# futures on the home page (S&P 500 chart + commodities board); keep in sync with FUTURES in build_data.py
FUTURES = ["ES=F", "GC=F", "SI=F", "HG=F", "PL=F", "CL=F", "BZ=F", "NG=F", "RB=F", "ZC=F", "ZW=F", "ZS=F", "KC=F", "LE=F"]


def read_watchlist() -> list[str]:
    p = ROOT / "watchlist.txt"
    out = []
    if p.exists():
        for line in p.read_text().splitlines():
            line = line.split("#", 1)[0].strip()
            out += [x.strip().upper().replace(".", "-") for x in line.replace(",", " ").split() if x.strip()]
    return out


def site_symbols() -> list[str]:
    """Every stock the site shows, from the published universe file."""
    repo = os.environ.get("GITHUB_REPOSITORY", "")
    if "/" not in repo:
        return []
    owner, name = repo.split("/", 1)
    url = f"https://{owner.lower()}.github.io/{name}/data/universe.json"
    try:
        r = requests.get(url, timeout=30)
        r.raise_for_status()
        return [row["symbol"] for row in r.json()]
    except Exception as e:  # noqa: BLE001
        print(f"universe list failed: {e}")
        return []


def num(x):
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    return None if (math.isnan(v) or math.isinf(v)) else v


def main():
    out_path = Path(sys.argv[1] if len(sys.argv) > 1 else "live.json")
    symbols = list(dict.fromkeys(INDEXES + FUTURES + read_watchlist() + site_symbols()))
    print(f"{len(symbols)} symbols")
    quotes: dict[str, list] = {}
    dates: dict[str, str] = {}
    chunk = 150
    for i in range(0, len(symbols), chunk):
        batch = symbols[i:i + chunk]
        try:
            df = yf.download(batch, period="5d", interval="1d", auto_adjust=False, group_by="ticker",
                             threads=True, progress=False)
        except Exception as e:  # noqa: BLE001
            print(f"batch {i // chunk + 1} failed: {e}")
            continue
        for s in batch:
            try:
                d = df[s] if len(batch) > 1 else df
                d = d.dropna(subset=["Close"])
                if d.empty:
                    continue
                r = d.iloc[-1]
                o, h, l, c, v = (num(r["Open"]), num(r["High"]), num(r["Low"]), num(r["Close"]), num(r["Volume"]))
                if c is None:
                    continue
                nd = 4 if c < 20 else 2   # natural gas, copper, gasoline need more decimals
                quotes[s] = [round(o or c, nd), round(h or c, nd), round(l or c, nd), round(c, nd), int(v or 0)]
                dates[s] = pd.Timestamp(d.index[-1]).strftime("%Y-%m-%d")
            except Exception:  # noqa: BLE001
                continue
    if not quotes:
        sys.exit("no quotes")
    # the session date comes from stocks and indexes; futures roll to the next day at 6 pm ET
    day = max((d for s, d in dates.items() if s not in FUTURES), default=max(dates.values()))
    quotes = {s: q for s, q in quotes.items() if dates[s] == day}
    now = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%MZ")
    out_path.write_text(json.dumps({"updated": now, "date": day, "q": quotes}, separators=(",", ":")))
    print(f"{len(quotes)} quotes for {day} at {now}")


if __name__ == "__main__":
    main()

"""Financial statements from SEC XBRL company facts: income statement, balance sheet, cash flow and ratios.

Annual figures come from 10-K (U.S. GAAP) or 20-F (IFRS) filings, usually back to 2009; quarterly figures from
10-Q filings, with cumulative year-to-date flows (cash flow statements) turned into single quarters and the fourth
quarter derived as the full year minus the first nine months. Used by build_data.py; the output is one small JSON
per company (data/f/SYM.json).
"""
from __future__ import annotations

import datetime as dt

# item key → (statement, U.S. GAAP tags, IFRS tags, unit kind, how to combine tags)
#   kind: "usd" money, "ps" per share, "sh" shares;  combine: "first" (first tag with data) or "max"
ITEMS = [
    # income statement
    ("revenue", "is", ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "SalesRevenueNet", "RevenueFromContractWithCustomerIncludingAssessedTax",
                       "SalesRevenueGoodsNet", "RevenuesNetOfInterestExpense", "SalesRevenueServicesNet"], ["Revenue", "RevenueFromContractsWithCustomers"], "usd", "max"),
    ("cogs", "is", ["CostOfRevenue", "CostOfGoodsAndServicesSold", "CostOfGoodsSold", "CostOfServices", "CostOfGoodsAndServiceExcludingDepreciationDepletionAndAmortization"], ["CostOfSales"], "usd", "first"),
    ("grossProfit", "is", ["GrossProfit"], ["GrossProfit"], "usd", "first"),
    ("rnd", "is", ["ResearchAndDevelopmentExpense", "ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost"], ["ResearchAndDevelopmentExpense"], "usd", "first"),
    ("sga", "is", ["SellingGeneralAndAdministrativeExpense"], ["SellingGeneralAndAdministrativeExpense"], "usd", "first"),
    ("opex", "is", ["OperatingExpenses", "CostsAndExpenses"], [], "usd", "first"),
    ("operatingIncome", "is", ["OperatingIncomeLoss"], ["ProfitLossFromOperatingActivities"], "usd", "first"),
    ("interestExpense", "is", ["InterestExpense", "InterestExpenseNonoperating", "InterestExpenseDebt", "InterestAndDebtExpense"], ["FinanceCosts", "InterestExpense"], "usd", "first"),
    ("pretaxIncome", "is", ["IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
                            "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments",
                            "IncomeLossFromContinuingOperationsBeforeIncomeTaxesDomestic"], ["ProfitLossBeforeTax"], "usd", "first"),
    ("incomeTax", "is", ["IncomeTaxExpenseBenefit"], ["IncomeTaxExpenseContinuingOperations"], "usd", "first"),
    ("netIncome", "is", ["NetIncomeLoss", "NetIncomeLossAvailableToCommonStockholdersBasic", "ProfitLoss"], ["ProfitLossAttributableToOwnersOfParent", "ProfitLoss"], "usd", "first"),
    ("epsBasic", "is", ["EarningsPerShareBasic", "EarningsPerShareBasicAndDiluted"], ["BasicEarningsLossPerShare"], "ps", "first"),
    ("epsDiluted", "is", ["EarningsPerShareDiluted", "EarningsPerShareBasicAndDiluted"], ["DilutedEarningsLossPerShare"], "ps", "first"),
    ("sharesDiluted", "is", ["WeightedAverageNumberOfDilutedSharesOutstanding", "WeightedAverageNumberOfShareOutstandingBasicAndDiluted"],
     ["WeightedAverageShares", "AdjustedWeightedAverageShares"], "sh", "first"),
    ("dna", "cf", ["DepreciationDepletionAndAmortization", "DepreciationAmortizationAndAccretionNet", "DepreciationAndAmortization", "Depreciation"],
     ["DepreciationAndAmortisationExpense", "DepreciationAmortisationAndImpairmentLossReversalOfImpairmentLossRecognisedInProfitOrLoss"], "usd", "first"),
    # balance sheet (amounts on the last day of the period)
    ("cash", "bs", ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents", "Cash"], ["CashAndCashEquivalents"], "usd", "first"),
    ("shortInvestments", "bs", ["ShortTermInvestments", "MarketableSecuritiesCurrent", "AvailableForSaleSecuritiesDebtSecuritiesCurrent", "AvailableForSaleSecuritiesCurrent"],
     ["CurrentInvestments", "OtherCurrentFinancialAssets"], "usd", "first"),
    ("receivables", "bs", ["AccountsReceivableNetCurrent", "ReceivablesNetCurrent"], ["TradeAndOtherCurrentReceivables", "CurrentTradeReceivables"], "usd", "first"),
    ("inventory", "bs", ["InventoryNet"], ["Inventories"], "usd", "first"),
    ("currentAssets", "bs", ["AssetsCurrent"], ["CurrentAssets"], "usd", "first"),
    ("ppe", "bs", ["PropertyPlantAndEquipmentNet", "PropertyPlantAndEquipmentAndFinanceLeaseRightOfUseAssetAfterAccumulatedDepreciationAndAmortization"],
     ["PropertyPlantAndEquipment"], "usd", "first"),
    ("goodwill", "bs", ["Goodwill"], ["Goodwill"], "usd", "first"),
    ("intangibles", "bs", ["IntangibleAssetsNetExcludingGoodwill", "FiniteLivedIntangibleAssetsNet"], ["IntangibleAssetsOtherThanGoodwill"], "usd", "first"),
    ("totalAssets", "bs", ["Assets"], ["Assets"], "usd", "first"),
    ("payables", "bs", ["AccountsPayableCurrent", "AccountsPayableAndAccruedLiabilitiesCurrent"], ["TradeAndOtherCurrentPayables"], "usd", "first"),
    ("currentLiabilities", "bs", ["LiabilitiesCurrent"], ["CurrentLiabilities"], "usd", "first"),
    ("debtCurrentTotal", "bs", ["DebtCurrent", "LongTermDebtAndCapitalLeaseObligationsCurrent"], ["CurrentBorrowings", "ShorttermBorrowings"], "usd", "first"),
    ("ltdCurrent", "bs", ["LongTermDebtCurrent"], ["CurrentPortionOfLongtermBorrowings"], "usd", "first"),
    ("stBorrowings", "bs", ["ShortTermBorrowings"], [], "usd", "first"),
    ("commercialPaper", "bs", ["CommercialPaper"], [], "usd", "first"),
    ("longDebt", "bs", ["LongTermDebtNoncurrent", "LongTermDebtAndCapitalLeaseObligations", "LongTermNotesPayable"], ["NoncurrentBorrowings", "LongtermBorrowings"], "usd", "first"),
    ("totalLiabilities", "bs", ["Liabilities"], ["Liabilities"], "usd", "first"),
    ("equity", "bs", ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"], ["EquityAttributableToOwnersOfParent", "Equity"], "usd", "first"),
    ("retainedEarnings", "bs", ["RetainedEarningsAccumulatedDeficit"], ["RetainedEarnings"], "usd", "first"),
    ("sharesOut", "bs", ["CommonStockSharesOutstanding"], [], "sh", "first"),
    # cash flow
    ("cfo", "cf", ["NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"], ["CashFlowsFromUsedInOperatingActivities"], "usd", "first"),
    ("capex", "cf", ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets", "PaymentsForCapitalImprovements"],
     ["PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities", "PurchaseOfPropertyPlantAndEquipment"], "usd", "first"),
    ("cfi", "cf", ["NetCashProvidedByUsedInInvestingActivities", "NetCashProvidedByUsedInInvestingActivitiesContinuingOperations"], ["CashFlowsFromUsedInInvestingActivities"], "usd", "first"),
    ("cff", "cf", ["NetCashProvidedByUsedInFinancingActivities", "NetCashProvidedByUsedInFinancingActivitiesContinuingOperations"], ["CashFlowsFromUsedInFinancingActivities"], "usd", "first"),
    ("sbc", "cf", ["ShareBasedCompensation", "AllocatedShareBasedCompensationExpense"], ["AdjustmentsForSharebasedPayments"], "usd", "first"),
    ("buybacks", "cf", ["PaymentsForRepurchaseOfCommonStock"], ["PaymentsToAcquireOrRedeemEntitysShares"], "usd", "first"),
    ("dividends", "cf", ["PaymentsOfDividends", "PaymentsOfDividendsCommonStock"], ["DividendsPaidClassifiedAsFinancingActivities", "DividendsPaid"], "usd", "first"),
    ("acquisitions", "cf", ["PaymentsToAcquireBusinessesNetOfCashAcquired"], ["CashFlowsUsedInObtainingControlOfSubsidiariesOrOtherBusinessesClassifiedAsInvestingActivities"], "usd", "first"),
]
ANNUAL_FORMS = ("10-K", "20-F", "40-F")
QUARTER_FORMS = ("10-Q", "10-K")


def _d(s: str) -> dt.date:
    return dt.date.fromisoformat(s)


def _num(v):
    try:
        v = float(v)
        return v if v == v else None
    except (TypeError, ValueError):
        return None


def _unit_rows(fact: dict, kind: str, ccy: str | None):
    units = fact.get("units") or {}
    if kind == "usd":
        if ccy:
            return (units[ccy], ccy) if ccy in units else ([], None)   # never mix currencies
        if "USD" in units:
            return units["USD"], "USD"
        money = [(k, v) for k, v in units.items() if len(k) == 3 and k.isupper()]
        if money:
            k, v = max(money, key=lambda kv: len(kv[1]))
            return v, k
        return [], None
    if kind == "ps":
        for k, v in units.items():
            if "/shares" in k and (ccy is None or k.startswith(ccy)):
                return v, k.split("/")[0]
        return [], None
    return units.get("shares") or [], None


def _collect(facts: dict, tags: list[str], kind: str, ccy: str | None, forms: tuple, combine: str):
    """{(start or None, end): value}: the latest filing wins inside a tag, then first tag (or the largest value) across tags."""
    out: dict = {}
    for tag in tags:
        fact = facts.get(tag)
        if not fact:
            continue
        rows, _ = _unit_rows(fact, kind, ccy)
        best: dict = {}
        for x in rows:
            if not str(x.get("form", "")).startswith(forms):
                continue
            e, v = x.get("end"), _num(x.get("val"))
            if not e or v is None:
                continue
            k = (x.get("start"), e)
            f = str(x.get("filed", ""))
            if k not in best or f >= best[k][1]:
                best[k] = (v, f)
        for k, (v, _) in best.items():
            if k not in out or (combine == "max" and v > out[k]):
                out[k] = v
        if combine == "first" and out:
            # keep filling only periods the first tag didn't cover
            continue
    return out


def _dur(k) -> int:
    return (_d(k[1]) - _d(k[0])).days if k[0] else 0


def _near(ends: list[dt.date], e: dt.date, tol=12):
    best = None
    for x in ends:
        dd = abs((x - e).days)
        if dd <= tol and (best is None or dd < abs((best - e).days)):
            best = x
    return best


def statements(company_facts: dict, years: int = 15, quarters: int = 20) -> dict | None:
    facts_all = company_facts.get("facts") or {}
    gaap, ifrs = facts_all.get("us-gaap") or {}, facts_all.get("ifrs-full") or {}
    use_ifrs = len(ifrs) > len(gaap)
    facts = ifrs if use_ifrs else gaap
    if not facts:
        return None
    # reporting currency: the money unit of revenue / net income / assets
    # (some foreign filers add a convenience translation in USD for the latest year: the unit with the most facts wins)
    count: dict = {}
    for t in (["Revenue", "ProfitLoss", "Assets", "Equity", "CashAndCashEquivalents"] if use_ifrs else ["Revenues", "NetIncomeLoss", "Assets", "RevenueFromContractWithCustomerExcludingAssessedTax"]):
        for u, rows in ((facts.get(t) or {}).get("units") or {}).items():
            if len(u) == 3 and u.isupper():
                count[u] = count.get(u, 0) + len(rows)
    ccy = max(count, key=count.get) if count else None
    annual: dict = {}
    qtr: dict = {}
    raw = {}
    for key, st, gt, it, kind, comb in ITEMS:
        tags = it if use_ifrs else gt
        if not tags:
            continue
        raw[key] = (st, _collect(facts, tags, kind, ccy, ANNUAL_FORMS + QUARTER_FORMS, comb), kind)

    # fiscal year ends: full-year periods of revenue, net income or operating cash flow in annual reports
    fy_ends = set()
    for key in ("revenue", "netIncome", "cfo"):
        if key in raw:
            for k in raw[key][1]:
                if k[0] and 350 <= _dur(k) <= 380:
                    fy_ends.add(_d(k[1]))
    fy_ends = sorted(fy_ends)
    # merge ends within a few days (52/53-week fiscal years)
    merged = []
    for e in fy_ends:
        if not merged or (e - merged[-1]).days > 20:
            merged.append(e)
        else:
            merged[-1] = e
    fy_ends = merged[-years:]

    for key, (st, data, kind) in raw.items():
        for k, v in data.items():
            e = _d(k[1])
            if st == "bs" or (k[0] is None):
                if k[0] is not None:
                    continue
                a = _near(fy_ends, e, 6)
                if a:
                    annual.setdefault(a, {})[key] = v
            elif 350 <= _dur(k) <= 380:
                a = _near(fy_ends, e)
                if a:
                    annual.setdefault(a, {})[key] = v

    # quarters: direct three-month figures, otherwise differences of year-to-date figures; Q4 = year minus nine months
    if not use_ifrs:
        q_ends = set()
        for key in ("revenue", "netIncome", "cfo", "totalAssets"):
            if key in raw:
                for k in raw[key][1]:
                    if raw[key][0] == "bs":
                        if k[0] is None:
                            q_ends.add(_d(k[1]))
                    elif k[0] and (80 <= _dur(k) <= 100 or 170 <= _dur(k) <= 190 or 260 <= _dur(k) <= 290 or 350 <= _dur(k) <= 380):
                        q_ends.add(_d(k[1]))
        q_ends = sorted(q_ends)
        mq = []
        for e in q_ends:
            if not mq or (e - mq[-1]).days > 20:
                mq.append(e)
            else:
                mq[-1] = e
        q_ends = mq[-(quarters + 4):]
        for key, (st, data, kind) in raw.items():
            if st == "bs":
                for k, v in data.items():
                    if k[0] is None:
                        a = _near(q_ends, _d(k[1]), 6)
                        if a:
                            qtr.setdefault(a, {})[key] = v
                continue
            direct = {}
            cum: dict = {}
            for k, v in data.items():
                if not k[0]:
                    continue
                n = _dur(k)
                if 80 <= n <= 100:
                    direct[_d(k[1])] = v
                for lo, hi, m in ((80, 100, 3), (170, 190, 6), (260, 290, 9), (350, 380, 12)):
                    if lo <= n <= hi:
                        cum.setdefault(k[0], {})[m] = (_d(k[1]), v)
            vals = {}
            for e, v in direct.items():
                a = _near(q_ends, e)
                if a:
                    vals[a] = v
            if kind != "sh":
                for s, ms in cum.items():
                    for m, prev in ((6, 3), (9, 6), (12, 9)):
                        if m in ms and prev in ms:
                            e, v = ms[m]
                            a = _near(q_ends, e)
                            if a and a not in vals:
                                vals[a] = v - ms[prev][1]
            else:
                for s, ms in cum.items():
                    if 12 in ms:
                        a = _near(q_ends, ms[12][0])
                        if a and a not in vals:
                            vals[a] = ms[12][1]   # shares: the yearly average stands in for Q4
            if kind != "sh":   # Q4 from the full year minus three reported quarters
                for k, v in data.items():
                    if k[0] and 350 <= _dur(k) <= 380:
                        a = _near(q_ends, _d(k[1]))
                        if a and a not in vals:
                            s0 = _d(k[0])
                            inside = [x for x in vals if s0 < x < a]
                            if len(inside) == 3:
                                vals[a] = v - sum(vals[x] for x in inside)
            for a, v in vals.items():
                qtr.setdefault(a, {})[key] = v
        # keep quarters that have flows (not only a balance sheet)
        qtr = {e: d for e, d in qtr.items() if any(k in d for k in ("revenue", "netIncome", "cfo"))}
        qtr = dict(sorted(qtr.items())[-quarters:])

    def finish(per: dict, quarterly: bool) -> dict:
        ends = sorted(per)
        out = {"end": [e.isoformat() for e in ends]}
        rows: dict = {}
        for e in ends:
            d = per[e]
            if "grossProfit" not in d and "revenue" in d and "cogs" in d:
                d["grossProfit"] = d["revenue"] - d["cogs"]
            if "operatingIncome" in d and "dna" in d:
                d["ebitda"] = d["operatingIncome"] + d["dna"]
            dc = d.get("debtCurrentTotal")
            if dc is None:
                parts = [d.get(k) for k in ("ltdCurrent", "stBorrowings", "commercialPaper") if d.get(k) is not None]
                dc = sum(parts) if parts else None
            if dc is not None:
                d["shortDebt"] = dc
            if dc is not None or d.get("longDebt") is not None:
                d["totalDebt"] = (dc or 0) + (d.get("longDebt") or 0)
            if d.get("cash") is not None:
                d["cashAndInvestments"] = d["cash"] + (d.get("shortInvestments") or 0)
                if "totalDebt" in d:
                    d["netCash"] = d["cashAndInvestments"] - d["totalDebt"]
            if d.get("currentAssets") is not None and d.get("currentLiabilities") is not None:
                d["workingCapital"] = d["currentAssets"] - d["currentLiabilities"]
            if d.get("cfo") is not None and d.get("capex") is not None:
                d["fcf"] = d["cfo"] - abs(d["capex"])
            if d.get("capex") is not None:
                d["capex"] = -abs(d["capex"])
            for k in ("buybacks", "dividends", "acquisitions"):
                if d.get(k) is not None:
                    d[k] = -abs(d[k])
        keys = [k for k, *_ in ITEMS if k not in ("debtCurrentTotal", "ltdCurrent", "stBorrowings", "commercialPaper")] + \
               ["ebitda", "shortDebt", "totalDebt", "cashAndInvestments", "netCash", "workingCapital", "fcf"]
        for k in keys:
            vals = [per[e].get(k) for e in ends]
            if any(v is not None for v in vals):
                rows[k] = [None if v is None else (round(v, 4) if abs(v) < 1000 else round(v)) for v in vals]
        # ratios (%) and growth
        def r(a, b, i):
            x, y = rows.get(a, [None] * len(ends))[i], rows.get(b, [None] * len(ends))[i]
            return None if x is None or not y else round(x / y * 100, 2)
        lag = 4 if quarterly else 1
        R = {k: [] for k in ("grossMargin", "opMargin", "netMargin", "fcfMargin", "ebitdaMargin", "revGrowth", "epsGrowth", "roe", "roa", "debtToEquity", "currentRatio", "taxRate", "sbcPct", "rndPct")}
        for i in range(len(ends)):
            R["grossMargin"].append(r("grossProfit", "revenue", i)); R["opMargin"].append(r("operatingIncome", "revenue", i))
            R["netMargin"].append(r("netIncome", "revenue", i)); R["fcfMargin"].append(r("fcf", "revenue", i)); R["ebitdaMargin"].append(r("ebitda", "revenue", i))
            R["taxRate"].append(r("incomeTax", "pretaxIncome", i)); R["sbcPct"].append(r("sbc", "revenue", i)); R["rndPct"].append(r("rnd", "revenue", i))
            R["debtToEquity"].append(r("totalDebt", "equity", i))
            ca, cl = rows.get("currentAssets", [None] * len(ends))[i], rows.get("currentLiabilities", [None] * len(ends))[i]
            R["currentRatio"].append(None if ca is None or not cl else round(ca / cl, 2))
            for g, src in (("revGrowth", "revenue"), ("epsGrowth", "epsDiluted")):
                cur = rows.get(src, [None] * len(ends))[i]
                prv = rows.get(src, [None] * len(ends))[i - lag] if i >= lag else None
                R[g].append(None if cur is None or prv is None or prv <= 0 else round((cur / prv - 1) * 100, 1))
            ni = rows.get("netIncome", [None] * len(ends))
            if quarterly:
                ttm = sum(ni[i - 3:i + 1]) if i >= 3 and all(v is not None for v in ni[i - 3:i + 1]) else None
            else:
                ttm = ni[i]
            for g, src in (("roe", "equity"), ("roa", "totalAssets")):
                cur = rows.get(src, [None] * len(ends))[i]
                prv = rows.get(src, [None] * len(ends))[i - lag] if i >= lag else None
                base = (cur + prv) / 2 if cur is not None and prv is not None else cur
                R[g].append(None if ttm is None or not base or base <= 0 else round(ttm / base * 100, 2))
        for k, v in R.items():
            if any(x is not None for x in v):
                rows[k] = v
        out["rows"] = rows
        return out

    res = {"ccy": ccy or "USD", "src": "ifrs" if use_ifrs else "gaap", "annual": finish(annual, False)}
    if qtr:
        res["quarterly"] = finish(qtr, True)
    if not res["annual"]["end"] and "quarterly" not in res:
        return None
    return res

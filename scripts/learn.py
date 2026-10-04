"""The Ticker&Tape trading school: static lesson pages in English, Spanish and Portuguese.

Content lives in scripts/learn/{en,es,pt}_*.json (one list of lessons per file, in curriculum order); diagrams are drawn
by scripts/learn_diagrams.py. Called from build_data.build_pages every night, so the "On Ticker&Tape today" examples come
from that day's data (data/universe.json, data/spark.json, data/groups.json). Run on its own to preview:
    python scripts/learn.py site
"""
from __future__ import annotations

import json
import re
import sys
from html import escape as E
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import learn_diagrams as DG  # noqa: E402

SITE = "https://tickerandtape.com"
HERE = Path(__file__).parent / "learn"
LANGS = ("en", "es", "pt")
PREFIX = {"en": "/learn/", "es": "/es/learn/", "pt": "/pt/learn/"}
HTML_LANG = {"en": "en", "es": "es", "pt": "pt-BR"}

MODULES = [
    (("First steps", "Primeros pasos", "Primeiros passos"), ["stocks-etfs-indexes", "how-the-market-works", "order-types"]),
    (("Reading a chart", "Cómo leer un gráfico", "Como ler um gráfico"), ["candlesticks-and-bars", "daily-and-weekly-charts", "log-vs-linear-scale", "reading-a-ticker-and-tape-chart"]),
    (("Trend", "Tendencia", "Tendência"), ["what-is-a-trend", "the-four-stages", "trendlines"]),
    (("Support and resistance", "Soportes y resistencias", "Suportes e resistências"), ["support-and-resistance", "role-reversal", "gaps"]),
    (("Volume", "Volumen", "Volume"), ["reading-volume", "volume-on-breakouts", "accumulation-and-distribution"]),
    (("Moving averages", "Medias móviles", "Médias móveis"), ["moving-averages-basics", "the-50-day-line", "the-200-day-line"]),
    (("Technical indicators", "Indicadores técnicos", "Indicadores técnicos"), ["rsi", "macd", "bollinger-and-keltner", "anchored-vwap", "atr-and-adr"]),
    (("Relative strength", "Fuerza relativa", "Força relativa"), ["rs-line", "rs-rating", "leaders-and-laggards"]),
    (("Bases and buy points", "Bases y puntos de compra", "Bases e pontos de compra"), ["what-is-a-base", "pivot-and-buy-zone", "cup-with-handle", "cup-without-handle", "flat-base",
                                                                                          "double-bottom", "ascending-base", "high-tight-flag", "base-on-base", "ipo-base", "base-count", "failed-breakouts"]),
    (("Fundamentals", "Fundamentals", "Fundamentos"), ["earnings-growth", "sales-and-margins", "reading-an-earnings-report", "institutional-ownership"]),
    (("The general market", "El mercado general", "O mercado geral"), ["market-direction", "distribution-days", "follow-through-day", "market-breadth"]),
    (("Macro", "Macro", "Macro"), ["what-moves-the-market", "the-fed-and-rates", "economic-calendar"]),
    (("Risk management", "Gestión del riesgo", "Gestão de risco"), ["position-sizing", "stop-losses", "taking-profits", "exposure", "trading-journal"]),
    (("Your routine", "Tu rutina", "Sua rotina"), ["daily-routine", "weekly-routine"]),
]

UI = {
    "school": ("Trading school", "Escuela de trading", "Escola de trading"),
    "school_title": ("Trading school: learn to read charts and trade growth stocks", "Escuela de trading: aprende a leer gráficos y operar acciones de crecimiento", "Escola de trading: aprenda a ler gráficos e operar ações de crescimento"),
    "school_desc": ("A free course from zero: charts, trends, support and resistance, volume, indicators, bases and buy points, fundamentals, the market, macro and risk management.",
                    "Un curso gratis desde cero: gráficos, tendencias, soportes y resistencias, volumen, indicadores, bases y puntos de compra, fundamentals, mercado, macro y gestión del riesgo.",
                    "Um curso grátis do zero: gráficos, tendências, suportes e resistências, volume, indicadores, bases e pontos de compra, fundamentos, mercado, macro e gestão de risco."),
    "school_lede": ("Everything you need to read a chart and trade growth stocks with a plan, from your first candlestick to a full daily routine. Short lessons, clear diagrams and live examples from today's market.",
                    "Todo lo que necesitas para leer un gráfico y operar acciones de crecimiento con un plan, desde tu primera vela hasta una rutina diaria completa. Lecciones cortas, diagramas claros y ejemplos en vivo del mercado de hoy.",
                    "Tudo o que você precisa para ler um gráfico e operar ações de crescimento com um plano, da primeira vela a uma rotina diária completa. Lições curtas, diagramas claros e exemplos ao vivo do mercado de hoje."),
    "kicker": ("Free course · 14 modules", "Curso gratis · 14 módulos", "Curso grátis · 14 módulos"),
    "start": ("Start with lesson 1", "Empieza con la lección 1", "Comece pela lição 1"),
    "jump": ("Already trading? Jump to bases and buy points", "¿Ya operas? Ve directo a bases y puntos de compra", "Já opera? Vá direto para bases e pontos de compra"),
    "module": ("Module", "Módulo", "Módulo"), "lesson": ("Lesson", "Lección", "Lição"), "of": ("of", "de", "de"),
    "min": ("min read", "min de lectura", "min de leitura"), "lessons": ("lessons", "lecciones", "lições"),
    "takeaways": ("Key points", "Puntos clave", "Pontos-chave"), "mistakes": ("Common mistakes", "Errores comunes", "Erros comuns"),
    "live": ("On Ticker&Tape today", "En Ticker&Tape hoy", "No Ticker&Tape hoje"),
    "live_note": ("Live examples from the latest close, updated every trading day. Examples, not recommendations.",
                  "Ejemplos en vivo del último cierre, actualizados cada día hábil. Son ejemplos, no recomendaciones.",
                  "Exemplos ao vivo do último fechamento, atualizados a cada pregão. São exemplos, não recomendações."),
    "try": ("Try it on Ticker&Tape", "Pruébalo en Ticker&Tape", "Experimente no Ticker&Tape"),
    "related": ("Keep learning", "Sigue aprendiendo", "Continue aprendendo"),
    "prev": ("Previous", "Anterior", "Anterior"), "next": ("Next lesson", "Siguiente lección", "Próxima lição"),
    "back": ("All lessons", "Todas las lecciones", "Todas as lições"), "charts": ("← Charts", "← Gráficos", "← Gráficos"),
    "methodology": ("Methodology", "Metodología", "Metodologia"), "glossary": ("Glossary", "Glosario", "Glossário"),
    "disclaimer": ("Ticker&Tape is a charting and research tool. This course is education, not investment advice: trading involves risk and you can lose money.",
                   "Ticker&Tape es una herramienta de gráficos y research. Este curso es educativo, no asesoramiento de inversión: operar implica riesgo y puedes perder dinero.",
                   "O Ticker&Tape é uma ferramenta de gráficos e pesquisa. Este curso é educativo, não recomendação de investimento: operar envolve risco e você pode perder dinheiro."),
    "rs": ("RS", "RS", "RS"), "pivot": ("from pivot", "del pivot", "do pivô"), "rank": ("Rank", "Puesto", "Posição"),
    "stocks": ("stocks", "acciones", "ações"), "above50": ("above the 50-day", "sobre la media de 50", "acima da média de 50"),
    "open_chart": ("Open the chart", "Abrir el gráfico", "Abrir o gráfico"),
}
STATUS = {"Breakout": ("Breakout", "Ruptura", "Rompimento"), "In buy zone": ("In buy zone", "En zona de compra", "Na zona de compra"),
          "Near pivot": ("Near pivot", "Cerca del pivot", "Perto do pivô"), "Below pivot": ("Below pivot", "Bajo el pivot", "Abaixo do pivô"),
          "Extended": ("Extended", "Extendida", "Esticada"), "Failed breakout": ("Failed breakout", "Ruptura fallida", "Rompimento falho"),
          "Correcting": ("Correcting", "Corrigiendo", "Corrigindo")}
BASES = {"Cup with handle": ("Cup with handle", "Taza con asa", "Xícara com alça"), "Cup": ("Cup", "Taza", "Xícara"), "Flat base": ("Flat base", "Base plana", "Base plana"),
         "Base forming": ("Base forming", "Base en formación", "Base em formação"), "Deep correction": ("Deep correction", "Corrección profunda", "Correção profunda")}


def u(key: str, lang: str) -> str:
    return UI[key][LANGS.index(lang)]


def lurl(slug: str, lang: str) -> str:
    return PREFIX[lang] + (slug + "/" if slug else "")


def load() -> dict[str, list[dict]]:
    out = {}
    for lang in LANGS:
        L = []
        for f in sorted(HERE.glob(f"{lang}_*.json")):
            L += json.loads(f.read_text())
        out[lang] = L
    return out


def inline(s: str, lang: str) -> str:
    s = E(s, quote=False)
    s = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", s)
    s = re.sub(r"\[([^\]]+)\]\(lesson:([a-z0-9-]+)\)", lambda m: f'<a href="{lurl(m.group(2), lang)}">{m.group(1)}</a>', s)
    s = re.sub(r"\[([^\]]+)\]\((/[^)\s]*)\)", lambda m: f'<a href="{m.group(2)}">{m.group(1)}</a>', s)
    return s


def plain(s: str) -> str:
    s = re.sub(r"\*\*(.+?)\*\*", r"\1", s)
    return re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", s)


def snip(t: str, n: int = 140) -> str:
    if len(t) <= n:
        return t
    return t[:n].rsplit(" ", 1)[0].rstrip(",.;:") + "…"


def words(lesson: dict) -> int:
    t = [lesson.get("intro", "")]
    for sec in lesson.get("sections", []):
        t += sec.get("p", []) + sec.get("list", [])
    return len(" ".join(t).split())


# ---------------------------------------------------------------- live examples
def _num(v):
    try:
        return float(str(v).replace("%", "").replace("+", ""))
    except (TypeError, ValueError):
        return None


def live_rows(kind: str, uni: list[dict], groups: list[dict]):
    rows = [r for r in uni if r.get("symbol") and not r.get("etf")]
    b = lambda r: r.get("base") or {}
    rs = lambda r: r.get("rsRating") or 0
    if kind.startswith("base:"):
        k = kind[5:]
        sel = [r for r in rows if b(r).get("type") == k and b(r).get("status") not in ("Failed breakout",)]
        return sorted(sel, key=lambda r: -rs(r))[:6]
    if kind.startswith("status:"):
        k = kind[7:]
        ok = ("Breakout", "In buy zone") if k == "Breakout" else (k,)
        return sorted([r for r in rows if b(r).get("status") in ok], key=lambda r: -rs(r))[:6]
    if kind == "rs-new-high":
        return sorted([r for r in rows if r.get("rsLineNewHigh")], key=lambda r: -rs(r))[:6]
    if kind == "rs-leaders":
        return sorted([r for r in rows if rs(r) >= 90], key=lambda r: (-(r.get("comp") or 0), -rs(r)))[:6]
    if kind == "volume-up":
        return sorted([r for r in rows if (r.get("chgPct") or 0) > 0 and (r.get("volVsAvgPct") or 0) >= 40], key=lambda r: -(r.get("volVsAvgPct") or 0))[:6]
    if kind == "volume-down":
        return sorted([r for r in rows if (r.get("chgPct") or 0) < 0 and (r.get("volVsAvgPct") or 0) >= 40], key=lambda r: -(r.get("volVsAvgPct") or 0))[:6]
    if kind == "near-50":
        return sorted([r for r in rows if 0 <= (r.get("vs50Pct") if r.get("vs50Pct") is not None else -9) <= 3 and (r.get("vs200Pct") or 0) > 0 and rs(r) >= 70], key=lambda r: -rs(r))[:6]
    if kind == "below-50":
        return sorted([r for r in rows if (r.get("vs50Pct") or 0) < 0 and (r.get("chgPct") or 0) < 0 and (r.get("volVsAvgPct") or 0) > 20 and (r.get("vs50Pct") or 0) > -4],
                      key=lambda r: -(r.get("volVsAvgPct") or 0))[:6]
    if kind == "eps-leaders":
        sel = [r for r in rows if (_num(r.get("epsChg")) or 0) >= 25 and (_num(r.get("salesChg")) or 0) >= 20]
        return sorted(sel, key=lambda r: -(r.get("comp") or 0))[:6]
    if kind == "ud-leaders":
        return sorted([r for r in rows if (r.get("udRatio") or 0) >= 1.5], key=lambda r: -(r.get("udRatio") or 0))[:6]
    if kind == "top-groups":
        return sorted(groups, key=lambda g: g.get("rank") or 999)[:6]
    return []


def spark_svg(vals) -> str:
    if not vals or len(vals) < 2:
        return ""
    v = vals[-130:]
    lo, hi = min(v), max(v)
    r = (hi - lo) or 1
    pts = " ".join(f"{i * 120 / (len(v) - 1):.1f},{34 - (x - lo) / r * 30:.1f}" for i, x in enumerate(v))
    col = "#1d3fc4" if v[-1] >= v[0] else "#e0337f"
    return f'<svg viewBox="0 0 120 36" preserveAspectRatio="none" aria-hidden="true"><polyline points="{pts}" fill="none" stroke="{col}" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg>'


def live_block(kind: str, lang: str, uni, groups, sparks, day: str) -> str:
    if not kind:
        return ""
    rows = live_rows(kind, uni, groups)
    if not rows:
        return ""
    li = LANGS.index(lang)
    cards = []
    if kind == "top-groups":
        for g in rows:
            names = ", ".join(x[0] for x in (g.get("leaders") or [])[:3])
            cards.append(f'<a class="lcard" href="/groups/"><b>#{g.get("rank")} {E(g.get("name", ""))}</b><small>{E(g.get("sector", ""))}</small>'
                         f'<span>{g.get("n", "")} {u("stocks", lang)} · {g.get("above50", "—")}% {u("above50", lang)}</span><span class="lmono">{E(names)}</span></a>')
    else:
        for r in rows:
            b = r.get("base") or {}
            st = STATUS.get(b.get("status"), (b.get("status") or "",) * 3)[li]
            bt = BASES.get(b.get("type"), (b.get("type") or "",) * 3)[li]
            dist = b.get("distPct")
            meta = " · ".join(x for x in (bt, st, (f"{dist:+.1f}% {u('pivot', lang)}" if isinstance(dist, (int, float)) else "")) if x)
            cards.append(f'<a class="lcard" href="/chart/{E(r["symbol"])}/"><b>{E(r["symbol"])} <em>RS {r.get("rsRating") or "—"}</em></b><small>{E((r.get("name") or "")[:34])}</small>'
                         f'{spark_svg(sparks.get(r["symbol"]))}<span>{E(meta)}</span></a>')
    return (f'<section class="llive"><h2>{u("live", lang)}</h2><div class="lcards">{"".join(cards)}</div>'
            f'<p class="lfine">{u("live_note", lang)} {E(day)}</p></section>')


# ---------------------------------------------------------------- pages
def head(lang, title, desc, path, alts, css_v, extra=""):
    url = SITE + path
    hl = "".join(f'<link rel="alternate" hreflang="{HTML_LANG[l]}" href="{SITE + p}">' for l, p in alts.items())
    if "en" in alts:
        hl += f'<link rel="alternate" hreflang="x-default" href="{SITE + alts["en"]}">'
    return f"""<!doctype html>
<html lang="{HTML_LANG[lang]}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{E(title)}</title>
<link rel="canonical" href="{url}">{hl}
<meta name="description" content="{E(desc)}">
<meta property="og:type" content="article"><meta property="og:site_name" content="Ticker&amp;Tape"><meta property="og:title" content="{E(title)}">
<meta property="og:description" content="{E(desc)}"><meta property="og:url" content="{url}"><meta property="og:image" content="{SITE}/og-image.png">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:site" content="@Tickerandtape">
<link rel="icon" href="/favicon.ico" sizes="any"><link rel="icon" type="image/svg+xml" href="/img/logo.svg"><link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest"><meta name="theme-color" content="#1f3c6e">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Courier+Prime:wght@400;700&family=Archivo+Narrow:wght@400;600;700&family=Libre+Franklin:wght@600;800&display=swap">
<link rel="stylesheet" href="/style.css?v={css_v}">{extra}
</head>
<body class="learnpg">
<div class="sheet">"""


def topbar(lang, alts):
    sw = "".join(f'<a href="{alts[l]}" hreflang="{HTML_LANG[l]}" class="{"on" if l == lang else ""}" data-lang="{l}">{l.upper()}</a>' for l in LANGS if l in alts)
    return (f'<header class="ltop"><a href="/" class="brand"><img src="/img/logo.svg" alt="" width="34" height="34">Ticker&amp;Tape</a>'
            f'<nav class="lnav" aria-label="{u("school", lang)}"><a href="{lurl("", lang)}" class="on">{u("school", lang)}</a><a href="/methodology/">{u("methodology", lang)}</a>'
            f'<a href="/glossary/">{u("glossary", lang)}</a><span class="llang">{sw}</span><a class="btn" href="/">{u("charts", lang)}</a></nav></header>')


def tail(lang):
    # remember the language for the rest of the site (the app reads ink:cfg.lang)
    js = ("<script>document.querySelectorAll('.llang a').forEach(a=>a.addEventListener('click',()=>{try{const c=JSON.parse(localStorage.getItem('ink:cfg')||'{}');"
          "c.lang=a.dataset.lang;localStorage.setItem('ink:cfg',JSON.stringify(c));}catch(e){}}));</script>")
    return f'<footer class="lfoot"><p>{u("disclaimer", lang)}</p><p>© Ticker&amp;Tape · <a href="/terms.html">Terms</a> · <a href="/privacy.html">Privacy</a></p></footer></div>{js}</body></html>'


def lesson_page(lang, L, i, order, by_slug, mod_of, css_v, uni, groups, sparks, day):
    li = LANGS.index(lang)
    slug = L["slug"]
    mi = mod_of[slug]
    mtitle = MODULES[mi][0][li]
    alts = {l: lurl(slug, l) for l in LANGS}
    path = lurl(slug, lang)
    title = f'{L["title"]} · {u("school", lang)} · Ticker&Tape'
    ld = {"@context": "https://schema.org", "@type": "Article", "headline": L["title"], "description": L["desc"], "inLanguage": HTML_LANG[lang],
          "author": {"@type": "Organization", "name": "Ticker&Tape"}, "publisher": {"@type": "Organization", "name": "Ticker&Tape"},
          "isPartOf": {"@type": "Course", "name": u("school", lang), "url": SITE + lurl("", lang)}, "mainEntityOfPage": SITE + path}
    bc = {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": 1, "name": u("school", lang), "item": SITE + lurl("", lang)},
        {"@type": "ListItem", "position": 2, "name": L["title"], "item": SITE + path}]}
    extra = f'\n<script type="application/ld+json">{json.dumps(ld, ensure_ascii=False)}</script><script type="application/ld+json">{json.dumps(bc, ensure_ascii=False)}</script>'
    h = [head(lang, title, L["desc"], path, alts, css_v, extra), topbar(lang, alts), '<main class="learn">']
    h.append(f'<nav class="lcrumb"><a href="{lurl("", lang)}">{u("school", lang)}</a> › <a href="{lurl("", lang)}#m{mi + 1}">{u("module", lang)} {mi + 1} · {E(mtitle)}</a></nav>')
    h.append(f'<h1>{E(L["title"])}</h1><p class="llede">{inline(L.get("intro", ""), lang)}</p>')
    mins = max(2, round(words(L) / 200))
    h.append(f'<p class="lmeta">{u("lesson", lang)} {i + 1} {u("of", lang)} {len(order)} · {mins} {u("min", lang)}</p>')
    for sec in L.get("sections", []):
        h.append(f'<h2>{inline(sec.get("h", ""), lang)}</h2>')
        for p in sec.get("p", []):
            h.append(f"<p>{inline(p, lang)}</p>")
        if sec.get("list"):
            h.append("<ul>" + "".join(f"<li>{inline(x, lang)}</li>" for x in sec["list"]) + "</ul>")
        if sec.get("diagram"):
            svg = DG.diagram(sec["diagram"], lang)
            if svg:
                h.append(f'<figure class="ldiag">{svg}</figure>')
    rules = L.get("rules")
    if rules and rules.get("rows"):
        h.append(f'<h2>{inline(rules.get("title", ""), lang)}</h2><table class="lrules"><tbody>'
                 + "".join(f"<tr><th>{inline(a, lang)}</th><td>{inline(b, lang)}</td></tr>" for a, b in rules["rows"]) + "</tbody></table>")
    if L.get("mistakes"):
        h.append(f'<div class="lbox lwarn"><h3>{u("mistakes", lang)}</h3><ul>' + "".join(f"<li>{inline(x, lang)}</li>" for x in L["mistakes"]) + "</ul></div>")
    if L.get("takeaways"):
        h.append(f'<div class="lbox lkey"><h3>{u("takeaways", lang)}</h3><ol>' + "".join(f"<li>{inline(x, lang)}</li>" for x in L["takeaways"]) + "</ol></div>")
    h.append(live_block(L.get("live"), lang, uni, groups, sparks, day))
    if L.get("try"):
        h.append(f'<p class="ltry"><a class="btn on" href="{E(L["try"]["href"])}">{E(L["try"]["label"])} →</a> <span>{u("try", lang)}</span></p>')
    rel = [by_slug[s] for s in L.get("related", []) if s in by_slug]
    if rel:
        h.append(f'<section class="lrel"><h2>{u("related", lang)}</h2><ul>' + "".join(f'<li><a href="{lurl(r["slug"], lang)}">{E(r["title"])}</a></li>' for r in rel) + "</ul></section>")
    prev = by_slug.get(order[i - 1]) if i > 0 else None
    nxt = by_slug.get(order[i + 1]) if i + 1 < len(order) else None
    h.append('<nav class="lpn">' + (f'<a class="lprev" href="{lurl(prev["slug"], lang)}"><small>← {u("prev", lang)}</small>{E(prev["title"])}</a>' if prev else f'<a class="lprev" href="{lurl("", lang)}"><small>←</small>{u("back", lang)}</a>')
             + (f'<a class="lnext" href="{lurl(nxt["slug"], lang)}"><small>{u("next", lang)} →</small>{E(nxt["title"])}</a>' if nxt else f'<a class="lnext" href="{lurl("", lang)}"><small>→</small>{u("back", lang)}</a>') + "</nav>")
    h.append("</main>" + tail(lang))
    return "\n".join(h)


def index_page(lang, by_slug, css_v):
    li = LANGS.index(lang)
    alts = {l: lurl("", l) for l in LANGS}
    path = lurl("", lang)
    ld = {"@context": "https://schema.org", "@type": "Course", "name": u("school", lang), "description": u("school_desc", lang), "inLanguage": HTML_LANG[lang],
          "provider": {"@type": "Organization", "name": "Ticker&Tape", "sameAs": SITE}, "isAccessibleForFree": True}
    extra = f'\n<script type="application/ld+json">{json.dumps(ld, ensure_ascii=False)}</script>'
    h = [head(lang, u("school_title", lang) + " · Ticker&Tape", u("school_desc", lang), path, alts, css_v, extra), topbar(lang, alts), '<main class="learn lindex">']
    first = MODULES[0][1][0]
    h.append(f'<section class="lhero"><div><p class="kicker">{u("kicker", lang)}</p><h1>{u("school", lang)}</h1><p class="llede">{u("school_lede", lang)}</p>'
             f'<p class="lctas"><a class="btn on" href="{lurl(first, lang)}">{u("start", lang)} →</a> <a class="btn" href="#m9">{u("jump", lang)}</a></p></div>'
             f'<figure class="ldiag">{DG.diagram("cup-handle", lang)}</figure></section>')
    n = 0
    for mi, (titles, slugs) in enumerate(MODULES):
        items = []
        for s in slugs:
            n += 1
            L = by_slug.get(s)
            if not L:
                continue
            items.append(f'<li><a href="{lurl(s, lang)}"><span class="ln">{n}</span><b>{E(L["title"])}</b><small>{E(snip(plain(L.get("intro", ""))))}</small></a></li>')
        h.append(f'<section class="lmod" id="m{mi + 1}"><h2><span>{u("module", lang)} {mi + 1}</span>{E(titles[li])} <small>{len(slugs)} {u("lessons", lang)}</small></h2><ol>{"".join(items)}</ol></section>')
    h.append("</main>" + tail(lang))
    return "\n".join(h)


def build(root: Path, day: str = "") -> list[str]:
    """Writes the school under root (the site folder) and returns the page paths for the sitemap."""
    content = load()
    if not content.get("en"):
        return []
    css_v = "1"
    m = re.search(r"/style\.css\?v=([\w]+)", (root / "index.html").read_text()) if (root / "index.html").exists() else None
    if m:
        css_v = m.group(1)
    def rd(name, default):
        try:
            return json.loads((root / "data" / name).read_text())
        except Exception:  # noqa: BLE001
            return default
    uni = rd("universe.json", [])
    groups = (rd("groups.json", {}) or {}).get("groups", [])
    sparks = rd("spark.json", {})
    if not day:
        day = (rd("meta.json", {}) or {}).get("dataDate", "")
    order = [s for _, ss in MODULES for s in ss]
    mod_of = {s: mi for mi, (_, ss) in enumerate(MODULES) for s in ss}
    paths = []
    for lang in LANGS:
        by_slug = {L["slug"]: L for L in content.get(lang, [])}
        if not by_slug:
            continue
        base = root / PREFIX[lang].strip("/")
        base.mkdir(parents=True, exist_ok=True)
        (base / "index.html").write_text(index_page(lang, by_slug, css_v))
        paths.append(lurl("", lang))
        for i, s in enumerate(order):
            L = by_slug.get(s)
            if not L:
                continue
            d = base / s
            d.mkdir(parents=True, exist_ok=True)
            (d / "index.html").write_text(lesson_page(lang, L, i, order, by_slug, mod_of, css_v, uni, groups, sparks, day))
            paths.append(lurl(s, lang))
    return paths


if __name__ == "__main__":
    out = build(Path(sys.argv[1] if len(sys.argv) > 1 else "site"))
    print(f"{len(out)} pages")

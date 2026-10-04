"""Diagrams for the trading school (scripts/learn.py): small schematic charts drawn as inline SVG.

Every diagram is generated from made-up price paths (keypoints + deterministic noise), so they show the idea
cleanly and never a real stock. Labels come in English, Spanish and Portuguese.
"""
from __future__ import annotations

import math
import random
from html import escape as E

W, H = 640, 300
INK, INK2, GRID, NAVY, UP, DOWN = "#15171c", "#5a5d66", "#c9cbd3", "#1f3c6e", "#1d3fc4", "#e0337f"
RED, GREEN, AMBER, ZONE = "#d23a2a", "#3c8a3a", "#a86a00", "rgba(29,63,196,.08)"
FONT = "Archivo Narrow, Arial Narrow, Arial, sans-serif"
MONO = "Courier Prime, Courier New, monospace"

# ---------------------------------------------------------------- labels
L = {
    "open": ("Open", "Apertura", "Abertura"), "close": ("Close", "Cierre", "Fechamento"),
    "high": ("High", "Máximo", "Máxima"), "low": ("Low", "Mínimo", "Mínima"),
    "body": ("Body", "Cuerpo", "Corpo"), "wick": ("Wick", "Mecha", "Pavio"),
    "upday": ("Up day: close above open", "Día alcista: cierra arriba de la apertura", "Dia de alta: fecha acima da abertura"),
    "downday": ("Down day: close below open", "Día bajista: cierra debajo de la apertura", "Dia de baixa: fecha abaixo da abertura"),
    "candles": ("Candlesticks", "Velas", "Velas"), "bars": ("Bars (OHLC)", "Barras (OHLC)", "Barras (OHLC)"),
    "daily": ("Daily chart · about 6 months", "Gráfico diario · unos 6 meses", "Gráfico diário · cerca de 6 meses"),
    "weekly": ("Weekly chart · about 2 years", "Gráfico semanal · unos 2 años", "Gráfico semanal · cerca de 2 anos"),
    "linear": ("Linear scale", "Escala lineal", "Escala linear"), "log": ("Log scale", "Escala logarítmica", "Escala logarítmica"),
    "lin_note": ("Early moves look tiny", "Las subas iniciales parecen chicas", "As altas iniciais parecem pequenas"),
    "log_note": ("Equal % moves look equal", "Mismos % se ven iguales", "Mesmos % parecem iguais"),
    "price": ("Price", "Precio", "Preço"), "volume": ("Volume", "Volumen", "Volume"),
    "ma50": ("50-day line", "Media de 50 días", "Média de 50 dias"), "ma200": ("200-day line", "Media de 200 días", "Média de 200 dias"),
    "ma21": ("21-day EMA", "EMA de 21 días", "MME de 21 dias"), "ma10": ("10-day", "10 días", "10 dias"),
    "avgvol": ("50-day avg volume", "Volumen promedio 50 días", "Volume médio 50 dias"),
    "rsline": ("RS line", "Línea RS", "Linha RS"), "pivot": ("Pivot", "Pivot", "Pivô"),
    "buyzone": ("Buy zone (pivot to +5%)", "Zona de compra (pivot a +5%)", "Zona de compra (pivô a +5%)"),
    "base": ("Base", "Base", "Base"), "databox": ("Data box", "Recuadro de datos", "Quadro de dados"),
    "epstable": ("EPS and sales", "EPS y ventas", "LPA e vendas"), "earn": ("Earnings", "Balance", "Balanço"),
    "hh": ("Higher high", "Máximo más alto", "Máxima mais alta"), "hl": ("Higher low", "Mínimo más alto", "Mínima mais alta"),
    "lh": ("Lower high", "Máximo más bajo", "Máxima mais baixa"), "ll": ("Lower low", "Mínimo más bajo", "Mínima mais baixa"),
    "uptrend": ("Uptrend", "Tendencia alcista", "Tendência de alta"), "downtrend": ("Downtrend", "Tendencia bajista", "Tendência de baixa"),
    "range": ("Sideways range", "Rango lateral", "Lateralização"),
    "s1": ("Stage 1 · basing", "Etapa 1 · base", "Estágio 1 · base"), "s2": ("Stage 2 · advancing", "Etapa 2 · suba", "Estágio 2 · alta"),
    "s3": ("Stage 3 · topping", "Etapa 3 · techo", "Estágio 3 · topo"), "s4": ("Stage 4 · declining", "Etapa 4 · baja", "Estágio 4 · queda"),
    "buyhere": ("Buy only here", "Comprar solo acá", "Comprar só aqui"),
    "trendline": ("Trendline", "Línea de tendencia", "Linha de tendência"), "break": ("Break", "Ruptura", "Rompimento"),
    "support": ("Support", "Soporte", "Suporte"), "resistance": ("Resistance", "Resistencia", "Resistência"),
    "rr_old": ("Old resistance…", "Resistencia vieja…", "Resistência antiga…"), "rr_new": ("…becomes support", "…pasa a ser soporte", "…vira suporte"),
    "retest": ("Retest", "Retesteo", "Reteste"),
    "gap_hold": ("Breakaway gap holds", "Gap de ruptura que se sostiene", "Gap de rompimento que se mantém"),
    "gap_fill": ("Gap that fills", "Gap que se cierra", "Gap que se fecha"),
    "breakout": ("Breakout", "Ruptura", "Rompimento"), "bigvol": ("Volume 40%+ above average", "Volumen 40%+ sobre el promedio", "Volume 40%+ acima da média"),
    "dryup": ("Volume dries up", "El volumen se seca", "O volume seca"),
    "accum": ("Accumulation: up on big volume", "Acumulación: suba con mucho volumen", "Acumulação: alta com volume forte"),
    "dist": ("Distribution: down on big volume", "Distribución: baja con mucho volumen", "Distribuição: queda com volume forte"),
    "bounce": ("Bounce off the line", "Rebote en la media", "Repique na média"),
    "heavybreak": ("Heavy-volume break: sell signal", "Ruptura con volumen: señal de venta", "Rompimento com volume: sinal de venda"),
    "golden": ("Golden cross", "Cruce dorado", "Cruz dourada"), "above200": ("Above the 200-day: long-term uptrend", "Arriba de la de 200: tendencia de largo plazo alcista", "Acima da de 200: tendência de longo prazo de alta"),
    "below200": ("Below the 200-day: not a leader", "Debajo de la de 200: no es líder", "Abaixo da de 200: não é líder"),
    "ob": ("Overbought 70", "Sobrecompra 70", "Sobrecompra 70"), "os": ("Oversold 30", "Sobreventa 30", "Sobrevenda 30"),
    "macdl": ("MACD", "MACD", "MACD"), "signal": ("Signal", "Señal", "Sinal"), "hist": ("Histogram", "Histograma", "Histograma"),
    "squeeze": ("Squeeze: bands narrow", "Squeeze: bandas angostas", "Squeeze: bandas estreitas"), "expand": ("Expansion", "Expansión", "Expansão"),
    "avwap": ("VWAP anchored at earnings", "VWAP anclado al balance", "VWAP ancorado no balanço"),
    "atr_hi": ("Wide daily ranges: high ATR", "Rangos amplios: ATR alto", "Amplitudes largas: ATR alto"),
    "atr_lo": ("Tight ranges: low ATR", "Rangos chicos: ATR bajo", "Amplitudes curtas: ATR baixo"),
    "rsnh": ("RS line new high first", "Línea RS en máximo primero", "Linha RS na máxima primeiro"),
    "weak": ("Weakest", "Más débil", "Mais fraca"), "strong": ("Strongest", "Más fuerte", "Mais forte"),
    "leaders_zone": ("Leaders: 80+", "Líderes: 80+", "Líderes: 80+"),
    "handle": ("Handle", "Asa", "Alça"), "cup": ("Cup", "Taza", "Xícara"), "depth": ("Depth", "Profundidad", "Profundidade"),
    "prior": ("Prior uptrend 30%+", "Suba previa 30%+", "Alta anterior 30%+"),
    "left": ("Left-side high", "Máximo izquierdo", "Máxima esquerda"), "flat": ("≤15% deep, 5+ weeks", "≤15% de profundidad, 5+ semanas", "≤15% de profundidade, 5+ semanas"),
    "undercut": ("Second low undercuts the first", "El segundo mínimo perfora el primero", "A segunda mínima perfura a primeira"),
    "middle": ("Middle peak = pivot", "Pico del medio = pivot", "Pico do meio = pivô"),
    "p1": ("Pullback 1", "Retroceso 1", "Recuo 1"), "p2": ("Pullback 2", "Retroceso 2", "Recuo 2"), "p3": ("Pullback 3", "Retroceso 3", "Recuo 3"),
    "pole": ("100%+ in 4–8 weeks", "100%+ en 4–8 semanas", "100%+ em 4–8 semanas"), "flag": ("Flag 10–25%", "Bandera 10–25%", "Bandeira 10–25%"),
    "base1": ("First base", "Primera base", "Primeira base"), "base2": ("Base on top", "Base encima", "Base em cima"),
    "ipo": ("IPO", "Salida a bolsa", "IPO"), "ipobase": ("Short IPO base", "Base corta post-IPO", "Base curta pós-IPO"),
    "extended": ("Extended: more than 5% above pivot", "Extendida: más de 5% sobre el pivot", "Esticada: mais de 5% acima do pivô"),
    "dontchase": ("Don't chase", "No perseguir", "Não perseguir"),
    "b1": ("1st base", "1ª base", "1ª base"), "b2": ("2nd", "2ª", "2ª"), "b3": ("3rd", "3ª", "3ª"), "b4": ("4th: late stage", "4ª: etapa tardía", "4ª: estágio tardio"),
    "works": ("Work best", "Funcionan mejor", "Funcionam melhor"), "fails": ("Fail more often", "Fallan más", "Falham mais"),
    "failed": ("Falls back below the pivot", "Vuelve debajo del pivot", "Volta abaixo do pivô"),
    "stop": ("Stop 7–8% below entry", "Stop 7–8% debajo de la compra", "Stop 7–8% abaixo da compra"),
    "entry": ("Entry", "Compra", "Compra"), "sellpart": ("Take profits at 20–25%", "Tomar ganancia al 20–25%", "Realizar lucro em 20–25%"),
    "q": ("Q", "T", "T"), "epsg": ("EPS growth vs a year ago", "Crecimiento del EPS vs hace un año", "Crescimento do LPA vs um ano atrás"),
    "accel": ("Acceleration", "Aceleración", "Aceleração"),
    "sales": ("Sales growth", "Crecimiento de ventas", "Crescimento de vendas"), "margin": ("Pre-tax margin", "Margen antes de impuestos", "Margem antes de impostos"),
    "gapup": ("Gap up on huge volume after earnings", "Gap alcista con volumen enorme tras el balance", "Gap de alta com volume enorme após o balanço"),
    "funds": ("Funds owning the stock", "Fondos con la acción", "Fundos com a ação"),
    "correction": ("Correction", "Corrección", "Correção"), "rally": ("Rally attempt", "Intento de rally", "Tentativa de rali"),
    "ftd": ("Follow-through day", "Día de seguimiento", "Dia de confirmação"), "confirmed": ("Confirmed uptrend", "Tendencia alcista confirmada", "Tendência de alta confirmada"),
    "pressure": ("Under pressure", "Bajo presión", "Sob pressão"), "ddays": ("Distribution days pile up", "Se acumulan días de distribución", "Dias de distribuição se acumulam"),
    "dday": ("D", "D", "D"), "day1": ("Day 1", "Día 1", "Dia 1"), "day4": ("Day 4+: up 1.2%+ on higher volume", "Día 4+: sube 1,2%+ con más volumen", "Dia 4+: alta de 1,2%+ com mais volume"),
    "index": ("Index", "Índice", "Índice"), "pct50": ("% of stocks above the 50-day", "% de acciones sobre la media de 50", "% de ações acima da média de 50"),
    "diverge": ("Index higher, fewer stocks participate", "Índice más alto, menos acciones acompañan", "Índice mais alto, menos ações participam"),
    "cut": ("Cut", "Recorte", "Corte"), "hold": ("Hold", "Mantener", "Manter"), "hike": ("Hike", "Suba", "Alta"),
    "nextfomc": ("Odds for the next Fed meeting", "Probabilidades para la próxima reunión de la Fed", "Probabilidades para a próxima reunião do Fed"),
    "mon": ("Mon", "Lun", "Seg"), "tue": ("Tue", "Mar", "Ter"), "wed": ("Wed", "Mié", "Qua"), "thu": ("Thu", "Jue", "Qui"), "fri": ("Fri", "Vie", "Sex"),
    "hiimp": ("High importance", "Alta importancia", "Alta importância"),
    "acct": ("Account", "Cuenta", "Conta"), "risk": ("Risk 1%", "Riesgo 1%", "Risco 1%"), "shares": ("Shares", "Acciones", "Ações"),
    "position": ("Position", "Posición", "Posição"), "pershare": ("Risk per share", "Riesgo por acción", "Risco por ação"),
    "exp_up": ("Confirmed uptrend", "Tendencia confirmada", "Tendência confirmada"), "exp_pr": ("Under pressure", "Bajo presión", "Sob pressão"),
    "exp_co": ("Correction", "Corrección", "Correção"), "invested": ("Invested", "Invertido", "Investido"),
    "market": ("Market order: fills now at the best price", "Orden a mercado: se ejecuta ya al mejor precio", "Ordem a mercado: executa já ao melhor preço"),
    "limit": ("Buy limit: only at this price or lower", "Compra limitada: solo a este precio o menos", "Compra limitada: só a este preço ou menos"),
    "stoporder": ("Stop: becomes a sell order if price falls here", "Stop: se vuelve orden de venta si el precio cae acá", "Stop: vira ordem de venda se o preço cair aqui"),
    "buystop": ("Buy stop: buys if price rises to the pivot", "Buy stop: compra si el precio sube al pivot", "Buy stop: compra se o preço subir ao pivô"),
    "pre": ("Pre-market", "Pre-mercado", "Pré-mercado"), "regular": ("Regular session", "Sesión regular", "Sessão regular"), "after": ("After-hours", "Post-mercado", "After-market"),
    "et": ("New York time (ET)", "Hora de Nueva York (ET)", "Horário de Nova York (ET)"), "earnings_out": ("Most earnings come out here", "La mayoría de los balances salen acá", "A maioria dos balanços sai aqui"),
    "stock": ("Stock", "Acción", "Ação"), "stock_d": ("A piece of one company", "Una parte de una empresa", "Uma parte de uma empresa"),
    "etf": ("ETF", "ETF", "ETF"), "etf_d": ("A basket you trade like a stock", "Una canasta que se opera como una acción", "Uma cesta negociada como ação"),
    "idx": ("Index", "Índice", "Índice"), "idx_d": ("A yardstick: S&P 500, Nasdaq", "Una referencia: S&P 500, Nasdaq", "Uma referência: S&P 500, Nasdaq"),
    "before": ("Before the open", "Antes de la apertura", "Antes da abertura"), "during": ("During the session", "Durante la rueda", "Durante o pregão"),
    "afterc": ("After the close", "Después del cierre", "Depois do fechamento"), "weekend": ("Weekend", "Fin de semana", "Fim de semana"),
    "r1": ("Market direction · macro · earnings", "Dirección del mercado · macro · balances", "Direção do mercado · macro · balanços"),
    "r2": ("Alerts · breakouts with volume", "Alertas · rupturas con volumen", "Alertas · rompimentos com volume"),
    "r3": ("Review trades · update watchlist", "Revisar operaciones · actualizar watchlist", "Revisar operações · atualizar watchlist"),
    "r4": ("Weekly charts · groups · new bases", "Gráficos semanales · grupos · bases nuevas", "Gráficos semanais · grupos · bases novas"),
    "gain20": ("+20–25%", "+20–25%", "+20–25%"), "loss8": ("−7–8%", "−7–8%", "−7–8%"), "ratio": ("Keep gains about 3× losses", "Ganancias de unas 3× las pérdidas", "Ganhos de cerca de 3× as perdas"),
    "breaks50": ("Or sell on a break of the 50-day", "O vender si pierde la media de 50", "Ou vender se perder a média de 50"),
}
LANGS = {"en": 0, "es": 1, "pt": 2}


def T(k: str, lang: str) -> str:
    v = L.get(k)
    return v[LANGS[lang]] if v else k


# ---------------------------------------------------------------- price paths
def series(keys, n=120, seed=1, noise=0.012, vol=None):
    """keys: [(x 0..1, price)] → list of (o, h, l, c, v). vol: [(x, multiplier)] step profile for volume."""
    rnd = random.Random(seed)
    xs = [k[0] for k in keys]
    out, prev, walk = [], None, 0.0
    for i in range(n):
        x = i / (n - 1)
        j = max(0, min(len(keys) - 2, next((t for t in range(len(xs) - 1) if xs[t] <= x <= xs[t + 1]), len(xs) - 2)))
        x0, p0 = keys[j]; x1, p1 = keys[j + 1]
        f = 0 if x1 == x0 else (x - x0) / (x1 - x0)
        f = f * f * (3 - 2 * f) * 0.35 + f * 0.65
        base = math.exp(math.log(p0) + (math.log(p1) - math.log(p0)) * f)
        walk = walk * 0.6 + rnd.gauss(0, noise)
        c = base * (1 + walk)
        o = (prev if prev else c) * (1 + rnd.gauss(0, noise * 0.5))
        h = max(o, c) * (1 + abs(rnd.gauss(0, noise * 0.6)))
        lo = min(o, c) * (1 - abs(rnd.gauss(0, noise * 0.6)))
        m = 1.0
        if vol:
            for vx, vm in vol:
                if x >= vx:
                    m = vm
        v = (0.75 + rnd.random() * 0.5) * m * (1.25 if c > o else 0.9)
        out.append((o, h, lo, c, v))
        prev = c
    return out


def sma(vals, n):
    out, s = [], 0.0
    for i, v in enumerate(vals):
        s += v
        if i >= n:
            s -= vals[i - n]
        out.append(s / n if i >= n - 1 else None)
    return out


def ema(vals, n):
    out, e, k = [], None, 2 / (n + 1)
    for v in vals:
        e = v if e is None else v * k + e * (1 - k)
        out.append(e)
    return out


# ---------------------------------------------------------------- the chart renderer
class Chart:
    def __init__(self, data, x=10, y=12, w=W - 70, h=200, logscale=True, lo=None, hi=None, style="candle", pad=0.06):
        self.d, self.x, self.y, self.w, self.h, self.log, self.style = data, x, y, w, h, logscale, style
        ps = [b[2] for b in data] + [b[1] for b in data]
        a, b = (lo or min(ps)), (hi or max(ps))
        if logscale:
            a, b = math.log(a), math.log(b)
        r = (b - a) or 1
        self.a, self.b = a - r * pad, b + r * pad
        self.parts: list[str] = []

    def X(self, i):
        n = len(self.d)
        return self.x + (i + 0.5) * self.w / n

    def Y(self, p):
        v = math.log(p) if self.log else p
        return self.y + (self.b - v) / (self.b - self.a) * self.h

    def bw(self):
        return max(1.2, self.w / len(self.d) * 0.62)

    def price(self, color_by_day=True, upc=UP, dnc=DOWN):
        s, bw = [], self.bw()
        for i, (o, h, l, c, v) in enumerate(self.d):
            col = (upc if c >= o else dnc) if color_by_day else INK
            x = self.X(i)
            if self.style == "line":
                continue
            if self.style == "bar":
                s.append(f'<path d="M{x:.1f} {self.Y(h):.1f}V{self.Y(l):.1f}M{x - bw/2:.1f} {self.Y(o):.1f}H{x:.1f}M{x:.1f} {self.Y(c):.1f}H{x + bw/2:.1f}" stroke="{col}" stroke-width="1.2" fill="none"/>')
            else:
                y1, y2 = self.Y(max(o, c)), self.Y(min(o, c))
                s.append(f'<path d="M{x:.1f} {self.Y(h):.1f}V{self.Y(l):.1f}" stroke="{col}" stroke-width="1"/>'
                         f'<rect x="{x - bw/2:.1f}" y="{y1:.1f}" width="{bw:.1f}" height="{max(0.8, y2 - y1):.1f}" fill="{col if c < o else "#fff"}" stroke="{col}" stroke-width="1"/>')
        if self.style == "line":
            pts = " ".join(f"{self.X(i):.1f},{self.Y(b[3]):.1f}" for i, b in enumerate(self.d))
            s.append(f'<polyline points="{pts}" fill="none" stroke="{NAVY}" stroke-width="2"/>')
        self.parts.append("".join(s))
        return self

    def line(self, vals, color, width=1.6, dash=None, label=None, lang="en"):
        pts = [(self.X(i), self.Y(v)) for i, v in enumerate(vals) if v]
        if not pts:
            return self
        d = " ".join(f"{a:.1f},{b:.1f}" for a, b in pts)
        self.parts.append(f'<polyline points="{d}" fill="none" stroke="{color}" stroke-width="{width}"{f" stroke-dasharray={chr(34)}{dash}{chr(34)}" if dash else ""}/>')
        if label:
            ax, ay = pts[-1]
            self.parts.append(txt(ax - 2, ay + 16, label, color, 11, "end", True))
        return self

    def ma(self, n, color, label=None, kind="sma", width=1.6):
        c = [b[3] for b in self.d]
        vals = sma(c, n) if kind == "sma" else ema(c, n)
        return self.line(vals, color, width, label=label)

    def hline(self, p, label="", color=GREEN, dash="5 4", x1=None, x2=None, side="right", width=1.4):
        a = self.X(x1) if x1 is not None else self.x
        b = self.X(x2) if x2 is not None else self.x + self.w
        y = self.Y(p)
        self.parts.append(f'<path d="M{a:.1f} {y:.1f}H{b:.1f}" stroke="{color}" stroke-width="{width}" stroke-dasharray="{dash}"/>')
        if label:
            if side == "right":
                self.parts.append(txt(b + 4, y + 4, label, color, 11, "start", True))
            else:
                self.parts.append(txt(a + 2, y - 5, label, color, 11, "start", True))
        return self

    def zone(self, p1, p2, label="", x1=None, x2=None, color=ZONE, tcolor=UP):
        a = self.X(x1) if x1 is not None else self.x
        b = self.X(x2) if x2 is not None else self.x + self.w
        y1, y2 = self.Y(max(p1, p2)), self.Y(min(p1, p2))
        self.parts.append(f'<rect x="{a:.1f}" y="{y1:.1f}" width="{b - a:.1f}" height="{y2 - y1:.1f}" fill="{color}"/>')
        if label:
            self.parts.append(txt(a + 4, y1 - 4, label, tcolor, 11, "start", True))
        return self

    def seg(self, i1, p1, i2, p2, color=INK, width=1.6, dash=None, extend=0):
        x1, y1, x2, y2 = self.X(i1), self.Y(p1), self.X(i2), self.Y(p2)
        if extend:
            dx, dy = x2 - x1, y2 - y1
            x2, y2 = x2 + dx * extend, y2 + dy * extend
        self.parts.append(f'<path d="M{x1:.1f} {y1:.1f}L{x2:.1f} {y2:.1f}" stroke="{color}" stroke-width="{width}"{f" stroke-dasharray={chr(34)}{dash}{chr(34)}" if dash else ""} fill="none"/>')
        return self

    def note(self, i, p, text, color=INK, dy=-14, anchor="middle", arrow=True, size=11):
        x, y = self.X(i), self.Y(p)
        if arrow:
            ty = y + dy
            self.parts.append(f'<path d="M{x:.1f} {ty + (4 if dy < 0 else -10):.1f}L{x:.1f} {y + (-4 if dy < 0 else 4):.1f}" stroke="{color}" stroke-width="1.2" marker-end="url(#ar)"/>')
            self.parts.append(txt(x, ty - (2 if dy < 0 else -2) + (0 if dy < 0 else 8), text, color, size, anchor, True))
        else:
            self.parts.append(txt(x, y + dy, text, color, size, anchor, True))
        return self

    def vmark(self, i, label="", color=AMBER):
        x = self.X(i)
        self.parts.append(f'<path d="M{x:.1f} {self.y}V{self.y + self.h}" stroke="{color}" stroke-width="1" stroke-dasharray="2 3"/>')
        if label:
            self.parts.append(txt(x + 3, self.y + 10, label, color, 10, "start", True))
        return self

    def svg(self):
        return "".join(self.parts)


def txt(x, y, s, color=INK, size=11, anchor="start", bold=False, font=FONT, halo=True):
    w = ' font-weight="700"' if bold else ""
    halo = ' paint-order="stroke" stroke="#fff" stroke-width="3" stroke-linejoin="round"' if halo else ""
    return f'<text x="{x:.1f}" y="{y:.1f}" fill="{color}" font-size="{size}" font-family="{font}" text-anchor="{anchor}"{w}{halo}>{E(s)}</text>'


def volume(chart: Chart, y, h, avg=True, lang="en", label=True):
    vs = [b[4] for b in chart.d]
    mx = max(vs)
    s, bw = [], chart.bw()
    for i, (o, hh, l, c, v) in enumerate(chart.d):
        bh = v / mx * h
        s.append(f'<rect x="{chart.X(i) - bw/2:.1f}" y="{y + h - bh:.1f}" width="{bw:.1f}" height="{bh:.1f}" fill="{UP if c >= o else DOWN}" opacity=".75"/>')
    if avg:
        av = sma(vs, 20)
        pts = " ".join(f"{chart.X(i):.1f},{y + h - a / mx * h:.1f}" for i, a in enumerate(av) if a)
        s.append(f'<polyline points="{pts}" fill="none" stroke="{INK}" stroke-width="1.2"/>')
    if label:
        s.append(txt(chart.x + 2, y + 10, T("volume", lang), INK2, 10, "start", True))
    s.append(f'<path d="M{chart.x} {y + h + .5}H{chart.x + chart.w}" stroke="{GRID}"/>')
    return "".join(s)


def frame(body, h=H, w=W, title=None):
    defs = (f'<defs><marker id="ar" viewBox="0 0 8 8" refX="4" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">'
            f'<path d="M0 0L8 4L0 8z" fill="currentColor"/></marker></defs>')
    t = f'<title>{E(title)}</title>' if title else ""
    return (f'<svg viewBox="0 0 {w} {h}" xmlns="http://www.w3.org/2000/svg" role="img" style="color:{INK2}">{t}{defs}'
            f'<rect width="{w}" height="{h}" fill="#fff"/>{body}</svg>')


def std(keys, lang, n=120, seed=1, noise=0.012, vol=None, h=H, vol_panel=True, style="candle", logscale=True):
    d = series(keys, n, seed, noise, vol)
    ch = Chart(d, h=(h - 80 if vol_panel else h - 30), style=style, logscale=logscale)
    return d, ch


def finish(ch, lang, h=H, vol_panel=True, extra="", title=None):
    body = ch.svg()
    if vol_panel:
        body += volume(ch, h - 62, 50, lang=lang)
    return frame(body + extra, h, title=title)


# ---------------------------------------------------------------- the diagrams
def d_candle_anatomy(lang):
    s = []
    for cx, up in ((190, True), (430, False)):
        col = UP if up else DOWN
        top, bot, hi, lo = (90, 200, 50, 240)
        s.append(f'<path d="M{cx} {hi}V{lo}" stroke="{col}" stroke-width="2"/>')
        s.append(f'<rect x="{cx - 28}" y="{top}" width="56" height="{bot - top}" fill="{"#fff" if up else col}" stroke="{col}" stroke-width="2"/>')
        o, c = (bot, top) if up else (top, bot)
        s.append(f'<path d="M{cx + 34} {hi}H{cx + 60}M{cx + 34} {lo}H{cx + 60}M{cx - 34} {o}H{cx - 60}M{cx - 34} {c}H{cx - 60}" stroke="{GRID}"/>')
        s.append(txt(cx + 64, hi + 4, T("high", lang), INK, 12, "start", True))
        s.append(txt(cx + 64, lo + 4, T("low", lang), INK, 12, "start", True))
        s.append(txt(cx - 64, o + 4, T("open", lang), INK, 12, "end", True))
        s.append(txt(cx - 64, c + 4, T("close", lang), INK, 12, "end", True))
        s.append(txt(cx + 34, (top + bot) / 2 + 4, T("body", lang), INK2, 11, "start"))
        s.append(txt(cx + 6, hi + 22, T("wick", lang), INK2, 11, "start"))
        s.append(txt(cx, 275, T("upday" if up else "downday", lang), col, 12, "middle", True))
    return frame("".join(s))


def d_bars_vs_candles(lang):
    d = series([(0, 50), (.4, 56), (.7, 52), (1, 60)], 28, 3, 0.02)
    a = Chart(d, x=20, y=34, w=270, h=220).price()
    b = Chart(d, x=350, y=34, w=270, h=220, style="bar").price()
    return frame(txt(155, 22, T("candles", lang), NAVY, 13, "middle", True) + a.svg() + txt(485, 22, T("bars", lang), NAVY, 13, "middle", True) + b.svg())


def d_daily_weekly(lang):
    dd = series([(0, 80), (.3, 96), (.55, 84), (.8, 99), (1, 108)], 60, 5, 0.012)
    wk = series([(0, 40), (.25, 62), (.45, 55), (.7, 82), (.85, 96), (1, 108)], 60, 6, 0.02)
    a = Chart(dd, x=20, y=34, w=270, h=230).price()
    b = Chart(wk, x=350, y=34, w=270, h=230).price()
    return frame(txt(155, 22, T("daily", lang), NAVY, 12, "middle", True) + a.svg() + txt(485, 22, T("weekly", lang), NAVY, 12, "middle", True) + b.svg())


def d_log_linear(lang):
    d = series([(0, 10), (.25, 20), (.5, 40), (.75, 80), (1, 160)], 60, 7, 0.01)
    a = Chart(d, x=20, y=34, w=270, h=210, logscale=False, style="line").price()
    b = Chart(d, x=350, y=34, w=270, h=210, logscale=True, style="line").price()
    return frame(txt(155, 22, T("linear", lang), NAVY, 13, "middle", True) + a.svg() + txt(155, 280, T("lin_note", lang), INK2, 11, "middle")
                 + txt(485, 22, T("log", lang), NAVY, 13, "middle", True) + b.svg() + txt(485, 280, T("log_note", lang), INK2, 11, "middle"))


def d_chart_anatomy(lang):
    d = series([(0, 60), (.3, 82), (.45, 72), (.62, 70), (.8, 81), (.86, 78), (.9, 82.5), (1, 90)], 130, 11, 0.011, [(0, 1), (.9, 2.2), (.93, 1.2)])
    ch = Chart(d, h=170, y=34)
    ch.price().ma(50, RED).ma(100, INK, width=1.2)
    c = [b[3] for b in d]
    rs = [x / (1 + i * 0.0015) for i, x in enumerate(c)]
    mn, mx = min(rs), max(rs)
    s = " ".join(f"{ch.X(i):.1f},{18 + 26 * (mx - r) / (mx - mn):.1f}" for i, r in enumerate(rs))
    extra = f'<polyline points="{s}" fill="none" stroke="#0b2263" stroke-width="1.2"/>' + txt(ch.X(2), 16, T("rsline", lang), "#0b2263", 10, "start", True)
    ch.zone(82.6, 86.7, "", x1=100, x2=129).hline(82.6, T("pivot", lang), GREEN, x1=40, x2=129)
    ch.note(60, 70, T("base", lang), INK2, 16, arrow=False)
    ch.parts.append(txt(ch.X(18), ch.Y(c[18]) + 30, T("ma50", lang), RED, 10, "middle", True))
    box = (f'<rect x="{W - 150}" y="60" width="138" height="70" fill="#f4f6fb" stroke="{NAVY}"/>' + txt(W - 81, 76, T("databox", lang), NAVY, 11, "middle", True)
           + "".join(f'<path d="M{W - 140} {88 + k * 11}H{W - 22}" stroke="{GRID}"/>' for k in range(4)))
    box += (f'<rect x="{W - 150}" y="140" width="138" height="54" fill="#fff" stroke="{INK}"/>' + txt(W - 81, 156, T("epstable", lang), INK, 11, "middle", True)
            + "".join(f'<rect x="{W - 140 + k * 30}" y="164" width="22" height="20" fill="{ZONE}" stroke="{GRID}"/>' for k in range(4)))
    ch.w = W - 170
    return frame(ch.svg() + extra + volume(ch, 226, 56, lang=lang) + box)


def d_uptrend(lang):
    d, ch = std([(0, 50), (.15, 58), (.25, 54), (.42, 64), (.52, 59), (.7, 72), (.8, 66), (1, 80)], lang, 110, 2, 0.008, vol_panel=False)
    ch.price()
    for i, p, k, dy in ((16, 58, "hh", -16), (27, 54, "hl", 26), (46, 64, "hh", -16), (57, 59, "hl", 26), (77, 72, "hh", -16), (88, 66, "hl", 26)):
        ch.note(i, p * (1.02 if dy < 0 else .98), T(k, lang), UP if k == "hh" else GREEN, dy)
    ch.parts.append(txt(20, 26, T("uptrend", lang), NAVY, 14, "start", True))
    return finish(ch, lang, vol_panel=False)


def d_downtrend(lang):
    d, ch = std([(0, 80), (.15, 70), (.25, 75), (.42, 63), (.52, 68), (.7, 56), (.8, 60), (1, 48)], lang, 110, 4, 0.008, vol_panel=False)
    ch.price()
    for i, p, k, dy in ((16, 70, "ll", 26), (27, 75, "lh", -16), (46, 63, "ll", 26), (57, 68, "lh", -16), (77, 56, "ll", 26), (88, 60, "lh", -16)):
        ch.note(i, p * (1.02 if dy < 0 else .98), T(k, lang), DOWN, dy)
    ch.parts.append(txt(W - 80, H - 14, T("downtrend", lang), DOWN, 14, "end", True))
    return finish(ch, lang, vol_panel=False)


def d_sideways(lang):
    d, ch = std([(0, 60), (.12, 68), (.25, 61), (.4, 68.5), (.55, 60.5), (.7, 68), (.85, 61), (1, 66)], lang, 110, 8, 0.008, vol_panel=False)
    ch.price().zone(60, 69, "", color="rgba(90,93,102,.07)").hline(69, T("resistance", lang), DOWN, side="left").hline(60, T("support", lang), GREEN, side="left")
    ch.parts.append(txt(20, 26, T("range", lang), INK2, 14, "start", True))
    return finish(ch, lang, vol_panel=False)


def d_stages(lang):
    d, ch = std([(0, 40), (.08, 34), (.25, 33), (.28, 37), (.32, 34), (.6, 70), (.7, 74), (.76, 66), (.82, 73), (.86, 67), (1, 42)], lang, 160, 9, 0.01, vol_panel=False)
    ch.price().ma(40, RED)
    for x1, x2, k, col in ((0, 46, "s1", INK2), (46, 108, "s2", GREEN), (108, 138, "s3", AMBER), (138, 159, "s4", DOWN)):
        ch.parts.append(f'<rect x="{ch.X(x1):.1f}" y="{ch.y + ch.h - 18}" width="{ch.X(x2) - ch.X(x1):.1f}" height="16" fill="{col}" opacity=".12"/>')
        ch.parts.append(txt((ch.X(x1) + ch.X(x2)) / 2, ch.y + ch.h - 6, T(k, lang), col, 10, "middle", True))
    ch.note(70, 45, T("buyhere", lang), GREEN, 22)
    return finish(ch, lang, vol_panel=False)


def d_trendline(lang):
    d, ch = std([(0, 50), (.2, 60), (.27, 56), (.5, 68), (.57, 64), (.78, 76), (.86, 74), (1, 64)], lang, 120, 12, 0.008, vol_panel=False)
    ch.price()
    lows = [min(range(a, b), key=lambda i: d[i][2]) for a, b in ((0, 12), (28, 38), (64, 74))]
    i1, i2 = lows[0], lows[2]
    ch.seg(i1, d[i1][2], i2, d[i2][2], NAVY, 2, extend=0.55)
    ch.note(i2 + 10, d[i2][2] * 1.04, T("trendline", lang), NAVY, -18)
    ch.note(108, d[108][3] * .98, T("break", lang), DOWN, 24)
    return finish(ch, lang, vol_panel=False)


def d_support_resistance(lang):
    d, ch = std([(0, 70), (.12, 79), (.25, 66), (.38, 78.5), (.5, 67), (.65, 79.2), (.75, 70), (.88, 78), (1, 86)], lang, 120, 13, 0.008, vol_panel=False)
    ch.price().hline(79.5, T("resistance", lang), DOWN, side="left").hline(66.5, T("support", lang), GREEN, side="left")
    return finish(ch, lang, vol_panel=False)


def d_role_reversal(lang):
    d, ch = std([(0, 60), (.15, 70), (.28, 63), (.42, 70.3), (.52, 66), (.62, 78), (.72, 71.5), (.8, 72), (1, 84)], lang, 120, 14, 0.008, vol_panel=False)
    ch.price().hline(71, "", GREEN)
    ch.note(18, 72.5, T("rr_old", lang), DOWN, -16).note(88, 70, T("rr_new", lang), GREEN, 26)
    ch.note(74, 71.6, T("retest", lang), INK2, 30, arrow=False)
    return finish(ch, lang, vol_panel=False)


def d_gaps(lang):
    a = series([(0, 50), (.45, 54), (.5, 54.5), (.52, 61), (1, 70)], 60, 15, 0.009, [(0, 1), (.5, 3.5), (.55, 1.4)])
    for i in range(31, 60):
        o, h, l, c, v = a[i]; k = 1.0 if i > 31 else 1.0
        a[i] = (o, h, l, c, v)
    b = series([(0, 50), (.45, 54), (.5, 54.5), (.52, 59), (.75, 53), (1, 51)], 60, 16, 0.009, [(0, 1), (.5, 2.2), (.55, 1)])
    c1 = Chart(a, x=20, y=34, w=270, h=190).price()
    c2 = Chart(b, x=350, y=34, w=270, h=190).price()
    return frame(txt(155, 22, T("gap_hold", lang), GREEN, 12, "middle", True) + c1.svg() + volume(c1, 236, 48, lang=lang)
                 + txt(485, 22, T("gap_fill", lang), DOWN, 12, "middle", True) + c2.svg() + volume(c2, 236, 48, lang=lang, label=False))


def _base_chart(keys, n, seed, vol, lang, h=H):
    d = series(keys, n, seed, 0.009, vol)
    ch = Chart(d, h=h - 86, y=26)
    return d, ch


def d_volume_breakout(lang):
    d, ch = _base_chart([(0, 60), (.12, 72), (.3, 62), (.55, 66), (.7, 71.5), (.78, 69), (.84, 71.8), (.86, 75), (1, 81)], 120, 21,
                        [(0, 1), (.55, .7), (.84, 1), (.855, 2.6), (.89, 1.5), (.93, 1.1)], lang)
    ch.price().ma(50, RED).hline(72.4, T("pivot", lang), GREEN, x1=10, x2=119)
    i = 103
    ch.note(i, d[i][1] * 1.01, T("breakout", lang), GREEN, -20)
    body = ch.svg() + volume(ch, H - 62, 50, lang=lang)
    body += txt(ch.X(i) - 10, H - 50, T("bigvol", lang), UP, 11, "end", True)
    return frame(body)


def d_volume_dryup(lang):
    d, ch = _base_chart([(0, 70), (.1, 80), (.35, 66), (.6, 74), (.7, 78), (.8, 75), (.88, 76), (1, 77)], 120, 22,
                        [(0, 1.3), (.15, 1.5), (.35, 1), (.6, .9), (.78, .45), (.95, .5)], lang)
    ch.price().ma(50, RED)
    body = ch.svg() + volume(ch, H - 62, 50, lang=lang)
    body += txt(ch.X(98), H - 70, T("dryup", lang), AMBER, 11, "middle", True)
    return frame(body)


def d_accum_dist(lang):
    d = series([(0, 50), (.3, 58), (.5, 63), (.7, 61), (1, 52)], 100, 23, 0.012, [(0, 1)])
    d = [(o, h, l, c, v * (2.4 if (i in (12, 24, 33, 44) and c > o) else 2.4 if (i in (70, 79, 86, 93) and c < o) else 1)) for i, (o, h, l, c, v) in enumerate(d)]
    for i in (12, 24, 33, 44):
        o, h, l, c, v = d[i]; d[i] = (min(o, c), h * 1.01, l, max(o, c) * 1.01, v * 2.4 / max(1, v / 1.2) if False else 2.6)
    for i in (70, 79, 86, 93):
        o, h, l, c, v = d[i]; d[i] = (max(o, c), h, l * .99, min(o, c) * .99, 2.6)
    ch = Chart(d, h=H - 86, y=26).price()
    ch.note(28, 60, T("accum", lang), UP, -20).note(82, 62, T("dist", lang), DOWN, -20)
    return frame(ch.svg() + volume(ch, H - 62, 50, lang=lang))


def d_ma_basics(lang):
    d, ch = std([(0, 50), (.3, 62), (.4, 58), (.7, 74), (.78, 70), (1, 84)], lang, 160, 24, 0.01, vol_panel=False)
    ch.price().ma(10, AMBER, width=1.2).ma(21, "#5fa35a", kind="ema").ma(50, RED).ma(100, INK, width=1.2)
    y0 = 24
    for k, (lab, col) in enumerate(((T("ma10", lang), AMBER), (T("ma21", lang), "#5fa35a"), (T("ma50", lang), RED), (T("ma200", lang), INK))):
        ch.parts.append(f'<path d="M{20 + k * 140} {y0}h18" stroke="{col}" stroke-width="2"/>' + txt(42 + k * 140, y0 + 4, lab, col, 11, "start", True))
    return finish(ch, lang, vol_panel=False)


def d_ma_support(lang):
    d, ch = std([(0, 50), (.25, 62), (.38, 58.6), (.6, 72), (.72, 66.8), (1, 82)], lang, 140, 25, 0.009, [(0, 1), (.36, .6), (.42, 1.2), (.7, .6), (.76, 1.2)])
    ch.price().ma(50, RED, T("ma50", lang))
    ch.note(54, 58.5 * .985, T("bounce", lang), GREEN, 22).note(101, 66.8 * .985, T("bounce", lang), GREEN, 22)
    return finish(ch, lang)


def d_ma_break(lang):
    d, ch = std([(0, 50), (.35, 70), (.55, 74), (.65, 71), (.72, 73), (.78, 64), (1, 58)], lang, 140, 26, 0.009, [(0, 1), (.76, 2.6), (.8, 1.3)])
    ch.price().ma(50, RED, T("ma50", lang))
    ch.note(109, 64 * .98, T("heavybreak", lang), DOWN, 26)
    return finish(ch, lang)


def d_ma_200(lang):
    d, ch = std([(0, 70), (.3, 52), (.45, 50), (.65, 62), (1, 80)], lang, 260, 27, 0.009, vol_panel=False, style="line")
    ch.price().ma(50, RED, width=1.4).ma(110, INK, width=1.8)
    ch.note(60, 54, T("below200", lang), DOWN, 30).note(225, 76, T("above200", lang), GREEN, -24)
    return finish(ch, lang, vol_panel=False)


def _osc_panel(ch, vals, y, h, lo, hi, color, lines=(), labels=()):
    s = [f'<rect x="{ch.x}" y="{y}" width="{ch.w}" height="{h}" fill="#fafafa" stroke="{GRID}"/>']
    Y = lambda v: y + (hi - v) / (hi - lo) * h
    for v, lab, col in lines:
        s.append(f'<path d="M{ch.x} {Y(v):.1f}H{ch.x + ch.w}" stroke="{col}" stroke-dasharray="4 3"/>' + txt(ch.x + ch.w + 4, Y(v) + 4, lab, col, 10, "start", True))
    pts = " ".join(f"{ch.X(i):.1f},{Y(v):.1f}" for i, v in enumerate(vals) if v is not None)
    s.append(f'<polyline points="{pts}" fill="none" stroke="{color}" stroke-width="1.5"/>')
    return "".join(s)


def d_rsi(lang):
    d = series([(0, 50), (.3, 66), (.45, 60), (.75, 80), (.85, 74), (1, 86)], 130, 28, 0.011)
    ch = Chart(d, h=150, y=14).price()
    c = [b[3] for b in d]; g = [0] + [max(0, c[i] - c[i - 1]) for i in range(1, len(c))]; l = [0] + [max(0, c[i - 1] - c[i]) for i in range(1, len(c))]
    ag, al = ema(g, 27), ema(l, 27)
    rsi = [100 - 100 / (1 + (a / b if b else 99)) if i > 14 else None for i, (a, b) in enumerate(zip(ag, al))]
    return frame(ch.svg() + txt(20, 186, "RSI (14)", INK2, 10, "start", True) + _osc_panel(ch, rsi, 190, 96, 0, 100, NAVY, ((70, T("ob", lang), DOWN), (30, T("os", lang), GREEN))))


def d_macd(lang):
    d = series([(0, 60), (.3, 52), (.5, 58), (.75, 70), (.85, 66), (1, 76)], 130, 29, 0.011)
    ch = Chart(d, h=150, y=14).price()
    c = [b[3] for b in d]; m = [a - b for a, b in zip(ema(c, 12), ema(c, 26))]; sg = ema(m, 9)
    lo, hi = min(m + sg) * 1.2, max(m + sg) * 1.2
    y, h = 190, 96
    Y = lambda v: y + (hi - v) / (hi - lo) * h
    s = [f'<rect x="{ch.x}" y="{y}" width="{ch.w}" height="{h}" fill="#fafafa" stroke="{GRID}"/><path d="M{ch.x} {Y(0):.1f}H{ch.x + ch.w}" stroke="{GRID}"/>']
    bw = ch.bw()
    for i, (a, b) in enumerate(zip(m, sg)):
        if i < 26:
            continue
        hv = a - b
        s.append(f'<rect x="{ch.X(i) - bw/2:.1f}" y="{min(Y(0), Y(hv)):.1f}" width="{bw:.1f}" height="{abs(Y(hv) - Y(0)):.1f}" fill="{UP if hv > 0 else DOWN}" opacity=".5"/>')
    s.append(f'<polyline points="{" ".join(f"{ch.X(i):.1f},{Y(v):.1f}" for i, v in enumerate(m) if i >= 26)}" fill="none" stroke="{NAVY}" stroke-width="1.5"/>')
    s.append(f'<polyline points="{" ".join(f"{ch.X(i):.1f},{Y(v):.1f}" for i, v in enumerate(sg) if i >= 26)}" fill="none" stroke="{AMBER}" stroke-width="1.3"/>')
    s.append(txt(ch.x + ch.w + 4, y + 14, T("macdl", lang), NAVY, 10, "start", True) + txt(ch.x + ch.w + 4, y + 28, T("signal", lang), AMBER, 10, "start", True) + txt(ch.x + ch.w + 4, y + 42, T("hist", lang), INK2, 10, "start", True))
    return frame(ch.svg() + txt(20, 186, "MACD (12, 26, 9)", INK2, 10, "start", True) + "".join(s))


def d_bollinger(lang):
    d = series([(0, 60), (.25, 66), (.35, 63), (.6, 64.5), (.72, 64), (.78, 70), (1, 80)], 140, 30, 0.006)
    d = [(o, h, l, c, v) if not (40 < i < 105) else (o, h - (h - c) * .5, l + (c - l) * .5, c, v) for i, (o, h, l, c, v) in enumerate(d)]
    ch = Chart(d, h=H - 40, y=14)
    c = [b[3] for b in d]; m = sma(c, 20)
    sd = [None if i < 19 else (sum((x - m[i]) ** 2 for x in c[i - 19:i + 1]) / 20) ** .5 for i in range(len(c))]
    up = [None if v is None else m[i] + 2 * v for i, v in enumerate(sd)]
    dn = [None if v is None else m[i] - 2 * v for i, v in enumerate(sd)]
    ch.line(up, "#7b4bb3", 1.2).line(dn, "#7b4bb3", 1.2).line(m, "#7b4bb3", 1, "3 3").price()
    ch.note(88, max(x for x in up[80:96] if x) * 1.01, T("squeeze", lang), "#7b4bb3", -18).note(118, d[118][1] * 1.01, T("expand", lang), GREEN, -18)
    return frame(ch.svg())


def d_vwap(lang):
    d, ch = std([(0, 60), (.3, 58), (.32, 66), (.5, 72), (.62, 67), (.8, 76), (.88, 72), (1, 82)], lang, 130, 31, 0.01, [(0, 1), (.31, 3), (.35, 1.2)])
    a = 40; num = den = 0; vw = []
    for i, (o, h, l, c, v) in enumerate(d):
        if i < a:
            vw.append(None); continue
        tp = (h + l + c) / 3; num += tp * v; den += v; vw.append(num / den)
    ch.price().line(vw, AMBER, 2).vmark(a, T("earn", lang))
    ch.note(80, vw[80] * .985, T("avwap", lang), AMBER, 26)
    return finish(ch, lang)


def d_atr(lang):
    a = series([(0, 50), (.5, 60), (1, 55)], 40, 32, 0.035)
    b = series([(0, 50), (.5, 54), (1, 56)], 40, 33, 0.006)
    c1 = Chart(a, x=20, y=34, w=270, h=230).price()
    c2 = Chart(b, x=350, y=34, w=270, h=230).price()
    return frame(txt(155, 22, T("atr_hi", lang), DOWN, 12, "middle", True) + c1.svg() + txt(485, 22, T("atr_lo", lang), GREEN, 12, "middle", True) + c2.svg())


def d_rs_line(lang):
    d = series([(0, 60), (.3, 72), (.5, 64), (.75, 74), (.85, 73), (1, 84)], 130, 34, 0.009)
    ch = Chart(d, h=150, y=40).price()
    c = [b[3] for b in d]
    idx = series([(0, 100), (.3, 104), (.5, 96), (.75, 99), (1, 104)], 130, 35, 0.006)
    rs = [x / idx[i][3] for i, x in enumerate(c)]
    mn, mx = min(rs), max(rs)
    Y = lambda r: 210 + 66 * (mx - r) / (mx - mn)
    pts = " ".join(f"{ch.X(i):.1f},{Y(r):.1f}" for i, r in enumerate(rs))
    k = max(range(80, 112), key=lambda i: rs[i])
    s = (f'<polyline points="{pts}" fill="none" stroke="#0b2263" stroke-width="1.6"/>' + txt(ch.x + 4, 206, T("rsline", lang) + " = " + T("price", lang) + " ÷ S&P 500", "#0b2263", 11, "start", True)
         + f'<circle cx="{ch.X(k):.1f}" cy="{Y(rs[k]):.1f}" r="5" fill="none" stroke="{GREEN}" stroke-width="2"/>' + txt(ch.X(k) - 8, Y(rs[k]) - 8, T("rsnh", lang), GREEN, 11, "end", True))
    return frame(ch.svg() + s)


def d_rs_rating(lang):
    s = [txt(W / 2, 40, "RS Rating", NAVY, 16, "middle", True)]
    x0, x1, y = 40, W - 40, 120
    for k in range(98):
        col = f"hsl({int(340 - k * 1.2)},60%,{70 - k * .2:.0f}%)"
        s.append(f'<rect x="{x0 + k * (x1 - x0) / 98:.1f}" y="{y}" width="{(x1 - x0) / 98 + .5:.1f}" height="34" fill="{col}"/>')
    s.append(f'<rect x="{x0 + 79 * (x1 - x0) / 98:.1f}" y="{y - 8}" width="{19 * (x1 - x0) / 98:.1f}" height="50" fill="none" stroke="{GREEN}" stroke-width="2.5"/>')
    s.append(txt(x0 + 88 * (x1 - x0) / 98, y - 14, T("leaders_zone", lang), GREEN, 13, "middle", True))
    for v in (1, 25, 50, 75, 99):
        xx = x0 + (v - 1) * (x1 - x0) / 98
        s.append(txt(xx, y + 54, str(v), INK, 13, "middle", True, MONO))
    s.append(txt(x0, y + 80, T("weak", lang), DOWN, 12, "start", True) + txt(x1, y + 80, T("strong", lang), UP, 12, "end", True))
    s.append(txt(W / 2, 260, "40% × 3M + 20% × 6M + 20% × 9M + 20% × 12M", INK2, 13, "middle", False, MONO))
    return frame("".join(s))


def _pattern(lang, keys, n, seed, vol, piv, piv_from, notes, zone=True, ma=True, extra_fn=None):
    d, ch = _base_chart(keys, n, seed, vol, lang)
    ch.price()
    if ma:
        ch.ma(50, RED)
    if piv:
        ch.hline(piv, T("pivot", lang), GREEN, x1=piv_from, x2=n - 1)
        if zone:
            ch.zone(piv, piv * 1.05, "", x1=piv_from, x2=n - 1)
    for i, p, k, col, dy in notes:
        ch.note(i, p, T(k, lang) if k in L else k, col, dy)
    if extra_fn:
        extra_fn(ch, d)
    return frame(ch.svg() + volume(ch, H - 62, 50, lang=lang))


def d_cup_handle(lang):
    def ext(ch, d):
        ch.seg(28, 80.5, 28, 58, INK2, 1, "2 3")
        ch.parts.append(txt(ch.X(28) - 4, ch.Y(68), T("depth", lang) + " 15–33%", INK2, 10, "end", True))
    return _pattern(lang, [(0, 52), (.22, 80), (.32, 70), (.45, 60), (.55, 61), (.7, 76), (.78, 78.6), (.85, 74), (.9, 75), (.93, 79.5), (1, 84)], 140, 41,
                    [(0, 1.2), (.22, 1), (.4, .8), (.6, .9), (.78, .5), (.92, 2.6), (.95, 1.5)], 79.2, 100,
                    [(10, 60, "prior", UP, -18), (60, 59, "cup", INK2, 26), (115, 73.5, "handle", AMBER, 24), (131, 82, "breakout", GREEN, -26)], extra_fn=ext)


def d_cup(lang):
    return _pattern(lang, [(0, 55), (.22, 80), (.35, 68), (.5, 60), (.65, 66), (.85, 79), (.9, 80.6), (1, 86)], 140, 42,
                    [(0, 1.2), (.22, 1), (.45, .8), (.85, .9), (.89, 2.4), (.93, 1.3)], 80.3, 30,
                    [(31, 81.5, "left", INK2, -18), (70, 59, "cup", INK2, 26), (126, 84, "breakout", GREEN, -24)])


def d_flat_base(lang):
    return _pattern(lang, [(0, 50), (.35, 72), (.42, 68), (.52, 71.5), (.62, 66), (.72, 70.5), (.8, 67.5), (.88, 71), (.9, 72.6), (1, 77)], 140, 43,
                    [(0, 1.2), (.35, .8), (.6, .6), (.88, 2.3), (.92, 1.3)], 72.4, 48,
                    [(12, 56, "prior", UP, -18), (85, 65.6, "flat", INK2, 26), (128, 75.5, "breakout", GREEN, -24)])


def d_double_bottom(lang):
    return _pattern(lang, [(0, 58), (.2, 80), (.35, 64), (.48, 73), (.62, 61.5), (.78, 74), (.85, 73), (.88, 74.8), (1, 80)], 140, 44,
                    [(0, 1.1), (.2, 1), (.6, 1.4), (.66, .8), (.86, 2.4), (.9, 1.2)], 73.4, 66,
                    [(49, 63.5, "W", INK2, 26), (87, 61, "undercut", DOWN, 26), (67, 74.5, "middle", GREEN, -20)])


def d_ascending_base(lang):
    return _pattern(lang, [(0, 50), (.15, 62), (.24, 54), (.36, 66), (.45, 58), (.58, 71), (.67, 62), (.8, 74.5), (.86, 75.3), (1, 82)], 140, 45,
                    [(0, 1), (.85, 2.3), (.9, 1.2)], 75.1, 80,
                    [(34, 53.5, "p1", DOWN, 26), (63, 57.5, "p2", DOWN, 26), (94, 61.5, "p3", DOWN, 26)], zone=False)


def d_htf(lang):
    return _pattern(lang, [(0, 20), (.15, 21), (.45, 46), (.55, 40), (.65, 42), (.72, 39.5), (.8, 44), (.84, 46.5), (1, 56)], 120, 46,
                    [(0, .8), (.15, 2), (.45, 1), (.55, .6), (.83, 2.4), (.88, 1.4)], 46.3, 54,
                    [(30, 30, "pole", UP, -24), (78, 38.6, "flag", AMBER, 24)], ma=False)


def d_base_on_base(lang):
    return _pattern(lang, [(0, 40), (.15, 55), (.25, 49), (.35, 54.5), (.4, 56.6), (.47, 61), (.55, 57), (.65, 60.5), (.72, 58), (.82, 61.5), (.86, 62.4), (1, 68)], 150, 47,
                    [(0, 1), (.38, 1.8), (.42, 1), (.84, 2.2), (.88, 1.2)], 61.9, 70,
                    [(30, 47.5, "base1", INK2, 26), (95, 56, "base2", INK2, 26)])


def d_ipo_base(lang):
    def ext(ch, d):
        ch.vmark(0, T("ipo", lang))
    return _pattern(lang, [(0, 30), (.15, 38), (.3, 33), (.42, 36.5), (.48, 37.8), (1, 50)], 70, 48,
                    [(0, 3), (.1, 1.5), (.3, .8), (.47, 2.4), (.53, 1.3)], 38.2, 12,
                    [(24, 32, "ipobase", INK2, 26)], ma=False, extra_fn=ext)


def d_pivot_zone(lang):
    d, ch = _base_chart([(0, 60), (.2, 72), (.45, 63), (.7, 71), (.8, 69.5), (.86, 71.8), (.9, 74.5), (1, 76)], 120, 49, [(0, 1), (.86, 2.4), (.9, 1.3)], lang)
    ch.price().zone(72.2, 75.8, T("buyzone", lang), x1=60, x2=119).hline(72.2, T("pivot", lang), GREEN, x1=20, x2=119)
    ch.hline(72.2 * .92, T("stop", lang), DOWN, x1=90, x2=119, dash="3 3")
    return frame(ch.svg() + volume(ch, H - 62, 50, lang=lang))


def d_extended(lang):
    d, ch = _base_chart([(0, 60), (.25, 70), (.5, 64), (.68, 70.5), (.72, 72), (.85, 82), (1, 90)], 120, 50, [(0, 1), (.7, 2.2), (.74, 1.3)], lang)
    ch.price().zone(70.6, 74.1, "", x1=80, x2=119).hline(70.6, T("pivot", lang), GREEN, x1=20, x2=119)
    ch.note(112, 88, T("extended", lang), DOWN, 30).note(112, 92.5, T("dontchase", lang), DOWN, -12, arrow=False)
    return frame(ch.svg() + volume(ch, H - 62, 50, lang=lang))


def d_base_count(lang):
    d = series([(0, 20), (.1, 30), (.16, 26), (.24, 26.5), (.28, 34), (.36, 46), (.42, 41), (.48, 42), (.53, 52), (.62, 66), (.68, 59), (.73, 60), (.78, 74), (.86, 84), (.9, 75), (.95, 77), (1, 70)], 200, 51, 0.01)
    ch = Chart(d, h=H - 40, y=14, style="line").price()
    for i, k, col in ((40, "b1", GREEN), (88, "b2", GREEN), (136, "b3", AMBER), (182, "b4", DOWN)):
        ch.note(i, d[i][2] * .97, T(k, lang), col, 24)
    ch.parts.append(txt(20, 30, T("works", lang) + ": 1–2", GREEN, 12, "start", True) + txt(20, 46, T("fails", lang) + ": 3–4", DOWN, 12, "start", True))
    return frame(ch.svg())


def d_failed_breakout(lang):
    d, ch = _base_chart([(0, 60), (.2, 72), (.45, 63), (.68, 71), (.74, 69), (.8, 72.3), (.84, 74.5), (.9, 70), (1, 64)], 120, 52, [(0, 1), (.8, 1.2), (.86, 1.6), (.9, 2.2)], lang)
    ch.price().hline(72.2, T("pivot", lang), GREEN, x1=20, x2=119).hline(72.2 * .925, T("stop", lang), DOWN, x1=95, x2=119, dash="3 3")
    ch.note(99, 75.5, T("breakout", lang), GREEN, -16).note(110, 68.5, T("failed", lang), DOWN, 28)
    return frame(ch.svg() + volume(ch, H - 62, 50, lang=lang))


def _bars(vals, labels, colors, y0=50, h=180, title="", unit="%", lang="en", line=None, line_col=AMBER, line_label=""):
    n = len(vals); x0, x1 = 60, W - 40; bw = (x1 - x0) / n * 0.6; mx = max(vals + (line or [0])) * 1.15
    s = [txt(W / 2, 26, title, NAVY, 14, "middle", True), f'<path d="M{x0} {y0 + h}H{x1}" stroke="{INK}"/>']
    for i, v in enumerate(vals):
        x = x0 + (i + .5) * (x1 - x0) / n
        bh = v / mx * h
        s.append(f'<rect x="{x - bw/2:.1f}" y="{y0 + h - bh:.1f}" width="{bw:.1f}" height="{bh:.1f}" fill="{colors[i]}"/>')
        s.append(txt(x, y0 + h - bh - 6, f"{v:+.0f}{unit}" if unit == "%" else f"{v:.0f}", INK, 12, "middle", True, MONO))
        s.append(txt(x, y0 + h + 18, labels[i], INK2, 12, "middle", True))
    if line:
        pts = " ".join(f"{x0 + (i + .5) * (x1 - x0) / n:.1f},{y0 + h - v / mx * h:.1f}" for i, v in enumerate(line))
        s.append(f'<polyline points="{pts}" fill="none" stroke="{line_col}" stroke-width="2.5"/>' + txt(x0 + 4, y0 + h - line[0] / mx * h - 34, line_label, line_col, 12, "start", True))
    return "".join(s)


def d_eps_growth(lang):
    q = T("q", lang)
    body = _bars([8, 14, 22, 31, 48, 70], [f"{q}1", f"{q}2", f"{q}3", f"{q}4", f"{q}1", f"{q}2"], [GRID, GRID, "#9fb0d8", "#6f88c9", UP, UP], title=T("epsg", lang), lang=lang)
    body += txt(W - 50, 262, "↗ " + T("accel", lang), GREEN, 13, "end", True)
    return frame(body)


def d_sales_margins(lang):
    q = T("q", lang)
    return frame(_bars([12, 18, 24, 29, 35], [f"{q}1", f"{q}2", f"{q}3", f"{q}4", f"{q}1"], ["#9fb0d8", "#9fb0d8", "#6f88c9", UP, UP], title=T("sales", lang), lang=lang,
                       line=[14, 16, 19, 22, 25], line_label=T("margin", lang)))


def d_earnings_gap(lang):
    d, ch = std([(0, 60), (.55, 66), (.6, 66.5), (.62, 76), (1, 84)], lang, 100, 53, 0.009, [(0, 1), (.615, 4), (.64, 1.6), (.7, 1.1)])
    ch.price().ma(50, RED).vmark(61, T("earn", lang))
    ch.note(62, 77.5, T("gapup", lang), GREEN, -22)
    return finish(ch, lang)


def d_ownership(lang):
    return frame(_bars([310, 340, 395, 450, 530, 610], ["2021", "2022", "2023", "2024", "2025", "2026"], ["#9fb0d8", "#9fb0d8", "#6f88c9", "#6f88c9", UP, UP], title=T("funds", lang), unit="", lang=lang))


def d_market_cycle(lang):
    d, ch = std([(0, 100), (.12, 104), (.32, 86), (.36, 85), (.4, 88), (.43, 87), (.47, 91), (.75, 106), (.85, 108), (.92, 104), (1, 101)], lang, 160, 54, 0.008,
                [(0, 1), (.46, 1.6), (.49, 1), (.85, 1.4)], style="line")
    ch.price()
    for x1, x2, k, col in ((20, 58, "correction", DOWN), (58, 75, "rally", AMBER), (75, 135, "confirmed", GREEN), (135, 159, "pressure", AMBER)):
        ch.parts.append(f'<rect x="{ch.X(x1):.1f}" y="{ch.y}" width="{ch.X(x2) - ch.X(x1):.1f}" height="{ch.h}" fill="{col}" opacity=".07"/>' + txt((ch.X(x1) + ch.X(x2)) / 2, ch.y + 12, T(k, lang), col, 10, "middle", True))
    ch.note(75, d[75][3] * 1.005, T("ftd", lang), GREEN, -30)
    return finish(ch, lang)


def d_distribution_days(lang):
    d, ch = std([(0, 100), (.5, 108), (.7, 109), (.85, 106), (1, 103)], lang, 120, 55, 0.007, [(0, 1)])
    dd = [70, 78, 84, 91, 97, 104]
    d2 = [(o, h, l, c, v) for o, h, l, c, v in d]
    for i in dd:
        o, h, l, c, v = d2[i]
        d2[i] = (max(o, c) * 1.002, h, l, min(o, c) * .996, 2.2)
    ch = Chart(d2, h=H - 80)
    ch.price()
    for i in dd:
        ch.note(i, d2[i][2] * .995, T("dday", lang), DOWN, 16, arrow=False, size=12)
    ch.parts.append(txt(20, 22, T("ddays", lang), DOWN, 13, "start", True))
    return finish(ch, lang)


def d_ftd(lang):
    d, ch = std([(0, 100), (.4, 86), (.44, 85), (.48, 87.5), (.52, 87), (.56, 89), (.6, 92.5), (1, 99)], lang, 100, 56, 0.008, [(0, 1.2), (.4, 1), (.59, 1.9), (.62, 1.1)])
    ch.price()
    ch.note(44, 84.5, T("day1", lang), INK2, 24).note(60, 93, T("day4", lang), GREEN, -24)
    return finish(ch, lang)


def d_breadth(lang):
    a = series([(0, 100), (.4, 106), (.7, 112), (1, 116)], 120, 57, 0.006)
    ch = Chart(a, h=120, y=30, style="line").price()
    b = [70 - 30 * max(0, (i - 40) / 80) + 6 * math.sin(i / 7) for i in range(120)]
    s = _osc_panel(ch, b, 174, 100, 0, 100, GREEN, ((50, "50%", INK2),))
    return frame(txt(20, 22, T("index", lang), NAVY, 12, "start", True) + ch.svg() + txt(20, 168, T("pct50", lang), GREEN, 12, "start", True) + s
                 + txt(ch.X(100), 140, T("diverge", lang), DOWN, 11, "middle", True))


def d_fed_odds(lang):
    vals = [(T("cut", lang) + " −25", 68, GREEN), (T("hold", lang), 30, NAVY), (T("hike", lang) + " +25", 2, DOWN)]
    s = [txt(W / 2, 30, T("nextfomc", lang), NAVY, 15, "middle", True)]
    for k, (lab, v, col) in enumerate(vals):
        y = 70 + k * 64
        s.append(txt(150, y + 26, lab, INK, 14, "end", True))
        s.append(f'<rect x="165" y="{y + 6}" width="{v * 4:.0f}" height="34" fill="{col}" opacity=".85"/>' + txt(172 + v * 4, y + 30, f"{v}%", INK, 15, "start", True, MONO))
    return frame("".join(s))


def d_econ_calendar(lang):
    days = ["mon", "tue", "wed", "thu", "fri"]
    ev = {0: [("10:00", "ISM", 2)], 1: [("8:30", "CPI", 3)], 2: [("2:00", "FOMC", 3)], 3: [("8:30", "Claims", 2), ("8:30", "Retail sales", 2)], 4: [("8:30", "Payrolls", 3)]}
    s, cw = [], (W - 40) / 5
    for i, k in enumerate(days):
        x = 20 + i * cw
        s.append(f'<rect x="{x + 2}" y="20" width="{cw - 4}" height="250" fill="#fafafa" stroke="{GRID}"/>' + txt(x + cw / 2, 40, T(k, lang), NAVY, 14, "middle", True))
        for j, (t, n, imp) in enumerate(ev.get(i, [])):
            y = 60 + j * 62
            col = DOWN if imp == 3 else AMBER
            s.append(f'<rect x="{x + 8}" y="{y}" width="{cw - 16}" height="52" fill="#fff" stroke="{col}" stroke-width="{2 if imp == 3 else 1}"/>'
                     + txt(x + 14, y + 18, t + " ET", INK2, 11, "start", True, MONO) + txt(x + 14, y + 38, n, INK, 13, "start", True))
    s.append(f'<rect x="24" y="276" width="12" height="12" fill="#fff" stroke="{DOWN}" stroke-width="2"/>' + txt(42, 286, T("hiimp", lang), DOWN, 11, "start", True))
    return frame("".join(s), 300)


def d_position_size(lang):
    rows = [(T("acct", lang), "$100,000"), (T("risk", lang), "$1,000"), (T("entry", lang), "$50.00"), ("Stop", "$46.00"), (T("pershare", lang), "$4.00"),
            (T("shares", lang), "$1,000 ÷ $4 = 250"), (T("position", lang), "250 × $50 = $12,500")]
    s = [f'<rect x="80" y="18" width="480" height="264" fill="#f4f6fb" stroke="{NAVY}"/>']
    for i, (a, b) in enumerate(rows):
        y = 50 + i * 34
        hl = i >= 5
        s.append(txt(110, y, a, NAVY if hl else INK2, 15, "start", True) + txt(530, y, b, NAVY if hl else INK, 15, "end", True, MONO))
        if i in (1, 4):
            s.append(f'<path d="M100 {y + 12}H540" stroke="{GRID}"/>')
    return frame("".join(s))


def d_stop_loss(lang):
    d, ch = std([(0, 60), (.3, 66), (.45, 64), (.5, 67), (.62, 65), (.75, 61), (1, 55)], lang, 100, 58, 0.009, vol_panel=False)
    ch.price().hline(66.5, T("entry", lang), NAVY, side="left").hline(66.5 * .925, T("stop", lang), DOWN, side="left")
    i = next((k for k in range(50, 100) if d[k][3] < 66.5 * .925), 80)
    ch.note(i, d[i][3] * .985, "−7.5%", DOWN, 24)
    return finish(ch, lang, vol_panel=False)


def d_profit_taking(lang):
    d, ch = std([(0, 50), (.15, 51), (.5, 60), (.65, 63), (.8, 60), (1, 57)], lang, 120, 59, 0.009, vol_panel=False)
    ch.price().ma(50, RED).hline(51, T("entry", lang), NAVY, side="left").zone(51 * 1.2, 51 * 1.25, T("sellpart", lang), tcolor=GREEN, color="rgba(60,138,58,.12)")
    ch.hline(51 * .925, T("loss8", lang), DOWN, side="left", dash="3 3")
    ch.parts.append(txt(W - 76, 60, T("ratio", lang), INK2, 11, "end", True))
    return finish(ch, lang, vol_panel=False)


def d_exposure(lang):
    rows = [(T("exp_up", lang), 100, GREEN, "80–100%"), (T("exp_pr", lang), 50, AMBER, "25–50%"), (T("exp_co", lang), 8, DOWN, "0–20%")]
    s = [txt(W / 2, 30, T("invested", lang), NAVY, 15, "middle", True)]
    for k, (lab, v, col, t) in enumerate(rows):
        y = 64 + k * 70
        s.append(txt(200, y + 28, lab, INK, 14, "end", True))
        s.append(f'<rect x="215" y="{y + 8}" width="300" height="34" fill="#f2f2f2"/><rect x="215" y="{y + 8}" width="{v * 3.0:.0f}" height="34" fill="{col}" opacity=".85"/>' + txt(585, y + 31, t, INK, 13, "end", True, MONO))
    return frame("".join(s))


def d_order_types(lang):
    d, ch = std([(0, 50), (.3, 54), (.5, 52), (.7, 55.5), (1, 56)], lang, 80, 60, 0.008, vol_panel=False)
    ch.w = W - 260
    ch.price()
    last = d[-1][3]
    s = ch.svg()
    for p, k, col in ((57.5, "buystop", GREEN), (last, "market", NAVY), (53, "limit", UP), (49, "stoporder", DOWN)):
        y = ch.Y(p)
        s += f'<path d="M{ch.x} {y:.1f}H{ch.x + ch.w + 10}" stroke="{col}" stroke-dasharray="5 4" stroke-width="1.4"/><circle cx="{ch.x + ch.w + 10}" cy="{y:.1f}" r="3.5" fill="{col}"/>'
        s += f'<foreignObject x="{ch.x + ch.w + 18}" y="{y - 16:.1f}" width="232" height="34"><div xmlns="http://www.w3.org/1999/xhtml" style="font:700 11px/1.25 {FONT};color:{col}">{E(T(k, lang))}</div></foreignObject>'
    return frame(s)


def d_market_hours(lang):
    x0, x1, y = 40, W - 40, 120
    hrs = [(4, 9.5, "pre", "#9fb0d8"), (9.5, 16, "regular", NAVY), (16, 20, "after", "#9fb0d8")]
    X = lambda h: x0 + (h - 4) / 16 * (x1 - x0)
    s = [txt(W / 2, 40, T("et", lang), INK2, 13, "middle", True)]
    for a, b, k, col in hrs:
        s.append(f'<rect x="{X(a):.1f}" y="{y}" width="{X(b) - X(a):.1f}" height="44" fill="{col}"/>' + txt((X(a) + X(b)) / 2, y + 27, T(k, lang), "#fff", 13, "middle", True, halo=False))
    for h, lab in ((4, "4:00"), (9.5, "9:30"), (16, "4:00 pm"), (20, "8:00 pm")):
        s.append(f'<path d="M{X(h):.1f} {y + 44}v10" stroke="{INK}"/>' + txt(X(h), y + 70, lab, INK, 12, "middle", True, MONO))
    s.append(txt(X(7), y - 16, "↓ " + T("earnings_out", lang), AMBER, 11, "middle", True) + txt(X(17.5), y - 16, "↓ " + T("earnings_out", lang), AMBER, 11, "middle", True))
    return frame("".join(s), 230)


def d_stock_etf_index(lang):
    s = []
    for k, (a, b, col) in enumerate((("stock", "stock_d", UP), ("etf", "etf_d", GREEN), ("idx", "idx_d", NAVY))):
        x = 30 + k * 200
        s.append(f'<rect x="{x}" y="40" width="180" height="170" fill="#fff" stroke="{col}" stroke-width="2"/>' + txt(x + 90, 76, T(a, lang), col, 18, "middle", True))
        s.append(f'<foreignObject x="{x + 12}" y="96" width="156" height="100"><div xmlns="http://www.w3.org/1999/xhtml" style="font:14px/1.35 {FONT};color:{INK};text-align:center">{E(T(b, lang))}</div></foreignObject>')
    s.append(txt(120, 236, "AAPL · NVDA", INK2, 12, "middle", True, MONO) + txt(320, 236, "SPY · QQQ · XLK", INK2, 12, "middle", True, MONO) + txt(520, 236, "S&P 500 · Nasdaq", INK2, 12, "middle", True, MONO))
    return frame("".join(s), 260)


def d_routine(lang):
    steps = [("before", "r1", NAVY), ("during", "r2", UP), ("afterc", "r3", GREEN), ("weekend", "r4", AMBER)]
    s = [f'<path d="M50 150H{W - 50}" stroke="{GRID}" stroke-width="3"/>']
    for k, (a, b, col) in enumerate(steps):
        x = 90 + k * 153
        s.append(f'<circle cx="{x}" cy="150" r="14" fill="{col}"/>' + txt(x, 155, str(k + 1), "#fff", 13, "middle", True, halo=False))
        s.append(txt(x, 118, T(a, lang), col, 13, "middle", True))
        s.append(f'<foreignObject x="{x - 70}" y="176" width="140" height="80"><div xmlns="http://www.w3.org/1999/xhtml" style="font:13px/1.35 {FONT};color:{INK};text-align:center">{E(T(b, lang))}</div></foreignObject>')
    return frame("".join(s), 280)


DIAGRAMS = {
    "candle-anatomy": d_candle_anatomy, "bars-vs-candles": d_bars_vs_candles, "daily-weekly": d_daily_weekly, "log-linear": d_log_linear,
    "chart-anatomy": d_chart_anatomy, "uptrend": d_uptrend, "downtrend": d_downtrend, "sideways": d_sideways, "stages": d_stages, "trendline": d_trendline,
    "support-resistance": d_support_resistance, "role-reversal": d_role_reversal, "gaps": d_gaps, "volume-breakout": d_volume_breakout,
    "volume-dryup": d_volume_dryup, "accum-dist": d_accum_dist, "ma-basics": d_ma_basics, "ma-support": d_ma_support, "ma-break": d_ma_break,
    "ma-200": d_ma_200, "rsi": d_rsi, "macd": d_macd, "bollinger": d_bollinger, "vwap": d_vwap, "atr": d_atr, "rs-line": d_rs_line,
    "rs-rating": d_rs_rating, "cup-handle": d_cup_handle, "cup": d_cup, "flat-base": d_flat_base, "double-bottom": d_double_bottom,
    "ascending-base": d_ascending_base, "htf": d_htf, "base-on-base": d_base_on_base, "ipo-base": d_ipo_base, "pivot-zone": d_pivot_zone,
    "extended": d_extended, "base-count": d_base_count, "failed-breakout": d_failed_breakout, "eps-growth": d_eps_growth,
    "sales-margins": d_sales_margins, "earnings-gap": d_earnings_gap, "ownership": d_ownership, "market-cycle": d_market_cycle,
    "distribution-days": d_distribution_days, "ftd": d_ftd, "breadth": d_breadth, "fed-odds": d_fed_odds, "econ-calendar": d_econ_calendar,
    "position-size": d_position_size, "stop-loss": d_stop_loss, "profit-taking": d_profit_taking, "exposure": d_exposure,
    "order-types": d_order_types, "market-hours": d_market_hours, "stock-etf-index": d_stock_etf_index, "routine": d_routine,
}


def diagram(name: str, lang: str = "en") -> str:
    f = DIAGRAMS.get(name)
    return f(lang) if f else ""

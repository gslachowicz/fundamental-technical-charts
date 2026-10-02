// Ticker&Tape API — accounts + per-user watchlists, settings and drawings.
import ADMIN_HTML from "./admin.html";   // the private control panel at /admin (bundled as text, see wrangler.toml)
// Cloudflare Worker with a D1 database bound as DB. Served at https://api.tickerandtape.com
const ORIGINS = ["https://tickerandtape.com", "https://www.tickerandtape.com", "http://localhost:8000", "http://127.0.0.1:8000"];
const SESSION_DAYS = 90;
const PBKDF2_ITER = 100000;
const MAX_VALUE = 64 * 1024;
const KEY_RE = /^(watchlist|lists|notes|cfg|marks:[A-Z0-9.\-^=]{1,15})$/;
const SYM_RE = /^[A-Z0-9.\-^=]{1,15}$/;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

const enc = new TextEncoder();
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
const unhex = s => new Uint8Array(s.match(/../g).map(h => parseInt(h, 16)));
const now = () => Math.floor(Date.now() / 1000);

async function hashPassword(password, saltHex) {
  const salt = saltHex ? unhex(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITER }, key, 256);
  return { hash: hex(bits), salt: hex(salt) };
}
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
const sha256 = async s => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));

function cors(req) {
  const o = req.headers.get("Origin");
  const h = { "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS", "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Admin-Key",
    "Access-Control-Max-Age": "86400", "Vary": "Origin" };
  if (o && ORIGINS.includes(o)) h["Access-Control-Allow-Origin"] = o;
  return h;
}
const json = (req, data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors(req), ...extra } });
const fail = (req, msg, status = 400) => json(req, { error: msg }, status);

async function body(req) { try { return await req.json(); } catch { return {}; } }

async function newSession(env, userId) {
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  await env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires) VALUES (?, ?, ?)")
    .bind(await sha256(token), userId, now() + SESSION_DAYS * 86400).run();
  return token;
}
async function currentUser(req, env) {
  const m = (req.headers.get("Authorization") || "").match(/^Bearer ([0-9a-f]{64})$/);
  if (!m) return null;
  const u = await env.DB.prepare("SELECT u.id, u.email, u.verified, u.verify_sent, u.last_seen FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires > ?")
    .bind(await sha256(m[1]), now()).first();
  // daily activity for the admin dashboard (one write per user per day)
  if (u && (u.last_seen || 0) < now() - (now() % 86400)) {
    try { await env.DB.batch([env.DB.prepare("UPDATE users SET last_seen = ? WHERE id = ?").bind(now(), u.id),
      env.DB.prepare("INSERT OR IGNORE INTO user_active (day, user_id) VALUES (?, ?)").bind(new Date().toISOString().slice(0, 10), u.id)]); } catch {}
  }
  return u;
}
const cleanEmail = e => String(e || "").trim().toLowerCase();

/* ================= EMAIL VERIFICATION ================= */
async function sendVerify(env, userId, email) {
  const token = hex(crypto.getRandomValues(new Uint8Array(24)));
  await env.DB.prepare("UPDATE users SET verify_token = ? WHERE id = ?").bind(await sha256(token), userId).run();
  const link = `${API_BASE}/verify?t=${token}`;
  await sendEmails(env, [{ from: FROM, to: [email], reply_to: REPLY_TO, subject: "Confirm your Ticker&Tape email",
    html: `<div style="font:16px/1.5 Arial,sans-serif;color:#15171c;max-width:520px"><h2 style="color:#1f3c6e">Welcome to Ticker&amp;Tape</h2>
<p>Confirm this address so your price alerts can reach you by email.</p>
<p><a href="${link}" style="display:inline-block;background:#1f3c6e;color:#fff;padding:10px 16px;text-decoration:none;font-weight:700">Confirm my email</a></p>
<p style="color:#5a5d66;font-size:13px">If you did not create an account, ignore this email.</p></div>`,
    text: `Confirm your Ticker&Tape email: ${link}` }]);
  await env.DB.prepare("UPDATE users SET verify_sent = ? WHERE id = ?").bind(now(), userId).run();   // only once the email went out
}

/* ================= ALERTS =================
   Tables "alerts" and "notifications" (schema.sql). A Cron Trigger every 15 minutes in US market hours runs checkAlerts:
   it reads the delayed intraday prices (live.json) and the nightly reference levels (alertref.json), fires every alert
   whose condition is met (once: a fired alert stays in the history), leaves a notification on the site and emails it
   to verified users. */
const LIVE_JSON = "https://raw.githubusercontent.com/gslachowicz/fundamental-technical-charts/live/live.json";
const ALERT_MAX = 50;                 // active alerts per user
const EMAIL_USER_DAY = 25;            // alert emails per user per day
const EMAIL_ALL_DAY = 80;             // all alert emails per day (Resend free plan: 100/day, the rest is for the weekly and resets)
const MA_IDX = { e21: 0, d50: 1, d200: 2 };
const MA_NAME = { en: { e21: "21-day EMA", d50: "50-day line", d200: "200-day line" },
  es: { e21: "EMA de 21 días", d50: "media de 50 días", d200: "media de 200 días" }, pt: { e21: "MME de 21 dias", d50: "média de 50 dias", d200: "média de 200 dias" } };
function etClock(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, min: (+p.hour % 24) * 60 + +p.minute };
}
function alertText(a, lang) {
  const L = lang === "es" || lang === "pt" ? lang : "en", lv = px(a.fired_level ?? a.level), last = px(a.fired_px);
  const up = a.dir === "above";
  if (a.kind === "ma") return { en: `${a.symbol} crossed ${up ? "above" : "below"} its ${MA_NAME.en[a.ma]} (${lv}) · last ${last}`,
    es: `${a.symbol} cruzó ${up ? "por encima de" : "por debajo de"} su ${MA_NAME.es[a.ma]} (${lv}) · último ${last}`,
    pt: `${a.symbol} cruzou ${up ? "acima da" : "abaixo da"} sua ${MA_NAME.pt[a.ma]} (${lv}) · último ${last}` }[L];
  if (a.kind === "pivot") return { en: `${a.symbol} broke out above its ${lv} pivot · last ${last}`,
    es: `${a.symbol} rompió sobre su pivot de ${lv} · último ${last}`, pt: `${a.symbol} rompeu acima do pivô de ${lv} · último ${last}` }[L];
  return { en: `${a.symbol} ${up ? "rose above" : "fell below"} ${lv} · last ${last}`,
    es: `${a.symbol} ${up ? "subió por encima de" : "bajó por debajo de"} ${lv} · último ${last}`,
    pt: `${a.symbol} ${up ? "subiu acima de" : "caiu abaixo de"} ${lv} · último ${last}` }[L];
}
function alertEmail(to, lang, fired) {
  const L = lang === "es" || lang === "pt" ? lang : "en";
  const T = { en: ["Alert", "alerts", "triggered", "Prices are delayed about 15 minutes. Each alert fires once; set it again from the chart if you need it.", "Open chart", "Manage your alerts"],
    es: ["Alarma", "alarmas", "activadas", "Los precios tienen unos 15 minutos de demora. Cada alarma suena una sola vez; vuelve a crearla desde el gráfico si la necesitas.", "Abrir gráfico", "Administrar tus alarmas"],
    pt: ["Alerta", "alertas", "disparados", "Os preços têm cerca de 15 minutos de atraso. Cada alerta dispara uma vez; crie de novo no gráfico se precisar.", "Abrir gráfico", "Gerenciar seus alertas"] }[L];
  const subject = fired.length === 1 ? `${T[0]}: ${alertText(fired[0], L)}` : `Ticker&Tape: ${fired.length} ${T[1]} ${T[2]}`;
  const rows = fired.map(a => `<tr><td style="padding:10px 0;border-bottom:1px solid #d9d6cc"><b style="font:800 16px Arial,sans-serif;color:#1f3c6e">${escH(a.symbol)}</b><br>
<span style="font:15px Arial,sans-serif">${escH(alertText(a, L))}</span>${a.note ? `<br><i style="color:#5a5d66;font-size:13px">${escH(a.note)}</i>` : ""}<br>
<a href="${SITE}/#${encodeURIComponent(a.symbol)}" style="font:700 13px Arial,sans-serif;color:#1f3c6e">${T[4]} →</a></td></tr>`).join("");
  return { from: "Ticker&Tape alerts <alerts@tickerandtape.com>", to: [to], reply_to: REPLY_TO, subject,
    html: `<div style="font:16px/1.5 Arial,sans-serif;color:#15171c;max-width:560px"><table style="width:100%;border-collapse:collapse">${rows}</table>
<p style="color:#5a5d66;font-size:12px">${T[3]} <a href="${SITE}/#alerts" style="color:#1f3c6e">${T[5]}</a></p></div>`,
    text: fired.map(a => alertText(a, L) + `  ${SITE}/#${a.symbol}`).join("\n") };
}
async function checkAlerts(env) {
  const { results: active } = await env.DB.prepare(
    "SELECT a.*, u.email AS uemail, u.verified FROM alerts a JOIN users u ON u.id = a.user_id WHERE a.fired IS NULL").all();
  if (!active.length) return { checked: 0, fired: 0 };
  const [live, ref] = await Promise.all([
    fetch(`${LIVE_JSON}?t=${Date.now()}`, { cf: { cacheTtl: 0 } }).then(r => r.ok ? r.json() : null).catch(() => null),
    fetch(`${SITE}/data/alertref.json?t=${Math.floor(Date.now() / 3.6e6)}`).then(r => r.ok ? r.json() : null).catch(() => null)]);
  if (!live || !live.q) return { checked: 0, fired: 0, note: "no live prices" };
  const et = etClock();
  // only fresh prices for today's session (live.json is refreshed every 15 minutes while the market is open)
  if (live.date !== et.date || Date.now() - Date.parse(live.updated) > 50 * 60 * 1000) return { checked: 0, fired: 0, note: "stale prices" };
  const frac = Math.min(1, Math.max(0.08, (et.min - 570) / 390));   // share of the session elapsed, for the volume pace
  const fired = [];
  for (const a of active) {
    const q = live.q[a.symbol]; if (!q) continue;
    const last = q[3], vol = q[4], R = ref && ref.s ? ref.s[a.symbol] : null;
    let level = a.level;
    if (a.kind === "ma") { level = R ? R[MA_IDX[a.ma]] : null; if (level == null) continue; }
    if (level == null || !isFinite(last)) continue;
    let hit = a.dir === "above" ? last >= level : last <= level;
    if (hit && a.kind === "pivot" && R && R[4]) hit = vol / frac >= 1.4 * R[4];   // breakout needs volume running 40%+ above average
    if (hit) fired.push({ ...a, fired_px: last, fired_level: level });
  }
  if (!fired.length) return { checked: active.length, fired: 0 };
  const t = now(), dayStart = t - (t % 86400);
  const sent = await env.DB.prepare("SELECT COUNT(*) AS n FROM notifications WHERE emailed = 1 AND created >= ?").bind(dayStart).first();
  let budget = EMAIL_ALL_DAY - ((sent && sent.n) || 0);
  const byUser = new Map();
  const stmts = [];
  for (const a of fired) {
    stmts.push(env.DB.prepare("UPDATE alerts SET fired = ?, fired_px = ?, fired_level = ? WHERE id = ? AND fired IS NULL").bind(t, a.fired_px, a.fired_level, a.id));
    const msg = JSON.stringify({ k: a.kind, s: a.symbol, d: a.dir, lv: a.fired_level, px: a.fired_px, ma: a.ma || null, n: a.note || null });
    const wantMail = a.email && a.verified;
    if (wantMail) { if (!byUser.has(a.user_id)) byUser.set(a.user_id, { to: a.uemail, list: [] }); byUser.get(a.user_id).list.push(a); }
    a._msg = msg;
  }
  // per-user daily caps and the shared daily budget decide which users get an email this run
  const mailUsers = new Set(), mails = [];
  for (const [uid, u] of byUser) {
    if (budget <= 0) break;
    const c = await env.DB.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND emailed = 1 AND created >= ?").bind(uid, dayStart).first();
    if (((c && c.n) || 0) >= EMAIL_USER_DAY) continue;
    let lang = "en";
    try { const cf = await env.DB.prepare("SELECT value FROM user_data WHERE user_id = ? AND key = 'cfg'").bind(uid).first(); if (cf) lang = JSON.parse(cf.value).lang || "en"; } catch {}
    mails.push(alertEmail(u.to, lang, u.list)); mailUsers.add(uid); budget--;
  }
  for (const a of fired)
    stmts.push(env.DB.prepare("INSERT INTO notifications (user_id, alert_id, symbol, msg, created, read, emailed) VALUES (?, ?, ?, ?, ?, 0, ?)")
      .bind(a.user_id, a.id, a.symbol, a._msg, t, mailUsers.has(a.user_id) ? 1 : 0));
  await env.DB.batch(stmts);
  if (mails.length) { try { await sendEmails(env, mails); } catch (e) { console.log("alert emails failed:", e.message); } }
  return { checked: active.length, fired: fired.length, emailed: mails.length };
}
function validAlert(b) {
  const sym = String(b.symbol || "").toUpperCase();
  if (!SYM_RE.test(sym)) return "Invalid ticker.";
  if (!["price", "ma", "pivot"].includes(b.kind)) return "Unknown alert type.";
  if (!["above", "below"].includes(b.dir)) return "Choose above or below.";
  if (b.kind === "ma" && !MA_IDX.hasOwnProperty(b.ma)) return "Choose a moving average.";
  if (b.kind !== "ma" && !(typeof b.level === "number" && isFinite(b.level) && b.level > 0 && b.level < 1e7)) return "Enter a valid price.";
  if (b.note != null && (typeof b.note !== "string" || b.note.length > 140)) return "Keep the note under 140 characters.";
  return null;
}

/* ================= USAGE STATISTICS (anonymous, no cookies) =================
   The site sends one small beacon per page view: section, ticker, language, screen width and where the visit came from.
   Country comes from Cloudflare. Unique visitors are counted with a daily hash of IP + browser + a secret, which cannot
   be traced back and changes every day; no IP address or identifier is stored. Tables "stats_daily" and "visitors". */
const SECTIONS = new Set(["home", "watchlist", "screener", "etfs", "groups", "heatmap", "breadth", "ideas", "earnings", "wall", "welcome", "chart"]);
const BOT_RE = /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|headless|lighthouse|monitor/i;
async function trackView(req, env) {
  const ua = req.headers.get("User-Agent") || "";
  if (BOT_RE.test(ua)) return;
  let b = {}; try { b = JSON.parse(await req.text()); } catch {}
  const sec = SECTIONS.has(b.p) ? b.p : null; if (!sec) return;
  const day = new Date().toISOString().slice(0, 10);
  const ip = req.headers.get("CF-Connecting-IP") || "";
  const vh = (await sha256(`${day}|${ip}|${ua}|${env.ADMIN_KEY || "tt"}`)).slice(0, 20);
  const r = await env.DB.prepare("INSERT OR IGNORE INTO visitors (day, vh) VALUES (?, ?)").bind(day, vh).run();
  const isNew = r.meta.changes > 0;
  const up = (kind, key) => env.DB.prepare("INSERT INTO stats_daily (day, kind, key, n) VALUES (?, ?, ?, 1) ON CONFLICT(day, kind, key) DO UPDATE SET n = n + 1").bind(day, kind, String(key).slice(0, 60));
  const q = [up("pv", sec)];
  const sym = String(b.s || "").toUpperCase();
  if (sec === "chart" && SYM_RE.test(sym)) q.push(up("sym", sym));
  if (isNew) {
    const w = +b.w || 0;
    q.push(up("country", (req.cf && req.cf.country) || "??"), up("device", w && w < 700 ? "mobile" : w && w < 1100 ? "tablet" : "desktop"),
      up("lang", ["en", "es", "pt"].includes(b.l) ? b.l : "en"), up("ref", String(b.r || "direct").toLowerCase().replace(/^www\./, "").slice(0, 40) || "direct"),
      up("user", b.u ? "signed in" : "guest"));
  }
  await env.DB.batch(q);
}
async function adminStats(env, days) {
  const DB = env.DB, t = now(), since = new Date(Date.now() - days * 86400e3).toISOString().slice(0, 10);
  const one = async (sql, ...a) => (await DB.prepare(sql).bind(...a).first()) || {};
  const all = async (sql, ...a) => (await DB.prepare(sql).bind(...a).all()).results || [];
  const d1 = new Date(Date.now() - 86400e3).toISOString().slice(0, 10), d7 = new Date(Date.now() - 7 * 86400e3).toISOString().slice(0, 10),
    d30 = new Date(Date.now() - 30 * 86400e3).toISOString().slice(0, 10), today = new Date().toISOString().slice(0, 10);
  const [users, signups, active, dau, wau, mau, retained, lists, cfgs, alertsN, alertsByKind, alertSyms, notif, subs, subsByDay,
    traffic, uv, top] = await Promise.all([
    one("SELECT COUNT(*) AS total, SUM(verified) AS verified, SUM(created >= ?) AS new7, SUM(created >= ?) AS new30 FROM users", d7, d30),
    all("SELECT substr(created, 1, 10) AS day, COUNT(*) AS n FROM users WHERE created >= ? GROUP BY day ORDER BY day", since),
    all("SELECT day, COUNT(*) AS n FROM user_active WHERE day >= ? GROUP BY day ORDER BY day", since),
    one("SELECT COUNT(*) AS n FROM user_active WHERE day = ?", today),
    one("SELECT COUNT(DISTINCT user_id) AS n FROM user_active WHERE day > ?", d7),
    one("SELECT COUNT(DISTINCT user_id) AS n FROM user_active WHERE day > ?", d30),
    one("SELECT COUNT(*) AS base, SUM(EXISTS(SELECT 1 FROM user_active a WHERE a.user_id = u.id AND a.day > ?)) AS back FROM users u WHERE created < ?", d7, d7),
    all("SELECT key, value FROM user_data WHERE key IN ('lists', 'watchlist', 'notes')"),
    all("SELECT value FROM user_data WHERE key = 'cfg'"),
    one("SELECT SUM(fired IS NULL) AS active, SUM(fired > ?) AS fired7, SUM(fired > ?) AS fired30, COUNT(DISTINCT CASE WHEN fired IS NULL THEN user_id END) AS users FROM alerts", t - 7 * 86400, t - 30 * 86400),
    all("SELECT kind AS key, COUNT(*) AS n FROM alerts WHERE fired IS NULL GROUP BY kind ORDER BY n DESC"),
    all("SELECT symbol AS key, COUNT(*) AS n FROM alerts WHERE fired IS NULL GROUP BY symbol ORDER BY n DESC LIMIT 10"),
    one("SELECT SUM(emailed = 1 AND created >= ?) AS emailedToday, COUNT(*) AS total FROM notifications", t - (t % 86400)),
    one("SELECT SUM(confirmed = 1 AND unsub = 0) AS active, SUM(confirmed = 0) AS pending, SUM(unsub = 1) AS unsub FROM subscribers"),
    all("SELECT substr(confirmed_at, 1, 10) AS day, COUNT(*) AS n FROM subscribers WHERE confirmed = 1 AND confirmed_at >= ? GROUP BY day ORDER BY day", since),
    all("SELECT day, SUM(n) AS pv FROM stats_daily WHERE kind = 'pv' AND day >= ? GROUP BY day ORDER BY day", since),
    all("SELECT day, COUNT(*) AS uv FROM visitors WHERE day >= ? GROUP BY day ORDER BY day", since),
    all("SELECT kind, key, SUM(n) AS n FROM stats_daily WHERE day >= ? GROUP BY kind, key ORDER BY n DESC", since)]);
  // watchlists and notes: how much people use their accounts
  const wl = new Map(), multi = new Set(), notes = new Map(), tick = new Map();
  for (const r of lists) { try { const v = JSON.parse(r.value);
    if (r.key === "lists") { const L = v.lists || []; if (L.length > 1) multi.add(r); const all_ = L.flatMap(l => l.t || []); wl.set(r, all_.length); all_.forEach(x => tick.set(x, (tick.get(x) || 0) + 1)); }
    if (r.key === "notes") notes.set(r, Object.keys(v || {}).length); } catch {} }
  const sizes = [...wl.values()];
  let screens = 0, lang = {};
  for (const r of cfgs) { try { const c = JSON.parse(r.value); if (Array.isArray(c.screens) && c.screens.length) screens++; const l = c.lang || "en"; lang[l] = (lang[l] || 0) + 1; } catch {} }
  const group = k => top.filter(r => r.kind === k).slice(0, 12).map(r => ({ key: r.key, n: r.n }));
  const sumPv = traffic.reduce((a, r) => a + r.pv, 0), sumUv = uv.reduce((a, r) => a + r.uv, 0);
  let site = null;
  try { const [m, l] = await Promise.all([fetch(`${SITE}/data/meta.json?t=${Date.now()}`).then(r => r.json()), fetch(`${LIVE_JSON}?t=${Date.now()}`).then(r => r.json()).catch(() => null)]);
    site = { updated: m.updated, dataDate: m.dataDate, stocks: m.allStocks, errors: (m.errors || []).length, live: l && l.updated, liveDate: l && l.date }; } catch {}
  return {
    generated: new Date().toISOString(), days,
    users: { total: users.total || 0, verified: users.verified || 0, new7: users.new7 || 0, new30: users.new30 || 0, dau: dau.n || 0, wau: wau.n || 0, mau: mau.n || 0,
      retention7: retained.base ? Math.round(100 * (retained.back || 0) / retained.base) : null, signups, active },
    engagement: { withWatchlist: sizes.filter(x => x > 0).length, avgTickers: sizes.length ? +(sizes.reduce((a, b) => a + b, 0) / sizes.length).toFixed(1) : 0,
      multiList: multi.size, withNotes: [...notes.values()].filter(x => x > 0).length, withScreens: screens, lang,
      topWatched: [...tick.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([key, n]) => ({ key, n })) },
    alerts: { active: alertsN.active || 0, users: alertsN.users || 0, fired7: alertsN.fired7 || 0, fired30: alertsN.fired30 || 0, byKind: alertsByKind, topSymbols: alertSyms,
      emailedToday: notif.emailedToday || 0, emailCap: EMAIL_ALL_DAY },
    newsletter: { active: subs.active || 0, pending: subs.pending || 0, unsub: subs.unsub || 0, byDay: subsByDay },
    traffic: { byDay: traffic.map(r => ({ day: r.day, pv: r.pv, uv: (uv.find(x => x.day === r.day) || {}).uv || 0 })), pv: sumPv, uv: sumUv,
      conversion: sumUv ? +(100 * signups.reduce((a, r) => a + r.n, 0) / sumUv).toFixed(2) : null,
      sections: group("pv"), tickers: group("sym"), countries: group("country"), devices: group("device"), langs: group("lang"), refs: group("ref"), users: group("user") },
    site };
}
function adminPage() {
  return new Response(ADMIN_HTML, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex",
    "Content-Security-Policy": "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'unsafe-inline'; connect-src 'self'" } });
}

/* ================= NEWSLETTER =================
   Needs: D1 table "subscribers" (schema.sql), Worker secret RESEND_API_KEY (resend.com, domain tickerandtape.com verified),
   optional secret ADMIN_KEY (for /newsletter/preview and /newsletter/test), and a Cron Trigger "0 2 * * SAT" (Friday night, after the nightly build). */
const SITE = "https://tickerandtape.com";
const API_BASE = "https://api.tickerandtape.com";
const FROM = "Ticker&Tape <newsletter@tickerandtape.com>";
const REPLY_TO = "contacto@tickerandtape.com";
const escH = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const pct = (v, d = 1) => v == null || !isFinite(v) ? "—" : (v > 0 ? "+" : "") + Number(v).toFixed(d) + "%";
const px = v => v == null ? "—" : v >= 1000 ? Math.round(v).toLocaleString("en-US") : Number(v).toFixed(2);

async function sendEmails(env, messages) {
  // Resend batch API: up to 100 messages per call
  for (let i = 0; i < messages.length; i += 100) {
    const r = await fetch("https://api.resend.com/emails/batch", {
      method: "POST", headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(messages.slice(i, i + 100)),
    });
    if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`);
  }
}
const page = (title, msg) => new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escH(title)}</title>
<body style="margin:0;background:#f3f1ea;font:16px/1.5 Arial,sans-serif;color:#15171c"><div style="max-width:520px;margin:12vh auto;padding:28px;background:#fff;border:1px solid #15171c">
<h1 style="margin:0 0 10px;font:800 24px Arial,sans-serif;color:#1f3c6e">${escH(title)}</h1><p style="margin:0 0 18px">${msg}</p>
<a href="${SITE}" style="display:inline-block;background:#1f3c6e;color:#fff;padding:8px 14px;text-decoration:none;font-weight:700">Go to Ticker&amp;Tape →</a></div></body>`,
  { headers: { "Content-Type": "text/html; charset=utf-8" } });

function confirmEmail(email, token) {
  const link = `${API_BASE}/confirm?t=${token}`;
  return { from: FROM, to: [email], reply_to: REPLY_TO, subject: "Confirm your Ticker&Tape weekly",
    html: `<div style="font:16px/1.5 Arial,sans-serif;color:#15171c;max-width:520px"><h2 style="color:#1f3c6e">One click to confirm</h2>
<p>You asked to get the Ticker&amp;Tape weekly: sectors, commodities, RS leaders and the week's trade ideas, every Friday after the close.</p>
<p><a href="${link}" style="display:inline-block;background:#1f3c6e;color:#fff;padding:10px 16px;text-decoration:none;font-weight:700">Confirm my subscription</a></p>
<p style="color:#5a5d66;font-size:13px">If you did not ask for this, ignore this email and you will not hear from us.</p></div>`,
    text: `Confirm your Ticker&Tape weekly: ${link}` };
}

async function weeklyHtml(unsubLink) {
  const get = async f => { try { const r = await fetch(`${SITE}/data/${f}?t=${Date.now()}`); return r.ok ? await r.json() : null; } catch { return null; } };
  const [meta, home, ideas, earn] = await Promise.all([get("meta.json"), get("home.json"), get("ideas.json"), get("earnings.json")]);
  if (!meta || !home) throw new Error("site data unavailable");
  const date = new Date(meta.dataDate + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const C = { ink: "#15171c", ink2: "#5a5d66", navy: "#1f3c6e", up: "#1d3fc4", down: "#e0337f", rule: "#d9d6cc" };
  const col = v => (v ?? 0) < 0 ? C.down : C.up;
  const h3 = t => `<tr><td style="padding:22px 0 6px;font:700 12px Arial,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:${C.navy};border-bottom:2px solid ${C.ink}">${t}</td></tr>`;
  const table = (head, rows) => `<tr><td><table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font:14px Arial,sans-serif">
<tr>${head.map((h, i) => `<th style="text-align:${i ? "right" : "left"};font:700 11px Arial,sans-serif;color:${C.ink2};text-transform:uppercase;letter-spacing:.06em;padding:6px 4px;border-bottom:1px solid ${C.rule}">${h}</th>`).join("")}</tr>
${rows.map(r => `<tr>${r.map((c, i) => `<td style="text-align:${i ? "right" : "left"};padding:6px 4px;border-bottom:1px dotted ${C.rule}">${c}</td>`).join("")}</tr>`).join("")}</table></td></tr>`;
  const link = (sym, txt) => `<a href="${SITE}/#${encodeURIComponent(sym)}" style="color:${C.navy};font-weight:700;text-decoration:none">${escH(txt || sym)}</a>`;
  const pcell = v => `<span style="color:${col(v)};font-weight:700">${pct(v)}</span>`;

  const pulse = (meta.market || []).map(m => [`<b>${escH(m.name)}</b>`, px(m.close), escH(m.status || ""), `${m.distDays ?? "—"} dist. days`]);
  const sectors = [...(home.sectors || [])].sort((a, b) => (b.w1 ?? -99) - (a.w1 ?? -99))
    .map(r => [`${link(r.symbol)} <span style="color:${C.ink2}">${escH(r.name)}</span>`, pcell(r.w1), pcell(r.m3), pcell(r.ytd)]);
  const comms = [...(home.commodities || [])].sort((a, b) => (b.w1 ?? -99) - (a.w1 ?? -99)).slice(0, 8)
    .map(r => [`<b>${escH(r.name)}</b>`, px(r.close), pcell(r.w1), pcell(r.ytd)]);
  const I = (ideas && ideas.ideas || []).slice(0, 10);
  const ideaRows = I.map(i => [link(i.symbol) + `<br><span style="color:${C.ink2};font-size:12px">${escH(i.status)} · ${escH(i.type || "")}</span>`,
    `<b>${i.rs ?? "—"}</b>`, px(i.pivot), px(i.buyZoneTop), `<span style="color:${C.down}">${px(i.stop)}</span>`]);
  const st = ideas && ideas.stats || {};
  // coming week's reports: leaders (RS >= 80) first, then the biggest companies
  const wk = earn && (earn.weeks || []).find(w => w.start > meta.dataDate);
  let E = [];
  if (wk) {
    const endD = new Date(wk.start + "T12:00:00Z"); endD.setUTCDate(endD.getUTCDate() + 4);
    const inWk = (earn.events || []).filter(e => e.date >= wk.start && e.date <= endD.toISOString().slice(0, 10));
    const leaders = inWk.filter(e => (e.rs || 0) >= 80).sort((a, b) => (b.mcap || 0) - (a.mcap || 0));
    const big = inWk.filter(e => (e.rs || 0) < 80).sort((a, b) => (b.mcap || 0) - (a.mcap || 0));
    E = [...leaders.slice(0, 10), ...big.slice(0, Math.max(0, 14 - Math.min(10, leaders.length)))]
      .sort((a, b) => a.date.localeCompare(b.date) || (a.time === "bmo" ? -1 : 1));
  }
  const day = d => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  const earnRows = E.map(e => [link(e.symbol) + `<br><span style="color:${C.ink2};font-size:12px">${escH(e.name || "")}</span>`,
    `${day(e.date)}<br><span style="color:${C.ink2};font-size:12px">${e.time === "bmo" ? "before open" : e.time === "amc" ? "after close" : "time n/a"}</span>`,
    (e.rs || 0) >= 80 ? `<b style="color:${C.navy}">${e.rs}</b>` : String(e.rs ?? "—"),
    e.epsEst != null ? "$" + Number(e.epsEst).toFixed(2) : "—",
    e.epsEst != null && e.epsLY ? pcell((e.epsEst - e.epsLY) / Math.abs(e.epsLY) * 100) : "—"]);
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f3f1ea"><table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f1ea"><tr><td align="center" style="padding:20px 10px">
<table width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#fff;border:1px solid ${C.ink};padding:0 22px 22px">
<tr><td style="padding:20px 0 10px;border-bottom:3px double ${C.ink}"><a href="${SITE}" style="font:800 26px Arial,sans-serif;color:${C.navy};text-decoration:none">Ticker&amp;Tape</a>
<div style="font:13px Arial,sans-serif;color:${C.ink2}">The weekly · ${date} close</div></td></tr>
${h3("Market pulse")}${table(["Index", "Close", "Trend", "Distribution"], pulse)}
${h3("Sectors · ranked by 1-week change")}${table(["Sector ETF", "1W", "3M", "YTD"], sectors)}
${home.commodities && home.commodities.length ? h3("Commodities · biggest movers") + table(["Futures", "Last", "1W", "YTD"], comms) : ""}
${h3(`Trade ideas · ${I.length} setup${I.length === 1 ? "" : "s"}`)}
${I.length ? table(["Stock", "RS", "Buy point", "Zone to", "Stop"], ideaRows) : `<tr><td style="padding:10px 0;font:14px Arial,sans-serif">No stock passes every filter this week. In weak markets fewer leaders set up.</td></tr>`}
${st.count ? `<tr><td style="padding:10px 0 0;font:13px Arial,sans-serif;color:${C.ink2}">Track record: ${st.count} ideas, ${st.winPct}% in the green, average ${pct(st.avgPct)} (best gain on average ${pct(st.avgMaxPct)}).</td></tr>` : ""}
${E.length ? h3("Next week's earnings · leaders first") + table(["Stock", "Reports", "RS", "EPS est.", "Growth"], earnRows)
  + `<tr><td style="padding:8px 0 0;font:13px Arial,sans-serif"><a href="${SITE}/#earnings" style="color:${C.navy};font-weight:700">Full earnings calendar →</a></td></tr>` : ""}
<tr><td style="padding:22px 0 4px"><a href="${SITE}/#ideas" style="display:inline-block;background:${C.navy};color:#fff;padding:10px 16px;font:700 14px Arial,sans-serif;text-decoration:none">See every chart on Ticker&amp;Tape →</a></td></tr>
<tr><td style="padding:18px 0 0;border-top:1px solid ${C.rule};font:12px/1.5 Arial,sans-serif;color:${C.ink2}">
Ideas come from an automatic scan and are not investment advice or a recommendation to buy or sell. Buy point = pivot, zone = up to 5% above it, stop = 7% under the buy point. Data: Yahoo Finance.<br>
Follow us on X: <a href="https://x.com/Tickerandtape" style="color:${C.navy}">@Tickerandtape</a> · Questions: <a href="mailto:${REPLY_TO}" style="color:${C.navy}">${REPLY_TO}</a><br>
You get this because you subscribed at tickerandtape.com. <a href="${unsubLink}" style="color:${C.navy}">Unsubscribe</a> · <a href="${SITE}/privacy.html" style="color:${C.navy}">Privacy</a><br>
Ticker&amp;Tape · Buenos Aires, Argentina</td></tr>
</table></td></tr></table></body></html>`;
}

async function sendWeekly(env, onlyTo) {
  const { results } = onlyTo
    ? { results: [{ email: onlyTo, token: "preview" }] }
    : await env.DB.prepare("SELECT email, token FROM subscribers WHERE confirmed = 1 AND unsub = 0").all();
  if (!results.length) return 0;
  const meta = await (await fetch(`${SITE}/data/meta.json?t=${Date.now()}`)).json();
  const subject = `Ticker&Tape weekly · ${new Date(meta.dataDate + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric" })}: sectors, commodities and trade ideas`;
  const msgs = [];
  for (const s of results) {
    const unsub = `${API_BASE}/unsubscribe?t=${s.token}`;
    msgs.push({ from: FROM, to: [s.email], reply_to: REPLY_TO, subject, html: await weeklyHtml(unsub),
      headers: { "List-Unsubscribe": `<${unsub}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } });
  }
  await sendEmails(env, msgs);
  return msgs.length;
}

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    try {
      // ---------- public
      if (path === "/" ) return json(req, { ok: true, service: "Ticker&Tape API" });

      // ---------- newsletter (public)
      if (path === "/subscribe" && req.method === "POST") {
        const em = cleanEmail((await body(req)).email);
        if (!EMAIL_RE.test(em)) return fail(req, "Enter a valid email address.");
        const ex = await env.DB.prepare("SELECT confirmed, unsub, token, created FROM subscribers WHERE email = ?").bind(em).first();
        if (ex && ex.confirmed && !ex.unsub) return json(req, { ok: true, already: true });
        // at most one confirmation email every 10 minutes per address
        if (ex && !ex.confirmed && Date.parse(ex.created) > Date.now() - 10 * 60 * 1000) return json(req, { ok: true });
        const token = hex(crypto.getRandomValues(new Uint8Array(24)));
        await env.DB.prepare("INSERT INTO subscribers (email, token, confirmed, unsub, created) VALUES (?, ?, 0, 0, ?) " +
          "ON CONFLICT(email) DO UPDATE SET token = excluded.token, confirmed = 0, unsub = 0, created = excluded.created")
          .bind(em, token, new Date().toISOString()).run();
        await sendEmails(env, [confirmEmail(em, token)]);
        return json(req, { ok: true });
      }
      if (path === "/confirm" && req.method === "GET") {
        const t = url.searchParams.get("t") || "";
        const r = /^[0-9a-f]{48}$/.test(t) && await env.DB.prepare("UPDATE subscribers SET confirmed = 1, confirmed_at = ? WHERE token = ? AND unsub = 0").bind(new Date().toISOString(), t).run();
        return r && r.meta.changes ? page("You're in", "Your subscription is confirmed. The Ticker&amp;Tape weekly arrives every Friday after the close.")
          : page("Link expired", "This confirmation link is no longer valid. Subscribe again from the site to get a new one.");
      }
      if (path === "/unsubscribe" && (req.method === "GET" || req.method === "POST")) {
        const t = url.searchParams.get("t") || "";
        if (/^[0-9a-f]{48}$/.test(t)) await env.DB.prepare("UPDATE subscribers SET unsub = 1 WHERE token = ?").bind(t).run();
        return req.method === "POST" ? new Response("ok") : page("Unsubscribed", "You will not get the Ticker&amp;Tape weekly anymore. Changed your mind? Subscribe again any time from the site.");
      }
      if (path.startsWith("/newsletter/") && env.ADMIN_KEY && url.searchParams.get("key") === env.ADMIN_KEY) {
        if (path === "/newsletter/preview") return new Response(await weeklyHtml("#"), { headers: { "Content-Type": "text/html; charset=utf-8" } });
        if (path === "/newsletter/test") return json(req, { sent: await sendWeekly(env, REPLY_TO) });
        if (path === "/newsletter/alerts") return json(req, await checkAlerts(env));
        if (path === "/newsletter/stats") return json(req, await env.DB.prepare(
          "SELECT SUM(confirmed = 1 AND unsub = 0) AS active, SUM(confirmed = 0) AS pending, SUM(unsub = 1) AS unsubscribed FROM subscribers").first());
      }
      if (path === "/t" && req.method === "POST") {
        try { await trackView(req, env); } catch {}
        return new Response(null, { status: 204, headers: cors(req) });
      }
      if (path === "/admin" && req.method === "GET") return adminPage();
      if (path === "/admin/stats" && req.method === "GET") {
        const k = req.headers.get("X-Admin-Key") || "";
        if (!env.ADMIN_KEY || !safeEqual(k, env.ADMIN_KEY)) return json(req, { error: "Wrong admin key." }, 401);
        const days = Math.min(365, Math.max(7, +url.searchParams.get("days") || 30));
        return json(req, await adminStats(env, days));
      }
      if (path === "/verify" && req.method === "GET") {
        const t = url.searchParams.get("t") || "";
        const r = /^[0-9a-f]{48}$/.test(t) && await env.DB.prepare("UPDATE users SET verified = 1, verify_token = NULL WHERE verify_token = ?").bind(await sha256(t)).run();
        return r && r.meta.changes ? page("Email confirmed", "Thanks. Your alerts can now reach you by email.")
          : page("Link expired", "This confirmation link is no longer valid. Ask for a new one from the banner on the site.");
      }
      if (path === "/tickers" && req.method === "GET") {
        // every ticker anyone has in a watchlist: the nightly data build adds the ones it does not cover yet
        const { results } = await env.DB.prepare("SELECT key, value FROM user_data WHERE key IN ('watchlist', 'lists')").all();
        const set = new Set();
        for (const r of results) { try { const v = JSON.parse(r.value);
          const all = r.key === "lists" ? (v.lists || []).flatMap(l => l.t || []) : v;
          for (const s of all) if (SYM_RE.test(s)) set.add(s); } catch {} }
        try { const { results: al } = await env.DB.prepare("SELECT DISTINCT symbol FROM alerts WHERE fired IS NULL").all();
          for (const r of al) if (SYM_RE.test(r.symbol)) set.add(r.symbol); } catch {}
        return json(req, [...set].sort(), 200, { "Cache-Control": "public, max-age=600" });
      }

      // ---------- auth
      if (path === "/auth/signup" && req.method === "POST") {
        const { email, password } = await body(req);
        const em = cleanEmail(email);
        if (!EMAIL_RE.test(em)) return fail(req, "Enter a valid email address.");
        if (typeof password !== "string" || password.length < 8) return fail(req, "Use a password of at least 8 characters.");
        if (password.length > 200) return fail(req, "That password is too long.");
        const exists = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(em).first();
        if (exists) return fail(req, "There is already an account with that email. Sign in instead.", 409);
        const { hash, salt } = await hashPassword(password);
        const r = await env.DB.prepare("INSERT INTO users (email, pw_hash, pw_salt, created) VALUES (?, ?, ?, ?)")
          .bind(em, hash, salt, new Date().toISOString()).run();
        const id = r.meta.last_row_id;
        try { await sendVerify(env, id, em); } catch (e) { console.log("verify email failed:", e.message); }
        return json(req, { token: await newSession(env, id), email: em, isNew: true, verified: false });
      }
      if (path === "/auth/login" && req.method === "POST") {
        const { email, password } = await body(req);
        const em = cleanEmail(email);
        const u = await env.DB.prepare("SELECT id, email, pw_hash, pw_salt, failed, locked_until FROM users WHERE email = ?").bind(em).first();
        if (u && u.locked_until > now()) return fail(req, "Too many attempts. Try again in a few minutes.", 429);
        const { hash } = await hashPassword(String(password || ""), u ? u.pw_salt : "00".repeat(16));
        if (!u || !safeEqual(hash, u.pw_hash)) {
          if (u) {
            const f = (u.failed || 0) + 1;
            await env.DB.prepare("UPDATE users SET failed = ?, locked_until = ? WHERE id = ?")
              .bind(f >= 8 ? 0 : f, f >= 8 ? now() + 15 * 60 : 0, u.id).run();
          }
          return fail(req, "Wrong email or password.", 401);
        }
        await env.DB.prepare("UPDATE users SET failed = 0, locked_until = 0 WHERE id = ?").bind(u.id).run();
        return json(req, { token: await newSession(env, u.id), email: u.email });
      }

      // ---------- password reset (link by email, valid one hour, single use)
      if (path === "/auth/forgot" && req.method === "POST") {
        const em = cleanEmail((await body(req)).email);
        const u = EMAIL_RE.test(em) && await env.DB.prepare("SELECT id, email FROM users WHERE email = ?").bind(em).first();
        if (u) {
          const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM password_resets WHERE user_id = ? AND created > ?")
            .bind(u.id, now() - 5 * 60).first();
          if (!recent || !recent.n) {
            const token = hex(crypto.getRandomValues(new Uint8Array(24)));
            await env.DB.prepare("DELETE FROM password_resets WHERE user_id = ? OR expires < ?").bind(u.id, now()).run();
            await env.DB.prepare("INSERT INTO password_resets (token_hash, user_id, expires, created) VALUES (?, ?, ?, ?)")
              .bind(await sha256(token), u.id, now() + 3600, now()).run();
            const link = `${SITE}/#reset=${token}`;
            await sendEmails(env, [{ from: FROM, to: [u.email], reply_to: REPLY_TO, subject: "Reset your Ticker&Tape password",
              html: `<div style="font:16px/1.5 Arial,sans-serif;color:#15171c;max-width:520px"><h2 style="color:#1f3c6e">Reset your password</h2>
<p>Someone (hopefully you) asked to reset the password of your Ticker&amp;Tape account. The link works for one hour and only once.</p>
<p><a href="${link}" style="display:inline-block;background:#1f3c6e;color:#fff;padding:10px 16px;text-decoration:none;font-weight:700">Choose a new password</a></p>
<p style="color:#5a5d66;font-size:13px">If you did not ask for this, ignore this email: your password stays the same.</p></div>`,
              text: `Reset your Ticker&Tape password (valid one hour): ${link}` }]);
          }
        }
        return json(req, { ok: true });   // same answer whether or not the account exists
      }
      if (path === "/auth/reset" && req.method === "POST") {
        const { token, password } = await body(req);
        if (!/^[0-9a-f]{48}$/.test(String(token || ""))) return fail(req, "This reset link is not valid. Ask for a new one.");
        if (typeof password !== "string" || password.length < 8 || password.length > 200) return fail(req, "Use a password of at least 8 characters.");
        const th = await sha256(token);
        const r = await env.DB.prepare("SELECT r.user_id, u.email FROM password_resets r JOIN users u ON u.id = r.user_id WHERE r.token_hash = ? AND r.expires > ?")
          .bind(th, now()).first();
        if (!r) return fail(req, "This reset link expired or was already used. Ask for a new one.", 400);
        const n = await hashPassword(password);
        await env.DB.prepare("UPDATE users SET pw_hash = ?, pw_salt = ?, failed = 0, locked_until = 0 WHERE id = ?").bind(n.hash, n.salt, r.user_id).run();
        await env.DB.prepare("DELETE FROM password_resets WHERE user_id = ?").bind(r.user_id).run();
        await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(r.user_id).run();   // sign out every other device
        return json(req, { token: await newSession(env, r.user_id), email: r.email });
      }

      // ---------- signed in
      const user = await currentUser(req, env);
      if (!user) return fail(req, "Not signed in.", 401);

      if (path === "/auth/logout" && req.method === "POST") {
        const t = (req.headers.get("Authorization") || "").slice(7);
        await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(t)).run();
        return json(req, { ok: true });
      }
      if (path === "/auth/password" && req.method === "POST") {
        const { current, password } = await body(req);
        const u = await env.DB.prepare("SELECT pw_hash, pw_salt FROM users WHERE id = ?").bind(user.id).first();
        const { hash } = await hashPassword(String(current || ""), u.pw_salt);
        if (!safeEqual(hash, u.pw_hash)) return fail(req, "Your current password is not correct.", 401);
        if (typeof password !== "string" || password.length < 8 || password.length > 200) return fail(req, "Use a password of at least 8 characters.");
        const n = await hashPassword(password);
        await env.DB.prepare("UPDATE users SET pw_hash = ?, pw_salt = ? WHERE id = ?").bind(n.hash, n.salt, user.id).run();
        return json(req, { ok: true });
      }
      if (path === "/me" && req.method === "GET") return json(req, { email: user.email, verified: !!user.verified });
      if (path === "/auth/verify" && req.method === "POST") {
        if (user.verified) return json(req, { ok: true, verified: true });
        if (user.verify_sent > now() - 5 * 60) return fail(req, "We just sent you a link. Check your inbox and spam folder.", 429);
        await sendVerify(env, user.id, user.email);
        return json(req, { ok: true });
      }
      if (path === "/auth/delete" && req.method === "POST") {
        const { password } = await body(req);
        const u = await env.DB.prepare("SELECT pw_hash, pw_salt FROM users WHERE id = ?").bind(user.id).first();
        const { hash } = await hashPassword(String(password || ""), u.pw_salt);
        if (!safeEqual(hash, u.pw_hash)) return fail(req, "Your current password is not correct.", 401);
        await env.DB.batch(["sessions", "user_data", "alerts", "notifications", "password_resets"].map(tb =>
          env.DB.prepare(`DELETE FROM ${tb} WHERE user_id = ?`).bind(user.id)).concat([env.DB.prepare("DELETE FROM users WHERE id = ?").bind(user.id)]));
        return json(req, { ok: true });
      }
      // ---------- alerts
      if (path === "/alerts" && req.method === "GET") {
        const { results } = await env.DB.prepare("SELECT id, symbol, kind, level, ma, dir, note, email, created, fired, fired_px, fired_level FROM alerts " +
          "WHERE user_id = ? AND (fired IS NULL OR fired > ?) ORDER BY fired IS NOT NULL, created DESC LIMIT 200").bind(user.id, now() - 30 * 86400).all();
        return json(req, { alerts: results, verified: !!user.verified });
      }
      if (path === "/alerts" && req.method === "POST") {
        const b = await body(req); const err = validAlert(b); if (err) return fail(req, err);
        const c = await env.DB.prepare("SELECT COUNT(*) AS n FROM alerts WHERE user_id = ? AND fired IS NULL").bind(user.id).first();
        if (c && c.n >= ALERT_MAX) return fail(req, `You can have up to ${ALERT_MAX} active alerts. Delete one to add another.`);
        const r = await env.DB.prepare("INSERT INTO alerts (user_id, symbol, kind, level, ma, dir, note, email, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(user.id, String(b.symbol).toUpperCase(), b.kind, b.kind === "ma" ? null : b.level, b.kind === "ma" ? b.ma : null, b.dir,
            b.note ? String(b.note).trim() : null, b.email === false ? 0 : 1, now()).run();
        return json(req, { ok: true, id: r.meta.last_row_id });
      }
      const am = path.match(/^\/alerts\/(\d+)$/);
      if (am && req.method === "DELETE") {
        await env.DB.prepare("DELETE FROM alerts WHERE id = ? AND user_id = ?").bind(+am[1], user.id).run();
        return json(req, { ok: true });
      }
      if (path === "/notifications" && req.method === "GET") {
        const { results } = await env.DB.prepare("SELECT id, symbol, msg, created, read FROM notifications WHERE user_id = ? ORDER BY created DESC LIMIT 40").bind(user.id).all();
        return json(req, { items: results, unread: results.filter(r => !r.read).length });
      }
      if (path === "/notifications/read" && req.method === "POST") {
        await env.DB.prepare("UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0").bind(user.id).run();
        return json(req, { ok: true });
      }

      if (path === "/data" && req.method === "GET") {
        const { results } = await env.DB.prepare("SELECT key, value FROM user_data WHERE user_id = ?").bind(user.id).all();
        const out = {};
        for (const r of results) { try { out[r.key] = JSON.parse(r.value); } catch {} }
        return json(req, out);
      }
      const m = path.match(/^\/data\/(.+)$/);
      if (m) {
        const key = decodeURIComponent(m[1]);
        if (!KEY_RE.test(key)) return fail(req, "Unknown setting.");
        if (req.method === "DELETE") {
          await env.DB.prepare("DELETE FROM user_data WHERE user_id = ? AND key = ?").bind(user.id, key).run();
          return json(req, { ok: true });
        }
        if (req.method === "PUT") {
          const { value } = await body(req);
          if (key === "watchlist") {
            if (!Array.isArray(value) || value.length > 300 || !value.every(s => typeof s === "string" && SYM_RE.test(s)))
              return fail(req, "Invalid watchlist (max 300 tickers).");
          }
          if (key === "lists") {
            const L = value && Array.isArray(value.lists) ? value.lists : null;
            if (!L || L.length > 20 || !L.every(l => l && typeof l.name === "string" && l.name.length <= 40 && Array.isArray(l.t) && l.t.length <= 300 && l.t.every(s => typeof s === "string" && SYM_RE.test(s))))
              return fail(req, "Invalid lists (up to 20 lists of 300 tickers).");
          }
          if (key === "notes") {
            if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length > 500 ||
                !Object.entries(value).every(([k, v]) => SYM_RE.test(k) && typeof v === "string" && v.length <= 280))
              return fail(req, "Invalid notes (up to 500 notes of 280 characters).");
          }
          const txt = JSON.stringify(value ?? null);
          if (txt.length > MAX_VALUE) return fail(req, "Too much data for one setting.", 413);
          await env.DB.prepare("INSERT INTO user_data (user_id, key, value, updated) VALUES (?, ?, ?, ?) " +
            "ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated = excluded.updated")
            .bind(user.id, key, txt, now()).run();
          return json(req, { ok: true });
        }
      }
      return fail(req, "Not found.", 404);
    } catch (e) {
      return fail(req, "Server error. Try again in a moment.", 500);
    }
  },
  // Cron Triggers: "0 2 * * SAT" sends the weekly (Friday night, after the nightly build);
  // "5,20,35,50 13-21 * * MON-FRI" checks the price alerts every 15 minutes during US market hours.
  async scheduled(event, env, ctx) {
    if (event.cron && event.cron.includes("13-21")) ctx.waitUntil(checkAlerts(env).then(r => console.log("alerts:", JSON.stringify(r))).catch(e => console.log("alerts failed:", e.message)));
    else {
      ctx.waitUntil(sendWeekly(env).catch(e => console.log("weekly failed:", e.message)));
      // keep 400 days of statistics; daily visitor hashes are only needed to count unique visitors
      ctx.waitUntil(env.DB.batch([env.DB.prepare("DELETE FROM visitors WHERE day < ?").bind(new Date(Date.now() - 400 * 86400e3).toISOString().slice(0, 10)),
        env.DB.prepare("DELETE FROM stats_daily WHERE day < ?").bind(new Date(Date.now() - 400 * 86400e3).toISOString().slice(0, 10))]).catch(() => {}));
    }
  },
};
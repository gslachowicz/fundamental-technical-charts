// Ticker&Tape API — accounts + per-user watchlists, settings and drawings.
// Cloudflare Worker with a D1 database bound as DB. Served at https://api.tickerandtape.com
const ORIGINS = ["https://tickerandtape.com", "https://www.tickerandtape.com", "http://localhost:8000", "http://127.0.0.1:8000"];
const SESSION_DAYS = 90;
const PBKDF2_ITER = 100000;
const MAX_VALUE = 64 * 1024;
const KEY_RE = /^(watchlist|cfg|marks:[A-Z0-9.\-^=]{1,15})$/;
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
  const h = { "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS", "Access-Control-Allow-Headers": "Content-Type,Authorization",
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
  return await env.DB.prepare("SELECT u.id, u.email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires > ?")
    .bind(await sha256(m[1]), now()).first();
}
const cleanEmail = e => String(e || "").trim().toLowerCase();

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
You get this because you subscribed at tickerandtape.com. <a href="${unsubLink}" style="color:${C.navy}">Unsubscribe</a></td></tr>
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
        if (path === "/newsletter/stats") return json(req, await env.DB.prepare(
          "SELECT SUM(confirmed = 1 AND unsub = 0) AS active, SUM(confirmed = 0) AS pending, SUM(unsub = 1) AS unsubscribed FROM subscribers").first());
      }
      if (path === "/tickers" && req.method === "GET") {
        // every ticker anyone has in a watchlist: the nightly data build adds the ones it does not cover yet
        const { results } = await env.DB.prepare("SELECT value FROM user_data WHERE key = 'watchlist'").all();
        const set = new Set();
        for (const r of results) { try { for (const s of JSON.parse(r.value)) if (SYM_RE.test(s)) set.add(s); } catch {} }
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
        return json(req, { token: await newSession(env, id), email: em, isNew: true });
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
      if (path === "/me" && req.method === "GET") return json(req, { email: user.email });

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
  // Cron Trigger (Fridays after the nightly build): send the weekly to every confirmed subscriber
  async scheduled(event, env, ctx) {
    ctx.waitUntil(sendWeekly(env).catch(e => console.log("weekly failed:", e.message)));
  },
};

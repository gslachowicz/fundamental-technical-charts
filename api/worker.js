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

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    try {
      // ---------- public
      if (path === "/" ) return json(req, { ok: true, service: "Ticker&Tape API" });
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
};

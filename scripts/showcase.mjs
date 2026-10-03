// Screenshots of the site's main tools for the rotating showcase on the welcome page.
// Runs in the nightly build after the data is ready: node scripts/showcase.mjs <site dir> [base url]
// Saves site/img/showcase/<name>.jpg (1440x900) plus a lighter <name>.webp when sharp is installed (the page tries the WebP first).
// A failed shot is skipped; the welcome page hides missing slides.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
let sharp = null;
try { sharp = (await import("sharp")).default; } catch { console.log("showcase: sharp not installed, JPEG only"); }

const SITE = process.argv[2] || "site";
const BASE = process.argv[3] || "http://127.0.0.1:8000";
const OUT = `${SITE}/img/showcase`;
mkdirSync(OUT, { recursive: true });

const SHOTS = [
  { name: "wall", path: "/wall/", ready: "#wGrid .wtile canvas", wait: 2500 },
  { name: "screener", path: "/screener/", ready: "#scr tbody tr" },
  { name: "heatmap", path: "/heatmap/", ready: "#hmap .hmt" },
  { name: "breadth", path: "/breadth/", ready: "#bStatus .bcard" },
  { name: "ideas", path: "/ideas/", ready: "#iCards .icard" },
  { name: "earnings", path: "/earnings/", ready: "#vEarn table, #vEarn .ecard, #vEarn tr" },
  { name: "compare", path: "/compare/?t=SPY,RSP,MAGS", ready: "#cTbl table", from: "#vCmp .cctl" },
  { name: "chart", path: "/chart/NVDA/", ready: "#cv", wait: 1500 },
];

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, locale: "en-US" });
await ctx.addInitScript(() => {
  // a signed-in looking session so the sections open (the API is not reachable here, nothing is saved)
  const now = String(Date.now());
  for (const [k, v] of [["tt:token", '"showcase"'], ["tt:loginAt", now], ["tt:alive", now], ["tt:welcomed", "true"], ["tt:toured", "true"], ["tt:lang", '"en"']])
    localStorage.setItem(k, v);
  addEventListener("DOMContentLoaded", () => {
    const st = document.createElement("style");
    st.textContent = "#banner,#toast,#tour,#gateBar,.newsletter,.nlbox{display:none!important}*{animation:none!important;transition:none!important}";
    document.head.appendChild(st);
  });
});
const page = await ctx.newPage();
let ok = 0;
for (const s of SHOTS) {
  try {
    await page.goto(BASE + s.path, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForSelector(s.ready, { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(s.wait || 1200);
    const top = await page.evaluate(sel => { const t = document.querySelector(sel); return t ? Math.max(0, t.getBoundingClientRect().top + scrollY - 6) : 0; }, s.from || "#tabs");
    const buf = await page.screenshot({ path: `${OUT}/${s.name}.jpg`, type: "jpeg", quality: 78, fullPage: true, clip: { x: 0, y: top, width: 1440, height: 900 } });
    if (sharp) await sharp(buf).webp({ quality: 74, effort: 5 }).toFile(`${OUT}/${s.name}.webp`).catch(e => console.log(`showcase: ${s.name} webp failed: ${e.message}`));
    ok++;
    console.log(`showcase: ${s.name} ok`);
  } catch (e) {
    console.log(`showcase: ${s.name} failed: ${e.message}`);
  }
}
await browser.close();
console.log(`showcase: ${ok} of ${SHOTS.length} screenshots`);

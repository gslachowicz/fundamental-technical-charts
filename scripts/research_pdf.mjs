// Prints a research report to PDF and saves a cover thumbnail of its first page.
// node scripts/research_pdf.mjs build/research/report.html build/research/report.pdf build/research/cover.png
import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const [src, pdf, png] = process.argv.slice(2);
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const page = await browser.newPage({ viewport: { width: 816, height: 1056 }, deviceScaleFactor: 1.5 });
await page.goto(pathToFileURL(resolve(src)).href, { waitUntil: "networkidle", timeout: 60000 });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(400);
// warn when a page's content runs past its bottom edge (the PDF would cut it)
const over = await page.evaluate(() => [...document.querySelectorAll(".page")].map((p, i) => {
  const last = [...p.children].filter(c => !c.matches(".pf,.disc")).pop(); if (!last) return null;
  const b = last.getBoundingClientRect(), pb = p.getBoundingClientRect(); return b.bottom > pb.bottom - 60 ? i + 1 : null; }).filter(Boolean));
if (over.length) console.log(`research: content may be cut on page ${over.join(", ")}`);
await page.pdf({ path: pdf, format: "Letter", printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
if (png) await page.screenshot({ path: png, clip: { x: 0, y: 0, width: 816, height: 1056 }, type: "png" });
await browser.close();
console.log(`research: ${pdf}${png ? " + " + png : ""}`);

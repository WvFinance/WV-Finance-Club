// Free morning refresh: Claude (the scheduled task in Charlie's Claude account) writes the briefs itself,
// with no API key, and this script keeps them in exactly the same format as the paid weekly refresh.
//
//   node scripts/morning-briefs.mjs rules        the brief instructions (the same ones the API refresh uses)
//   node scripts/morning-briefs.mjs list         every brief to check, with when it was last written
//   node scripts/morning-briefs.mjs save <dir>   checks <dir>/<TICKER>.json files and puts them into data/news.json
//   node scripts/morning-briefs.mjs recap <file> checks the after-close market recap (the "Why" on the Portfolio tab)
//                                                and puts it into data/news.json as "market"
//
// Run from brief-server/. Needs no packages.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { SYSTEM, parseBrief } from "../src/brief-format.js";
import { briefJobs, mergeBrief } from "../src/jobs.js";

const NEWS = new URL("../../data/news.json", import.meta.url);
const PORTFOLIO = new URL("../../data/portfolio.json", import.meta.url);
const news = JSON.parse(readFileSync(NEWS, "utf8"));
const picks = JSON.parse(readFileSync(PORTFOLIO, "utf8")).picks || [];
const jobs = briefJobs(news, picks);
const [mode, dir] = process.argv.slice(2);

if (mode === "rules") {
  console.log(SYSTEM);
} else if (mode === "list") {
  for (const j of jobs) {
    const b = j.base || {};
    const newest = (b.sources || []).map(s => s.date).filter(Boolean).join("; ");
    console.log([j.ticker, j.subject, `last written: ${b.updatedAt || (b.headline ? news.updated : "never, write it")}`,
      `last headline: ${b.headline || "-"}`, `source dates: ${newest || "-"}`, `next event: ${b.nextEvent || "-"}`].join("\n  "));
  }
} else if (mode === "save") {
  if (!dir) throw new Error("Use: save <folder with TICKER.json files>");
  let saved = 0, bad = 0;
  for (const f of readdirSync(dir).filter(f => f.endsWith(".json"))) {
    const ticker = f.slice(0, -5).toUpperCase();
    const job = jobs.find(j => j.ticker === ticker);
    try {
      if (!job) throw new Error("not a brief on the site");
      // Same checks as the paid refresh: all fields, a real sentiment, at least 3 sources, no unfinished drafts.
      const b = parseBrief(readFileSync(join(dir, f), "utf8"), 3);
      for (const k of ["bull", "bear"]) if (!Array.isArray(b[k]) || b[k].length < 2) throw new Error(`${k} needs 3 short reasons`);
      if (typeof b.nextEvent !== "string") throw new Error("nextEvent must be a string (empty if none)");
      if (b.headline.length > 100) throw new Error("headline is too long");
      mergeBrief(news, job, b);
      saved++;
      console.log(`${ticker}: saved, ${b.sentiment}, ${b.sources.length} sources: ${b.headline}`);
    } catch (e) {
      bad++;
      console.log(`${ticker}: NOT saved (${e.message}). Fix the file and run save again.`);
    }
  }
  if (saved) {
    news.updated = new Date().toISOString().slice(0, 10);
    writeFileSync(NEWS, JSON.stringify(news, null, 1) + "\n");
  }
  console.log(`Saved ${saved} briefs, ${bad} need fixing.`);
  if (bad) process.exit(1);
} else if (mode === "recap") {
  // The evening task writes { date, why, sources } after the market closes. The date must be the newest
  // day in data/prices.json, so the "Why" always matches the % moves shown next to it.
  if (!dir) throw new Error("Use: recap <file.json>");
  const prices = JSON.parse(readFileSync(new URL("../../data/prices.json", import.meta.url), "utf8"));
  const last = (prices.dates || []).at(-1);
  const r = JSON.parse(readFileSync(dir, "utf8"));
  const why = String(r.why || "").trim();
  const sentences = why.split(/(?<=[.!?])\s+(?=[A-Z0-9"])/).filter(Boolean);
  const problems = [];
  if (r.date !== last) problems.push(`date is ${r.date}, but the newest price day is ${last} (pull again, or wait for "Update closing prices")`);
  if (sentences.length < 2 || sentences.length > 4) problems.push(`why needs 2 to 4 sentences (has ${sentences.length})`);
  if (why.length > 520) problems.push(`why is too long (${why.length} characters, max 520)`);
  const sources = Array.isArray(r.sources) ? r.sources.filter(s => s && s.url && s.outlet && s.title) : [];
  if (sources.length < 2 || new Set(sources.map(s => s.outlet)).size < 2) problems.push("needs at least 2 sources from 2 different news sites");
  if (problems.length) { console.log(`Recap NOT saved: ${problems.join("; ")}. Fix the file and run recap again.`); process.exit(1); }
  news.market = { date: r.date, why, sources: sources.map(({ title, url, outlet, date }) => ({ title, url, outlet, date: date || "" })), updatedAt: new Date().toISOString() };
  writeFileSync(NEWS, JSON.stringify(news, null, 1) + "\n");
  console.log(`Recap saved for ${r.date}: ${why}`);
} else {
  console.error("Use: rules, list, save <dir> or recap <file>");
  process.exit(1);
}

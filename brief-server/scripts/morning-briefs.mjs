// Free morning refresh: Claude (the scheduled task in Charlie's Claude account) writes the briefs itself,
// with no API key, and this script keeps them in exactly the same format as the paid weekly refresh.
//
//   node scripts/morning-briefs.mjs rules        the brief instructions (the same ones the API refresh uses)
//   node scripts/morning-briefs.mjs list         every brief to check, with when it was last written
//   node scripts/morning-briefs.mjs save <dir>   checks <dir>/<TICKER>.json files and puts them into data/news.json
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
} else {
  console.error("Use: rules, list or save <dir>");
  process.exit(1);
}

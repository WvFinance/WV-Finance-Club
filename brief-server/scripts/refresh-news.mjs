// Weekly refresh: rewrites the S&P 500, Nasdaq and every portfolio stock's brief in data/news.json.
// Run from brief-server/ with ANTHROPIC_API_KEY set:  node scripts/refresh-news.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { writeBrief } from "../src/brief.js";
import { briefJobs, mergeBrief } from "../src/jobs.js";

const NEWS = new URL("../../data/news.json", import.meta.url);
const PORTFOLIO = new URL("../../data/portfolio.json", import.meta.url);
const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
const news = JSON.parse(readFileSync(NEWS, "utf8"));
const picks = JSON.parse(readFileSync(PORTFOLIO, "utf8")).picks || [];

const jobs = briefJobs(news, picks);

// ONLY=MSFT,SP500 refreshes just those briefs (for testing).
const only = (process.env.ONLY || "").split(",").map(x => x.trim().toUpperCase()).filter(Boolean);
if (only.length) jobs.splice(0, jobs.length, ...jobs.filter(j => only.includes(j.ticker)));

let done = 0, failed = 0;
async function run(job) {
  try {
    let b;
    // One retry, because a brief with too few articles is thrown out.
    try { b = await writeBrief(apiKey, job.subject, { minSources: 3 }); }
    catch (e) { console.log(`${job.ticker}: retrying (${e.message})`); b = await writeBrief(apiKey, job.subject, { minSources: 3 }); }
    mergeBrief(news, job, b);
    done++;
    console.log(`${job.ticker}: ${b.sentiment}, ${b.sources.length} sources: ${b.headline}`);
  } catch (e) {
    failed++;
    console.log(`${job.ticker}: kept the old brief (${e.message})`);
  }
}

// One at a time, so the briefs don't compete for the web search tool.
for (const job of jobs) await run(job);

if (done) {
  news.updated = new Date().toISOString().slice(0, 10);
  writeFileSync(NEWS, JSON.stringify(news, null, 1) + "\n");
}
console.log(`Refreshed ${done} of ${jobs.length} briefs, ${failed} failed.`);
if (!done) process.exit(1);

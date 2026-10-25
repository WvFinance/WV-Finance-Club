// Weekly refresh: rewrites the S&P 500, Nasdaq and every portfolio stock's brief in data/news.json.
// Run from brief-server/ with ANTHROPIC_API_KEY set:  node scripts/refresh-news.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { writeBrief } from "../src/brief.js";

const NEWS = new URL("../../data/news.json", import.meta.url);
const PORTFOLIO = new URL("../../data/portfolio.json", import.meta.url);
const MARKETS = {
  SP500: "the S&P 500 index (the whole US stock market; the SPY fund tracks it)",
  NASDAQ: "the Nasdaq Composite index (mostly tech companies; the QQQ fund tracks it)",
};
// Only these fields come from Claude; ticker, symbol, market, order and name stay as they are.
const FRESH = ["sentiment", "headline", "summary", "bull", "bear", "nextEvent", "sources"];

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
const news = JSON.parse(readFileSync(NEWS, "utf8"));
const picks = JSON.parse(readFileSync(PORTFOLIO, "utf8")).picks || [];

const jobs = Object.entries(MARKETS).map(([ticker, subject]) => ({ ticker, subject, base: news.briefs.find(b => b.ticker === ticker) }));
for (const p of picks) {
  jobs.push({
    ticker: p.ticker,
    subject: `${p.symbol || p.ticker} (${p.name || p.ticker})`,
    base: news.briefs.find(b => b.ticker === p.ticker) || { ticker: p.ticker, symbol: p.symbol || p.ticker },
  });
}

let done = 0, failed = 0;
async function run(job) {
  try {
    const b = await writeBrief(apiKey, job.subject);
    const next = { ...job.base };
    for (const k of FRESH) next[k] = b[k];
    if (!next.market && b.name) next.name = b.name;
    next.updatedAt = new Date().toISOString();
    const i = news.briefs.findIndex(x => x.ticker === job.ticker);
    if (i >= 0) news.briefs[i] = next; else news.briefs.push(next);
    done++;
    console.log(`${job.ticker}: ${b.sentiment}, ${b.sources.length} sources: ${b.headline}`);
  } catch (e) {
    failed++;
    console.log(`${job.ticker}: kept the old brief (${e.message})`);
  }
}

// Three at a time keeps the run short without hitting rate limits.
const queue = [...jobs];
await Promise.all([0, 1, 2].map(async () => { while (queue.length) await run(queue.shift()); }));

if (done) {
  news.updated = new Date().toISOString().slice(0, 10);
  writeFileSync(NEWS, JSON.stringify(news, null, 1) + "\n");
}
console.log(`Refreshed ${done} of ${jobs.length} briefs, ${failed} failed.`);
if (!done) process.exit(1);

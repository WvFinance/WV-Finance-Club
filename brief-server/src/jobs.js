// Which briefs the site has: the S&P 500, the Nasdaq, then every portfolio stock.
// Shared by the weekly API refresh and the free morning refresh.
export const MARKETS = {
  SP500: "the S&P 500 index (the whole US stock market; the SPY fund tracks it)",
  NASDAQ: "the Nasdaq Composite index (mostly tech companies; the QQQ fund tracks it)",
};
// Only these fields are rewritten; ticker, symbol, market, order and name stay as they are.
export const FRESH = ["sentiment", "headline", "summary", "bull", "bear", "nextEvent", "sources"];

export function briefJobs(news, picks) {
  const jobs = Object.entries(MARKETS).map(([ticker, subject]) => ({ ticker, subject, base: news.briefs.find(b => b.ticker === ticker) }));
  for (const p of picks) {
    jobs.push({
      ticker: p.ticker,
      subject: `${p.symbol || p.ticker} (${p.name || p.ticker})`,
      base: news.briefs.find(b => b.ticker === p.ticker) || { ticker: p.ticker, symbol: p.symbol || p.ticker },
    });
  }
  return jobs;
}

// Puts a new brief into news.json the same way every time.
export function mergeBrief(news, job, b) {
  const next = { ...job.base };
  for (const k of FRESH) next[k] = b[k];
  if (!next.market && b.name) next.name = b.name;
  next.updatedAt = new Date().toISOString();
  const i = news.briefs.findIndex(x => x.ticker === job.ticker);
  if (i >= 0) news.briefs[i] = next; else news.briefs.push(next);
}

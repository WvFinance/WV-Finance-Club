// Which briefs the site has: the S&P 500, the Nasdaq, Bitcoin, Ethereum, then every portfolio stock.
// Shared by the weekly API refresh and the free morning refresh.
// base is used only the first time a brief is written; after that the saved brief keeps its own fields.
export const MARKETS = {
  SP500: { subject: "the S&P 500 index (the whole US stock market; the SPY fund tracks it)", base: { name: "S&P 500", market: true, order: 1, symbol: "AMEX:SPY" } },
  NASDAQ: { subject: "the Nasdaq Composite index (mostly tech companies; the QQQ fund tracks it)", base: { name: "Nasdaq", market: true, order: 2, symbol: "NASDAQ:QQQ" } },
  BTC: { subject: "Bitcoin (BTC), the biggest cryptocurrency", base: { name: "Bitcoin", market: true, crypto: true, order: 3, symbol: "COINBASE:BTCUSD" } },
  ETH: { subject: "Ethereum (ETH), the second-biggest cryptocurrency", base: { name: "Ethereum", market: true, crypto: true, order: 4, symbol: "COINBASE:ETHUSD" } },
};
// Only these fields are rewritten; ticker, symbol, market, order and name stay as they are.
export const FRESH = ["sentiment", "headline", "summary", "bull", "bear", "nextEvent", "sources"];

export function briefJobs(news, picks) {
  const jobs = Object.entries(MARKETS).map(([ticker, m]) => ({ ticker, subject: m.subject, base: news.briefs.find(b => b.ticker === ticker) || { ticker, ...m.base } }));
  for (const p of picks) {
    // A coin the club owns (like BTC) already has its market brief, so it doesn't get a second one.
    if (MARKETS[p.ticker]) continue;
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

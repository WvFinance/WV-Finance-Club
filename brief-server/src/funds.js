// Funds (ETFs) like UFO, SPY or XLV: news sites rarely write about a fund itself, so a fund's
// brief is built from news about its theme ("space stocks") and its biggest holdings instead.
import { companyNames } from "./sec.js";

// The site's list of every US stock and fund (data/stocks.json, refreshed weekly).
// Funds are the rows with no exchange: ["UFO", "Procure Space ETF", ""].
const LIST_URLS = [
  "https://simplestreet.com.co/data/stocks.json",
  "https://wvfinance.github.io/WV-Finance-Club/data/stocks.json",
];
const LIST_TTL = 6 * 3600 * 1000;
let listCache = null; // { text, at } kept while this copy of the server stays warm

async function listText() {
  if (listCache && Date.now() - listCache.at < LIST_TTL) return listCache.text;
  for (const url of LIST_URLS) {
    try {
      const r = await fetch(url, { cf: { cacheTtl: 21600, cacheEverything: true } });
      if (!r.ok) continue;
      const text = await r.text();
      if (!text.includes('"stocks"')) continue;
      listCache = { text, at: Date.now() };
      return text;
    } catch (e) {
      console.warn("stock list failed:", String(e.message || e));
    }
  }
  return listCache ? listCache.text : "";
}

// One row of the list, found without reading the whole (large) file into objects.
export function findInList(text, ticker) {
  const i = text.indexOf(`["${ticker}","`);
  if (i < 0) return null;
  const end = text.indexOf("]", i);
  try {
    const [t, name, exchange] = JSON.parse(text.slice(i, end + 1));
    return { ticker: t, name, exchange, fund: !exchange };
  } catch { return null; }
}

// { ticker, name, exchange, fund } for a ticker on the site's list, or null if it isn't there.
export async function findListing(ticker) {
  return findInList(await listText(), ticker);
}

const FUND_RULES = `You know about US exchange-traded funds (ETFs) and other funds.
Reply with only a JSON object with exactly these keys:
{
  "theme": "what the fund invests in, in a few plain words, like \\"space companies\\" or \\"gold\\" or \\"the 500 biggest US companies\\"",
  "search": "2 to 4 words to search the news for the fund's theme, like \\"space stocks\\" or \\"gold prices\\" or \\"stock market\\"",
  "holdings": ["tickers of up to 6 of the fund's biggest stock holdings, biggest first, only ones you are sure of"]
}
Use an empty holdings list if the fund holds bonds, gold, bitcoin or other things that are not stocks, or if you don't know the fund.`;

// Keeps only real stocks from the list (funds and made-up tickers are dropped), at most 5.
export function checkHoldings(tickers, text, fundTicker) {
  const out = [];
  for (const raw of Array.isArray(tickers) ? tickers : []) {
    const t = String(raw || "").toUpperCase().replace(/^[A-Z]+:/, "").trim();
    if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(t) || t === fundTicker || out.some(h => h.ticker === t)) continue;
    const row = findInList(text, t);
    if (!row || row.fund) continue;
    out.push({ ticker: t, name: companyNames(row.name).short });
    if (out.length >= 5) break;
  }
  return out;
}

// The fund's theme and biggest holdings, saved for 30 days so Gemini is asked once a month per fund.
// ask(system, prompt) returns Gemini's reply text.
export async function fundInfo(listing, { kv, ask }) {
  const key = "fund:" + listing.ticker;
  const saved = kv ? await kv.get(key, "json").catch(() => null) : null;
  if (saved) return saved;
  const base = { ticker: listing.ticker, name: listing.name, theme: "", search: "", holdings: [] };
  let reply;
  try {
    reply = await ask(FUND_RULES, `The fund is ${listing.name} (ticker ${listing.ticker}).`);
  } catch (e) {
    if (e.kind) throw e; // Gemini's free limits: stop here like any other brief
    console.warn(listing.ticker, "fund lookup failed:", String(e.message || e));
    return base;
  }
  let j = {};
  try { j = JSON.parse(reply.slice(reply.indexOf("{"), reply.lastIndexOf("}") + 1)); } catch {}
  const info = {
    ...base,
    theme: String(j.theme || "").slice(0, 80),
    search: String(j.search || "").replace(/["<>]/g, "").slice(0, 60),
    holdings: checkHoldings(j.holdings, await listText(), listing.ticker),
  };
  if (kv) await kv.put(key, JSON.stringify(info), { expirationTtl: 30 * 86400 }).catch(() => {});
  return info;
}

// Extra instructions added to the brief request when the ticker is a fund.
export function fundNote(f) {
  const owns = f.holdings.length ? `Some of its biggest holdings: ${f.holdings.map(h => `${h.name} (${h.ticker})`).join(", ")}.` : "";
  return `${f.ticker} is a fund (an ETF) called "${f.name}", not a single company. A fund is one stock you can buy that owns a basket of many investments at once.
${f.theme ? `It invests in ${f.theme}.` : ""} ${owns}
The articles are about the fund, its theme and the companies it owns; each says what it is about. Write the brief about the fund:
what is happening to the things it owns and what that could mean for the fund. Name the companies when you use their news.
Put the fund's name in "name". In "about", say in 1 or 2 short sentences what the fund owns, naming a few of its biggest holdings.
Only give a price or percent move for the fund itself if an article gives it.`;
}

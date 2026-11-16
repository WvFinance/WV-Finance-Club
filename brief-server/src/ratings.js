// GET /ratings?symbol=AAPL: what Wall Street analysts say about one stock, for the Search page box
// "What Wall Street experts say". How many say Strong Buy, Buy, Hold, Sell and Strong Sell, plus their
// average price goal for the next year.
// Free sources, tried in order: Yahoo Finance (all five counts + price goal), Nasdaq (buy/hold/sell +
// price goal), then Finnhub if a FINNHUB_KEY secret is ever added (counts only, its price goal is paid).
// Each stock is saved for 12 hours, so a source is asked at most twice a day per stock.

const HOURS = 3600;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const n = (v) => (typeof v === "number" && isFinite(v) ? v : typeof v === "string" && v.trim() && isFinite(+v.replace(/[$,]/g, "")) ? +v.replace(/[$,]/g, "") : null);
const raw = (o) => (o && typeof o === "object" ? n(o.raw) : n(o));

async function getJson(url, init = {}) {
  const r = await fetch(url, { ...init, headers: { "User-Agent": UA, Accept: "application/json", ...(init.headers || {}) } });
  if (!r.ok) throw new Error(`${new URL(url).hostname} ${r.status}`);
  return r.json();
}

// Yahoo wants a cookie and a matching "crumb". Both are saved for a few hours.
async function yahooPass(kv, fresh) {
  if (!fresh) {
    const saved = await kv.get("yahoo-pass", "json");
    if (saved && saved.crumb) return saved;
  }
  const first = await fetch("https://fc.yahoo.com/", { headers: { "User-Agent": UA }, redirect: "manual" });
  const cookie = (first.headers.get("set-cookie") || "").split(/,(?=\s*[A-Za-z0-9_]+=)/).map((c) => c.split(";")[0].trim()).filter(Boolean).join("; ");
  if (!cookie) throw new Error("yahoo no cookie");
  const r = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", { headers: { "User-Agent": UA, Cookie: cookie } });
  const crumb = (await r.text()).trim();
  if (!r.ok || !crumb || crumb.length > 40 || /[<{ ]/.test(crumb)) throw new Error(`yahoo crumb ${r.status}`);
  const pass = { cookie, crumb };
  await kv.put("yahoo-pass", JSON.stringify(pass), { expirationTtl: 6 * HOURS });
  return pass;
}

async function fromYahoo(tk, kv) {
  for (const fresh of [false, true]) {
    const { cookie, crumb } = await yahooPass(kv, fresh);
    const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(tk.replace(".", "-"))}` +
      `?modules=recommendationTrend,financialData&crumb=${encodeURIComponent(crumb)}`;
    const r = await fetch(url, { headers: { "User-Agent": UA, Cookie: cookie, Accept: "application/json" } });
    if (r.status === 401 || r.status === 403) continue; // old crumb: get a new one and try once more
    if (!r.ok) throw new Error(`yahoo ${r.status}`);
    const res = ((await r.json()).quoteSummary || {}).result;
    if (!res || !res[0]) return null;
    const trend = ((res[0].recommendationTrend || {}).trend || []).find((p) => p.period === "0m");
    if (!trend) return null;
    const fd = res[0].financialData || {};
    return {
      strongBuy: n(trend.strongBuy) || 0, buy: n(trend.buy) || 0, hold: n(trend.hold) || 0,
      sell: n(trend.sell) || 0, strongSell: n(trend.strongSell) || 0,
      target: raw(fd.targetMeanPrice), targetHigh: raw(fd.targetHighPrice), targetLow: raw(fd.targetLowPrice),
      price: raw(fd.currentPrice), source: "Yahoo Finance",
    };
  }
  throw new Error("yahoo crumb refused");
}

async function fromNasdaq(tk) {
  const j = await getJson(`https://api.nasdaq.com/api/analyst/${encodeURIComponent(tk)}/targetprice`, {
    headers: { Origin: "https://www.nasdaq.com", Referer: "https://www.nasdaq.com/" },
  });
  const c = (j.data || {}).consensusOverview;
  if (!c) return null;
  return {
    strongBuy: 0, buy: n(c.buy) || 0, hold: n(c.hold) || 0, sell: n(c.sell) || 0, strongSell: 0,
    target: n(c.priceTarget), targetHigh: n(c.highPriceTarget), targetLow: n(c.lowPriceTarget),
    source: "Nasdaq", simple: true,
  };
}

async function fromFinnhub(tk, key) {
  if (!key) return null;
  const j = await getJson(`https://finnhub.io/api/v1/stock/recommendation?symbol=${encodeURIComponent(tk)}&token=${encodeURIComponent(key)}`);
  const p = Array.isArray(j) && j[0];
  if (!p) return null;
  return { strongBuy: p.strongBuy || 0, buy: p.buy || 0, hold: p.hold || 0, sell: p.sell || 0, strongSell: p.strongSell || 0, source: "Finnhub" };
}

const total = (r) => r ? r.strongBuy + r.buy + r.hold + r.sell + r.strongSell : 0;

export async function handleRatings(request, env, url, json, headers) {
  if (url.pathname !== "/ratings") return null;
  const tk = (url.searchParams.get("symbol") || "").toUpperCase().split(":").pop();
  if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(tk)) return json({ error: "bad ticker" }, 400, headers);
  const kv = env.BRIEFS;
  const saved = await kv.get("ratings:" + tk, "json");
  if (saved) return json(saved, 200, headers);

  // Lookups not already saved are capped per day, to stay in good standing with the free sources.
  const day = new Date().toISOString().slice(0, 10);
  const used = Number(await kv.get("ratings-count:" + day)) || 0;
  if (used >= Number(env.RATINGS_LIMIT || 600)) return json({ ticker: tk, error: "busy" }, 429, headers);
  await kv.put("ratings-count:" + day, String(used + 1), { expirationTtl: 2 * 24 * HOURS });

  const tried = [];
  let got = null;
  for (const [name, f] of [["yahoo", () => fromYahoo(tk, kv)], ["nasdaq", () => fromNasdaq(tk)], ...(env.FINNHUB_KEY ? [["finnhub", () => fromFinnhub(tk, env.FINNHUB_KEY)]] : [])]) {
    try {
      const r = await f();
      if (total(r) > 0) { got = r; break; }
      tried.push(`${name}: none`);
    } catch (e) {
      tried.push(`${name}: ${String(e.message || e).slice(0, 80)}`);
    }
  }
  const out = got
    ? { ticker: tk, ...got, analysts: total(got), at: new Date().toISOString() }
    : { ticker: tk, analysts: 0, none: true, tried, at: new Date().toISOString() };
  // A stock nobody covers is saved for 12 hours too; a failed lookup only for 1 hour.
  const allFailed = !got && tried.every((t) => !t.endsWith(": none"));
  await kv.put("ratings:" + tk, JSON.stringify(out), { expirationTtl: (allFailed ? 1 : 12) * HOURS });
  return json(out, 200, headers);
}

// WV Finance Club brief server.
// GET /brief?symbol=NASDAQ:AMD returns a news brief in the same shape as data/news.json.
// Briefs are saved for a day so the same stock is only written once a day.
import { writeBrief } from "./gemini.js";
import { checkFeeds } from "./news.js";

const DAY = 24 * 60 * 60;

function cors(env, origin) {
  const ok = origin === env.ALLOWED_ORIGIN || /^http:\/\/localhost(:\d+)?$/.test(origin || "");
  return {
    "Access-Control-Allow-Origin": ok ? origin : env.ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Vary": "Origin",
  };
}

const today = () => new Date().toISOString().slice(0, 10);

// Adds 1 to a daily counter unless it's already at the limit. Returns false at the limit.
async function countUp(env, key, limit) {
  const used = Number(await env.BRIEFS.get(key)) || 0;
  if (used >= limit) return false;
  await env.BRIEFS.put(key, String(used + 1), { expirationTtl: 2 * DAY });
  return true;
}
async function countDown(env, key) {
  const used = Number(await env.BRIEFS.get(key)) || 0;
  if (used > 0) await env.BRIEFS.put(key, String(used - 1), { expirationTtl: 2 * DAY });
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json" } });
}

export default {
  async fetch(request, env) {
    const headers = cors(env, request.headers.get("Origin"));
    if (request.method === "OPTIONS") return new Response(null, { headers });
    const url = new URL(request.url);
    if (url.pathname === "/news-check") {
      // Test page for the Test brief server workflow. No AI, but it calls the SEC and the
      // news sites, so it's capped per day to keep the server in good standing with them.
      const t = (url.searchParams.get("symbol") || "AAPL").toUpperCase().split(":").pop();
      if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(t)) return json({ error: "bad ticker" }, 400, headers);
      if (!(await countUp(env, "checks:" + today(), Number(env.CHECK_LIMIT || 30)))) return json({ error: "Feed checks are used up for today." }, 429, headers);
      return json(await checkFeeds(t), 200, headers);
    }
    if (url.pathname !== "/brief") return json({ error: "not found" }, 404, headers);

    const symbol = (url.searchParams.get("symbol") || "").toUpperCase();
    if (!/^([A-Z]{1,10}:)?[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol)) return json({ error: "That doesn't look like a stock ticker." }, 400, headers);
    const ticker = symbol.split(":").pop();

    const saved = await env.BRIEFS.get("brief:" + ticker, "json");
    if (saved) return json(saved, 200, headers);

    // Daily limits, checked only once the news is in (typos and stocks with no news don't count):
    // DAILY_LIMIT new briefs a day for the whole site, and VISITOR_LIMIT for any one internet
    // address, so nobody can use up the whole day's briefs. A school shares one address.
    const day = today();
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const counted = [];
    const beforeAI = async () => {
      if (!(await countUp(env, `visitor:${day}:${ip}`, Number(env.VISITOR_LIMIT || 25)))) throw Object.assign(new Error("visitor limit"), { kind: "visitor" });
      counted.push(`visitor:${day}:${ip}`);
      if (!(await countUp(env, "count:" + day, Number(env.DAILY_LIMIT || 40)))) throw Object.assign(new Error("daily limit"), { kind: "daily" });
      counted.push("count:" + day);
    };

    try {
      const b = await writeBrief(env.GEMINI_API_KEY, symbol, env.GEMINI_MODEL || "gemini-3.5-flash-lite", { beforeAI });
      const brief = { ticker, symbol, ...b, updatedAt: new Date().toISOString(), auto: true, writer: "Gemini" };
      await env.BRIEFS.put("brief:" + ticker, JSON.stringify(brief), { expirationTtl: DAY });
      return json(brief, 200, headers);
    } catch (e) {
      console.error(symbol, e.message || e);
      // No brief was written, so give back anything already counted.
      if (["limit-minute", "daily", "visitor"].includes(e.kind)) for (const k of counted) await countDown(env, k);
      if (e.kind === "no-news") return json({ error: `We couldn't find enough recent news for ${ticker}. Make sure you typed the stock's ticker symbol, not the company name (for example NFLX for Netflix).` }, 404, headers);
      if (e.kind === "limit-minute") return json({ error: "Lots of people are asking for briefs right now. Try again in a minute." }, 429, headers);
      if (e.kind === "limit-day" || e.kind === "daily") return json({ error: "We've written all the free briefs we can for today. Try again tomorrow." }, 429, headers);
      if (e.kind === "visitor") return json({ error: "This network has asked for a lot of new briefs today. Try again tomorrow." }, 429, headers);
      return json({ error: "The brief couldn't be written right now. Try again in a minute.", reason: String(e.message || e).slice(0, 160) }, 502, headers);
    }
  },
};

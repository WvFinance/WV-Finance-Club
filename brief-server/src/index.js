// WV Finance Club brief server.
// GET /brief?symbol=NASDAQ:AMD returns a news brief in the same shape as data/news.json.
// Briefs are saved for a day so the same stock is only written once a day.
import { writeBrief } from "./gemini.js";

const DAY = 24 * 60 * 60;

function cors(env, origin) {
  const ok = origin === env.ALLOWED_ORIGIN || /^http:\/\/localhost(:\d+)?$/.test(origin || "");
  return {
    "Access-Control-Allow-Origin": ok ? origin : env.ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Vary": "Origin",
  };
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json" } });
}

export default {
  async fetch(request, env) {
    const headers = cors(env, request.headers.get("Origin"));
    if (request.method === "OPTIONS") return new Response(null, { headers });
    const url = new URL(request.url);
    if (url.pathname !== "/brief") return json({ error: "not found" }, 404, headers);

    const symbol = (url.searchParams.get("symbol") || "").toUpperCase();
    if (!/^([A-Z]{1,10}:)?[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol)) return json({ error: "That doesn't look like a stock ticker." }, 400, headers);
    const ticker = symbol.split(":").pop();

    const saved = await env.BRIEFS.get("brief:" + ticker, "json");
    if (saved) return json(saved, 200, headers);

    // Daily cap so a busy day stays inside the free limit.
    const today = new Date().toISOString().slice(0, 10);
    const used = Number(await env.BRIEFS.get("count:" + today)) || 0;
    if (used >= Number(env.DAILY_LIMIT || 40)) return json({ error: "We've written all the briefs we can for today. Try again tomorrow." }, 429, headers);
    await env.BRIEFS.put("count:" + today, String(used + 1), { expirationTtl: 2 * DAY });

    try {
      const b = await writeBrief(env.GEMINI_API_KEY, symbol, env.GEMINI_MODEL || "gemini-flash-latest");
      const brief = { ticker, symbol, ...b, updatedAt: new Date().toISOString(), auto: true };
      await env.BRIEFS.put("brief:" + ticker, JSON.stringify(brief), { expirationTtl: DAY });
      return json(brief, 200, headers);
    } catch (e) {
      if (e.limit) return json({ error: "We've used today's free briefs. Try again tomorrow." }, 429, headers);
      console.error(symbol, e);
      return json({ error: "The brief couldn't be written right now. Try again in a minute." }, 502, headers);
    }
  },
};

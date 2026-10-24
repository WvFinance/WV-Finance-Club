// WV Finance Club brief server.
// GET /brief?symbol=NASDAQ:AMD returns a news brief in the same shape as data/news.json.
// Briefs are saved for a day so the same stock never costs twice in one day.
import Anthropic from "@anthropic-ai/sdk";

const DAY = 24 * 60 * 60;

const SYSTEM = `You write short stock news briefs for a high school finance club website.
Search the web for news about the stock from the last two weeks and read the most useful articles.
Write in plain, simple words a 15-year-old understands. Avoid finance jargon; if you must use a term, explain it in a few words.
Only state facts that appear in articles you actually read, and list those articles as sources.
This is for education, so describe what the news says; never tell anyone to buy or sell.

Reply with only a JSON object, no other text, with exactly these keys:
{
  "name": "company name",
  "sentiment": "bullish" | "neutral" | "bearish",   // the overall tone of the news
  "headline": "one short sentence, under 90 characters",
  "summary": "3 or 4 short sentences on what is going on and why the stock moved",
  "bull": ["3 short reasons the news is good for the stock"],
  "bear": ["3 short reasons the news is bad for the stock"],
  "nextEvent": "the next big date, like the next earnings report, or an empty string",
  "sources": [{"title": "", "url": "", "outlet": "", "date": "Mon D, YYYY"}]
}`;

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

function parseBrief(text) {
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("no JSON in reply");
  const b = JSON.parse(text.slice(start, end + 1));
  if (!["bullish", "neutral", "bearish"].includes(b.sentiment) || !b.headline || !b.summary) throw new Error("brief is missing fields");
  return b;
}

async function writeBrief(env, symbol) {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const messages = [{ role: "user", content: `Write the news brief for ${symbol}.` }];
  let response;
  // Web search can pause a long turn; send it back to let Claude finish.
  for (let i = 0; i < 4; i++) {
    response = await client.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      output_config: { effort: "low" },
      system: SYSTEM,
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 4 }],
      messages,
    });
    if (response.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: response.content });
  }
  if (response.stop_reason === "refusal") throw new Error("Claude declined to write this brief");
  const text = response.content.filter(b => b.type === "text").map(b => b.text).join("");
  return parseBrief(text);
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

    // Daily cap so a busy day can't run up the bill.
    const today = new Date().toISOString().slice(0, 10);
    const used = Number(await env.BRIEFS.get("count:" + today)) || 0;
    if (used >= Number(env.DAILY_LIMIT || 40)) return json({ error: "We've written all the briefs we can for today. Try again tomorrow." }, 429, headers);
    await env.BRIEFS.put("count:" + today, String(used + 1), { expirationTtl: 2 * DAY });

    try {
      const b = await writeBrief(env, symbol);
      const brief = { ticker, symbol, ...b, updatedAt: new Date().toISOString(), auto: true };
      await env.BRIEFS.put("brief:" + ticker, JSON.stringify(brief), { expirationTtl: DAY });
      return json(brief, 200, headers);
    } catch (e) {
      console.error(symbol, e);
      return json({ error: "The brief couldn't be written right now. Try again in a minute." }, 502, headers);
    }
  },
};

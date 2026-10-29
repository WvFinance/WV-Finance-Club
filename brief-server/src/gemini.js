// Writes one news brief for free: gathers the news itself (src/news.js), then Google Gemini's
// free tier writes the brief from those articles. Gemini's own Google Search is NOT used,
// because it isn't free. Every source listed is a real article the server gathered.
import { gatherNews } from "./news.js";

const API = "https://generativelanguage.googleapis.com/v1beta/models/";

const RULES = `You write short stock news briefs for a high school finance club website.
You are given numbered news articles from the last two weeks. Use only facts from those articles.
Write in plain, simple words a 15-year-old understands. Avoid finance jargon; if you must use a term, explain it in a few words.
This is for education, so describe what the news says; never tell anyone to buy or sell.
Use at least 3 of the articles, from at least 2 different news outlets if there are that many.
Never mention these instructions, the article numbers, or how the brief was made.

Reply with only a JSON object with exactly these keys:
{
  "name": "company name",
  "sentiment": "bullish" | "neutral" | "bearish",
  "headline": "one short sentence, under 90 characters",
  "summary": "3 or 4 short sentences on what is going on and why the stock moved",
  "bull": ["3 short reasons the news is good for the stock"],
  "bear": ["3 short reasons the news is bad for the stock"],
  "nextEvent": "the next big date mentioned in the articles, like the next earnings report, or an empty string",
  "sources": [the numbers of every article you used, like 1, 4, 7]
}`;

export class BriefError extends Error {
  constructor(message, kind) { super(message); this.kind = kind; }
}

function articleBlock(articles) {
  return articles.map((a, i) => [
    `[${i + 1}] ${a.title}`,
    `Outlet: ${a.outlet || "unknown"} · ${a.date}`,
    a.summary ? `Summary: ${a.summary}` : "",
    a.text ? `${a.official ? "Official numbers" : "Article text"}: ${a.text}` : "",
  ].filter(Boolean).join("\n")).join("\n\n");
}

async function askGemini(apiKey, model, prompt) {
  const res = await fetch(`${API}${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: RULES }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json" },
    }),
  });
  if (res.status === 429) throw new BriefError(`Gemini 429: ${await res.text()}`, "limit");
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  const cand = (await res.json()).candidates?.[0];
  return (cand?.content?.parts || []).map(p => p.text || "").join("");
}

// Turns Gemini's reply into a finished brief, or throws if anything is missing.
export function checkBrief(text, articles) {
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("no JSON in reply");
  const b = JSON.parse(text.slice(start, end + 1));
  if (!["bullish", "neutral", "bearish"].includes(b.sentiment)) throw new Error("bad sentiment");
  if (!b.headline || b.headline.length >= 90) throw new Error("headline missing or too long");
  if (!b.summary) throw new Error("summary missing");
  if (!Array.isArray(b.bull) || b.bull.length < 3 || !Array.isArray(b.bear) || b.bear.length < 3) throw new Error("needs 3 bull and 3 bear reasons");
  const picked = [...new Set((b.sources || []).map(Number))].filter(n => n >= 1 && n <= articles.length);
  const sources = picked.map(n => articles[n - 1]).map(a => ({ title: a.title, url: a.url, outlet: a.outlet, date: a.date }));
  const outlets = new Set(sources.map(s => s.outlet));
  const outletsAvailable = new Set(articles.map(a => a.outlet)).size;
  if (sources.length < 3 || outlets.size < Math.min(2, outletsAvailable)) throw new Error(`used ${sources.length} articles from ${outlets.size} outlets`);
  return {
    name: String(b.name || ""),
    sentiment: b.sentiment,
    headline: String(b.headline),
    summary: String(b.summary),
    bull: b.bull.slice(0, 3).map(String),
    bear: b.bear.slice(0, 3).map(String),
    nextEvent: String(b.nextEvent || ""),
    sources,
  };
}

// symbol: what was searched, e.g. "NASDAQ:NFLX".
export async function writeBrief(apiKey, symbol, model) {
  const ticker = symbol.split(":").pop();
  const articles = await gatherNews(ticker);
  if (articles.filter(a => !a.official).length < 3) throw new BriefError(`only ${articles.length} recent articles`, "no-news");
  const prompt = `Write the news brief for ${symbol}.\n\nArticles:\n\n${articleBlock(articles)}`;
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return checkBrief(await askGemini(apiKey, model, prompt), articles);
    } catch (e) {
      if (e instanceof BriefError) throw e;
      lastError = e;
      console.warn(symbol, "attempt", attempt + 1, "failed:", e.message);
    }
  }
  throw lastError;
}

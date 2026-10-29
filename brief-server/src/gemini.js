// Writes one news brief for free: gathers the news itself (src/news.js), then Google Gemini's
// free tier writes the brief from those articles. Gemini's own Google Search is NOT used,
// because it isn't free. Every source listed is a real article the server gathered.
import { gatherNews } from "./news.js";
import { wordingProblems, explainJargon, givesAdvice } from "./wording.js";

const API = "https://generativelanguage.googleapis.com/v1beta/models/";

const RULES = `You write short stock news briefs for a high school finance club website.
You are given numbered news articles from the last two weeks. Use only facts from those articles.
If an item is marked "Official numbers", those are the company's own results from its report to the government; you may quote them.

WORDING (very important): readers are high school students, so write at about a 9th-grade reading level.
- Short sentences (under about 20 words) and everyday words.
- Say "sales", not "revenue". "Profit per share", not "EPS". "The company's forecast", not "guidance".
  "Compared with last year", not "year-over-year". "How much of each dollar of sales is profit", not "margin".
  "What analysts expected", not "consensus". "Spending on buildings and equipment", not "capex".
- If you must use a finance term (like "price target"), explain it in a few words in parentheses right after it.
- Say "the July-to-September quarter" or "the last three months", not "Q3". Say "the company's year", not "fiscal year".
- Round big numbers: "$11.5 billion", not "$11,512,000,000". Use only the 2 or 3 most important numbers in the summary.
- Say who said something when it matters ("analysts at Barclays", "the company").

Here is an example of the style to copy (a different company):
Headline: "Coca-Cola hits a record high after winning KFC away from Pepsi"
Summary: "On October 15, KFC said its US restaurants will drop Pepsi drinks and switch to Coca-Cola starting in January 2027. KFC had served Pepsi since 1986. A week later, Coca-Cola's stock hit an all-time high of about $94, up about 34% from a year earlier."
Good reason: "On October 16, the bank Barclays raised its price target (its guess of what the stock could be worth) from $93 to $98."
Bad reason: "BARC raised PT to $98 on accelerating FCF and margin expansion."

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
  if (res.status === 429) {
    // Google's free tier has a per-day and a per-minute limit; they need different messages.
    const body = await res.text();
    throw new BriefError(`Gemini 429: ${body.slice(0, 300)}`, /PerDay/i.test(body) ? "limit-day" : "limit-minute");
  }
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
    sourceNumbers: picked,
  };
}

// One rewrite if the wording is too hard; keeps whichever version has fewer problems.
async function simplify(apiKey, model, prompt, articles, brief) {
  const problems = wordingProblems(brief);
  if (!problems.length) return brief;
  try {
    const ask = `${prompt}\n\nHere is a draft of the brief:\n${JSON.stringify({ ...brief, sources: undefined })}\n\nRewrite it so a high school student understands it easily. Fix these problems:\n- ${problems.join("\n- ")}\nKeep the same facts. Reply with the full JSON object, with the same "sources" numbers as before: ${JSON.stringify(brief.sourceNumbers)}.`;
    const again = checkBrief(await askGemini(apiKey, model, ask), articles);
    return wordingProblems(again).length <= problems.length ? again : brief;
  } catch (e) {
    if (e instanceof BriefError) throw e;
    console.warn("rewrite failed:", e.message);
    return brief;
  }
}

// symbol: what was searched, e.g. "NASDAQ:NFLX".
// beforeAI runs once the news is gathered and just before Gemini is used, so the daily limits
// only count real briefs (typos and stocks with no news don't use up the day's briefs).
export async function writeBrief(apiKey, symbol, model, { beforeAI } = {}) {
  const ticker = symbol.split(":").pop();
  const articles = await gatherNews(ticker);
  if (articles.filter(a => !a.official).length < 3) throw new BriefError(`only ${articles.length} recent articles`, "no-news");
  if (beforeAI) await beforeAI();
  const prompt = `Write the news brief for ${symbol}.\n\nArticles:\n\n${articleBlock(articles)}`;
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const brief = explainJargon(await simplify(apiKey, model, prompt, articles, checkBrief(await askGemini(apiKey, model, prompt), articles)));
      // Education only: a brief that still gives buy/sell advice after the rewrite is never shown.
      if (givesAdvice(brief)) throw new Error("brief gives buy/sell advice");
      delete brief.sourceNumbers;
      return brief;
    } catch (e) {
      if (e instanceof BriefError) throw e;
      lastError = e;
      console.warn(symbol, "attempt", attempt + 1, "failed:", e.message);
    }
  }
  throw lastError;
}

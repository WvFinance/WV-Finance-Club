// The brief's instructions and format check, shared by the brief server, the weekly API refresh
// and the free morning refresh (scripts/morning-briefs.mjs). No packages needed, so it runs anywhere.
export const SYSTEM = `You write short stock news briefs for a high school finance club website.
Search the web for news about the stock from the last two weeks and read the most useful articles.
Use at least 3 different articles from at least 2 different news sites, and list every one you used.
Write in plain, simple words a 15-year-old understands. Avoid finance jargon; if you must use a term, explain it in a few words.
Only state facts that appear in articles you actually read, and list those articles as sources.
This is for education, so describe what the news says; never tell anyone to buy or sell.

If you find fewer articles than that, still write the best brief you can from what you found. Never mention your tools, limits or process in the brief.

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

// Rejects replies that aren't a finished brief, so a half-done draft never reaches the site.
const NOT_DONE = /incomplete|not ready|could not be (finished|confirmed)|draft|usage limit|tool limit|please (run|check)/i;
export function parseBrief(text, minSources = 1) {
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("no JSON in reply");
  const b = JSON.parse(text.slice(start, end + 1));
  if (!["bullish", "neutral", "bearish"].includes(b.sentiment) || !b.headline || !b.summary) throw new Error("brief is missing fields");
  const sources = (b.sources || []).filter(x => x && /^https?:\/\//.test(x.url || ""));
  if (sources.length < minSources) throw new Error(`only ${sources.length} sources`);
  if (NOT_DONE.test(b.headline + " " + b.summary)) throw new Error("brief is unfinished");
  return { ...b, sources };
}

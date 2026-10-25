// Writes one news brief with Claude and web search. Shared by the brief server and the weekly refresh.
import Anthropic from "@anthropic-ai/sdk";

const SYSTEM = `You write short stock news briefs for a high school finance club website.
Search the web for news about the stock from the last two weeks and read the most useful articles.
Use at least 3 different articles from at least 2 different news sites, and list every one you used.
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

export function parseBrief(text) {
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("no JSON in reply");
  const b = JSON.parse(text.slice(start, end + 1));
  if (!["bullish", "neutral", "bearish"].includes(b.sentiment) || !b.headline || !b.summary) throw new Error("brief is missing fields");
  return b;
}

// subject: what to write about, e.g. "NASDAQ:AMD" or "the S&P 500 (the whole US stock market)".
export async function writeBrief(apiKey, subject) {
  const client = new Anthropic({ apiKey });
  const messages = [{ role: "user", content: `Write the news brief for ${subject}.` }];
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


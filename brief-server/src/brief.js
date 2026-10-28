// Writes one news brief with Claude and web search. Shared by the brief server and the weekly refresh.
import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM, parseBrief } from "./brief-format.js";
export { parseBrief };

// subject: what to write about, e.g. "NASDAQ:AMD" or "the S&P 500 (the whole US stock market)".
export async function writeBrief(apiKey, subject, { minSources = 1 } = {}) {
  const client = new Anthropic({ apiKey });
  const messages = [{ role: "user", content: `Write the news brief for ${subject}.` }];
  let response;
  // Web search can pause a long turn; send it back to let Claude finish.
  for (let i = 0; i < 4; i++) {
    response = await client.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      output_config: { effort: "medium" },
      system: SYSTEM,
      tools: [
        { type: "web_search_20260209", name: "web_search", max_uses: 10 },
        { type: "web_fetch_20260209", name: "web_fetch", max_uses: 6 },
      ],
      messages,
    });
    if (response.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: response.content });
  }
  if (response.stop_reason === "refusal") throw new Error("Claude declined to write this brief");
  const text = response.content.filter(b => b.type === "text").map(b => b.text).join("");
  return parseBrief(text, minSources);
}


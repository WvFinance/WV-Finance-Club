# Brief server

Writes a news brief for any stock someone searches on the site, for free. It runs on Cloudflare Workers (free plan).

How a brief is made:
1. `src/news.js` gathers the stock's news from the last two weeks from free public feeds (Google News, Bing News and Yahoo Finance), up to 15 articles mixed across the feeds, and reads the full text of up to 6 of them when the site allows it.
2. `src/sec.js` adds the company's latest official quarterly numbers (sales and profit) from the SEC's free EDGAR data, written as plain sentences. The SEC requires a contact email in each request; the club email is set in `sec.js`. If the SEC is unreachable, briefs are written without its numbers.
3. `src/gemini.js` hands everything to Google Gemini's free tier (model set by `GEMINI_MODEL` in `wrangler.toml`), with wording rules for high school readers and an example brief to copy. Gemini's own Google Search is not used, because it isn't free.
4. The server checks the brief: 3 bull and 3 bear reasons, a short headline, at least 3 articles from at least 2 outlets, and (`src/wording.js`) no unexplained finance jargon and a reading level of about grade 9. If the wording is too hard, Gemini rewrites it once. The server fills in the source links itself, so every source is a real article.

The **Test brief server** workflow shows each test brief's headline, sources, reading level and any jargon at the top of the run page, and turns red if no brief comes back.

## One-time setup

1. An adult (18+, age-verified Google account) creates a free Gemini API key at https://aistudio.google.com (Get API key). Don't add billing, so it can never charge.
2. Create a free Cloudflare account at https://dash.cloudflare.com and open **Workers & Pages** once.
3. Create a Cloudflare API token from the **Edit Cloudflare Workers** template.
4. In this GitHub repository, go to **Settings → Secrets and variables → Actions** and add two secrets: `CLOUDFLARE_API_TOKEN` and `GEMINI_API_KEY`.
5. Run the **Deploy brief server** workflow (it also runs by itself whenever `brief-server/` changes). Its log prints the server's address.
6. Put that address in `briefApi` in `config.js` at the root of the site.

## Cost and limits

$0. The news feeds and SEC data are free and need no key, and Gemini without Google Search is free on its free tier. Nothing is ever charged; when a limit is reached, the site says when to try again.

- A brief is saved for 24 hours, so searching the same stock again that day reuses it.
- `DAILY_LIMIT` in `wrangler.toml`: new briefs per day for the whole site (40).
- `VISITOR_LIMIT`: new briefs per day from one internet address (25), so nobody can use up the whole day. A school network counts as one address.
- Only real briefs count. Typos and stocks with no recent news don't use up the day's briefs.
- `CHECK_LIMIT`: calls per day to `/news-check`, the free feed check the test workflow uses (30).

The API key lives only in Cloudflare's secret storage. Never put it in this repository, because the repository is public.

## Daily portfolio briefs

The S&P 500, Nasdaq and portfolio stock briefs in `data/news.json` are written for free every weekday morning by a scheduled Claude task, using `scripts/morning-briefs.mjs`. `scripts/refresh-news.mjs` is an old paid backup: the **Refresh news briefs** workflow runs it only when started by hand, and it needs an `ANTHROPIC_API_KEY` secret (Claude API, about 55 cents a brief).

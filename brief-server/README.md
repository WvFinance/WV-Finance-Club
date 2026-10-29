# Brief server

Writes a news brief for any stock someone searches on the site, for free. It runs on Cloudflare Workers (free plan).

How a brief is made:
1. `src/news.js` gathers the stock's news from the last two weeks from free public feeds (Google News and Yahoo Finance), up to 15 articles, and reads the full text of up to 3 of them when the site allows it.
2. `src/gemini.js` hands those articles to Google Gemini's free tier (model set by `GEMINI_MODEL` in `wrangler.toml`), which writes the brief in the same format as `data/news.json`. Gemini's own Google Search is not used, because it isn't free.
3. The server checks the brief (3 bull and 3 bear reasons, a short headline, at least 3 articles from at least 2 outlets) and fills in the source links itself, so every source is a real article. If there isn't enough recent news, the site says so.

## One-time setup

1. An adult (18+, age-verified Google account) creates a free Gemini API key at https://aistudio.google.com (Get API key). Don't add billing, so it can never charge.
2. Create a free Cloudflare account at https://dash.cloudflare.com and open **Workers & Pages** once.
3. Create a Cloudflare API token from the **Edit Cloudflare Workers** template.
4. In this GitHub repository, go to **Settings → Secrets and variables → Actions** and add two secrets: `CLOUDFLARE_API_TOKEN` and `GEMINI_API_KEY`.
5. Run the **Deploy brief server** workflow (it also runs by itself whenever `brief-server/` changes). Its log prints the server's address.
6. Put that address in `briefApi` in `config.js` at the root of the site.

## Cost

$0. The news feeds are free and need no key, and Gemini without Google Search is free on its free tier. A brief is saved for 24 hours, so searching the same stock again that day reuses it. `DAILY_LIMIT` in `wrangler.toml` caps new briefs per day (40). If Google's free limit is reached, the site says to try again tomorrow; nothing is ever charged.

The API key lives only in Cloudflare's secret storage. Never put it in this repository, because the repository is public.

## Daily portfolio briefs

The S&P 500, Nasdaq and portfolio stock briefs in `data/news.json` are written for free every weekday morning by a scheduled Claude task, using `scripts/morning-briefs.mjs`. `scripts/refresh-news.mjs` is an old paid backup: the **Refresh news briefs** workflow runs it only when started by hand, and it needs an `ANTHROPIC_API_KEY` secret (Claude API, about 55 cents a brief).

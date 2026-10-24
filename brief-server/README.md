# Brief server

Writes a news brief for any stock someone searches on the site. It runs on Cloudflare Workers (free plan) and uses the Claude API, which needs a paid API key owned by an adult (the club sponsor).

## One-time setup

1. The sponsor creates an account at https://console.anthropic.com, adds a card, sets a monthly spend limit (for example $10), and creates an API key.
2. Create a free Cloudflare account at https://dash.cloudflare.com.
3. In this folder:
   ```
   npm install
   npx wrangler login
   npx wrangler kv namespace create BRIEFS     # paste the id into wrangler.toml
   npx wrangler secret put ANTHROPIC_API_KEY   # paste the key when asked
   npx wrangler deploy
   ```
4. Copy the URL it prints (like `https://wvfc-brief-server.<name>.workers.dev`) into `briefApi` in `config.js` at the root of the site.

## Cost

Each new brief does a few web searches and reads a few articles, roughly 10 to 25 cents. A brief is saved for 24 hours, so searching the same stock again that day is free. `DAILY_LIMIT` in `wrangler.toml` caps new briefs per day (40 by default), and the spend limit in the Claude Console is a hard backstop.

The API key lives only in Cloudflare's secret storage. Never put it in this repository, because the repository is public.

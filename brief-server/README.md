# Brief server

Writes a news brief for any stock someone searches on the site. It runs on Cloudflare Workers (free plan) and uses the Claude API, which needs a paid API key owned by an adult (the club sponsor).

## One-time setup

1. The sponsor creates an account at https://console.anthropic.com, adds a card, sets a monthly spend limit (for example $10), and creates an API key.
2. Create a free Cloudflare account at https://dash.cloudflare.com.
3. In Cloudflare, open **Workers & Pages** once so it sets up your free `workers.dev` address.
4. Create a Cloudflare API token from the **Edit Cloudflare Workers** template.
5. In this GitHub repository, go to **Settings → Secrets and variables → Actions** and add two secrets: `CLOUDFLARE_API_TOKEN` and `ANTHROPIC_API_KEY`.
6. Run the **Deploy brief server** workflow (Actions tab → Deploy brief server → Run workflow). Its log prints the server's address, like `https://wvfc-brief-server.<name>.workers.dev`.
7. Put that address in `briefApi` in `config.js` at the root of the site.

## Cost

Each new brief does a few web searches and reads a few articles, roughly 10 to 25 cents. A brief is saved for 24 hours, so searching the same stock again that day is free. `DAILY_LIMIT` in `wrangler.toml` caps new briefs per day (40 by default), and the spend limit in the Claude Console is a hard backstop.

The API key lives only in Cloudflare's secret storage. Never put it in this repository, because the repository is public.

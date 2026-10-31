# WV Finance Club

The Waubonsie Valley Finance Club's website: our class portfolio, stock research and news briefs.

**Live site:** https://wvfinance.github.io/WV-Finance-Club/

## What's on the site

- **Class Portfolio**: every stock the club owns, what we paid, how many shares, what it's worth now, and how it compares with putting the same money in the S&P 500.
- **Search**: look up any stock with TradingView's live candlestick chart, quote, key financials and latest headlines. Members can keep a personal watchlist on their own device.
- **News**: Claude's Bullish/Neutral/Bearish briefs for the S&P 500, the Nasdaq and every stock in the portfolio, with links to the sources, plus a live headline feed.

## How a stock gets into the portfolio

1. A member pitches a stock and debates another member at a meeting.
2. The audience votes A or B on the Google Form and explains why. The form saves its answers to a Google Sheet.
3. Claude counts the votes, writes the winning stock's thesis from the audience's reasons, and adds it to `data/portfolio.json` at that day's price.

## Files

| File | What it holds |
|---|---|
| `index.html` | The page layout |
| `assets/style.css` | Colors and layout (black, white, green and gold) |
| `assets/app.js` | Everything the page does |
| `config.js` | Settings, including the optional Finnhub key |
| `data/portfolio.json` | The club's picks |
| `data/news.json` | Claude's news briefs |
| `data/prices.json` | Daily closing prices, updated automatically |
| `scripts/update_prices.py`, `.github/workflows/update-prices.yml` | The robot that refreshes `prices.json` every weekday after the market closes |

### A pick in `data/portfolio.json`

```json
{
  "ticker": "NVDA",
  "symbol": "NASDAQ:NVDA",
  "name": "Nvidia Corp.",
  "sector": "Tech",
  "entryDate": "2026-11-05",
  "entryPrice": 217.09,
  "invested": 1000,
  "shares": 4.6064,
  "spyEntryPrice": 681.50,
  "pitchedBy": "Student name",
  "thesis": "Summary of why the audience voted for it.",
  "debate": { "opponent": "AAPL", "votesFor": 18, "votesAgainst": 7, "date": "2026-11-05" }
}
```

`sector` is the type of business (Tech, Banks, Health, Energy and so on) and powers the sector pie chart. `spyEntryPrice` is the S&P 500 fund's (SPY) price on the same day, so the site can compare our pick with the market.

## Live prices

Every weekday after the market closes, a GitHub Action saves the day's closing prices for our stocks and SPY into `data/prices.json`. The portfolio values, the positions table and the "Club vs S&P 500 over time" chart use those prices.

Charts, search and headlines come from TradingView's free widgets and need no account. The dollar values on the portfolio tab use [Finnhub](https://finnhub.io/register): create a free account, copy the API key, and put it in `config.js`. A free key allows 60 lookups a minute, which is plenty for the club.

## Member accounts (test page)

`beta.html` is a test copy of the site where each member logs in with their own email and password instead of the club password. It adds a **My Portfolio** tab: members upload the positions file from Fidelity or Schwab, check what was found, and save it to their account. Their Search watchlist is saved to their account too, so it follows them to any device. The live `index.html` doesn't change.

Logins and data are stored in [Supabase](https://supabase.com). `supabase/setup.sql` creates the tables and the rules that let each member see only their own data; run it once in Supabase's SQL Editor. The project address and publishable key are in `config.js` (the publishable key is meant to be public). Code: `assets/account.js`.

## Trading game

The **Trading** tab is a practice game. Each member who joins gets $50,000 of pretend money to buy and sell real stocks at the real price, and a leaderboard ranks everyone by % gain. Trades only go through while the market is open (weekdays 8:30am to 3pm Chicago time; market holidays aren't counted).

Prices come from [Finnhub](https://finnhub.io). The database looks them up itself, so nobody can send in a fake price, and the Finnhub key is kept in Supabase's Vault, not in the website. `supabase/paper-trading.sql` sets it all up: put the Finnhub key near the top, then run it once in Supabase's SQL Editor. A scheduled job keeps the prices of owned stocks fresh every 10 minutes during market hours. Code: `assets/paper.js`.

---

For education only, not financial advice.

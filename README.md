# WV Finance Club

The Waubonsie Valley Finance Club's website: our class portfolio, stock research and news briefs.

**Live site:** https://wvfinance.github.io/WV-Finance-Club/

## What's on the site

- **Class Portfolio**: every stock the club owns, what we paid, how many shares, what it's worth now, and how it compares with putting the same money in the S&P 500.
- **Search**: look up any stock with TradingView's live candlestick chart, quote, key financials and latest headlines. Members can keep a personal watchlist on their own device.
- **News**: Claude's Bullish/Neutral/Bearish briefs for the S&P 500, the Nasdaq, the Dow, the Russell 2000, Bitcoin, Ethereum and every stock in the portfolio, with links to the sources, plus a live headline feed.

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
| `data/portfolio.json` | Waubonsie's Class Portfolio picks |
| `data/schools.json` | Every school on the site and where its Class Portfolio file is (Neuqua and Metea are in `data/portfolios/`) |
| `supabase/district.sql` | School sign-up codes (checked by the database), each member's school, and the district leaderboard |
| `supabase/individual.sql` | Simple Street "Just me" accounts: sign up without a class code, and join a class later from the Home page |
| `supabase/owned-stocks.sql`, `data/owned.json` | Which stocks people own in Paper Trading (tickers only), saved each weekday so the morning routine writes their briefs |
| `supabase/two-accounts.sql` | One email, two accounts: a class account and a personal account, each with its own Paper Trading money. Switch with Class / Personal at the top |
| `supabase/home-extras.sql` | Home page extras: saves each account's value every weekday (money-over-time chart), invite links and the friends leaderboard |
| `supabase/weekly-challenge.sql` | Weekly school-vs-school challenge: saves each Paper Trading account's value every Monday and ranks schools by average % gain |
| `supabase/usage.sql` | Admin only: counts visitors each day (only the day, per account) for the weekly users table, and checks which setup files are run and how fresh the data is. Shown at the top of the Students tab |
| `privacy.html` | The Privacy and Terms page |
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

## Member accounts

Each member logs in with their own email and password (their school code, like wvhs01, is needed once, to make an account). Their watchlist (on the page that opens from the search bar at the top) is saved to their account, so it follows them to any device. The **My Portfolio** tab shows the stocks, shorts and waiting orders they have in the trading game below. Only they can see it.

Logins and data are stored in [Supabase](https://supabase.com). `supabase/setup.sql` creates the tables and the rules that let each member see only their own data; run it once in Supabase's SQL Editor (it also removes the old `holdings` table that held Fidelity/Schwab uploads). The project address and publishable key are in `config.js` (the publishable key is meant to be public). Code: `assets/account.js`.

## Trading game

The **Paper Trading** tab is a practice game. Each member who joins gets $50,000 of pretend money to buy and sell real stocks at the real price, and a leaderboard ranks everyone by % gain. Trades only go through while the market is open (weekdays 8:30am to 3pm Chicago time; market holidays aren't counted).

Prices come from [Finnhub](https://finnhub.io). The database looks them up itself, so nobody can send in a fake price, and the Finnhub key is kept in Supabase's Vault, not in the website. `supabase/paper-trading.sql` sets it all up: put the Finnhub key near the top, then run it once in Supabase's SQL Editor. A scheduled job keeps the prices of owned stocks fresh during market hours. Code: `assets/paper.js`.

### Order types

`supabase/paper-orders.sql` adds more ways to trade. Run it once in Supabase's SQL Editor, after `paper-trading.sql`.

- **Market**: trade right now at the real price (market hours only).
- **Limit**: wait for a better price. Buy at your price or lower, sell at your price or higher.
- **Stop** (stop loss): once the price passes your line, trade at the price then.
- **Stop-limit**: a stop that turns into a limit order, so it only trades at your limit or better.
- **Trailing stop**: a stop that follows the price. A sell follows the highest price and trades if it drops a set % below it.
- **Short / Buy to cover**: bet a stock goes down by selling borrowed shares and buying them back later. All your shorts together can be worth at most half your account, and a short is bought back automatically if the price doubles.

Waiting orders can be placed any time and are checked every 2 minutes while the market is open, so the fill price can be a little different from the line. Each member can have up to 20 waiting orders.

---

For education only, not financial advice.

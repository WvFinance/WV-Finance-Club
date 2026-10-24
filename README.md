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

### A pick in `data/portfolio.json`

```json
{
  "ticker": "NVDA",
  "symbol": "NASDAQ:NVDA",
  "name": "Nvidia Corp.",
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

`spyEntryPrice` is the S&P 500 fund's (SPY) price on the same day, so the site can compare our pick with the market.

## Live prices

Charts, search and headlines come from TradingView's free widgets and need no account. The dollar values on the portfolio tab use [Finnhub](https://finnhub.io/register): create a free account, copy the API key, and put it in `config.js`. A free key allows 60 lookups a minute, which is plenty for the club.

---

For education only, not financial advice.

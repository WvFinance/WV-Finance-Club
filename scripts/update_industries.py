"""Builds data/industries.json for the Industries tab: every stock in data/sectors.json, grouped by industry,
biggest company first, with its last price, today's % change and its % change over about a month.

Free: prices come from Yahoo Finance's public daily chart (the same place scripts/update_prices.py uses).
Runs in GitHub Actions on weekdays during and after market hours (see .github/workflows/update-industries.yml).
If a stock's price can't be downloaded, it is still listed, just without numbers.
"""
import concurrent.futures as cf
import datetime as dt
import json
import pathlib
import time
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "industries.json"
UA = {"User-Agent": "Mozilla/5.0 (WV Finance Club industries updater)"}


def prices(ticker):
    """(last price, % today, % about a month) from Yahoo's chart endpoint, or None."""
    url = (f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(ticker.replace('.', '-'))}"
           "?range=1mo&interval=1d")
    for attempt in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
                res = json.load(r)["chart"]["result"][0]
            closes = [c for c in res["indicators"]["quote"][0]["close"] if c is not None]
            meta = res.get("meta", {})
            last = meta.get("regularMarketPrice") or (closes[-1] if closes else None)
            if not last or len(closes) < 2:
                return None
            # The day before: the second-to-last daily close, unless today's bar isn't in yet.
            prev = closes[-2]
            if meta.get("regularMarketTime") and res.get("timestamp"):
                if dt.datetime.fromtimestamp(res["timestamp"][-1]).date() < dt.datetime.fromtimestamp(meta["regularMarketTime"]).date():
                    prev = closes[-1]
            day = (last / prev - 1) * 100 if prev else None
            month = (last / closes[0] - 1) * 100 if closes[0] else None
            return [round(last, 2), None if day is None else round(day, 2), None if month is None else round(month, 1)]
        except Exception as e:  # rate limits and hiccups: wait and try again
            if attempt == 2:
                print(f"{ticker}: {e}")
            time.sleep(2 + attempt * 3)
    return None


def main():
    sectors = json.loads((ROOT / "data" / "sectors.json").read_text())["sectors"]
    stocks = json.loads((ROOT / "data" / "stocks.json").read_text())["stocks"]
    rank = {s[0]: (i, s[1]) for i, s in enumerate(stocks)}
    tickers = sorted(sectors, key=lambda t: rank.get(t, (10**6, ""))[0])
    with cf.ThreadPoolExecutor(max_workers=6) as pool:
        got = dict(zip(tickers, pool.map(prices, tickers)))
    ok = sum(1 for v in got.values() if v)
    old = {}
    if OUT.exists():  # keep yesterday's numbers for any stock that failed this time
        try:
            for rows in json.loads(OUT.read_text()).get("industries", {}).values():
                for r in rows:
                    if len(r) > 2 and r[2] is not None:
                        old[r[0]] = r[2:]
        except Exception:
            pass
    if ok < len(tickers) * 0.5 and old:
        raise SystemExit(f"Only got prices for {ok} of {len(tickers)} stocks; keeping the old file.")
    groups = {}
    for t in tickers:
        name = rank.get(t, (0, t))[1]
        groups.setdefault(sectors[t], []).append([t, name] + (got[t] or old.get(t) or [None, None, None]))
    out = {"updated": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
           "source": "Yahoo Finance prices; industries from data/sectors.json",
           "columns": ["ticker", "name", "price", "today %", "month %"],
           "industries": dict(sorted(groups.items()))}
    OUT.write_text(json.dumps(out, separators=(",", ":")) + "\n")
    print(f"Wrote {len(tickers)} stocks in {len(groups)} industries ({ok} with fresh prices) to {OUT}")


if __name__ == "__main__":
    main()

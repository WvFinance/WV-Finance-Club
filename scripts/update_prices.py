"""Download daily closing prices for every stock in the portfolio plus SPY, QQQ and DIA.

Writes data/prices.json, which the site uses for current values and the
"Club vs S&P 500" chart. Runs in GitHub Actions (see .github/workflows).
"""
import datetime as dt
import json
import pathlib
import time
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
PORTFOLIO = ROOT / "data" / "portfolio.json"
OUT = ROOT / "data" / "prices.json"
UA = {"User-Agent": "Mozilla/5.0 (WV Finance Club price updater)"}


def yahoo_closes(ticker, start):
    """Return {YYYY-MM-DD: close} from Yahoo Finance's chart endpoint."""
    p1 = int(dt.datetime.combine(start, dt.time()).replace(tzinfo=dt.timezone.utc).timestamp())
    p2 = int(time.time()) + 86400
    url = (f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}"
           f"?period1={p1}&period2={p2}&interval=1d&events=div%2Csplit")
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
        res = json.load(r)["chart"]["result"][0]
    tz = dt.timezone(dt.timedelta(seconds=res["meta"].get("gmtoffset", 0)))
    closes = res["indicators"]["quote"][0]["close"]
    out = {}
    for ts, c in zip(res.get("timestamp", []), closes):
        if c is not None:
            out[dt.datetime.fromtimestamp(ts, tz).date().isoformat()] = round(c, 4)
    return out


def main():
    picks = json.loads(PORTFOLIO.read_text()).get("picks", [])
    # QQQ and DIA track the Nasdaq 100 and the Dow for the "Market today" box.
    tickers = sorted({p["ticker"].upper() for p in picks if p.get("ticker")} | {"SPY", "QQQ", "DIA"})
    dates = [dt.date.fromisoformat(p["entryDate"]) for p in picks if p.get("entryDate")]
    # Start a few days before the first pick so the chart has a starting close.
    start = (min(dates) if dates else dt.date.today() - dt.timedelta(days=365)) - dt.timedelta(days=7)

    series, failed = {}, []
    for t in tickers:
        try:
            series[t] = yahoo_closes(t.replace(".", "-"), start)
        except Exception as e:  # keep going so one bad ticker doesn't stop the update
            failed.append(t)
            print(f"Could not download {t}: {e}")
        time.sleep(1)

    old = json.loads(OUT.read_text()) if OUT.exists() else {}
    if failed and old.get("closes"):
        # Keep yesterday's numbers for any ticker that failed today.
        for t in failed:
            if t in old["closes"]:
                series[t] = dict(zip(old["dates"], old["closes"][t]))

    all_dates = sorted({d for s in series.values() for d in s})
    data = {
        "updated": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
        "source": "Yahoo Finance daily closes",
        "dates": all_dates,
        "closes": {t: [series[t].get(d) for d in all_dates] for t in sorted(series)},
    }
    OUT.write_text(json.dumps(data, separators=(",", ":")) + "\n")
    print(f"Wrote {len(all_dates)} days for {', '.join(sorted(series))}")


if __name__ == "__main__":
    main()

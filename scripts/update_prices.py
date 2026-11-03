"""Download daily closing prices for every stock in every school's portfolio plus SPY, QQQ and DIA.

Writes data/prices.json, which the site uses for current values and the
"Club vs S&P 500" chart. Runs in GitHub Actions (see .github/workflows).
"""
import datetime as dt
import json
import pathlib
import re
import time
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
SCHOOLS = ROOT / "data" / "schools.json"
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


def all_picks():
    """Every school's picks (data/schools.json says where each school's portfolio file is)."""
    files = [s["portfolio"] for s in json.loads(SCHOOLS.read_text()).get("schools", []) if s.get("portfolio")]
    picks = []
    for f in dict.fromkeys(files or ["data/portfolio.json"]):
        path = ROOT / f
        if path.exists():
            picks += json.loads(path.read_text()).get("picks", [])
    return picks


def site_picks():
    """Stocks teachers bought on the website (saved in Supabase, see supabase/class-portfolio.sql).

    Uses the site's public key from config.js; the database only answers with tickers and first buy dates.
    """
    cfg = (ROOT / "config.js").read_text()
    url = re.search(r'supabaseUrl:\s*"([^"]+)"', cfg)
    key = re.search(r'supabaseKey:\s*"([^"]+)"', cfg)
    if not url or not key:
        return []
    req = urllib.request.Request(url.group(1).rstrip("/") + "/rest/v1/rpc/class_tickers", data=b"{}", method="POST",
                                 headers={**UA, "apikey": key.group(1), "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            rows = json.load(r)
    except Exception as e:  # not set up yet, or Supabase is down: just use the files
        print(f"Could not read stocks bought on the site: {e}")
        return []
    return [{"ticker": x["ticker"], "entryDate": x["first_date"]} for x in rows if x.get("ticker") and x.get("first_date")]


def main():
    picks = all_picks() + site_picks()
    # QQQ and DIA track the Nasdaq 100 and the Dow for the "Market today" box.
    tickers = sorted({p["ticker"].upper() for p in picks if p.get("ticker")} | {"SPY", "QQQ", "DIA"})
    dates = [dt.date.fromisoformat(p["entryDate"]) for p in picks if p.get("entryDate")]
    # Start a few days before the first pick so the chart has a starting close.
    start = (min(dates) if dates else dt.date.today() - dt.timedelta(days=365)) - dt.timedelta(days=7)

    # Crypto picks name their Yahoo symbol, like {"ticker": "BTC", "yahoo": "BTC-USD"}.
    yahoo = {p["ticker"].upper(): p["yahoo"] for p in picks if p.get("ticker") and p.get("yahoo")}

    series, failed = {}, []
    for t in tickers:
        try:
            series[t] = yahoo_closes(yahoo.get(t, t.replace(".", "-")), start)
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

    # Crypto trades every day, but the site works in stock market days: keep only days the market was open.
    if "SPY" in series:
        for t in yahoo:
            if t in series:
                series[t] = {d: c for d, c in series[t].items() if d in series["SPY"]}

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

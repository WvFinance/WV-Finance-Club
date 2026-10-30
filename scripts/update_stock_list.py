"""Download the list of US-listed stocks and funds (ticker, name, exchange) for the search bar's suggestions.

Writes data/stocks.json from the SEC's public company list. Runs in GitHub Actions once a week
(see .github/workflows/update-stock-list.yml). The SEC lists the biggest companies first,
and the site keeps that order to rank suggestions.
"""
import json
import pathlib
import re
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "stocks.json"
URL = "https://www.sec.gov/files/company_tickers_exchange.json"
# The SEC asks for a User-Agent with contact details.
UA = {"User-Agent": "WV Finance Club site wvfinance@users.noreply.github.com"}
EXCHANGES = {"Nasdaq": "NASDAQ", "NYSE": "NYSE", "CBOE": "CBOE"}
SMALL = {"of", "and", "the", "for", "in", "on", "de"}
KEEP_UPPER = {"ETF", "REIT", "LLC", "PLC", "NV", "SA", "AG", "SE", "LP", "ADR", "USA", "US", "II", "III", "IV", "AI", "N.V.", "S.A."}


def nice(name):
    """Turn 'NVIDIA CORP' into 'Nvidia Corp'; names already in mixed case stay as they are."""
    if name != name.upper():
        return name
    words = []
    for i, w in enumerate(name.split()):
        if w in KEEP_UPPER or re.fullmatch(r"[A-Z]+&[A-Z]+\.?", w):
            words.append(w)
        elif i and w.lower() in SMALL:
            words.append(w.lower())
        else:
            words.append(w.capitalize())
    return " ".join(words)


def main():
    with urllib.request.urlopen(urllib.request.Request(URL, headers=UA), timeout=60) as r:
        data = json.load(r)
    cols = data["fields"]
    seen, rows = set(), []
    for row in data["data"]:
        rec = dict(zip(cols, row))
        ex = EXCHANGES.get(rec.get("exchange") or "")
        t = (rec.get("ticker") or "").upper()
        if not ex or not t or t in seen:
            continue
        seen.add(t)
        rows.append([t, nice(rec.get("name") or t), ex])
    if len(rows) < 3000:
        raise SystemExit(f"Only {len(rows)} stocks came back; keeping the old list.")
    OUT.write_text(json.dumps({"source": "SEC company tickers", "stocks": rows}, separators=(",", ":")) + "\n")
    print(f"Wrote {len(rows)} stocks")


if __name__ == "__main__":
    main()

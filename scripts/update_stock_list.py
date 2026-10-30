"""Download the list of US-listed stocks and funds (ticker, name, exchange) for the search bar's suggestions.

Writes data/stocks.json from Nasdaq's public stock screener (biggest companies first), falling back to the SEC's company list. Runs in GitHub Actions once a week
(see .github/workflows/update-stock-list.yml). The site keeps the list's order
(biggest first) to rank suggestions.
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
BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
SMALL = {"of", "and", "the", "for", "in", "on", "de"}
KEEP_UPPER = {"ETF", "REIT", "LLC", "PLC", "NV", "SA", "AG", "SE", "LP", "ADR", "USA", "US", "II", "III", "IV", "AI", "N.V.", "S.A."}


def nice(name):
    """Turn 'NVIDIA CORP' into 'Nvidia Corp' and drop share-type words like 'Common Stock'."""
    name = re.sub(r"\s+(Common Stock|Common Shares|Ordinary Shares|Capital Stock|American Depositary Shares?|Depositary Shares?|Units?)\b.*$", "", name.strip()) or name
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


def get_json(url, headers):
    req = urllib.request.Request(url, headers={**headers, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.load(r)


def from_nasdaq():
    """Nasdaq's stock screener: every Nasdaq/NYSE/AMEX stock with its market value, plus ETFs."""
    h = {"User-Agent": BROWSER_UA}
    rows = []
    for ex in ("nasdaq", "nyse", "amex"):
        data = get_json(f"https://api.nasdaq.com/api/screener/stocks?tableonly=true&download=true&exchange={ex}", h)
        for r in data["data"]["rows"]:
            cap = float(re.sub(r"[^0-9.]", "", r.get("marketCap") or "") or 0)
            rows.append((cap, r["symbol"].strip().upper().replace("/", "."), r["name"].strip(), {"amex": "AMEX"}.get(ex, ex.upper())))
    try:
        etfs = get_json("https://api.nasdaq.com/api/screener/etf?tableonly=true&download=true", h)
        for r in etfs["data"]["data"]["rows"]:
            # Funds have no market value here; rank them like a mid-size company so SPY, QQQ and friends still show up.
            rows.append((5e9, r["symbol"].strip().upper(), r["companyName"].strip(), ""))
    except Exception as e:  # stocks alone are still useful
        print(f"Could not download ETFs: {e}")
    rows.sort(key=lambda x: -x[0])
    return [(t, n, ex) for _, t, n, ex in rows]


def from_sec():
    data = get_json(URL, UA)
    cols = data["fields"]
    return [(r["ticker"], r["name"], EXCHANGES.get(r.get("exchange") or "", "")) for r in (dict(zip(cols, x)) for x in data["data"]) if r.get("exchange") in EXCHANGES]


def main():
    rows, seen = [], set()
    for source in (from_nasdaq, from_sec):
        try:
            got = source()
            print(f"{source.__name__}: {len(got)} rows")
        except Exception as e:
            print(f"{source.__name__} failed: {e}")
            continue
        for t, n, ex in got:
            t = (t or "").upper()
            if t and t not in seen and re.fullmatch(r"[A-Z0-9.\-]{1,8}", t):
                seen.add(t)
                rows.append([t, nice(n or t), ex])
        if len(rows) >= 3000:
            break
    if len(rows) < 3000:
        raise SystemExit(f"Only {len(rows)} stocks came back; keeping the old list.")
    OUT.write_text(json.dumps({"source": "Nasdaq and SEC listings", "stocks": rows}, separators=(",", ":")) + "\n")
    print(f"Wrote {len(rows)} stocks")


if __name__ == "__main__":
    main()

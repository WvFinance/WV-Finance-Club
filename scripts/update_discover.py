"""Builds data/discover.json for the Discover tab's pages. Everything here is free.

 * industries: every stock in data/sectors.json grouped by industry, biggest first, each as
   [ticker, name, price, % today, % about a month, % about a year, dividend yield %]. Used by Industries,
   Find stocks with filters, Surprise me and "Stocks like this".
 * order: every ticker, biggest company first. subs: the finer S&P group for each stock, nsubs: Nasdaq's finer
   group (both for "Stocks like this").
 Stocks: data/sectors.json (S&P 500 + popular stocks, hand-checked industries) plus the 1,500 biggest US stocks from
 Nasdaq's free stock list, sorted into the same plain industries.
 * movers: the 5 biggest gainers and 5 biggest losers today among those stocks, each with its newest headline.
 * ipos: companies that went public in the last ~2 months (with how they've done since) and ones coming up soon,
   from Nasdaq's IPO calendar.

Prices come from Yahoo Finance's public daily chart (the same place scripts/update_prices.py uses), headlines
from Yahoo and Google News like scripts/update_top3.py. Runs in GitHub Actions a few times each weekday
(see .github/workflows/update-discover.yml). If a price can't be downloaded, the last saved one is kept.
"""
import concurrent.futures as cf
import datetime as dt
import email.utils
import html
import json
import pathlib
import re
import time
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "discover.json"
UA = {"User-Agent": "Mozilla/5.0 (WV Finance Club discover updater)"}
BROWSER_UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"}


def get(url, headers=UA, tries=3):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=30) as r:
                return r.read()
        except Exception as e:  # rate limits and hiccups: wait and try again
            if i == tries - 1:
                raise
            time.sleep(2 + i * 3)


def r2(x, n=2):
    return None if x is None else round(x, n)


def prices(ticker):
    """[price, % today, % month, % year, dividend yield %] from Yahoo's chart endpoint, or None."""
    url = (f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(ticker.replace('.', '-'))}"
           "?range=1y&interval=1d&events=div")
    try:
        res = json.loads(get(url))["chart"]["result"][0]
    except Exception as e:
        print(f"{ticker}: {e}")
        return None
    ts = res.get("timestamp") or []
    pts = [(t, c) for t, c in zip(ts, res["indicators"]["quote"][0]["close"]) if c is not None]
    meta = res.get("meta", {})
    last = meta.get("regularMarketPrice") or (pts[-1][1] if pts else None)
    if not last or len(pts) < 2:
        return None
    # The day before: the second-to-last daily close, unless today's bar isn't in yet.
    prev = pts[-2][1]
    if meta.get("regularMarketTime") and dt.date.fromtimestamp(pts[-1][0]) < dt.date.fromtimestamp(meta["regularMarketTime"]):
        prev = pts[-1][1]
    month = pts[max(0, len(pts) - 22)][1]
    year = pts[0][1] if len(pts) > 200 else None
    divs = sum(d.get("amount", 0) for d in ((res.get("events") or {}).get("dividends") or {}).values())
    return [r2(last), r2((last / prev - 1) * 100), r2((last / month - 1) * 100, 1),
            r2((last / year - 1) * 100, 1) if year else None, r2(divs / last * 100) if divs else 0]


# ---------- Headlines (newest from the last 3 days) ----------
def news_yahoo(tk):
    j = json.loads(get(f"https://query1.finance.yahoo.com/v1/finance/search?q={urllib.parse.quote(tk)}&quotesCount=0&newsCount=10"))
    return [{"title": n.get("title", ""), "url": n.get("link", ""), "source": n.get("publisher", ""), "t": int(n.get("providerPublishTime") or 0)}
            for n in j.get("news", []) if tk in [x.upper() for x in n.get("relatedTickers") or []]]


def news_google(tk, name):
    q = urllib.parse.quote(f'"{name}" stock when:3d')
    xml = get(f"https://news.google.com/rss/search?q={q}&hl=en-US&gl=US&ceid=US:en").decode("utf-8", "replace")
    out = []
    for item in re.findall(r"<item>(.*?)</item>", xml, re.S)[:10]:
        g = lambda tag: html.unescape(re.sub(r"<!\[CDATA\[|\]\]>", "", (re.search(rf"<{tag}[^>]*>(.*?)</{tag}>", item, re.S) or [None, ""])[1])).strip()  # noqa: E731
        title, src = g("title"), g("source")
        if src and title.endswith(" - " + src):
            title = title[: -len(src) - 3]
        try:
            t = int(email.utils.parsedate_to_datetime(g("pubDate")).timestamp())
        except Exception:
            t = 0
        out.append({"title": title, "url": g("link"), "source": src, "t": t})
    return out


def headline(tk, name):
    since = time.time() - 3 * 86400
    for f in (lambda: news_yahoo(tk), lambda: news_google(tk, short(name))):
        try:
            got = sorted((n for n in f() if n["title"] and n["t"] >= since), key=lambda n: -n["t"])
            if got:
                n = got[0]
                return {"title": n["title"], "url": n["url"], "source": n["source"],
                        "date": dt.datetime.fromtimestamp(n["t"], dt.timezone.utc).strftime("%Y-%m-%d")}
        except Exception as e:
            print(f"  news {tk}: {e}")
    return None


def short(name):
    """'Apple Inc.' -> 'Apple', for news searches."""
    return re.sub(r",?\s+(Inc\.?|Corp(oration)?\.?|Co\.?|Company|Ltd\.?|plc|PLC|Holdings?|Group|N\.V\.|S\.A\.|Class [A-C]|Incorporated)\b.*$", "", name).strip() or name


# ---------- New on the market ----------
def ipos():
    today = dt.date.today()
    months = sorted({(today.replace(day=1) - dt.timedelta(days=d)).strftime("%Y-%m") for d in (0, 1, 40)}
                    | {(today.replace(day=28) + dt.timedelta(days=5)).strftime("%Y-%m")})
    recent, upcoming, seen = [], [], set()
    for m in months:
        try:
            data = (json.loads(get(f"https://api.nasdaq.com/api/ipo/calendar?date={m}", BROWSER_UA)).get("data") or {})
        except Exception as e:
            print(f"IPO calendar {m}: {e}")
            continue
        for r in ((data.get("priced") or {}).get("rows") or []):
            t = (r.get("proposedTickerSymbol") or "").strip().upper()
            if not t or t in seen:
                continue
            seen.add(t)
            try:
                day = dt.datetime.strptime(r.get("pricedDate") or "", "%m/%d/%Y").date()
            except ValueError:
                continue
            if (today - day).days > 60:
                continue
            raised = float(re.sub(r"[^0-9.]", "", r.get("dollarValueOfSharesOffered") or "") or 0)
            recent.append({"ticker": t, "name": r.get("companyName", "").strip(), "date": day.isoformat(),
                           "ipo_price": float(re.sub(r"[^0-9.]", "", r.get("proposedSharePrice") or "") or 0) or None,
                           "raised": raised, "exchange": (r.get("proposedExchange") or "").strip()})
        for r in (((data.get("upcoming") or {}).get("upcomingTable") or {}).get("rows") or []):
            t = (r.get("proposedTickerSymbol") or "").strip().upper()
            if not t or t in seen:
                continue
            seen.add(t)
            try:
                day = dt.datetime.strptime(r.get("expectedPriceDate") or "", "%m/%d/%Y").date().isoformat()
            except ValueError:
                day = None
            upcoming.append({"ticker": t, "name": r.get("companyName", "").strip(), "date": day,
                             "price_range": (r.get("proposedSharePrice") or "").strip(),
                             "raised": float(re.sub(r"[^0-9.]", "", r.get("dollarValueOfSharesOffered") or "") or 0),
                             "exchange": (r.get("proposedExchange") or "").strip()})
    # Skip blank-check "Acquisition" companies (SPACs): they have no business yet. Tidy ALL-CAPS names.
    spac = lambda x: re.search(r"\bAcquisition\b|\bSPAC\b|Blank Check", x["name"], re.I)  # noqa: E731
    for x in recent + upcoming:
        if x["name"].isupper():
            x["name"] = " ".join(w if w in ("AG", "SA", "NV", "PLC", "LLC", "AI") else w.capitalize() for w in x["name"].split())
    recent = [x for x in recent if not spac(x)]
    upcoming = [x for x in upcoming if not spac(x)]
    # Biggest first, skip tiny ones (under $20 million raised) so the list stays well-known names.
    recent = sorted((x for x in recent if x["raised"] >= 2e7), key=lambda x: -x["raised"])[:15]
    upcoming = sorted((x for x in upcoming if x["raised"] >= 2e7), key=lambda x: (x["date"] or "9999", -x["raised"]))[:10]
    for x in recent:
        p = prices(x["ticker"])
        x["price"] = p[0] if p else None
        x["since"] = r2((p[0] / x["ipo_price"] - 1) * 100, 1) if p and x["ipo_price"] else None
    return {"recent": recent, "upcoming": upcoming}


# ---------- More stocks: the biggest US companies from Nasdaq's free stock list ----------
HOW_MANY = 1500
# Nasdaq's industry words -> our plain industries. Checked in order; the first match wins.
NQ_INDUSTRY = [
    (r"insur", "Insurance"),
    (r"real estate|reit", "Real Estate"),
    (r"bank|savings inst|finance|credit|invest|broker|stock exchange|trust", "Banks"),
    (r"auto manuf|auto parts|motor vehicle|automotive|recreational vehicles", "Cars"),
    (r"hotel|resort|restaurant|casino|gaming|cruise|recreation|amusement|travel|leisure|sporting|ski|theme", "Travel & Fun"),
    (r"movie|entertainment|broadcast|cable|television|radio|advertis|publish|newspaper|telecommunications services|"
     r"telephone|wireless|internet & information|music", "Media"),
    (r"electric util|water supply|power gen|utilit|natural gas distribution", "Utilities"),
    (r"oil|gas production|natural gas|petroleum|coal|integrated oil|energy|refin|pipeline", "Energy"),
    (r"biotech|pharma|medic|hospital|health|dental|ophthalm|diagnost|drug", "Health"),
    (r"semiconductor|software|computer|edp|electronic comp|internet|\bit services|technology|tele.*equipment|"
     r"radio and television broadcasting and communications equipment|data processing", "Tech"),
    (r"food|beverage|meat|poultry|farm|grocery|tobacco|cosmetic|household|soap|package good|bottl|sugar|specialty foods", "Food & Household"),
    (r"retail|store|catalog|apparel|clothing|shoe|footwear|department|e-commerce|consumer electronics/video chains|"
     r"home furnishings|other consumer services", "Shopping"),
    (r"chemical|metal|mining|steel|iron|aluminum|gold|silver|paper|forest|lumber|container|packag|glass|plastic|"
     r"textile|fertiliz|agricultural chem", "Materials"),
]
NQ_SECTOR = {"Technology": "Tech", "Health Care": "Health", "Energy": "Energy", "Utilities": "Utilities",
             "Real Estate": "Real Estate", "Finance": "Banks", "Basic Materials": "Materials",
             "Consumer Staples": "Food & Household", "Consumer Discretionary": "Shopping",
             "Telecommunications": "Media", "Industrials": "Industrial"}
NOT_COMMON = re.compile(r"warrants?\b|\brights?\b|\bunits?\b|preferred|depositary shares? \(each|notes due|debentures|% ", re.I)


def plain_industry(sector, industry):
    ind = (industry or "").lower()
    for pat, name in NQ_INDUSTRY:
        if re.search(pat, ind):
            # Nasdaq files car dealers and some others under retail-ish words; trust the sector for industrial firms.
            if name == "Shopping" and sector == "Industrials":
                return "Industrial"
            return name
    return NQ_SECTOR.get(sector, "Industrial" if sector else None)


def biggest_stocks():
    """[(ticker, name, market value, plain industry, Nasdaq industry)] for the biggest US stocks, or [] if Nasdaq fails."""
    rows = []
    for ex in ("nasdaq", "nyse", "amex"):
        try:
            data = json.loads(get(f"https://api.nasdaq.com/api/screener/stocks?tableonly=true&download=true&exchange={ex}", BROWSER_UA))
        except Exception as e:
            print(f"Nasdaq stock list ({ex}): {e}")
            return []
        for r in data["data"]["rows"]:
            t = (r.get("symbol") or "").strip().upper().replace("/", ".")
            name = (r.get("name") or "").strip()
            cap = float(re.sub(r"[^0-9.]", "", r.get("marketCap") or "") or 0)
            # Skip blank-check shells and investment funds: they aren't regular companies.
            if not t or "^" in t or not cap or NOT_COMMON.search(name) or re.search(r"acquisition|\bfund\b|blank check", name, re.I) \
                    or (r.get("industry") or "").startswith("Trusts Except"):
                continue
            ind = plain_industry((r.get("sector") or "").strip(), (r.get("industry") or "").strip())
            if ind:
                rows.append((t, name, cap, ind, (r.get("industry") or "").strip()))
    rows.sort(key=lambda x: -x[2])
    seen, out = set(), []
    for x in rows:
        if x[0] not in seen:
            seen.add(x[0])
            out.append(x)
    return out[:HOW_MANY]


def tidy(name):
    """'Apple Inc. Common Stock' -> 'Apple Inc.'"""
    return re.sub(r"\s+(Common Stock|Common Shares|Ordinary Shares|Class [A-C] (Common|Ordinary).*|American Depositary Shares?.*|"
                  r"Capital Stock|Subordinate Voting Shares|New York Registry Shares)\b.*$", "", name).strip() or name


def main():
    sec = json.loads((ROOT / "data" / "sectors.json").read_text())
    sectors = dict(sec["sectors"])  # our hand-checked industries for the S&P 500 and popular stocks win
    stocks = json.loads((ROOT / "data" / "stocks.json").read_text())["stocks"]
    names = {s[0]: s[1] for s in stocks}
    big = biggest_stocks()
    nsubs = {}
    for t, name, cap, ind, nq in big:
        sectors.setdefault(t, ind)
        names.setdefault(t, tidy(name))
        if nq:
            nsubs[t] = nq
    if big:  # biggest first by today's market value
        size = {x[0]: i for i, x in enumerate(big)}
        order = {s[0]: i for i, s in enumerate(stocks)}
        tickers = sorted(sectors, key=lambda t: (size.get(t, len(size) + order.get(t, 10**6))))
    else:
        order = {s[0]: i for i, s in enumerate(stocks)}
        tickers = sorted(sectors, key=lambda t: order.get(t, 10**6))
    rank = {t: (i, names.get(t, t)) for i, t in enumerate(tickers)}
    print(f"{len(tickers)} stocks ({len(big)} from Nasdaq's list)")
    with cf.ThreadPoolExecutor(max_workers=6) as pool:
        got = dict(zip(tickers, pool.map(prices, tickers)))
    ok = sum(1 for v in got.values() if v)
    old = {}
    if OUT.exists():  # keep the last numbers for any stock that failed this time
        try:
            for rows in json.loads(OUT.read_text()).get("industries", {}).values():
                for r in rows:
                    if r[2] is not None:
                        old[r[0]] = r[2:]
        except Exception:
            pass
    if ok < len(tickers) * 0.5 and old:
        raise SystemExit(f"Only got prices for {ok} of {len(tickers)} stocks; keeping the old file.")
    groups, flat = {}, []
    for t in tickers:
        row = [t, rank.get(t, (0, t))[1]] + (got[t] or old.get(t) or [None] * 5)
        groups.setdefault(sectors[t], []).append(row)
        if got[t] and got[t][1] is not None:
            flat.append(row)
    # Movers: only stocks with fresh prices today.
    # Movers: only the 600 biggest, so the list stays well-known names.
    flat = [r for r in flat if rank[r[0]][0] < 600]
    up = sorted((r for r in flat if r[3] > 0), key=lambda r: -r[3])[:5]
    down = sorted((r for r in flat if r[3] < 0), key=lambda r: r[3])[:5]
    mv = lambda r: {"ticker": r[0], "name": r[1], "price": r[2], "day": r[3], "industry": sectors[r[0]], "headline": headline(r[0], r[1])}  # noqa: E731
    out = {"updated": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
           "source": "Yahoo Finance prices and headlines, Google News, Nasdaq IPO calendar; industries from data/sectors.json",
           "columns": ["ticker", "name", "price", "today %", "month %", "year %", "dividend yield %"],
           "industries": dict(sorted(groups.items())),
           "order": tickers,
           "subs": sec.get("subs", {}),
           "nsubs": nsubs,
           "movers": {"up": [mv(r) for r in up], "down": [mv(r) for r in down]}}
    try:
        out["ipos"] = ipos()
    except Exception as e:
        print(f"IPOs: {e}")
        try:
            out["ipos"] = json.loads(OUT.read_text()).get("ipos")
        except Exception:
            out["ipos"] = {"recent": [], "upcoming": []}
    OUT.write_text(json.dumps(out, separators=(",", ":")) + "\n")
    print(f"Wrote {len(tickers)} stocks in {len(groups)} industries ({ok} with fresh prices), "
          f"{len(up)}+{len(down)} movers, {len(out['ipos']['recent'])} recent / {len(out['ipos']['upcoming'])} upcoming IPOs to {OUT}")


if __name__ == "__main__":
    main()

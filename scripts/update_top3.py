"""Pick the stocks for the "Top 3 Today" tab and save them to data/top3.json.

Two lists come from here (the third, "Most bought on Simple Street", is read live from the database by assets/top3.js):
  * analysts: the 3 well-known stocks the most Wall Street analysts rate "Buy", with their average price goal.
  * movers: the 3 stocks that rose the most over the last 5 market days and also have good headlines this week.

Everything is free and needs no keys: Yahoo Finance (prices, analyst ratings, headlines), Nasdaq's public analyst
page as a backup for ratings, and Google News as a backup for headlines.
These are ideas to research, not advice: the tab says so.
Runs in GitHub Actions every weekday morning before the market opens (.github/workflows/update-top3.yml).
"""
import datetime as dt
import email.utils
import html
import http.cookiejar
import json
import pathlib
import re
import time
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "top3.json"
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      "Accept": "application/json, text/plain, */*", "Accept-Language": "en-US,en;q=0.9"}

# Well-known companies people have heard of. Stocks members own in Paper Trading (data/owned.json) are added.
COMPANIES = """AAPL MSFT NVDA GOOGL AMZN META TSLA AVGO JPM V MA WMT COST HD NKE MCD SBUX DIS NFLX KO PEP
XOM CVX JNJ PFE LLY UNH BAC GS AMD INTC CRM ORCL ADBE PYPL UBER ABNB SHOP SNAP RBLX SPOT PLTR COIN HOOD
F GM BA DAL TGT CMG LULU DKNG RIVN SOFI MU QCOM TXN IBM CSCO T VZ CAT DE GE MRK ABBV TMO
LOW TJX BKNG MAR PG CL KMB MO PM MDLZ HSY GIS WFC C MS SCHW AXP BLK ARM SMCI ANET PANW CRWD SNOW NOW
INTU AMAT LRCX KLAC MRVL DELL HPQ ROKU PINS ETSY EBAY CVS WBA TGT KR DPZ YUM CMCSA CHTR TMUS""".split()
MIN_ANALYSTS = 15
MIN_HEADLINES_GOOD = 2

# Words in a headline that usually mean good or bad news for the company.
GOOD = r"""beat|beats|tops|topped|record|records|raises|raised|raise|upgrade|upgrades|upgraded|surge|surges|surged|soar|soars|soared|
jump|jumps|jumped|rally|rallies|rallied|win|wins|won|deal|deals|partnership|partners|approval|approved|approves|strong|stronger|
growth|grows|boost|boosts|boosted|buyback|outperform|all-time high|record high|gain|gains|gained|climb|climbs|climbed|rise|rises|
rose|higher|bullish|expands|expansion|launch|launches|launched|best|optimistic|upbeat|profit|profits|accelerat\w*|breakthrough|
contract|award|awarded|hike|hikes|lifts|lifted|surpass\w*|exceed\w*|momentum|buy rating|price target raised|new high"""
BAD = r"""miss|misses|missed|cut|cuts|downgrade|downgrades|downgraded|lawsuit|sue|sues|sued|probe|investigation|recall|recalls|
fall|falls|fell|plunge|plunges|plunged|slump|slumps|layoff|layoffs|warns|warning|weak|weaker|loss|losses|lose|loses|drop|drops|
dropped|tumble|tumbles|tumbled|sink|sinks|sank|fraud|fined|lower|lowers|bearish|slides|slid|crash|crashes|halt|halts|
delay|delays|delayed|concern|concerns|worry|worries|fears|sell-off|selloff|short seller|bankrupt\w*|resign\w*|ousted"""
GOOD_RE = re.compile(r"\b(" + GOOD.replace("\n", "") + r")\b", re.I)
BAD_RE = re.compile(r"\b(" + BAD.replace("\n", "") + r")\b", re.I)

_jar = http.cookiejar.CookieJar()
_open = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(_jar)).open
_crumb = [None]


def get(url, tries=2, headers=None):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={**UA, **(headers or {})})
            with _open(req, timeout=30) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001
            if i == tries - 1:
                raise
            print(f"  retry {url[:90]}: {e}")
            time.sleep(2)


def get_json(url, **kw):
    return json.loads(get(url, **kw))


def names():
    try:
        return {s[0]: s[1] for s in json.loads((ROOT / "data" / "stocks.json").read_text())["stocks"]}
    except Exception:  # noqa: BLE001
        return {}


def short_name(n, tk):
    n = re.sub(r",?\s+(Inc\.?|Incorporated|Corporation|Corp\.?|Company|Co\.?|Ltd\.?|plc|Holdings?|Class [A-C]|N\.V\.|S\.A\.|"
               r"Common Stock|Ordinary Shares|\(The\)|Group)\b\.?", "", n or "", flags=re.I).strip(" ,.")
    return n or tk


def universe():
    tks = list(dict.fromkeys(COMPANIES))
    try:
        for o in json.loads((ROOT / "data" / "owned.json").read_text()).get("tickers", []):
            t = str(o.get("ticker", "")).upper()
            if re.fullmatch(r"[A-Z][A-Z.]{0,5}", t) and t not in tks:
                tks.append(t)
    except Exception:  # noqa: BLE001
        pass
    return tks


# ---------- Prices ----------
def closes(tk):
    """Last ~month of daily closes, oldest first."""
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(tk.replace('.', '-'))}?range=1mo&interval=1d"
    res = get_json(url)["chart"]["result"][0]
    out = [c for c in res["indicators"]["quote"][0]["close"] if c is not None]
    return out, res["meta"].get("regularMarketPrice") or (out[-1] if out else None)


# ---------- Analyst ratings ----------
def crumb():
    if _crumb[0] is None:
        try:
            try:
                get("https://fc.yahoo.com", tries=1)
            except Exception:  # noqa: BLE001  (it answers 404 but still sets the cookie)
                pass
            _crumb[0] = get("https://query2.finance.yahoo.com/v1/test/getcrumb", tries=1).decode().strip()
        except Exception as e:  # noqa: BLE001
            print(f"No Yahoo crumb: {e}")
            _crumb[0] = ""
    return _crumb[0]


def ratings_yahoo(tk):
    c = crumb()
    if not c:
        return None
    url = (f"https://query2.finance.yahoo.com/v10/finance/quoteSummary/{urllib.parse.quote(tk.replace('.', '-'))}"
           f"?modules=recommendationTrend,financialData&crumb={urllib.parse.quote(c)}")
    r = get_json(url)["quoteSummary"]["result"][0]
    trend = next((p for p in r.get("recommendationTrend", {}).get("trend", []) if p.get("period") == "0m"), None)
    if not trend:
        return None
    fd = r.get("financialData", {})
    raw = lambda k: (fd.get(k) or {}).get("raw") if isinstance(fd.get(k), dict) else fd.get(k)  # noqa: E731
    return {"buy": trend.get("strongBuy", 0) + trend.get("buy", 0), "hold": trend.get("hold", 0),
            "sell": trend.get("sell", 0) + trend.get("strongSell", 0), "target": raw("targetMeanPrice")}


def num(s):
    try:
        return float(re.sub(r"[^\d.]", "", str(s)))
    except ValueError:
        return None


def ratings_nasdaq(tk):
    j = get_json(f"https://api.nasdaq.com/api/analyst/{urllib.parse.quote(tk)}/targetprice",
                 headers={"Origin": "https://www.nasdaq.com", "Referer": "https://www.nasdaq.com/"})
    c = ((j.get("data") or {}).get("consensusOverview") or {})
    if not c:
        return None
    return {"buy": int(c.get("buy") or 0), "hold": int(c.get("hold") or 0), "sell": int(c.get("sell") or 0),
            "target": num(c.get("priceTarget"))}


def ratings(tk):
    for f in (ratings_yahoo, ratings_nasdaq):
        try:
            r = f(tk)
            if r and r["buy"] + r["hold"] + r["sell"] > 0:
                return r
        except Exception as e:  # noqa: BLE001
            print(f"  {f.__name__} {tk}: {e}")
    return None


# ---------- Headlines ----------
def news_yahoo(tk):
    j = get_json(f"https://query1.finance.yahoo.com/v1/finance/search?q={urllib.parse.quote(tk)}&quotesCount=0&newsCount=12")
    out = []
    for n in j.get("news", []):
        if tk in [x.upper() for x in n.get("relatedTickers") or []]:
            out.append({"title": n.get("title", ""), "url": n.get("link", ""), "source": n.get("publisher", ""),
                        "t": int(n.get("providerPublishTime") or 0)})
    return out


def news_google(tk, name):
    q = urllib.parse.quote(f'"{name}" stock when:7d' if name and name != tk else f"{tk} stock when:7d")
    xml = get(f"https://news.google.com/rss/search?q={q}&hl=en-US&gl=US&ceid=US:en").decode("utf-8", "replace")
    out = []
    for item in re.findall(r"<item>(.*?)</item>", xml, re.S)[:15]:
        g = lambda tag: html.unescape(re.sub(r"<!\[CDATA\[|\]\]>", "", (re.search(rf"<{tag}[^>]*>(.*?)</{tag}>", item, re.S) or [None, ""])[1])).strip()  # noqa: E731
        title, src = g("title"), g("source")
        if src and title.endswith(" - " + src):
            title = title[: -len(src) - 3]
        try:
            t = int(email.utils.parsedate_to_datetime(g("pubDate")).timestamp())
        except Exception:  # noqa: BLE001
            t = 0
        out.append({"title": title, "url": g("link"), "source": src, "t": t})
    return out


def headlines(tk, name):
    week = time.time() - 7 * 86400
    seen, out = set(), []
    for f in (lambda: news_yahoo(tk), lambda: news_google(tk, name)):
        try:
            for n in f():
                k = re.sub(r"\W+", "", n["title"].lower())[:60]
                if n["title"] and n["t"] >= week and k not in seen:
                    seen.add(k)
                    out.append(n)
        except Exception as e:  # noqa: BLE001
            print(f"  news {tk}: {e}")
    return out


def tone(title):
    return len(GOOD_RE.findall(title)) - 2 * len(BAD_RE.findall(title))


def money(x):
    return f"${x:,.0f}" if x >= 100 else f"${x:,.2f}"


def main():
    nm = names()
    tks = universe()
    print(f"Checking {len(tks)} stocks")
    info = {}
    for tk in tks:
        try:
            cl, px = closes(tk)
        except Exception as e:  # noqa: BLE001
            print(f"  price {tk}: {e}")
            continue
        if len(cl) < 6 or not px:
            continue
        info[tk] = {"ticker": tk, "name": short_name(nm.get(tk, tk), tk), "price": round(px, 2),
                    "week": round((cl[-1] / cl[-6] - 1) * 100, 1)}
        time.sleep(0.4)

    # Wall Street's favorites: the biggest share of analysts saying Buy (at least 15 analysts), then the most room
    # to the average price goal. A stock whose price is already above the goal is skipped.
    fav = []
    for tk, s in info.items():
        r = ratings(tk)
        time.sleep(0.4)
        if not r:
            continue
        total = r["buy"] + r["hold"] + r["sell"]
        up = (r["target"] / s["price"] - 1) * 100 if r.get("target") else None
        if total < MIN_ANALYSTS or (up is not None and up <= 0):
            continue
        fav.append((r["buy"] / total, up or 0, tk, r, total))
    fav.sort(reverse=True)
    print(f"Analyst ratings for {len(fav)} stocks")
    analysts = []
    for share, up, tk, r, total in fav[:3]:
        s = dict(info[tk])
        why = f"{r['buy']} of {total} Wall Street experts say Buy."
        if r.get("target"):
            why += f" Their average price goal is {money(r['target'])}, {up:.0f}% above today's price."
        s.update({"why": why, "buy": r["buy"], "analysts": total,
                  "target": round(r["target"], 2) if r.get("target") else None})
        analysts.append(s)

    # Biggest movers with good news: the biggest 5-day gainers whose headlines this week are mostly good.
    picked = {a["ticker"] for a in analysts}
    movers = []
    for s in sorted(info.values(), key=lambda x: -x["week"]):
        if len(movers) == 3 or s["week"] < 1:
            break
        if s["ticker"] in picked:
            continue
        hs = headlines(s["ticker"], s["name"])
        # Shown headline must be about this company (not a rival) and be news, not a question.
        words = [w.lower() for w in re.findall(r"[A-Za-z]{3,}", s["name"])[:1]] + [s["ticker"].lower()]
        about = lambda t: any(re.search(rf"\b{re.escape(w)}\b", t.lower()) for w in words)  # noqa: E731
        good = sorted([h for h in hs if tone(h["title"]) > 0], key=lambda h: (-tone(h["title"]), -h["t"]))
        shown = [h for h in good if about(h["title"]) and not h["title"].rstrip().endswith("?")]
        bad = [h for h in hs if tone(h["title"]) < 0]
        print(f"  {s['ticker']} +{s['week']}%: {len(hs)} headlines, {len(good)} good, {len(bad)} bad")
        time.sleep(1.5)  # Google News turns away fast askers
        if len(good) < MIN_HEADLINES_GOOD or len(good) <= len(bad) or not shown:
            continue
        h = shown[0]
        m = dict(s)
        m.update({"why": f"Up {s['week']:.1f}% in the last 5 market days, with mostly good news this week.",
                  "headline": {"title": h["title"][:200], "url": h["url"], "source": h["source"],
                               "date": dt.datetime.fromtimestamp(h["t"], dt.timezone.utc).date().isoformat()}})
        movers.append(m)

    old = json.loads(OUT.read_text()) if OUT.exists() else {}
    data = {"updated": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            # If a source is down today, keep yesterday's list rather than showing an empty box.
            "analysts": analysts or old.get("analysts", []),
            "movers": movers or old.get("movers", [])}
    OUT.write_text(json.dumps(data, indent=1) + "\n")
    print(json.dumps(data, indent=1))


if __name__ == "__main__":
    main()

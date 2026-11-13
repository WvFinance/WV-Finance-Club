"""Save the newest insider trades and big investors' moves for the Feed page.

Writes data/pros.json from the SEC's free EDGAR site (public records, no key needed):
  * insiders: open-market buys and sells by company bosses and directors (Form 4, reported within 2 business days)
    for a list of well-known companies plus the stocks members own in Paper Trading (data/owned.json).
  * funds: what famous investors' funds bought and sold last quarter (Form 13F, reported every 3 months,
    up to 45 days after the quarter ends). Compares each fund's newest report with the one before it.
  * prices: each stock's closing price on the day a trade was reported and its newest close (free Yahoo Finance
    daily closes, like scripts/update_prices.py), so the Feed can say "up 6% since this was reported". Covers
    Congress trades too (read from the brief server's /congress); only prices are saved, never Congress records.
Runs in GitHub Actions on weekday evenings (see .github/workflows/update-pros.yml).
"""
import datetime as dt
import json
import pathlib
import re
import sys
import time
import urllib.request
import xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "pros.json"
# The SEC asks for a User-Agent with contact details, and turns away ones it doesn't accept (403).
# This is the club's public contact address, the same one the brief server gives the SEC (brief-server/src/sec.js).
UA = {"User-Agent": "WV Finance Club brief server warrior.financec@gmail.com", "Accept-Encoding": "identity"}
TODAY = dt.date.today()

# Well-known companies to watch for insider trades. Owned Paper Trading stocks are added to this.
COMPANIES = """AAPL MSFT NVDA GOOGL AMZN META TSLA AVGO JPM V MA WMT COST HD NKE MCD SBUX DIS NFLX KO PEP
XOM CVX JNJ PFE LLY UNH BAC GS AMD INTC CRM ORCL ADBE PYPL UBER ABNB SHOP SNAP RBLX SPOT PLTR COIN HOOD
F GM BA DAL AAL TGT CMG LULU DKNG RIVN SOFI""".split()
MAX_COMPANIES = 75
INSIDER_DAYS = 45          # how far back to look
FILINGS_PER_COMPANY = 25   # newest Form 4s read for one company
KEEP_INSIDERS = 200

# Famous investors: (SEC number, words the SEC's name must contain, name shown, person shown).
FUNDS = [
    (1067983, "BERKSHIRE", "Berkshire Hathaway", "Warren Buffett's company"),
    (1336528, "PERSHING", "Pershing Square", "Bill Ackman's fund"),
    (1350694, "BRIDGEWATER", "Bridgewater Associates", "the fund Ray Dalio started"),
    (1697748, "ARK", "ARK Invest", "Cathie Wood's fund"),
    (1536411, "DUQUESNE", "Duquesne Family Office", "Stanley Druckenmiller's fund"),
    (1656456, "APPALOOSA", "Appaloosa", "David Tepper's fund"),
    (1649339, "SCION", "Scion Asset Management", "Michael Burry's fund"),
]
FUND_STALE_DAYS = 200      # skip a fund whose newest report is older than this (it stopped reporting)
MOVES_PER_KIND = 3

_last = [0.0]


def get(url, tries=3):
    """Download a page, at most about 6 a second (the SEC allows 10)."""
    for i in range(tries):
        wait = 0.17 - (time.time() - _last[0])
        if wait > 0:
            time.sleep(wait)
        _last[0] = time.time()
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001
            why = ""
            if hasattr(e, "read"):
                try:
                    why = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", e.read(3000).decode("utf-8", "replace")))[:400]
                except Exception:  # noqa: BLE001
                    pass
            print(f"  failed {url}: {e} {why}", flush=True)
            if i == tries - 1:
                raise
            time.sleep(2 + 3 * i)


def get_json(url):
    return json.loads(get(url))


def strip_ns(root):
    for e in root.iter():
        if isinstance(e.tag, str) and "}" in e.tag:
            e.tag = e.tag.split("}", 1)[1]
    return root


def text(node, path):
    if node is None:
        return ""
    e = node.find(path)
    return (e.text or "").strip() if e is not None else ""


def num(s):
    try:
        return float(str(s).replace(",", ""))
    except (TypeError, ValueError):
        return 0.0


def recent_filings(sub):
    """The 'recent' table in an SEC submissions file, as a list of rows."""
    r = sub.get("filings", {}).get("recent", {})
    keys = [k for k in ("accessionNumber", "filingDate", "form", "primaryDocument", "reportDate") if k in r]
    return [dict(zip(keys, row)) for row in zip(*(r[k] for k in keys))]


def nice_person(name):
    """'COOK TIMOTHY D' -> 'Timothy D Cook'. Company-like names are only tidied."""
    name = re.sub(r"\s+", " ", name.strip())
    if not name:
        return name
    if name != name.upper():
        # Mixed case: the SEC usually stores "Harris Ronan" or "Jones Teresa A." (last name first).
        # Only turn around the clear cases; "Mark A Nelson" and three full words are left alone.
        w = name.split()
        initial = lambda x: len(x.rstrip(".")) == 1  # noqa: E731
        if re.search(r"\b(LLC|L\.?P\.?|Inc|Corp|Trust|Fund|Partners|Capital|Holdings|Ltd|Group|Foundation|Management)\b", name, re.I):
            return name
        if len(w) == 2 and not initial(w[0]) and not initial(w[1]):
            return f"{w[1]} {w[0]}"
        if len(w) == 3 and initial(w[2]) and not initial(w[1]):
            return f"{w[1]} {w[2]} {w[0]}"
        return name
    words = name.split()
    if re.search(r"\b(LLC|L\.?P\.?|INC|CORP|TRUST|FUND|PARTNERS|CAPITAL|HOLDINGS|LTD|CO|GROUP|FOUNDATION|MANAGEMENT)\b\.?", name):
        return " ".join(w if len(w) <= 3 and w.isalpha() and w in ("LLC", "LP", "INC") else w.capitalize() for w in words)
    suffix = []
    while len(words) > 2 and words[-1].rstrip(".") in ("JR", "SR", "II", "III", "IV"):
        suffix.insert(0, words.pop())
    words = words[1:] + words[:1]
    def part(p):
        if p.startswith("MC") and len(p) > 3:
            return "Mc" + p[2:].capitalize()
        return "'".join(x.capitalize() for x in p.split("'"))
    cap = lambda w: "-".join(part(p) for p in w.split("-"))  # noqa: E731
    return " ".join([cap(w) for w in words] + [s.capitalize() if s.rstrip(".") in ("JR", "SR") else s for s in suffix])


def nice_title(t):
    t = re.sub(r"\s+", " ", t.strip())
    short = {"CEO": "CEO", "CFO": "CFO", "COO": "COO", "CTO": "CTO", "EVP": "Executive VP", "SVP": "Senior VP", "VP": "VP"}
    if t.upper() in short:
        return short[t.upper()]
    if t == t.upper() or t == t.lower():
        t = " ".join(w.upper() if w.upper() in ("CEO", "CFO", "COO", "CTO", "EVP", "SVP", "VP") else w.capitalize() for w in t.split())
    return t[:60]


def parse_form4(xml_bytes):
    """Open-market buys (code P) and sells (code S) in one Form 4. Awards, gifts and option deals are left out."""
    root = strip_ns(ET.fromstring(xml_bytes))
    owner = root.find("reportingOwner")
    name = nice_person(text(owner, "reportingOwnerId/rptOwnerName"))
    rel = owner.find("reportingOwnerRelationship") if owner is not None else None
    yes = lambda p: text(rel, p).lower() in ("1", "true")  # noqa: E731
    title = nice_title(text(rel, "officerTitle"))
    if yes("isOfficer") and title:
        role = title
    elif yes("isDirector"):
        role = "Board member"
    elif yes("isTenPercentOwner"):
        role = "Big shareholder (10% or more)"
    else:
        role = title or "Insider"
    out = {}
    for t in root.findall("nonDerivativeTable/nonDerivativeTransaction"):
        code = text(t, "transactionCoding/transactionCode")
        if code not in ("P", "S"):
            continue
        shares = num(text(t, "transactionAmounts/transactionShares/value"))
        price = num(text(t, "transactionAmounts/transactionPricePerShare/value"))
        day = text(t, "transactionDate/value")[:10]
        if shares <= 0 or not day:
            continue
        side = "buy" if code == "P" else "sell"
        o = out.setdefault(side, {"shares": 0.0, "value": 0.0, "traded": day})
        o["shares"] += shares
        o["value"] += shares * price
        o["traded"] = max(o["traded"], day)
    return {"name": name, "role": role, "symbol": text(root, "issuer/issuerTradingSymbol").upper(), "sides": out}


def insiders(tickers, by_ticker):
    rows = []
    since = (TODAY - dt.timedelta(days=INSIDER_DAYS)).isoformat()
    for tk in tickers:
        co = by_ticker.get(tk)
        if not co:
            print(f"{tk}: not in the SEC list, skipped")
            continue
        cik = int(co["cik_str"])
        try:
            sub = get_json(f"https://data.sec.gov/submissions/CIK{cik:010d}.json")
        except Exception as e:  # noqa: BLE001
            print(f"{tk}: couldn't load ({e})")
            continue
        company = sub.get("name") or co["title"]
        fours = [f for f in recent_filings(sub) if f["form"] == "4" and f["filingDate"] >= since][:FILINGS_PER_COMPANY]
        found = 0
        for f in fours:
            doc = f["primaryDocument"].split("/")[-1]
            if not doc.lower().endswith(".xml"):
                continue
            acc = f["accessionNumber"].replace("-", "")
            base = f"https://www.sec.gov/Archives/edgar/data/{cik}/{acc}/"
            try:
                p = parse_form4(get(base + doc))
            except Exception as e:  # noqa: BLE001
                print(f"  {tk} {f['accessionNumber']}: unreadable ({e})")
                continue
            for side, o in p["sides"].items():
                if not p["name"]:
                    continue
                rows.append({"name": p["name"], "role": p["role"], "company": company_for(tk, company), "ticker": tk, "side": side,
                             "shares": round(o["shares"]), "value": round(o["value"]), "traded": o["traded"], "reported": f["filingDate"],
                             "url": base + f["primaryDocument"]})
                found += 1
        print(f"{tk}: {len(fours)} Form 4s, {found} buys/sells")
    rows.sort(key=lambda r: (r["reported"], r["traded"], r["value"]), reverse=True)
    return rows[:KEEP_INSIDERS]


def site_names():
    """Ticker -> the company name the site's search bar uses (data/stocks.json)."""
    try:
        return {row[0].upper(): row[1] for row in json.loads((ROOT / "data" / "stocks.json").read_text())["stocks"]}
    except Exception:  # noqa: BLE001
        return {}


SITE = site_names()


def company_for(ticker, fallback):
    return company_name(SITE.get(ticker) or fallback)


def company_name(n):
    """'APPLE INC' -> 'Apple'. Good enough for a short label."""
    n = re.sub(r"\s*/[A-Za-z]{2,3}/?\s*$", "", n.strip())
    n = re.sub(r"\s+(Class [A-C]|Common Stock)$", "", n, flags=re.I)
    n = re.sub(r"(?<!\w\.\w)[.,](?!\w)", "", n)
    n = re.sub(r"\s+(/[A-Z]{2}/?|INC|CORP|CORPORATION|CO|COMPANY|LTD|PLC|HOLDINGS|GROUP|N\.?V\.?|S\.?A\.?|CLASS [A-C]|COM|NEW)$", "", n, flags=re.I)
    n = re.sub(r"\s+(/[A-Z]{2}/?|INC|CORP|CORPORATION|CO|COMPANY|LTD|PLC)$", "", n, flags=re.I)
    if n == n.upper() and len(n) > 4:
        n = " ".join(w if "&" in w or len(w) <= 3 and w not in ("THE", "AND", "OF") else w.capitalize() for w in n.split())
    return n[:50]


# 13F reports shorten company names. These bring them back so they can be matched to a ticker.
ABBR = {"AMER": "AMERICA", "PETE": "PETROLEUM", "FINL": "FINANCIAL", "HLDGS": "HOLDINGS", "HLDG": "HOLDING", "INTL": "INTERNATIONAL",
        "COS": "COMPANIES", "MTRS": "MOTORS", "SVCS": "SERVICES", "SVC": "SERVICE", "PPTYS": "PROPERTIES", "COMMUNICATIONS": "COMMUNICATIONS",
        "COMMUN": "COMMUNICATIONS", "TECHNOLOGIES": "TECHNOLOGIES", "TECHS": "TECHNOLOGIES", "LABS": "LABORATORIES", "PHARMACEUTICALS": "PHARMACEUTICALS",
        "PHARMA": "PHARMACEUTICALS", "MGMT": "MANAGEMENT", "RES": "RESOURCES", "ENTMT": "ENTERTAINMENT", "SYS": "SYSTEMS", "NATL": "NATIONAL",
        "BK": "BANK", "BANCORP": "BANCORP", "AIRLS": "AIRLINES", "ELEC": "ELECTRIC", "GRP": "GROUP", "INDS": "INDUSTRIES", "MATLS": "MATERIALS",
        "WHSL": "WHOLESALE", "PRODS": "PRODUCTS", "CTLS": "CONTROLS", "HEALTHCARE": "HEALTHCARE", "MACHS": "MACHINES", "BUSINESS": "BUSINESS",
        "SOLUTIONS": "SOLUTIONS", "GEN": "GENERAL", "DEV": "DEVELOPMENT", "INS": "INSURANCE", "TR": "TRUST", "CAP": "CAPITAL", "ENERGY": "ENERGY",
        "CHEMS": "CHEMICALS", "RESH": "RESEARCH", "INSTRS": "INSTRUMENTS", "SEMICONDUCTOR": "SEMICONDUCTOR", "MFG": "MANUFACTURING"}
DROP = {"INC", "CORP", "CORPORATION", "CO", "COMPANY", "LTD", "LIMITED", "PLC", "THE", "NEW", "DEL", "COM", "CL", "CLASS", "A", "B", "C", "SHS",
        "ADR", "SPONSORED", "SPON", "ADS", "NV", "SA", "AG", "SE", "HOLDINGS", "HOLDING", "GROUP", "AND", "ORD", "CDA", "N", "V", "S", "OF"}


def name_key(n):
    n = re.sub(r"/[A-Z]{2,3}/?\s*$", "", n.upper().strip())
    words = re.sub(r"[^A-Z0-9 ]", " ", re.sub(r"[.'’]", "", n.replace("&", " AND "))).split()
    words = [ABBR.get(w, w) for w in words]
    kept = [w for w in words if w not in DROP]
    return " ".join(kept or words)


def ticker_index(by_ticker_list):
    """Company name -> ticker, biggest companies first so 'ALPHABET' gets GOOGL."""
    idx = {}
    for co in by_ticker_list:
        idx.setdefault(name_key(co["title"]), (co["ticker"].upper(), co["title"]))
    return idx


def info_table(cik, acc):
    """The holdings in one 13F report: {cusip: {name, value, shares}}. Options (puts and calls) are left out."""
    base = f"https://www.sec.gov/Archives/edgar/data/{cik}/{acc.replace('-', '')}/"
    items = get_json(base + "index.json")["directory"]["item"]
    xmls = [i["name"] for i in items if i["name"].lower().endswith(".xml") and i["name"].lower() != "primary_doc.xml"]
    xmls.sort(key=lambda n: ("info" not in n.lower() and "table" not in n.lower(), n))
    for name in xmls:
        root = strip_ns(ET.fromstring(get(base + name)))
        rows = root.findall(".//infoTable")
        if not rows:
            continue
        out = {}
        for r in rows:
            if text(r, "putCall"):
                continue
            cusip = text(r, "cusip").upper()
            if not cusip:
                continue
            o = out.setdefault(cusip, {"name": text(r, "nameOfIssuer"), "value": 0.0, "shares": 0.0})
            o["value"] += num(text(r, "value"))
            if text(r, "shrsOrPrnAmt/sshPrnamtType").upper() != "PRN":
                o["shares"] += num(text(r, "shrsOrPrnAmt/sshPrnamt"))
        return out, base
    raise ValueError("no holdings table found")


def value_scale(holdings):
    """1 when values are in dollars, 1000 when the fund still writes them in thousands of dollars (the rule
    before 2023). Told apart by the typical price of one share: real prices are far above $2."""
    prices = sorted(h["value"] / h["shares"] for h in holdings.values() if h["shares"] > 0 and h["value"] > 0)
    if not prices:
        return 1
    return 1000 if prices[len(prices) // 2] < 2 else 1


def moved_reports(cik, notice, fund):
    """The 13F-HR reports of the filer a 13F-NT notice points to (it names who reports the holdings now)."""
    base = f"https://www.sec.gov/Archives/edgar/data/{cik}/{notice['accessionNumber'].replace('-', '')}/"
    root = strip_ns(ET.fromstring(get(base + "primary_doc.xml")))
    out = []
    for m in root.iter("otherManager"):
        other = re.sub(r"\D", "", text(m, "cik"))
        print(f"{fund}: notice for {notice.get('reportDate')} says holdings are reported by '{text(m, 'name')}' (SEC number {other or 'not given'}, file {text(m, 'form13FFileNumber')})")
        if not other or int(other) == cik:
            continue
        sub = get_json(f"https://data.sec.gov/submissions/CIK{int(other):010d}.json")
        found = [f for f in recent_filings(sub) if f["form"] == "13F-HR"]
        for f in found:
            f["cik"] = int(other)
        print(f"{fund}: '{sub.get('name')}' has {len(found)} reports, newest "
              + (f"for {found[0].get('reportDate')} filed {found[0]['filingDate']}" if found else "none"))
        out += found
    return out


def quarter_table(filings):
    """One quarter's holdings from one or more filers' reports. A stock in two reports counts once (the bigger one)."""
    out, first = {}, None
    for f in filings:
        table, base = info_table(f["cik"], f["accessionNumber"])
        first = first or base
        for cusip, h in table.items():
            if cusip not in out or h["shares"] > out[cusip]["shares"]:
                out[cusip] = h
    return out, first


def fund_moves(names):
    rows = []
    for cik, must, fund, person in FUNDS:
        try:
            sub = get_json(f"https://data.sec.gov/submissions/CIK{cik:010d}.json")
            sec_name = (sub.get("name") or "").upper()
            if must not in sec_name:
                print(f"{fund}: SEC number {cik} is '{sec_name}', skipped")
                continue
            filings = recent_filings(sub)
            reps = [f for f in filings if f["form"] == "13F-HR"]
            print(f"{fund}: SEC name '{sec_name}'. Newest 13F filings: "
                  + ", ".join(f"{f['form']} for {f.get('reportDate')} filed {f['filingDate']}" for f in filings if f["form"].startswith("13F"))[:400])
            for f in reps:
                f["cik"] = cik
            # A "13F-NT" notice means another SEC filer now reports this fund's holdings. Follow it there.
            nts = [f for f in filings if f["form"] == "13F-NT"]
            if nts and (not reps or nts[0]["filingDate"] > reps[0]["filingDate"]):
                try:
                    reps = moved_reports(cik, nts[0], fund) + reps
                except Exception as e:  # noqa: BLE001
                    print(f"{fund}: couldn't follow its notice to the new filer ({e})")
            # One report per quarter, newest first (an amended report is a different form and is ignored).
            reps.sort(key=lambda f: (f.get("reportDate") or "", f["filingDate"]), reverse=True)
            # When holdings moved to another filer, both filers can have a report for the same quarter
            # (each with part of the holdings), so a quarter keeps the newest report from each filer.
            seen, quarters, parts = set(), [], {}
            for f in reps:
                q = f.get("reportDate")
                if not q:
                    continue
                if q not in seen:
                    seen.add(q)
                    quarters.append(f)
                if f["cik"] not in [x["cik"] for x in parts.setdefault(q, [])]:
                    parts[q].append(f)
            if len(quarters) < 2:
                print(f"{fund}: fewer than 2 reports, skipped")
                continue
            new, old = quarters[0], quarters[1]
            if (TODAY - dt.date.fromisoformat(new["filingDate"])).days > FUND_STALE_DAYS:
                print(f"{fund}: newest report is from {new['filingDate']}, too old, skipped")
                continue
            now, base = quarter_table(parts[new["reportDate"]])
            before, _ = quarter_table(parts[old["reportDate"]])
        except Exception as e:  # noqa: BLE001
            print(f"{fund}: couldn't load ({e})")
            continue
        scale = value_scale(now)
        moves = {"new": [], "sold": [], "more": [], "less": []}
        for cusip, h in now.items():
            b = before.get(cusip)
            if not b or b["shares"] <= 0:
                moves["new"].append((h["value"] * scale, h, None))
            elif h["shares"] > 0:
                ch = h["shares"] / b["shares"] - 1
                per = h["value"] * scale / h["shares"]
                if ch >= 0.2:
                    moves["more"].append(((h["shares"] - b["shares"]) * per, h, ch))
                elif ch <= -0.2:
                    moves["less"].append(((b["shares"] - h["shares"]) * per, h, ch))
        old_scale = value_scale(before)
        for cusip, b in before.items():
            if cusip not in now and b["shares"] > 0:
                moves["sold"].append((b["value"] * old_scale, b, -1.0))
        n = 0
        for kind, lst in moves.items():
            merged = {}
            for value, h, ch in lst:
                tk, title = names.get(name_key(h["name"]), ("", h["name"]))
                key = tk or name_key(h["name"])
                if key in merged:
                    m = merged[key]
                    merged[key] = (m[0] + value, m[1], m[2] if value < m[0] else ch, tk, title)
                else:
                    merged[key] = (value, h, ch, tk, title)
            lst = sorted(merged.values(), key=lambda x: x[0], reverse=True)
            for value, h, ch, tk, title in lst[:MOVES_PER_KIND]:
                if value < 1e6:
                    continue
                rows.append({"fund": fund, "person": person, "company": company_for(tk, title), "ticker": tk,
                             "move": kind, "value": round(value), "pct": None if ch is None else round(ch, 3),
                             "asof": new["reportDate"], "reported": new["filingDate"], "url": base})
                n += 1
        print(f"{fund}: report for {new['reportDate']} filed {new['filingDate']}, {len(now)} holdings (before: {len(before)}), "
              f"values x{scale}, found " + ", ".join(f"{len(v)} {k}" for k, v in moves.items()) + f", {n} moves kept")
    rows.sort(key=lambda r: (r["reported"], r["value"]), reverse=True)
    return rows


YAHOO_UA = {"User-Agent": "Mozilla/5.0 (WV Finance Club feed updater)"}
CONGRESS_URLS = ["https://wvfc-brief-server.wvfinance.workers.dev/congress", "https://simplestreet.com.co/api/congress"]


def yahoo_closes(ticker, start):
    """{YYYY-MM-DD: close} from Yahoo Finance's free chart endpoint (BRK.B is BRK-B there)."""
    p1 = int(dt.datetime.combine(start, dt.time()).replace(tzinfo=dt.timezone.utc).timestamp())
    url = (f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker.replace('.', '-')}"
           f"?period1={p1}&period2={int(time.time()) + 86400}&interval=1d")
    with urllib.request.urlopen(urllib.request.Request(url, headers=YAHOO_UA), timeout=30) as r:
        res = json.load(r)["chart"]["result"][0]
    tz = dt.timezone(dt.timedelta(seconds=res["meta"].get("gmtoffset", 0)))
    out = {}
    for ts, c in zip(res.get("timestamp", []), res["indicators"]["quote"][0]["close"]):
        if c is not None:
            out[dt.datetime.fromtimestamp(ts, tz).date().isoformat()] = round(c, 2)
    return out


def congress_pairs():
    """(ticker, reported day) for the Congress trades the Feed shows. Only these two fields are kept."""
    for url in CONGRESS_URLS:
        try:
            req = urllib.request.Request(url, headers={**YAHOO_UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=30) as r:
                trades = json.load(r).get("trades", [])
            return [(t["ticker"], t["reported"]) for t in trades if t.get("ticker") and t.get("reported")]
        except Exception as e:  # noqa: BLE001
            print(f"Congress trades not read from {url}: {e}")
    return []


def since_prices(pairs):
    """{ticker: {"now": newest close, "day": its date, "on": {reported day: close that day or the next trading day}}}"""
    want = {}
    for tk, d in pairs:
        if tk and re.fullmatch(r"\d{4}-\d{2}-\d{2}", d or "") and re.fullmatch(r"[A-Z][A-Z0-9.\-]{0,9}", tk):
            want.setdefault(tk, set()).add(d)
    out = {}
    for tk, days in sorted(want.items()):
        try:
            closes = yahoo_closes(tk, dt.date.fromisoformat(min(days)) - dt.timedelta(days=5))
        except Exception as e:  # noqa: BLE001
            print(f"  no prices for {tk}: {e}")
            continue
        time.sleep(0.25)
        if not closes:
            continue
        dates = sorted(closes)
        on = {}
        for d in days:
            nxt = next((x for x in dates if x >= d), None)
            if nxt and nxt != dates[-1]:   # reported today: nothing to compare yet
                on[d] = closes[nxt]
        if on:
            out[tk] = {"now": closes[dates[-1]], "day": dates[-1], "on": on}
    print(f"Prices for {len(out)} of {len(want)} stocks")
    return out


def main():
    listed = list(get_json("https://www.sec.gov/files/company_tickers.json").values())
    by_ticker = {}
    for co in listed:
        by_ticker.setdefault(co["ticker"].upper(), co)
    tickers = list(COMPANIES)
    try:
        owned = json.loads((ROOT / "data" / "owned.json").read_text())["tickers"]
        for o in sorted(owned, key=lambda x: -x.get("owners", 0)):
            t = str(o["ticker"]).upper()
            if t not in tickers and re.fullmatch(r"[A-Z][A-Z.\-]{0,6}", t):
                tickers.append(t)
    except Exception as e:  # noqa: BLE001
        print(f"owned.json not used: {e}")
    tickers = tickers[:MAX_COMPANIES]

    ins = insiders(tickers, by_ticker)
    funds = fund_moves(ticker_index(listed))
    print(f"Total: {len(ins)} insider trades, {len(funds)} fund moves")
    old = {}
    try:
        old = json.loads(OUT.read_text())
    except Exception:  # noqa: BLE001
        pass
    # If the SEC was down for one part, keep that part from last time instead of emptying the page.
    if not ins and old.get("insiders"):
        print("No insider trades found, keeping the last list")
        ins = old["insiders"]
    if not funds and old.get("funds"):
        print("No fund moves found, keeping the last list")
        funds = old["funds"]
    if not ins and not funds:
        sys.exit("Nothing found at all. Not saving.")
    same = old.get("insiders") == ins and old.get("funds") == funds
    pairs = [(t.get("ticker"), t.get("reported")) for t in ins + funds] + congress_pairs()
    prices = since_prices(pairs) or old.get("prices", {})
    data = {"updated": old.get("updated") if same else TODAY.isoformat(), "source": "SEC EDGAR (Form 4 and Form 13F)",
            "insiders": ins, "funds": funds, "prices": prices}
    OUT.write_text(json.dumps(data, indent=1) + "\n")


if __name__ == "__main__":
    main()

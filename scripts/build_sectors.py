"""Builds data/sectors.json: a simple sector name for each S&P 500 stock, plus some other popular stocks.

Used by the personal Home page's "What I own by sector" view. Sector names are kept short and plain
(Tech, Banks, Health...) to match the Class Portfolio. Funds are found from data/stocks.json instead
(no exchange listed), and anything not here shows as "Other".

Run now and then:  python3 scripts/build_sectors.py
"""
import html, json, re, urllib.request, pathlib

URL = "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies"
GICS = {
    "Information Technology": "Tech", "Health Care": "Health", "Energy": "Energy",
    "Consumer Staples": "Food & Household", "Industrials": "Industrial", "Utilities": "Utilities",
    "Real Estate": "Real Estate", "Materials": "Materials",
}
FUN = ("Hotels", "Restaurants", "Casinos", "Leisure")

def simple(sector, sub):
    if sector in GICS: return GICS[sector]
    if sector == "Financials": return "Insurance" if "Insurance" in sub or "Reinsurance" in sub else "Banks"
    if sector == "Communication Services": return "Tech" if "Interactive" in sub else "Media"
    if sector == "Consumer Discretionary":
        if sub.startswith("Automobile") or "Automotive Parts" in sub: return "Cars"
        if any(sub.startswith(f) for f in FUN): return "Travel & Fun"
        return "Shopping"
    return "Other"

# Popular stocks that aren't in the S&P 500.
EXTRA = {
    "TSM": "Tech", "ASML": "Tech", "ARM": "Tech", "SHOP": "Tech", "SNOW": "Tech", "NET": "Tech", "MDB": "Tech",
    "TEAM": "Tech", "SAP": "Tech", "SONY": "Tech", "RBLX": "Tech", "SPOT": "Tech", "SNAP": "Tech", "PINS": "Tech",
    "BABA": "Shopping", "PDD": "Shopping", "MELI": "Shopping", "SE": "Shopping", "CHWY": "Shopping", "GME": "Shopping",
    "ETSY": "Shopping", "CVNA": "Cars", "RIVN": "Cars", "LCID": "Cars", "NIO": "Cars", "TM": "Cars", "HMC": "Cars",
    "COIN": "Banks", "HOOD": "Banks", "SOFI": "Banks", "NU": "Banks", "AFRM": "Banks", "UPST": "Banks", "MSTR": "Tech",
    "AMC": "Media", "DKNG": "Travel & Fun", "CELH": "Food & Household", "NVO": "Health", "AZN": "Health",
    "SPCX": "Industrial", "RKLB": "Industrial", "JOBY": "Industrial", "ACHR": "Industrial", "SMR": "Utilities",
    "OKLO": "Utilities", "IONQ": "Tech", "RGTI": "Tech", "SOUN": "Tech", "AI": "Tech", "U": "Tech", "ZM": "Tech",
    "ROKU": "Media", "SIRI": "Media", "BP": "Energy", "SHEL": "Energy", "TTE": "Energy",
}

def main():
    req = urllib.request.Request(URL, headers={"User-Agent": "simple-street-sectors/1.0"})
    page = urllib.request.urlopen(req, timeout=30).read().decode("utf-8")
    table = page[page.find('id="constituents"'):]
    table = table[:table.find("</table>")]
    out = {}
    for row in re.findall(r"<tr[^>]*>(.*?)</tr>", table, re.S)[1:]:
        cells = [html.unescape(re.sub("<[^>]+>", "", c)).strip() for c in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)]
        if len(cells) > 3: out[cells[0]] = simple(cells[2], cells[3])
    if len(out) < 450: raise SystemExit(f"Only found {len(out)} stocks; the page may have changed.")
    for k, v in EXTRA.items(): out.setdefault(k, v)
    path = pathlib.Path(__file__).resolve().parent.parent / "data" / "sectors.json"
    path.write_text(json.dumps({"source": "S&P 500 sectors (Wikipedia) plus popular stocks", "sectors": dict(sorted(out.items()))}, separators=(",", ":")) + "\n")
    print(f"Wrote {len(out)} stocks to {path}")

if __name__ == "__main__":
    main()

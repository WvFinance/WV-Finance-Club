// Official company numbers from the SEC's free EDGAR data (no key, no cost).
// Turns the latest quarterly report into a few plain sentences before Gemini sees them,
// so the brief can quote real results without copying finance jargon.

const UA = "WV Finance Club brief server warrior.financec@gmail.com";
const DAY = 86400000;
const MAX_AGE = 200 * DAY; // numbers older than this aren't "the latest", so they're left out
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const REVENUE = ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet", "RevenuesNetOfInterestExpense"];

const fmtDate = d => `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;

async function get(url, ms = 6000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/json, application/atom+xml" }, signal: ctrl.signal });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`${r.status} from ${new URL(url).hostname}`);
    return await r.text();
  } finally {
    clearTimeout(t);
  }
}

// "$11.5 billion", "$820 million".
export function money(v) {
  const a = Math.abs(v);
  const s = a >= 1e9 ? `$${(a / 1e9).toFixed(a >= 1e11 ? 0 : 1)} billion` : a >= 1e6 ? `$${Math.round(a / 1e6)} million` : `$${Math.round(a).toLocaleString("en-US")}`;
  return v < 0 ? `a loss of ${s}` : s;
}

// "NVIDIA CORP /DE/" -> full "Nvidia Corp" and short "Nvidia"; "AT&T INC." -> "AT&T Inc." and "AT&T".
export function companyNames(raw) {
  const clean = raw.replace(/&amp;/g, "&").replace(/\s*\/[A-Z]{2,}\/?\s*$/i, "").replace(/\s+/g, " ").trim();
  const full = clean.split(" ").map(w => /&|^[A-Z]{1,3}$/.test(w) && !/^(INC|CO|THE)$/.test(w) ? w : w.charAt(0) + w.slice(1).toLowerCase()).join(" ");
  const short = full.replace(/,?\s+(inc\.?|corp\.?|corporation|co\.?|company|holdings?|group|ltd\.?|plc|n\.?v\.?|s\.?a\.?|incorporated|class [a-z])$/gi, "")
    .replace(/,?\s+(inc\.?|corp\.?|corporation|co\.?|company|holdings?|group|ltd\.?|plc)$/gi, "").replace(/\s*&$/, "").trim();
  return { full, short: short || full };
}

// Picks the newest 3-month result and the same 3 months a year earlier.
export function latestQuarter(units) {
  const rows = (units || []).filter(r => r.start && r.end && Number.isFinite(r.val))
    .map(r => ({ ...r, s: Date.parse(r.start), e: Date.parse(r.end) }))
    .filter(r => r.e - r.s > 80 * DAY && r.e - r.s < 100 * DAY)
    .sort((a, b) => b.e - a.e || Date.parse(b.filed) - Date.parse(a.filed));
  const now = rows[0];
  if (!now) return null;
  const before = rows.find(r => Math.abs(now.e - r.e - 365 * DAY) < 20 * DAY);
  return { now, before };
}

async function concept(cik, name) {
  const t = await get(`https://data.sec.gov/api/xbrl/companyconcept/CIK${cik}/us-gaap/${name}.json`);
  return t ? latestQuarter(JSON.parse(t).units?.USD) : null;
}

function change(now, before) {
  if (!before || before.val <= 0 || now.val <= 0) return "";
  const pct = Math.round((now.val / before.val - 1) * 100);
  return pct === 0 ? ", about the same as" : `, ${pct > 0 ? "up" : "down"} ${Math.abs(pct)}% from`;
}

// The company's SEC ID and name, or null for funds and tickers the SEC doesn't know.
export async function secLookup(ticker) {
  const atom = await get(`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${encodeURIComponent(ticker)}&type=10-Q&dateb=&owner=include&count=1&output=atom`);
  const cik = atom && (atom.match(/<cik>(\d+)<\/cik>/i) || [])[1];
  if (!cik) return null;
  const raw = (atom.match(/<conformed-name>([^<]+)<\/conformed-name>/i) || [])[1] || ticker;
  return { cik, ...companyNames(raw) };
}

// Returns an article-shaped object (title, url, outlet, date, text) or null if there are no recent numbers.
export async function secFacts(company, now = Date.now()) {
  if (!company) return null;
  const cik10 = company.cik.padStart(10, "0");

  // Companies change how they label sales over the years, so use whichever label has the newest quarter.
  const found = (await Promise.all(REVENUE.map(n => concept(cik10, n).catch(() => null)))).filter(Boolean);
  const sales = found.sort((a, b) => b.now.e - a.now.e)[0] || null;
  let profit = await concept(cik10, "NetIncomeLoss").catch(() => null);
  const main = sales || profit;
  if (!main || now - main.now.e > MAX_AGE) return null;
  // Profit must be for the same 3 months as sales, or it's left out.
  if (sales && profit && Math.abs(profit.now.e - sales.now.e) > 10 * DAY) profit = null;

  const lines = [`In the 3 months that ended ${fmtDate(new Date(main.now.e))}:`];
  if (sales) lines.push(`Sales were ${money(sales.now.val)}${sales.before ? `${change(sales.now, sales.before)} ${money(sales.before.val)} in the same 3 months a year earlier` : ""}.`);
  if (profit) {
    const was = v => v < 0 ? `a loss of ${money(-v)}` : `a profit of ${money(v)}`;
    lines.push(`${profit.now.val < 0 ? `The company lost ${money(-profit.now.val)}` : `Profit was ${money(profit.now.val)}`}${profit.before ? `, compared with ${was(profit.before.val)} a year earlier` : ""}.`);
  }
  const accn = main.now.accn;
  const filed = new Date(main.now.filed);
  return {
    title: `${company.full}: official quarterly report to the SEC (Form ${main.now.form})`,
    url: accn ? `https://www.sec.gov/Archives/edgar/data/${Number(company.cik)}/${accn.replace(/-/g, "")}/` : `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${company.cik}`,
    outlet: "SEC (company's official report)",
    published: filed,
    date: fmtDate(filed),
    text: lines.join(" "),
    official: true,
  };
}

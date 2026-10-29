// Official company numbers from the SEC's free EDGAR data (no key, no cost).
// Turns the latest quarterly report into a few plain sentences before Gemini sees them,
// so the brief can quote real results without copying finance jargon.

const UA = "WV Finance Club brief server (https://wvfinance.github.io; github.com/WvFinance)";
const DAY = 86400000;
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

// "$11.5 billion", "$820 million", "a loss of $1.2 billion".
export function money(v) {
  const a = Math.abs(v);
  const s = a >= 1e9 ? `$${(a / 1e9).toFixed(a >= 1e11 ? 0 : 1)} billion` : a >= 1e6 ? `$${Math.round(a / 1e6)} million` : `$${Math.round(a).toLocaleString("en-US")}`;
  return v < 0 ? `a loss of ${s}` : s;
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

// Returns an article-shaped object (title, url, outlet, date, text) or null if the SEC has nothing.
export async function secFacts(ticker) {
  const atom = await get(`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${encodeURIComponent(ticker)}&type=10-Q&dateb=&owner=include&count=1&output=atom`);
  const cik = atom && (atom.match(/<cik>(\d+)<\/cik>/i) || [])[1];
  if (!cik) return null;
  const company = ((atom.match(/<conformed-name>([^<]+)<\/conformed-name>/i) || [])[1] || ticker).replace(/&amp;/g, "&").toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());
  const cik10 = cik.padStart(10, "0");

  let sales = null;
  for (const name of REVENUE) { sales = await concept(cik10, name); if (sales) break; }
  const profit = await concept(cik10, "NetIncomeLoss");
  const main = sales || profit;
  if (!main) return null;

  const end = new Date(main.now.e);
  const lines = [`In the 3 months that ended ${fmtDate(end)}:`];
  if (sales) lines.push(`Sales were ${money(sales.now.val)}${sales.before ? `${change(sales.now, sales.before)} ${money(sales.before.val)} in the same 3 months a year earlier` : ""}.`);
  if (profit) {
    const was = v => v < 0 ? `a loss of ${money(-v)}` : `a profit of ${money(v)}`;
    lines.push(`${profit.now.val < 0 ? `The company lost ${money(-profit.now.val)}` : `Profit was ${money(profit.now.val)}`}${profit.before ? `, compared with ${was(profit.before.val)} a year earlier` : ""}.`);
  }
  const accn = main.now.accn;
  const filed = new Date(main.now.filed);
  return {
    title: `${company}: official quarterly report to the SEC (Form ${main.now.form})`,
    url: accn ? `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accn.replace(/-/g, "")}/` : `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}`,
    outlet: "SEC (company's official report)",
    published: filed,
    date: fmtDate(filed),
    text: lines.join(" "),
    official: true,
  };
}

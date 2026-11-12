// GET /congress: the latest stock trades reported by members of Congress, for the Feed page.
// The data comes live from Bargo's free Congress API (https://www.bargo.ai/free-apis/congress),
// which reads the official House and Senate filings. Bargo's terms let us show it to our users with a
// visible "Data via Bargo" link and cache it for speed, but not store or republish the raw records,
// so it is only kept in this server's short-lived cache, never saved to the repository.
// Needs the secret BARGO_API_KEY (a free key from bargo.ai/free-apis/dash). Without a key Bargo counts
// calls by internet address, and this server shares its addresses with other Cloudflare sites, so it gets "429 too many".
const SRC = "https://www.bargo.ai/free-apis/congress/v1/trades";
const FRESH = 6 * 60 * 60;          // ask Bargo again after 6 hours
const KEEP = 3 * 24 * 60 * 60;      // if Bargo is down, keep showing the last list for up to 3 days

const clean = (s, n) => (typeof s === "string" ? s.trim().slice(0, n) : "");

function shape(t) {
  const type = clean(t.type, 12).toLowerCase();
  return {
    member: clean(t.member, 80),
    chamber: clean(t.chamber, 8).toLowerCase(),
    state: clean(t.state, 6).toUpperCase(),
    ticker: clean(t.ticker, 10).toUpperCase(),
    asset: clean(t.asset, 80),
    side: type === "purchase" ? "buy" : type === "sale" || type.startsWith("sale") ? "sell" : type,
    range: clean(t.amount_range, 40),
    traded: clean(t.transaction_date, 10),
    reported: clean(t.disclosure_date, 10),
  };
}

async function fromBargo(env) {
  const key = env.BARGO_API_KEY;
  const url = `${SRC}?limit=${key ? 250 : 100}`;
  const r = await fetch(url, { headers: { Accept: "application/json", ...(key ? { "X-Api-Key": key } : {}) } });
  if (!r.ok) throw new Error("Bargo answered " + r.status);
  const j = await r.json();
  const trades = (Array.isArray(j.trades) ? j.trades : []).map(shape)
    .filter((t) => t.member && t.ticker && /^[A-Z][A-Z0-9.\-]{0,9}$/.test(t.ticker) && (t.side === "buy" || t.side === "sell"));
  if (!trades.length) throw new Error("Bargo sent no trades");
  return { trades, checked: new Date().toISOString() };
}

export async function handleCongress(request, env, url, json, headers) {
  if (url.pathname !== "/congress") return null;
  if (request.method !== "GET") return json({ error: "not found" }, 404, headers);
  const saved = await env.BRIEFS.get("congress", "json");
  if (saved && Date.now() - Date.parse(saved.checked) < FRESH * 1000) return json(saved, 200, headers);
  // After a failed try, wait 15 minutes before asking Bargo again, so its daily limit isn't used up.
  if (await env.BRIEFS.get("congress:fail")) {
    if (saved) return json({ ...saved, stale: true }, 200, headers);
    return json({ error: "Congress trades couldn't be loaded right now." }, 502, headers);
  }
  try {
    const fresh = await fromBargo(env);
    await env.BRIEFS.put("congress", JSON.stringify(fresh), { expirationTtl: KEEP });
    return json(fresh, 200, headers);
  } catch (e) {
    await env.BRIEFS.put("congress:fail", "1", { expirationTtl: 15 * 60 });
    if (saved) return json({ ...saved, stale: true }, 200, headers);
    return json({ error: "Congress trades couldn't be loaded right now.", reason: String(e.message || e) }, 502, headers);
  }
}

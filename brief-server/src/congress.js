// GET /congress: the latest stock trades reported by members of Congress, for the Feed page.
// The data comes live from Bargo's free Congress API (https://www.bargo.ai/free-apis/congress),
// which reads the official House and Senate filings. Bargo's terms let us show it to our users with a
// visible "Data via Bargo" link and cache it for speed, but not store or republish the raw records,
// so it is only kept in this server's short-lived cache, never saved to the repository.
// Needs the secret BARGO_API_KEY (a free key from bargo.ai/free-apis/dash). Without a key Bargo counts
// calls by internet address, and this server shares its addresses with other Cloudflare sites, so it gets "429 too many".
const SRC = "https://www.bargo.ai/free-apis/congress/v1/trades";
// Bargo's free key allows 1,000 rows a day. The main list is 250 rows, so asking every 12 hours uses 500,
// which leaves room for one member's trades at a time (/congress/member, 50 rows, kept for a day).
const FRESH = 12 * 60 * 60;         // ask Bargo again after 12 hours
const MEMBER_ROWS = 50;
const MEMBER_FRESH = 24 * 60 * 60;
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

// GET /congress/member?name=Nancy%20Pelosi: one member's trades from the last 3 months (Bargo keeps 3 months).
async function memberTrades(env, url, json, headers) {
  const name = clean(url.searchParams.get("name") || "", 80);
  if (name.length < 2) return json({ error: "Which member?" }, 400, headers);
  const key = "congress:m:" + name.toLowerCase();
  const saved = await env.BRIEFS.get(key, "json");
  if (saved) return json(saved, 200, headers);
  if (await env.BRIEFS.get("congress:mfail")) return json({ error: "More trades couldn't be loaded right now. Try again later." }, 502, headers);
  try {
    const k = env.BARGO_API_KEY;
    const r = await fetch(`${SRC}?member=${encodeURIComponent(name)}&limit=${MEMBER_ROWS}`,
      { headers: { Accept: "application/json", ...(k ? { "X-Api-Key": k } : {}) } });
    if (!r.ok) throw new Error("Bargo answered " + r.status);
    const j = await r.json();
    const trades = (Array.isArray(j.trades) ? j.trades : []).map(shape)
      .filter((t) => t.member && t.ticker && /^[A-Z][A-Z0-9.\-]{0,9}$/.test(t.ticker) && (t.side === "buy" || t.side === "sell"));
    const out = { trades, checked: new Date().toISOString() };
    await env.BRIEFS.put(key, JSON.stringify(out), { expirationTtl: MEMBER_FRESH });
    return json(out, 200, headers);
  } catch (e) {
    await env.BRIEFS.put("congress:mfail", "1", { expirationTtl: 30 * 60 });
    return json({ error: "More trades couldn't be loaded right now. Try again later.", reason: String(e.message || e) }, 502, headers);
  }
}

export async function handleCongress(request, env, url, json, headers) {
  if (url.pathname === "/congress/member" && request.method === "GET") return memberTrades(env, url, json, headers);
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

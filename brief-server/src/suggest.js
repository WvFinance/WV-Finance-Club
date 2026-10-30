// Suggestions tab: stock pitch ideas, meeting topic ideas and private site feedback.
// Members see pitch and topic ideas in random order and can upvote them, but never the vote counts.
// Only the club leader sees counts and feedback, with the SUGGEST_ADMIN password (a Cloudflare secret).
// Everything is one list saved under "sg:items" in the same store as the briefs.

const DAY = 24 * 60 * 60;
const KINDS = ["pitch", "topic", "feedback"];
const MAX_ITEMS = 400;
const ADD_LIMIT = 15;   // new suggestions one internet address can add per day
const VOTE_LIMIT = 200; // votes one internet address can give per day (a whole school shares one address)
const BAD_TRIES = 10;   // wrong leader passwords one address can try per day

const today = () => new Date().toISOString().slice(0, 10);
const clean = (s, max) => String(s || "").replace(/[\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

async function load(env) { return (await env.BRIEFS.get("sg:items", "json")) || []; }
async function save(env, items) { await env.BRIEFS.put("sg:items", JSON.stringify(items)); }

async function underLimit(env, key, limit) {
  const used = Number(await env.BRIEFS.get(key)) || 0;
  if (used >= limit) return false;
  await env.BRIEFS.put(key, String(used + 1), { expirationTtl: 2 * DAY });
  return true;
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// Compares without stopping early, so the time taken doesn't hint at the password.
function same(a, b) {
  a = String(a || ""); b = String(b || "");
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

const validVoter = v => /^[a-z0-9]{12,40}$/i.test(v || "");

// Returns a Response, or null if the path isn't a suggestions path.
export async function handleSuggest(request, env, url, json, headers) {
  if (!url.pathname.startsWith("/suggest")) return null;
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const day = today();
  const body = request.method === "POST" ? await request.json().catch(() => ({})) : {};

  // Public list: pitch and topic ideas only, shuffled, no vote counts.
  if (url.pathname === "/suggest" && request.method === "GET") {
    const voter = url.searchParams.get("voter");
    const items = (await load(env)).filter(i => i.kind !== "feedback" && !i.hidden);
    return json({
      items: shuffle(items.map(i => ({ id: i.id, kind: i.kind, text: i.text, why: i.why, at: i.at }))),
      voted: validVoter(voter) ? items.filter(i => (i.voters || []).includes(voter)).map(i => i.id) : [],
    }, 200, headers);
  }

  if (url.pathname === "/suggest" && request.method === "POST") {
    const kind = KINDS.includes(body.kind) ? body.kind : null;
    const text = clean(body.text, kind === "feedback" ? 600 : 120);
    const why = clean(body.why, 300);
    if (!kind || text.length < 2) return json({ error: "Please write your idea first." }, 400, headers);
    if (!(await underLimit(env, `sg:add:${day}:${ip}`, ADD_LIMIT))) return json({ error: "This network has sent a lot of suggestions today. Try again tomorrow." }, 429, headers);
    const items = await load(env);
    if (items.length >= MAX_ITEMS) return json({ error: "The suggestion box is full. Ask the club leader to clear out old ideas." }, 507, headers);
    const id = crypto.randomUUID().slice(0, 8);
    items.push({ id, kind, text, why, at: new Date().toISOString(), voters: [], hidden: false });
    await save(env, items);
    return json({ ok: true, id }, 200, headers);
  }

  if (url.pathname === "/suggest/vote" && request.method === "POST") {
    if (!validVoter(body.voter)) return json({ error: "Your vote couldn't be saved. Refresh the page and try again." }, 400, headers);
    const items = await load(env);
    const item = items.find(i => i.id === body.id && i.kind !== "feedback" && !i.hidden);
    if (!item) return json({ error: "That idea isn't there anymore." }, 404, headers);
    item.voters = item.voters || [];
    if (item.voters.includes(body.voter)) return json({ ok: true }, 200, headers);
    if (!(await underLimit(env, `sg:vote:${day}:${ip}`, VOTE_LIMIT))) return json({ error: "Too many votes from this network today. Try again tomorrow." }, 429, headers);
    item.voters.push(body.voter);
    await save(env, items);
    return json({ ok: true }, 200, headers);
  }

  // Club leader only: everything, with vote counts, plus hide/show/delete.
  if (url.pathname === "/suggest/admin" && request.method === "POST") {
    if (!env.SUGGEST_ADMIN) return json({ error: "The leader password hasn't been set up yet." }, 503, headers);
    const badKey = `sg:bad:${day}:${ip}`;
    if ((Number(await env.BRIEFS.get(badKey)) || 0) >= BAD_TRIES) return json({ error: "Too many wrong tries today. Try again tomorrow." }, 429, headers);
    if (!same(body.password, env.SUGGEST_ADMIN)) {
      await underLimit(env, badKey, BAD_TRIES);
      return json({ error: "That's not the leader password." }, 401, headers);
    }
    let items = await load(env);
    if (body.action && body.id) {
      const item = items.find(i => i.id === body.id);
      if (item && body.action === "hide") item.hidden = true;
      if (item && body.action === "show") item.hidden = false;
      if (body.action === "delete") items = items.filter(i => i.id !== body.id);
      await save(env, items);
    }
    return json({
      items: items.map(i => ({ id: i.id, kind: i.kind, text: i.text, why: i.why, at: i.at, hidden: !!i.hidden, votes: (i.voters || []).length }))
        .sort((a, b) => b.votes - a.votes || b.at.localeCompare(a.at)),
    }, 200, headers);
  }

  return json({ error: "not found" }, 404, headers);
}

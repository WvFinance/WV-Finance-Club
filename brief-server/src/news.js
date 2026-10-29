// Gathers recent news about a stock from free public feeds (no keys, no cost):
// Google News and Yahoo Finance. Used by the brief server before Gemini writes the brief.

const UA = "Mozilla/5.0 (compatible; WVFC-brief-server/1.0; +https://wvfinance.github.io)";
const DAYS = 14;
const MAX_ARTICLES = 15;
const FULL_TEXT = 6;        // how many articles to read in full
const PAGE_CAP = 200000;    // most characters read from one article page
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "Mon D, YYYY", the date style the site uses.
export function fmtDate(d) {
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function decode(s) {
  return (s || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => {
      if (e[0] === "#") {
        const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(n) ? String.fromCodePoint(n) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    });
}
const stripTags = s => decode(s).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? m[1] : "";
};

async function get(url, ms = 6000, cap = 400000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/rss+xml, application/xml, text/html;q=0.9, */*;q=0.8" }, signal: ctrl.signal });
    if (!r.ok) throw new Error(`${r.status} from ${new URL(url).hostname}`);
    return await readCapped(r, cap);
  } finally {
    clearTimeout(t);
  }
}

// Reads at most `max` characters so a huge page can't use up the server's time.
async function readCapped(res, max) {
  if (!res.body) return (await res.text()).slice(0, max);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let out = "";
  while (out.length < max) {
    const { done, value } = await reader.read();
    if (done) break;
    out += dec.decode(value, { stream: true });
  }
  reader.cancel().catch(() => {});
  return out.slice(0, max);
}

export function parseGoogleNews(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, it]) => {
    const outlet = stripTags(tag(it, "source"));
    let title = stripTags(tag(it, "title"));
    if (outlet && title.endsWith(" - " + outlet)) title = title.slice(0, -(outlet.length + 3));
    return { title, url: decode(tag(it, "link")).trim(), outlet, published: new Date(stripTags(tag(it, "pubDate"))), summary: "" };
  });
}

// Bing links point to bing.com/news/apiclick.aspx?...&url=<real article>; keep the real link.
export function parseBing(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, it]) => {
    let url = decode(tag(it, "link")).trim();
    try { const real = new URL(url).searchParams.get("url"); if (real && /^https?:\/\//.test(real)) url = real; } catch {}
    return {
      title: stripTags(tag(it, "title")),
      url,
      outlet: stripTags(tag(it, "News:Source")) || "Bing News",
      published: new Date(stripTags(tag(it, "pubDate"))),
      summary: stripTags(tag(it, "description")).slice(0, 600),
    };
  });
}

export function parseYahoo(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, it]) => ({
    title: stripTags(tag(it, "title")),
    url: decode(tag(it, "link")).trim(),
    outlet: "Yahoo Finance",
    published: new Date(stripTags(tag(it, "pubDate"))),
    summary: stripTags(tag(it, "description")).slice(0, 600),
  }));
}

// Keeps recent, real, non-duplicate articles, newest first.
export function cleanArticles(lists, now = new Date()) {
  const cutoff = now.getTime() - DAYS * 86400000;
  const seen = new Set();
  const out = [];
  // Each feed newest first, then take turns between feeds so every brief gets a mix of outlets.
  const queues = lists.map(l => l.filter(a => a.title && /^https?:\/\//.test(a.url) && a.published.getTime() >= cutoff)
    .sort((x, y) => y.published - x.published));
  while (out.length < MAX_ARTICLES && queues.some(q => q.length)) {
    for (const q of queues) {
      const a = q.shift();
      if (!a) continue;
      const key = a.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 70);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...a, date: fmtDate(a.published) });
      if (out.length >= MAX_ARTICLES) break;
    }
  }
  return out.sort((x, y) => y.published - x.published);
}

// The readable paragraphs of an article page, or "" if the site blocks us.
// Stops as soon as it has enough text, to stay inside the free server's short time limit.
export function articleText(html, max = 3000) {
  let out = "";
  for (const m of html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    if (m[1].length < 60) continue;
    const p = stripTags(m[1]);
    if (p.length > 60 && !/cookie|subscribe|sign in|newsletter|javascript/i.test(p)) out += (out ? " " : "") + p;
    if (out.length >= max) break;
  }
  return out.slice(0, max);
}

// Tries a slow feed a second time before giving up on it.
const retry = f => f().catch(() => f());

const FEEDS = {
  "Google News": t => retry(() => get(`https://news.google.com/rss/search?q=${encodeURIComponent(`${t} stock when:${DAYS}d`)}&hl=en-US&gl=US&ceid=US:en`, 10000)).then(parseGoogleNews),
  "Bing News": t => retry(() => get(`https://www.bing.com/news/search?q=${encodeURIComponent(`${t} stock`)}&format=rss&mkt=en-US`, 8000)).then(parseBing),
  "Yahoo Finance": t => get(`https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(t)}&region=US&lang=en-US`).then(parseYahoo),
};

// What each feed returned, for the /news-check test (no AI, no cost).
export async function checkFeeds(ticker) {
  const out = {};
  for (const [name, f] of Object.entries(FEEDS)) {
    try { const items = await f(ticker); out[name] = { items: items.length, recent: cleanArticles([items]).length }; }
    catch (e) { out[name] = { error: String(e.message || e) }; }
  }
  return out;
}

export async function gatherNews(ticker) {
  const feeds = await Promise.allSettled(Object.values(FEEDS).map(f => f(ticker)));
  for (const f of feeds) if (f.status === "rejected") console.warn("news feed failed:", String(f.reason));
  const articles = cleanArticles(feeds.filter(f => f.status === "fulfilled").map(f => f.value));

  // Google News links only redirect in a browser, so read full text from direct links (Yahoo, Bing).
  const direct = articles.filter(a => !/news\.google\.com/.test(a.url)).slice(0, FULL_TEXT);
  await Promise.allSettled(direct.map(async a => {
    const text = articleText(await get(a.url, 5000, PAGE_CAP));
    if (text.length > 200) a.text = text;
  }));
  return articles;
}

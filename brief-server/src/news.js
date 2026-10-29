// Gathers recent news about a stock from free public feeds (no keys, no cost):
// Google News and Yahoo Finance. Used by the brief server before Gemini writes the brief.

const UA = "Mozilla/5.0 (compatible; WVFC-brief-server/1.0; +https://wvfinance.github.io)";
const DAYS = 14;
const MAX_ARTICLES = 15;
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

async function get(url, ms = 6000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/rss+xml, application/xml, text/html;q=0.9, */*;q=0.8" }, signal: ctrl.signal });
    if (!r.ok) throw new Error(`${r.status} from ${new URL(url).hostname}`);
    return await readCapped(r, 400000);
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
  for (const a of lists.flat().sort((x, y) => y.published - x.published)) {
    if (!a.title || !/^https?:\/\//.test(a.url) || !(a.published.getTime() >= cutoff)) continue;
    const key = a.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 70);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...a, date: fmtDate(a.published) });
    if (out.length >= MAX_ARTICLES) break;
  }
  return out;
}

// The readable paragraphs of an article page, or "" if the site blocks us.
export function articleText(html) {
  const paras = [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map(m => stripTags(m[1]))
    .filter(p => p.length > 60 && !/cookie|subscribe|sign in|newsletter|javascript/i.test(p));
  return paras.join(" ").slice(0, 1500);
}

// Gathers up to 15 articles from the last two weeks, and the full text of up to 3 of them.
export async function gatherNews(ticker) {
  const q = encodeURIComponent(`${ticker} stock when:${DAYS}d`);
  const feeds = await Promise.allSettled([
    get(`https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`).then(parseGoogleNews),
    get(`https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(ticker)}&region=US&lang=en-US`).then(parseYahoo),
  ]);
  for (const f of feeds) if (f.status === "rejected") console.warn("news feed failed:", String(f.reason));
  const articles = cleanArticles(feeds.filter(f => f.status === "fulfilled").map(f => f.value));

  // Google News links only redirect in a browser, so try full text on direct links (mostly Yahoo).
  const direct = articles.filter(a => !/news\.google\.com/.test(a.url)).slice(0, 3);
  await Promise.allSettled(direct.map(async a => {
    const text = articleText(await get(a.url, 4000));
    if (text.length > 200) a.text = text;
  }));
  return articles;
}

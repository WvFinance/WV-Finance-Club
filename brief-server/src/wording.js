// Checks that a brief reads at a high school level: no unexplained finance jargon,
// and not too hard to read (Flesch-Kincaid grade level).

// Words a 15-year-old likely won't know. Fine only when explained right after, like "price target (its guess...)".
const JARGON = [
  "EPS", "EBITDA", "P/E", "price-to-earnings", "basis points?", "bps", "consensus", "year-over-year", "YoY", "y/y",
  "guidance", "(?:profit |operating |gross )?margins?(?! of)", "(?:sales |earnings |price |valuation )multiples?", "headwinds?", "tailwinds?", "capex", "capital expenditures?", "free cash flow",
  "diluted", "GAAP", "top line", "bottom line", "fiscal", "valuation", "outperform", "underperform", "overweight",
  "underweight", "price target", "short interest", "dividend yield", "buybacks?", "market cap(?:italization)?",
  "sequential(?:ly)?", "Q[1-4]", "H[12]", "FY\\d*", "accretive", "dilutive", "run-rate", "TAM", "ARPU", "comps", "comparable sales", "operating income",
];
const JARGON_RE = new RegExp(`(?<![\\w-])(${JARGON.join("|")})(?![\\w-])`, "gi");

// Jargon terms used without an explanation right after them.
export function unexplainedJargon(text) {
  const out = new Set();
  const explained = new Set(); // once a term is explained, later uses of it are fine
  for (const m of text.matchAll(JARGON_RE)) {
    const key = m[0].toLowerCase();
    if (explained.has(key)) continue;
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 25);
    if (/^\s*(\(|—|–|-\s|, (which|meaning|or)\b|, the\b| means\b| is (how|what|the)\b)/i.test(after)) { explained.add(key); continue; }
    out.add(m[0]);
  }
  return [...out];
}

function syllables(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const groups = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "").match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

// Flesch-Kincaid grade. Numbers like "$11.5" count as one short word.
export function gradeLevel(text) {
  const sentences = text.split(/[.!?]+(?=\s|$)/).filter(s => /[a-z]/i.test(s)).length || 1;
  const words = text.replace(/\$?\d[\d,.]*%?/g, "num").match(/[A-Za-z][A-Za-z'-]*/g) || [];
  if (!words.length) return 0;
  const syl = words.reduce((n, w) => n + (w === "num" ? 1 : syllables(w)), 0);
  return 0.39 * (words.length / sentences) + 11.8 * (syl / words.length) - 15.59;
}

export const MAX_GRADE = 11;

// Short plain-English explanations, added automatically if a rewrite still leaves a term unexplained.
const GLOSSARY = [
  [/^eps$/i, "profit per share"], [/^ebitda$/i, "a measure of profit before some costs"], [/^p\/e$|^price-to-earnings$/i, "how many years of profit the stock price equals"],
  [/^basis points?$|^bps$/i, "hundredths of a percent"], [/^consensus$/i, "what analysts expected on average"],
  [/^year-over-year$|^yoy$|^y\/y$/i, "compared with a year earlier"], [/^guidance$/i, "the company's own forecast"],
  [/margins?$/i, "how much of each dollar of sales is profit"], [/multiples?$/i, "how expensive the stock is compared with its profit or sales"],
  [/^headwinds?$/i, "problems slowing it down"], [/^tailwinds?$/i, "things helping it"], [/^capex$|^capital expenditures?$/i, "spending on buildings and equipment"],
  [/^free cash flow$/i, "cash left after paying for the business"], [/^diluted$/i, "counting all shares that could exist"], [/^gaap$/i, "standard accounting rules"],
  [/^top line$/i, "sales"], [/^bottom line$/i, "profit"], [/^fiscal$/i, "the company's own business year"], [/^valuation$/i, "how much the stock market thinks the company is worth"],
  [/^outperform$|^overweight$/i, "a rating meaning analysts like the stock"], [/^underperform$|^underweight$/i, "a rating meaning analysts are cautious"],
  [/^price target$/i, "an analyst's guess of what the stock could be worth"], [/^short interest$/i, "how many shares people are betting will fall"],
  [/^dividend yield$/i, "yearly cash paid to shareholders compared with the stock price"], [/^buybacks?$/i, "the company buying its own shares"],
  [/^market cap/i, "the total value of all its shares"], [/^sequential(ly)?$/i, "compared with the 3 months before"], [/^q[1-4]$/i, "a 3-month period of the year"],
  [/^h[12]$/i, "half of the year"], [/^fy\d*$/i, "the company's business year"], [/^accretive$/i, "adding to profit per share"], [/^dilutive$/i, "lowering profit per share"],
  [/^run-rate$/i, "the current pace for a full year"], [/^tam$/i, "the total market it could sell to"], [/^arpu$/i, "average sales per customer"],
  [/^comps$|^comparable sales$/i, "sales at stores open at least a year"], [/^operating income$/i, "profit from the main business"],
];

// Adds a short explanation in parentheses after the first unexplained use of each jargon term.
// The headline is left alone so it stays short.
export function explainJargon(b) {
  const done = new Set();
  const fix = text => text.replace(JARGON_RE, (m, _t, offset, whole) => {
    const key = m.toLowerCase();
    const after = whole.slice(offset + m.length, offset + m.length + 25);
    if (done.has(key) || /^\s*(\(|—|–|-\s|, (which|meaning|or)\b|, the\b| means\b| is (how|what|the)\b)/i.test(after)) return m;
    const g = GLOSSARY.find(([re]) => re.test(m));
    if (!g) return m;
    done.add(key);
    return `${m} (${g[1]})`;
  });
  return { ...b, summary: fix(b.summary), bull: b.bull.map(fix), bear: b.bear.map(fix) };
}

// Buy/sell advice aimed at the reader, which the site never gives (reporting analysts' ratings is fine).
const ADVICE = /\b(you|investors|readers|everyone) (should|must|need to|ought to) (buy|sell|hold|consider buying|consider selling|get in|get out)\b|\b(good|great|perfect|bad|right) time to (buy|sell)\b|\bbuy the dip\b|\b(we|i) (recommend|suggest)\b|\bdon't miss\b/i;
export function givesAdvice(b) {
  return ADVICE.test([b.headline, b.summary, ...b.bull, ...b.bear].join(" "));
}

// What to fix, or [] if the brief is fine.
export function wordingProblems(b) {
  const text = [b.headline, b.summary, ...b.bull, ...b.bear].join(" ");
  const problems = [];
  if (givesAdvice(b)) problems.push("It gives buy or sell advice. This site only describes the news; never tell readers to buy, sell or hold.");
  const jargon = unexplainedJargon(text);
  if (jargon.length) problems.push(`These words are finance jargon a 15-year-old may not know: ${jargon.join(", ")}. Replace each with everyday words, or explain it in a few words in parentheses right after it.`);
  const grade = gradeLevel([b.summary, ...b.bull, ...b.bear].join(" "));
  if (grade > MAX_GRADE) problems.push(`It reads at about a grade ${grade.toFixed(1)} level. Aim for grade 9: shorter sentences and shorter, everyday words.`);
  return problems;
}

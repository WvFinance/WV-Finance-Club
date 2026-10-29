// Checks that a brief reads at a high school level: no unexplained finance jargon,
// and not too hard to read (Flesch-Kincaid grade level).

// Words a 15-year-old likely won't know. Fine only when explained right after, like "price target (its guess...)".
const JARGON = [
  "EPS", "EBITDA", "P/E", "price-to-earnings", "basis points?", "bps", "consensus", "year-over-year", "YoY", "y/y",
  "guidance", "margins?", "multiples?", "headwinds?", "tailwinds?", "capex", "capital expenditures?", "free cash flow",
  "diluted", "GAAP", "top line", "bottom line", "fiscal", "valuation", "outperform", "underperform", "overweight",
  "underweight", "price target", "short interest", "dividend yield", "buybacks?", "market cap(?:italization)?",
  "sequential(?:ly)?", "Q[1-4]", "H[12]", "FY\\d*", "accretive", "dilutive", "run-rate", "TAM", "ARPU", "comps", "comparable sales", "operating income",
];
const JARGON_RE = new RegExp(`(?<![\\w-])(${JARGON.join("|")})(?![\\w-])`, "gi");

// Jargon terms used without an explanation right after them.
export function unexplainedJargon(text) {
  const out = new Set();
  for (const m of text.matchAll(JARGON_RE)) {
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 25);
    if (/^\s*(\(|—|–|-\s|, (which|meaning|or)\b|, the\b| means\b| is (how|what|the)\b)/i.test(after)) continue;
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

// What to fix, or [] if the brief is fine.
export function wordingProblems(b) {
  const text = [b.headline, b.summary, ...b.bull, ...b.bear].join(" ");
  const problems = [];
  const jargon = unexplainedJargon(text);
  if (jargon.length) problems.push(`These words are finance jargon a 15-year-old may not know: ${jargon.join(", ")}. Replace each with everyday words, or explain it in a few words in parentheses right after it.`);
  const grade = gradeLevel([b.summary, ...b.bull, ...b.bear].join(" "));
  if (grade > MAX_GRADE) problems.push(`It reads at about a grade ${grade.toFixed(1)} level. Aim for grade 9: shorter sentences and shorter, everyday words.`);
  return problems;
}

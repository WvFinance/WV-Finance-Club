// Every school's picks, one per stock (two schools owning Apple still need only one Apple brief).
// data/schools.json says where each school's portfolio file is.
import { readFileSync, existsSync } from "node:fs";

const DATA = new URL("../../", import.meta.url);

export function allPicks() {
  let files = ["data/portfolio.json"];
  try { files = JSON.parse(readFileSync(new URL("data/schools.json", DATA), "utf8")).schools.map(s => s.portfolio).filter(Boolean); } catch (e) {}
  const seen = new Map();
  for (const f of new Set(files)) {
    const path = new URL(f, DATA);
    if (!existsSync(path)) continue;
    for (const p of JSON.parse(readFileSync(path, "utf8")).picks || []) {
      if (p.ticker && !seen.has(p.ticker)) seen.set(p.ticker, p);
    }
  }
  return [...seen.values()];
}

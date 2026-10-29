// Writes one news brief with Google Gemini (free tier) and Google Search.
import { SYSTEM, parseBrief } from "./brief-format.js";

const API = "https://generativelanguage.googleapis.com/v1beta/models/";

export async function writeBrief(apiKey, subject, model) {
  const res = await fetch(`${API}${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: "user", parts: [{ text: `Write the news brief for ${subject}.` }] }],
      tools: [{ google_search: {} }],
    }),
  });
   if (res.status === 429) throw Object.assign(new Error(await res.text()), { limit: true });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  const cand = (await res.json()).candidates?.[0];
  const text = (cand?.content?.parts || []).map(p => p.text || "").join("");
  const b = parseBrief(text, 0);
  b.sources = await realSources(b.sources, cand?.groundingMetadata);
  if (!b.sources.length) throw new Error("no real sources");
  return b;
}

// Keeps only sources Google actually searched, with their real article links.
async function realSources(sources, meta) {
  const chunks = (meta?.groundingChunks || []).map(c => c.web).filter(w => w?.uri);
  const real = (await Promise.all(chunks.map(async w => {
    try { const r = await fetch(w.uri, { redirect: "manual" }); return r.headers.get("location") || w.uri; }
    catch { return null; }
  }))).filter(u => u && /^https?:\/\//.test(u));
  const host = u => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
  const out = [];
  for (const s of sources) {
    let i = real.indexOf(s.url);
    if (i < 0) i = real.findIndex(u => host(u) === host(s.url));
    if (i < 0) continue;
    out.push({ ...s, url: real[i] });
    real.splice(i, 1);
  }
  return out;
}

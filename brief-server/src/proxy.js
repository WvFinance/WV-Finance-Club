// Passes login and database requests on to Supabase, so the site on simplestreet.com.co
// only needs its own address to work. School web filters then only have to allow that one name.
// GET/POST /sb/rest/v1/... -> SUPABASE_URL/rest/v1/...  (also /auth/v1, /realtime/v1)
export async function handleSupabase(request, env, url) {
  if (!url.pathname.startsWith("/sb/")) return null;
  const base = (env.SUPABASE_URL || "").replace(/\/$/, "");
  const rest = url.pathname.slice(3); // keeps the leading "/"
  if (!base || !/^\/(rest|auth|realtime)\/v1\//.test(rest)) return new Response("not found", { status: 404 });
  const target = base + rest + url.search;
  const headers = new Headers(request.headers);
  headers.delete("host");
  const ip = request.headers.get("CF-Connecting-IP");
  if (ip) headers.set("X-Forwarded-For", ip);
  const init = { method: request.method, headers, redirect: "manual" };
  if (!["GET", "HEAD"].includes(request.method)) init.body = request.body;
  return fetch(target, init);
}

-- Simple Street: briefs for the stocks people own in Paper Trading. Paste into Supabase's SQL Editor and press Run, once.
-- Safe to run again.
--
-- The free morning brief routine (brief-server/scripts/morning-briefs.mjs list) asks for this list so it also writes
-- briefs for stocks people own, not only the Class Portfolio. It shows only ticker symbols and how many players
-- own each one, never who owns them.
create or replace function public.owned_tickers() returns table (ticker text, owners integer)
language sql stable security definer set search_path = '' as $$
  select upper(symbol), count(distinct user_id)::int from public.paper_positions
  where shares <> 0 and symbol ~ '^[A-Za-z][A-Za-z0-9.\-]{0,9}$'
  group by upper(symbol) order by 2 desc, 1 limit 40;
$$;
revoke all on function public.owned_tickers() from public;
grant execute on function public.owned_tickers() to anon, authenticated;

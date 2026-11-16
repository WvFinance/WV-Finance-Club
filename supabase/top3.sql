-- Simple Street: "Most bought on Simple Street" list for the Top 3 Today tab. Paste into Supabase's SQL Editor and
-- press Run, once. Safe to run again.
--
-- Returns the stocks the most people bought in Paper Trading over the last 7 days: ticker symbols and counts only,
-- never who bought them.
create or replace function public.top3_bought() returns table (ticker text, buyers integer, buys integer)
language sql stable security definer set search_path = '' as $$
  select upper(symbol), count(distinct user_id)::int, count(*)::int from public.paper_trades
  where side = 'buy' and at > now() - interval '7 days' and symbol ~ '^[A-Za-z][A-Za-z0-9.\-]{0,9}$'
  group by upper(symbol) order by 2 desc, 3 desc, 1 limit 3;
$$;
revoke all on function public.top3_bought() from public;
grant execute on function public.top3_bought() to authenticated;

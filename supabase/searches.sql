-- Simple Street: "Most searched" page under Discover. Paste into Supabase's SQL Editor and press Run, once.
-- Safe to run again.
--
-- Counts how many times each stock is looked up per day (Chicago time). Only the ticker and a count are saved,
-- never who looked it up. Each browser counts a stock at most once a day (assets/discover.js).
create table if not exists public.stock_searches (
  day date not null,
  symbol text not null,
  n integer not null default 0,
  primary key (day, symbol)
);
alter table public.stock_searches enable row level security;
-- No policies: the table is only read and written through the two functions below.

create or replace function public.log_search(sym text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  sym := upper(coalesce(sym, ''));
  if sym !~ '^[A-Z][A-Z0-9.\-]{0,9}$' then return; end if;
  insert into public.stock_searches (day, symbol, n)
  values ((now() at time zone 'America/Chicago')::date, sym, 1)
  on conflict (day, symbol) do update set n = public.stock_searches.n + 1;
end;
$$;

-- The 10 most looked-up stocks over the last 7 days.
create or replace function public.most_searched() returns table (symbol text, searches integer)
language sql stable security definer set search_path = '' as $$
  select s.symbol, sum(s.n)::int from public.stock_searches s
  where s.day > (now() at time zone 'America/Chicago')::date - 7
  group by s.symbol order by 2 desc, 1 limit 10;
$$;

revoke all on function public.log_search(text) from public;
revoke all on function public.most_searched() from public;
grant execute on function public.log_search(text) to anon, authenticated;
grant execute on function public.most_searched() to anon, authenticated;

-- Clear out counts older than 30 days (run this file again any time to tidy up).
delete from public.stock_searches where day < (now() at time zone 'America/Chicago')::date - 30;

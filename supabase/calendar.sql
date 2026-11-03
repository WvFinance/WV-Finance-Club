-- Upcoming calendar on the News tab: earnings days for the stocks in each member's Paper Trading account.
-- Paste all of this into Supabase's SQL Editor and press Run, once (after paper-trading.sql).
-- It uses the same free Finnhub key that Paper Trading already uses (saved in Supabase's Vault).
-- Each stock's dates are saved for 12 hours, so Finnhub is asked at most twice a day per stock.

create table if not exists public.calendar_cache (
  symbol text primary key,
  rows jsonb not null default '[]',
  fetched_at timestamptz not null default now()
);
alter table public.calendar_cache enable row level security;
revoke all on public.calendar_cache from anon, authenticated;

-- Returns the earnings days in the next 90 days for the stocks the logged-in member owns in Paper Trading:
-- [{"symbol":"AAPL","date":"2027-01-28","hour":"amc"}, ...]  (hour: bmo = before the market opens, amc = after it closes)
create or replace function public.my_calendar() returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  key text;
  s text;
  c public.calendar_cache;
  res record;
  got jsonb;
  out jsonb := '[]';
begin
  if auth.uid() is null then return out; end if;
  select decrypted_secret into key from vault.decrypted_secrets where name = 'finnhub_key' limit 1;
  for s in select distinct symbol from public.paper_positions where user_id = auth.uid() and symbol ~ '^[A-Z.\-]{1,10}$' limit 40 loop
    select * into c from public.calendar_cache where symbol = s;
    if (c.symbol is null or c.fetched_at < now() - interval '12 hours') and key is not null then
      begin
        select * into res from extensions.http_get('https://finnhub.io/api/v1/calendar/earnings?from=' || current_date
          || '&to=' || (current_date + 90) || '&symbol=' || s || '&token=' || key);
        if res.status = 200 then
          select coalesce(jsonb_agg(jsonb_build_object('symbol', s, 'date', e->>'date', 'hour', coalesce(e->>'hour', ''))), '[]')
            into got from jsonb_array_elements(coalesce(res.content::jsonb->'earningsCalendar', '[]')) e;
          insert into public.calendar_cache (symbol, rows, fetched_at) values (s, got, now())
          on conflict (symbol) do update set rows = excluded.rows, fetched_at = excluded.fetched_at;
          c.rows := got;
        end if;
      exception when others then null;  -- Finnhub busy: use what we saved last time
      end;
    end if;
    out := out || coalesce(c.rows, '[]');
  end loop;
  return out;
end $$;

revoke all on function public.my_calendar() from public, anon;
grant execute on function public.my_calendar() to authenticated;

-- Search page "The numbers" box: P/E, dividend, company size, 52-week range, next earnings day and more.
-- Paste all of this into Supabase's SQL Editor and press Run, once (after paper-trading.sql).
-- It uses the same free Finnhub key that Paper Trading already uses (saved in Supabase's Vault).
-- Each stock's numbers are saved for 12 hours, so Finnhub is asked at most twice a day per stock.

create table if not exists public.stock_numbers_cache (
  symbol text primary key,
  numbers jsonb not null default '{}',
  fetched_at timestamptz not null default now()
);
alter table public.stock_numbers_cache enable row level security;
revoke all on public.stock_numbers_cache from anon, authenticated;

-- Returns one stock's numbers, for example:
-- {"symbol":"AAPL","pe":34.1,"eps":6.4,"divYield":0.45,"divPerShare":1.04,"marketCap":3400000,"high52":260.1,"low52":169.2,
--  "beta":1.2,"margin":24.3,"revGrowth":6.1,"earnDate":"2027-01-28","earnHour":"amc","at":"..."}
-- marketCap is in millions of dollars. divYield, margin and revGrowth are percents.
create or replace function public.stock_numbers(sym text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  s text := public.paper_clean_symbol(sym);
  key text;
  c public.stock_numbers_cache;
  res record;
  m jsonb := '{}';
  e jsonb;
  got jsonb;
begin
  if auth.uid() is null then raise exception 'Log in first.'; end if;
  select * into c from public.stock_numbers_cache where symbol = s;
  if c.symbol is not null and c.fetched_at > now() - interval '12 hours' then return c.numbers; end if;
  select decrypted_secret into key from vault.decrypted_secrets where name = 'finnhub_key' limit 1;
  if key is null then return coalesce(c.numbers, jsonb_build_object('symbol', s)); end if;
  begin
    select * into res from extensions.http_get('https://finnhub.io/api/v1/stock/metric?metric=all&symbol=' || s || '&token=' || key);
    if res.status <> 200 then return coalesce(c.numbers, jsonb_build_object('symbol', s)); end if;
    m := jsonb_strip_nulls(coalesce(res.content::jsonb->'metric', '{}'));
    select * into res from extensions.http_get('https://finnhub.io/api/v1/calendar/earnings?from=' || current_date
      || '&to=' || (current_date + 120) || '&symbol=' || s || '&token=' || key);
    if res.status = 200 then
      select x into e from jsonb_array_elements(coalesce(res.content::jsonb->'earningsCalendar', '[]')) x
        where (x->>'date')::date >= current_date order by (x->>'date')::date limit 1;
    end if;
  exception when others then
    return coalesce(c.numbers, jsonb_build_object('symbol', s));  -- Finnhub busy: use what we saved last time
  end;
  got := jsonb_strip_nulls(jsonb_build_object(
    'symbol', s,
    'pe', coalesce(m->'peTTM', m->'peBasicExclExtraTTM', m->'peNormalizedAnnual'),
    'eps', coalesce(m->'epsTTM', m->'epsBasicExclExtraItemsTTM'),
    'divYield', coalesce(m->'currentDividendYieldTTM', m->'dividendYieldIndicatedAnnual'),
    'divPerShare', coalesce(m->'dividendPerShareTTM', m->'dividendPerShareAnnual'),
    'marketCap', m->'marketCapitalization',
    'high52', m->'52WeekHigh',
    'low52', m->'52WeekLow',
    'beta', m->'beta',
    'margin', coalesce(m->'netProfitMarginTTM', m->'netProfitMarginAnnual'),
    'revGrowth', coalesce(m->'revenueGrowthTTMYoy', m->'revenueGrowthQuarterlyYoy'),
    'earnDate', e->'date',
    'earnHour', nullif(e->>'hour', ''),
    'at', now()));
  insert into public.stock_numbers_cache (symbol, numbers, fetched_at) values (s, got, now())
  on conflict (symbol) do update set numbers = excluded.numbers, fetched_at = excluded.fetched_at;
  return got;
end $$;

revoke all on function public.stock_numbers(text) from public, anon;
grant execute on function public.stock_numbers(text) to authenticated;

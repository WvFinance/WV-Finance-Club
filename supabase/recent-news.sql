-- Headlines from only the last 30 days, in place of TradingView's news box (which can show years-old stories).
-- Paste all of this into Supabase's SQL Editor and press Run, once (after paper-trading.sql).
-- It uses the same free Finnhub key that Paper Trading already uses (saved in Supabase's Vault).
-- Each list is saved for 15 minutes, so Finnhub isn't asked too often.

create table if not exists public.news_cache (
  key text primary key,
  items jsonb not null default '[]',
  fetched_at timestamptz not null default now()
);
alter table public.news_cache enable row level security;
revoke all on public.news_cache from anon, authenticated;

-- recent_news('AAPL') = news about Apple; recent_news('MARKET') = general market news; recent_news('CRYPTO') = crypto news.
-- Returns up to 30 stories, newest first, none older than 30 days:
-- [{"headline":"...","source":"Reuters","url":"https://...","time":1762790000}, ...]
create or replace function public.recent_news(sym text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  s text := upper(trim(coalesce(sym, '')));
  api_key text;
  url text;
  c public.news_cache;
  res record;
  got jsonb;
  cutoff bigint := extract(epoch from now() - interval '30 days')::bigint;
begin
  if auth.uid() is null then return '[]'; end if;
  if s = '' then s := 'MARKET'; end if;
  if s !~ '^[A-Z][A-Z0-9.\-]{0,9}$' then return '[]'; end if;
  select * into c from public.news_cache where news_cache.key = s;
  if c.key is null or c.fetched_at < now() - interval '15 minutes' then
    select decrypted_secret into api_key from vault.decrypted_secrets where name = 'finnhub_key' limit 1;
    if api_key is not null then
      url := case s
        when 'MARKET' then 'https://finnhub.io/api/v1/news?category=general'
        when 'CRYPTO' then 'https://finnhub.io/api/v1/news?category=crypto'
        else 'https://finnhub.io/api/v1/company-news?symbol=' || s || '&from=' || (current_date - 30) || '&to=' || current_date end;
      begin
        select * into res from extensions.http_get(url || '&token=' || api_key);
        if res.status = 200 then
          select coalesce(jsonb_agg(x order by (x->>'time')::bigint desc), '[]') into got from (
            select jsonb_build_object('headline', e->>'headline', 'source', e->>'source', 'url', e->>'url', 'time', (e->>'datetime')::bigint) x
            from jsonb_array_elements(coalesce(res.content::jsonb, '[]')) e
            where coalesce(e->>'headline', '') <> '' and coalesce(e->>'url', '') ~ '^https?://'
            order by (e->>'datetime')::bigint desc limit 30) t;
          insert into public.news_cache (key, items, fetched_at) values (s, got, now())
          on conflict (key) do update set items = excluded.items, fetched_at = excluded.fetched_at;
          c.items := got;
        end if;
      exception when others then null;  -- Finnhub busy: use what we saved last time
      end;
    end if;
  end if;
  -- Even saved lists drop anything that has turned older than 30 days.
  return coalesce((select jsonb_agg(x) from jsonb_array_elements(coalesce(c.items, '[]')) x where (x->>'time')::bigint >= cutoff), '[]');
end $$;

revoke all on function public.recent_news(text) from public, anon;
grant execute on function public.recent_news(text) to authenticated;

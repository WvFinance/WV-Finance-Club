-- Paper trading game. Paste all of this into Supabase's SQL Editor and press Run, once (after setup.sql).
-- Every member starts with $50,000 of pretend money. Trades use the real price, which the database
-- looks up itself from Finnhub, so nobody can send in a fake price. Members can only read their own
-- account; the leaderboard shows names and results only.
--
-- Before running: put your free Finnhub key (finnhub.io/register) between the quotes on the next line.
-- It's saved in Supabase's Vault, not in the website, so nobody else can see it.
do $$
declare
  k text := 'PASTE_YOUR_FINNHUB_KEY_HERE';
  sid uuid;
begin
  if k like 'PASTE%' then raise exception 'Put your Finnhub key between the quotes near the top of this file first.'; end if;
  select id into sid from vault.secrets where name = 'finnhub_key';
  if sid is null then perform vault.create_secret(k, 'finnhub_key'); else perform vault.update_secret(sid, k); end if;
end $$;

create extension if not exists http with schema extensions;
create extension if not exists pg_cron;

create table if not exists public.paper_accounts (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  name text not null,
  cash numeric not null default 50000,
  started_at timestamptz not null default now()
);

create table if not exists public.paper_positions (
  user_id uuid not null references auth.users on delete cascade,
  symbol text not null,
  shares numeric not null,
  cost numeric not null,
  primary key (user_id, symbol)
);

create table if not exists public.paper_trades (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users on delete cascade,
  symbol text not null,
  side text not null check (side in ('buy', 'sell')),
  shares numeric not null,
  price numeric not null,
  total numeric not null,
  at timestamptz not null default now()
);
create index if not exists paper_trades_user on public.paper_trades (user_id, at desc);

create table if not exists public.paper_prices (
  symbol text primary key,
  price numeric not null,
  prev_close numeric,
  at timestamptz not null default now()
);

alter table public.paper_accounts enable row level security;
alter table public.paper_positions enable row level security;
alter table public.paper_trades enable row level security;
alter table public.paper_prices enable row level security;

-- Members read their own rows. Nobody writes to these tables directly: trades go through paper_trade().
drop policy if exists "Members see their own game account" on public.paper_accounts;
create policy "Members see their own game account" on public.paper_accounts for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Members see their own game stocks" on public.paper_positions;
create policy "Members see their own game stocks" on public.paper_positions for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Members see their own trades" on public.paper_trades;
create policy "Members see their own trades" on public.paper_trades for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Members see prices" on public.paper_prices;
create policy "Members see prices" on public.paper_prices for select to authenticated using (true);

revoke all on public.paper_accounts, public.paper_positions, public.paper_trades, public.paper_prices from anon, authenticated;
grant select on public.paper_accounts, public.paper_positions, public.paper_trades, public.paper_prices to authenticated;

-- Looks up a price from Finnhub and saves it. Only the other functions here can call it.
create or replace function public.paper_fetch(sym text) returns public.paper_prices
language plpgsql security definer set search_path = public, extensions as $$
declare
  key text;
  res record;
  q jsonb;
  row public.paper_prices;
begin
  select decrypted_secret into key from vault.decrypted_secrets where name = 'finnhub_key' limit 1;
  if key is null or key = 'PASTE_YOUR_FINNHUB_KEY_HERE' then raise exception 'Prices aren''t set up yet (no Finnhub key).'; end if;
  select * into res from extensions.http_get('https://finnhub.io/api/v1/quote?symbol=' || sym || '&token=' || key);
  if res.status <> 200 then raise exception 'Couldn''t get a price right now. Try again in a minute.'; end if;
  q := res.content::jsonb;
  if coalesce((q->>'c')::numeric, 0) <= 0 then raise exception 'We couldn''t find a price for %. Check the ticker.', sym; end if;
  insert into public.paper_prices (symbol, price, prev_close, at) values (sym, (q->>'c')::numeric, nullif((q->>'pc')::numeric, 0), now())
  on conflict (symbol) do update set price = excluded.price, prev_close = excluded.prev_close, at = excluded.at
  returning * into row;
  return row;
end $$;

create or replace function public.paper_clean_symbol(sym text) returns text
language plpgsql immutable as $$
declare s text := upper(trim(coalesce(sym, '')));
begin
  if s !~ '^[A-Z][A-Z0-9.\-]{0,9}$' then raise exception 'That doesn''t look like a ticker. Try something like NVDA.'; end if;
  return s;
end $$;

-- The price of a stock, at most a minute old.
create or replace function public.paper_quote(sym text) returns public.paper_prices
language plpgsql security definer set search_path = public as $$
declare s text := public.paper_clean_symbol(sym); row public.paper_prices;
begin
  if auth.uid() is null then raise exception 'Log in first.'; end if;
  select * into row from public.paper_prices where symbol = s and at > now() - interval '1 minute';
  if found then return row; end if;
  return public.paper_fetch(s);
end $$;

-- Is the US stock market open? Weekdays 8:30am to 3pm Chicago time (market holidays aren't counted).
create or replace function public.paper_market_open() returns boolean
language sql stable as $$
  select extract(isodow from now() at time zone 'America/Chicago') between 1 and 5
     and (now() at time zone 'America/Chicago')::time between time '08:30' and time '15:00';
$$;

-- Join the game (or change the name shown on the leaderboard).
create or replace function public.paper_join(display_name text) returns public.paper_accounts
language plpgsql security definer set search_path = public as $$
declare n text := left(trim(coalesce(display_name, '')), 30); row public.paper_accounts;
begin
  if auth.uid() is null then raise exception 'Log in first.'; end if;
  if n = '' then raise exception 'Pick a name for the leaderboard.'; end if;
  insert into public.paper_accounts (user_id, name) values (auth.uid(), n)
  on conflict (user_id) do update set name = excluded.name
  returning * into row;
  return row;
end $$;

-- Buy or sell at the real price right now. Whole shares only.
create or replace function public.paper_trade(sym text, side text, qty numeric) returns public.paper_trades
language plpgsql security definer set search_path = public as $$
declare
  s text := public.paper_clean_symbol(sym);
  acct public.paper_accounts;
  pos public.paper_positions;
  px numeric;
  total numeric;
  t public.paper_trades;
begin
  if auth.uid() is null then raise exception 'Log in first.'; end if;
  if side not in ('buy', 'sell') then raise exception 'Pick Buy or Sell.'; end if;
  if qty is null or qty <= 0 or qty <> trunc(qty) then raise exception 'Enter a whole number of shares, like 5.'; end if;
  if not public.paper_market_open() then raise exception 'The market is closed. Trades go through on weekdays from 8:30am to 3pm Chicago time.'; end if;
  select * into acct from public.paper_accounts where user_id = auth.uid() for update;
  if not found then raise exception 'Join the game first.'; end if;
  -- Always a fresh price (at most 15 seconds old) for a trade.
  select price into px from public.paper_prices where symbol = s and at > now() - interval '15 seconds';
  if px is null then px := (public.paper_fetch(s)).price; end if;
  total := round(qty * px, 2);
  select * into pos from public.paper_positions where user_id = acct.user_id and symbol = s for update;
  if side = 'buy' then
    if total > acct.cash then raise exception 'Not enough cash. % shares cost $%, and you have $%.', qty, to_char(total, 'FM999,999,990.00'), to_char(acct.cash, 'FM999,999,990.00'); end if;
    update public.paper_accounts set cash = cash - total where user_id = acct.user_id;
    insert into public.paper_positions (user_id, symbol, shares, cost) values (acct.user_id, s, qty, total)
    on conflict (user_id, symbol) do update set shares = paper_positions.shares + excluded.shares, cost = paper_positions.cost + excluded.cost;
  else
    if pos.shares is null or pos.shares < qty then raise exception 'You only have % shares of %.', coalesce(pos.shares, 0), s; end if;
    update public.paper_accounts set cash = cash + total where user_id = acct.user_id;
    if pos.shares = qty then delete from public.paper_positions where user_id = acct.user_id and symbol = s;
    else update public.paper_positions set shares = shares - qty, cost = round(cost * (shares - qty) / shares, 2) where user_id = acct.user_id and symbol = s;
    end if;
  end if;
  insert into public.paper_trades (user_id, symbol, side, shares, price, total) values (acct.user_id, s, side, qty, px, total) returning * into t;
  return t;
end $$;

-- Leaderboard: everyone's account value from the latest saved prices, best % first.
create or replace function public.paper_board()
returns table (rank bigint, name text, value numeric, gain_pct numeric, me boolean)
language sql stable security definer set search_path = public as $$
  with v as (
    select a.user_id, a.name,
      a.cash + coalesce((select sum(p.shares * coalesce(pr.price, p.cost / p.shares))
                         from public.paper_positions p left join public.paper_prices pr on pr.symbol = p.symbol
                         where p.user_id = a.user_id), 0) as value
    from public.paper_accounts a
  )
  select rank() over (order by value desc), name, round(value, 2), round(value / 50000 - 1, 4), user_id = auth.uid()
  from v order by value desc limit 100;
$$;

-- Keeps the saved prices of every stock someone owns fresh, every 10 minutes while the market is open.
create or replace function public.paper_refresh_prices() returns integer
language plpgsql security definer set search_path = public as $$
declare s text; n integer := 0;
begin
  if not public.paper_market_open() then return 0; end if;
  for s in select distinct p.symbol from public.paper_positions p left join public.paper_prices pr on pr.symbol = p.symbol
           where pr.at is null or pr.at < now() - interval '5 minutes' limit 50 loop
    begin perform public.paper_fetch(s); n := n + 1;
    exception when others then null; end;
  end loop;
  return n;
end $$;

revoke all on function public.paper_fetch(text), public.paper_refresh_prices(), public.paper_quote(text), public.paper_join(text),
  public.paper_trade(text, text, numeric), public.paper_board(), public.paper_market_open(), public.paper_clean_symbol(text) from public, anon;
grant execute on function public.paper_quote(text), public.paper_join(text), public.paper_trade(text, text, numeric),
  public.paper_board(), public.paper_market_open() to authenticated;
revoke all on function public.paper_fetch(text), public.paper_refresh_prices() from authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'paper-prices';
select cron.schedule('paper-prices', '*/10 13-21 * * 1-5', 'select public.paper_refresh_prices()');

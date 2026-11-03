-- Teachers buy and sell stocks for their school's Class Portfolio.
-- Paste all of this into Supabase's SQL Editor and press Run, once (after teachers.sql). Safe to run again.
--
-- How it works:
--   * A teacher (or the admin) buys a stock for the Class Portfolio from the Students tab. The database looks up the real
--     price itself, so nobody can type in a fake price. A teacher can only trade for their own school.
--   * Selling takes the stock out of the Class Portfolio at the real price right now. It's kept in a "Sold" list.
--   * The stocks already listed in the website files (data/portfolio.json and data/portfolios/) can be sold here too.
--   * Everyone who is logged in can see every school's Class Portfolio (the School leaderboard needs it). Only teachers
--     and the admin can change it.

create table if not exists public.class_picks (
  id bigint generated always as identity primary key,
  school_id text not null references public.schools,
  ticker text not null,
  symbol text,                         -- like NASDAQ:AAPL, for the charts
  name text,
  sector text,
  entry_date date not null,
  entry_price numeric not null check (entry_price > 0),
  invested numeric not null,
  shares numeric not null,
  spy_entry_price numeric,
  pitched_by text,
  thesis text,
  from_file boolean not null default false,  -- a stock from the website files that was sold here
  bought_by uuid references auth.users on delete set null,
  bought_at timestamptz not null default now(),
  sold_at timestamptz,
  sold_price numeric,
  sold_by uuid references auth.users on delete set null
);
create index if not exists class_picks_school on public.class_picks (school_id, bought_at desc);

alter table public.class_picks enable row level security;
drop policy if exists "Members see every Class Portfolio" on public.class_picks;
create policy "Members see every Class Portfolio" on public.class_picks for select to authenticated using (true);
revoke all on public.class_picks from anon, authenticated;
grant select (id, school_id, ticker, symbol, name, sector, entry_date, entry_price, invested, shares, spy_entry_price,
              pitched_by, thesis, from_file, bought_at, sold_at, sold_price) on public.class_picks to authenticated;

-- May the person asking change this school's Class Portfolio? Admin: any school. Teacher: their own school.
create or replace function public.class_can_trade(school text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles me where me.user_id = auth.uid()
                 and (me.role = 'admin' or (me.role = 'teacher' and me.school_id = school)));
$$;

-- Buy: spend `dollars` on a stock at the real price right now.
create or replace function public.class_buy(school text, sym text, dollars numeric, stock_name text default null,
  stock_symbol text default null, stock_sector text default null, pitched text default null, why text default null)
returns public.class_picks
language plpgsql security definer set search_path = public as $$
declare s text := public.paper_clean_symbol(sym); px numeric; spy numeric; row public.class_picks;
begin
  if not public.class_can_trade(school) then raise exception 'Only teachers can trade for the Class Portfolio.'; end if;
  if not exists (select 1 from public.schools where id = school) then raise exception 'That school isn''t on the list.'; end if;
  if dollars is null or dollars < 1 or dollars > 1000000 then raise exception 'Enter an amount between $1 and $1,000,000.'; end if;
  px := public.paper_price(s, interval '1 minute');
  begin spy := public.paper_price('SPY', interval '15 minutes'); exception when others then spy := null; end;
  insert into public.class_picks (school_id, ticker, symbol, name, sector, entry_date, entry_price, invested, shares, spy_entry_price, pitched_by, thesis, bought_by)
  values (school, s, nullif(left(trim(coalesce(stock_symbol, '')), 30), ''), nullif(left(trim(coalesce(stock_name, '')), 80), ''),
          nullif(left(trim(coalesce(stock_sector, '')), 40), ''), (now() at time zone 'America/Chicago')::date, px, round(dollars, 2),
          round(dollars / px, 4), spy, nullif(left(trim(coalesce(pitched, '')), 60), ''), nullif(left(trim(coalesce(why, '')), 400), ''), auth.uid())
  returning * into row;
  return row;
end $$;

-- Sell a stock bought here.
create or replace function public.class_sell(pick bigint) returns public.class_picks
language plpgsql security definer set search_path = public as $$
declare row public.class_picks;
begin
  select * into row from public.class_picks where id = pick for update;
  if row.id is null then raise exception 'That stock isn''t in the Class Portfolio.'; end if;
  if not public.class_can_trade(row.school_id) then raise exception 'Only teachers can trade for the Class Portfolio.'; end if;
  if row.sold_at is not null then raise exception 'That stock was already sold.'; end if;
  update public.class_picks set sold_at = now(), sold_price = public.paper_price(row.ticker, interval '1 minute'), sold_by = auth.uid()
  where id = pick returning * into row;
  return row;
end $$;

-- Sell a stock that's listed in the website files. It's saved here as sold, and the website stops showing it.
create or replace function public.class_sell_file(school text, sym text, bought date, paid numeric, amount numeric, qty numeric,
  stock_name text default null, stock_sector text default null) returns public.class_picks
language plpgsql security definer set search_path = public as $$
declare s text := public.paper_clean_symbol(sym); row public.class_picks;
begin
  if not public.class_can_trade(school) then raise exception 'Only teachers can trade for the Class Portfolio.'; end if;
  if exists (select 1 from public.class_picks where school_id = school and ticker = s and entry_date = bought and from_file) then
    raise exception 'That stock was already sold.';
  end if;
  if paid is null or paid <= 0 then raise exception 'That stock has no price it was bought at.'; end if;
  insert into public.class_picks (school_id, ticker, name, sector, entry_date, entry_price, invested, shares, from_file, sold_at, sold_price, sold_by)
  values (school, s, left(stock_name, 80), left(stock_sector, 40), bought, paid, coalesce(amount, qty * paid), coalesce(qty, amount / paid), true,
          now(), public.paper_price(s, interval '1 minute'), auth.uid())
  returning * into row;
  return row;
end $$;

-- The newest price the database has for each Class Portfolio stock (for stocks the daily price file doesn't have yet).
create or replace function public.class_prices() returns table (symbol text, price numeric, at timestamptz)
language sql stable security definer set search_path = public as $$
  select pr.symbol, pr.price, pr.at from public.paper_prices pr
  where pr.symbol in (select ticker from public.class_picks where sold_at is null);
$$;

-- Tickers and first buy dates only, so the daily price robot (scripts/update_prices.py) knows what to download.
create or replace function public.class_tickers() returns table (ticker text, first_date date)
language sql stable security definer set search_path = public as $$
  select ticker, min(entry_date) from public.class_picks where not from_file group by ticker;
$$;

revoke all on function public.class_can_trade(text), public.class_buy(text, text, numeric, text, text, text, text, text),
  public.class_sell(bigint), public.class_sell_file(text, text, date, numeric, numeric, numeric, text, text),
  public.class_prices(), public.class_tickers() from public, anon, authenticated;
grant execute on function public.class_buy(text, text, numeric, text, text, text, text, text), public.class_sell(bigint),
  public.class_sell_file(text, text, date, numeric, numeric, numeric, text, text), public.class_prices(), public.class_tickers() to authenticated;
grant execute on function public.class_tickers() to anon;

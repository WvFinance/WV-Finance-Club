-- More order types for the trading game: limit, stop loss, stop-limit, trailing stop, and short selling.
-- Paste all of this into Supabase's SQL Editor and press Run, once (after paper-trading.sql).
-- It's safe to run again. It doesn't need the Finnhub key: that's already saved in the Vault.
--
-- How it works:
--   * Market orders go through right away, like before (paper_trade).
--   * Every other order waits in paper_orders. Every 2 minutes while the market is open, the database
--     gets fresh prices and fills each waiting order whose price has been reached (paper_tick).
--   * Shorting means selling shares you borrowed, hoping to buy them back cheaper. Its value counts
--     as negative shares, so a short loses money when the price goes up.
--   Safety rules for shorts: all your shorts together can be worth at most half your account, and a
--   short is bought back automatically if the price doubles from where you shorted it.

-- Trades can now be shorts and buy-to-covers, and remember which kind of order made them.
alter table public.paper_trades drop constraint if exists paper_trades_side_check;
alter table public.paper_trades add constraint paper_trades_side_check check (side in ('buy', 'sell', 'short', 'cover'));
alter table public.paper_trades add column if not exists how text not null default 'market';

-- Waiting orders.
create table if not exists public.paper_orders (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users on delete cascade,
  symbol text not null,
  side text not null check (side in ('buy', 'sell', 'short', 'cover')),
  kind text not null check (kind in ('limit', 'stop', 'stop_limit', 'trailing_stop')),
  shares numeric not null check (shares > 0),
  limit_price numeric,
  stop_price numeric,
  trail_pct numeric,
  mark numeric,                               -- trailing stop: the best price seen since the order was placed
  triggered boolean not null default false,   -- stop-limit: the stop price has been reached
  status text not null default 'open' check (status in ('open', 'filled', 'canceled', 'failed')),
  note text,                                  -- why an order failed
  trade_id bigint references public.paper_trades,
  created_at timestamptz not null default now(),
  done_at timestamptz
);
create index if not exists paper_orders_user on public.paper_orders (user_id, created_at desc);
create index if not exists paper_orders_open on public.paper_orders (symbol) where status = 'open';

alter table public.paper_orders enable row level security;
drop policy if exists "Members see their own orders" on public.paper_orders;
create policy "Members see their own orders" on public.paper_orders for select to authenticated using ((select auth.uid()) = user_id);
revoke all on public.paper_orders from anon, authenticated;
grant select on public.paper_orders to authenticated;

-- Makes one trade for a member at a given price. Only the other functions here can call it.
create or replace function public.paper_execute(uid uuid, s text, side text, qty numeric, px numeric, how text default 'market')
returns public.paper_trades
language plpgsql security definer set search_path = public as $$
declare
  acct public.paper_accounts;
  pos public.paper_positions;
  have numeric;
  total numeric := round(qty * px, 2);
  shorts numeric;
  worth numeric;
  t public.paper_trades;
begin
  select * into acct from public.paper_accounts where user_id = uid for update;
  if not found then raise exception 'Join the game first.'; end if;
  select * into pos from public.paper_positions where user_id = uid and symbol = s for update;
  have := coalesce(pos.shares, 0);

  if side = 'buy' then
    if have < 0 then raise exception 'You''re shorting %. Use Buy to cover to close that bet first.', s; end if;
    if total > acct.cash then raise exception 'Not enough cash. % shares cost $%, and you have $%.', qty, to_char(total, 'FM999,999,990.00'), to_char(acct.cash, 'FM999,999,990.00'); end if;
    update public.paper_accounts set cash = cash - total where user_id = uid;
    insert into public.paper_positions (user_id, symbol, shares, cost) values (uid, s, qty, total)
    on conflict (user_id, symbol) do update set shares = paper_positions.shares + excluded.shares, cost = paper_positions.cost + excluded.cost;

  elsif side = 'sell' then
    if have < qty then raise exception 'You only have % shares of %.', greatest(have, 0), s; end if;
    update public.paper_accounts set cash = cash + total where user_id = uid;
    if have = qty then delete from public.paper_positions where user_id = uid and symbol = s;
    else update public.paper_positions set shares = shares - qty, cost = round(cost * (shares - qty) / shares, 2) where user_id = uid and symbol = s;
    end if;

  elsif side = 'short' then
    if have > 0 then raise exception 'You own % shares of %. Sell them before you short it.', have, s; end if;
    -- Safety rule: all your shorts together can be worth at most half your account.
    select coalesce(sum(case when p.symbol = s then 0 else -p.shares * coalesce(pr.price, p.cost / p.shares) end), 0),
           acct.cash + coalesce(sum(p.shares * case when p.symbol = s then px else coalesce(pr.price, p.cost / p.shares) end), 0)
      into shorts, worth
      from public.paper_positions p left join public.paper_prices pr on pr.symbol = p.symbol
     where p.user_id = uid;
    shorts := shorts + (qty - have) * px;
    if shorts > worth / 2 then
      raise exception 'That short is too big. All your shorts together can be worth at most half your account ($%).', to_char(greatest(worth / 2, 0), 'FM999,999,990.00');
    end if;
    update public.paper_accounts set cash = cash + total where user_id = uid;
    insert into public.paper_positions (user_id, symbol, shares, cost) values (uid, s, -qty, -total)
    on conflict (user_id, symbol) do update set shares = paper_positions.shares + excluded.shares, cost = paper_positions.cost + excluded.cost;

  elsif side = 'cover' then
    if -have < qty then raise exception 'You''re only shorting % shares of %.', greatest(-have, 0), s; end if;
    -- Buying back always goes through, even if it takes more cash than you have, so a losing bet can be closed.
    update public.paper_accounts set cash = cash - total where user_id = uid;
    if -have = qty then delete from public.paper_positions where user_id = uid and symbol = s;
    else update public.paper_positions set shares = shares + qty, cost = round(cost * (shares + qty) / shares, 2) where user_id = uid and symbol = s;
    end if;

  else
    raise exception 'Pick Buy, Sell, Short or Buy to cover.';
  end if;

  insert into public.paper_trades (user_id, symbol, side, shares, price, total, how)
  values (uid, s, side, qty, px, total, how) returning * into t;
  return t;
end $$;

-- A price at most `fresh` old, looked up again if needed.
create or replace function public.paper_price(s text, fresh interval) returns numeric
language plpgsql security definer set search_path = public as $$
declare px numeric;
begin
  select price into px from public.paper_prices where symbol = s and at > now() - fresh;
  if px is null then px := (public.paper_fetch(s)).price; end if;
  return px;
end $$;

-- Market order: buy, sell, short or buy to cover at the real price right now. Whole shares only.
create or replace function public.paper_trade(sym text, side text, qty numeric) returns public.paper_trades
language plpgsql security definer set search_path = public as $$
declare s text := public.paper_clean_symbol(sym);
begin
  if auth.uid() is null then raise exception 'Log in first.'; end if;
  if side not in ('buy', 'sell', 'short', 'cover') then raise exception 'Pick Buy, Sell, Short or Buy to cover.'; end if;
  if qty is null or qty <= 0 or qty <> trunc(qty) then raise exception 'Enter a whole number of shares, like 5.'; end if;
  if not public.paper_market_open() then raise exception 'The market is closed. Market orders go through on weekdays from 8:30am to 3pm Chicago time. A limit or stop order can wait for the market to open.'; end if;
  perform 1 from public.paper_accounts where user_id = auth.uid();
  if not found then raise exception 'Join the game first.'; end if;
  return public.paper_execute(auth.uid(), s, side, qty, public.paper_price(s, interval '15 seconds'), 'market');
end $$;

-- Checks one waiting order against a price and fills it if the price has been reached.
create or replace function public.paper_check_order(oid bigint, px numeric) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  o public.paper_orders;
  buying boolean;
  hit boolean := false;
  t public.paper_trades;
begin
  select * into o from public.paper_orders where id = oid and status = 'open' for update;
  if not found or px is null or px <= 0 then return false; end if;
  buying := o.side in ('buy', 'cover');

  if o.kind = 'limit' then
    -- Buy at this price or lower; sell at this price or higher.
    hit := case when buying then px <= o.limit_price else px >= o.limit_price end;
  elsif o.kind = 'stop' then
    -- Once the price crosses the stop, trade at the market price.
    hit := case when buying then px >= o.stop_price else px <= o.stop_price end;
  elsif o.kind = 'stop_limit' then
    if not o.triggered and (case when buying then px >= o.stop_price else px <= o.stop_price end) then
      update public.paper_orders set triggered = true where id = oid;
      o.triggered := true;
    end if;
    hit := o.triggered and (case when buying then px <= o.limit_price else px >= o.limit_price end);
  elsif o.kind = 'trailing_stop' then
    -- Selling: follow the highest price and trade if it drops trail_pct below it.
    -- Buying: follow the lowest price and trade if it rises trail_pct above it.
    if buying then
      o.mark := least(coalesce(o.mark, px), px);
      hit := px >= o.mark * (1 + o.trail_pct / 100);
    else
      o.mark := greatest(coalesce(o.mark, px), px);
      hit := px <= o.mark * (1 - o.trail_pct / 100);
    end if;
    update public.paper_orders set mark = o.mark where id = oid;
  end if;

  if not hit then return false; end if;
  begin
    t := public.paper_execute(o.user_id, o.symbol, o.side, o.shares, px, o.kind);
    update public.paper_orders set status = 'filled', done_at = now(), trade_id = t.id, note = null where id = oid;
  exception when others then
    update public.paper_orders set status = 'failed', done_at = now(), note = sqlerrm where id = oid;
  end;
  return true;
end $$;

-- Place a waiting order. kind: limit, stop, stop_limit or trailing_stop. Prices in dollars, trail_pct like 10 for 10%.
create or replace function public.paper_place_order(sym text, side text, qty numeric, kind text,
  limit_price numeric default null, stop_price numeric default null, trail_pct numeric default null)
returns public.paper_orders
language plpgsql security definer set search_path = public as $$
declare
  s text := public.paper_clean_symbol(sym);
  uid uuid := auth.uid();
  have numeric;
  px numeric;
  row public.paper_orders;
begin
  if uid is null then raise exception 'Log in first.'; end if;
  perform 1 from public.paper_accounts where user_id = uid;
  if not found then raise exception 'Join the game first.'; end if;
  if side not in ('buy', 'sell', 'short', 'cover') then raise exception 'Pick Buy, Sell, Short or Buy to cover.'; end if;
  if kind not in ('limit', 'stop', 'stop_limit', 'trailing_stop') then raise exception 'Pick an order type.'; end if;
  if qty is null or qty <= 0 or qty <> trunc(qty) then raise exception 'Enter a whole number of shares, like 5.'; end if;
  if kind in ('limit', 'stop_limit') and (limit_price is null or limit_price <= 0) then raise exception 'Enter a limit price.'; end if;
  if kind in ('stop', 'stop_limit') and (stop_price is null or stop_price <= 0) then raise exception 'Enter a stop price.'; end if;
  if kind = 'trailing_stop' and (trail_pct is null or trail_pct < 1 or trail_pct > 50) then raise exception 'Enter a trailing percent between 1 and 50.'; end if;
  if (select count(*) from public.paper_orders o where o.user_id = uid and o.status = 'open') >= 20 then
    raise exception 'You can have up to 20 waiting orders. Cancel one first.';
  end if;

  select shares into have from public.paper_positions p where p.user_id = uid and p.symbol = s;
  have := coalesce(have, 0);
  if side = 'sell' and have < qty then raise exception 'You only have % shares of %.', greatest(have, 0), s; end if;
  if side = 'cover' and -have < qty then raise exception 'You''re only shorting % shares of %.', greatest(-have, 0), s; end if;
  if side = 'buy' and have < 0 then raise exception 'You''re shorting %. Use Buy to cover to close that bet first.', s; end if;
  if side = 'short' and have > 0 then raise exception 'You own % shares of %. Sell them before you short it.', have, s; end if;

  px := public.paper_price(s, interval '1 minute');   -- also checks that the ticker is real
  -- A stop waits for the price to move past it, so it has to be on the right side of today's price.
  if kind in ('stop', 'stop_limit') then
    if side in ('sell', 'short') and stop_price >= px then
      raise exception 'A stop to % has to be below the price now ($%). To sell at a higher price, use a limit order.', case when side = 'sell' then 'sell' else 'short' end, to_char(px, 'FM999,999,990.00');
    elsif side in ('buy', 'cover') and stop_price <= px then
      raise exception 'A stop to buy has to be above the price now ($%). To buy at a lower price, use a limit order.', to_char(px, 'FM999,999,990.00');
    end if;
  end if;
  insert into public.paper_orders (user_id, symbol, side, kind, shares, limit_price, stop_price, trail_pct, mark)
  values (uid, s, side, kind, qty,
          case when kind in ('limit', 'stop_limit') then round(limit_price, 2) end,
          case when kind in ('stop', 'stop_limit') then round(stop_price, 2) end,
          case when kind = 'trailing_stop' then trail_pct end,
          case when kind = 'trailing_stop' then px end)
  returning * into row;

  -- If the market is open and the price is already there, it fills right away, like a real broker.
  if public.paper_market_open() then
    perform public.paper_check_order(row.id, public.paper_price(s, interval '15 seconds'));
    select * into row from public.paper_orders where id = row.id;
  end if;
  return row;
end $$;

create or replace function public.paper_cancel_order(oid bigint) returns public.paper_orders
language plpgsql security definer set search_path = public as $$
declare row public.paper_orders;
begin
  if auth.uid() is null then raise exception 'Log in first.'; end if;
  update public.paper_orders set status = 'canceled', done_at = now()
   where id = oid and user_id = auth.uid() and status = 'open' returning * into row;
  if not found then raise exception 'That order already went through or was canceled.'; end if;
  return row;
end $$;

-- Runs every 2 minutes while the market is open: fresh prices, fill waiting orders, and the short safety rule.
create or replace function public.paper_tick() returns integer
language plpgsql security definer set search_path = public as $$
declare
  s text;
  o record;
  p record;
  n integer := 0;
begin
  if not public.paper_market_open() then return 0; end if;

  -- Fresh prices: stocks with waiting orders first (at most a minute old), then stocks people own.
  for s in
    select symbol from (
      select o2.symbol, 0 as pri from public.paper_orders o2 where o2.status = 'open'
      union all
      select p2.symbol, 1 from public.paper_positions p2
    ) x left join public.paper_prices pr using (symbol)
    where pr.at is null or pr.at < now() - case when x.pri = 0 then interval '1 minute' else interval '5 minutes' end
    group by symbol order by min(pri) limit 50
  loop
    begin perform public.paper_fetch(s);
    exception when others then null; end;
  end loop;

  -- Waiting orders, oldest first.
  for o in
    select o2.id, pr.price from public.paper_orders o2 join public.paper_prices pr on pr.symbol = o2.symbol
    where o2.status = 'open' and pr.at > now() - interval '5 minutes' order by o2.id
  loop
    if public.paper_check_order(o.id, o.price) then n := n + 1; end if;
  end loop;

  -- Safety rule: buy back any short whose price has doubled (the bet has lost as much as it brought in).
  for p in
    select p2.user_id, p2.symbol, -p2.shares as qty, pr.price from public.paper_positions p2 join public.paper_prices pr on pr.symbol = p2.symbol
    where p2.shares < 0 and pr.at > now() - interval '5 minutes' and pr.price * -p2.shares >= 2 * -p2.cost
  loop
    begin
      perform public.paper_execute(p.user_id, p.symbol, 'cover', p.qty, p.price, 'auto');
      update public.paper_orders set status = 'canceled', done_at = now(), note = 'The short was bought back automatically.'
       where user_id = p.user_id and symbol = p.symbol and side = 'cover' and status = 'open';
      n := n + 1;
    exception when others then null; end;
  end loop;
  return n;
end $$;

revoke all on function public.paper_execute(uuid, text, text, numeric, numeric, text), public.paper_price(text, interval),
  public.paper_check_order(bigint, numeric), public.paper_tick(), public.paper_trade(text, text, numeric),
  public.paper_place_order(text, text, numeric, text, numeric, numeric, numeric), public.paper_cancel_order(bigint) from public, anon, authenticated;
grant execute on function public.paper_trade(text, text, numeric),
  public.paper_place_order(text, text, numeric, text, numeric, numeric, numeric), public.paper_cancel_order(bigint) to authenticated;

-- One job does it all now, every 2 minutes during market hours (Finnhub's free plan allows 60 lookups a minute).
select cron.unschedule(jobid) from cron.job where jobname in ('paper-prices', 'paper-tick');
select cron.schedule('paper-tick', '*/2 13-21 * * 1-5', 'select public.paper_tick()');

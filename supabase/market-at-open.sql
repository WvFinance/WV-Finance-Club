-- Market orders placed while the market is closed now wait and go through when the market opens.
-- Paste all of this into Supabase's SQL Editor and press Run, once (after paper-orders.sql and feed.sql).
-- It's safe to run again.
--
-- How it works:
--   * When the market is closed, a market order is saved as a waiting order (kind 'market').
--   * The next time the market opens (8:30am Chicago time), the every-2-minutes job (paper_tick) fills it
--     at the first fresh price after the opening bell, usually by 8:32am.
--   * If it can't go through then (for example, not enough cash because the price jumped overnight),
--     it shows as "Didn't go through" with the reason, like other waiting orders.
--   * Stock market holidays now count as closed too, so orders don't fill at an old price on a holiday.

-- Waiting orders can now be market orders, and can carry a "why" for the Feed.
alter table public.paper_orders drop constraint if exists paper_orders_kind_check;
alter table public.paper_orders add constraint paper_orders_kind_check check (kind in ('market', 'limit', 'stop', 'stop_limit', 'trailing_stop'));
alter table public.paper_orders add column if not exists why text;

-- US stock market holidays (NYSE), when no trading happens. Add next years' dates here when they're announced.
create or replace function public.paper_holiday(d date) returns boolean
language sql immutable as $$
  select d = any (array[
    date '2026-11-26', date '2026-12-25',
    date '2027-01-01', date '2027-01-18', date '2027-02-15', date '2027-03-26', date '2027-05-31',
    date '2027-06-18', date '2027-07-05', date '2027-09-06', date '2027-11-25', date '2027-12-24',
    date '2028-01-17', date '2028-02-21', date '2028-04-14', date '2028-05-29', date '2028-06-19',
    date '2028-07-04', date '2028-09-04', date '2028-11-23', date '2028-12-25'
  ]);
$$;

-- Is the US stock market open? Weekdays 8:30am to 3pm Chicago time, not on market holidays.
create or replace function public.paper_market_open() returns boolean
language sql stable as $$
  select extract(isodow from now() at time zone 'America/Chicago') between 1 and 5
     and (now() at time zone 'America/Chicago')::time between time '08:30' and time '15:00'
     and not public.paper_holiday((now() at time zone 'America/Chicago')::date);
$$;

-- Market order while the market is closed: save it to go through when the market opens.
-- (If the market happens to be open, it goes through right away.)
create or replace function public.paper_queue_market(sym text, side text, qty numeric, why text default null)
returns public.paper_orders
language plpgsql security definer set search_path = public as $$
declare
  s text := public.paper_clean_symbol(sym);
  uid uuid := auth.uid();
  have numeric;
  px numeric;
  cash numeric;
  w text := nullif(left(trim(coalesce(why, '')), 140), '');
  row public.paper_orders;
begin
  if uid is null then raise exception 'Log in first.'; end if;
  select a.cash into cash from public.paper_accounts a where a.user_id = uid;
  if not found then raise exception 'Join the game first.'; end if;
  if side not in ('buy', 'sell', 'short', 'cover') then raise exception 'Pick Buy, Sell, Short or Buy to cover.'; end if;
  if qty is null or qty <= 0 or qty <> trunc(qty) then raise exception 'Enter a whole number of shares, like 5.'; end if;
  if (select count(*) from public.paper_orders o where o.user_id = uid and o.status = 'open') >= 20 then
    raise exception 'You can have up to 20 waiting orders. Cancel one first.';
  end if;

  select shares into have from public.paper_positions p where p.user_id = uid and p.symbol = s;
  have := coalesce(have, 0);
  if side = 'sell' and have < qty then raise exception 'You only have % shares of %.', greatest(have, 0), s; end if;
  if side = 'cover' and -have < qty then raise exception 'You''re only shorting % shares of %.', greatest(-have, 0), s; end if;
  if side = 'buy' and have < 0 then raise exception 'You''re shorting %. Use Buy to cover to close that bet first.', s; end if;
  if side = 'short' and have > 0 then raise exception 'You own % shares of %. Sell them before you short it.', have, s; end if;

  px := public.paper_price(s, interval '5 minutes');   -- also checks that the ticker is real
  if side = 'buy' and qty * px > cash then
    raise exception 'Not enough cash. % shares cost about $% at the last price, and you have $%.', qty, to_char(qty * px, 'FM999,999,990.00'), to_char(cash, 'FM999,999,990.00');
  end if;

  insert into public.paper_orders (user_id, symbol, side, kind, shares, why)
  values (uid, s, side, 'market', qty, w)
  returning * into row;

  if public.paper_market_open() then
    perform public.paper_check_order(row.id, public.paper_price(s, interval '15 seconds'));
    select * into row from public.paper_orders where id = row.id;
  end if;
  return row;
end $$;

-- Same as in paper-orders.sql, plus market orders and the "why".
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

  if o.kind = 'market' then
    -- A market order placed while the market was closed: it goes through at the first price after the open.
    hit := true;
  elsif o.kind = 'limit' then
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
    -- Carry the reason over to the trade so it shows on the Feed.
    if o.why is not null then update public.paper_trades set why = o.why where id = t.id; end if;
  exception when others then
    update public.paper_orders set status = 'failed', done_at = now(), note = sqlerrm where id = oid;
  end;
  return true;
end $$;

-- Same as in paper-orders.sql, but market orders wait for a price from after the opening bell.
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
    where o2.status = 'open' and pr.at > now() - interval '5 minutes'
      -- Market orders wait for a price from after the opening bell (8:31am Chicago or later), not last night's price.
      and (o2.kind <> 'market' or pr.at >= ((now() at time zone 'America/Chicago')::date + time '08:31') at time zone 'America/Chicago')
    order by o2.id
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

revoke all on function public.paper_check_order(bigint, numeric), public.paper_tick(),
  public.paper_queue_market(text, text, numeric, text) from public, anon, authenticated;
grant execute on function public.paper_queue_market(text, text, numeric, text), public.paper_market_open() to authenticated;

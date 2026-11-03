-- Weekly school-vs-school challenge.
-- Paste all of this into Supabase's SQL Editor and press Run, once (after district.sql and paper-orders.sql).
-- Safe to run again.
--
-- How it works:
--   * Every Monday morning, before the market opens, the database saves each Paper Trading account's value.
--   * A school's score for the week is the average % its players have gained since that Monday save.
--     Someone who joins in the middle of the week counts from their $50,000 start.
--   * Only players who have made at least one trade count, so empty accounts don't pull a school down.
--   * Last week's winner is the school with the best average from last Monday to this Monday.

create table if not exists public.paper_week_start (
  user_id uuid not null references auth.users on delete cascade,
  week date not null,              -- the Monday the week starts (Chicago time)
  value numeric not null,
  primary key (user_id, week)
);
alter table public.paper_week_start enable row level security;
revoke all on public.paper_week_start from anon, authenticated;

-- The Monday of the current week, in Chicago time.
create or replace function public.challenge_week() returns date
language sql stable set search_path = '' as $$
  select date_trunc('week', (now() at time zone 'America/Chicago'))::date;
$$;

-- One account's value right now: cash plus stocks at the latest saved price (same math as the leaderboard).
create or replace function public.paper_value(uid uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select a.cash + coalesce((select sum(p.shares * coalesce(pr.price, p.cost / p.shares))
                            from public.paper_positions p left join public.paper_prices pr on pr.symbol = p.symbol
                            where p.user_id = a.user_id), 0)
  from public.paper_accounts a where a.user_id = uid;
$$;
revoke all on function public.paper_value(uuid) from public, anon, authenticated;

-- Saves this week's starting value for every account (once per week).
create or replace function public.challenge_snapshot() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  insert into public.paper_week_start (user_id, week, value)
  select a.user_id, public.challenge_week(), public.paper_value(a.user_id) from public.paper_accounts a
  on conflict (user_id, week) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.challenge_snapshot() from public, anon, authenticated;

-- The challenge for everyone who is logged in: each school's average gain this week and last week.
create or replace function public.challenge_board()
returns table (school text, school_id text, players int, week_gain numeric, last_players int, last_gain numeric, week date, mine boolean)
language sql stable security definer set search_path = public as $$
  with wk as (select public.challenge_week() as w),
  ppl as (
    select a.user_id, pf.school_id, a.started_at, public.paper_value(a.user_id) as now_value
    from public.paper_accounts a join public.profiles pf on pf.user_id = a.user_id
    where exists (select 1 from public.paper_trades t where t.user_id = a.user_id)
  ),
  this_week as (
    select p.school_id, p.now_value / coalesce(s.value, 50000) - 1 as gain
    from ppl p cross join wk left join public.paper_week_start s on s.user_id = p.user_id and s.week = wk.w
    where s.value is not null or p.started_at >= (wk.w::timestamp at time zone 'America/Chicago')
  ),
  last_week as (
    select p.school_id, e.value / coalesce(b.value, 50000) - 1 as gain
    from ppl p cross join wk
      join public.paper_week_start e on e.user_id = p.user_id and e.week = wk.w
      left join public.paper_week_start b on b.user_id = p.user_id and b.week = wk.w - 7
    where (b.value is not null or p.started_at >= ((wk.w - 7)::timestamp at time zone 'America/Chicago'))
      -- No winner until a full week has been tracked.
      and exists (select 1 from public.paper_week_start x where x.week = wk.w - 7)
      and p.started_at < (wk.w::timestamp at time zone 'America/Chicago')
  )
  select sc.name, sc.id,
    (select count(*)::int from this_week t where t.school_id = sc.id),
    (select round(avg(t.gain), 4) from this_week t where t.school_id = sc.id),
    (select count(*)::int from last_week l where l.school_id = sc.id),
    (select round(avg(l.gain), 4) from last_week l where l.school_id = sc.id),
    (select w from wk),
    sc.id = (select pf.school_id from public.profiles pf where pf.user_id = auth.uid())
  from public.schools sc
  order by 4 desc nulls last, sc.name;
$$;
revoke all on function public.challenge_board() from public, anon;
grant execute on function public.challenge_board() to authenticated;

-- Every Monday at 12:00 UTC (6 or 7am Chicago), before the market opens.
select cron.unschedule(jobid) from cron.job where jobname = 'challenge-snapshot';
select cron.schedule('challenge-snapshot', '0 12 * * 1', 'select public.challenge_snapshot()');

-- Start this week's challenge right now.
select public.challenge_snapshot();

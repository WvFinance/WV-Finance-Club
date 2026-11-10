-- Weekly users and site health, for admins only.
-- Run once in Supabase's SQL Editor (after teachers.sql). Safe to run again.
--
-- 1. site_visits: one row per account per day it opened the site (no pages, no times, just the day).
-- 2. admin_usage(): weekly visitors, new accounts, traders and trades for the last 8 weeks, by school.
-- 3. admin_status(): which setup files have been run, the database timers, and how fresh the data is.

/* ---------- 1. Visits ---------- */
create table if not exists public.site_visits (
  user_id uuid not null references auth.users on delete cascade,
  day date not null,  -- Chicago date
  primary key (user_id, day)
);
alter table public.site_visits enable row level security;
-- No row rules on purpose: the website only reaches this table through the functions below.
revoke all on public.site_visits from anon, authenticated;

create or replace function public.log_visit() returns void
language sql security definer set search_path = '' as $$
  insert into public.site_visits (user_id, day)
  select auth.uid(), (now() at time zone 'America/Chicago')::date where auth.uid() is not null
  on conflict do nothing;
$$;

/* ---------- 2. Weekly users ---------- */
-- A person with a class account and a personal account (you+personal@...) counts once.
create or replace function public.admin_usage() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare me record; result jsonb;
begin
  select * into me from public.staff_whoami();
  if me.role is distinct from 'admin' then raise exception 'Only the admin can see this.'; end if;

  with people as (
    select u.id, u.created_at,
           lower(regexp_replace(u.email::text, '\+(personal|class)@', '@')) as person,
           coalesce(s.name, 'Just me') as school
    from auth.users u
    left join public.profiles pf on pf.user_id = u.id
    left join public.schools s on s.id = pf.school_id
  ),
  weeks as (
    select (date_trunc('week', (now() at time zone 'America/Chicago')) - make_interval(weeks => g))::date as wk
    from generate_series(0, 7) g
  ),
  rows as (
    select w.wk,
      (select count(distinct p.person) from public.site_visits v join people p on p.id = v.user_id
        where v.day >= w.wk and v.day < w.wk + 7) as visitors,
      (select count(*) from (select min((p.created_at at time zone 'America/Chicago')::date) as first from people p group by p.person) f
        where f.first >= w.wk and f.first < w.wk + 7) as new_people,
      (select count(distinct p.person) from public.paper_trades t join people p on p.id = t.user_id
        where (t.at at time zone 'America/Chicago')::date >= w.wk and (t.at at time zone 'America/Chicago')::date < w.wk + 7) as traders,
      (select count(*) from public.paper_trades t
        where (t.at at time zone 'America/Chicago')::date >= w.wk and (t.at at time zone 'America/Chicago')::date < w.wk + 7) as trades
    from weeks w
  ),
  this_week as (select max(wk) as wk from weeks),
  -- Each person once, under their class school if they have one.
  person_school as (
    select p.person, coalesce(max(p.school) filter (where p.school <> 'Just me'), 'Just me') as school
    from people p group by p.person
  ),
  by_school as (
    select ps.school,
      count(*) as people,
      count(*) filter (where exists (
        select 1 from public.site_visits v join people p on p.id = v.user_id, this_week tw
        where p.person = ps.person and v.day >= tw.wk)) as visitors,
      count(*) filter (where exists (
        select 1 from public.paper_trades t join people p on p.id = t.user_id, this_week tw
        where p.person = ps.person and (t.at at time zone 'America/Chicago')::date >= tw.wk)) as traders,
      count(*) filter (where exists (
        select 1 from public.paper_accounts a join people p on p.id = a.user_id where p.person = ps.person)) as playing
    from person_school ps group by ps.school
  )
  select jsonb_build_object(
    'weeks', (select jsonb_agg(to_jsonb(r) order by r.wk desc) from rows r),
    'schools', (select coalesce(jsonb_agg(to_jsonb(b) order by b.people desc), '[]') from by_school b),
    'people', (select count(distinct person) from people),
    'visits_since', (select min(day) from public.site_visits)
  ) into result;
  return result;
end $$;

/* ---------- 3. Site health ---------- */
create or replace function public.admin_status() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare me record; jobs jsonb := '[]'; p timestamptz; d date; n timestamptz;
begin
  select * into me from public.staff_whoami();
  if me.role is distinct from 'admin' then raise exception 'Only the admin can see this.'; end if;

  -- The database timers and how their last run went (pg_cron).
  begin
    execute $q$
      select coalesce(jsonb_agg(jsonb_build_object('name', j.jobname, 'schedule', j.schedule, 'active', j.active,
               'last_run', r.end_time, 'last_status', r.status) order by j.jobname), '[]')
      from cron.job j
      left join lateral (select d.end_time, d.status from cron.job_run_details d
                         where d.jobid = j.jobid order by d.start_time desc limit 1) r on true
    $q$ into jobs;
  exception when others then jobs := '[]';
  end;
  -- How fresh the data is (each table may not exist yet, so ask carefully).
  begin execute 'select max(at) from public.paper_prices' into p; exception when others then null; end;
  begin execute 'select max(day) from public.paper_daily' into d; exception when others then null; end;
  begin execute 'select max(fetched_at) from public.news_cache' into n; exception when others then null; end;

  return jsonb_build_object(
    -- Each setup file, checked by a function it creates.
    'files', jsonb_build_array(
      jsonb_build_object('file', 'paper-trading.sql', 'on', to_regproc('public.paper_join') is not null),
      jsonb_build_object('file', 'paper-orders.sql', 'on', to_regproc('public.paper_place_order') is not null),
      jsonb_build_object('file', 'district.sql', 'on', to_regproc('public.school_for_code') is not null),
      jsonb_build_object('file', 'teachers.sql', 'on', to_regproc('public.staff_students') is not null),
      jsonb_build_object('file', 'class-portfolio.sql', 'on', to_regproc('public.class_buy') is not null),
      jsonb_build_object('file', 'weekly-challenge.sql', 'on', to_regproc('public.challenge_board') is not null),
      jsonb_build_object('file', 'calendar.sql', 'on', to_regproc('public.my_calendar') is not null),
      jsonb_build_object('file', 'individual.sql', 'on', to_regproc('public.join_class') is not null),
      jsonb_build_object('file', 'home-extras.sql', 'on', to_regproc('public.friends_board') is not null),
      jsonb_build_object('file', 'two-accounts.sql', 'on', to_regproc('public.add_second_account') is not null),
      jsonb_build_object('file', 'recent-news.sql', 'on', to_regproc('public.recent_news') is not null),
      jsonb_build_object('file', 'owned-stocks.sql', 'on', to_regproc('public.owned_tickers') is not null),
      jsonb_build_object('file', 'usage.sql', 'on', true)),
    'jobs', jobs,
    'prices_at', p,
    'daily_last', d,
    'news_at', n
  );
end $$;

revoke all on function public.log_visit(), public.admin_usage(), public.admin_status() from public, anon;
grant execute on function public.log_visit(), public.admin_usage(), public.admin_status() to authenticated;

-- Simple Street Home page extras: the money-over-time chart and the friends leaderboard.
-- Paste all of this into Supabase's SQL Editor and press Run, once (after weekly-challenge.sql and individual.sql).
-- Safe to run again.
--
-- What it does:
--   1. Every weekday after the market closes, the database saves each Paper Trading account's value.
--      Each member can read only their own saved values. That's the line on the Home chart.
--   2. Each member gets an invite link. When someone opens it and logs in or signs up, the two become friends.
--   3. friends_board(): you and your friends, ranked by % gain. Only names and results, like the main leaderboard.

/* ---------- 1. Daily account value ---------- */
create table if not exists public.paper_daily (
  user_id uuid not null references auth.users on delete cascade,
  day date not null,               -- the trading day (Chicago time)
  value numeric not null,
  primary key (user_id, day)
);
alter table public.paper_daily enable row level security;
drop policy if exists "Members see their own daily values" on public.paper_daily;
create policy "Members see their own daily values" on public.paper_daily for select to authenticated using ((select auth.uid()) = user_id);
revoke all on public.paper_daily from anon, authenticated;
grant select on public.paper_daily to authenticated;

-- Saves today's value for every account. Running it twice in a day keeps the later value.
create or replace function public.paper_daily_save() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  insert into public.paper_daily (user_id, day, value)
  select a.user_id, (now() at time zone 'America/Chicago')::date, public.paper_value(a.user_id) from public.paper_accounts a
  on conflict (user_id, day) do update set value = excluded.value;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.paper_daily_save() from public, anon, authenticated;

-- 3:30pm Chicago time on weekdays (21:30 UTC in winter, 20:30 UTC in summer), after the last price update.
select cron.unschedule('paper-daily') where exists (select 1 from cron.job where jobname = 'paper-daily');
select cron.schedule('paper-daily', '30 20,21 * * 1-5', 'select public.paper_daily_save()');
select public.paper_daily_save();

/* ---------- 2. Friends and invite links ---------- */
create table if not exists public.invite_codes (
  user_id uuid primary key references auth.users on delete cascade,
  code text not null unique,
  created_at timestamptz not null default now()
);
create table if not exists public.friends (
  user_id uuid not null references auth.users on delete cascade,
  friend_id uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id),
  check (user_id <> friend_id)
);
alter table public.invite_codes enable row level security;
alter table public.friends enable row level security;
revoke all on public.invite_codes, public.friends from anon, authenticated;

-- Your invite code (made the first time you ask). It goes at the end of your invite link.
create or replace function public.my_invite_code() returns text
language plpgsql security definer set search_path = public as $$
declare c text;
begin
  if auth.uid() is null then raise exception 'Log in first.'; end if;
  select code into c from public.invite_codes where user_id = auth.uid();
  while c is null loop
    c := lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    begin
      insert into public.invite_codes (user_id, code) values (auth.uid(), c);
    exception when unique_violation then
      select code into c from public.invite_codes where user_id = auth.uid();
    end;
  end loop;
  return c;
end $$;
revoke all on function public.my_invite_code() from public, anon;
grant execute on function public.my_invite_code() to authenticated;

-- Opening someone's invite link makes you friends (both ways). Answers with their leaderboard name.
create or replace function public.accept_invite(c text) returns text
language plpgsql security definer set search_path = public as $$
declare owner uuid; nm text;
begin
  if auth.uid() is null then raise exception 'Log in first.'; end if;
  select user_id into owner from public.invite_codes where code = lower(trim(coalesce(c, '')));
  if owner is null then raise exception 'That invite link doesn''t work anymore.'; end if;
  if owner = auth.uid() then return null; end if;
  insert into public.friends (user_id, friend_id) values (auth.uid(), owner), (owner, auth.uid()) on conflict do nothing;
  select coalesce(a.name, nullif(u.raw_user_meta_data->>'name', ''), 'your friend') into nm
  from auth.users u left join public.paper_accounts a on a.user_id = u.id where u.id = owner;
  return nm;
end $$;
revoke all on function public.accept_invite(text) from public, anon;
grant execute on function public.accept_invite(text) to authenticated;

-- You and your friends who play Paper Trading, ranked by % gain.
create or replace function public.friends_board()
returns table (rank bigint, name text, value numeric, gain_pct numeric, me boolean)
language sql stable security definer set search_path = public as $$
  with people as (
    select auth.uid() as user_id
    union select f.friend_id from public.friends f where f.user_id = auth.uid()
  ), v as (
    select a.user_id, a.name, public.paper_value(a.user_id) as value
    from public.paper_accounts a join people p on p.user_id = a.user_id
  )
  select rank() over (order by v.value desc), v.name, round(v.value, 2), round(v.value / 50000 - 1, 4), v.user_id = auth.uid()
  from v order by v.value desc;
$$;
revoke all on function public.friends_board() from public, anon;
grant execute on function public.friends_board() to authenticated;

-- How many friends you have (including ones who haven't joined Paper Trading yet).
create or replace function public.friend_count() returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.friends where user_id = auth.uid();
$$;
revoke all on function public.friend_count() from public, anon;
grant execute on function public.friend_count() to authenticated;

-- Simple Street Feed page: your friends' Paper Trading trades, the reason they give ("why"),
-- emoji reactions, and the members of Congress you follow.
-- Paste all of this into Supabase's SQL Editor and press Run, once (after home-extras.sql and paper-orders.sql).
-- Safe to run again.
--
-- What it does:
--   1. Each trade can have a short "why" (up to 140 letters). Only you can write or change yours.
--   2. feed_friends(): the last 30 days of trades by you and your friends. Shares only, never dollar amounts.
--   3. Friends can react to a trade with 👍 🔥 or 🤔 (no comments). Tap again to take it back.
--   4. You can follow members of Congress. Their trades come from public records, saved in data/congress.json.

/* ---------- 1. The "why" on a trade ---------- */
alter table public.paper_trades add column if not exists why text;

-- Write or change the reason for one of your own trades. An empty reason removes it.
create or replace function public.feed_set_why(tid bigint, txt text) returns text
language plpgsql security definer set search_path = public as $$
declare w text := nullif(left(regexp_replace(trim(coalesce(txt, '')), '\s+', ' ', 'g'), 140), '');
begin
  if auth.uid() is null then raise exception 'Log in first.'; end if;
  update public.paper_trades set why = w where id = tid and user_id = auth.uid();
  if not found then raise exception 'You can only add a reason to your own trades.'; end if;
  return w;
end $$;
revoke all on function public.feed_set_why(bigint, text) from public, anon;
grant execute on function public.feed_set_why(bigint, text) to authenticated;

/* ---------- 2. Reactions ---------- */
create table if not exists public.feed_reactions (
  trade_id bigint not null references public.paper_trades on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  emoji text not null check (emoji in ('up', 'fire', 'think')),
  at timestamptz not null default now(),
  primary key (trade_id, user_id, emoji)
);
alter table public.feed_reactions enable row level security;
revoke all on public.feed_reactions from anon, authenticated;

-- People whose trades you can see: you and your friends.
create or replace function public.feed_people() returns setof uuid
language sql stable security definer set search_path = public as $$
  select auth.uid() where auth.uid() is not null
  union select f.friend_id from public.friends f where f.user_id = auth.uid();
$$;
revoke all on function public.feed_people() from public, anon, authenticated;

-- Tap a reaction: adds it, or takes it back if you already reacted that way.
create or replace function public.feed_react(tid bigint, e text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Log in first.'; end if;
  if e not in ('up', 'fire', 'think') then raise exception 'Pick 👍, 🔥 or 🤔.'; end if;
  if not exists (select 1 from public.paper_trades t where t.id = tid and t.user_id in (select public.feed_people())) then
    raise exception 'You can only react to your friends'' trades.';
  end if;
  delete from public.feed_reactions where trade_id = tid and user_id = auth.uid() and emoji = e;
  if found then return false; end if;
  insert into public.feed_reactions (trade_id, user_id, emoji) values (tid, auth.uid(), e);
  return true;
end $$;
revoke all on function public.feed_react(bigint, text) from public, anon;
grant execute on function public.feed_react(bigint, text) to authenticated;

/* ---------- 3. The friends feed ---------- */
-- Shares only: no prices, totals or account values, like the leaderboards.
create or replace function public.feed_friends()
returns table (id bigint, name text, me boolean, symbol text, side text, shares numeric, why text, at timestamptz,
               up int, fire int, think int, mine text[])
language sql stable security definer set search_path = public as $$
  select t.id, coalesce(a.name, 'A friend'), t.user_id = auth.uid(), t.symbol, t.side, t.shares, t.why, t.at,
    (select count(*)::int from public.feed_reactions r where r.trade_id = t.id and r.emoji = 'up'),
    (select count(*)::int from public.feed_reactions r where r.trade_id = t.id and r.emoji = 'fire'),
    (select count(*)::int from public.feed_reactions r where r.trade_id = t.id and r.emoji = 'think'),
    coalesce((select array_agg(r.emoji) from public.feed_reactions r where r.trade_id = t.id and r.user_id = auth.uid()), '{}')
  from public.paper_trades t
  left join public.paper_accounts a on a.user_id = t.user_id
  where t.user_id in (select public.feed_people()) and t.at > now() - interval '30 days'
  order by t.at desc
  limit 100;
$$;
revoke all on function public.feed_friends() from public, anon;
grant execute on function public.feed_friends() to authenticated;

/* ---------- 4. Following members of Congress ---------- */
create table if not exists public.feed_follows (
  user_id uuid not null references auth.users on delete cascade,
  member text not null check (length(member) between 2 and 80),   -- the lawmaker's name, as in data/congress.json
  at timestamptz not null default now(),
  primary key (user_id, member)
);
alter table public.feed_follows enable row level security;
revoke all on public.feed_follows from anon, authenticated;
drop policy if exists "Members see who they follow" on public.feed_follows;
create policy "Members see who they follow" on public.feed_follows for select to authenticated using ((select auth.uid()) = user_id);
grant select on public.feed_follows to authenticated;

-- Follow or unfollow a lawmaker. Answers true when you now follow them.
create or replace function public.feed_follow(m text) returns boolean
language plpgsql security definer set search_path = public as $$
declare n text := left(trim(coalesce(m, '')), 80);
begin
  if auth.uid() is null then raise exception 'Log in first.'; end if;
  if length(n) < 2 then raise exception 'Pick someone to follow.'; end if;
  delete from public.feed_follows where user_id = auth.uid() and member = n;
  if found then return false; end if;
  if (select count(*) from public.feed_follows where user_id = auth.uid()) >= 50 then raise exception 'You can follow up to 50 people.'; end if;
  insert into public.feed_follows (user_id, member) values (auth.uid(), n);
  return true;
end $$;
revoke all on function public.feed_follow(text) from public, anon;
grant execute on function public.feed_follow(text) to authenticated;

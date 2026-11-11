-- Users tab: the admin sees every personal account ("Just me" sign-ups and personal accounts from the
-- Class/Personal switcher). Paste all of this into Supabase's SQL Editor and press Run, once
-- (after teachers.sql, individual.sql and two-accounts.sql). Safe to run again.
--
-- The tab shows on the admin's personal account. That account isn't an admin itself, so the database
-- checks its main account (account_links): only an admin, or an admin's own second account, gets in.

create or replace function public.users_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role = 'admin')
      or exists (select 1 from public.account_links l join public.profiles p on p.user_id = l.owner
                 where l.other = auth.uid() and p.role = 'admin')
      or exists (select 1 from public.account_links l join public.profiles p on p.user_id = l.other
                 where l.owner = auth.uid() and p.role = 'admin');
$$;

-- Every personal account, with how their game is going.
drop function if exists public.users_list();
create function public.users_list()
returns table (user_id uuid, email text, name text, joined boolean, cash numeric, value numeric, gain_pct numeric,
               stocks integer, trades integer, open_orders integer, last_trade timestamptz, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.users_admin() then raise exception 'Only the admin can see this page.'; end if;
  return query
  with v as (
    select u.id, u.email::text as email, coalesce(a.name, nullif(u.raw_user_meta_data->>'name', '')) as name,
      a.user_id is not null as joined, a.cash,
      round(a.cash + coalesce((select sum(p.shares * coalesce(pr.price, p.cost / p.shares))
                               from public.paper_positions p left join public.paper_prices pr on pr.symbol = p.symbol
                               where p.user_id = u.id), 0), 2) as value,
      u.created_at
    from auth.users u
    join public.profiles pf on pf.user_id = u.id
    left join public.paper_accounts a on a.user_id = u.id
    where pf.school_id is null and pf.role not in ('teacher', 'admin') and u.id <> auth.uid())
  select v.id, v.email, v.name, v.joined, v.cash, v.value, round(v.value / 50000 - 1, 4),
    (select count(*)::int from public.paper_positions p where p.user_id = v.id),
    (select count(*)::int from public.paper_trades t where t.user_id = v.id),
    (select count(*)::int from public.paper_orders o where o.user_id = v.id and o.status = 'open'),
    (select max(t.at) from public.paper_trades t where t.user_id = v.id),
    v.created_at
  from v order by coalesce(v.name, v.email);
end $$;

-- One personal account's stocks, recent trades and orders.
create or replace function public.users_one(target uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.users_admin() then raise exception 'Only the admin can see this page.'; end if;
  if not exists (select 1 from public.profiles p where p.user_id = target and p.school_id is null) then
    raise exception 'That''s not a personal account.';
  end if;
  return jsonb_build_object(
    'positions', coalesce((select jsonb_agg(jsonb_build_object('symbol', p.symbol, 'shares', p.shares, 'cost', p.cost, 'price', pr.price) order by p.symbol)
                           from public.paper_positions p left join public.paper_prices pr on pr.symbol = p.symbol where p.user_id = target), '[]'),
    'trades', coalesce((select jsonb_agg(to_jsonb(t) order by t.at desc)
                        from (select t.symbol, t.side, t.shares, t.price, t.total, t.at from public.paper_trades t
                              where t.user_id = target order by t.at desc limit 50) t), '[]'),
    'orders', coalesce((select jsonb_agg(to_jsonb(o) order by o.created_at desc)
                        from (select o.symbol, o.side, o.kind, o.shares, o.limit_price, o.stop_price, o.trail_pct, o.status, o.note, o.created_at, o.done_at
                              from public.paper_orders o where o.user_id = target order by o.created_at desc limit 40) o), '[]'));
end $$;

revoke all on function public.users_admin(), public.users_list(), public.users_one(uuid) from public, anon;
grant execute on function public.users_admin(), public.users_list(), public.users_one(uuid) to authenticated;

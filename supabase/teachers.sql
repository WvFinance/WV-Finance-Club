-- Teacher and admin views. Paste all of this into Supabase's SQL Editor and press Run, once (after district.sql).
-- Safe to run again.
--
-- Who can see what:
--   * Students see only their own stocks, trades and orders (same as before). The leaderboard shows names and % only.
--   * A teacher sees the stocks, trades and orders of the students at their own school. View only: they can't trade for anyone.
--   * The admin sees everyone at every school, and is the only one who can make someone a teacher.
--
-- The database checks this every time, so the website can't be tricked into showing more.
--
-- Make yourself the admin (one time, after running this file). Put your email between the quotes:
--   insert into public.profiles (user_id, school_id, role)
--   select id, 'wvhs', 'admin' from auth.users where email = 'YOUR_EMAIL'
--   on conflict (user_id) do update set role = 'admin';
--
-- Make a teacher: the teacher makes an account with their school's code, like a student. Then the admin opens
-- the Teacher view tab on the website and types the teacher's email under "Make a teacher".

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('student', 'leader', 'teacher', 'admin'));

-- Who is asking, and which school they're in.
create or replace function public.staff_whoami(out role text, out school_id text)
language sql stable security definer set search_path = '' as $$
  select p.role, p.school_id from public.profiles p where p.user_id = auth.uid();
$$;

-- Can the person asking see this student? Admin: anyone. Teacher: students at their own school.
create or replace function public.staff_can_see(target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles me
    where me.user_id = auth.uid()
      and (me.role = 'admin'
        or (me.role = 'teacher' and exists (
              select 1 from public.profiles t
              where t.user_id = target and t.school_id = me.school_id and t.role in ('student', 'leader'))))
  );
$$;

-- The list of students the person asking may see, with how their game is going.
drop function if exists public.staff_students();
create function public.staff_students()
returns table (user_id uuid, email text, name text, school text, school_id text, role text, joined boolean,
               cash numeric, value numeric, gain_pct numeric, stocks integer, trades integer, open_orders integer, last_trade timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare me record;
begin
  select * into me from public.staff_whoami();
  if me.role is null or me.role not in ('teacher', 'admin') then
    raise exception 'Only teachers can see this page.';
  end if;
  return query
  select u.id, u.email::text, a.name, s.name, pf.school_id, pf.role, a.user_id is not null, a.cash,
    round(a.cash + coalesce((select sum(p.shares * coalesce(pr.price, p.cost / p.shares))
                             from public.paper_positions p left join public.paper_prices pr on pr.symbol = p.symbol
                             where p.user_id = u.id), 0), 2) as v,
    round((a.cash + coalesce((select sum(p.shares * coalesce(pr.price, p.cost / p.shares))
                              from public.paper_positions p left join public.paper_prices pr on pr.symbol = p.symbol
                              where p.user_id = u.id), 0)) / 50000 - 1, 4),
    (select count(*)::int from public.paper_positions p where p.user_id = u.id),
    (select count(*)::int from public.paper_trades t where t.user_id = u.id),
    (select count(*)::int from public.paper_orders o where o.user_id = u.id and o.status = 'open'),
    (select max(t.at) from public.paper_trades t where t.user_id = u.id)
  from auth.users u
  join public.profiles pf on pf.user_id = u.id
  left join public.schools s on s.id = pf.school_id
  left join public.paper_accounts a on a.user_id = u.id
  where u.id <> auth.uid()
    and (me.role = 'admin' or (pf.school_id = me.school_id and pf.role in ('student', 'leader')))
  order by s.name, coalesce(a.name, u.email);
end $$;

-- One student's stocks, recent trades and orders.
create or replace function public.staff_student(target uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.staff_can_see(target) then
    raise exception 'You can''t see this student.';
  end if;
  return jsonb_build_object(
    'positions', coalesce((select jsonb_agg(jsonb_build_object('symbol', p.symbol, 'shares', p.shares, 'cost', p.cost, 'price', pr.price) order by p.symbol)
                           from public.paper_positions p left join public.paper_prices pr on pr.symbol = p.symbol where p.user_id = target), '[]'),
    'trades', coalesce((select jsonb_agg(to_jsonb(t) order by t.at desc)
                        from (select t.symbol, t.side, t.shares, t.price, t.total, t.how, t.at from public.paper_trades t
                              where t.user_id = target order by t.at desc limit 50) t), '[]'),
    'orders', coalesce((select jsonb_agg(to_jsonb(o) order by o.created_at desc)
                        from (select o.symbol, o.side, o.kind, o.shares, o.limit_price, o.stop_price, o.trail_pct, o.status, o.note, o.created_at, o.done_at
                              from public.paper_orders o where o.user_id = target order by o.created_at desc limit 40) o), '[]'));
end $$;

-- Admin only: make someone a teacher, or a student again. Nobody can be made admin from the website.
create or replace function public.staff_set_role(target_email text, new_role text) returns text
language plpgsql security definer set search_path = '' as $$
declare me record; uid uuid; sname text;
begin
  select * into me from public.staff_whoami();
  if me.role is distinct from 'admin' then raise exception 'Only the admin can do this.'; end if;
  if new_role not in ('student', 'teacher') then raise exception 'Pick teacher or student.'; end if;
  select u.id into uid from auth.users u where lower(u.email) = lower(trim(target_email));
  if uid is null then raise exception 'No account uses that email yet. Ask them to make one with their school code first.'; end if;
  if uid = auth.uid() then raise exception 'You can''t change your own role here.'; end if;
  update public.profiles set role = new_role where user_id = uid;
  if not found then raise exception 'That account has no school yet.'; end if;
  select s.name into sname from public.profiles p join public.schools s on s.id = p.school_id where p.user_id = uid;
  return sname;
end $$;

revoke all on function public.staff_whoami(), public.staff_can_see(uuid), public.staff_students(),
  public.staff_student(uuid), public.staff_set_role(text, text) from public, anon;
grant execute on function public.staff_whoami(), public.staff_students(), public.staff_student(uuid),
  public.staff_set_role(text, text) to authenticated;
revoke all on function public.staff_can_see(uuid) from authenticated;

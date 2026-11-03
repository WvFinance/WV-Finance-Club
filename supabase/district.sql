-- District-wide sign up. Paste all of this into Supabase's SQL Editor and press Run, once (after the other .sql files).
-- Safe to run again.
--
-- What it does:
--   1. A list of schools, each with its own sign-up code (Waubonsie wvhs01, Neuqua nvhs01, Metea mvhs01).
--   2. The database itself checks the school code (and, if set, the school email ending) before any account is made.
--      The website can't skip this check, unlike the old club password that was checked in the page.
--   3. Every account is tied to one school. Everyone who already has an account is put in Waubonsie.
--   4. The trading game leaderboard shows each player's school (one leaderboard for the whole district).
--
-- To change a code later:        update public.schools set code = 'newcode' where id = 'wvhs';
-- To allow only school emails:   update public.schools set email_domain = 'example.org';   (the part after the @)
-- To add a school:               insert into public.schools (id, name, code) values ('abcd', 'New School', 'abcd01');
--                                (and add it to data/schools.json on the website)

create table if not exists public.schools (
  id text primary key,
  name text not null,
  code text not null unique,
  email_domain text,
  created_at timestamptz not null default now()
);

insert into public.schools (id, name, code) values
  ('wvhs', 'Waubonsie Valley', 'wvhs01'),
  ('nvhs', 'Neuqua Valley', 'nvhs01'),
  ('mvhs', 'Metea Valley', 'mvhs01')
on conflict (id) do nothing;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users on delete cascade,
  school_id text not null references public.schools,
  role text not null default 'student' check (role in ('student', 'leader', 'admin')),
  created_at timestamptz not null default now()
);

alter table public.schools enable row level security;
alter table public.profiles enable row level security;

-- Nobody reads the schools table directly (it holds the codes). The website uses school_for_code() below.
revoke all on public.schools from anon, authenticated;

-- Members can read their own profile only. Nobody can change their school or role from the website.
drop policy if exists "Members see their own profile" on public.profiles;
create policy "Members see their own profile" on public.profiles for select to authenticated using ((select auth.uid()) = user_id);
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;

-- Everyone who already has an account belongs to Waubonsie.
insert into public.profiles (user_id, school_id)
select id, 'wvhs' from auth.users
on conflict (user_id) do nothing;

-- The sign-up page asks this first so it can say "that's not a school code" in plain words.
-- It only answers with the school's name and the email ending it needs, never the codes.
create or replace function public.school_for_code(c text)
returns table (id text, name text, email_domain text)
language sql stable security definer set search_path = '' as $$
  select s.id, s.name, s.email_domain from public.schools s where s.code = lower(trim(coalesce(c, '')));
$$;
revoke all on function public.school_for_code(text) from public;
grant execute on function public.school_for_code(text) to anon, authenticated;

-- The real check. Runs inside the database every time an account is about to be made.
create or replace function public.district_check_signup() returns trigger
language plpgsql security definer set search_path = '' as $$
declare s public.schools;
begin
  select * into s from public.schools where code = lower(trim(coalesce(new.raw_user_meta_data->>'school_code', '')));
  if s.id is null then
    raise exception 'school code: That''s not a school code. Ask your club leader for it.';
  end if;
  if s.email_domain is not null and lower(coalesce(new.email, '')) not like '%@' || ltrim(lower(s.email_domain), '@') then
    raise exception 'school email: Use your school email (it ends in @%).', ltrim(s.email_domain, '@');
  end if;
  -- Keep which school they joined, and forget the code itself.
  new.raw_user_meta_data := (coalesce(new.raw_user_meta_data, '{}'::jsonb) - 'school_code') || jsonb_build_object('school', s.id);
  return new;
end $$;

create or replace function public.district_add_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id, school_id) values (new.id, new.raw_user_meta_data->>'school')
  on conflict (user_id) do nothing;
  return new;
end $$;

revoke all on function public.district_check_signup(), public.district_add_profile() from public, anon, authenticated;

drop trigger if exists district_check_signup on auth.users;
create trigger district_check_signup before insert on auth.users
  for each row execute function public.district_check_signup();

drop trigger if exists district_add_profile on auth.users;
create trigger district_add_profile after insert on auth.users
  for each row execute function public.district_add_profile();

-- One leaderboard for the whole district, now with each player's school.
drop function if exists public.paper_board();
create function public.paper_board()
returns table (rank bigint, name text, value numeric, gain_pct numeric, me boolean, school text)
language sql stable security definer set search_path = public as $$
  with v as (
    select a.user_id, a.name,
      a.cash + coalesce((select sum(p.shares * coalesce(pr.price, p.cost / p.shares))
                         from public.paper_positions p left join public.paper_prices pr on pr.symbol = p.symbol
                         where p.user_id = a.user_id), 0) as value
    from public.paper_accounts a
  )
  select rank() over (order by v.value desc), v.name, round(v.value, 2), round(v.value / 50000 - 1, 4), v.user_id = auth.uid(), s.name
  from v left join public.profiles pf on pf.user_id = v.user_id left join public.schools s on s.id = pf.school_id
  order by v.value desc limit 100;
$$;
revoke all on function public.paper_board() from public, anon;
grant execute on function public.paper_board() to authenticated;

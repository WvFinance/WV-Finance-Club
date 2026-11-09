-- Simple Street: accounts for people who aren't in a class. Paste all of this into Supabase's SQL Editor and press Run, once
-- (after district.sql). Safe to run again.
--
-- What it does:
--   1. Sign up two ways: "Join a class" with a school code (same check as before), or "Just me" with no code.
--   2. A "Just me" account has a profile with no school. It plays Paper Trading and shows on the public leaderboard.
--   3. join_class(code): a "Just me" account can join a class later with a school code. It can't switch schools after that.
--   4. The name typed at sign-up is kept, so Paper Trading can fill it in.

-- A profile with no school is a "Just me" account.
alter table public.profiles alter column school_id drop not null;

-- The check that runs every time an account is about to be made.
create or replace function public.district_check_signup() returns trigger
language plpgsql security definer set search_path = '' as $$
declare s public.schools; v_code text := lower(trim(coalesce(new.raw_user_meta_data->>'school_code', '')));
begin
  -- "Just me": no code at all, and the page said so on purpose.
  if v_code = '' and coalesce(new.raw_user_meta_data->>'account', '') = 'individual' then
    new.raw_user_meta_data := (coalesce(new.raw_user_meta_data, '{}'::jsonb) - 'school_code' - 'school');
    return new;
  end if;
  select * into s from public.schools where schools.code = v_code;
  if s.id is null then
    raise exception 'school code: That''s not a class code. Ask your teacher or club leader for it.';
  end if;
  if s.email_domain is not null and lower(coalesce(new.email, '')) not like '%@' || ltrim(lower(s.email_domain), '@') then
    raise exception 'school email: Use your school email (it ends in @%).', ltrim(s.email_domain, '@');
  end if;
  -- Keep which school they joined, and forget the code itself.
  new.raw_user_meta_data := (coalesce(new.raw_user_meta_data, '{}'::jsonb) - 'school_code') || jsonb_build_object('school', s.id);
  return new;
end $$;

-- After the account is made: a profile row, with no school for "Just me".
create or replace function public.district_add_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id, school_id) values (new.id, nullif(new.raw_user_meta_data->>'school', ''))
  on conflict (user_id) do nothing;
  return new;
end $$;
revoke all on function public.district_check_signup(), public.district_add_profile() from public, anon, authenticated;

-- A "Just me" account joins a class with a school code. Answers with the school's name.
create or replace function public.join_class(c text) returns text
language plpgsql security definer set search_path = '' as $$
declare s public.schools; p public.profiles; em text;
begin
  if auth.uid() is null then raise exception 'Log in first.'; end if;
  select * into p from public.profiles where user_id = auth.uid();
  if p.user_id is not null and p.school_id is not null then raise exception 'You''re already in a class.'; end if;
  select * into s from public.schools where code = lower(trim(coalesce(c, '')));
  if s.id is null then raise exception 'That''s not a class code. Ask your teacher or club leader for it.'; end if;
  select lower(email) into em from auth.users where id = auth.uid();
  if s.email_domain is not null and coalesce(em, '') not like '%@' || ltrim(lower(s.email_domain), '@') then
    raise exception 'To join % you need an account with your school email (it ends in @%).', s.name, ltrim(s.email_domain, '@');
  end if;
  insert into public.profiles (user_id, school_id) values (auth.uid(), s.id)
  on conflict (user_id) do update set school_id = excluded.school_id where public.profiles.school_id is null;
  return s.name;
end $$;
revoke all on function public.join_class(text) from public, anon;
grant execute on function public.join_class(text) to authenticated;

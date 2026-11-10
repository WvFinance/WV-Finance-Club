-- Simple Street: one email, two accounts (a class account and a personal account). Paste all of this into
-- Supabase's SQL Editor and press Run, once (after district.sql and individual.sql). Safe to run again.
--
-- How it works:
--   1. Everyone logs in with their own email and password, like before. That account is their "main" account.
--   2. From the switcher at the top of the page they can add the other kind: a personal account if their main one
--      is a class account, or a class account (with a class code) if their main one is personal.
--   3. The second account is a real, separate account, so it has its own $50,000 in Paper Trading, its own
--      stocks, friends and leaderboard spot. Its email is their own email with +class or +personal added
--      (like sam+personal@gmail.com). Nobody types that email or a password for it: the page logs in to it
--      for them, using a one-time password that only the main account can ask for.
--   4. Nothing about existing accounts changes.

create extension if not exists pgcrypto with schema extensions;

-- Which main account owns which second account. One second account per main account.
create table if not exists public.account_links (
  owner uuid primary key references auth.users on delete cascade,
  other uuid not null unique references auth.users on delete cascade,
  other_kind text not null check (other_kind in ('class', 'personal')),
  created_at timestamptz not null default now()
);
alter table public.account_links enable row level security;
-- No row rules on purpose: the website only reaches this table through the functions below.
revoke all on public.account_links from anon, authenticated;

-- For the switcher: what kind of account this is, and the second account, if there is one.
-- Answers {"me": "class"|"personal", "main": true|false, "other": "class"|"personal"|null, "other_id": uuid|null}.
create or replace function public.linked_account() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare p public.profiles; l public.account_links; me text;
begin
  if auth.uid() is null then raise exception 'Log in first.'; end if;
  select * into p from public.profiles where user_id = auth.uid();
  me := case when p.user_id is null then 'class' when p.school_id is null and p.role <> 'admin' then 'personal' else 'class' end;
  select * into l from public.account_links where owner = auth.uid();
  if l.owner is not null then
    return jsonb_build_object('me', me, 'main', true, 'other', l.other_kind, 'other_id', l.other);
  end if;
  select * into l from public.account_links where other = auth.uid();
  if l.owner is not null then
    return jsonb_build_object('me', me, 'main', false, 'other', case when l.other_kind = 'class' then 'personal' else 'class' end, 'other_id', l.owner);
  end if;
  return jsonb_build_object('me', me, 'main', true, 'other', null, 'other_id', null);
end $$;

-- A fresh one-time password for the second account. Only its main account can ask.
create or replace function public.second_account_key() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare l public.account_links; pw text := encode(extensions.gen_random_bytes(24), 'hex'); em text;
begin
  if auth.uid() is null then raise exception 'Log in first.'; end if;
  select * into l from public.account_links where owner = auth.uid();
  if l.owner is null then raise exception 'You don''t have a second account yet.'; end if;
  update auth.users set encrypted_password = extensions.crypt(pw, extensions.gen_salt('bf')), updated_at = now()
   where id = l.other returning email into em;
  return jsonb_build_object('email', em, 'password', pw, 'kind', l.other_kind);
end $$;

-- Makes the second account. kind is 'class' (needs a class code) or 'personal'.
-- Answers the same as second_account_key(), plus the school's name for a class account.
create or replace function public.add_second_account(kind text, code text default null, display_name text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid(); p public.profiles; s public.schools; me text; em text; local text; dom text;
  alias text; nid uuid := gen_random_uuid(); n text; meta jsonb;
begin
  if uid is null then raise exception 'Log in first.'; end if;
  if kind not in ('class', 'personal') then raise exception 'Pick a class or personal account.'; end if;
  if exists (select 1 from public.account_links where other = uid) then
    raise exception 'Switch back to your main account to do this.';
  end if;
  if exists (select 1 from public.account_links where owner = uid) then
    raise exception 'You already have both accounts. Use the switcher at the top.';
  end if;
  select * into p from public.profiles where user_id = uid;
  me := case when p.user_id is not null and p.school_id is null and p.role <> 'admin' then 'personal' else 'class' end;
  if kind = me then raise exception 'This is already your % account.', me; end if;

  select lower(email), coalesce(nullif(trim(display_name), ''), raw_user_meta_data->>'name', '')
    into em, n from auth.users where id = uid;
  if em is null or position('@' in em) = 0 then raise exception 'Your account needs an email first.'; end if;
  local := split_part(em, '@', 1); dom := split_part(em, '@', 2);

  if kind = 'class' then
    select * into s from public.schools where schools.code = lower(trim(coalesce(add_second_account.code, '')));
    if s.id is null then raise exception 'That''s not a class code. Ask your teacher or club leader for it.'; end if;
    if s.email_domain is not null and em not like '%@' || ltrim(lower(s.email_domain), '@') then
      raise exception 'To join % you need to log in with your school email (it ends in @%).', s.name, ltrim(s.email_domain, '@');
    end if;
    -- The sign-up check (district_check_signup) reads the code again and saves the school.
    meta := jsonb_build_object('school_code', s.code, 'name', left(n, 40));
  else
    meta := jsonb_build_object('account', 'individual', 'name', left(n, 40));
  end if;

  -- Their own email with +class or +personal, so anything sent to it still reaches them.
  alias := local || '+' || kind || '@' || dom;
  if exists (select 1 from auth.users where lower(email) = alias) then
    alias := local || '+' || kind || '-' || substr(replace(nid::text, '-', ''), 1, 6) || '@' || dom;
  end if;

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', nid, 'authenticated', 'authenticated', alias,
          extensions.crypt(encode(extensions.gen_random_bytes(24), 'hex'), extensions.gen_salt('bf')), now(),
          jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'second_of', uid),
          meta, now(), now(), '', '', '', '');
  insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (nid::text, nid, jsonb_build_object('sub', nid::text, 'email', alias, 'email_verified', true),
          'email', now(), now(), now());
  insert into public.account_links (owner, other, other_kind) values (uid, nid, kind);

  return public.second_account_key() || jsonb_build_object('school', s.name);
end $$;

revoke all on function public.linked_account(), public.second_account_key(), public.add_second_account(text, text, text) from public, anon;
grant execute on function public.linked_account(), public.second_account_key(), public.add_second_account(text, text, text) to authenticated;

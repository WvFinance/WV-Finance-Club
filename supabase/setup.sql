-- Member accounts (each member's watchlist). Paste all of this into Supabase's SQL Editor and press Run, once.
-- Each member can only read and change their own rows (row level security).

create table if not exists public.watchlist (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  symbol text not null,
  added_at timestamptz not null default now(),
  primary key (user_id, symbol)
);

alter table public.watchlist enable row level security;

drop policy if exists "Members see and change their own watchlist" on public.watchlist;
create policy "Members see and change their own watchlist" on public.watchlist
  for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- New tables aren't shared with the website automatically, so allow logged-in members (and nobody else).
grant select, insert, update, delete on public.watchlist to authenticated;
revoke all on public.watchlist from anon;

-- The old Fidelity/Schwab CSV uploads were removed from the site, so their table is gone too.
drop table if exists public.holdings;

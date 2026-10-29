create table public.external_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  slot smallint not null check (slot between 1 and 3),
  name text not null check (char_length(btrim(name)) between 1 and 40),
  url text not null check (url ~* '^https?://'),
  username text check (username is null or char_length(username) <= 254),
  created_at timestamptz not null default now(),
  unique (user_id, slot)
);

grant select, insert, update, delete on public.external_links to authenticated;

alter table public.external_links enable row level security;

create policy "external_links_owner_all"
  on public.external_links
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);


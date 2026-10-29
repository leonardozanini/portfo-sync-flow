-- Keeps manual crypto cost-basis adjustments separate from the original ledger.
create table public.crypto_average_price_adjustments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
  average_price numeric(38,18) not null check (average_price > 0),
  currency public.currency_code not null,
  adjusted_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index crypto_avg_adjustments_user_asset_time_idx
  on public.crypto_average_price_adjustments (user_id, asset_id, adjusted_at, created_at);

alter table public.crypto_average_price_adjustments enable row level security;

create policy "crypto_avg_adjustments_owner_select"
  on public.crypto_average_price_adjustments for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "crypto_avg_adjustments_owner_insert"
  on public.crypto_average_price_adjustments for insert to authenticated
  with check ((select auth.uid()) = user_id);

grant select, insert on public.crypto_average_price_adjustments to authenticated;

alter table public.crypto_average_price_adjustments replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'crypto_average_price_adjustments'
  ) then
    execute 'alter publication supabase_realtime add table public.crypto_average_price_adjustments';
  end if;
end $$;


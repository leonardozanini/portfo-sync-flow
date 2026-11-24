create table if not exists public.defi_wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null default 'rabby' check (provider in ('rabby')),
  address text not null check (address ~ '^0x[0-9a-fA-F]{40}$'),
  tracking_started_at timestamptz not null default now(),
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, address),
  unique (id, user_id)
);

create table if not exists public.defi_position_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  wallet_id uuid not null references public.defi_wallets(id) on delete cascade,
  chain_id bigint not null,
  protocol text not null default 'uniswap' check (protocol = 'uniswap'),
  protocol_version text not null check (protocol_version in ('v2', 'v3', 'v4')),
  position_ref text not null,
  pool_address text,
  token0_address text,
  token0_symbol text,
  token1_address text,
  token1_symbol text,
  amount0 numeric,
  amount1 numeric,
  liquidity_usd numeric,
  unclaimed_fees_usd numeric,
  is_open boolean not null default true,
  is_baseline boolean not null default false,
  observed_at timestamptz not null default now(),
  source_block bigint,
  source_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint defi_position_snapshot_owner_matches_wallet
    foreign key (wallet_id, user_id)
    references public.defi_wallets(id, user_id) on delete cascade
);

create index if not exists defi_position_snapshots_owner_observed_idx
  on public.defi_position_snapshots (user_id, observed_at desc);
create index if not exists defi_position_snapshots_wallet_position_idx
  on public.defi_position_snapshots (wallet_id, chain_id, protocol_version, position_ref, observed_at desc);

create table if not exists public.defi_position_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  wallet_id uuid not null references public.defi_wallets(id) on delete cascade,
  chain_id bigint not null,
  protocol text not null default 'uniswap' check (protocol = 'uniswap'),
  protocol_version text not null check (protocol_version in ('v2', 'v3', 'v4')),
  position_ref text not null,
  event_type text not null check (event_type in ('baseline', 'opened', 'liquidity_added', 'liquidity_removed', 'fees_collected', 'closed')),
  transaction_hash text not null,
  log_index integer not null,
  block_number bigint not null,
  occurred_at timestamptz not null,
  token0_amount numeric,
  token1_amount numeric,
  fees_usd numeric,
  source_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint defi_position_event_owner_matches_wallet
    foreign key (wallet_id, user_id)
    references public.defi_wallets(id, user_id) on delete cascade,
  unique (wallet_id, chain_id, transaction_hash, log_index)
);

create index if not exists defi_position_events_owner_occurred_idx
  on public.defi_position_events (user_id, occurred_at desc);
create index if not exists defi_position_events_wallet_position_idx
  on public.defi_position_events (wallet_id, chain_id, protocol_version, position_ref, occurred_at);

grant select, insert, update, delete on public.defi_wallets to authenticated;
grant select, insert, update, delete on public.defi_position_snapshots to authenticated;
grant select, insert, update, delete on public.defi_position_events to authenticated;

alter table public.defi_wallets enable row level security;
alter table public.defi_position_snapshots enable row level security;
alter table public.defi_position_events enable row level security;

create policy "defi_wallets_owner_all" on public.defi_wallets
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "defi_position_snapshots_owner_all" on public.defi_position_snapshots
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "defi_position_events_owner_all" on public.defi_position_events
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

comment on table public.defi_wallets is
  'Wallet addresses opted into read-only DeFi tracking. tracking_started_at defines the beginning of tracked history.';
comment on table public.defi_position_snapshots is
  'Point-in-time Uniswap liquidity position values collected from tracking_started_at onward. The first observation is a baseline, not imported history.';
comment on table public.defi_position_events is
  'Uniswap liquidity and fee events observed from tracking_started_at onward; pre-tracking events are intentionally excluded.';


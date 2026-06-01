
-- Enums
create type public.app_role as enum ('admin', 'premium', 'free');
create type public.asset_class as enum ('stock','reit','etf','crypto','fixed_income','fund','cash','other');
create type public.tx_type as enum ('buy','sell','dividend','deposit','withdraw');
create type public.currency_code as enum ('BRL','USD','EUR','GBP','JPY');

-- Profiles (1:1 with auth.users)
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  base_currency public.currency_code not null default 'BRL',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- RBAC
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id=_user_id and role=_role)
$$;

-- Assets catalog
create table public.assets (
  id uuid primary key default gen_random_uuid(),
  symbol text not null,
  name text,
  asset_class public.asset_class not null,
  currency public.currency_code not null,
  data_source text,
  external_id text,
  created_at timestamptz not null default now(),
  unique (symbol, currency)
);

-- Transactions
create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete restrict,
  tx_type public.tx_type not null,
  quantity numeric(20,8) not null,
  unit_price numeric(20,8) not null,
  fees numeric(20,8) not null default 0,
  currency public.currency_code not null,
  occurred_at date not null,
  notes text,
  created_at timestamptz not null default now()
);
create index transactions_user_date_idx on public.transactions (user_id, occurred_at desc);
create index transactions_asset_idx on public.transactions (asset_id);

-- Prices
create table public.asset_prices (
  asset_id uuid not null references public.assets(id) on delete cascade,
  price_date date not null,
  close_price numeric(20,8) not null,
  source text,
  primary key (asset_id, price_date)
);

-- FX rates
create table public.fx_rates (
  rate_date date not null,
  base public.currency_code not null,
  quote public.currency_code not null,
  rate numeric(20,8) not null,
  primary key (rate_date, base, quote)
);

-- Portfolio snapshots
create table public.portfolio_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  snapshot_date date not null,
  base_currency public.currency_code not null,
  total_value numeric(20,2) not null,
  total_invested numeric(20,2) not null,
  pnl numeric(20,2) not null,
  unique (user_id, snapshot_date, base_currency)
);

-- Price fetch failures (admin alerts)
create table public.price_fetch_failures (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid references public.assets(id) on delete set null,
  symbol text,
  reason text,
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);

-- GRANTs
grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.transactions to authenticated;
grant select on public.portfolio_snapshots to authenticated;
grant select on public.assets, public.asset_prices, public.fx_rates to authenticated;
grant select on public.user_roles to authenticated;
grant all on public.profiles, public.user_roles, public.assets, public.transactions,
  public.asset_prices, public.fx_rates, public.portfolio_snapshots, public.price_fetch_failures to service_role;

-- RLS
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.assets enable row level security;
alter table public.transactions enable row level security;
alter table public.asset_prices enable row level security;
alter table public.fx_rates enable row level security;
alter table public.portfolio_snapshots enable row level security;
alter table public.price_fetch_failures enable row level security;

-- Profiles policies
create policy "profiles_self_select" on public.profiles for select to authenticated using (auth.uid() = id);
create policy "profiles_self_update" on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);
create policy "profiles_self_insert" on public.profiles for insert to authenticated with check (auth.uid() = id);
create policy "profiles_admin_all"   on public.profiles for all to authenticated using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

-- user_roles policies
create policy "roles_self_read" on public.user_roles for select to authenticated using (auth.uid() = user_id or public.has_role(auth.uid(),'admin'));
create policy "roles_admin_write" on public.user_roles for all to authenticated using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

-- Transactions policies
create policy "tx_owner_all" on public.transactions for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Snapshots policies
create policy "snap_owner_select" on public.portfolio_snapshots for select to authenticated using (auth.uid() = user_id);

-- Assets, prices, fx — readable by all authenticated; admin-writable
create policy "assets_read"  on public.assets       for select to authenticated using (true);
create policy "assets_admin" on public.assets       for all    to authenticated using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));
create policy "prices_read"  on public.asset_prices for select to authenticated using (true);
create policy "prices_admin" on public.asset_prices for all    to authenticated using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));
create policy "fx_read"      on public.fx_rates     for select to authenticated using (true);
create policy "fx_admin"     on public.fx_rates     for all    to authenticated using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

-- Failures: admin only
create policy "failures_admin" on public.price_fetch_failures for all to authenticated using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

-- Auto-create profile + free role on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name) values (new.id, coalesce(new.raw_user_meta_data->>'display_name', new.email));
  insert into public.user_roles (user_id, role) values (new.id, 'free') on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
